import { describe, expect, test } from 'bun:test';
import { createEmptyTaskMetadata, DEFAULT_PARAMS, type TaskRecord } from './types';
import { buildTaskImageDownloadEntries, createSafeDownloadFileName, dataUrlToDownloadBytes } from './download';

function task(overrides: Partial<TaskRecord> = {}): TaskRecord {
	return {
		id: 'task-1',
		prompt: 'a small ceramic cup on a blue desk',
		params: { ...DEFAULT_PARAMS, output_format: 'png', n: 2 },
		inputImages: [],
		mask: null,
		images: ['data:image/png;base64,one', 'data:image/jpeg;base64,two'],
		status: 'done',
		error: null,
		createdAt: Date.UTC(2026, 0, 2, 3, 4, 5),
		finishedAt: Date.UTC(2026, 0, 2, 3, 5, 5),
		failureCount: 0,
		...createEmptyTaskMetadata(),
		...overrides
	};
}

describe('download helpers', () => {
	test('creates short safe file names from prompts', () => {
		expect(createSafeDownloadFileName('  A / quiet * desk ? with windows  ', 18)).toBe('A-quiet-desk-with');
		expect(createSafeDownloadFileName('', 18)).toBe('imageport');
	});

	test('builds stable task image download entries', () => {
		const entries = buildTaskImageDownloadEntries([task({ id: 'task-a' })]);

		expect(entries.map((entry) => entry.path)).toEqual([
			'2026-01-02-030405-a-small-ceramic-cup-on-a-blue-desk/task-a-01.png',
			'2026-01-02-030405-a-small-ceramic-cup-on-a-blue-desk/task-a-02.jpg'
		]);
		expect(entries.map((entry) => entry.dataUrl)).toEqual(['data:image/png;base64,one', 'data:image/jpeg;base64,two']);
	});

	test('includes partial images in task downloads', () => {
		const entries = buildTaskImageDownloadEntries([
			task({
				id: 'task-partial',
				images: [],
				streamPartialImageIds: ['data:image/webp;base64,partial']
			})
		]);

		expect(entries.map((entry) => entry.path)).toEqual([
			'2026-01-02-030405-a-small-ceramic-cup-on-a-blue-desk/partials/task-partial-partial-01.webp'
		]);
		expect(entries[0].dataUrl).toBe('data:image/webp;base64,partial');
	});

	test('skips tasks without output images', () => {
		expect(buildTaskImageDownloadEntries([task({ images: [] })])).toEqual([]);
	});

	test('converts data urls into download bytes', () => {
		const result = dataUrlToDownloadBytes('data:text/plain;base64,aGVsbG8=');

		expect(new TextDecoder().decode(result)).toBe('hello');
	});
});
