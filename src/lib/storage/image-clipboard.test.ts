import { describe, expect, test } from 'bun:test';
import { copyImageToClipboard } from './image-clipboard';

describe('image clipboard helpers', () => {
	test('prefers browser clipboard blobs before native RGBA conversion', async () => {
		const originalWindow = (globalThis as { window?: unknown }).window;
		const originalNavigator = (globalThis as { navigator?: unknown }).navigator;
		const originalClipboardItem = (globalThis as { ClipboardItem?: unknown }).ClipboardItem;
		(globalThis as { window?: unknown }).window = { __TAURI_INTERNALS__: {} };
		Object.defineProperty(globalThis, 'navigator', {
			configurable: true,
			value: { clipboard: { write: async () => undefined } }
		});
		(globalThis as { ClipboardItem?: unknown }).ClipboardItem = class {
			constructor(public readonly items: Record<string, Blob>) {}
		};
		const writes: ClipboardItem[] = [];

		const mode = await copyImageToClipboard('data:image/png;base64,AQID', {
			decodeImage: async () => {
				throw new Error('native decode should not run');
			},
			write: async () => {
				throw new Error('native write should not run');
			},
			clipboardWrite: async (items) => {
				writes.push(...items);
			}
		});

		expect(mode).toBe('browser');
		expect(writes.length).toBe(1);
		(globalThis as { window?: unknown }).window = originalWindow;
		Object.defineProperty(globalThis, 'navigator', {
			configurable: true,
			value: originalNavigator
		});
		(globalThis as { ClipboardItem?: unknown }).ClipboardItem = originalClipboardItem;
	});

	test('falls back to native clipboard when browser image copy fails', async () => {
		const originalWindow = (globalThis as { window?: unknown }).window;
		const originalNavigator = (globalThis as { navigator?: unknown }).navigator;
		const originalClipboardItem = (globalThis as { ClipboardItem?: unknown }).ClipboardItem;
		(globalThis as { window?: unknown }).window = { __TAURI_INTERNALS__: {} };
		Object.defineProperty(globalThis, 'navigator', {
			configurable: true,
			value: { clipboard: { write: async () => undefined } }
		});
		(globalThis as { ClipboardItem?: unknown }).ClipboardItem = class {
			constructor(public readonly items: Record<string, Blob>) {}
		};
		const writes: string[] = [];

		const mode = await copyImageToClipboard('data:image/png;base64,AQID', {
			decodeImage: async () => ({
				rgba: new Uint8Array([255, 0, 0, 255]),
				width: 1,
				height: 1
			}),
			createNativeImage: async () => 'native-image-resource',
			write: async (image) => {
				writes.push(String(image));
			},
			clipboardWrite: async () => {
				throw new Error('browser clipboard rejected image');
			}
		});

		expect(mode).toBe('native');
		expect(writes).toEqual(['native-image-resource']);
		(globalThis as { window?: unknown }).window = originalWindow;
		Object.defineProperty(globalThis, 'navigator', {
			configurable: true,
			value: originalNavigator
		});
		(globalThis as { ClipboardItem?: unknown }).ClipboardItem = originalClipboardItem;
	});

	test('converts data urls into native RGBA images before writing', async () => {
		(globalThis as { window?: unknown }).window = { __TAURI_INTERNALS__: {} };
		const writes: string[] = [];

		const mode = await copyImageToClipboard('data:image/png;base64,AQID', {
			decodeImage: async () => ({
				rgba: new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255]),
				width: 2,
				height: 1
			}),
			createNativeImage: async (rgba, width, height) => {
				expect([...rgba]).toEqual([255, 0, 0, 255, 0, 255, 0, 255]);
				expect(width).toBe(2);
				expect(height).toBe(1);
				return 'native-image-resource';
			},
			write: async (image) => {
				writes.push(String(image));
			}
		});

		expect(mode).toBe('native');
		expect(writes).toEqual(['native-image-resource']);
		delete (globalThis as { window?: unknown }).window;
	});
});
