import type { TaskRecord } from '$lib/domain/types';

interface TaskMediaControllerOptions {
	getTasks(): TaskRecord[];
	loadTask(taskId: string): Promise<TaskRecord | null>;
	loadAllPreviews(): Promise<TaskRecord[] | null>;
	onError(message: string): void;
}

/** Keeps history reads and full-media reads outside UI components. Never submits generation requests. */
export function createTaskMediaController(options: TaskMediaControllerOptions) {
	const pending = new Map<string, Promise<TaskRecord>>();

	async function resolve(task: TaskRecord): Promise<TaskRecord> {
		if (!task.storedMedia) return task;
		const wasVisible = options.getTasks().some((item) => item.id === task.id);
		let request = pending.get(task.id);
		if (!request) {
			request = (async () => {
				const loaded = await options.loadTask(task.id);
				if (!loaded) throw new Error('任务原图读取失败，请检查本地文件或从备份恢复。');
				return loaded;
			})();
			pending.set(task.id, request);
		}
		try {
			const loaded = await request;
			// A favorite or other metadata may have changed while files were being read.
			const current = options.getTasks().find((item) => item.id === task.id);
			if (!current && wasVisible) throw new Error('任务已移除');
			const { storedMedia: _references, ...metadata } = current ?? task;
			return {
				...metadata,
				images: loaded.images,
				thumbnailImages: loaded.thumbnailImages,
				streamPartialImageIds: loaded.streamPartialImageIds,
				inputImages: loaded.inputImages,
				mask: loaded.mask,
				rawResponsePayload: loaded.rawResponsePayload
			};
		} finally {
			if (pending.get(task.id) === request) pending.delete(task.id);
		}
	}

	async function resolveMany(tasks: TaskRecord[]): Promise<TaskRecord[]> {
		// Limit concurrent file reads; the existing backup builder still retains the completed media.
		const resolved: TaskRecord[] = [];
		for (const task of tasks) resolved.push(await resolve(task));
		return resolved;
	}

	async function withMedia(task: TaskRecord, action: (task: TaskRecord) => void | Promise<void>) {
		try {
			await action(await resolve(task));
		} catch (error) {
			options.onError(error instanceof Error ? error.message : String(error));
		}
	}

	async function readAllPreviews(): Promise<TaskRecord[]> {
		const previousIds = new Set(options.getTasks().map((task) => task.id));
		const stored = await options.loadAllPreviews();
		const current = options.getTasks();
		if (!stored) throw new Error('全部历史读取失败，本次数据操作已取消。');
		const currentById = new Map(current.map((task) => [task.id, task]));
		for (const task of stored) {
			if (!currentById.has(task.id) && !previousIds.has(task.id)) currentById.set(task.id, task);
		}
		return [...currentById.values()].sort((a, b) => b.createdAt - a.createdAt);
	}

	return { resolve, resolveMany, withMedia, readAllPreviews };
}
