<script lang="ts">
	import type { PageItem } from '../types';
	import { getDoc, renderPdfPageToCanvas } from '../pdf/loader';

	let {
		item,
		imageBytes,
		onClose
	}: {
		item: PageItem;
		/** 画像ページの場合の元データ */
		imageBytes: Uint8Array | null;
		onClose: () => void;
	} = $props();

	let src = $state<string | null>(null);
	let objectUrl: string | null = null;

	$effect(() => {
		let alive = true;
		src = null;
		(async () => {
			if (item.kind === 'pdf') {
				const doc = getDoc(item.fileId);
				if (!doc) return;
				const canvas = await renderPdfPageToCanvas(doc, item.pageIndex, item.rotation, 1400);
				if (alive) src = canvas.toDataURL('image/jpeg', 0.85);
			} else if (imageBytes) {
				objectUrl = URL.createObjectURL(new Blob([imageBytes as BlobPart]));
				if (alive) src = objectUrl;
			}
		})();
		return () => {
			alive = false;
			if (objectUrl) {
				URL.revokeObjectURL(objectUrl);
				objectUrl = null;
			}
		};
	});

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onClose();
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- Escape キーでの閉じる操作は svelte:window で提供済み -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_interactive_supports_focus -->
<div
	class="overlay"
	role="dialog"
	aria-modal="true"
	aria-label="{item.label} のプレビュー"
	onclick={onClose}
>
	<div class="frame">
		{#if src}
			<img
				{src}
				alt={item.label}
				style:transform={item.kind === 'image' ? `rotate(${item.rotation}deg)` : undefined}
			/>
		{:else}
			<p class="loading">読込中…</p>
		{/if}
	</div>
	<button class="close" onclick={onClose} aria-label="閉じる">✕ 閉じる</button>
</div>

<style>
	.overlay {
		position: fixed;
		inset: 0;
		background: rgb(0 0 0 / 0.75);
		z-index: 90;
		display: grid;
		place-items: center;
		grid-template-rows: 1fr auto;
		padding: 1rem;
		gap: 0.75rem;
	}
	.frame {
		max-width: 100%;
		max-height: 100%;
		overflow: auto;
		display: grid;
		place-items: center;
	}
	img {
		max-width: 90vw;
		max-height: 80vh;
		object-fit: contain;
		background: #fff;
		box-shadow: var(--shadow);
	}
	.loading {
		color: #fff;
	}
	.close {
		justify-self: center;
	}
</style>
