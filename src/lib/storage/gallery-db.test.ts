import { describe, expect, test } from 'bun:test';
import { createEmptyTaskMetadata, DEFAULT_PARAMS, type TaskRecord } from '$lib/domain/types';
import {
	cleanupUnreferencedTaskImageFiles,
	createFileBackedTaskPayload,
	createAgentConversationRow,
	hydrateFileBackedTaskPayload,
	parseTaskPayload,
	serializeTaskRow,
	runSqlBatchWithTransaction,
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

describe('sql batch transaction helper', () => {
	test('wraps batch operations in a transaction when transaction control works', async () => {
		const calls: string[] = [];

		await runSqlBatchWithTransaction(
			{
				async execute(sql) {
					calls.push(sql);
				}
			},
			[
				async (db) => {
					await db.execute('UPSERT ONE');
				},
				async (db) => {
					await db.execute('DELETE STALE');
				}
			]
		);

		expect(calls).toEqual(['BEGIN IMMEDIATE', 'UPSERT ONE', 'DELETE STALE', 'COMMIT']);
	});

	test('falls back to sequential operations when transaction commands are unavailable', async () => {
		const calls: string[] = [];

		await runSqlBatchWithTransaction(
			{
				async execute(sql) {
					calls.push(sql);
					if (sql === 'BEGIN IMMEDIATE') throw new Error('sql.execute not allowed');
				}
			},
			[
				async (db) => {
					await db.execute('UPSERT ONE');
				},
				async (db) => {
					await db.execute('DELETE STALE');
				}
			]
		);

		expect(calls).toEqual(['BEGIN IMMEDIATE', 'UPSERT ONE', 'DELETE STALE']);
	});

	test('falls back to sequential operations when commit reports no active transaction', async () => {
		const calls: string[] = [];

		await runSqlBatchWithTransaction(
			{
				async execute(sql) {
					calls.push(sql);
					if (sql === 'COMMIT') throw new Error('cannot commit - no transaction is active');
				}
			},
			[
				async (db) => {
					await db.execute('UPSERT ONE');
				},
				async (db) => {
					await db.execute('DELETE STALE');
				}
			]
		);

		expect(calls).toEqual([
			'BEGIN IMMEDIATE',
			'UPSERT ONE',
			'DELETE STALE',
			'COMMIT',
			'ROLLBACK',
			'UPSERT ONE',
			'DELETE STALE'
		]);
	});

	test('rolls back and keeps operation errors visible', async () => {
		const calls: string[] = [];
		let message = '';

		try {
			await runSqlBatchWithTransaction(
				{
					async execute(sql) {
						calls.push(sql);
					}
				},
				[
					async (db) => {
						await db.execute('UPSERT ONE');
					},
					async () => {
						throw new Error('payload failed');
					}
				]
			);
		} catch (err) {
			message = err instanceof Error ? err.message : String(err);
		}

		expect(message).toBe('payload failed');
		expect(calls).toEqual(['BEGIN IMMEDIATE', 'UPSERT ONE', 'ROLLBACK']);
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
