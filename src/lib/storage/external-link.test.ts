import { describe, expect, test } from 'bun:test';
import { openExternalUrl } from './external-link';

describe('external links', () => {
	test('opens URLs with the Tauri opener when available', async () => {
		const opened: string[] = [];

		await openExternalUrl('https://github.com/jiewenhuang/ImagePort', {
			isTauri: () => true,
			openUrl: async (url) => {
				opened.push(url);
			}
		});

		expect(opened).toEqual(['https://github.com/jiewenhuang/ImagePort']);
	});

	test('falls back to window.open outside Tauri', async () => {
		const opened: unknown[] = [];

		await openExternalUrl('https://github.com/jiewenhuang/ImagePort/releases', {
			isTauri: () => false,
			openWindow: (...args) => {
				opened.push(args);
				return null;
			}
		});

		expect(opened).toEqual([
			['https://github.com/jiewenhuang/ImagePort/releases', '_blank', 'noopener,noreferrer']
		]);
	});

	test('rejects non-http URLs', async () => {
		let message = '';
		try {
			await openExternalUrl('file:///tmp/test', {
				isTauri: () => true,
				openUrl: async () => {}
			});
		} catch (err) {
			message = err instanceof Error ? err.message : String(err);
		}

		expect(message).toBe('只支持打开 http 或 https 链接');
	});

	test('rejects URLs outside the ImagePort GitHub repository', async () => {
		let message = '';
		try {
			await openExternalUrl('https://example.com', {
				isTauri: () => true,
				openUrl: async () => {}
			});
		} catch (err) {
			message = err instanceof Error ? err.message : String(err);
		}

		expect(message).toBe('只支持打开 ImagePort GitHub 链接');
	});
});
