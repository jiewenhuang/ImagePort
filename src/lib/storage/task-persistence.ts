import type { TaskSnapshotPersistenceOptions } from '$lib/domain/task-storage';
import type { TaskRecord } from '$lib/domain/types';

export interface TaskPersistenceControllerOptions {
	storageKey: string;
	saveTasks: (tasks: TaskRecord[], options?: TaskSnapshotPersistenceOptions) => Promise<boolean>;
	saveTask: (task: TaskRecord) => Promise<boolean>;
	getTasks: () => TaskRecord[];
	localStorage?: Pick<Storage, 'removeItem' | 'setItem'>;
	setTimeout?: (callback: () => void, timeout: number) => ReturnType<typeof window.setTimeout>;
	clearTimeout?: (timer: ReturnType<typeof window.setTimeout>) => void;
	partialSaveDebounceMs?: number;
	onError?: (message: string) => void;
}

export interface TaskPersistenceController {
	persistTasksSnapshot(tasks: TaskRecord[], options?: TaskSnapshotPersistenceOptions): Promise<boolean>;
	persistTaskSnapshot(task: TaskRecord): Promise<boolean>;
	persistTaskSnapshotSoon(taskId: string): void;
	persistTaskSnapshotNow(task: TaskRecord): Promise<boolean>;
	dispose(): void;
}

const DEFAULT_PARTIAL_SAVE_DEBOUNCE_MS = 250;

export function createTaskPersistenceController(options: TaskPersistenceControllerOptions): TaskPersistenceController {
	const timers = new Map<string, ReturnType<typeof window.setTimeout>>();
	const fallbackStorage = options.localStorage ?? globalThis.localStorage;
	const setTimer = options.setTimeout ?? ((callback, timeout) => globalThis.setTimeout(callback, timeout));
	const clearTimer = options.clearTimeout ?? ((timer) => globalThis.clearTimeout(timer));
	const debounceMs = options.partialSaveDebounceMs ?? DEFAULT_PARTIAL_SAVE_DEBOUNCE_MS;

	function reportError(err: unknown) {
		const message = `任务保存失败：${err instanceof Error ? err.message : String(err)}`;
		options.onError?.(message);
	}

	async function persistTasksSnapshot(tasks: TaskRecord[], persistenceOptions: TaskSnapshotPersistenceOptions = {}) {
		try {
			const savedToDatabase = await options.saveTasks(tasks, persistenceOptions);
			if (savedToDatabase) {
				fallbackStorage.removeItem(options.storageKey);
				return true;
			}
			if (tasks.length > 0 || persistenceOptions.allowEmpty) {
				fallbackStorage.setItem(options.storageKey, JSON.stringify(tasks));
			}
			return false;
		} catch (err) {
			reportError(err);
			return false;
		}
	}

	async function persistTaskSnapshot(task: TaskRecord) {
		try {
			const savedToDatabase = await options.saveTask(task);
			if (savedToDatabase) {
				fallbackStorage.removeItem(options.storageKey);
				return true;
			}
			const tasks = options.getTasks();
			if (tasks.length > 0) fallbackStorage.setItem(options.storageKey, JSON.stringify(tasks));
			return false;
		} catch (err) {
			reportError(err);
			return false;
		}
	}

	function persistTaskSnapshotSoon(taskId: string) {
		const previousTimer = timers.get(taskId);
		if (previousTimer != null) clearTimer(previousTimer);
		const timer = setTimer(() => {
			timers.delete(taskId);
			const task = options.getTasks().find((item) => item.id === taskId);
			if (task) void persistTaskSnapshot(task);
		}, debounceMs);
		timers.set(taskId, timer);
	}

	function persistTaskSnapshotNow(task: TaskRecord) {
		const previousTimer = timers.get(task.id);
		if (previousTimer != null) {
			clearTimer(previousTimer);
			timers.delete(task.id);
		}
		return persistTaskSnapshot(task);
	}

	function dispose() {
		for (const timer of timers.values()) clearTimer(timer);
		timers.clear();
	}

	return {
		persistTasksSnapshot,
		persistTaskSnapshot,
		persistTaskSnapshotSoon,
		persistTaskSnapshotNow,
		dispose
	};
}
