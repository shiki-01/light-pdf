<script module lang="ts">
	import type { PageItem } from '../types';

	export interface ResultData {
		url: string;
		fileName: string;
		inputSize: number;
		outputSize: number;
		file: File;
		/** 出力バイト列（前後比較プレビューで使用） */
		bytes: Uint8Array;
		/** 処理時点のページ一覧（出力とページ順が対応） */
		pages: PageItem[];
		/** ZIP 出力（前後比較の対象外） */
		isZip: boolean;
	}

	function fmtBytes(n: number): string {
		if (n < 1024) return `${n} B`;
		if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
		return `${(n / 1024 / 1024).toFixed(2)} MB`;
	}
</script>

<script lang="ts">
	let {
		result,
		onBack,
		onCompare
	}: {
		result: ResultData;
		onBack: () => void;
		onCompare: () => void;
	} = $props();

	const reduction = $derived(
		result.inputSize > 0
			? Math.round((1 - result.outputSize / result.inputSize) * 1000) / 10
			: 0
	);

	const canShare = $derived(
		typeof navigator !== 'undefined' &&
			'canShare' in navigator &&
			navigator.canShare({ files: [result.file] })
	);

	async function share() {
		try {
			await navigator.share({ files: [result.file] });
		} catch {
			/* ユーザーキャンセル等は無視 */
		}
	}
</script>

<section class="result" aria-live="polite">
	<h2>完了</h2>
	<p class="sizes">
		{fmtBytes(result.inputSize)} → <strong>{fmtBytes(result.outputSize)}</strong>
		{#if reduction > 0}
			<span class="reduction">（{reduction}% 削減）</span>
		{:else}
			<span class="reduction none">（削減なし）</span>
		{/if}
	</p>
	<div class="buttons">
		<a class="download" href={result.url} download={result.fileName}>ダウンロード</a>
		{#if !result.isZip}
			<button onclick={onCompare}>前後を比較</button>
		{/if}
		{#if canShare}
			<button onclick={share}>共有</button>
		{/if}
		<button onclick={onBack}>編集に戻る</button>
	</div>
	<p class="name">{result.fileName}</p>
</section>

<style>
	.result {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 1.25rem 1.5rem;
		text-align: center;
	}
	h2 {
		margin: 0 0 0.5rem;
		font-size: 1.1rem;
	}
	.sizes {
		font-size: 1.15rem;
		margin: 0 0 1rem;
	}
	.reduction {
		color: var(--accent);
		font-weight: 600;
	}
	.reduction.none {
		color: var(--text-dim);
		font-weight: 400;
	}
	.buttons {
		display: flex;
		gap: 0.75rem;
		justify-content: center;
		flex-wrap: wrap;
	}
	.download {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		padding: 0.5rem 1.5rem;
		background: var(--accent);
		color: var(--accent-text);
		border-radius: var(--radius);
		text-decoration: none;
		font-weight: 600;
	}
	.name {
		margin: 0.75rem 0 0;
		color: var(--text-dim);
		font-size: 0.85rem;
		word-break: break-all;
	}
</style>
