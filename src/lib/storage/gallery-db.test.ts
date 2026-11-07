import { describe, expect, test } from 'bun:test';
import { buildExportedTasks, normalizeTasks } from '$lib/domain/task-storage';
import { buildFullBackupPayload } from '$lib/domain/full-backup';
import { buildTaskImageDownloadEntries } from '$lib/domain/download';
import { DEFAULT_SETTINGS } from '$lib/domain/settings';
import { createEmptyTaskMetadata, DEFAULT_PARAMS, type TaskRecord } from '$lib/domain/types';
import {
	cleanupUnreferencedTaskImageFiles,
	countTaskRows,
	createFileBackedTaskPayload,
	createAgentConversationRow,
	deleteTaskRows,
	hydrateFileBackedTaskPayload,
	parseTaskPayload,
	previewFileBackedTaskPayload,
	serializeTaskRow,
	selectTaskRowsPage,
	upsertTaskRow,
	type FileBackedTaskPayload,
	type StoredImageFileIndex,
	type TaskImageFileStore
} from './gallery-db';

function task(overrides: Partial<TaskRecord> = {}): TaskRecord {
	return {
		id: 'task-1',
		prompt: 'a quiet desk',
		params: { ...DEFAULT_PARAMS },
		inputImages: [],
		mask: null,
		images: ['data:image/png;base64,aW1n'],
		status: 'done',
		error: null,
		createdAt: 100,
		finishedAt: 200,
		failureCount: 0,
		...createEmptyTaskMetadata(),
		...overrides
	};
}

describe('gallery db row helpers', () => {
	test('serializes task rows with searchable fields and payload', () => {
		const row = serializeTaskRow(task({ status: 'partial' }));

		expect(row[0]).toBe('task-1');
		expect(row[1]).toBe('a quiet desk');
		expect(row[2]).toBe('partial');
		expect(JSON.parse(String(row[5])).prompt).toBe('a quiet desk');
	});

	test('parses invalid payloads as null', () => {
		expect(parseTaskPayload('{bad json')).toBe(null);
	});

	test('upserts a single task row without deleting other rows', async () => {
		const calls: Array<{ sql: string; values?: unknown[] }> = [];
		await upsertTaskRow(
			{
				async execute(sql, values) {
					calls.push({ sql, values });
				}
			},
			task(),
			{ payload: true }
		);

		expect(calls.length).toBe(1);
		expect(calls[0].sql.includes('ON CONFLICT(id) DO UPDATE')).toBe(true);
		expect(calls[0].sql.includes('DELETE')).toBe(false);
		expect(calls[0].values?.[0]).toBe('task-1');
		expect(JSON.parse(String(calls[0].values?.[5]))).toEqual({ payload: true });
	});

	test('deletes only requested task rows by id', async () => {
		const calls: Array<{ sql: string; values?: unknown[] }> = [];

		await deleteTaskRows(
			{
				async execute(sql, values) {
					calls.push({ sql, values });
				}
			},
			['task-1', 'task-3']
		);

		expect(calls).toEqual([
			{
				sql: 'DELETE FROM gallery_tasks WHERE id IN ($1, $2)',
				values: ['task-1', 'task-3']
			}
		]);
	});

	test('selects task rows with limit and offset', async () => {
		const calls: Array<{ sql: string; values?: unknown[] }> = [];
		const rows = await selectTaskRowsPage(
			{
				async select<T>(sql: string, values?: unknown[]): Promise<T> {
					calls.push({ sql, values });
					return [
						{ id: 'task-2', payload: '{"id":"task-2"}' },
						{ id: 'task-1', payload: '{"id":"task-1"}' }
					] as T;
				}
			},
			{ limit: 2, offset: 4 }
		);

		expect(rows.map((row) => row.id)).toEqual(['task-2', 'task-1']);
		expect(calls.length).toBe(1);
		expect(calls[0].sql.includes('ORDER BY created_at DESC LIMIT $1 OFFSET $2')).toBe(true);
		expect(calls[0].values).toEqual([2, 4]);
	});

	test('counts task rows for incremental hydration', async () => {
		const calls: Array<{ sql: string; values?: unknown[] }> = [];
		const count = await countTaskRows({
			async select<T>(sql: string, values?: unknown[]): Promise<T> {
				calls.push({ sql, values });
				return [{ count: 42 }] as T;
			}
		});

		expect(count).toBe(42);
		expect(calls).toEqual([{ sql: 'SELECT COUNT(*) as count FROM gallery_tasks', values: undefined }]);
	});
});

describe('agent db row helpers', () => {
	test('serializes agent conversation rows', () => {
		const row = createAgentConversationRow({
			id: 'conv-1',
			title: 'Session',
			messages: [],
			rounds: [],
			createdAt: 100,
			updatedAt: 200
		});

		expect(row[0]).toBe('conv-1');
		expect(row[1]).toBe('Session');
		expect(row[2]).toBe(100);
		expect(row[3]).toBe(200);
		expect(JSON.parse(String(row[4])).id).toBe('conv-1');
	});
});

describe('file-backed task payloads', () => {
	test('moves output, partial, input, and mask data urls into file references', async () => {
		const files = createMemoryImageStore();
		const payload = await createFileBackedTaskPayload(
			task({
				inputImages: [{ id: 'input-1', name: 'input.png', dataUrl: 'data:image/png;base64,aW5wdXQ=' }],
				mask: { targetImageId: 'input-1', dataUrl: 'data:image/png;base64,bWFzaw==', updatedAt: 123 },
				images: ['data:image/png;base64,b3V0'],
				streamPartialImageIds: ['data:image/png;base64,cGFydGlhbA==']
			}),
			files
		);

		const encoded = JSON.stringify(payload);
		expect(encoded.includes('base64')).toBe(false);
		expect(payload.version).toBe(2);
		expect(payload.imageRefs.outputs.length).toBe(1);
		expect(payload.imageRefs.thumbnails.length).toBe(1);
		expect(payload.imageRefs.partials?.length).toBe(1);
		expect(payload.imageRefs.inputs.length).toBe(1);
		expect(payload.imageRefs.mask?.targetImageId).toBe('input-1');
		expect(files.writes.length).toBe(5);
	});

	test('uses generated thumbnails instead of duplicating full-size outputs when available', async () => {
		const files = createMemoryImageStore();
		const payload = await createFileBackedTaskPayload(
			task({
				images: ['data:image/png;base64,b3V0']
			}),
			files,
			async () => 'data:image/webp;base64,dGh1bWI='
		);

		expect(files.images.get(payload.imageRefs.outputs[0].path)).toBe('data:image/png;base64,b3V0');
		expect(files.images.get(payload.imageRefs.thumbnails[0].path)).toBe('data:image/webp;base64,dGh1bWI=');
		expect(payload.imageRefs.thumbnails[0].mime).toBe('image/webp');
	});

	test('hydrates file-backed payloads back into task records', async () => {
		const files = createMemoryImageStore();
		const original = task({
			inputImages: [{ id: 'input-1', name: 'input.png', dataUrl: 'data:image/png;base64,aW5wdXQ=' }],
			mask: { targetImageId: 'input-1', dataUrl: 'data:image/png;base64,bWFzaw==', updatedAt: 123 },
			images: ['data:image/png;base64,b3V0'],
			streamPartialImageIds: ['data:image/png;base64,cGFydGlhbA==']
		});
		const payload = await createFileBackedTaskPayload(original, files);
		const hydrated = await hydrateFileBackedTaskPayload(payload, files);

		expect(hydrated?.images).toEqual(original.images);
		expect(hydrated?.thumbnailImages).toEqual(original.images);
		expect(hydrated?.streamPartialImageIds).toEqual(original.streamPartialImageIds);
		expect(hydrated?.inputImages).toEqual(original.inputImages);
		expect(hydrated?.mask).toEqual(original.mask);
	});

	test('keeps legacy inline partial images from older file-backed payloads', async () => {
		const files = createMemoryImageStore();
		const original = task({
			images: [],
			streamPartialImageIds: ['data:image/png;base64,cGFydGlhbA=='],
			status: 'partial'
		});
		const payload = await createFileBackedTaskPayload(original, files);
		const legacyPayload = {
			...payload,
			task: {
				...payload.task,
				streamPartialImageIds: original.streamPartialImageIds
			},
			imageRefs: {
				...payload.imageRefs,
				partials: undefined
			}
		};

		const hydrated = await hydrateFileBackedTaskPayload(legacyPayload, files);

		expect(hydrated?.streamPartialImageIds).toEqual(original.streamPartialImageIds);
	});

	test('hydrates older file-backed payloads without partial image fields', async () => {
		const files = createMemoryImageStore();
		const original = task({
			images: ['data:image/png;base64,b3V0']
		});
		const payload = await createFileBackedTaskPayload(original, files);
		const legacyPayload = {
			...payload,
			task: Object.fromEntries(Object.entries(payload.task).filter(([key]) => key !== 'streamPartialImageIds')),
			imageRefs: {
				...payload.imageRefs,
				partials: undefined
			}
		} as unknown as FileBackedTaskPayload;

		const hydrated = await hydrateFileBackedTaskPayload(legacyPayload, files);

		expect(hydrated?.images).toEqual(original.images);
		expect(hydrated?.streamPartialImageIds).toEqual([]);
	});

	test('reads only thumbnails for history and retains references during favorite updates', async () => {
		const files = createMemoryImageStore();
		const original = task({
			inputImages: [{ id: 'ref', name: 'reference.png', dataUrl: 'data:image/png;base64,aW5wdXQ=' }]
		});
		const payload = await createFileBackedTaskPayload(original, files, async () => 'data:image/webp;base64,dGh1bWI=');
		const readPaths: string[] = [];
		const preview = await previewFileBackedTaskPayload(payload, {
			...files,
			async read(file) {
				readPaths.push(file.path);
				return files.read(file);
			}
		});
		expect(readPaths).toEqual(payload.imageRefs.thumbnails.map((file) => file.path));
		expect(preview.images).toEqual(['data:image/webp;base64,dGh1bWI=']);
		expect(preview.inputImages).toEqual([]);
		for (const build of [
			buildExportedTasks,
			buildTaskImageDownloadEntries,
			(tasks: TaskRecord[]) => buildFullBackupPayload(tasks, DEFAULT_SETTINGS)
		]) {
			let message = '';
			try {
				build([preview]);
			} catch (error) {
				message = String(error);
			}
			expect(message.includes('请先读取任务原图')).toBe(true);
		}

		let writes = 0;
		const saved = await createFileBackedTaskPayload(normalizeTasks([{ ...preview, isFavorite: true }])[0], {
			...files,
			async save() {
				writes++;
				return null;
			}
		});
		expect(writes).toBe(0);
		expect(saved.imageRefs).toEqual(payload.imageRefs);
		expect(saved.task.isFavorite).toBe(true);
		expect(saved.task.storedMedia).toBe(undefined);
		expect((await hydrateFileBackedTaskPayload(saved, files))?.inputImages).toEqual(original.inputImages);
		expect((await hydrateFileBackedTaskPayload(saved, files))?.images).toEqual(original.images);
	});

	test('protects images referenced by unloaded database pages during cleanup', async () => {
		const files = createMemoryImageStore();
		const unloaded = await createFileBackedTaskPayload(task({ id: 'unloaded' }), files);
		const removed: string[] = [];
		const result = await cleanupUnreferencedTaskImageFiles(
			[],
			{
				async list() {
					return [
						...unloaded.imageRefs.outputs,
						...unloaded.imageRefs.thumbnails,
						{ path: 'images/orphan.png', mime: 'image/png' }
					];
				},
				async remove(file) {
					removed.push(file.path);
					return true;
				}
			},
			async () => [{ id: 'unloaded', payload: JSON.stringify(unloaded) }]
		);
		expect(removed).toEqual(['images/orphan.png']);
		expect(result).toEqual({ removedCount: 1, failedCount: 0 });
	});

	test('fails clearly if an original is missing instead of using its thumbnail', async () => {
		const files = createMemoryImageStore();
		const payload = await createFileBackedTaskPayload(task(), files);
		files.images.delete(payload.imageRefs.outputs[0].path);
		let message = '';
		try {
			await hydrateFileBackedTaskPayload(payload, files);
		} catch (error) {
			message = String(error);
		}
		expect(message.includes('本地图片文件缺失')).toBe(true);
	});

	test('keeps usable task data when a referenced image file cannot be read', async () => {
		const files = createMemoryImageStore();
		const original = task({
			inputImages: [{ id: 'input-1', name: 'input.png', dataUrl: 'data:image/png;base64,aW5wdXQ=' }],
			images: ['data:image/png;base64,b3V0']
		});
		const payload = await createFileBackedTaskPayload(original, files);
		files.images.delete(payload.imageRefs.thumbnails[0].path);

		const hydrated = await hydrateFileBackedTaskPayload(payload, files);

		expect(hydrated?.images).toEqual(original.images);
		expect(hydrated?.thumbnailImages).toEqual([]);
		expect(hydrated?.inputImages).toEqual(original.inputImages);
	});

	test('falls back to inline data urls when file storage is unavailable', async () => {
		const files: TaskImageFileStore = {
			async save() {
				return null;
			},
			async read(file) {
				return file.mime === 'inline/data-url' ? file.path : null;
			}
		};
		const original = task({
			inputImages: [{ id: 'input-1', name: 'input.png', dataUrl: 'data:image/png;base64,aW5wdXQ=' }],
			images: ['data:image/png;base64,b3V0']
		});

		const payload = await createFileBackedTaskPayload(original, files);
		const hydrated = await hydrateFileBackedTaskPayload(payload, files);

		expect(payload.imageRefs.outputs[0].mime).toBe('inline/data-url');
		expect(hydrated?.images).toEqual(original.images);
		expect(hydrated?.thumbnailImages).toEqual(original.images);
		expect(hydrated?.inputImages).toEqual(original.inputImages);
	});
});

describe('task image file cleanup', () => {
	test('does not delete files if a stored history row cannot be parsed', async () => {
		const removed: string[] = [];
		let message = '';
		try {
			await cleanupUnreferencedTaskImageFiles(
				[],
				{
					async list() {
						return [{ path: 'images/outputs/preserved.png', mime: 'image/png' }];
					},
					async remove(file) {
						removed.push(file.path);
						return true;
					}
				},
				async () => [{ id: 'corrupted', payload: '{invalid' }]
			);
		} catch (error) {
			message = (error as Error).message;
		}
		expect(message.includes('已暂停图片清理')).toBe(true);
		expect(removed).toEqual([]);
	});

	test('removes stored image files that are no longer referenced by current tasks', async () => {
		const removed: string[] = [];
		const index: StoredImageFileIndex = {
			async list() {
				return [
					{ path: 'images/outputs/task-1-1.png', mime: 'image/png' },
					{ path: 'images/thumbs/task-1-1.png', mime: 'image/png' },
					{ path: 'images/inputs/task-1-input-1.png', mime: 'image/png' },
					{ path: 'images/masks/task-1-input-1.png', mime: 'image/png' },
					{ path: 'images/partials/task-1-1.png', mime: 'image/png' },
					{ path: 'images/outputs/stale.png', mime: 'image/png' },
					{ path: 'images/thumbs/old-thumb.png', mime: 'image/png' },
					{ path: 'images/partials/old-partial.png', mime: 'image/png' }
				];
			},
			async remove(file) {
				removed.push(file.path);
				return true;
			}
		};

		const result = await cleanupUnreferencedTaskImageFiles(
			[
				task({
					inputImages: [{ id: 'input-1', name: 'input.png', dataUrl: 'data:image/png;base64,aW5wdXQ=' }],
					mask: { targetImageId: 'input-1', dataUrl: 'data:image/png;base64,bWFzaw==', updatedAt: 123 },
					images: ['data:image/png;base64,b3V0'],
					streamPartialImageIds: ['data:image/png;base64,cGFydGlhbA==']
				})
			],
			index
		);

		expect(result).toEqual({ removedCount: 3, failedCount: 0 });
		expect(removed).toEqual([
			'images/outputs/stale.png',
			'images/thumbs/old-thumb.png',
			'images/partials/old-partial.png'
		]);
	});

	test('reports image files that could not be removed', async () => {
		const index: StoredImageFileIndex = {
			async list() {
				return [{ path: 'images/outputs/stale.png', mime: 'image/png' }];
			},
			async remove() {
				return false;
			}
		};

		const result = await cleanupUnreferencedTaskImageFiles([], index);

		expect(result).toEqual({ removedCount: 0, failedCount: 1 });
	});
});

function createMemoryImageStore(): TaskImageFileStore & { writes: string[]; images: Map<string, string> } {
	const images = new Map<string, string>();
	const writes: string[] = [];
	return {
		images,
		writes,
		async save(kind, id, dataUrl) {
			const mime = /^data:([^;,]+)[;,]/u.exec(dataUrl)?.[1] ?? 'image/png';
			const path = `${kind}/${id}.${mime === 'image/webp' ? 'webp' : 'png'}`;
			images.set(path, dataUrl);
			writes.push(path);
			return { path, mime };
		},
		async read(file) {
			return images.get(file.path) ?? null;
		}
	};
}
