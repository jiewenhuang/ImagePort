import { describe, expect, test } from 'bun:test';
import { saveBytesWithDialog } from './native-download';

describe('native download helpers', () => {
	test('returns false when the user cancels the save dialog', async () => {
		const result = await saveBytesWithDialog({
			fileName: 'imageport.png',
			bytes: new Uint8Array([1, 2, 3]),
			save: async () => null,
			write: async () => {
				throw new Error('should not write');
			}
		});

		expect(result).toBe(false);
	});

	test('writes bytes to the selected path', async () => {
		const writes: Array<{ path: string; bytes: number[] }> = [];
		const result = await saveBytesWithDialog({
			fileName: 'imageport.png',
			bytes: new Uint8Array([1, 2, 3]),
			save: async () => '/tmp/imageport.png',
			write: async (path, bytes) => {
				writes.push({ path, bytes: [...bytes] });
			}
		});

		expect(result).toBe(true);
		expect(writes).toEqual([{ path: '/tmp/imageport.png', bytes: [1, 2, 3] }]);
	});
});
