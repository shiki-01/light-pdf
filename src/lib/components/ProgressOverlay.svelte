<script lang="ts">
	import type { ProgressInfo } from '../types';

	let {
		progress,
		onCancel
	}: {
		progress: ProgressInfo;
		onCancel: () => void;
	} = $props();

	const pct = $derived(
		progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0
	);
</script>

<div class="overlay" role="dialog" aria-modal="true" aria-label="処理中">
	<div class="box">
		<p class="label">{progress.label}</p>
		<div class="bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
			<div class="fill" style="width: {pct}%"></div>
		</div>
		<p class="count">{progress.done} / {progress.total}</p>
		<button onclick={onCancel}>キャンセル</button>
	</div>
</div>

<style>
	.overlay {
		position: fixed;
		inset: 0;
		background: rgb(0 0 0 / 0.5);
		display: grid;
		place-items: center;
		z-index: 100;
	}
	.box {
		background: var(--surface);
		border-radius: var(--radius);
		box-shadow: var(--shadow);
		padding: 1.5rem 2rem;
		width: min(90vw, 360px);
		text-align: center;
	}
	.label {
		margin: 0 0 0.75rem;
		font-weight: 600;
	}
	.bar {
		height: 8px;
		background: var(--surface-2);
		border-radius: 4px;
		overflow: hidden;
	}
	.fill {
		height: 100%;
		background: var(--accent);
		transition: width 0.15s;
	}
	.count {
		color: var(--text-dim);
		margin: 0.5rem 0 1rem;
		font-variant-numeric: tabular-nums;
	}
</style>
