import { describe, expect, test } from 'bun:test';
import { createZipBlob, readStoredZipEntries } from './zip';

describe('zip helpers', () => {
	test('creates a zip blob that contains stored file names and data', async () => {
		const blob = createZipBlob([
			{ path: 'task-a/image-01.txt', data: new TextEncoder().encode('hello') },
			{ path: 'task-b/image-02.txt', data: new TextEncoder().encode('world') }
		]);
		const bytes = new Uint8Array(await blob.arrayBuffer());
		const text = new TextDecoder().decode(bytes);

		expect(blob.type).toBe('application/zip');
		expect(text.includes('task-a/image-01.txt')).toBe(true);
		expect(text.includes('task-b/image-02.txt')).toBe(true);
		expect(text.includes('hello')).toBe(true);
		expect(text.includes('world')).toBe(true);
		expect(bytes.at(-2)).toBe(0);
		expect(bytes.at(-1)).toBe(0);
		const entries = readStoredZipEntries(bytes);
		expect(new TextDecoder().decode(entries.get('task-a/image-01.txt'))).toBe('hello');
		expect(new TextDecoder().decode(entries.get('task-b/image-02.txt'))).toBe('world');
	});
});
