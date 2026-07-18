<script lang="ts">
  import { SvelteMap, SvelteSet } from "svelte/reactivity";
  import DropZone from "$lib/components/DropZone.svelte";
  import SettingsPanel from "$lib/components/SettingsPanel.svelte";
  import PageGrid from "$lib/components/PageGrid.svelte";
  import ProgressOverlay from "$lib/components/ProgressOverlay.svelte";
  import PreviewModal from "$lib/components/PreviewModal.svelte";
  import HelpModal from "$lib/components/HelpModal.svelte";
  import ResultPanel, {
    type ResultData,
  } from "$lib/components/ResultPanel.svelte";
  import type {
    LoadedFile,
    LoadError,
    PageItem,
    PresetId,
    ProgressInfo,
  } from "$lib/types";
  import {
    DEFAULT_SETTINGS,
    PRESET_LABELS,
    PRESET_VALUES,
    detectPreset,
    loadSettings,
    saveSettings,
  } from "$lib/settings";
  import { loadFiles } from "$lib/pdf/loader";
  import { CancelledError, processAll } from "$lib/pdf/process";

  const RECOMMENDED_INPUT_LIMIT = 200 * 1024 * 1024;

  const files = new SvelteMap<string, LoadedFile>();
  let pages = $state<PageItem[]>([]);
  const selected = new SvelteSet<string>();
  let settings = $state(loadSettings());
  let errors = $state<LoadError[]>([]);
  let loading = $state(false);
  let processing = $state<ProgressInfo | null>(null);
  let result = $state<ResultData | null>(null);
  let previewItem = $state<PageItem | null>(null);
  let processError = $state<string | null>(null);
  let abortController: AbortController | null = null;
  let lastResultUrl: string | null = null;

  const totalInputSize = $derived.by(() => {
    const ids = new Set(pages.map((p) => p.fileId));
    let sum = 0;
    for (const id of ids) sum += files.get(id)?.size ?? 0;
    return sum;
  });

  const overLimit = $derived(totalInputSize > RECOMMENDED_INPUT_LIMIT);

  // 設定変更を localStorage に保存し、プリセット表示を追従させる
  $effect(() => {
    const detected = detectPreset(settings);
    if (settings.preset !== detected) settings.preset = detected;
    saveSettings(settings);
  });

  function applyPreset(id: Exclude<PresetId, "custom">) {
    // unifyWidth と outputName はプリセットとは独立した設定のため維持する
    Object.assign(settings, DEFAULT_SETTINGS, PRESET_VALUES[id], {
      outputName: settings.outputName,
      unifyWidth: settings.unifyWidth,
    });
  }

  async function askPassword(
    fileName: string,
    retry: boolean,
  ): Promise<string | null> {
    const msg = retry
      ? `パスワードが違います。「${fileName}」のパスワードを再入力してください`
      : `「${fileName}」は暗号化されています。パスワードを入力してください`;
    return window.prompt(msg);
  }

  async function addFiles(list: File[]) {
    loading = true;
    result = null;
    try {
      const r = await loadFiles(list, askPassword, {
        onPage: (page) => {
          pages.push(page);
        },
        onThumb: (pageId, url) => {
          const item = pages.find((p) => p.id === pageId);
          if (item) item.thumbUrl = url;
        },
      });
      for (const f of r.files) files.set(f.id, f);
      if (r.errors.length > 0) errors.push(...r.errors);
    } finally {
      loading = false;
    }
  }

  function handlePaste(e: ClipboardEvent) {
    const list = [...(e.clipboardData?.files ?? [])];
    if (list.length > 0) {
      e.preventDefault();
      void addFiles(list);
    }
  }

  // ページ全体でファイルドロップを受け付ける。
  // dragenter/dragleave は子要素間の移動でも発火するためカウンタで管理する
  let dragOver = $state(false);
  let dragDepth = 0;

  const hasFiles = (e: DragEvent) =>
    (e.dataTransfer?.types ?? []).includes("Files");

  function handleDragEnter(e: DragEvent) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth++;
    dragOver = true;
  }

  function handleDragOver(e: DragEvent) {
    if (!hasFiles(e)) return;
    e.preventDefault();
  }

  function handleDragLeave(e: DragEvent) {
    if (!hasFiles(e)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) dragOver = false;
  }

  function handleDrop(e: DragEvent) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    dragOver = false;
    const list = [...(e.dataTransfer?.files ?? [])];
    if (list.length > 0) void addFiles(list);
  }

  function defaultOutputName(): string {
    const first = pages[0] ? files.get(pages[0].fileId) : undefined;
    const base = (first?.name ?? "output").replace(/\.[^.]+$/, "");
    return `${base}_light.pdf`;
  }

  async function run() {
    processError = null;
    result = null;
    abortController = new AbortController();
    processing = { label: "準備中", done: 0, total: pages.length };
    try {
      const bytes = await processAll(
        pages,
        files,
        settings,
        (p) => {
          processing = p;
        },
        abortController.signal,
      );
      const fileName = settings.outputName.trim() || defaultOutputName();
      const file = new File([bytes as BlobPart], fileName, {
        type: "application/pdf",
      });
      if (lastResultUrl != null) URL.revokeObjectURL(lastResultUrl);
      lastResultUrl = URL.createObjectURL(file);
      result = {
        url: lastResultUrl,
        fileName,
        inputSize: totalInputSize,
        outputSize: bytes.length,
        file,
      };
    } catch (e) {
      if (!(e instanceof CancelledError)) {
        processError = e instanceof Error ? e.message : "処理に失敗しました";
      }
    } finally {
      processing = null;
      abortController = null;
    }
  }

  function cancel() {
    abortController?.abort();
  }

  function clearAll() {
    pages = [];
    selected.clear();
    files.clear();
    errors = [];
    result = null;
  }
</script>

<svelte:window
  onpaste={handlePaste}
  ondragenter={handleDragEnter}
  ondragover={handleDragOver}
  ondragleave={handleDragLeave}
  ondrop={handleDrop}
/>

{#if dragOver}
  <div class="drop-overlay" aria-hidden="true">
    <p>ドロップしてファイルを追加</p>
  </div>
{/if}

<main>
  <header>
    <h1>light-pdf</h1>
    <p class="tagline">
      PDF・画像をブラウザ内で結合・軽量化。<strong
        >ファイルはサーバーに送信されません。</strong
      >
    </p>
  </header>

  {#if pages.length === 0}
    <DropZone onFiles={(f) => void addFiles(f)} />
  {:else}
    <DropZone compact onFiles={(f) => void addFiles(f)} />

    <section class="presets" aria-label="プリセット">
      {#each Object.entries(PRESET_LABELS) as [id, label] (id)}
        <button
          class="preset"
          class:active={settings.preset === id}
          onclick={() => applyPreset(id as Exclude<PresetId, "custom">)}
        >
          <span class="preset-name">{label.name}</span>
          <span class="preset-desc">{label.desc}</span>
        </button>
      {/each}
      {#if settings.preset === "custom"}
        <span class="custom-badge">カスタム設定</span>
      {/if}
    </section>

	<label class="unify-row">
        <input type="checkbox" bind:checked={settings.unifyWidth} />
        <span>
          横幅を揃える
          <small>最も多いページの横幅に合わせて全ページを拡縮します</small>
        </span>
      </label>

    {#if overLimit}
      <p class="warn">
        入力の合計が推奨上限（200MB）を超えています。端末によっては処理に失敗する場合があります。
      </p>
    {/if}

    {#if result}
      <ResultPanel {result} onBack={() => (result = null)} />
    {/if}

    {#if processError}
      <p class="error" role="alert">{processError}</p>
    {/if}

    <div class="run-row">
      <button
        class="primary run"
        onclick={() => void run()}
        disabled={pages.length === 0 || loading}
      >
        軽量化する
      </button>
      <button onclick={clearAll}>すべてクリア</button>
    </div>

    <PageGrid
      bind:pages
      {selected}
      isEncrypted={(fileId) => files.get(fileId)?.encrypted ?? false}
      onPreview={(item) => (previewItem = item)}
    />

    <SettingsPanel bind:settings />
  {/if}

  {#if errors.length > 0}
    <section class="errors" aria-label="読み込みエラー">
      {#each errors as err, i (i)}
        <p class="error">{err.name}: {err.message}</p>
      {/each}
      <button onclick={() => (errors = [])}>エラーを消す</button>
    </section>
  {/if}

  {#if loading}
    <p class="loading" aria-live="polite">読み込み中…</p>
  {/if}

  <footer>
    <p>
      すべての処理はお使いの端末内で完結します。ページを離れるとデータは破棄されます。
    </p>
  </footer>
</main>

<HelpModal />

{#if processing}
  <ProgressOverlay progress={processing} onCancel={cancel} />
{/if}

{#if previewItem}
  <PreviewModal
    item={previewItem}
    imageBytes={previewItem.kind === "image"
      ? (files.get(previewItem.fileId)?.bytes ?? null)
      : null}
    onClose={() => (previewItem = null)}
  />
{/if}

<style>
  .drop-overlay {
    position: fixed;
    inset: 0;
    z-index: 110;
    background: color-mix(in srgb, var(--accent) 15%, transparent);
    border: 3px dashed var(--accent);
    display: grid;
    place-items: center;
    pointer-events: none;
  }
  .drop-overlay p {
    background: var(--surface);
    color: var(--accent);
    font-size: 1.2rem;
    font-weight: 700;
    padding: 0.75rem 1.5rem;
    border-radius: var(--radius);
    box-shadow: var(--shadow);
    margin: 0;
  }
  main {
    max-width: 960px;
    margin: 0 auto;
    padding: 1rem;
    display: grid;
    gap: 1rem;
  }
  header {
    text-align: center;
    padding: 0.5rem 0;
  }
  h1 {
    margin: 0;
    font-size: 1.6rem;
    letter-spacing: 0.02em;
  }
  .tagline {
    margin: 0.25rem 0 0;
    color: var(--text-dim);
    font-size: 0.9rem;
  }
  .tagline strong {
    color: var(--text);
  }
  .presets {
    display: flex;
    gap: 0.75rem;
    flex-wrap: wrap;
    align-items: center;
  }
  .preset {
    flex: 1;
    min-width: 140px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.15rem;
    padding: 0.75rem;
  }
  .preset.active {
    border-color: var(--accent);
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  .preset-name {
    font-weight: 700;
  }
  .preset-desc {
    font-size: 0.75rem;
    color: var(--text-dim);
  }
  .custom-badge {
    font-size: 0.85rem;
    color: var(--accent);
    font-weight: 600;
  }
  .unify-row {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.6rem 1rem;
    height: 100%;
    max-height: 75px;
    cursor: pointer;
  }
  .unify-row span {
    font-weight: 600;
  }
  .unify-row small {
    display: block;
    font-weight: 400;
    color: var(--text-dim);
    font-size: 0.75rem;
  }
  .run-row {
    display: flex;
    gap: 0.75rem;
    flex-wrap: wrap;
	margin-bottom: 20px;
  }
  .run {
    flex: 1;
    min-width: 220px;
    font-size: 1.05rem;
    padding: 0.75rem 1.5rem;
  }
  .warn {
    margin: 0;
    color: var(--danger);
    font-size: 0.9rem;
  }
  .error {
    margin: 0.25rem 0;
    color: var(--danger);
    font-size: 0.9rem;
  }
  .errors {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.75rem 1rem;
  }
  .loading {
    color: var(--text-dim);
    text-align: center;
    margin: 0;
  }
  footer {
    text-align: center;
    color: var(--text-dim);
    font-size: 0.8rem;
    padding: 1rem 0 2rem;
  }
  footer p {
    margin: 0;
  }
</style>
