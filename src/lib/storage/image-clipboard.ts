import { Image } from '@tauri-apps/api/image';
import { writeImage } from '@tauri-apps/plugin-clipboard-manager';
import { dataUrlToDownloadBytes } from '$lib/domain/download';
import { canUseTauriPlugins } from './runtime';

export interface DecodedRgbaImage {
	rgba: Uint8Array;
	width: number;
	height: number;
}

export interface CopyImageToClipboardOptions {
	write?: (image: string | Image | Uint8Array | ArrayBuffer | number[]) => Promise<void>;
	createNativeImage?: (
		rgba: Uint8Array,
		width: number,
		height: number
	) => Promise<string | Image | Uint8Array | ArrayBuffer | number[]>;
	decodeImage?: (dataUrl: string) => Promise<DecodedRgbaImage>;
	clipboardWrite?: (items: ClipboardItem[]) => Promise<void>;
}

export async function copyImageToClipboard(
	dataUrl: string,
	options: CopyImageToClipboardOptions = {}
): Promise<'native' | 'browser'> {
	const browserCopy = () => copyImageBlobToBrowserClipboard(dataUrl, options.clipboardWrite);
	let browserError: unknown;
	try {
		return await browserCopy();
	} catch (err) {
		browserError = err;
	}

	if (options.write || canUseTauriPlugins()) {
		const decoded = await (options.decodeImage ?? decodeDataUrlToRgbaImage)(dataUrl);
		const image = await (options.createNativeImage ?? createNativeImage)(decoded.rgba, decoded.width, decoded.height);
		await (options.write ?? writeImage)(image);
		return 'native';
	}

	throw browserError instanceof Error ? browserError : new Error('当前环境不支持复制图片');
}

async function copyImageBlobToBrowserClipboard(
	dataUrl: string,
	clipboardWrite?: (items: ClipboardItem[]) => Promise<void>
): Promise<'browser'> {
	const mime = getDataUrlMime(dataUrl) ?? 'image/png';
	if (typeof ClipboardItem === 'undefined' || typeof navigator === 'undefined' || !navigator.clipboard?.write) {
		throw new Error('当前环境不支持复制图片');
	}
	const bytes = dataUrlToDownloadBytes(dataUrl);
	await (clipboardWrite ?? navigator.clipboard.write.bind(navigator.clipboard))([
		new ClipboardItem({ [mime]: new Blob([bytes], { type: mime }) })
	]);
	return 'browser';
}

function getDataUrlMime(dataUrl: string): string | null {
	return /^data:([^;,]+)[;,]/u.exec(dataUrl)?.[1] ?? null;
}

function createNativeImage(rgba: Uint8Array, width: number, height: number): Promise<Image> {
	return Image.new(rgba, width, height);
}

async function decodeDataUrlToRgbaImage(dataUrl: string): Promise<DecodedRgbaImage> {
	if (typeof document === 'undefined' || typeof window === 'undefined') {
		throw new Error('当前环境不支持复制图片');
	}
	const image = await loadBrowserImage(dataUrl);
	const canvas = document.createElement('canvas');
	canvas.width = image.naturalWidth || image.width;
	canvas.height = image.naturalHeight || image.height;
	const ctx = canvas.getContext('2d');
	if (!ctx || canvas.width <= 0 || canvas.height <= 0) throw new Error('图片解码失败');
	ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
	return {
		rgba: new Uint8Array(ctx.getImageData(0, 0, canvas.width, canvas.height).data),
		width: canvas.width,
		height: canvas.height
	};
}

function loadBrowserImage(src: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const image = new window.Image();
		image.onload = () => resolve(image);
		image.onerror = () => reject(new Error('图片加载失败'));
		image.src = src;
	});
}
