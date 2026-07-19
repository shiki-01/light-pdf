export type Mode = 'structure' | 'rasterize';
export type RasterFormat = 'auto' | 'jpeg' | 'png';
export type PresetId = 'lightest' | 'balanced' | 'quality' | 'custom';
export type Rotation = 0 | 90 | 180 | 270;

export interface Settings {
	preset: PresetId;
	/** 長辺最大 px。null = 縮小しない */
	maxLongSide: number | null;
	/** 10〜100 */
	jpegQuality: number;
	mode: Mode;
	rasterFormat: RasterFormat;
	grayscale: boolean;
	removeMetadata: boolean;
	removeAnnotations: boolean;
	/** 全ページの横幅を最頻の横幅に合わせて拡縮する */
	unifyWidth: boolean;
	/** ページごとに個別 PDF として ZIP 出力する（要件 3.4 オプション） */
	splitZip: boolean;
	/** '' = 自動（最初のファイル名 + _light.pdf） */
	outputName: string;
}

export interface PageItem {
	id: string;
	kind: 'pdf' | 'image';
	fileId: string;
	/** 表示用: ファイル名 p.n */
	label: string;
	/** PDF 内の 0 始まりページ番号（画像は 0） */
	pageIndex: number;
	/** ユーザーが追加した回転（表示・出力に反映） */
	rotation: Rotation;
	thumbUrl: string | null;
	/** サムネイル解析による白紙ページ判定（削除候補の提示に使用） */
	isBlank: boolean;
	modeOverride: Mode | null;
	/** ページの表示サイズ（pt、PDF 固有の回転適用後・ユーザー回転適用前） */
	widthPts: number;
	heightPts: number;
}

export interface LoadedFile {
	id: string;
	name: string;
	kind: 'pdf' | 'image';
	bytes: Uint8Array;
	size: number;
	/** パスワードで開いた PDF（構造保持不可 → ラスタライズ強制） */
	encrypted: boolean;
	pageCount: number;
}

export interface LoadError {
	name: string;
	message: string;
}

export interface ProgressInfo {
	label: string;
	done: number;
	total: number;
}

/* Worker とのメッセージ */

export type BuildItem =
	| {
			kind: 'copy';
			fileId: string;
			pageIndex: number;
			rotation: Rotation;
	  }
	| {
			kind: 'image';
			bytes: Uint8Array;
			format: 'jpeg' | 'png';
			/** ページサイズ（pt） */
			widthPts: number;
			heightPts: number;
	  };

export interface BuildRequest {
	files: { id: string; bytes: Uint8Array }[];
	items: BuildItem[];
	settings: Settings;
	/** 横幅を揃える場合の目標横幅（pt）。null = 揃えない */
	unifyWidthPts: number | null;
}

export type BuildResponse =
	| { type: 'progress'; label: string; done: number; total: number }
	| { type: 'done'; bytes: Uint8Array }
	| { type: 'error'; message: string };

/* ラスタライズ Worker とのメッセージ */

/** pdf.js が実行時に読み込むアセットの URL（Worker 内解決用に絶対 URL で渡す） */
export interface PdfjsAssetParams {
	cMapUrl: string;
	cMapPacked: boolean;
	standardFontDataUrl: string;
	wasmUrl: string;
	iccUrl: string;
}

export interface RasterTask {
	/** 呼び出し元の並び上の位置（結果の挿入先） */
	index: number;
	fileId: string;
	pageIndex: number;
	rotation: Rotation;
}

export interface RasterRequest {
	files: { id: string; bytes: Uint8Array }[];
	tasks: RasterTask[];
	settings: Settings;
	assetParams: PdfjsAssetParams;
}

export type RasterResponse =
	| {
			type: 'page';
			index: number;
			bytes: Uint8Array;
			format: 'jpeg' | 'png';
			/** ページの表示サイズ（pt、回転適用後） */
			widthPts: number;
			heightPts: number;
	  }
	| { type: 'done' }
	| { type: 'error'; message: string };
