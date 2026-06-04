import { describe, expect, test } from 'bun:test';
import { bytesToDataUrl, dataUrlToBytes, readDataUrlImage } from './image-files';

describe('image file helpers', () => {
	test('round-trips a data url through bytes', () => {
		const dataUrl = 'data:image/png;base64,aGVsbG8=';
		const parsed = dataUrlToBytes(dataUrl);

		expect(parsed.mime).toBe('image/png');
		expect(bytesToDataUrl(parsed.bytes, parsed.mime)).toBe(dataUrl);
	});

	test('rejects non-base64 data urls', () => {
		let didThrow = false;
		try {
			dataUrlToBytes('not-an-image');
		} catch {
			didThrow = true;
		}
		expect(didThrow).toBe(true);
	});

	test('returns null when a stored file cannot be read', async () => {
		const dataUrl = await readDataUrlImage({ path: 'images/outputs/missing.png', mime: 'image/png' });

		expect(dataUrl).toBe(null);
	});
});
