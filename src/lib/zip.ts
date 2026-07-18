/**
 * 依存なしの ZIP 生成（無圧縮 store のみ）。
 * ページごとの個別 PDF 出力（要件 3.4 オプション）に使用する。
 * PDF は既に圧縮済みのため、ZIP 側での再圧縮は行わない。
 */

export interface ZipEntry {
	name: string;
	bytes: Uint8Array;
}

const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		table[n] = c >>> 0;
	}
	return table;
})();

function crc32(bytes: Uint8Array): number {
	let c = 0xffffffff;
	for (let i = 0; i < bytes.length; i++) {
		c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
	}
	return (c ^ 0xffffffff) >>> 0;
}

/** 現在時刻を DOS 形式（time, date）にする */
function dosDateTime(): { time: number; date: number } {
	const d = new Date();
	return {
		time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
		date: (((d.getFullYear() - 1980) & 0x7f) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
	};
}

export function buildZip(entries: ZipEntry[]): Uint8Array {
	const encoder = new TextEncoder();
	const { time, date } = dosDateTime();

	const locals: Uint8Array[] = [];
	const centrals: Uint8Array[] = [];
	let offset = 0;

	for (const entry of entries) {
		const nameBytes = encoder.encode(entry.name);
		const crc = crc32(entry.bytes);
		const size = entry.bytes.length;

		const local = new Uint8Array(30 + nameBytes.length + size);
		const lv = new DataView(local.buffer);
		lv.setUint32(0, 0x04034b50, true); // local file header
		lv.setUint16(4, 20, true); // version needed
		lv.setUint16(6, 0x0800, true); // flags: UTF-8 名
		lv.setUint16(8, 0, true); // method: store
		lv.setUint16(10, time, true);
		lv.setUint16(12, date, true);
		lv.setUint32(14, crc, true);
		lv.setUint32(18, size, true); // compressed
		lv.setUint32(22, size, true); // uncompressed
		lv.setUint16(26, nameBytes.length, true);
		lv.setUint16(28, 0, true); // extra length
		local.set(nameBytes, 30);
		local.set(entry.bytes, 30 + nameBytes.length);
		locals.push(local);

		const central = new Uint8Array(46 + nameBytes.length);
		const cv = new DataView(central.buffer);
		cv.setUint32(0, 0x02014b50, true); // central directory header
		cv.setUint16(4, 20, true); // version made by
		cv.setUint16(6, 20, true); // version needed
		cv.setUint16(8, 0x0800, true);
		cv.setUint16(10, 0, true);
		cv.setUint16(12, time, true);
		cv.setUint16(14, date, true);
		cv.setUint32(16, crc, true);
		cv.setUint32(20, size, true);
		cv.setUint32(24, size, true);
		cv.setUint16(28, nameBytes.length, true);
		cv.setUint32(42, offset, true); // local header offset
		central.set(nameBytes, 46);
		centrals.push(central);

		offset += local.length;
	}

	const centralSize = centrals.reduce((s, c) => s + c.length, 0);
	const end = new Uint8Array(22);
	const ev = new DataView(end.buffer);
	ev.setUint32(0, 0x06054b50, true); // end of central directory
	ev.setUint16(8, entries.length, true);
	ev.setUint16(10, entries.length, true);
	ev.setUint32(12, centralSize, true);
	ev.setUint32(16, offset, true);

	const total = offset + centralSize + 22;
	const out = new Uint8Array(total);
	let pos = 0;
	for (const chunk of [...locals, ...centrals, end]) {
		out.set(chunk, pos);
		pos += chunk.length;
	}
	return out;
}
