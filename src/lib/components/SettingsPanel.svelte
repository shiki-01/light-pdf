<script lang="ts">
	import type { Settings } from '../types';
	import { DEFAULT_SETTINGS } from '../settings';

	let {
		settings = $bindable()
	}: {
		settings: Settings;
	} = $props();

	let noResize = $derived(settings.maxLongSide == null);

	function toggleResize(e: Event) {
		const checked = (e.currentTarget as HTMLInputElement).checked;
		settings.maxLongSide = checked ? null : DEFAULT_SETTINGS.maxLongSide;
	}

	function resetAll() {
		Object.assign(settings, DEFAULT_SETTINGS);
	}
</script>

<details class="advanced">
	<summary>詳細設定</summary>
	<div class="grid">
		<label class="row">
			<span>モード</span>
			<select bind:value={settings.mode}>
				<option value="structure">構造保持（テキストを維持）</option>
				<option value="rasterize">ラスタライズ（ページを画像化）</option>
			</select>
		</label>
		{#if settings.mode === 'rasterize'}
			<p class="warn">
				ラスタライズではテキストの選択・検索ができなくなります。
			</p>
			<label class="row">
				<span>ラスタライズ時フォーマット</span>
				<select bind:value={settings.rasterFormat}>
					<option value="auto">自動（小さい方を採用）</option>
					<option value="jpeg">JPEG 固定</option>
					<option value="png">PNG 固定（文字がくっきり）</option>
				</select>
			</label>
		{/if}
		<label class="row">
			<span>縮小しない</span>
			<input type="checkbox" checked={noResize} onchange={toggleResize} />
		</label>
		{#if !noResize}
			<label class="row">
				<span>長辺最大サイズ: {settings.maxLongSide}px</span>
				<input
					type="range"
					min="480"
					max="4096"
					step="16"
					bind:value={settings.maxLongSide}
				/>
			</label>
		{/if}
		<label class="row">
			<span>JPEG 品質: {settings.jpegQuality}</span>
			<input type="range" min="10" max="100" step="1" bind:value={settings.jpegQuality} />
		</label>
		<label class="row">
			<span>グレースケール変換</span>
			<input type="checkbox" bind:checked={settings.grayscale} />
		</label>
		<label class="row">
			<span>メタデータ削除</span>
			<input type="checkbox" bind:checked={settings.removeMetadata} />
		</label>
		<label class="row">
			<span>注釈・タグ構造の削除</span>
			<input type="checkbox" bind:checked={settings.removeAnnotations} />
		</label>
		<label class="row">
			<span>出力ファイル名</span>
			<input
				type="text"
				placeholder="（自動: 最初のファイル名 + _light.pdf）"
				bind:value={settings.outputName}
			/>
		</label>
		<div class="row">
			<button onclick={resetAll}>デフォルトに戻す</button>
		</div>
	</div>
</details>

<style>
	.advanced {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		margin-top: 20px;
	}
	summary {
		padding: 0.75rem 1rem;
		cursor: pointer;
		font-weight: 600;
		min-height: 44px;
		display: flex;
		align-items: center;
	}
	.grid {
		padding: 0.5rem 1rem 1rem;
		display: grid;
		gap: 0.75rem;
	}
	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
	}
	.row > span {
		font-size: 0.95rem;
	}
	.row select,
	.row input[type='text'] {
		flex: 1;
		min-width: 200px;
		max-width: 320px;
	}
	.row input[type='range'] {
		flex: 1;
		min-width: 160px;
		max-width: 320px;
	}
	.warn {
		margin: 0;
		font-size: 0.85rem;
		color: var(--danger);
	}
</style>
