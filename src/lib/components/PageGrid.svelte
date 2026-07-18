<script lang="ts">
	import type { Mode, PageItem, Rotation } from '../types';

	let {
		pages = $bindable(),
		selected,
		isEncrypted,
		onPreview
	}: {
		pages: PageItem[];
		selected: Set<string>;
		isEncrypted: (fileId: string) => boolean;
		onPreview: (item: PageItem) => void;
	} = $props();

	let selectMode = $state(false);
	let dragId: string | null = null;
	let lastClickedIndex = -1;
	let rangeText = $state('');
	let rangeError = $state<string | null>(null);

	const selectedCount = $derived(pages.filter((p) => selected.has(p.id)).length);
	const blankCount = $derived(pages.filter((p) => p.isBlank).length);

	/**
	 * ページ範囲指定（例: "1-3,5,8-"）を現在の表示順の 0 始まり index 集合に変換する。
	 * 不正な入力は null を返す。
	 */
	function parseRange(text: string, max: number): Set<number> | null {
		const out = new Set<number>();
		const parts = text.split(/[,、\s]+/).filter((s) => s.length > 0);
		if (parts.length === 0) return null;
		for (const part of parts) {
			const m = /^(\d*)-(\d*)$|^(\d+)$/.exec(part);
			if (!m) return null;
			if (m[3] !== undefined) {
				const n = Number(m[3]);
				if (n < 1 || n > max) return null;
				out.add(n - 1);
				continue;
			}
			if (m[1] === '' && m[2] === '') return null;
			const from = m[1] === '' ? 1 : Number(m[1]);
			const to = m[2] === '' ? max : Number(m[2]);
			if (from < 1 || to > max || from > to) return null;
			for (let i = from; i <= to; i++) out.add(i - 1);
		}
		return out;
	}

	/** 範囲指定でページを選択する（抽出は「選択以外を削除」と組み合わせる） */
	function selectRange() {
		const idxs = parseRange(rangeText, pages.length);
		if (!idxs) {
			rangeError = `1〜${pages.length} の範囲で「1-3,5」のように指定してください`;
			return;
		}
		rangeError = null;
		selected.clear();
		for (const i of idxs) selected.add(pages[i].id);
	}

	function selectBlanks() {
		for (const p of pages) if (p.isBlank) selected.add(p.id);
	}

	/** 選択したページだけを残す（ページ範囲抽出） */
	function keepSelectedOnly() {
		pages = pages.filter((p) => selected.has(p.id));
		selected.clear();
	}

	function toggleSelect(id: string) {
		if (selected.has(id)) selected.delete(id);
		else selected.add(id);
	}

	function handleCardClick(e: MouseEvent, item: PageItem, index: number) {
		if (e.ctrlKey || e.metaKey) {
			toggleSelect(item.id);
			lastClickedIndex = index;
			return;
		}
		if (e.shiftKey && lastClickedIndex >= 0) {
			const [a, b] = [Math.min(lastClickedIndex, index), Math.max(lastClickedIndex, index)];
			for (let i = a; i <= b; i++) selected.add(pages[i].id);
			return;
		}
		if (selectMode) {
			toggleSelect(item.id);
			lastClickedIndex = index;
			return;
		}
		lastClickedIndex = index;
		onPreview(item);
	}

	function rotate(item: PageItem) {
		item.rotation = (((item.rotation + 90) % 360) as Rotation);
	}

	function remove(id: string) {
		const i = pages.findIndex((p) => p.id === id);
		if (i >= 0) pages.splice(i, 1);
		selected.delete(id);
	}

	function rotateSelected() {
		for (const p of pages) if (selected.has(p.id)) rotate(p);
	}

	function removeSelected() {
		pages = pages.filter((p) => !selected.has(p.id));
		selected.clear();
	}

	/** 選択ページを前後に 1 つ移動（キーボード・ボタン共通） */
	function moveSelected(dir: -1 | 1) {
		const idxs = pages
			.map((p, i) => (selected.has(p.id) ? i : -1))
			.filter((i) => i >= 0);
		if (idxs.length === 0) return;
		if (dir === -1) {
			for (const i of idxs) {
				if (i === 0 || selected.has(pages[i - 1].id)) continue;
				[pages[i - 1], pages[i]] = [pages[i], pages[i - 1]];
			}
		} else {
			for (const i of [...idxs].reverse()) {
				if (i === pages.length - 1 || selected.has(pages[i + 1].id)) continue;
				[pages[i + 1], pages[i]] = [pages[i], pages[i + 1]];
			}
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if ((e.ctrlKey || e.metaKey) && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
			e.preventDefault();
			moveSelected(e.key === 'ArrowLeft' ? -1 : 1);
		}
	}

	function handleDrop(targetId: string) {
		if (dragId == null || dragId === targetId) return;
		const from = pages.findIndex((p) => p.id === dragId);
		const to = pages.findIndex((p) => p.id === targetId);
		if (from < 0 || to < 0) return;
		const [moved] = pages.splice(from, 1);
		pages.splice(to, 0, moved);
		dragId = null;
	}

	function setMode(item: PageItem, value: string) {
		item.modeOverride = value === '' ? null : (value as Mode);
	}
</script>

<div class="toolbar">
	<span class="info">{pages.length} ページ</span>
	<button
		class:active={selectMode}
		aria-pressed={selectMode}
		onclick={() => (selectMode = !selectMode)}
	>
		{selectMode ? '選択モード中' : '選択モード'}
	</button>
	{#if blankCount > 0}
		<button onclick={selectBlanks}>白紙ページを選択（{blankCount}）</button>
	{/if}
	{#if selectedCount > 0}
		<span class="info">{selectedCount} 件選択</span>
		<button onclick={() => moveSelected(-1)}>← 前へ</button>
		<button onclick={() => moveSelected(1)}>後ろへ →</button>
		<button onclick={rotateSelected}>回転</button>
		<button class="danger" onclick={removeSelected}>削除</button>
		<button class="danger" onclick={keepSelectedOnly}>選択以外を削除</button>
		<button onclick={() => selected.clear()}>選択解除</button>
	{/if}
</div>

<div class="range-row">
	<label class="range-label" for="page-range">ページ範囲</label>
	<input
		id="page-range"
		class="range-input"
		type="text"
		placeholder="例: 1-3,5"
		bind:value={rangeText}
		onkeydown={(e) => {
			if (e.key === 'Enter') selectRange();
		}}
	/>
	<button onclick={selectRange} disabled={rangeText.trim() === ''}>範囲を選択</button>
	{#if rangeError}
		<span class="range-error" role="alert">{rangeError}</span>
	{/if}
</div>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<ul class="grid" onkeydown={handleKeydown}>
	{#each pages as item, index (item.id)}
		<li
			class="card"
			class:selected={selected.has(item.id)}
			draggable="true"
			ondragstart={() => (dragId = item.id)}
			ondragover={(e) => e.preventDefault()}
			ondrop={(e) => {
				e.preventDefault();
				handleDrop(item.id);
			}}
		>
			<div class="thumb-wrap">
				<button
					class="thumb-btn"
					onclick={(e) => handleCardClick(e, item, index)}
					aria-label="{item.label} を拡大表示"
				>
					{#if item.thumbUrl}
						<img
							src={item.thumbUrl}
							alt={item.label}
							style:transform="rotate({item.rotation}deg)"
						/>
					{:else}
						<span class="loading">読込中…</span>
					{/if}
				</button>
				<input
					class="check"
					type="checkbox"
					checked={selected.has(item.id)}
					onchange={() => toggleSelect(item.id)}
					aria-label="{item.label} を選択"
				/>
				<div class="actions">
					<button class="mini" onclick={() => rotate(item)} aria-label="90度回転">⟳</button>
					<button class="mini danger" onclick={() => remove(item.id)} aria-label="削除">✕</button>
				</div>
			</div>
			<p class="label" title={item.label}>
				{index + 1}. {item.label}
				{#if item.isBlank}<span class="blank-badge">白紙?</span>{/if}
			</p>
			{#if item.kind === 'pdf'}
				{#if isEncrypted(item.fileId)}
					<p class="mode-note">ラスタライズ固定（暗号化 PDF）</p>
				{:else}
					<select
						class="mode"
						value={item.modeOverride ?? ''}
						onchange={(e) => setMode(item, e.currentTarget.value)}
						aria-label="このページのモード"
					>
						<option value="">モード: 全体設定に従う</option>
						<option value="structure">モード: 構造保持</option>
						<option value="rasterize">モード: ラスタライズ</option>
					</select>
				{/if}
			{/if}
		</li>
	{/each}
</ul>

<style>
	.toolbar {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
		margin-bottom: 0.2rem;
	}
	.toolbar .info {
		color: var(--text-dim);
		font-size: 0.9rem;
	}
	.toolbar button.active {
		border-color: var(--accent);
		color: var(--accent);
	}
	.grid {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
		gap: 0.75rem;
	}
	.card {
		background: var(--surface);
		border: 2px solid var(--border);
		border-radius: var(--radius);
		padding: 0.5rem;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}
	.card.selected {
		border-color: var(--accent);
	}
	.thumb-wrap {
		position: relative;
	}
	.thumb-btn {
		display: block;
		width: 100%;
		aspect-ratio: 3 / 4;
		padding: 0;
		border: none;
		background: var(--surface-2);
		border-radius: 6px;
		overflow: hidden;
	}
	.thumb-btn img {
		width: 100%;
		height: 100%;
		object-fit: contain;
	}
	.loading {
		color: var(--text-dim);
		font-size: 0.8rem;
	}
	.check {
		position: absolute;
		top: 6px;
		left: 6px;
		width: 1.4rem;
		height: 1.4rem;
	}
	.actions {
		position: absolute;
		top: 4px;
		right: 4px;
		display: flex;
		gap: 4px;
	}
	.mini {
		min-height: 36px;
		min-width: 36px;
		padding: 0;
		border-radius: 8px;
		background: var(--surface);
		box-shadow: var(--shadow);
	}
	/* ホバーが使えるデバイスのみ、ホバー時に表示（要件 3.3: ホバー依存禁止のため非ホバー環境では常設） */
	@media (hover: hover) {
		.actions {
			opacity: 0;
			transition: opacity 0.15s;
		}
		.card:hover .actions,
		.card:focus-within .actions {
			opacity: 1;
		}
	}
	.label {
		margin: 0;
		font-size: 0.75rem;
		color: var(--text-dim);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.blank-badge {
		display: inline-block;
		background: var(--danger);
		color: #fff;
		border-radius: 4px;
		padding: 0 0.3rem;
		font-size: 0.65rem;
		font-weight: 700;
		vertical-align: 1px;
	}
	.range-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
		margin-bottom: 0.5rem;
	}
	.range-label {
		font-size: 0.85rem;
		color: var(--text-dim);
	}
	.range-input {
		width: 10rem;
		min-height: 36px;
	}
	.range-error {
		color: var(--danger);
		font-size: 0.8rem;
	}
	.mode {
		font-size: 0.75rem;
		min-height: 36px;
		padding: 0.2rem 0.3rem;
	}
	.mode-note {
		margin: 0;
		font-size: 0.7rem;
		color: var(--danger);
	}
</style>
