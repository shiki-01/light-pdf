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
| HEIC デコード | libheif 系 WASM（静的アセットとして配信、HEIC 投入時のみ遅延ロード） |
| 並列化 | Web Worker（`raster.worker.ts` でラスタライズ、`builder.worker.ts` で pdf-lib 処理） |

### 処理の流れ（`src/lib/pdf/process.ts`）

1. **フェーズ 1（ラスタライズ）**: 対象の PDF ページを pdf.js で Canvas に描画し、
   JPEG / PNG で試し圧縮して小さい方を採用。テキスト量の多いページは JPEG 品質を自動で
   引き上げる（+10、上限 95）。OffscreenCanvas 対応環境では `raster.worker.ts` で実行し、
   非対応環境・暗号化 PDF・Worker 失敗時はメインスレッドにフォールバックする。
   画像ファイルは必要に応じて縮小・再エンコード。
2. **フェーズ 2（`builder.worker.ts`）**: pdf-lib で新規ドキュメントに構造保持ページをコピー
   （未使用オブジェクトの GC を兼ねる）、重複オブジェクト（同一画像・フォント）をハッシュ比較で
   統合、埋め込み画像を縮小・再エンコード（DCTDecode、FlateDecode の RGB8/Gray8、
   SMask 付きは本体 JPEG + SMask Flate で再格納）、Info 辞書・XMP メタデータを削除し、
   オブジェクトストリーム有効で保存（PDF 1.7）。

対応外の埋め込み画像（Predictor 付き Flate、CMYK/Indexed/ICCBased、16bit 等）は壊さないため
無変換で残す（要件 8.1 の方針）。暗号化 PDF は pdf-lib で構造操作できないため
ラスタライズモードに固定される。

### 実装済み機能

- 入力: ドラッグ&ドロップ / ファイル選択 / クリップボード貼り付け（PDF・JPEG・PNG・WebP・GIF・HEIC）
- EXIF Orientation 反映、破損・暗号化 PDF のファイル単位スキップ（パスワード入力対応）
- プリセット（最軽量 / バランス / 高品質）+ 詳細設定（折りたたみ、localStorage 保存）
- 構造保持 / ラスタライズの 2 モード + ページ単位のモード上書き
- ページ編集: 並べ替え（D&D / ボタン / Ctrl+矢印）、90° 回転、削除、複数選択、拡大プレビュー
- ページ範囲指定（例: 1-3,5）での選択と「選択以外を削除」による抽出
- 白紙ページの検出（サムネイル解析）とバッジ表示・一括選択
- 軽量化前後のプレビュー比較（元 / 軽量化後をページ単位で切替）
- 重複オブジェクトの統合、FlateDecode + SMask（透過）画像の再圧縮
- 文字中心ページの JPEG 品質自動引き上げ（ラスタライズ時）
- ページごとの個別 PDF を ZIP 出力（詳細設定）
- 進捗表示・キャンセル、削減率表示、Web Share API 共有
- ダークモード、レスポンシブ、PWA（Service Worker によるオフライン動作）

### 未実装・今後の課題

- 埋め込み画像最適化の対応範囲拡大（Predictor 付き Flate、CMYK/Indexed/ICCBased、16bit 等。
  現状は無変換で残す）
- ページ番号の追記、目標サイズ指定（品質の自動探索）（バックログ）
- iOS Safari 実機での動作確認（要件 8.3 のマイルストーン。
  OffscreenCanvas 非対応環境はメインスレッドへのフォールバックで対応済みだが実機未確認）
