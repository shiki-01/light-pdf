import { PDFJS_ASSET_PARAMS, pdfjs, type PDFDocumentProxy } from './pdfjs';
import type { LoadedFile, LoadError, PageItem } from '../types';

let seq = 0;
const uid = () => `${Date.now().toString(36)}-${seq++}`;

/** pdf.js の DocumentProxy はリアクティブ化せずモジュール内 Map で保持する */
const docs = new Map<string, PDFDocumentProxy>();

export function getDoc(fileId: string): PDFDocumentProxy | undefined {
	return docs.get(fileId);
}

export function releaseDoc(fileId: string): void {
	const doc = docs.get(fileId);
	if (doc) {
		void doc.loadingTask.destroy();
		docs.delete(fileId);
	}
}

export type AskPassword = (fileName: string, retry: boolean) => Promise<string | null>;

export interface LoadResult {
	files: LoadedFile[];
	pages: PageItem[];
	errors: LoadError[];
}

const THUMB_LONG_SIDE = 240;

function isPdf(file: File): boolean {
	return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}

function isHeic(file: File): boolean {
	return /image\/hei[cf]/.test(file.type) || /\.(heic|heif)$/i.test(file.name);
}

function isImage(file: File): boolean {
	return file.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|heic|heif)$/i.test(file.name);
}

export async function renderPdfPageToCanvas(
	doc: PDFDocumentProxy,
	pageIndex: number,
	extraRotation: number,
	targetLongSidePx: number
): Promise<HTMLCanvasElement> {
	const page = await doc.getPage(pageIndex + 1);
	const rotation = ((page.rotate + extraRotation) % 360 + 360) % 360;
	const base = page.getViewport({ scale: 1, rotation });
	const longSide = Math.max(base.width, base.height);
	let scale = targetLongSidePx / longSide;
	// iOS Safari の Canvas 制限を考慮した上限（長辺 4096 / 総ピクセル約 16M）
	scale = Math.min(scale, 4096 / longSide);
	if (base.width * scale * base.height * scale > 16_000_000) {
		scale = Math.sqrt(16_000_000 / (base.width * base.height));
	}
	const viewport = page.getViewport({ scale, rotation });
	const canvas = document.createElement('canvas');
	canvas.width = Math.max(1, Math.round(viewport.width));
	canvas.height = Math.max(1, Math.round(viewport.height));
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('Canvas 2D コンテキストを取得できません');
	await page.render({ canvas, canvasContext: ctx, viewport }).promise;
	return canvas;
}

/** 白紙判定: この輝度未満を「描画あり」とみなす */
const BLANK_LUMA_THRESHOLD = 230;
/** 白紙判定: 描画ありピクセルがこの割合未満なら白紙（スキャンのノイズ・縁を許容） */
const BLANK_DARK_RATIO = 0.005;

/**
 * サムネイル画像から白紙ページかどうかを判定する（要件 7: 白紙ページの検出）。
 * 削除候補の提示に使うだけなので誤検出しても実害は小さい。
 */
function isCanvasBlank(canvas: HTMLCanvasElement): boolean {
	const ctx = canvas.getContext('2d');
	if (!ctx) return false;
	const { width: w, height: h } = canvas;
	if (w * h === 0) return false;
	const d = ctx.getImageData(0, 0, w, h).data;
	const limit = w * h * BLANK_DARK_RATIO;
	let dark = 0;
	for (let i = 0; i < w * h; i++) {
		const a = d[i * 4 + 3];
		if (a < 128) continue; // 透明は背景（白）扱い
		const y = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
		if (y < BLANK_LUMA_THRESHOLD && ++dark > limit) return false;
	}
	return true;
}

interface ThumbResult {
	url: string;
	isBlank: boolean;
}

async function renderThumb(doc: PDFDocumentProxy, pageIndex: number): Promise<ThumbResult> {
	const canvas = await renderPdfPageToCanvas(doc, pageIndex, 0, THUMB_LONG_SIDE);
	return { url: canvas.toDataURL('image/jpeg', 0.75), isBlank: isCanvasBlank(canvas) };
}

async function bitmapThumb(bmp: ImageBitmap): Promise<ThumbResult> {
	const scale = Math.min(1, THUMB_LONG_SIDE / Math.max(bmp.width, bmp.height));
	const canvas = document.createElement('canvas');
	canvas.width = Math.max(1, Math.round(bmp.width * scale));
	canvas.height = Math.max(1, Math.round(bmp.height * scale));
	const ctx = canvas.getContext('2d')!;
	ctx.fillStyle = '#fff';
	ctx.fillRect(0, 0, canvas.width, canvas.height);
	ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
	return { url: canvas.toDataURL('image/jpeg', 0.75), isBlank: isCanvasBlank(canvas) };
}

export interface LoadCallbacks {
	onPage: (page: PageItem) => void;
	/** サムネイル生成は非同期のため、完成時に id 指定で通知する */
	onThumb: (pageId: string, thumb: ThumbResult) => void;
}

async function loadPdf(
	file: File,
	askPassword: AskPassword,
	cb: LoadCallbacks
): Promise<{ loaded: LoadedFile; pages: PageItem[] } | LoadError> {
	const bytes = new Uint8Array(await file.arrayBuffer());
	let encrypted = false;
	// pdf.js は渡したバッファを transfer するためコピーを渡す
	const task = pdfjs.getDocument({ data: bytes.slice(), ...PDFJS_ASSET_PARAMS });
	task.onPassword = (updatePassword: (pw: string) => void, reason: number) => {
		encrypted = true;
		const retry = reason === pdfjs.PasswordResponses.INCORRECT_PASSWORD;
		void askPassword(file.name, retry).then((pw) => {
			if (pw == null) {
				void task.destroy();
			} else {
				updatePassword(pw);
			}
		});
	};

	let doc: PDFDocumentProxy;
	try {
		doc = await task.promise;
	} catch (e) {
		const msg =
			e instanceof Error && e.name === 'PasswordException'
				? 'パスワードが未入力のためスキップしました'
				: '読み込みに失敗しました（破損している可能性があります）';
		return { name: file.name, message: msg };
	}

	const fileId = uid();
	docs.set(fileId, doc);
	const loaded: LoadedFile = {
		id: fileId,
		name: file.name,
		kind: 'pdf',
		bytes,
		size: file.size,
		encrypted,
		pageCount: doc.numPages
	};

	const pages: PageItem[] = [];
	for (let i = 0; i < doc.numPages; i++) {
		const pageProxy = await doc.getPage(i + 1);
		const vp = pageProxy.getViewport({ scale: 1 });
		const item: PageItem = {
			id: uid(),
			kind: 'pdf',
			fileId,
			label: doc.numPages > 1 ? `${file.name} p.${i + 1}` : file.name,
			pageIndex: i,
			rotation: 0,
			thumbUrl: null,
			isBlank: false,
			modeOverride: null,
			widthPts: vp.width,
			heightPts: vp.height
		};
		pages.push(item);
		cb.onPage(item);
		// サムネイルは非同期に埋める（UI を待たせない）
		void renderThumb(doc, i)
			.then((thumb) => cb.onThumb(item.id, thumb))
			.catch(() => {
				/* サムネイル失敗はページ自体には影響させない */
			});
	}
	return { loaded, pages };
}

async function loadImage(
	file: File,
	cb: LoadCallbacks
): Promise<{ loaded: LoadedFile; pages: PageItem[] } | LoadError> {
	if (isHeic(file)) {
		return {
			name: file.name,
			message: 'HEIC は現在未対応です（対応予定）。JPEG 等に変換してから投入してください'
		};
	}
	const bytes = new Uint8Array(await file.arrayBuffer());
	let bmp: ImageBitmap;
	try {
		// EXIF Orientation を反映して取り込む（要件 3.1）
		bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
	} catch {
		return { name: file.name, message: '画像のデコードに失敗しました' };
	}

	const fileId = uid();
	const loaded: LoadedFile = {
		id: fileId,
		name: file.name,
		kind: 'image',
		bytes,
		size: file.size,
		encrypted: false,
		pageCount: 1
	};
	const item: PageItem = {
		id: uid(),
		kind: 'image',
		fileId,
		label: file.name,
		pageIndex: 0,
		rotation: 0,
		thumbUrl: null,
		isBlank: false,
		modeOverride: null,
		// 96dpi 相当で pt 換算（process.ts の埋め込みと同一基準）
		widthPts: bmp.width * (72 / 96),
		heightPts: bmp.height * (72 / 96)
	};
	cb.onPage(item);
	void bitmapThumb(bmp)
		.then((thumb) => cb.onThumb(item.id, thumb))
		.finally(() => bmp.close());
	return { loaded, pages: [item] };
}

/**
 * 投入されたファイル群をページに分解して読み込む。
 * 失敗はファイル単位で errors に積み、処理全体は止めない（要件 3.1）。
 */
export async function loadFiles(
	fileList: Iterable<File>,
	askPassword: AskPassword,
	cb: LoadCallbacks
): Promise<LoadResult> {
	const result: LoadResult = { files: [], pages: [], errors: [] };
	for (const file of fileList) {
		try {
			let r: { loaded: LoadedFile; pages: PageItem[] } | LoadError;
			if (isPdf(file)) {
				r = await loadPdf(file, askPassword, cb);
			} else if (isImage(file)) {
				r = await loadImage(file, cb);
			} else {
				r = { name: file.name, message: '対応していない形式です（PDF / JPEG / PNG / WebP / GIF）' };
			}
			if ('loaded' in r) {
				result.files.push(r.loaded);
				result.pages.push(...r.pages);
			} else {
				result.errors.push(r);
			}
		} catch (e) {
			result.errors.push({
				name: file.name,
				message: e instanceof Error ? e.message : '読み込みに失敗しました'
			});
		}
	}
	return result;
}
