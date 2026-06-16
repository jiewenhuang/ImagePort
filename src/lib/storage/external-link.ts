import { canUseTauriPlugins } from './runtime';

export interface OpenExternalUrlOptions {
	isTauri?: () => boolean;
	openUrl?: (url: string) => Promise<void>;
	openWindow?: (url?: string | URL, target?: string, features?: string) => Window | null;
}

export async function openExternalUrl(url: string, options: OpenExternalUrlOptions = {}) {
	const normalizedUrl = normalizeHttpUrl(url);
	const isTauri = options.isTauri ?? canUseTauriPlugins;

	if (isTauri()) {
		const openUrl = options.openUrl ?? (await import('@tauri-apps/plugin-opener')).openUrl;
		await openUrl(normalizedUrl);
		return;
	}

	const openWindow = options.openWindow ?? globalThis.window?.open.bind(globalThis.window);
	if (!openWindow) throw new Error('当前环境不支持打开外部链接');
	openWindow(normalizedUrl, '_blank', 'noopener,noreferrer');
}

function normalizeHttpUrl(url: string) {
	const parsed = new URL(url);
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('只支持打开 http 或 https 链接');
	if (
		parsed.protocol !== 'https:' ||
		parsed.hostname !== 'github.com' ||
		(parsed.pathname !== '/jiewenhuang/ImagePort' && !parsed.pathname.startsWith('/jiewenhuang/ImagePort/'))
	) {
		throw new Error('只支持打开 ImagePort GitHub 链接');
	}
	return parsed.toString();
}
