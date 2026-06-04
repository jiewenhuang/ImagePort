import { writeFile } from '@tauri-apps/plugin-fs';
import { save } from '@tauri-apps/plugin-dialog';
import { canUseTauriPlugins } from './runtime';

export interface SaveBytesWithDialogOptions {
	fileName: string;
	bytes: Uint8Array;
	save?: (fileName: string) => Promise<string | null>;
	write?: (path: string, bytes: Uint8Array) => Promise<void>;
}

export async function saveBytesWithDialog(options: SaveBytesWithDialogOptions): Promise<boolean> {
	const saveFile = options.save ?? defaultSaveDialog;
	const writeBytes = options.write ?? defaultWriteFile;
	const path = await saveFile(options.fileName);
	if (!path) return false;
	await writeBytes(path, options.bytes);
	return true;
}

export async function saveDataUrlToFile(dataUrl: string, fileName: string): Promise<boolean> {
	const bytes = dataUrlToBytes(dataUrl);
	if (canUseTauriPlugins()) {
		return saveBytesWithDialog({ fileName, bytes });
	}
	downloadBytesInBrowser(bytes, fileName, getDataUrlMime(dataUrl) ?? 'application/octet-stream');
	return true;
}

export async function saveBlobToFile(blob: Blob, fileName: string): Promise<boolean> {
	if (canUseTauriPlugins()) {
		return saveBytesWithDialog({ fileName, bytes: new Uint8Array(await blob.arrayBuffer()) });
	}
	downloadBlobInBrowser(blob, fileName);
	return true;
}

function defaultSaveDialog(fileName: string): Promise<string | null> {
	return save({ defaultPath: fileName });
}

async function defaultWriteFile(path: string, bytes: Uint8Array): Promise<void> {
	await writeFile(path, bytes);
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
	const match = /^data:[^;,]+;base64,(.+)$/u.exec(dataUrl);
	if (!match) throw new Error('图片 data URL 格式无效');
	const binary = atob(match[1]);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) {
		bytes[index] = binary.charCodeAt(index);
	}
	return bytes;
}

function getDataUrlMime(dataUrl: string): string | null {
	return /^data:([^;,]+)[;,]/u.exec(dataUrl)?.[1] ?? null;
}

function downloadBytesInBrowser(bytes: Uint8Array, fileName: string, type: string): void {
	downloadBlobInBrowser(new Blob([bytes], { type }), fileName);
}

function downloadBlobInBrowser(blob: Blob, fileName: string): void {
	const url = URL.createObjectURL(blob);
	const link = document.createElement('a');
	link.href = url;
	link.download = fileName;
	document.body.append(link);
	link.click();
	link.remove();
	URL.revokeObjectURL(url);
}
