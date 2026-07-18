import type { RasterFormat } from '../types';

export function canvasToBytes(
	canvas: HTMLCanvasElement,
	type: 'image/jpeg' | 'image/png',
	quality?: number
): Promise<Uint8Array> {
	return new Promise((resolve, reject) => {
		canvas.toBlob(
			async (blob) => {
				if (!blob) {
					reject(new Error('画像のエンコードに失敗しました'));
					return;
				}
				resolve(new Uint8Array(await blob.arrayBuffer()));
			},
			type,
			quality
		);
	});
}

/**
 * ラスタライズ時のフォーマット決定。
 * auto = JPEG / PNG の両方で試し圧縮し、小さい方を採用（要件 8.4）。
 */
export async function encodeCanvasAuto(
	canvas: HTMLCanvasElement,
	format: RasterFormat,
	jpegQuality: number
): Promise<{ bytes: Uint8Array; format: 'jpeg' | 'png' }> {
	const q = Math.min(1, Math.max(0.1, jpegQuality / 100));
	if (format === 'jpeg') {
		return { bytes: await canvasToBytes(canvas, 'image/jpeg', q), format: 'jpeg' };
	}
	if (format === 'png') {
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

/** キャンバスの内容をグレースケール化する（Safari の ctx.filter 非対応を考慮しピクセル処理） */
export function applyGrayscale(canvas: HTMLCanvasElement): void {
	const ctx = canvas.getContext('2d');
	if (!ctx) return;
	const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
	const d = img.data;
	for (let i = 0; i < d.length; i += 4) {
		const y = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
		d[i] = d[i + 1] = d[i + 2] = y;
	}
	ctx.putImageData(img, 0, 0);
}
