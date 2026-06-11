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

	test('limits concurrent cleanup work while counting failed tasks', async () => {
		let activeCount = 0;
		let maxActiveCount = 0;
		const startedTaskIds: string[] = [];
		const failedCount = await deleteTaskImageFilesWithReport(
			[task('a'), task('b'), task('c'), task('d'), task('e')],
			async (item) => {
				startedTaskIds.push(item.id);
				activeCount += 1;
				maxActiveCount = Math.max(maxActiveCount, activeCount);
				await delay();
				activeCount -= 1;
				if (item.id === 'c' || item.id === 'e') throw new Error('permission denied');
			},
			{ concurrency: 2 }
		);

		expect(failedCount).toBe(2);
		expect(maxActiveCount <= 2).toBe(true);
		expect(startedTaskIds).toEqual(['a', 'b', 'c', 'd', 'e']);
	});
});

function delay() {
	return new Promise<void>((resolve) => setTimeout(resolve, 1));
}
