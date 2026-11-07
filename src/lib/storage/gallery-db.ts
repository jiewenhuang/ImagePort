import Database from '@tauri-apps/plugin-sql';
import { invoke } from '@tauri-apps/api/core';
import { normalizeAgentConversations, type AgentConversation } from '$lib/domain/agent';
import {
	normalizeTasks,
	shouldPersistTaskSnapshot,
	type TaskSnapshotPersistenceOptions
} from '$lib/domain/task-storage';
import type { StoredTaskMedia, TaskRecord } from '$lib/domain/types';
import {
	listStoredImages,
	readDataUrlImage,
	removeStoredImage,
	saveDataUrlImage,
	type StoredImageFile,
	type StoredImageKind
} from './image-files';
import { canUseTauriPlugins } from './runtime';

const DB_PATH = 'sqlite:imageport.db';

export interface TaskRow {
	id: string;
	payload: string;
}

interface AgentConversationRow {
	id: string;
	payload: string;
}

interface GalleryDbExecutor {
	execute(sql: string, values?: unknown[]): Promise<unknown>;
}

export interface GalleryDbSelector {
	select<T>(sql: string, values?: unknown[]): Promise<T>;
}

export interface StoredTaskPageRequest {
	offset?: number;
	limit?: number;
}

export interface StoredTaskPage {
	tasks: TaskRecord[];
	offset: number;
	limit: number;
	total: number;
	hasMore: boolean;
}

export interface TaskImageFileStore {
	save(kind: StoredImageKind, id: string, dataUrl: string): Promise<StoredImageFile | null>;
	read(file: StoredImageFile): Promise<string | null>;
}

export interface StoredImageFileIndex {
	list(): Promise<StoredImageFile[]>;
	remove(file: StoredImageFile): Promise<boolean>;
}

export type ThumbnailGenerator = (dataUrl: string) => Promise<string>;

export interface CleanupImageFilesResult {
	removedCount: number;
	failedCount: number;
}

export interface FileBackedTaskPayload {
	version: 2;
	task: Omit<TaskRecord, 'images' | 'thumbnailImages' | 'inputImages' | 'mask'> & {
		images: string[];
		thumbnailImages: string[];
		inputImages: Array<Omit<TaskRecord['inputImages'][number], 'dataUrl'> & { dataUrl: string }>;
		mask: null;
	};
	imageRefs: StoredTaskMedia;
}

const tauriImageFileStore: TaskImageFileStore = {
	save: saveDataUrlImage,
	read: readDataUrlImage
};

const tauriImageFileIndex: StoredImageFileIndex = {
	list: listStoredImages,
	remove: removeStoredImage
};

let dbPromise: Promise<Database | null> | null = null;
let saveQueue: Promise<boolean> = Promise.resolve(true);
let agentSaveQueue: Promise<boolean> = Promise.resolve(true);

export async function getGalleryDb(): Promise<Database | null> {
	if (!canUseTauriPlugins()) return null;
	dbPromise ??= initGalleryDb();
	return dbPromise;
}

async function initGalleryDb(): Promise<Database> {
	const db = await Database.load(DB_PATH);
	await db.execute(`
		CREATE TABLE IF NOT EXISTS gallery_tasks (
			id TEXT PRIMARY KEY,
			prompt TEXT NOT NULL,
			status TEXT NOT NULL,
			created_at INTEGER NOT NULL,
			finished_at INTEGER,
			payload TEXT NOT NULL,
			updated_at INTEGER NOT NULL
		)
	`);
	await db.execute('CREATE INDEX IF NOT EXISTS idx_gallery_tasks_created_at ON gallery_tasks(created_at DESC)');
	await db.execute('CREATE INDEX IF NOT EXISTS idx_gallery_tasks_status ON gallery_tasks(status)');
	await db.execute(`
		CREATE TABLE IF NOT EXISTS agent_conversations (
			id TEXT PRIMARY KEY,
			title TEXT NOT NULL,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL,
			payload TEXT NOT NULL
		)
	`);
	await db.execute(
		'CREATE INDEX IF NOT EXISTS idx_agent_conversations_updated_at ON agent_conversations(updated_at DESC)'
	);

	return db;
}

export async function loadStoredTasks(media: 'full' | 'preview' = 'full'): Promise<TaskRecord[] | null> {
	const db = await getGalleryDb();
	if (!db) return null;
	const rows = await selectStoredTaskRows(db, media);
	const payloads = await Promise.all(rows.map((row) => hydrateStoredPayload(row.payload, tauriImageFileStore, media)));
	const tasks = normalizeTasks(payloads);
	if (tasks.length !== rows.length) throw new Error('部分历史记录无法读取，已停止本次数据操作，请从备份恢复。');
	return tasks;
}

export async function loadStoredTasksPage(input: StoredTaskPageRequest = {}): Promise<StoredTaskPage | null> {
	const db = await getGalleryDb();
	if (!db) return null;
	const offset = normalizePaginationNumber(input.offset, 0, 0, Number.MAX_SAFE_INTEGER);
	const limit = normalizePaginationNumber(input.limit, 48, 1, 500);
	const [total, rows] = await Promise.all([countTaskRows(db), selectTaskRowsPage(db, { offset, limit })]);
	const payloads = await Promise.all(
		rows.map((row) => hydrateStoredPayload(row.payload, tauriImageFileStore, 'preview'))
	);
	return {
		tasks: normalizeTasks(payloads),
		offset,
		limit,
		total,
		hasMore: offset + rows.length < total
	};
}

export async function loadStoredTask(taskId: string): Promise<TaskRecord | null> {
	await saveQueue;
	const db = await getGalleryDb();
	if (!db) return null;
	const rows = await db.select<TaskRow[]>('SELECT id, payload FROM gallery_tasks WHERE id = $1', [taskId]);
	if (!rows[0]) return null;
	return normalizeTasks([await hydrateStoredPayload(rows[0].payload, tauriImageFileStore)])[0] ?? null;
}

export async function saveStoredTasks(
	tasks: TaskRecord[],
	options: TaskSnapshotPersistenceOptions = {}
): Promise<boolean> {
	const normalizedTasks = normalizeTasks(tasks);
	if (!shouldPersistTaskSnapshot(normalizedTasks, options)) return false;
	saveQueue = saveQueue.catch(() => true).then(() => saveStoredTasksNow(normalizedTasks));
	return saveQueue;
}

export async function saveStoredTask(task: TaskRecord): Promise<boolean> {
	const normalizedTask = normalizeTasks([task])[0];
	if (!normalizedTask) return false;
	saveQueue = saveQueue.catch(() => true).then(() => saveStoredTaskNow(normalizedTask));
	return saveQueue;
}

export async function deleteStoredTasks(taskIds: string[]): Promise<boolean> {
	const ids = [...new Set(taskIds.filter((id) => id.trim().length > 0))];
	if (!ids.length) return true;
	saveQueue = saveQueue.catch(() => true).then(() => deleteStoredTasksNow(ids));
	return saveQueue;
}

async function saveStoredTasksNow(normalizedTasks: TaskRecord[]): Promise<boolean> {
	const db = await getGalleryDb();
	if (!db) return false;
	const rows = await Promise.all(
		normalizedTasks.map(async (task) => ({
			task,
			payload: await createFileBackedTaskPayload(task, tauriImageFileStore)
		}))
	);
	await invoke('save_workspace_snapshot', {
		snapshot: {
			kind: 'tasks',
			rows: rows.map(({ task, payload }) => ({
				id: task.id,
				prompt: task.prompt,
				status: task.status,
				createdAt: task.createdAt,
				finishedAt: task.finishedAt,
				payload: JSON.stringify(payload),
				updatedAt: Date.now(),
				preserveRawResponse: !!task.storedMedia
			}))
		}
	});
	return true;
}

async function saveStoredTaskNow(normalizedTask: TaskRecord): Promise<boolean> {
	const db = await getGalleryDb();
	if (!db) return false;
	const payload = await createFileBackedTaskPayload(normalizedTask, tauriImageFileStore);
	await upsertTaskRow(db, normalizedTask, payload);
	return true;
}

async function deleteStoredTasksNow(taskIds: string[]): Promise<boolean> {
	const db = await getGalleryDb();
	if (!db) return false;
	await deleteTaskRows(db, taskIds);
	return true;
}

export async function clearStoredTasks(): Promise<boolean> {
	const db = await getGalleryDb();
	if (!db) return false;
	await db.execute('DELETE FROM gallery_tasks');
	return true;
}

export async function loadStoredAgentConversations(): Promise<AgentConversation[] | null> {
	const db = await getGalleryDb();
	if (!db) return null;
	const rows = await db.select<AgentConversationRow[]>(
		'SELECT id, payload FROM agent_conversations ORDER BY updated_at DESC'
	);
	return normalizeAgentConversations(rows.map((row) => parseTaskPayload(row.payload)));
}

export async function saveStoredAgentConversations(conversations: AgentConversation[]): Promise<boolean> {
	const normalized = normalizeAgentConversations(conversations);
	agentSaveQueue = agentSaveQueue.catch(() => true).then(() => saveStoredAgentConversationsNow(normalized));
	return agentSaveQueue;
}

async function saveStoredAgentConversationsNow(conversations: AgentConversation[]): Promise<boolean> {
	const db = await getGalleryDb();
	if (!db) return false;
	await invoke('save_workspace_snapshot', {
		snapshot: {
			kind: 'agentConversations',
			rows: conversations.map((conversation) => ({
				id: conversation.id,
				title: conversation.title,
				createdAt: conversation.createdAt,
				updatedAt: conversation.updatedAt,
				payload: JSON.stringify(conversation)
			}))
		}
	});
	return true;
}

export function createAgentConversationRow(conversation: AgentConversation): unknown[] {
	return [
		conversation.id,
		conversation.title,
		conversation.createdAt,
		conversation.updatedAt,
		JSON.stringify(conversation)
	];
}

export async function upsertTaskRow(db: GalleryDbExecutor, task: TaskRecord, payload: unknown): Promise<void> {
	// Preview records omit the potentially very large provider response. Keep it in SQLite when only metadata changes.
	const updatedPayload = task.storedMedia
		? "json_set(excluded.payload, '$.task.rawResponsePayload', json_extract(gallery_tasks.payload, '$.task.rawResponsePayload'))"
		: 'excluded.payload';
	await db.execute(
		`INSERT INTO gallery_tasks (id, prompt, status, created_at, finished_at, payload, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7)
		 ON CONFLICT(id) DO UPDATE SET
			prompt = excluded.prompt,
			status = excluded.status,
			created_at = excluded.created_at,
			finished_at = excluded.finished_at,
			payload = ${updatedPayload},
			updated_at = excluded.updated_at`,
		serializeTaskRow(task, payload)
	);
}

export async function deleteTaskRows(db: GalleryDbExecutor, taskIds: string[]): Promise<void> {
	const ids = [...new Set(taskIds.filter((id) => id.trim().length > 0))];
	if (!ids.length) return;
	const placeholders = ids.map((_, index) => `$${index + 1}`).join(', ');
	await db.execute(`DELETE FROM gallery_tasks WHERE id IN (${placeholders})`, ids);
}

export async function selectTaskRowsPage(
	db: GalleryDbSelector,
	input: Required<StoredTaskPageRequest>
): Promise<TaskRow[]> {
	return db.select<TaskRow[]>(
		"SELECT id, json_remove(payload, '$.task.rawResponsePayload') AS payload FROM gallery_tasks ORDER BY created_at DESC LIMIT $1 OFFSET $2",
		[input.limit, input.offset]
	);
}

export async function selectStoredTaskRows(
	db: GalleryDbSelector,
	media: 'full' | 'preview' = 'full'
): Promise<TaskRow[]> {
	const payload = media === 'preview' ? "json_remove(payload, '$.task.rawResponsePayload')" : 'payload';
	return db.select<TaskRow[]>(`SELECT id, ${payload} AS payload FROM gallery_tasks ORDER BY created_at DESC`);
}

export async function countTaskRows(db: GalleryDbSelector): Promise<number> {
	const rows = await db.select<Array<{ count: number | string | null }>>('SELECT COUNT(*) as count FROM gallery_tasks');
	const count = Number(rows[0]?.count ?? 0);
	return Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
}

export async function deleteTaskImageFiles(task: TaskRecord): Promise<void> {
	const payload = await createFileBackedTaskPayload(task, {
		async save(kind, id, dataUrl) {
			return buildStoredImageReference(kind, id, dataUrl);
		},
		read: tauriImageFileStore.read
	});
	const files = getTaskPayloadImageFiles(payload);
	await Promise.all(files.map((file) => removeStoredImage(file)));
}

export async function cleanupUnreferencedTaskImageFiles(
	tasks: TaskRecord[],
	index: StoredImageFileIndex = tauriImageFileIndex,
	readStoredRows: () => Promise<TaskRow[]> = loadAllStoredTaskRows
): Promise<CleanupImageFilesResult> {
	const referencedPaths = new Set<string>();
	for (const task of normalizeTasks(tasks)) {
		const payload = await createFileBackedTaskPayload(task, {
			async save(kind, id, dataUrl) {
				return buildStoredImageReference(kind, id, dataUrl);
			},
			read: tauriImageFileStore.read
		});
		for (const file of getTaskPayloadImageFiles(payload)) referencedPaths.add(file.path);
	}

	for (const row of await readStoredRows()) {
		const payload = parseTaskPayload(row.payload);
		if (!payload || (!isFileBackedTaskPayload(payload) && !normalizeTasks([payload]).length)) {
			throw new Error('历史记录无法读取，已暂停图片清理。');
		}
		if (isFileBackedTaskPayload(payload)) {
			for (const file of getTaskPayloadImageFiles(payload)) referencedPaths.add(file.path);
		}
	}

	const storedFiles = await index.list();
	const unreferencedFiles = storedFiles.filter(
		(file) => file.mime !== 'inline/data-url' && !referencedPaths.has(file.path)
	);
	const results = await Promise.all(unreferencedFiles.map((file) => index.remove(file)));
	const removedCount = results.filter(Boolean).length;
	return {
		removedCount,
		failedCount: results.length - removedCount
	};
}

async function loadAllStoredTaskRows(): Promise<TaskRow[]> {
	await saveQueue;
	const db = await getGalleryDb();
	return db ? selectStoredTaskRows(db, 'preview') : [];
}

export function serializeTaskRow(task: TaskRecord, payload: unknown = task): unknown[] {
	return [task.id, task.prompt, task.status, task.createdAt, task.finishedAt, JSON.stringify(payload), Date.now()];
}

export function parseTaskPayload(payload: string): unknown {
	try {
		return JSON.parse(payload) as unknown;
	} catch {
		return null;
	}
}

export async function createFileBackedTaskPayload(
	task: TaskRecord,
	files: TaskImageFileStore,
	createThumbnail: ThumbnailGenerator = createThumbnailDataUrl
): Promise<FileBackedTaskPayload> {
	if (task.storedMedia) {
		const { storedMedia, ...metadata } = task;
		return {
			version: 2,
			task: { ...metadata, images: [], thumbnailImages: [], streamPartialImageIds: [], inputImages: [], mask: null },
			imageRefs: storedMedia
		};
	}
	const outputRefs = await Promise.all(
		task.images.map((image, index) => saveTaskImage(files, 'outputs', `${task.id}-${index + 1}`, image))
	);
	const thumbnailSources = task.thumbnailImages?.length
		? task.thumbnailImages
		: await Promise.all(task.images.map(createThumbnail));
	const thumbnailRefs = await Promise.all(
		thumbnailSources.map((image, index) => saveTaskImage(files, 'thumbs', `${task.id}-${index + 1}`, image))
	);
	const partialRefs = await Promise.all(
		task.streamPartialImageIds.map((image, index) => saveTaskImage(files, 'partials', `${task.id}-${index + 1}`, image))
	);
	const inputRefs = await Promise.all(
		task.inputImages.map(async (image) => ({
			id: image.id,
			name: image.name,
			...(await saveTaskImage(files, 'inputs', `${task.id}-${image.id}`, image.dataUrl))
		}))
	);
	const maskRef = task.mask
		? {
				targetImageId: task.mask.targetImageId,
				updatedAt: task.mask.updatedAt,
				...(await saveTaskImage(files, 'masks', `${task.id}-${task.mask.targetImageId}`, task.mask.dataUrl))
			}
		: null;

	return {
		version: 2,
		task: {
			...task,
			images: [],
			thumbnailImages: [],
			streamPartialImageIds: [],
			inputImages: task.inputImages.map((image) => ({ ...image, dataUrl: '' })),
			mask: null
		},
		imageRefs: {
			outputs: outputRefs,
			thumbnails: thumbnailRefs,
			partials: partialRefs,
			inputs: inputRefs,
			mask: maskRef
		}
	};
}

export async function previewFileBackedTaskPayload(
	payload: FileBackedTaskPayload,
	files: TaskImageFileStore
): Promise<TaskRecord> {
	// Older file-backed records may not yet have thumbnails.
	const thumbnailFiles = payload.imageRefs.thumbnails?.length
		? payload.imageRefs.thumbnails
		: payload.imageRefs.outputs;
	const thumbnails = (await Promise.all(thumbnailFiles.map((file) => files.read(file)))).filter(
		(image): image is string => Boolean(image)
	);
	const partialFiles = payload.imageRefs.outputs.length ? [] : (payload.imageRefs.partials ?? []).slice(-1);
	const partials = (await Promise.all(partialFiles.map((file) => files.read(file)))).filter((image): image is string =>
		Boolean(image)
	);
	return {
		...payload.task,
		images: thumbnails,
		thumbnailImages: thumbnails,
		inputImages: [],
		mask: null,
		streamPartialImageIds: partials.length ? partials : (payload.task.streamPartialImageIds ?? []),
		storedMedia: { ...payload.imageRefs, thumbnails: payload.imageRefs.thumbnails ?? [] }
	};
}

export async function hydrateFileBackedTaskPayload(
	payload: FileBackedTaskPayload,
	files: TaskImageFileStore
): Promise<TaskRecord | null> {
	const images = await Promise.all(payload.imageRefs.outputs.map((file) => files.read(file)));
	const thumbnailFiles = payload.imageRefs.thumbnails ?? payload.imageRefs.outputs;
	const thumbnailImages = await Promise.all(thumbnailFiles.map((file) => files.read(file)));
	const partialImageRefs = Array.isArray(payload.imageRefs.partials) ? payload.imageRefs.partials : null;
	const partialImages = partialImageRefs
		? await Promise.all(partialImageRefs.map((file) => files.read(file)))
		: (payload.task.streamPartialImageIds ?? []);
	const inputImages = await Promise.all(
		payload.imageRefs.inputs.map(async (file) => ({
			id: file.id,
			name: file.name,
			dataUrl: (await files.read(file)) ?? ''
		}))
	);
	const mask = payload.imageRefs.mask
		? {
				targetImageId: payload.imageRefs.mask.targetImageId,
				dataUrl: (await files.read(payload.imageRefs.mask)) ?? '',
				updatedAt: payload.imageRefs.mask.updatedAt
			}
		: null;

	const missingOutputs = images.filter((image) => !image).length;
	const missingInputs = inputImages.filter((image) => !image.dataUrl).length;
	const missingMask = Boolean(payload.imageRefs.mask && !mask?.dataUrl);
	if (missingOutputs || missingInputs || missingMask) {
		throw new Error(
			`本地图片文件缺失（输出 ${missingOutputs}、参考图 ${missingInputs}、蒙版 ${missingMask ? 1 : 0}），请从备份恢复后再操作。`
		);
	}

	return {
		...payload.task,
		images: images.filter((image): image is string => typeof image === 'string' && image.length > 0),
		thumbnailImages: thumbnailImages.filter((image): image is string => typeof image === 'string' && image.length > 0),
		streamPartialImageIds: partialImages.filter(
			(image): image is string => typeof image === 'string' && image.length > 0
		),
		inputImages: inputImages.filter((image) => image.dataUrl),
		mask: mask?.dataUrl ? mask : null
	};
}

async function hydrateStoredPayload(
	payload: string,
	files: TaskImageFileStore,
	media: 'full' | 'preview' = 'full'
): Promise<unknown> {
	const parsed = parseTaskPayload(payload);
	if (isFileBackedTaskPayload(parsed)) {
		return media === 'preview'
			? previewFileBackedTaskPayload(parsed, files)
			: hydrateFileBackedTaskPayload(parsed, files);
	}
	return parsed;
}

async function saveTaskImage(
	files: TaskImageFileStore,
	kind: StoredImageKind,
	id: string,
	dataUrl: string
): Promise<StoredImageFile> {
	const file = await files.save(kind, id, dataUrl);
	if (!file) return { path: dataUrl, mime: 'inline/data-url' };
	return file;
}

function buildStoredImageReference(kind: StoredImageKind, id: string, dataUrl: string): StoredImageFile {
	if (!dataUrl.startsWith('data:')) return { path: dataUrl, mime: 'inline/data-url' };
	const mime = /^data:([^;,]+);base64,/u.exec(dataUrl)?.[1] ?? 'image/png';
	const extension = mime === 'image/jpeg' ? 'jpg' : mime === 'image/webp' ? 'webp' : 'png';
	return {
		path: `images/${kind}/${id.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 96)}.${extension}`,
		mime
	};
}

async function createThumbnailDataUrl(dataUrl: string): Promise<string> {
	if (typeof document === 'undefined' || typeof Image === 'undefined') return dataUrl;
	try {
		const image = await loadBrowserImage(dataUrl);
		const maxSize = 512;
		const scale = Math.min(1, maxSize / Math.max(image.naturalWidth, image.naturalHeight));
		const width = Math.max(1, Math.round(image.naturalWidth * scale));
		const height = Math.max(1, Math.round(image.naturalHeight * scale));
		const canvas = document.createElement('canvas');
		canvas.width = width;
		canvas.height = height;
		const ctx = canvas.getContext('2d');
		if (!ctx) return dataUrl;
		ctx.drawImage(image, 0, 0, width, height);
		return canvas.toDataURL('image/webp', 0.82);
	} catch {
		return dataUrl;
	}
}

function loadBrowserImage(src: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const image = new Image();
		image.onload = () => resolve(image);
		image.onerror = () => reject(new Error('缩略图图片加载失败'));
		image.src = src;
	});
}

function getTaskPayloadImageFiles(payload: FileBackedTaskPayload): StoredImageFile[] {
	return [
		...payload.imageRefs.outputs,
		...(payload.imageRefs.thumbnails ?? []),
		...(payload.imageRefs.partials ?? []),
		...payload.imageRefs.inputs,
		...(payload.imageRefs.mask ? [payload.imageRefs.mask] : [])
	];
}

function isFileBackedTaskPayload(value: unknown): value is FileBackedTaskPayload {
	return Boolean(value) && typeof value === 'object' && (value as FileBackedTaskPayload).version === 2;
}

function normalizePaginationNumber(value: unknown, fallback: number, min: number, max: number): number {
	const numeric = typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : fallback;
	return Math.min(max, Math.max(min, numeric));
}
