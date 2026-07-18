/**
 * pdf-lib による PDF 構築 Worker。
 * - 構造保持ページ: 新規ドキュメントへのページコピー（未使用オブジェクトの GC を兼ねる）
 * - 重複オブジェクト（同一画像・フォント）の統合
 * - 埋め込み画像（DCTDecode / FlateDecode、SMask 付き含む）の縮小・再エンコード
 * - メタデータ削除・オブジェクトストリーム保存
 */
import { PDFDocument, PDFName, degrees, type PDFPage } from 'pdf-lib';
import type { BuildRequest, BuildResponse } from '../types';
import { dedupeStreams } from './dedupe';
import { optimizeEmbeddedImages } from './optimize-images';

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

	post({ type: 'progress', label: '重複データを統合中', done: 0, total: 1 });
	try {
		dedupeStreams(out);
	} catch {
		// 統合失敗は無視して続行（未統合でも表示上の問題はない）
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
