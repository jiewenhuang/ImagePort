import { describe, expect, test } from 'bun:test';
import { createEmptyTaskMetadata, DEFAULT_PARAMS, type TaskRecord } from '$lib/domain/types';
import { deleteTaskImageFilesWithReport } from './task-file-cleanup';

function task(id: string): TaskRecord {
	return {
		id,
		prompt: 'cleanup',
		params: { ...DEFAULT_PARAMS },
		inputImages: [],
		mask: null,
		images: [],
		status: 'done',
		error: null,
		createdAt: 100,
		finishedAt: 200,
		failureCount: 0,
		...createEmptyTaskMetadata()
	};
}

describe('task file cleanup helpers', () => {
	test('returns zero when all task image files are removed', async () => {
		const failedCount = await deleteTaskImageFilesWithReport([task('a'), task('b')], async () => undefined);

		expect(failedCount).toBe(0);
	});

	test('counts tasks whose image file cleanup rejects', async () => {
		const failedCount = await deleteTaskImageFilesWithReport([task('a'), task('b'), task('c')], async (item) => {
			if (item.id !== 'b') return;
			throw new Error('permission denied');
		});

		expect(failedCount).toBe(1);
	});
});
