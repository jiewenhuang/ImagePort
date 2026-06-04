import { BaseDirectory, mkdir, readDir, readFile, remove, writeFile } from '@tauri-apps/plugin-fs';
import { canUseTauriPlugins } from './runtime';

export type StoredImageKind = 'inputs' | 'outputs' | 'masks' | 'thumbs' | 'partials';

export interface StoredImageFile {
	path: string;
	mime: string;
}

export async function saveDataUrlImage(kind: StoredImageKind, id: string, dataUrl: string): Promise<StoredImageFile | null> {
	if (!canUseTauriPlugins()) return null;
	const parsed = dataUrlToBytes(dataUrl);
	const extension = extensionForMime(parsed.mime);
	const path = `images/${kind}/${sanitizeFileName(id)}.${extension}`;
	await mkdir(`images/${kind}`, { baseDir: BaseDirectory.AppLocalData, recursive: true });
	await writeFile(path, parsed.bytes, { baseDir: BaseDirectory.AppLocalData });
	return { path, mime: parsed.mime };
}

export async function readDataUrlImage(file: StoredImageFile): Promise<string | null> {
	if (file.mime === 'inline/data-url') return file.path;
	if (!canUseTauriPlugins()) return null;
	try {
		const bytes = await readFile(file.path, { baseDir: BaseDirectory.AppLocalData });
		return bytesToDataUrl(bytes, file.mime);
	} catch {
		return null;
	}
}

export async function removeStoredImage(file: StoredImageFile): Promise<boolean> {
	if (file.mime === 'inline/data-url') return false;
	if (!canUseTauriPlugins()) return false;
	try {
		await remove(file.path, { baseDir: BaseDirectory.AppLocalData });
		return true;
	} catch {
		return false;
	}
}

export async function listStoredImages(): Promise<StoredImageFile[]> {
	if (!canUseTauriPlugins()) return [];
	const files = await Promise.all(
		(['inputs', 'outputs', 'masks', 'thumbs', 'partials'] satisfies StoredImageKind[]).map((kind) => listStoredImagesForKind(kind))
	);
	return files.flat();
}

export function dataUrlToBytes(dataUrl: string): { mime: string; bytes: Uint8Array } {
	const match = /^data:([^;,]+);base64,(.+)$/u.exec(dataUrl);
	if (!match) throw new Error('图片 data URL 格式无效');
	const binary = atob(match[2]);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) {
		bytes[index] = binary.charCodeAt(index);
	}
	return { mime: match[1], bytes };
}

export function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return `data:${mime};base64,${btoa(binary)}`;
}

function extensionForMime(mime: string): string {
	if (mime === 'image/jpeg') return 'jpg';
	if (mime === 'image/webp') return 'webp';
	return 'png';
}

async function listStoredImagesForKind(kind: StoredImageKind): Promise<StoredImageFile[]> {
	try {
		const dir = `images/${kind}`;
		const entries = await readDir(dir, { baseDir: BaseDirectory.AppLocalData });
		return entries
			.filter((entry) => entry.isFile)
			.map((entry) => {
				const path = `${dir}/${entry.name}`;
				return { path, mime: mimeFromPath(path) };
			});
	} catch {
		return [];
	}
}

function mimeFromPath(path: string): string {
	const lower = path.toLowerCase();
	if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
	if (lower.endsWith('.webp')) return 'image/webp';
	return 'image/png';
}

function sanitizeFileName(value: string): string {
	return value.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 96) || crypto.randomUUID();
}
