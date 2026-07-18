<script lang="ts">
	let {
		onFiles,
		compact = false
	}: {
		onFiles: (files: File[]) => void;
		compact?: boolean;
	} = $props();

	let inputEl: HTMLInputElement;

	function handleChange() {
		const files = [...(inputEl.files ?? [])];
		if (files.length > 0) onFiles(files);
		inputEl.value = '';
	}
</script>

<!-- ドロップの受け付けはページ全体（+page.svelte の svelte:window）で行う -->
<div
	class="dropzone"
	class:compact
	role="button"
	tabindex="0"
	aria-label="ファイルを選択"
	onclick={() => inputEl.click()}
	onkeydown={(e) => {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			inputEl.click();
		}
	}}
>
	<input
		bind:this={inputEl}
		type="file"
		multiple
		accept=".pdf,application/pdf,image/jpeg,image/png,image/webp,image/gif"
		onchange={handleChange}
		hidden
	/>
	{#if compact}
		<p class="main">＋ ファイルを追加</p>
	{:else}
		<p class="main">PDF・画像をページ内にドロップ</p>
		<p class="sub">またはタップしてファイルを選択（Ctrl+V での貼り付けも可）</p>
		<p class="sub">対応形式: PDF / JPEG / PNG / WebP / GIF / HEIC</p>
	{/if}
</div>

<style>
	.dropzone {
		border: 2px dashed var(--border);
		border-radius: var(--radius);
		background: var(--surface);
		padding: 3rem 1.5rem;
		margin-bottom: 20px;
		text-align: center;
		cursor: pointer;
		transition:
			border-color 0.15s,
			background 0.15s;
	}
	.dropzone.compact {
		padding: 1rem;
	}
	.dropzone:hover,
	.dropzone:focus-visible {
		border-color: var(--accent);
	}
	.main {
		margin: 0;
		font-size: 1.1rem;
		font-weight: 600;
	}
	.sub {
		margin: 0.4rem 0 0;
		color: var(--text-dim);
		font-size: 0.85rem;
	}
</style>
