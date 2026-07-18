/**
 * pdf-lib による PDF 構築 Worker。
 * - 構造保持ページ: 新規ドキュメントへのページコピー（未使用オブジェクトの GC を兼ねる）
 * - 埋め込み画像（DCTDecode）の縮小・再エンコード
 * - メタデータ削除・オブジェクトストリーム保存
 */
import {
	PDFDocument,
	PDFName,
	PDFRawStream,
	degrees,
	type PDFPage
} from 'pdf-lib';
import type { BuildRequest, BuildResponse } from '../types';

const post = (msg: BuildResponse, transfer?: Transferable[]) =>
	(self as unknown as Worker).postMessage(msg, transfer ?? []);

const name = (s: string) => PDFName.of(s);

function normalizeAngle(a: number): number {
	return ((Math.round(a / 90) * 90) % 360 + 360) % 360;
}

function stripPageExtras(page: PDFPage, removeMetadata: boolean, removeAnnotations: boolean) {
	// 埋め込みサムネイルは常に削除（要件 3.2 共通）
	page.node.delete(name('Thumb'));
	if (removeMetadata) {
		page.node.delete(name('Metadata'));
		page.node.delete(name('PieceInfo'));
	}
	if (removeAnnotations) {
		page.node.delete(name('Annots'));
		page.node.delete(name('StructParents'));
		page.node.delete(name('Tabs'));
	}
}

interface ImageOptimizeOptions {
	maxLongSide: number | null;
	jpegQuality: number;
	grayscale: boolean;
}

function toGrayscale(ctx: OffscreenCanvasRenderingContext2D, w: number, h: number) {
	const img = ctx.getImageData(0, 0, w, h);
	const d = img.data;
	for (let i = 0; i < d.length; i += 4) {
		const y = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
		d[i] = d[i + 1] = d[i + 2] = y;
	}
	ctx.putImageData(img, 0, 0);
}

/**
 * 埋め込み JPEG（DCTDecode）画像の縮小・再エンコード。
 * 対応外の画像（Predictor 付き Flate、CMYK/Indexed 等、SMask 付き）は壊さないため無変換で残す（要件 8.1）。
 */
async function optimizeEmbeddedImages(
	doc: PDFDocument,
	opts: ImageOptimizeOptions,
	onProgress: (done: number, total: number) => void
): Promise<void> {
	if (typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined') return;

	const targets: { ref: Parameters<typeof doc.context.assign>[0]; stream: PDFRawStream }[] = [];
	for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
		if (!(obj instanceof PDFRawStream)) continue;
		const dict = obj.dict;
		if (dict.get(name('Subtype')) !== name('Image')) continue;
		if (dict.get(name('Filter')) !== name('DCTDecode')) continue;
		if (dict.get(name('DecodeParms'))) continue;
		if (dict.get(name('SMask'))) continue; // 縮小すると SMask と寸法がずれるため対象外
		if (dict.get(name('Mask'))) continue;
		targets.push({ ref, stream: obj });
	}

	let done = 0;
	for (const { ref, stream } of targets) {
		onProgress(done++, targets.length);
		try {
			const src = stream.getContents();
			let bmp: ImageBitmap;
			try {
				bmp = await createImageBitmap(new Blob([src as BlobPart], { type: 'image/jpeg' }));
			} catch {
				continue; // デコードできない JPEG は無変換で残す
			}
			const long = Math.max(bmp.width, bmp.height);
			const needResize = opts.maxLongSide != null && long > opts.maxLongSide;
			if (!needResize && !opts.grayscale) {
				bmp.close();
				continue; // 縮小不要なら再エンコードによる画質劣化を避ける
			}
			const scale = needResize ? opts.maxLongSide! / long : 1;
			const w = Math.max(1, Math.round(bmp.width * scale));
			const h = Math.max(1, Math.round(bmp.height * scale));
			const canvas = new OffscreenCanvas(w, h);
			const ctx = canvas.getContext('2d');
			if (!ctx) {
				bmp.close();
				continue;
			}
			ctx.drawImage(bmp, 0, 0, w, h);
			bmp.close();
			if (opts.grayscale) toGrayscale(ctx, w, h);
			const blob = await canvas.convertToBlob({
				type: 'image/jpeg',
				quality: Math.min(1, Math.max(0.1, opts.jpegQuality / 100))
			});
			const out = new Uint8Array(await blob.arrayBuffer());
			// 再エンコード後の方が大きい場合は元データを維持（要件 3.2）
			if (out.length >= src.length) continue;
			const newStream = doc.context.stream(out, {
				Type: 'XObject',
				Subtype: 'Image',
				Width: w,
				Height: h,
				ColorSpace: 'DeviceRGB',
				BitsPerComponent: 8,
				Filter: 'DCTDecode'
			});
			doc.context.assign(ref, newStream);
		} catch {
			// 個々の画像の失敗は無視して続行（壊さないことを最優先）
		}
	}
	onProgress(targets.length, targets.length);
}

async function build(req: BuildRequest): Promise<Uint8Array> {
	const { items, settings } = req;

	const sources = new Map<string, PDFDocument>();
	for (const f of req.files) {
		sources.set(
			f.id,
			await PDFDocument.load(f.bytes, { updateMetadata: false, throwOnInvalidObject: false })
		);
	}

	const out = await PDFDocument.create();

	for (let i = 0; i < items.length; i++) {
		post({ type: 'progress', label: 'PDF を構築中', done: i, total: items.length });
		const item = items[i];
		if (item.kind === 'copy') {
			const src = sources.get(item.fileId);
			if (!src) throw new Error('内部エラー: コピー元ドキュメントがありません');
			const [page] = await out.copyPages(src, [item.pageIndex]);
			if (item.rotation !== 0) {
				page.setRotation(degrees(normalizeAngle(page.getRotation().angle + item.rotation)));
			}
			if (req.unifyWidthPts != null) {
				// 回転適用後の表示上の横幅を目標値に合わせて等倍拡縮する
				const angle = normalizeAngle(page.getRotation().angle);
				const effWidth = angle % 180 === 90 ? page.getHeight() : page.getWidth();
				const s = req.unifyWidthPts / effWidth;
				if (effWidth > 0 && Math.abs(s - 1) > 1e-6) page.scale(s, s);
			}
			stripPageExtras(page, settings.removeMetadata, settings.removeAnnotations);
			out.addPage(page);
		} else {
			const embedded =
				item.format === 'jpeg' ? await out.embedJpg(item.bytes) : await out.embedPng(item.bytes);
			const page = out.addPage([item.widthPts, item.heightPts]);
			page.drawImage(embedded, { x: 0, y: 0, width: item.widthPts, height: item.heightPts });
		}
	}

	post({ type: 'progress', label: '埋め込み画像を最適化中', done: 0, total: 1 });
	await optimizeEmbeddedImages(
		out,
		{
			maxLongSide: settings.maxLongSide,
			jpegQuality: settings.jpegQuality,
			grayscale: settings.grayscale
		},
		(done, total) => post({ type: 'progress', label: '埋め込み画像を最適化中', done, total })
	);

	if (settings.removeMetadata) {
		// Info 辞書（作成者・作成アプリ・日時等）と XMP メタデータを削除
		delete (out.context.trailerInfo as { Info?: unknown }).Info;
		out.catalog.delete(name('Metadata'));
	} else {
		out.setProducer('light-pdf');
		out.setCreator('light-pdf');
	}

	post({ type: 'progress', label: '保存中', done: 0, total: 1 });
	// PDF 1.7 / オブジェクトストリーム常時有効（決定事項）
	return await out.save({ useObjectStreams: true, addDefaultPage: false });
}

self.onmessage = async (e: MessageEvent<BuildRequest>) => {
	try {
		const bytes = await build(e.data);
		post({ type: 'done', bytes }, [bytes.buffer as ArrayBuffer]);
	} catch (err) {
		post({
			type: 'error',
			message: err instanceof Error ? err.message : 'PDF の生成に失敗しました'
		});
	}
};
