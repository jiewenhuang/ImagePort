import { describe, expect, test } from 'bun:test';
import { DEFAULT_PARAMS, createEmptyTaskMetadata, type TaskRecord } from '$lib/domain/types';
import { createTaskMediaController } from './task-media-controller';

function task(id: string, preview = true): TaskRecord {
	return {
		id,
		prompt: 'fixture',
		params: { ...DEFAULT_PARAMS },
		inputImages: [],
		mask: null,
		images: [preview ? 'thumbnail' : 'original'],
		status: 'done',
		error: null,
		createdAt: 1,
		finishedAt: 2,
		failureCount: 0,
		...createEmptyTaskMetadata(),
		...(preview
			? { storedMedia: { outputs: [{ path: `${id}.png`, mime: 'image/png' }], thumbnails: [], inputs: [], mask: null } }
			: {})
	};
}

describe('task media controller', () => {
	test('refuses global operations when all-history storage is unavailable', async () => {
		const controller = createTaskMediaController({
			getTasks: () => [task('visible')],
			loadTask: async () => null,
			loadAllPreviews: async () => null,
			onError: () => undefined
		});
		let message = '';
		try {
			await controller.readAllPreviews();
		} catch (error) {
			message = (error as Error).message;
		}
		expect(message.includes('全部历史读取失败')).toBe(true);
	});

	test('deduplicates file reads and preserves metadata changed during hydration', async () => {
		let tasks = [task('visible')];
		let finish!: (value: TaskRecord) => void;
		let reads = 0;
		const controller = createTaskMediaController({
			getTasks: () => tasks,
			loadTask: () => {
				reads++;
				return new Promise((resolve) => {
					finish = resolve;
				});
			},
			loadAllPreviews: async () => tasks,
			onError: () => undefined
		});
		const first = controller.resolve(tasks[0]);
		const second = controller.resolve(tasks[0]);
		tasks = [{ ...tasks[0], isFavorite: true, favoriteCollectionIds: ['favorites-default'] }];
		finish({ ...task('visible', false), rawResponsePayload: 'retained-response' });
		const resolved = await Promise.all([first, second]);
		expect(reads).toBe(1);
		expect(resolved[0].images).toEqual(['original']);
		expect(resolved[0].isFavorite).toBe(true);
		expect(resolved[0].storedMedia).toBe(undefined);
		expect(resolved[0].rawResponsePayload).toBe('retained-response');
	});

	test('includes unloaded pages in global exports while keeping current metadata', async () => {
		const visible = { ...task('visible'), isFavorite: true };
		const controller = createTaskMediaController({
			getTasks: () => [visible],
			loadTask: async (id) => task(id, false),
			loadAllPreviews: async () => [task('visible'), task('unloaded')],
			onError: () => undefined
		});
		const all = await controller.readAllPreviews();
		expect(all.map((item) => item.id)).toEqual(['visible', 'unloaded']);
		expect(all[0].isFavorite).toBe(true);
		expect((await controller.resolveMany(all)).map((item) => item.images[0])).toEqual(['original', 'original']);
	});

	test('ignores a deleted task when a pending read completes', async () => {
		let tasks = [task('deleted')];
		let finish!: (value: TaskRecord) => void;
		let actionCalled = false;
		const errors: string[] = [];
		const controller = createTaskMediaController({
			getTasks: () => tasks,
			loadTask: () =>
				new Promise((resolve) => {
					finish = resolve;
				}),
			loadAllPreviews: async () => [],
			onError: (message) => errors.push(message)
		});
		const action = controller.withMedia(tasks[0], () => {
			actionCalled = true;
		});
		tasks = [];
		finish(task('deleted', false));
		await action;
		expect(actionCalled).toBe(false);
		expect(errors).toEqual(['任务已移除']);
	});

	test('reports a missing original and permits retry after a failed read', async () => {
		const original = task('missing');
		let reads = 0;
		const errors: string[] = [];
		const controller = createTaskMediaController({
			getTasks: () => [original],
			loadTask: async () => (++reads === 1 ? null : task('missing', false)),
			loadAllPreviews: async () => [],
			onError: (message) => errors.push(message)
		});
		await controller.withMedia(original, () => {
			throw new Error('should not run');
		});
		expect(errors.length).toBe(1);
		expect((await controller.resolve(original)).images).toEqual(['original']);
		expect(reads).toBe(2);
	});
});
