import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { base } from '$app/paths';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** pdf.js が実行時に読み込むアセットの共通パラメータ（vite-plugin-static-copy で配信） */
export const PDFJS_ASSET_PARAMS = {
	cMapUrl: `${base}/pdfjs/cmaps/`,
	cMapPacked: true,
	standardFontDataUrl: `${base}/pdfjs/standard_fonts/`,
	wasmUrl: `${base}/pdfjs/wasm/`,
	iccUrl: `${base}/pdfjs/iccs/`
} as const;

export { pdfjs };
export type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
