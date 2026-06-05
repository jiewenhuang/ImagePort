import { dataUrlToDownloadBytes, extensionFromDataUrl } from './download';
import type { AgentConversation } from './agent';
import type { AppSettings } from './settings';
import type { InputImage, MaskDraft, TaskRecord } from './types';

export interface FullBackupManifest {
	version: 1;
	exportedAt: number;
	settings: AppSettings;
	agentConversations?: AgentConversation[];
	tasks: Array<
		Omit<TaskRecord, 'images' | 'thumbnailImages' | 'inputImages' | 'mask'> & {
			images: string[];
			thumbnailImages?: string[];
			inputImages: Array<Omit<InputImage, 'dataUrl'> & { dataUrl: string }>;
			mask: (Omit<MaskDraft, 'dataUrl'> & { dataUrl: string }) | null;
		}
	>;
}

export interface FullBackupFile {
	path: string;
	data: Uint8Array;
}

export interface FullBackupPayload {
	manifest: FullBackupManifest;
	files: FullBackupFile[];
}

export function buildFullBackupPayload(
	tasks: TaskRecord[],
	settings: AppSettings,
	exportedAt = Date.now(),
	agentConversations: AgentConversation[] = []
): FullBackupPayload {
	const files: FullBackupFile[] = [];
	const manifestTasks = tasks.map((task) => {
		const taskDir = `tasks/${task.id}`;
		const images = task.images.map((dataUrl, index) =>
			addImageFile(files, `${taskDir}/outputs/${index + 1}.${extensionFromDataUrl(dataUrl)}`, dataUrl)
		);
		const streamPartialImageIds = task.streamPartialImageIds.map((dataUrl, index) =>
			addImageFile(files, `${taskDir}/partials/${index + 1}.${extensionFromDataUrl(dataUrl)}`, dataUrl)
		);
		const thumbnailImages = task.thumbnailImages?.map((dataUrl, index) =>
			addImageFile(files, `${taskDir}/thumbs/${index + 1}.${extensionFromDataUrl(dataUrl)}`, dataUrl)
		);
		const inputImages = task.inputImages.map((image, index) => ({
			...image,
			dataUrl: addImageFile(
				files,
				`${taskDir}/inputs/${index + 1}-${safePathPart(image.name)}.${extensionFromDataUrl(image.dataUrl)}`,
				image.dataUrl
			)
		}));
		const mask = task.mask
			? {
					...task.mask,
					dataUrl: addImageFile(
						files,
						`${taskDir}/masks/${task.mask.targetImageId}.${extensionFromDataUrl(task.mask.dataUrl)}`,
						task.mask.dataUrl
					)
				}
			: null;
		return {
			...task,
			images,
			streamPartialImageIds,
			thumbnailImages,
			inputImages,
			mask
		};
	});

	return {
		manifest: {
			version: 1,
			exportedAt,
			settings,
			agentConversations,
			tasks: manifestTasks
		},
		files
	};
}

export async function restoreFullBackupTasks(
	manifest: FullBackupManifest,
	readFile: (path: string) => Promise<string | null>
): Promise<TaskRecord[]> {
	const tasks: TaskRecord[] = [];
	for (const task of manifest.tasks) {
		const images = await readImageRefs(task.images, readFile);
		const streamPartialImageIds = await readImageRefs(task.streamPartialImageIds ?? [], readFile);
		const thumbnailImages = task.thumbnailImages ? await readImageRefs(task.thumbnailImages, readFile) : [];
		const inputImages = await Promise.all(
			task.inputImages.map(async (image) => ({
				...image,
				dataUrl: (await readFile(image.dataUrl)) ?? ''
			}))
		);
		const mask = task.mask
			? {
					...task.mask,
					dataUrl: (await readFile(task.mask.dataUrl)) ?? ''
				}
			: null;
		tasks.push({
			...task,
			images: images.filter(Boolean),
			streamPartialImageIds: streamPartialImageIds.filter(Boolean),
			thumbnailImages: thumbnailImages.filter(Boolean),
			inputImages: inputImages.filter((image) => image.dataUrl),
			mask: mask?.dataUrl ? mask : null
		});
	}
	return tasks;
}

export function imageBytesToDataUrl(bytes: Uint8Array, path: string): string {
	const mime =
		path.endsWith('.jpg') || path.endsWith('.jpeg')
			? 'image/jpeg'
			: path.endsWith('.webp')
				? 'image/webp'
				: 'image/png';
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return `data:${mime};base64,${btoa(binary)}`;
}

function addImageFile(files: FullBackupFile[], path: string, dataUrl: string): string {
	files.push({ path, data: dataUrlToDownloadBytes(dataUrl) });
	return path;
}

async function readImageRefs(paths: string[], readFile: (path: string) => Promise<string | null>): Promise<string[]> {
	return Promise.all(paths.map(async (path) => (await readFile(path)) ?? ''));
}

function safePathPart(value: string): string {
	return (
		value
			.trim()
			.replace(/[^a-zA-Z0-9._-]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 48) || 'image'
	);
}
