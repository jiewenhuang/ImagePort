import { writeImage } from '@tauri-apps/plugin-clipboard-manager';
import { dataUrlToDownloadBytes } from '$lib/domain/download';
import { canUseTauriPlugins } from './runtime';

export interface CopyImageToClipboardOptions {
	write?: (bytes: Uint8Array) => Promise<void>;
	clipboardWrite?: (items: ClipboardItem[]) => Promise<void>;
}

export async function copyImageToClipboard(dataUrl: string, options: CopyImageToClipboardOptions = {}): Promise<'native' | 'browser'> {
	const bytes = dataUrlToDownloadBytes(dataUrl);
	if (options.write || canUseTauriPlugins()) {
		await (options.write ?? writeImage)(bytes);
		return 'native';
	}

	const mime = getDataUrlMime(dataUrl) ?? 'image/png';
	if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) {
		throw new Error('当前环境不支持复制图片');
	}
	const blob = new Blob([bytes], { type: mime });
	await (options.clipboardWrite ?? navigator.clipboard.write.bind(navigator.clipboard))([
		new ClipboardItem({ [mime]: blob })
	]);
	return 'browser';
}

function getDataUrlMime(dataUrl: string): string | null {
	return /^data:([^;,]+)[;,]/u.exec(dataUrl)?.[1] ?? null;
}
