import { describe, expect, test } from 'bun:test';
import { DEFAULT_PARAMS } from './types';
import { normalizeInputDraftSnapshot, readLocalStorageJson } from './gallery-hydration';

function createMemoryStorage(values: Record<string, string>) {
	return {
		getItem(key: string) {
			return values[key] ?? null;
		}
	};
}

describe('readLocalStorageJson', () => {
	test('returns parsed JSON when a legacy local storage value exists', () => {
		const storage = createMemoryStorage({ settings: '{"theme":"dark"}' });

		expect(readLocalStorageJson(storage, 'settings')).toEqual({ theme: 'dark' });
	});

	test('returns null when the key is missing', () => {
		const storage = createMemoryStorage({});

		expect(readLocalStorageJson(storage, 'missing')).toBe(null);
	});

	test('keeps JSON parse errors visible to hydration callers', () => {
		const storage = createMemoryStorage({ broken: '{nope' });
		let didThrow = false;

		try {
			readLocalStorageJson(storage, 'broken');
		} catch {
			didThrow = true;
		}
		expect(didThrow).toBe(true);
	});
});

describe('normalizeInputDraftSnapshot', () => {
	test('keeps valid draft fields and filters invalid input images', () => {
		const draft = normalizeInputDraftSnapshot({
			prompt: 'restore this prompt',
			params: { ...DEFAULT_PARAMS, size: '1024x1024' },
			inputImages: [
				{ id: 'image-1', name: 'one.png', dataUrl: 'data:image/png;base64,one' },
				{ id: 'broken', name: 'missing-data-url' }
			],
			mask: { targetImageId: 'image-1', dataUrl: 'data:image/png;base64,mask', updatedAt: 100 }
		});

		expect(draft).toEqual({
			prompt: 'restore this prompt',
			params: { ...DEFAULT_PARAMS, size: '1024x1024' },
			inputImages: [{ id: 'image-1', name: 'one.png', dataUrl: 'data:image/png;base64,one' }],
			mask: { targetImageId: 'image-1', dataUrl: 'data:image/png;base64,mask', updatedAt: 100 }
		});
	});

	test('ignores non-object draft values', () => {
		expect(normalizeInputDraftSnapshot(null)).toBe(null);
		expect(normalizeInputDraftSnapshot('prompt')).toBe(null);
	});
});
