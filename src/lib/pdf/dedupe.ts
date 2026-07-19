/**
 * 重複オブジェクトの統合（要件 3.2 共通）。
 * 同一内容の画像 XObject・フォントファイルストリームをハッシュ比較で検出し、
 * 参照を 1 つに集約して残りを削除する。
 * SMask 等の子ストリームを先に統合すると親の辞書が一致するようになるため、
 * 変化がなくなるまで複数パス実行する。
 */
import {
	PDFArray,
	PDFDict,
	PDFDocument,
	PDFName,
	PDFObject,
	PDFRawStream,
	PDFRef,
	PDFStream
} from 'pdf-lib';

const name = (s: string) => PDFName.of(s);

/** FNV-1a 32bit。衝突対策として使用側でバイト列の完全比較を併用する */
function fnv1a(bytes: Uint8Array): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < bytes.length; i++) {
		h ^= bytes[i];
		h = Math.imul(h, 0x01000193);
	}
	return h >>> 0;
}

/**
 * ストリーム辞書の内容シグネチャ。キー順に依存しないようソートし、
 * Length は本体バイト列から自明（間接参照の場合に表記が揺れる）ため除外する。
 */
function dictSignature(dict: PDFDict): string {
	const parts: string[] = [];
	for (const [k, v] of dict.entries()) {
		const key = k.toString();
		if (key === '/Length') continue;
		parts.push(`${key}=${v.toString()}`);
	}
	return parts.sort().join('|');
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
	return true;
}

/** obj 内の間接参照を remap に従って付け替える */
function replaceRefs(obj: PDFObject, remap: Map<PDFRef, PDFRef>): void {
	if (obj instanceof PDFDict) {
		for (const [k, v] of obj.entries()) {
			if (v instanceof PDFRef) {
				const n = remap.get(v);
				if (n) obj.set(k, n);
			} else {
				replaceRefs(v, remap);
			}
		}
	} else if (obj instanceof PDFArray) {
		for (let i = 0; i < obj.size(); i++) {
			const v = obj.get(i);
			if (v instanceof PDFRef) {
				const n = remap.get(v);
				if (n) obj.set(i, n);
			} else if (v !== undefined) {
				replaceRefs(v, remap);
			}
		}
	} else if (obj instanceof PDFStream) {
		replaceRefs(obj.dict, remap);
	}
}

/** FontDescriptor から参照されるフォントファイルストリームの参照集合 */
function collectFontFileRefs(doc: PDFDocument): Set<PDFRef> {
	const refs = new Set<PDFRef>();
	for (const [, obj] of doc.context.enumerateIndirectObjects()) {
		if (!(obj instanceof PDFDict)) continue;
		if (obj.get(name('Type')) !== name('FontDescriptor')) continue;
		for (const key of ['FontFile', 'FontFile2', 'FontFile3']) {
			const r = obj.get(name(key));
			if (r instanceof PDFRef) refs.add(r);
		}
	}
	return refs;
}

/**
 * 重複ストリームを統合する。統合した重複オブジェクトの数を返す。
 * 対象は画像 XObject（SMask 含む）とフォントファイルに限定し、
 * 意味を持ちうる他のストリームは触らない（壊さないことを最優先）。
 */
export function dedupeStreams(doc: PDFDocument): number {
	const ctx = doc.context;
	const fontFiles = collectFontFileRefs(doc);
	let merged = 0;

	// 子（SMask 等）の統合で親のシグネチャが変わるため、変化がなくなるまで繰り返す
	for (let pass = 0; pass < 4; pass++) {
		const byKey = new Map<string, { ref: PDFRef; contents: Uint8Array }>();
		const remap = new Map<PDFRef, PDFRef>();

		for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
			if (!(obj instanceof PDFRawStream)) continue;
			const isImage = obj.dict.get(name('Subtype')) === name('Image');
			if (!isImage && !fontFiles.has(ref)) continue;
			const contents = obj.getContents();
			const key = `${fnv1a(contents)}:${contents.length}:${dictSignature(obj.dict)}`;
			const canon = byKey.get(key);
			if (canon && bytesEqual(canon.contents, contents)) {
				remap.set(ref, canon.ref);
			} else if (!canon) {
				byKey.set(key, { ref, contents });
			}
		}

		if (remap.size === 0) break;
		for (const [, obj] of ctx.enumerateIndirectObjects()) {
			replaceRefs(obj, remap);
		}
		for (const dup of remap.keys()) ctx.delete(dup);
		merged += remap.size;
	}
	return merged;
}
