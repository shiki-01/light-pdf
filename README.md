# light-pdf

PDF・画像をブラウザ内で結合・軽量化するクライアントサイド完結型 Web サービス。
ファイルは一切サーバーに送信されない。要件定義は [REQUIREMENTS.md](./REQUIREMENTS.md) を参照。

- 公開先: https://light-pdf.pages.dev （Cloudflare Pages）

## 開発

```sh
npm install
npm run dev      # 開発サーバー
npm run check    # svelte-check（型チェック）
npm run build    # 静的ビルド（build/ に出力）
npm run preview  # ビルド結果のプレビュー
```

## デプロイ（Cloudflare Pages）

GitHub リポジトリ連携で以下を設定する。

- ビルドコマンド: `npm run build`
- 出力ディレクトリ: `build`

## アーキテクチャ

| 層 | 実装 |
|---|---|
| UI | SvelteKit（adapter-static / SSR なし・全ページプリレンダリング） |
| PDF 読み込み・レンダリング | pdf.js（サムネイル、ラスタライズ、暗号化 PDF の解除読み込み） |
| PDF 構造操作 | pdf-lib（ページコピー、回転、メタデータ削除、オブジェクトストリーム保存） |
| 画像処理 | Canvas / OffscreenCanvas + toBlob / convertToBlob |
| 並列化 | Web Worker（`builder.worker.ts` で pdf-lib 処理を実行） |

### 処理の流れ（`src/lib/pdf/process.ts`）

1. **フェーズ 1（メインスレッド）**: ラスタライズ対象の PDF ページを pdf.js で Canvas に描画し、
   JPEG / PNG で試し圧縮して小さい方を採用。画像ファイルは必要に応じて縮小・再エンコード。
2. **フェーズ 2（Web Worker）**: pdf-lib で新規ドキュメントに構造保持ページをコピー
   （未使用オブジェクトの GC を兼ねる）、埋め込み JPEG（DCTDecode）を縮小・再エンコード、
   Info 辞書・XMP メタデータを削除し、オブジェクトストリーム有効で保存（PDF 1.7）。

対応外の埋め込み画像（Predictor 付き Flate、CMYK/Indexed、SMask 付き等）は壊さないため
無変換で残す（要件 8.1 の方針）。暗号化 PDF は pdf-lib で構造操作できないため
ラスタライズモードに固定される。

### 実装済み機能

- 入力: ドラッグ&ドロップ / ファイル選択 / クリップボード貼り付け（PDF・JPEG・PNG・WebP・GIF）
- EXIF Orientation 反映、破損・暗号化 PDF のファイル単位スキップ（パスワード入力対応）
- プリセット（最軽量 / バランス / 高品質）+ 詳細設定（折りたたみ、localStorage 保存）
- 構造保持 / ラスタライズの 2 モード + ページ単位のモード上書き
- ページ編集: 並べ替え（D&D / ボタン / Ctrl+矢印）、90° 回転、削除、複数選択、拡大プレビュー
- 進捗表示・キャンセル、削減率表示、Web Share API 共有
- ダークモード、レスポンシブ、PWA（Service Worker によるオフライン動作）

### 未実装・今後の課題

- HEIC 入力（libheif 系 WASM の遅延ロード。現状はエラー表示でスキップ）
- ラスタライズ描画のメインスレッド実行を Worker 化（現状は pdf.js 自身の Worker + 逐次 yield で軽減）
- 重複オブジェクトの統合（同一画像・フォントのハッシュ比較）
- FlateDecode + SMask（透過）画像の再圧縮（スパイクでは成立確認済み。未実装）
- 文字中心ページの JPEG 品質自動引き上げ
- 軽量化前後のプレビュー比較、ページ範囲抽出、白紙ページ検出、ZIP 出力（バックログ）
- iOS Safari 実機での動作確認（要件 8.3 のマイルストーン）
