import { describe, expect, test } from 'bun:test';
import { copyImageToClipboard } from './image-clipboard';

describe('image clipboard helpers', () => {
	test('writes decoded data url bytes through injected native writer', async () => {
		(globalThis as { window?: unknown }).window = { __TAURI_INTERNALS__: {} };
		const writes: number[][] = [];

		const mode = await copyImageToClipboard('data:image/png;base64,AQID', {
			write: async (bytes) => {
				writes.push([...bytes]);
			}
		});

		expect(mode).toBe('native');
		expect(writes).toEqual([[1, 2, 3]]);
		delete (globalThis as { window?: unknown }).window;
	});
});
