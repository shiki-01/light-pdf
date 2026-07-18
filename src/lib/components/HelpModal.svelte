<script lang="ts">
	import { base } from '$app/paths';

	let open = $state(false);

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') open = false;
	}

	const steps = [
		{
			img: `${base}/help/01-add.png`,
			title: '1. ファイルを追加する',
			body: 'PDF・画像（JPEG / PNG / WebP / GIF / HEIC）をページ内のどこにでもドロップできます。枠をクリックしてファイルを選択するか、Ctrl+V での貼り付けも可能です。複数ファイルをまとめて追加でき、後から追加もできます。'
		},
		{
			img: `${base}/help/02-edit.png`,
			title: '2. プリセットを選び、ページを編集する',
			body: '「最軽量 / バランス / 高品質」から仕上がりを選びます（迷ったらバランスのまま）。ページはドラッグで並べ替え、各ページのボタンで回転・削除ができます。サムネイルをクリックすると拡大表示します。ページの横幅がばらばらの場合は「横幅を揃える」をオンにすると揃えられます。'
		},
		{
			img: `${base}/help/03-settings.png`,
			title: '3. 必要なら詳細設定を調整する',
			body: '画質や長辺サイズ、モード（構造保持 / ラスタライズ）などを個別に変更できます。構造保持はテキストの選択・検索を維持したまま軽量化し、ラスタライズはページを画像化するため複雑な PDF で効果が大きい方式です。設定は次回訪問時にも保存されます。'
		},
		{
			img: `${base}/help/04-result.png`,
			title: '4. 軽量化してダウンロードする',
			body: '「軽量化する」を押すと処理が始まり、完了すると削減率が表示されます。ダウンロードボタンで保存してください。処理はすべてお使いの端末内で行われ、ファイルがサーバーに送信されることはありません。'
		}
	];
</script>

<svelte:window onkeydown={handleKeydown} />

<button
	class="help-fab"
	onclick={() => (open = true)}
	aria-label="使い方を表示"
	title="使い方"
>
	？
</button>

{#if open}
	<!-- Escape キーでの閉じる操作は svelte:window で提供済み -->
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_interactive_supports_focus -->
	<div class="overlay" role="dialog" aria-modal="true" aria-label="使い方" onclick={() => (open = false)}>
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<article class="panel" onclick={(e) => e.stopPropagation()}>
			<header>
				<h2>使い方</h2>
				<button class="close" onclick={() => (open = false)} aria-label="閉じる">✕</button>
			</header>
			<div class="body">
				{#each steps as step (step.title)}
					<section class="step">
						<h3>{step.title}</h3>
						<img src={step.img} alt="{step.title}の画面例" loading="lazy" />
						<p>{step.body}</p>
					</section>
				{/each}
				<section class="step">
					<h3>補足</h3>
					<ul>
						<li>暗号化 PDF はパスワード入力で読み込めます（ラスタライズ固定になります）。</li>
						<li>複数選択は Ctrl / Shift + クリック、スマートフォンでは「選択モード」をオンにしてタップします。</li>
						<li>選択したページは「← 前へ / 後ろへ →」ボタンや Ctrl + 矢印キーでも移動できます。</li>
						<li>2 回目以降はオフラインでも利用できます。</li>
					</ul>
				</section>
			</div>
		</article>
	</div>
{/if}

<style>
	.help-fab {
		position: fixed;
		right: 1rem;
		bottom: 1rem;
		z-index: 80;
		width: 48px;
		height: 48px;
		min-height: 48px;
		padding: 0;
		border-radius: 50%;
		background: var(--accent);
		color: var(--accent-text);
		border-color: var(--accent);
		font-size: 1.2rem;
		font-weight: 700;
		box-shadow: var(--shadow);
	}
	.overlay {
		position: fixed;
		inset: 0;
		z-index: 120;
		background: rgb(0 0 0 / 0.5);
		display: grid;
		place-items: center;
		padding: 1rem;
	}
	.panel {
		background: var(--bg);
		border-radius: var(--radius);
		box-shadow: var(--shadow);
		width: min(680px, 100%);
		max-height: 90vh;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}
	.panel > header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.75rem 1rem;
		border-bottom: 1px solid var(--border);
		background: var(--surface);
	}
	.panel h2 {
		margin: 0;
		font-size: 1.1rem;
	}
	.close {
		min-height: 44px;
		min-width: 44px;
		padding: 0;
		border: none;
		background: none;
		font-size: 1.1rem;
	}
	.body {
		overflow-y: auto;
		padding: 1rem;
		display: grid;
		gap: 1.25rem;
	}
	.step h3 {
		margin: 0 0 0.5rem;
		font-size: 1rem;
	}
	.step img {
		width: 100%;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: #fff;
	}
	.step p {
		margin: 0.5rem 0 0;
		font-size: 0.9rem;
		color: var(--text-dim);
	}
	.step ul {
		margin: 0;
		padding-left: 1.2rem;
		font-size: 0.9rem;
		color: var(--text-dim);
	}
	.step li {
		margin-bottom: 0.25rem;
	}
</style>
