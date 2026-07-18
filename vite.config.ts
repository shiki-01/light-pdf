import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

export default defineConfig({
	plugins: [
		sveltekit(),
		// pdf.js が実行時に読み込むアセット（CJK フォント用 CMap・標準 14 フォント・画像デコード用 WASM・ICC）
		viteStaticCopy({
			targets: [
				{ src: 'node_modules/pdfjs-dist/cmaps/*', dest: 'pdfjs/cmaps', rename: { stripBase: true } },
				{
					src: 'node_modules/pdfjs-dist/standard_fonts/*',
					dest: 'pdfjs/standard_fonts',
					rename: { stripBase: true }
				},
				{ src: 'node_modules/pdfjs-dist/wasm/*', dest: 'pdfjs/wasm', rename: { stripBase: true } },
				{ src: 'node_modules/pdfjs-dist/iccs/*', dest: 'pdfjs/iccs', rename: { stripBase: true } },
				// HEIC デコーダー（libheif WASM 同梱バンドル）。改変せず同梱し、
				// HEIC が投入されるまでダウンロードしない（遅延ロード、要件 3.1 / 5）
				{
					src: 'node_modules/libheif-js/libheif-wasm/libheif-bundle.mjs',
					dest: 'heic',
					rename: { stripBase: true }
				},
				{ src: 'node_modules/libheif-js/LICENSE*', dest: 'heic', rename: { stripBase: true } }
			]
		})
	],
	worker: {
		format: 'es'
	}
});
