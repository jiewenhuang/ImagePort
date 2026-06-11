import { describe, expect, test } from 'bun:test';
import { createEmptyTaskMetadata, DEFAULT_PARAMS, type TaskRecord } from './types';
import { applyTaskPartialImages, markTaskError, removeTasksById, updateTaskById, updateTasksWhere } from './task-state';

function task(overrides: Partial<TaskRecord> = {}): TaskRecord {
	return {
		id: 'task-1',
		prompt: 'a quiet desk',
		params: { ...DEFAULT_PARAMS, n: 2 },
		inputImages: [],
		mask: null,
		images: [],
		status: 'running',
		error: null,
		createdAt: 100,
		finishedAt: null,
		failureCount: 0,
		...createEmptyTaskMetadata(),
		...overrides
	};
}

describe('task state helpers', () => {
	test('updates one task by id without touching other tasks', () => {
		const tasks = [task({ id: 'task-1' }), task({ id: 'task-2', prompt: 'keep me' })];

		const updated = updateTaskById(tasks, 'task-1', (item) => ({ ...item, prompt: 'changed' }));

		expect(updated.map((item) => item.prompt)).toEqual(['changed', 'keep me']);
		expect(updated[1]).toBe(tasks[1]);
	});

	test('updates tasks that match a predicate', () => {
		const tasks = [
			task({ id: 'task-1', agentRoundId: 'round-1' }),
			task({ id: 'task-2', agentRoundId: 'round-2' })
		];

		const updated = updateTasksWhere(
			tasks,
			(item) => item.agentRoundId === 'round-1',
			(item) => ({ ...item, status: 'error' })
		);

		expect(updated.map((item) => item.status)).toEqual(['error', 'running']);
	});

	test('applies partial images to an existing task', () => {
		const updated = applyTaskPartialImages([task()], 'task-1', ['partial-1', 'partial-2']);

		expect(updated[0].streamPartialImageIds).toEqual(['partial-1', 'partial-2']);
	});

	test('marks a task as failed with finished metadata', () => {
		const updated = markTaskError([task()], 'task-1', {
			message: 'network failed',
			finishedAt: 300,
			failureCount: 2
		});

		expect(updated[0].status).toBe('error');
		expect(updated[0].error).toBe('network failed');
		expect(updated[0].finishedAt).toBe(300);
		expect(updated[0].failureCount).toBe(2);
	});

	test('removes requested task ids', () => {
		const updated = removeTasksById([task({ id: 'task-1' }), task({ id: 'task-2' })], ['task-1']);

		expect(updated.map((item) => item.id)).toEqual(['task-2']);
	});
});
