import type { StoredTaskMedia, TaskMediaFile, TaskRecord } from './types';

export function getTaskOutputCount(task: TaskRecord): number {
	return task.storedMedia?.outputs.length ?? task.images.length;
}

export function getTaskPartialCount(task: TaskRecord): number {
	return task.storedMedia?.partials?.length ?? task.streamPartialImageIds.length;
}

export function getTaskInputCount(task: TaskRecord): number {
	return task.storedMedia?.inputs.length ?? task.inputImages.length;
}

export function assertTaskMediaLoaded(task: TaskRecord): void {
	if (task.storedMedia) throw new Error('请先读取任务原图，再导出或下载。');
}

export function isStoredTaskMedia(value: unknown): value is StoredTaskMedia {
	if (!isRecord(value)) return false;
	return (
		Array.isArray(value.outputs) &&
		value.outputs.every(isMediaFile) &&
		Array.isArray(value.thumbnails) &&
		value.thumbnails.every(isMediaFile) &&
		(value.partials === undefined || (Array.isArray(value.partials) && value.partials.every(isMediaFile))) &&
		Array.isArray(value.inputs) &&
		value.inputs.every(
			(file) =>
				isMediaFile(file) &&
				'id' in file &&
				typeof file.id === 'string' &&
				'name' in file &&
				typeof file.name === 'string'
		) &&
		(value.mask === null ||
			(isMediaFile(value.mask) &&
				'targetImageId' in value.mask &&
				typeof value.mask.targetImageId === 'string' &&
				'updatedAt' in value.mask &&
				typeof value.mask.updatedAt === 'number'))
	);
}

function isMediaFile(value: unknown): value is TaskMediaFile {
	return isRecord(value) && typeof value.path === 'string' && typeof value.mime === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
