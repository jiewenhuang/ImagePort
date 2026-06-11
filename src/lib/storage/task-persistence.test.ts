import { describe, expect, test } from 'bun:test';
import { createEmptyTaskMetadata, DEFAULT_PARAMS, type TaskRecord } from '$lib/domain/types';
import { createTaskPersistenceController } from './task-persistence';

function task(overrides: Partial<TaskRecord> = {}): TaskRecord {
	return {
		id: 'task-1',
		prompt: 'a quiet desk',
		params: { ...DEFAULT_PARAMS },
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

function createMemoryLocalStorage() {
	const values = new Map<string, string>();
	return {
		values,
		removeItem(key: string) {
			values.delete(key);
		},
		setItem(key: string, value: string) {
			values.set(key, value);
		}
	};
}

describe('task persistence controller', () => {
	test('removes fallback storage after a successful database snapshot save', async () => {
		const fallback = createMemoryLocalStorage();
		fallback.setItem('tasks', 'stale');
		const controller = createTaskPersistenceController({
			storageKey: 'tasks',
			localStorage: fallback,
			getTasks: () => [task()],
			async saveTasks() {
				return true;
			},
			async saveTask() {
				return true;
			}
		});

		const saved = await controller.persistTasksSnapshot([task()]);

		expect(saved).toBe(true);
		expect(fallback.values.has('tasks')).toBe(false);
	});

	test('falls back to local storage when database snapshot storage is unavailable', async () => {
		const fallback = createMemoryLocalStorage();
		const tasks = [task()];
		const controller = createTaskPersistenceController({
			storageKey: 'tasks',
			localStorage: fallback,
			getTasks: () => tasks,
			async saveTasks() {
				return false;
			},
			async saveTask() {
				return false;
			}
		});

		const saved = await controller.persistTasksSnapshot(tasks);

		expect(saved).toBe(false);
		expect(JSON.parse(fallback.values.get('tasks') ?? '[]')[0].id).toBe('task-1');
	});

	test('reports task save failures through the error callback', async () => {
		const errors: string[] = [];
		const controller = createTaskPersistenceController({
			storageKey: 'tasks',
			localStorage: createMemoryLocalStorage(),
			getTasks: () => [task()],
			async saveTasks() {
				return true;
			},
			async saveTask() {
				throw new Error('disk full');
			},
			onError(message) {
				errors.push(message);
			}
		});

		const saved = await controller.persistTaskSnapshot(task());

		expect(saved).toBe(false);
		expect(errors).toEqual(['任务保存失败：disk full']);
	});

	test('deletes task snapshots through database storage and clears stale fallback storage', async () => {
		const fallback = createMemoryLocalStorage();
		fallback.setItem('tasks', 'stale');
		const deletedIds: string[][] = [];
		const currentTasks = [task({ id: 'task-2' })];
		const controller = createTaskPersistenceController({
			storageKey: 'tasks',
			localStorage: fallback,
			getTasks: () => currentTasks,
			async saveTasks() {
				return false;
			},
			async saveTask() {
				return false;
			},
			async deleteTasks(ids) {
				deletedIds.push(ids);
				return true;
			}
		});

		const deleted = await controller.deleteTaskSnapshots(['task-1']);

		expect(deleted).toBe(true);
		expect(deletedIds).toEqual([['task-1']]);
		expect(fallback.values.has('tasks')).toBe(false);
	});

	test('falls back to current task snapshots when task deletion storage is unavailable', async () => {
		const fallback = createMemoryLocalStorage();
		const currentTasks = [task({ id: 'task-2' })];
		const controller = createTaskPersistenceController({
			storageKey: 'tasks',
			localStorage: fallback,
			getTasks: () => currentTasks,
			async saveTasks() {
				return false;
			},
			async saveTask() {
				return false;
			},
			async deleteTasks() {
				return false;
			}
		});

		const deleted = await controller.deleteTaskSnapshots(['task-1']);

		expect(deleted).toBe(false);
		expect(JSON.parse(fallback.values.get('tasks') ?? '[]').map((item: TaskRecord) => item.id)).toEqual(['task-2']);
	});

	test('falls back to current task snapshots when task deletion throws', async () => {
		const fallback = createMemoryLocalStorage();
		const errors: string[] = [];
		const currentTasks = [task({ id: 'task-2' })];
		const controller = createTaskPersistenceController({
			storageKey: 'tasks',
			localStorage: fallback,
			getTasks: () => currentTasks,
			async saveTasks() {
				return false;
			},
			async saveTask() {
				return false;
			},
			async deleteTasks() {
				throw new Error('database locked');
			},
			onError(message) {
				errors.push(message);
			}
		});

		const deleted = await controller.deleteTaskSnapshots(['task-1']);

		expect(deleted).toBe(false);
		expect(JSON.parse(fallback.values.get('tasks') ?? '[]').map((item: TaskRecord) => item.id)).toEqual(['task-2']);
		expect(errors).toEqual(['任务保存失败：database locked']);
	});

	test('clears pending debounced saves for deleted task snapshots', async () => {
		const clearedTimers: number[] = [];
		const savedTaskIds: string[] = [];
		let currentTasks: TaskRecord[] = [task({ id: 'task-1' })];
		let nextTimerId = 1;
		const timers = new Map<number, () => void>();
		const controller = createTaskPersistenceController({
			storageKey: 'tasks',
			localStorage: createMemoryLocalStorage(),
			getTasks: () => currentTasks,
			async saveTasks() {
				return false;
			},
			async saveTask(savedTask) {
				savedTaskIds.push(savedTask.id);
				return true;
			},
			async deleteTasks() {
				return true;
			},
			setTimeout(callback) {
				const timerId = nextTimerId;
				nextTimerId += 1;
				timers.set(timerId, callback as () => void);
				return timerId as unknown as ReturnType<typeof setTimeout>;
			},
			clearTimeout(timerId) {
				clearedTimers.push(timerId as unknown as number);
				timers.delete(timerId as unknown as number);
			}
		});

		controller.persistTaskSnapshotSoon('task-1');
		currentTasks = [];
		await controller.deleteTaskSnapshots(['task-1']);
		timers.get(1)?.();

		expect(clearedTimers).toEqual([1]);
		expect(savedTaskIds).toEqual([]);
	});

	test('debounces partial task saves and persists the latest task state', () => {
		const savedStatuses: string[] = [];
		const clearedTimers: number[] = [];
		let currentTask = task({ status: 'running' });
		let nextTimerId = 1;
		const timers = new Map<number, () => void>();
		const controller = createTaskPersistenceController({
			storageKey: 'tasks',
			localStorage: createMemoryLocalStorage(),
			getTasks: () => [currentTask],
			async saveTasks() {
				return true;
			},
			async saveTask(savedTask) {
				savedStatuses.push(savedTask.status);
				return true;
			},
			setTimeout(callback) {
				const timerId = nextTimerId;
				nextTimerId += 1;
				timers.set(timerId, callback as () => void);
				return timerId as unknown as ReturnType<typeof setTimeout>;
			},
			clearTimeout(timerId) {
				clearedTimers.push(timerId as unknown as number);
				timers.delete(timerId as unknown as number);
			}
		});

		controller.persistTaskSnapshotSoon('task-1');
		currentTask = task({ status: 'partial' });
		controller.persistTaskSnapshotSoon('task-1');
		timers.get(2)?.();

		expect(clearedTimers).toEqual([1]);
		expect(savedStatuses).toEqual(['partial']);
	});
});
