import type {
	BuildItem,
	BuildRequest,
	BuildResponse,
	LoadedFile,
	PageItem,
	ProgressInfo,
	Settings
} from '../types';
import { applyGrayscale, encodeCanvasAuto } from './encode';
import { getDoc, renderPdfPageToCanvas } from './loader';
import type { PDFPageProxy } from './pdfjs';

export class CancelledError extends Error {
	constructor() {
		super('処理をキャンセルしました');
		this.name = 'CancelledError';
	}
}

const yieldToUi = () => new Promise<void>((r) => setTimeout(r, 0));

function effectiveMode(item: PageItem, file: LoadedFile, settings: Settings): 'structure' | 'rasterize' {
	// 暗号化 PDF は pdf-lib で構造操作できないためラスタライズに固定
	if (file.encrypted) return 'rasterize';
	return item.modeOverride ?? settings.mode;
}

/** ラスタライズ時のレンダリング長辺 px。「縮小しない」時は 72dpi の 2 倍相当 */
function rasterTarget(longSidePts: number, settings: Settings): number {
	return Math.min(settings.maxLongSide ?? Math.round(longSidePts * 2), 4096);
}

/** ユーザー回転を加味したページの表示横幅（pt） */
function effectiveWidthPts(item: PageItem): number {
	return item.rotation % 180 === 90 ? item.heightPts : item.widthPts;
}

/**
 * 「横幅を揃える」の目標横幅: 最も多くのページが持つ横幅（最頻値）。
 * 同数の場合は先に登場した横幅を優先する。
 */
export function computeUnifyWidthPts(pages: PageItem[]): number | null {
	if (pages.length === 0) return null;
	const counts = new Map<number, { count: number; width: number; order: number }>();
	pages.forEach((p, order) => {
		const w = effectiveWidthPts(p);
		const key = Math.round(w); // 丸め誤差程度の差は同一視する
		const cur = counts.get(key);
		if (cur) cur.count++;
		else counts.set(key, { count: 1, width: w, order });
	});
	let best: { count: number; width: number; order: number } | null = null;
	for (const v of counts.values()) {
		if (!best || v.count > best.count || (v.count === best.count && v.order < best.order)) {
			best = v;
		}
	}
	return best!.width;
}

/** 横幅を揃える場合にページサイズ（pt）を拡縮する */
function unifyPageSize(
	widthPts: number,
	heightPts: number,
	targetWidthPts: number | null
): { widthPts: number; heightPts: number } {
	if (targetWidthPts == null || widthPts <= 0) return { widthPts, heightPts };
	const k = targetWidthPts / widthPts;
	return { widthPts: targetWidthPts, heightPts: heightPts * k };
}

/** 文字中心ページと判定する非空白文字数のしきい値 */
const TEXT_HEAVY_CHARS = 300;
/** 文字中心ページで JPEG 品質を引き上げる量（上限 95） */
const TEXT_HEAVY_QUALITY_BOOST = 10;

/**
 * 文字中心ページの JPEG 品質自動引き上げ（要件 8.4）。
 * フルページのラスタライズでは実質 JPEG が選ばれるため、
 * 文字のにじみ対策としてテキスト量の多いページだけ品質を上げる。
 */
async function autoJpegQuality(page: PDFPageProxy, settings: Settings): Promise<number> {
	if (settings.rasterFormat === 'png') return settings.jpegQuality;
	try {
		const tc = await page.getTextContent();
		let chars = 0;
		for (const item of tc.items) {
			if ('str' in item) chars += item.str.replace(/\s/g, '').length;
		}
		if (chars >= TEXT_HEAVY_CHARS) {
			return Math.min(95, settings.jpegQuality + TEXT_HEAVY_QUALITY_BOOST);
		}
	} catch {
		// テキスト抽出失敗時は通常品質のまま
	}
	return settings.jpegQuality;
}

async function rasterizePdfPage(
	item: PageItem,
	settings: Settings,
	targetWidthPts: number | null
): Promise<BuildItem> {
	const doc = getDoc(item.fileId);
	if (!doc) throw new Error('内部エラー: ドキュメントが見つかりません');
	const page = await doc.getPage(item.pageIndex + 1);
	const rotation = ((page.rotate + item.rotation) % 360 + 360) % 360;
	const vp = page.getViewport({ scale: 1, rotation });
	const canvas = await renderPdfPageToCanvas(
		doc,
		item.pageIndex,
		item.rotation,
		rasterTarget(Math.max(vp.width, vp.height), settings)
	);
	if (settings.grayscale) applyGrayscale(canvas);
	const quality = await autoJpegQuality(page, settings);
	const { bytes, format } = await encodeCanvasAuto(canvas, settings.rasterFormat, quality);
	return { kind: 'image', bytes, format, ...unifyPageSize(vp.width, vp.height, targetWidthPts) };
}

const isJpeg = (b: Uint8Array) => b.length > 2 && b[0] === 0xff && b[1] === 0xd8;

async function prepareImagePage(
	item: PageItem,
	file: LoadedFile,
	settings: Settings,
	targetWidthPts: number | null
): Promise<BuildItem> {
	const blob = new Blob([file.bytes as BlobPart]);
	const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
	try {
		const long = Math.max(bmp.width, bmp.height);
		const needResize = settings.maxLongSide != null && long > settings.maxLongSide;
		const needRotate = item.rotation !== 0;
		// 無加工で済む JPEG はそのまま埋め込む（サイズ増加を防ぐ）
		if (!needResize && !needRotate && !settings.grayscale && isJpeg(file.bytes)) {
			// EXIF 回転付き JPEG は再エンコードしないと向きが失われるため除外できないが、
			// createImageBitmap 前後で寸法が同じなら回転なしとみなす
			const pts = 72 / 96;
			return {
				kind: 'image',
				bytes: file.bytes.slice(),
				format: 'jpeg',
				...unifyPageSize(bmp.width * pts, bmp.height * pts, targetWidthPts)
			};
		}
		const scale = needResize ? settings.maxLongSide! / long : 1;
		const swap = item.rotation === 90 || item.rotation === 270;
		const w = Math.max(1, Math.round(bmp.width * scale));
		const h = Math.max(1, Math.round(bmp.height * scale));
		const canvas = document.createElement('canvas');
		canvas.width = swap ? h : w;
		canvas.height = swap ? w : h;
		const ctx = canvas.getContext('2d')!;
		ctx.fillStyle = '#ffffff';
		ctx.fillRect(0, 0, canvas.width, canvas.height);
		ctx.save();
		ctx.translate(canvas.width / 2, canvas.height / 2);
		ctx.rotate((item.rotation * Math.PI) / 180);
		ctx.drawImage(bmp, -w / 2, -h / 2, w, h);
		ctx.restore();
		if (settings.grayscale) applyGrayscale(canvas);
		const { bytes, format } = await encodeCanvasAuto(
			canvas,
			settings.rasterFormat === 'png' ? 'png' : 'auto',
			settings.jpegQuality
		);
		const pts = 72 / 96;
		return {
			kind: 'image',
			bytes,
			format,
			...unifyPageSize(canvas.width * pts, canvas.height * pts, targetWidthPts)
		};
	} finally {
		bmp.close();
	}
}

/**
 * ページ一覧を 1 つの PDF に変換する。
 * フェーズ 1（メインスレッド）: ラスタライズ・画像ページのレンダリングとエンコード
 * フェーズ 2（Web Worker）: pdf-lib によるページコピー・埋め込み画像最適化・保存
 */
export async function processAll(
	pages: PageItem[],
	files: Map<string, LoadedFile>,
	settings: Settings,
	onProgress: (p: ProgressInfo) => void,
	signal: AbortSignal
): Promise<Uint8Array> {
	const items: BuildItem[] = [];
	const usedPdfFiles = new Set<string>();
	const unifyWidthPts = settings.unifyWidth ? computeUnifyWidthPts(pages) : null;

	// フェーズ 1: レンダリングが必要なページを処理
	for (let i = 0; i < pages.length; i++) {
		if (signal.aborted) throw new CancelledError();
		const item = pages[i];
		const file = files.get(item.fileId);
		if (!file) continue;
		onProgress({ label: 'ページを変換中', done: i, total: pages.length });
		if (item.kind === 'image') {
			items.push(await prepareImagePage(item, file, settings, unifyWidthPts));
		} else if (effectiveMode(item, file, settings) === 'rasterize') {
			items.push(await rasterizePdfPage(item, settings, unifyWidthPts));
		} else {
			usedPdfFiles.add(file.id);
			items.push({
				kind: 'copy',
				fileId: file.id,
				pageIndex: item.pageIndex,
				rotation: item.rotation
			});
		}
		await yieldToUi();
	}
	onProgress({ label: 'ページを変換中', done: pages.length, total: pages.length });
	if (signal.aborted) throw new CancelledError();

	// フェーズ 2: Worker で PDF を構築
	const req: BuildRequest = {
		files: [...usedPdfFiles].map((id) => ({ id, bytes: files.get(id)!.bytes.slice() })),
		items,
		settings: { ...settings },
		unifyWidthPts
	};
	const transfers: ArrayBuffer[] = [
		...req.files.map((f) => f.bytes.buffer as ArrayBuffer),
		...req.items.flatMap((it) => (it.kind === 'image' ? [it.bytes.buffer as ArrayBuffer] : []))
	];

	const worker = new Worker(new URL('./builder.worker.ts', import.meta.url), { type: 'module' });
	try {
		return await new Promise<Uint8Array>((resolve, reject) => {
			const onAbort = () => {
				reject(new CancelledError());
			};
			signal.addEventListener('abort', onAbort, { once: true });
			worker.onmessage = (e: MessageEvent<BuildResponse>) => {
				const msg = e.data;
				if (msg.type === 'progress') {
					onProgress({ label: msg.label, done: msg.done, total: msg.total });
				} else if (msg.type === 'done') {
					signal.removeEventListener('abort', onAbort);
					resolve(msg.bytes);
				} else {
					signal.removeEventListener('abort', onAbort);
					reject(new Error(msg.message));
				}
			};
			worker.onerror = (e) => {
				signal.removeEventListener('abort', onAbort);
				reject(new Error(e.message || 'PDF の生成中にエラーが発生しました'));
			};
			worker.postMessage(req, transfers);
		});
	} finally {
		worker.terminate();
	}
}
