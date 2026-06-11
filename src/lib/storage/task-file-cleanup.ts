import type { TaskRecord } from '$lib/domain/types';

const DEFAULT_TASK_IMAGE_CLEANUP_CONCURRENCY = 4;

export interface DeleteTaskImageFilesOptions {
	concurrency?: number;
}

export async function deleteTaskImageFilesWithReport(
	tasksToDelete: TaskRecord[],
	deleteTaskImages: (task: TaskRecord) => Promise<void>,
	options: DeleteTaskImageFilesOptions = {}
): Promise<number> {
	const concurrency = normalizeCleanupConcurrency(options.concurrency);
	let nextTaskIndex = 0;
	let failedCount = 0;

	async function runWorker() {
		while (nextTaskIndex < tasksToDelete.length) {
			const task = tasksToDelete[nextTaskIndex];
			nextTaskIndex += 1;
			try {
				await deleteTaskImages(task);
			} catch {
				failedCount += 1;
			}
		}
	}

	await Promise.all(Array.from({ length: Math.min(concurrency, tasksToDelete.length) }, runWorker));
	return failedCount;
}

function normalizeCleanupConcurrency(value: number | undefined) {
	if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_TASK_IMAGE_CLEANUP_CONCURRENCY;
	return Math.max(1, Math.trunc(value));
}
