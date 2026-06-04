import type { TaskRecord } from '$lib/domain/types';

export async function deleteTaskImageFilesWithReport(
	tasksToDelete: TaskRecord[],
	deleteTaskImages: (task: TaskRecord) => Promise<void>
): Promise<number> {
	const results = await Promise.allSettled(tasksToDelete.map((task) => deleteTaskImages(task)));
	return results.filter((result) => result.status === 'rejected').length;
}
