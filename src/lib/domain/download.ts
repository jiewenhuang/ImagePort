import type { TaskRecord } from './types';

export interface TaskImageDownloadEntry {
	path: string;
	dataUrl: string;
	taskId: string;
	imageIndex: number;
}

export function buildTaskImageDownloadEntries(tasks: TaskRecord[]): TaskImageDownloadEntry[] {
	return tasks.flatMap((task) => {
		if (!task.images.length && !task.streamPartialImageIds.length) return [];
		const folder = `${formatTimestampForFileName(task.createdAt)}-${createSafeDownloadFileName(task.prompt, 48)}`;
		return [
			...task.images.map((dataUrl, index) => ({
				path: `${folder}/${task.id}-${String(index + 1).padStart(2, '0')}.${extensionFromDataUrl(dataUrl)}`,
				dataUrl,
				taskId: task.id,
				imageIndex: index
			})),
			...task.streamPartialImageIds.map((dataUrl, index) => ({
				path: `${folder}/partials/${task.id}-partial-${String(index + 1).padStart(2, '0')}.${extensionFromDataUrl(dataUrl)}`,
				dataUrl,
				taskId: task.id,
				imageIndex: index
			}))
		];
	});
}

export function createSafeDownloadFileName(value: string, maxLength = 64): string {
	const normalized = value
		.trim()
		.replace(/[^a-zA-Z0-9\u4e00-\u9fa5._-]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, Math.max(1, maxLength))
		.replace(/-+$/g, '');
	return normalized || 'imageport';
}

export function extensionFromDataUrl(dataUrl: string): 'png' | 'jpg' | 'webp' {
	if (dataUrl.startsWith('data:image/jpeg')) return 'jpg';
	if (dataUrl.startsWith('data:image/webp')) return 'webp';
	return 'png';
}

export function dataUrlToDownloadBytes(dataUrl: string): Uint8Array {
	const match = /^data:[^;,]+;base64,(.+)$/u.exec(dataUrl);
	if (!match) throw new Error('图片 data URL 格式无效');
	const binary = atob(match[1]);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) {
		bytes[index] = binary.charCodeAt(index);
	}
	return bytes;
}

function formatTimestampForFileName(timestamp: number): string {
	const date = new Date(timestamp);
	const parts = [
		date.getUTCFullYear(),
		date.getUTCMonth() + 1,
		date.getUTCDate(),
		date.getUTCHours(),
		date.getUTCMinutes(),
		date.getUTCSeconds()
	].map((part, index) => (index === 0 ? String(part) : String(part).padStart(2, '0')));
	return `${parts[0]}-${parts[1]}-${parts[2]}-${parts[3]}${parts[4]}${parts[5]}`;
}
