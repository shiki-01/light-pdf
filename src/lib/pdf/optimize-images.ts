/**
 * 埋め込み画像の縮小・再エンコード（builder.worker 内で使用）。
 * - DCTDecode（JPEG）: 縮小・再エンコード
 * - FlateDecode（RGB8 / Gray8、Predictor なし）: JPEG への再圧縮
 * - SMask 付き: 本体と SMask を同寸法に縮小し、本体 JPEG + SMask Flate(Gray8) で再格納
 *   （スパイク 8.1 で成立確認済みの方式）
 * 対応外の画像（Predictor 付き、CMYK/Indexed/ICCBased、16bit、Filter 配列等）は
 * 壊さないため無変換で残す（要件 8.1）。
 */
import {
	PDFDict,
	PDFDocument,
	PDFName,
	PDFNumber,
	PDFRawStream,
	PDFRef
} from 'pdf-lib';

const name = (s: string) => PDFName.of(s);

export interface ImageOptimizeOptions {
	maxLongSide: number | null;
	jpegQuality: number;
	grayscale: boolean;
}

type SimpleColorSpace = 'DeviceRGB' | 'DeviceGray';
type SimpleFilter = 'DCTDecode' | 'FlateDecode';

interface ImageInfo {
	stream: PDFRawStream;
	filter: SimpleFilter;
	width: number;
	height: number;
	colorSpace: SimpleColorSpace;
}

interface Target {
	ref: PDFRef;
	body: ImageInfo;
	smask: { ref: PDFRef; info: ImageInfo } | null;
}

function dictNumber(doc: PDFDocument, dict: PDFDict, key: string): number | null {
	const v = doc.context.lookup(dict.get(name(key)));
	return v instanceof PDFNumber ? v.asNumber() : null;
}

/** 再圧縮に対応できる単純な画像（8bit・単一フィルタ・素の色空間）だけを拾う */
function classifyImage(doc: PDFDocument, stream: PDFRawStream): ImageInfo | null {
	const dict = stream.dict;
	if (dict.get(name('Subtype')) !== name('Image')) return null;
	if (dict.get(name('DecodeParms')) || dict.get(name('Decode'))) return null;
	if (dict.get(name('Mask')) || dict.get(name('Matte'))) return null;
	if (dict.get(name('ImageMask'))) return null;
	if (dictNumber(doc, dict, 'BitsPerComponent') !== 8) return null;

	const filter = dict.get(name('Filter'));
	if (filter !== name('DCTDecode') && filter !== name('FlateDecode')) return null;

	const cs = doc.context.lookup(dict.get(name('ColorSpace')));
	if (cs !== name('DeviceRGB') && cs !== name('DeviceGray')) return null;

	const width = dictNumber(doc, dict, 'Width');
	const height = dictNumber(doc, dict, 'Height');
	if (!width || !height || width < 1 || height < 1) return null;

	return {
		stream,
		filter: filter === name('DCTDecode') ? 'DCTDecode' : 'FlateDecode',
		width,
		height,
		colorSpace: cs === name('DeviceRGB') ? 'DeviceRGB' : 'DeviceGray'
	};
}

async function inflate(data: Uint8Array): Promise<Uint8Array | null> {
	if (typeof DecompressionStream === 'undefined') return null;
	try {
		const stream = new Blob([data as BlobPart])
			.stream()
			.pipeThrough(new DecompressionStream('deflate'));
		return new Uint8Array(await new Response(stream).arrayBuffer());
	} catch {
		return null;
	}
}

async function deflate(data: Uint8Array): Promise<Uint8Array | null> {
	if (typeof CompressionStream === 'undefined') return null;
	try {
		const stream = new Blob([data as BlobPart])
			.stream()
			.pipeThrough(new CompressionStream('deflate'));
		return new Uint8Array(await new Response(stream).arrayBuffer());
	} catch {
		return null;
	}
}

/** 画像をデコードして等倍の OffscreenCanvas にする。失敗時は null */
async function decodeToCanvas(info: ImageInfo): Promise<OffscreenCanvas | null> {
	const src = info.stream.getContents();
	if (info.filter === 'DCTDecode') {
		let bmp: ImageBitmap;
		try {
			bmp = await createImageBitmap(new Blob([src as BlobPart], { type: 'image/jpeg' }));
		} catch {
			return null;
		}
		const canvas = new OffscreenCanvas(bmp.width, bmp.height);
		const ctx = canvas.getContext('2d');
		if (!ctx) {
			bmp.close();
			return null;
		}
		ctx.drawImage(bmp, 0, 0);
		bmp.close();
		return canvas;
	}
	// FlateDecode: 生ピクセルを復元して ImageData に詰める
	const raw = await inflate(src);
	if (!raw) return null;
	const { width: w, height: h, colorSpace } = info;
	const channels = colorSpace === 'DeviceRGB' ? 3 : 1;
	if (raw.length < w * h * channels) return null;
	const img = new ImageData(w, h);
	const d = img.data;
	if (channels === 3) {
		for (let i = 0, j = 0; i < w * h; i++, j += 3) {
			d[i * 4] = raw[j];
			d[i * 4 + 1] = raw[j + 1];
			d[i * 4 + 2] = raw[j + 2];
			d[i * 4 + 3] = 255;
		}
	} else {
		for (let i = 0; i < w * h; i++) {
			d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = raw[i];
			d[i * 4 + 3] = 255;
		}
	}
	const canvas = new OffscreenCanvas(w, h);
	const ctx = canvas.getContext('2d');
	if (!ctx) return null;
	ctx.putImageData(img, 0, 0);
	return canvas;
}

/** SMask（グレースケール画像）をデコードし、指定寸法のアルファ値配列にする */
async function decodeAlpha(
	info: ImageInfo,
	outW: number,
	outH: number
): Promise<Uint8Array | null> {
	const canvas = await decodeToCanvas(info);
	if (!canvas) return null;
	const scaled = new OffscreenCanvas(outW, outH);
	const ctx = scaled.getContext('2d');
	if (!ctx) return null;
	ctx.drawImage(canvas, 0, 0, outW, outH);
	const img = ctx.getImageData(0, 0, outW, outH);
	const alpha = new Uint8Array(outW * outH);
	for (let i = 0; i < alpha.length; i++) alpha[i] = img.data[i * 4];
	return alpha;
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

async function encodeJpeg(
	canvas: OffscreenCanvas,
	quality: number
): Promise<Uint8Array> {
	const blob = await canvas.convertToBlob({
		type: 'image/jpeg',
		quality: Math.min(1, Math.max(0.1, quality / 100))
	});
	return new Uint8Array(await blob.arrayBuffer());
}

async function optimizeOne(doc: PDFDocument, target: Target, opts: ImageOptimizeOptions) {
	const { body, smask } = target;
	const srcBody = body.stream.getContents();
	const long = Math.max(body.width, body.height);
	const needResize = opts.maxLongSide != null && long > opts.maxLongSide;
	// 元がロスレス（Flate）なら JPEG 化だけで大きく減るため常に試す。
	// 元が JPEG の場合は縮小かグレースケール変換が必要なときだけ再エンコードする
	// （無意味な再エンコードによる画質劣化を避ける）
	if (body.filter === 'DCTDecode' && !needResize && !opts.grayscale) return;
	if (smask && typeof CompressionStream === 'undefined') return;

	const canvas = await decodeToCanvas(body);
	if (!canvas) return;
	const scale = needResize ? opts.maxLongSide! / long : 1;
	const w = Math.max(1, Math.round(body.width * scale));
	const h = Math.max(1, Math.round(body.height * scale));
	const out = new OffscreenCanvas(w, h);
	const ctx = out.getContext('2d');
	if (!ctx) return;
	ctx.drawImage(canvas, 0, 0, w, h);
	if (opts.grayscale) toGrayscale(ctx, w, h);
	const newBody = await encodeJpeg(out, opts.jpegQuality);

	let newSmask: Uint8Array | null = null;
	let srcTotal = srcBody.length;
	if (smask) {
		srcTotal += smask.info.stream.getContents().length;
		const alpha = await decodeAlpha(smask.info, w, h);
		if (!alpha) return;
		newSmask = await deflate(alpha);
		if (!newSmask) return;
	}

	// 再エンコード後の方が大きい場合は元データを維持（要件 3.2）
	const newTotal = newBody.length + (newSmask?.length ?? 0);
	if (newTotal >= srcTotal) return;

	const bodyDict: Record<string, string | number | PDFRef> = {
		Type: 'XObject',
		Subtype: 'Image',
		Width: w,
		Height: h,
		ColorSpace: 'DeviceRGB',
		BitsPerComponent: 8,
		Filter: 'DCTDecode'
	};
	if (smask) bodyDict.SMask = smask.ref;
	doc.context.assign(target.ref, doc.context.stream(newBody, bodyDict));
	if (smask && newSmask) {
		doc.context.assign(
			smask.ref,
			doc.context.stream(newSmask, {
				Type: 'XObject',
				Subtype: 'Image',
				Width: w,
				Height: h,
				ColorSpace: 'DeviceGray',
				BitsPerComponent: 8,
				Filter: 'FlateDecode'
			})
		);
	}
}

/**
 * ドキュメント内の埋め込み画像を列挙し、対応可能なものを縮小・再エンコードする。
 */
export async function optimizeEmbeddedImages(
	doc: PDFDocument,
	opts: ImageOptimizeOptions,
	onProgress: (done: number, total: number) => void
): Promise<void> {
	if (typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined') return;

	// SMask として参照されているストリームは本体側の処理で扱うため単体では対象にしない
	const smaskRefs = new Set<PDFRef>();
	for (const [, obj] of doc.context.enumerateIndirectObjects()) {
		if (!(obj instanceof PDFRawStream)) continue;
		const sm = obj.dict.get(name('SMask'));
		if (sm instanceof PDFRef) smaskRefs.add(sm);
	}

	const targets: Target[] = [];
	for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
		if (!(obj instanceof PDFRawStream) || smaskRefs.has(ref)) continue;
		const body = classifyImage(doc, obj);
		if (!body) continue;
		const smRef = obj.dict.get(name('SMask'));
		let smask: Target['smask'] = null;
		if (smRef instanceof PDFRef) {
			const smObj = doc.context.lookup(smRef);
			const info = smObj instanceof PDFRawStream ? classifyImage(doc, smObj) : null;
			// SMask が対応外の形式なら本体ごと触らない（寸法ずれで壊すのを防ぐ）
			if (!info || info.colorSpace !== 'DeviceGray') continue;
			smask = { ref: smRef, info };
		} else if (smRef) {
			continue; // 直接オブジェクトの SMask は想定外のため触らない
		}
		targets.push({ ref, body, smask });
	}

	let done = 0;
	for (const target of targets) {
		onProgress(done++, targets.length);
		try {
			await optimizeOne(doc, target, opts);
		} catch {
			// 個々の画像の失敗は無視して続行（壊さないことを最優先）
		}
	}
	onProgress(targets.length, targets.length);
}
