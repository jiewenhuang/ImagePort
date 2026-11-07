import { describe, expect, test } from 'bun:test';
import { DEFAULT_SETTINGS } from '$lib/domain/settings';
import { DEFAULT_PARAMS, type TaskRecord } from '$lib/domain/types';
import { createRunningTask } from '$lib/domain/task-factory';
import { summarizeImageRequestGroup } from './image-request-group';
import { createGalleryTaskController, type GalleryTaskInput } from './gallery-task-controller';

const input: GalleryTaskInput = {
	taskId: 'task',
	settings: DEFAULT_SETTINGS,
	profile: DEFAULT_SETTINGS.profiles[0],
	prompt: 'fixture',
	params: { ...DEFAULT_PARAMS },
	inputImages: [],
	mask: null
};

function fixture(runRequest: Parameters<typeof createGalleryTaskController>[0]['runRequest']) {
	let task: TaskRecord | undefined = createRunningTask({
		taskId: input.taskId,
		taskPrompt: input.prompt,
		taskParams: input.params,
		taskInputImages: [],
		taskMask: null,
		sourceMode: 'gallery',
		profile: input.profile
	});
	let saves = 0;
	let notifications = 0;
	let releases = 0;
	const canceled: string[][] = [];
	const controller = createGalleryTaskController({
		getTask: () => task,
		updateTask: (_id, update) => {
			if (task) task = update(task);
		},
		persistTask: async () => {
			saves++;
		},
		persistPartial: () => undefined,
		runRequest,
		createRequestId: () => 'request',
		releaseRequests: () => {
			releases++;
		},
		cancelRequests: (ids) => canceled.push(ids),
		onComplete: () => {
			notifications++;
		},
		onError: () => {
			notifications++;
		}
	});
	return {
		controller,
		getTask: () => task,
		removeTask: () => {
			task = undefined;
		},
		getCounts: () => ({ saves, notifications, releases }),
		canceled
	};
}

describe('gallery task lifecycle', () => {
	test('coalesces duplicate starts and saves a completed task once', async () => {
		let finish!: (value: ReturnType<typeof summarizeImageRequestGroup>) => void;
		let starts = 0;
		const harness = fixture(async (request) => {
			starts++;
			request.onPartialImages('task', ['preview']);
			return new Promise((resolve) => {
				finish = resolve;
			});
		});
		const running = harness.controller.run(input);
		await harness.controller.run(input);
		expect(starts).toBe(1);
		expect(harness.getTask()?.streamPartialImageIds).toEqual(['preview']);
		finish(summarizeImageRequestGroup([{ status: 'fulfilled', value: { images: ['original'] } }]));
		await running;
		expect(harness.getTask()?.status).toBe('done');
		expect(harness.getTask()?.images).toEqual(['original']);
		expect(harness.getCounts()).toEqual({ saves: 1, notifications: 1, releases: 1 });
	});

	test('ignores partial and final responses after a task is deleted', async () => {
		let finish!: () => void;
		const harness = fixture(async (request) => {
			await new Promise<void>((resolve) => {
				finish = resolve;
			});
			request.onPartialImages('task', ['late-preview']);
			return summarizeImageRequestGroup([{ status: 'fulfilled', value: { images: ['late-original'] } }]);
		});
		const running = harness.controller.run(input);
		harness.removeTask();
		finish();
		await running;
		expect(harness.getTask()).toBe(undefined);
		expect(harness.getCounts()).toEqual({ saves: 0, notifications: 0, releases: 1 });
	});

	test('cancels requests on disposal and ignores late errors', async () => {
		let finish!: () => void;
		const harness = fixture(async (request) => {
			await new Promise<void>((resolve) => {
				finish = resolve;
			});
			expect(request.isCanceled?.()).toBe(true);
			request.onPartialImages('task', ['late-preview']);
			throw new Error('late error');
		});
		const running = harness.controller.run(input);
		harness.controller.dispose();
		finish();
		await running;
		expect(harness.canceled).toEqual([['task']]);
		expect(harness.getTask()?.streamPartialImageIds).toEqual([]);
		expect(harness.getCounts()).toEqual({ saves: 0, notifications: 0, releases: 1 });
	});
});
