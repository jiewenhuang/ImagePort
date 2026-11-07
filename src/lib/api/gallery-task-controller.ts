import type { GalleryImageRunnerInput } from './gallery-runner';
import type { ImageRequestGroupSummary } from './image-request-group';
import { buildActualParamsByImage, buildRevisedPromptByImage } from '$lib/domain/task-output';
import { getMissingOutputImageCount, type TaskRecord } from '$lib/domain/types';

export type GalleryTaskInput = Pick<
	GalleryImageRunnerInput,
	'taskId' | 'settings' | 'profile' | 'prompt' | 'params' | 'inputImages' | 'mask'
>;
type RunnerInput = GalleryTaskInput &
	Pick<GalleryImageRunnerInput, 'createRequestId' | 'onPartialImages' | 'isCanceled'>;

interface GalleryTaskControllerOptions {
	getTask(id: string): TaskRecord | undefined;
	updateTask(id: string, update: (task: TaskRecord) => TaskRecord): void;
	persistTask(task: TaskRecord): Promise<unknown>;
	persistPartial(id: string): void;
	runRequest(input: RunnerInput): Promise<ImageRequestGroupSummary>;
	createRequestId(id: string): string;
	releaseRequests(id: string): void;
	cancelRequests(ids: string[]): void;
	onComplete(result: ImageRequestGroupSummary, input: GalleryTaskInput): void;
	onError(message: string): void;
}

export function createGalleryTaskController(options: GalleryTaskControllerOptions) {
	const active = new Map<string, object>();
	let disposed = false;

	async function run(input: GalleryTaskInput): Promise<void> {
		const { taskId } = input;
		if (disposed || active.has(taskId)) return;
		const token = {};
		active.set(taskId, token);
		const isActive = () => !disposed && active.get(taskId) === token && options.getTask(taskId)?.status === 'running';
		try {
			if (!isActive()) return;
			const result = await options.runRequest({
				...input,
				createRequestId: () => {
					if (!isActive()) throw new Error('任务已停止');
					return options.createRequestId(taskId);
				},
				isCanceled: () => !isActive(),
				onPartialImages: (_id, images) => {
					if (!isActive()) return;
					options.updateTask(taskId, (task) => ({ ...task, streamPartialImageIds: images }));
					options.persistPartial(taskId);
				}
			});
			if (!isActive()) return;
			options.updateTask(taskId, (task) => ({
				...task,
				images: result.images,
				status: result.status,
				error: result.errorMessage,
				failureCount: result.failureCount,
				finishedAt: Date.now(),
				actualParams: result.actualParams,
				actualParamsByImage: buildActualParamsByImage(result.images, result.actualParamsList),
				revisedPromptByImage: buildRevisedPromptByImage(result.images, result.revisedPrompts),
				rawImageUrls: result.rawImageUrls,
				rawResponsePayload: result.rawResponsePayload,
				streamPartialImageIds: result.streamPartialImages
			}));
			const task = options.getTask(taskId);
			if (task) await options.persistTask(task);
			if (!disposed) options.onComplete(result, input);
		} catch (error) {
			if (!isActive()) return;
			const message = error instanceof Error ? error.message : String(error);
			options.updateTask(taskId, (task) => ({
				...task,
				status: 'error',
				error: message,
				finishedAt: Date.now(),
				failureCount: getMissingOutputImageCount(task.params.n, task.images.length)
			}));
			const task = options.getTask(taskId);
			if (task) await options.persistTask(task);
			if (!disposed) options.onError(message);
		} finally {
			if (active.get(taskId) === token) active.delete(taskId);
			options.releaseRequests(taskId);
		}
	}

	function dispose() {
		disposed = true;
		options.cancelRequests([...active.keys()]);
		active.clear();
	}

	return { run, dispose };
}
