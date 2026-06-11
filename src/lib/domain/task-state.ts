import type { TaskRecord } from './types';

export function updateTaskById(
	tasks: TaskRecord[],
	taskId: string,
	update: (task: TaskRecord) => TaskRecord
): TaskRecord[] {
	return tasks.map((task) => (task.id === taskId ? update(task) : task));
}

export function updateTasksWhere(
	tasks: TaskRecord[],
	matches: (task: TaskRecord) => boolean,
	update: (task: TaskRecord) => TaskRecord
): TaskRecord[] {
	return tasks.map((task) => (matches(task) ? update(task) : task));
}

export function applyTaskPartialImages(tasks: TaskRecord[], taskId: string, partialImages: string[]): TaskRecord[] {
	return updateTaskById(tasks, taskId, (task) => ({
		...task,
		streamPartialImageIds: partialImages
	}));
}

export function markTaskError(
	tasks: TaskRecord[],
	taskId: string,
	input: {
		message: string;
		finishedAt: number;
		failureCount: number;
	}
): TaskRecord[] {
	return updateTaskById(tasks, taskId, (task) => ({
		...task,
		status: 'error',
		error: input.message,
		finishedAt: input.finishedAt,
		failureCount: input.failureCount
	}));
}

export function removeTasksById(tasks: TaskRecord[], taskIds: string[]): TaskRecord[] {
	const ids = new Set(taskIds);
	return tasks.filter((task) => !ids.has(task.id));
}
