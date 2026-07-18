<script lang="ts">
	import { PDFJS_ASSET_PARAMS, pdfjs, type PDFDocumentProxy } from '../pdf/pdfjs';
	import { getDoc, renderPdfPageToCanvas } from '../pdf/loader';
	import type { PageItem } from '../types';

	let {
		bytes,
		pages,
		imageBytes,
		onClose
	}: {
		/** 軽量化後の PDF バイト列 */
		bytes: Uint8Array;
		/** 処理時点のページ一覧（出力 PDF とページ順が 1:1 で対応） */
		pages: PageItem[];
		/** 画像ページの元データ取得 */
		imageBytes: (fileId: string) => Uint8Array | null;
		onClose: () => void;
	} = $props();

	let index = $state(0);
	let showAfter = $state(true);
	let beforeSrc = $state<string | null>(null);
	let afterSrc = $state<string | null>(null);

	// pdf.js の DocumentProxy はリアクティブ化しない
	let outDoc: PDFDocumentProxy | null = null;
	let outDocPromise: Promise<PDFDocumentProxy> | null = null;
	let objectUrl: string | null = null;

	function loadOutDoc(): Promise<PDFDocumentProxy> {
		// pdf.js は渡したバッファを transfer するためコピーを渡す
		outDocPromise ??= pdfjs
			.getDocument({ data: bytes.slice(), ...PDFJS_ASSET_PARAMS })
			.promise.then((doc) => (outDoc = doc));
		return outDocPromise;
	}

	$effect(() => {
		return () => {
			void outDoc?.loadingTask.destroy();
			if (objectUrl) URL.revokeObjectURL(objectUrl);
		};
	});

	// 軽量化後のページを描画
	$effect(() => {
		const i = index;
		let alive = true;
		afterSrc = null;
		void (async () => {
			try {
				const doc = await loadOutDoc();
				if (i >= doc.numPages) return;
				const canvas = await renderPdfPageToCanvas(doc, i, 0, 1400);
				if (alive && i === index) afterSrc = canvas.toDataURL('image/jpeg', 0.9);
			} catch {
				/* 描画失敗時は「読込中…」のまま */
			}
		})();
		return () => {
			alive = false;
		};
	});

	// 元ページを描画
	$effect(() => {
		const i = index;
		const item = pages[i];
		let alive = true;
		beforeSrc = null;
		if (objectUrl) {
			URL.revokeObjectURL(objectUrl);
			objectUrl = null;
		}
		if (!item) return;
		void (async () => {
			try {
				if (item.kind === 'pdf') {
					const doc = getDoc(item.fileId);
					if (!doc) return;
					const canvas = await renderPdfPageToCanvas(doc, item.pageIndex, item.rotation, 1400);
					if (alive && i === index) beforeSrc = canvas.toDataURL('image/jpeg', 0.9);
				} else {
					const src = imageBytes(item.fileId);
					if (!src) return;
					objectUrl = URL.createObjectURL(new Blob([src as BlobPart]));
					if (alive && i === index) beforeSrc = objectUrl;
				}
			} catch {
				/* 描画失敗時は「読込中…」のまま */
			}
		})();
		return () => {
			alive = false;
		};
	});

	const item = $derived(pages[index] ?? null);
	const src = $derived(showAfter ? afterSrc : beforeSrc);

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onClose();
		else if (e.key === 'ArrowLeft') index = Math.max(0, index - 1);
		else if (e.key === 'ArrowRight') index = Math.min(pages.length - 1, index + 1);
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="overlay" role="dialog" aria-modal="true" aria-label="軽量化前後の比較プレビュー">
	<div class="controls">
		<div class="pager">
			<button onclick={() => (index = Math.max(0, index - 1))} disabled={index === 0}>◀</button>
			<span class="page-no">{index + 1} / {pages.length}</span>
			<button
				onclick={() => (index = Math.min(pages.length - 1, index + 1))}
				disabled={index >= pages.length - 1}>▶</button
			>
		</div>
		<div class="toggle" role="group" aria-label="表示の切替">
			<button class:active={!showAfter} aria-pressed={!showAfter} onclick={() => (showAfter = false)}>
				元
			</button>
			<button class:active={showAfter} aria-pressed={showAfter} onclick={() => (showAfter = true)}>
				軽量化後
			</button>
		</div>
		<button onclick={onClose} aria-label="閉じる">✕ 閉じる</button>
	</div>
	<div class="frame">
		{#if src}
			<img
				{src}
				alt="{item?.label ?? ''}（{showAfter ? '軽量化後' : '元'}）"
				style:transform={!showAfter && item?.kind === 'image'
					? `rotate(${item.rotation}deg)`
					: undefined}
			/>
		{:else}
			<p class="loading">読込中…</p>
		{/if}
	</div>
	<p class="hint">← → キーでページ移動。「元 / 軽量化後」で品質を見比べられます</p>
</div>

<style>
	.overlay {
		position: fixed;
		inset: 0;
		background: rgb(0 0 0 / 0.8);
		z-index: 95;
		display: grid;
		grid-template-rows: auto 1fr auto;
		padding: 1rem;
		gap: 0.75rem;
	}
	.controls {
		display: flex;
		justify-content: center;
		align-items: center;
		gap: 1rem;
		flex-wrap: wrap;
	}
	.pager {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.page-no {
		color: #fff;
		font-variant-numeric: tabular-nums;
		min-width: 5rem;
		text-align: center;
	}
	.toggle {
		display: flex;
	}
	.toggle button {
		border-radius: 0;
	}
	.toggle button:first-child {
		border-radius: var(--radius) 0 0 var(--radius);
	}
	.toggle button:last-child {
		border-radius: 0 var(--radius) var(--radius) 0;
	}
	.toggle button.active {
		background: var(--accent);
		color: var(--accent-text);
		border-color: var(--accent);
	}
	.frame {
		overflow: auto;
		display: grid;
		place-items: center;
	}
	img {
		max-width: 92vw;
		max-height: 78vh;
		object-fit: contain;
		background: #fff;
		box-shadow: var(--shadow);
	}
	.loading {
		color: #fff;
	}
	.hint {
		margin: 0;
		text-align: center;
		color: rgb(255 255 255 / 0.7);
		font-size: 0.8rem;
	}
</style>
