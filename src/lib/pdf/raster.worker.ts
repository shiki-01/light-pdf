/**
 * pdf.js によるページラスタライズ Worker（フェーズ 1 のオフロード）。
 * OffscreenCanvas でレンダリング・エンコードまで行い、メインスレッドを塞がない。
 * OffscreenCanvas 非対応環境や暗号化 PDF は呼び出し側がメインスレッドで処理する。
 */
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import type { RasterRequest, RasterResponse, Settings } from '../types';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const post = (msg: RasterResponse, transfer?: Transferable[]) =>
	(self as unknown as Worker).postMessage(msg, transfer ?? []);

/** ラスタライズ時のレンダリング長辺 px（process.ts と同一基準） */
function rasterTarget(longSidePts: number, settings: Settings): number {
	return Math.min(settings.maxLongSide ?? Math.round(longSidePts * 2), 4096);
}

/** 文字中心ページ判定（process.ts の autoJpegQuality と同一基準） */
const TEXT_HEAVY_CHARS = 300;
const TEXT_HEAVY_QUALITY_BOOST = 10;

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

function applyGrayscale(ctx: OffscreenCanvasRenderingContext2D, w: number, h: number) {
	const img = ctx.getImageData(0, 0, w, h);
	const d = img.data;
	for (let i = 0; i < d.length; i += 4) {
		const y = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
		d[i] = d[i + 1] = d[i + 2] = y;
	}
	ctx.putImageData(img, 0, 0);
}

async function canvasToBytes(
	canvas: OffscreenCanvas,
	type: 'image/jpeg' | 'image/png',
	quality?: number
): Promise<Uint8Array> {
	const blob = await canvas.convertToBlob({ type, quality });
	return new Uint8Array(await blob.arrayBuffer());
}

/** auto = JPEG / PNG の両方で試し圧縮し、小さい方を採用（要件 8.4） */
async function encodeAuto(
	canvas: OffscreenCanvas,
	settings: Settings,
	jpegQuality: number
): Promise<{ bytes: Uint8Array; format: 'jpeg' | 'png' }> {
	const q = Math.min(1, Math.max(0.1, jpegQuality / 100));
	if (settings.rasterFormat === 'jpeg') {
		return { bytes: await canvasToBytes(canvas, 'image/jpeg', q), format: 'jpeg' };
	}
	if (settings.rasterFormat === 'png') {
		return { bytes: await canvasToBytes(canvas, 'image/png'), format: 'png' };
	}
	const [jpeg, png] = await Promise.all([
		canvasToBytes(canvas, 'image/jpeg', q),
		canvasToBytes(canvas, 'image/png')
	]);
	return jpeg.length <= png.length
		? { bytes: jpeg, format: 'jpeg' }
		: { bytes: png, format: 'png' };
}

async function renderPage(
	doc: PDFDocumentProxy,
	pageIndex: number,
	extraRotation: number,
	settings: Settings
): Promise<{ bytes: Uint8Array; format: 'jpeg' | 'png'; widthPts: number; heightPts: number }> {
	const page = await doc.getPage(pageIndex + 1);
	const rotation = (((page.rotate + extraRotation) % 360) + 360) % 360;
	const base = page.getViewport({ scale: 1, rotation });
	const longSide = Math.max(base.width, base.height);
	let scale = rasterTarget(longSide, settings) / longSide;
	// iOS Safari の Canvas 制限を考慮した上限（loader.ts と同一基準）
	scale = Math.min(scale, 4096 / longSide);
	if (base.width * scale * base.height * scale > 16_000_000) {
		scale = Math.sqrt(16_000_000 / (base.width * base.height));
	}
	const viewport = page.getViewport({ scale, rotation });
	const canvas = new OffscreenCanvas(
		Math.max(1, Math.round(viewport.width)),
		Math.max(1, Math.round(viewport.height))
	);
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('Canvas 2D コンテキストを取得できません');
	await page.render({
		canvas: canvas as unknown as HTMLCanvasElement,
		canvasContext: ctx as unknown as CanvasRenderingContext2D,
		viewport
	}).promise;
	if (settings.grayscale) applyGrayscale(ctx, canvas.width, canvas.height);
	const quality = await autoJpegQuality(page, settings);
	const { bytes, format } = await encodeAuto(canvas, settings, quality);
	return { bytes, format, widthPts: base.width, heightPts: base.height };
}

async function run(req: RasterRequest): Promise<void> {
	const docs = new Map<string, PDFDocumentProxy>();
	try {
		for (const task of req.tasks) {
			let doc = docs.get(task.fileId);
			if (!doc) {
				const file = req.files.find((f) => f.id === task.fileId);
				if (!file) throw new Error('内部エラー: ラスタライズ対象のファイルがありません');
				doc = await pdfjs.getDocument({ data: file.bytes.slice(), ...req.assetParams }).promise;
				docs.set(task.fileId, doc);
			}
			const { bytes, format, widthPts, heightPts } = await renderPage(
				doc,
				task.pageIndex,
				task.rotation,
				req.settings
			);
			post({ type: 'page', index: task.index, bytes, format, widthPts, heightPts }, [
				bytes.buffer as ArrayBuffer
			]);
		}
		post({ type: 'done' });
	} finally {
		for (const doc of docs.values()) void doc.loadingTask.destroy();
	}
}

self.onmessage = (e: MessageEvent<RasterRequest>) => {
	run(e.data).catch((err) => {
		post({
			type: 'error',
			message: err instanceof Error ? err.message : 'ページのラスタライズに失敗しました'
		});
	});
};
