import Database from '@tauri-apps/plugin-sql';
import { normalizeAgentConversations, type AgentConversation } from '$lib/domain/agent';
import {
	normalizeTasks,
	shouldPersistTaskSnapshot,
	type TaskSnapshotPersistenceOptions
} from '$lib/domain/task-storage';
import type { TaskRecord } from '$lib/domain/types';
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

interface TaskRow {
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
	imageRefs: {
		outputs: StoredImageFile[];
		thumbnails: StoredImageFile[];
		partials?: StoredImageFile[];
		inputs: Array<StoredImageFile & { id: string; name: string }>;
		mask: (StoredImageFile & { targetImageId: string; updatedAt: number }) | null;
	};
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

async function getGalleryDb(): Promise<Database | null> {
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

export async function loadStoredTasks(): Promise<TaskRecord[] | null> {
	const db = await getGalleryDb();
	if (!db) return null;
	const rows = await db.select<TaskRow[]>('SELECT id, payload FROM gallery_tasks ORDER BY created_at DESC');
	const payloads = await Promise.all(rows.map((row) => hydrateStoredPayload(row.payload, tauriImageFileStore)));
	return normalizeTasks(payloads);
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

async function saveStoredTasksNow(normalizedTasks: TaskRecord[]): Promise<boolean> {
	const db = await getGalleryDb();
	if (!db) return false;
	const rows = await Promise.all(
		normalizedTasks.map(async (task) => ({
			task,
			payload: await createFileBackedTaskPayload(task, tauriImageFileStore)
		}))
	);
	await runSqlBatchWithTransaction(db, [
		...rows.map(
			({ task, payload }) =>
				(executor: GalleryDbExecutor) =>
					upsertTaskRow(executor, task, payload)
		),
		(executor) =>
			deleteTasksOutsideSnapshot(
				executor,
				normalizedTasks.map((task) => task.id)
			)
	]);
	return true;
}

async function saveStoredTaskNow(normalizedTask: TaskRecord): Promise<boolean> {
	const db = await getGalleryDb();
	if (!db) return false;
	const payload = await createFileBackedTaskPayload(normalizedTask, tauriImageFileStore);
	await upsertTaskRow(db, normalizedTask, payload);
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
	await runSqlBatchWithTransaction(db, [
		...conversations.map(
			(conversation) => (executor: GalleryDbExecutor) =>
				executor.execute(
					`INSERT INTO agent_conversations (id, title, created_at, updated_at, payload)
				 VALUES ($1, $2, $3, $4, $5)
				 ON CONFLICT(id) DO UPDATE SET
					title = excluded.title,
					created_at = excluded.created_at,
					updated_at = excluded.updated_at,
					payload = excluded.payload`,
					createAgentConversationRow(conversation)
				)
		),
		(executor) =>
			deleteAgentConversationsOutsideSnapshot(
				executor,
				conversations.map((conversation) => conversation.id)
			)
	]);
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
	await db.execute(
		`INSERT INTO gallery_tasks (id, prompt, status, created_at, finished_at, payload, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7)
		 ON CONFLICT(id) DO UPDATE SET
			prompt = excluded.prompt,
			status = excluded.status,
			created_at = excluded.created_at,
			finished_at = excluded.finished_at,
			payload = excluded.payload,
			updated_at = excluded.updated_at`,
		serializeTaskRow(task, payload)
	);
}

export async function runSqlBatchWithTransaction(
	db: GalleryDbExecutor,
	operations: Array<(executor: GalleryDbExecutor) => Promise<unknown>>
): Promise<void> {
	try {
		await db.execute('BEGIN IMMEDIATE');
	} catch {
		await runSqlOperations(db, operations);
		return;
	}

	try {
		await runSqlOperations(db, operations);
	} catch (err) {
		await rollbackSqlTransaction(db);
		throw err;
	}

	try {
		await db.execute('COMMIT');
	} catch {
		await rollbackSqlTransaction(db);
		await runSqlOperations(db, operations);
	}
}

async function runSqlOperations(
	db: GalleryDbExecutor,
	operations: Array<(executor: GalleryDbExecutor) => Promise<unknown>>
): Promise<void> {
	for (const operation of operations) await operation(db);
}

async function rollbackSqlTransaction(db: GalleryDbExecutor): Promise<void> {
	try {
		await db.execute('ROLLBACK');
	} catch {
		// The sqlite plugin can report "no transaction is active" after a failed COMMIT; the fallback path is safer than surfacing rollback noise.
	}
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
	index: StoredImageFileIndex = tauriImageFileIndex
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

async function deleteTasksOutsideSnapshot(db: GalleryDbExecutor, keptIds: string[]): Promise<void> {
	if (keptIds.length === 0) {
		await db.execute('DELETE FROM gallery_tasks');
		return;
	}
	const placeholders = keptIds.map((_, index) => `$${index + 1}`).join(', ');
	await db.execute(`DELETE FROM gallery_tasks WHERE id NOT IN (${placeholders})`, keptIds);
}

async function deleteAgentConversationsOutsideSnapshot(db: GalleryDbExecutor, keptIds: string[]): Promise<void> {
	if (keptIds.length === 0) {
		await db.execute('DELETE FROM agent_conversations');
		return;
	}
	const placeholders = keptIds.map((_, index) => `$${index + 1}`).join(', ');
	await db.execute(`DELETE FROM agent_conversations WHERE id NOT IN (${placeholders})`, keptIds);
}

export async function createFileBackedTaskPayload(
	task: TaskRecord,
	files: TaskImageFileStore,
	createThumbnail: ThumbnailGenerator = createThumbnailDataUrl
): Promise<FileBackedTaskPayload> {
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

async function hydrateStoredPayload(payload: string, files: TaskImageFileStore): Promise<unknown> {
	const parsed = parseTaskPayload(payload);
	if (isFileBackedTaskPayload(parsed)) return hydrateFileBackedTaskPayload(parsed, files);
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
