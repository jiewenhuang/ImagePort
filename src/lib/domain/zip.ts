export interface ZipEntryInput {
	path: string;
	data: Uint8Array;
}

interface CentralDirectoryEntry {
	bytes: Uint8Array;
	localHeaderOffset: number;
}

const encoder = new TextEncoder();

export function createZipBlob(entries: ZipEntryInput[]): Blob {
	const chunks: Uint8Array[] = [];
	const centralDirectory: CentralDirectoryEntry[] = [];
	let offset = 0;

	for (const entry of entries) {
		const fileName = encoder.encode(normalizeZipPath(entry.path));
		const crc = crc32(entry.data);
		const localHeader = concatBytes([
			u32(0x04034b50),
			u16(20),
			u16(0x0800),
			u16(0),
			u16(0),
			u16(0),
			u32(crc),
			u32(entry.data.length),
			u32(entry.data.length),
			u16(fileName.length),
			u16(0),
			fileName
		]);
		const localHeaderOffset = offset;
		chunks.push(localHeader, entry.data);
		offset += localHeader.length + entry.data.length;

		const centralHeader = concatBytes([
			u32(0x02014b50),
			u16(20),
			u16(20),
			u16(0x0800),
			u16(0),
			u16(0),
			u16(0),
			u32(crc),
			u32(entry.data.length),
			u32(entry.data.length),
			u16(fileName.length),
			u16(0),
			u16(0),
			u16(0),
			u16(0),
			u32(0),
			u32(localHeaderOffset),
			fileName
		]);
		centralDirectory.push({ bytes: centralHeader, localHeaderOffset });
	}

	const centralDirectoryOffset = offset;
	for (const entry of centralDirectory) {
		chunks.push(entry.bytes);
		offset += entry.bytes.length;
	}
	const centralDirectorySize = offset - centralDirectoryOffset;
	chunks.push(
		concatBytes([
			u32(0x06054b50),
			u16(0),
			u16(0),
			u16(centralDirectory.length),
			u16(centralDirectory.length),
			u32(centralDirectorySize),
			u32(centralDirectoryOffset),
			u16(0)
		])
	);

	return new Blob(chunks, { type: 'application/zip' });
}

export function readStoredZipEntries(bytes: Uint8Array): Map<string, Uint8Array> {
	const entries = new Map<string, Uint8Array>();
	let offset = 0;
	while (offset + 30 <= bytes.length) {
		const signature = readU32(bytes, offset);
		if (signature !== 0x04034b50) break;
		const compression = readU16(bytes, offset + 8);
		if (compression !== 0) throw new Error('暂不支持压缩 ZIP 备份');
		const compressedSize = readU32(bytes, offset + 18);
		const uncompressedSize = readU32(bytes, offset + 22);
		const fileNameLength = readU16(bytes, offset + 26);
		const extraLength = readU16(bytes, offset + 28);
		const nameStart = offset + 30;
		const dataStart = nameStart + fileNameLength + extraLength;
		const dataEnd = dataStart + compressedSize;
		if (dataEnd > bytes.length) throw new Error('ZIP 文件不完整');
		const name = new TextDecoder().decode(bytes.slice(nameStart, nameStart + fileNameLength));
		const data = bytes.slice(dataStart, dataEnd);
		if (data.length !== uncompressedSize) throw new Error('ZIP 文件大小不匹配');
		entries.set(name, data);
		offset = dataEnd;
	}
	return entries;
}

function normalizeZipPath(path: string): string {
	const normalized = path.replace(/\\/g, '/').replace(/^\/+/, '');
	return normalized || 'imageport-file';
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
	const length = parts.reduce((total, part) => total + part.length, 0);
	const result = new Uint8Array(length);
	let offset = 0;
	for (const part of parts) {
		result.set(part, offset);
		offset += part.length;
	}
	return result;
}

function u16(value: number): Uint8Array {
	const bytes = new Uint8Array(2);
	const view = new DataView(bytes.buffer);
	view.setUint16(0, value, true);
	return bytes;
}

function u32(value: number): Uint8Array {
	const bytes = new Uint8Array(4);
	const view = new DataView(bytes.buffer);
	view.setUint32(0, value >>> 0, true);
	return bytes;
}

function readU16(bytes: Uint8Array, offset: number): number {
	return new DataView(bytes.buffer, bytes.byteOffset + offset, 2).getUint16(0, true);
}

function readU32(bytes: Uint8Array, offset: number): number {
	return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true);
}

function crc32(bytes: Uint8Array): number {
	let crc = 0xffffffff;
	for (const byte of bytes) {
		crc ^= byte;
		for (let bit = 0; bit < 8; bit += 1) {
			crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
		}
	}
	return (crc ^ 0xffffffff) >>> 0;
}
