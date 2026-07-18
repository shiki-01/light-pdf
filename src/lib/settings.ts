import type { PresetId, Settings } from './types';

export const PRESET_VALUES: Record<
	Exclude<PresetId, 'custom'>,
	Pick<Settings, 'maxLongSide' | 'jpegQuality' | 'removeMetadata'>
> = {
	lightest: { maxLongSide: 1280, jpegQuality: 60, removeMetadata: true },
	balanced: { maxLongSide: 1920, jpegQuality: 80, removeMetadata: true },
	quality: { maxLongSide: 2560, jpegQuality: 90, removeMetadata: true }
};

export const PRESET_LABELS: Record<Exclude<PresetId, 'custom'>, { name: string; desc: string }> = {
	lightest: { name: '最軽量', desc: '長辺 1280px / 品質 60' },
	balanced: { name: 'バランス', desc: '長辺 1920px / 品質 80' },
	quality: { name: '高品質', desc: '長辺 2560px / 品質 90' }
};

export const DEFAULT_SETTINGS: Settings = {
	preset: 'balanced',
	maxLongSide: 1920,
	jpegQuality: 80,
	mode: 'structure',
	rasterFormat: 'auto',
	grayscale: false,
	removeMetadata: true,
	removeAnnotations: false,
	unifyWidth: false,
	outputName: ''
};

const STORAGE_KEY = 'light-pdf:settings:v1';

export function loadSettings(): Settings {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return { ...DEFAULT_SETTINGS };
		const parsed = JSON.parse(raw);
		return { ...DEFAULT_SETTINGS, ...parsed };
	} catch {
		return { ...DEFAULT_SETTINGS };
	}
}

export function saveSettings(s: Settings): void {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
	} catch {
		/* localStorage 不可でも動作は継続 */
	}
}

/** 現在の設定がどのプリセットに一致するか。どれにも一致しなければ 'custom' */
export function detectPreset(s: Settings): PresetId {
	for (const [id, v] of Object.entries(PRESET_VALUES)) {
		if (
			s.maxLongSide === v.maxLongSide &&
			s.jpegQuality === v.jpegQuality &&
			s.removeMetadata === v.removeMetadata &&
			s.mode === 'structure' &&
			s.rasterFormat === 'auto' &&
			!s.grayscale &&
			!s.removeAnnotations
		) {
			return id as PresetId;
		}
	}
	return 'custom';
}
