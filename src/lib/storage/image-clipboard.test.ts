import { describe, expect, test } from 'bun:test';
import { copyImageToClipboard } from './image-clipboard';

describe('image clipboard helpers', () => {
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
