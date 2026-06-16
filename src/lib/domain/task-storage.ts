import {
	DEFAULT_PARAMS,
	normalizeOutputImageCount,
	type InputImage,
	type MaskDraft,
	type TaskParams,
	type TaskRecord
} from './types';

export interface ExportedTasks {
	version: 1;
	tasks: TaskRecord[];
	exportedAt: number;
}

export interface TaskImportSummary {
	tasks: TaskRecord[];
	addedCount: number;
	skippedDuplicateCount: number;
}

export interface TaskSnapshotPersistenceOptions {
	allowEmpty?: boolean;
}

export interface AsyncTaskStorageEstimateOptions {
	batchSize?: number;
	signal?: AbortSignal;
	yieldToMainThread?: () => Promise<void>;
}

export function normalizeTasks(value: unknown): TaskRecord[] {
	if (!Array.isArray(value)) return [];
	return value.map(normalizeTask).filter((task): task is TaskRecord => task != null);
}

export function buildExportedTasks(tasks: TaskRecord[]): ExportedTasks {
	return {
		version: 1,
		tasks: normalizeTasks(tasks),
		exportedAt: Date.now()
	};
}

export function parseImportedTasks(text: string): TaskRecord[] {
	const parsed = JSON.parse(text) as unknown;
	if (isRecord(parsed) && Array.isArray(parsed.tasks)) return normalizeTasks(parsed.tasks);
	return normalizeTasks(parsed);
}

export function resolveStoredTasks(primaryTasks: TaskRecord[] | null, fallbackValue: unknown): TaskRecord[] {
	if (primaryTasks === null) return normalizeTasks(fallbackValue);
	if (primaryTasks.length > 0) return primaryTasks;
	const fallbackTasks = normalizeTasks(fallbackValue);
	return fallbackTasks.length ? fallbackTasks : primaryTasks;
}

export function mergeTaskSnapshots(preferredTasks: TaskRecord[], fallbackTasks: TaskRecord[]): TaskRecord[] {
	const merged = new Map<string, TaskRecord>();
	for (const task of normalizeTasks(preferredTasks)) merged.set(task.id, task);
	for (const task of normalizeTasks(fallbackTasks)) {
		if (!merged.has(task.id)) merged.set(task.id, task);
	}
	return [...merged.values()].sort((a, b) => b.createdAt - a.createdAt);
}

export function shouldPersistTaskSnapshot(tasks: TaskRecord[], options: TaskSnapshotPersistenceOptions = {}): boolean {
	return normalizeTasks(tasks).length > 0 || options.allowEmpty === true;
}

export function createTaskImportSummary(existingTasks: TaskRecord[], importedTasks: TaskRecord[]): TaskImportSummary {
	const existingIds = new Set(existingTasks.map((task) => task.id));
	const uniqueImported = importedTasks.filter((task) => !existingIds.has(task.id));
	return {
		tasks: [...uniqueImported, ...existingTasks].sort((a, b) => b.createdAt - a.createdAt),
		addedCount: uniqueImported.length,
		skippedDuplicateCount: importedTasks.length - uniqueImported.length
	};
}

export function estimateTasksStorageBytes(tasks: TaskRecord[]): number {
	return new Blob([JSON.stringify(normalizeTasks(tasks))]).size;
}

export async function estimateTasksStorageBytesAsync(
	tasks: TaskRecord[],
	options: AsyncTaskStorageEstimateOptions = {}
): Promise<number | null> {
	const batchSize = Math.max(1, Math.trunc(options.batchSize ?? 8));
	const yieldToMainThread = options.yieldToMainThread ?? defaultYieldToMainThread;
	let bytes = 1;
	let taskCount = 0;

	for (let index = 0; index < tasks.length; index += 1) {
		if (options.signal?.aborted) return null;
		const normalizedTask = normalizeTask(tasks[index]);
		if (normalizedTask != null) {
			if (taskCount > 0) bytes += 1;
			bytes += estimateJsonBytes(normalizedTask);
			taskCount += 1;
		}
		if ((index + 1) % batchSize === 0 && index < tasks.length - 1) {
			await yieldToMainThread();
			if (options.signal?.aborted) return null;
		}
	}

	return bytes + 1;
}

function defaultYieldToMainThread(): Promise<void> {
	return new Promise((resolve) => {
		globalThis.setTimeout(resolve, 0);
	});
}

function estimateJsonBytes(value: unknown): number {
	if (value === null) return 4;
	if (typeof value === 'string') return estimateJsonStringBytes(value);
	if (typeof value === 'number') return Number.isFinite(value) ? String(value).length : 4;
	if (typeof value === 'boolean') return value ? 4 : 5;
	if (Array.isArray(value)) return estimateJsonArrayBytes(value);
	if (isRecord(value)) return estimateJsonObjectBytes(value);
	return 0;
}

function estimateJsonArrayBytes(values: unknown[]): number {
	let bytes = 2;
	values.forEach((value, index) => {
		if (index > 0) bytes += 1;
		bytes += value === undefined || typeof value === 'function' || typeof value === 'symbol' ? 4 : estimateJsonBytes(value);
	});
	return bytes;
}

function estimateJsonObjectBytes(value: Record<string, unknown>): number {
	let bytes = 2;
	let count = 0;
	for (const [key, item] of Object.entries(value)) {
		if (item === undefined || typeof item === 'function' || typeof item === 'symbol') continue;
		if (count > 0) bytes += 1;
		bytes += estimateJsonStringBytes(key) + 1 + estimateJsonBytes(item);
		count += 1;
	}
	return bytes;
}

function estimateJsonStringBytes(value: string): number {
	if (value.startsWith('data:')) return value.length + 2;
	let bytes = 2;
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if (code === 0x22 || code === 0x5c) {
			bytes += 2;
			continue;
		}
		if (code === 0x08 || code === 0x09 || code === 0x0a || code === 0x0c || code === 0x0d) {
			bytes += 2;
			continue;
		}
		if (code < 0x20) {
			bytes += 6;
			continue;
		}
		if (code >= 0xd800 && code <= 0xdbff) {
			const nextCode = value.charCodeAt(index + 1);
			if (nextCode >= 0xdc00 && nextCode <= 0xdfff) {
				bytes += 4;
				index += 1;
			} else {
				bytes += 6;
			}
			continue;
		}
		if (code >= 0xdc00 && code <= 0xdfff) {
			bytes += 6;
			continue;
		}
		if (code <= 0x7f) bytes += 1;
		else if (code <= 0x7ff) bytes += 2;
		else bytes += 3;
	}
	return bytes;
}

function normalizeTask(value: unknown): TaskRecord | null {
	if (!isRecord(value)) return null;
	const id = getString(value.id, '');
	const prompt = getString(value.prompt, '');
	if (!id || !prompt) return null;
	const createdAt = getNumber(value.createdAt, Date.now());
	const status = normalizeTaskStatus(value.status);
	const wasRunning = status === 'running';

	return {
		id,
		prompt,
		params: normalizeParams(value.params),
		inputImages: normalizeInputImages(value.inputImages),
		mask: normalizeMask(value.mask),
		images: normalizeStringArray(value.images),
		thumbnailImages: normalizeStringArray(value.thumbnailImages),
		status: wasRunning ? 'error' : status,
		error: wasRunning ? '任务在应用关闭或刷新时中断' : getNullableString(value.error),
		createdAt,
		finishedAt: wasRunning ? createdAt : getNullableNumber(value.finishedAt),
		failureCount: getNumber(value.failureCount, 0),
		isFavorite: getBoolean(value.isFavorite, false),
		favoriteCollectionIds: normalizeStringArray(value.favoriteCollectionIds),
		actualParams: normalizePartialParams(value.actualParams),
		actualParamsByImage: normalizeParamsRecord(value.actualParamsByImage),
		revisedPromptByImage: normalizeStringRecord(value.revisedPromptByImage),
		apiProfileId: getNullableString(value.apiProfileId),
		apiProfileName: getNullableString(value.apiProfileName),
		apiProvider: getNullableString(value.apiProvider),
		apiMode: normalizeApiMode(value.apiMode),
		model: getNullableString(value.model),
		rawImageUrls: normalizeStringArray(value.rawImageUrls),
		rawResponsePayload: getNullableString(value.rawResponsePayload),
		streamPartialImageIds: normalizeStringArray(value.streamPartialImageIds),
		sourceMode: value.sourceMode === 'agent' ? 'agent' : value.sourceMode === 'gallery' ? 'gallery' : null,
		agentConversationId: getNullableString(value.agentConversationId),
		agentRoundId: getNullableString(value.agentRoundId),
		agentMessageId: getNullableString(value.agentMessageId),
		agentToolCallId: getNullableString(value.agentToolCallId),
		agentToolAction: getNullableString(value.agentToolAction)
	};
}

function normalizeParams(value: unknown): TaskParams {
	const record = isRecord(value) ? value : {};
	return {
		size: getString(record.size, DEFAULT_PARAMS.size),
		quality: isQuality(record.quality) ? record.quality : DEFAULT_PARAMS.quality,
		output_format: isOutputFormat(record.output_format) ? record.output_format : DEFAULT_PARAMS.output_format,
		output_compression:
			typeof record.output_compression === 'number' && Number.isFinite(record.output_compression)
				? Math.min(100, Math.max(0, Math.trunc(record.output_compression)))
				: null,
		moderation: isModeration(record.moderation) ? record.moderation : DEFAULT_PARAMS.moderation,
		n: normalizeOutputImageCount(record.n)
	};
}

function normalizeInputImages(value: unknown): InputImage[] {
	if (!Array.isArray(value)) return [];
	return value
		.filter(isRecord)
		.map((image) => ({
			id: getString(image.id, ''),
			name: getString(image.name, 'input.png'),
			dataUrl: getString(image.dataUrl, '')
		}))
		.filter((image) => image.id && image.dataUrl);
}

function normalizeMask(value: unknown): MaskDraft | null {
	if (!isRecord(value)) return null;
	const targetImageId = getString(value.targetImageId, '');
	const dataUrl = getString(value.dataUrl, '');
	if (!targetImageId || !dataUrl) return null;
	return {
		targetImageId,
		dataUrl,
		updatedAt: getNumber(value.updatedAt, Date.now())
	};
}

function normalizeTaskStatus(value: unknown): TaskRecord['status'] {
	if (value === 'running' || value === 'done' || value === 'partial' || value === 'error') return value;
	return 'done';
}

function normalizeStringArray(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
		: [];
}

function normalizePartialParams(value: unknown): Partial<TaskParams> | null {
	if (!isRecord(value)) return null;
	const params: Partial<TaskParams> = {};
	if (typeof value.size === 'string' && value.size.trim()) params.size = value.size;
	if (isQuality(value.quality)) params.quality = value.quality;
	if (isOutputFormat(value.output_format)) params.output_format = value.output_format;
	if (typeof value.output_compression === 'number' && Number.isFinite(value.output_compression)) {
		params.output_compression = Math.min(100, Math.max(0, Math.trunc(value.output_compression)));
	}
	if (isModeration(value.moderation)) params.moderation = value.moderation;
	const count = normalizeOutputImageCount(value.n, null);
	if (count != null) params.n = count;
	return Object.keys(params).length ? params : null;
}

function normalizeParamsRecord(value: unknown): Record<string, Partial<TaskParams>> {
	if (!isRecord(value)) return {};
	const entries = Object.entries(value)
		.map(([key, params]) => [key, normalizePartialParams(params)] as const)
		.filter((entry): entry is readonly [string, Partial<TaskParams>] => Boolean(entry[0].trim()) && entry[1] != null);
	return Object.fromEntries(entries);
}

function normalizeStringRecord(value: unknown): Record<string, string> {
	if (!isRecord(value)) return {};
	const entries = Object.entries(value).filter(
		(entry): entry is [string, string] =>
			Boolean(entry[0].trim()) && typeof entry[1] === 'string' && entry[1].trim().length > 0
	);
	return Object.fromEntries(entries);
}

function normalizeApiMode(value: unknown): TaskRecord['apiMode'] {
	if (value === 'images' || value === 'responses') return value;
	return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getString(value: unknown, fallback: string): string {
	return typeof value === 'string' && value.trim() ? value : fallback;
}

function getNullableString(value: unknown): string | null {
	return typeof value === 'string' && value.trim() ? value : null;
}

function getNumber(value: unknown, fallback: number): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function getBoolean(value: unknown, fallback: boolean): boolean {
	return typeof value === 'boolean' ? value : fallback;
}

function getNullableNumber(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isQuality(value: unknown): value is TaskParams['quality'] {
	return value === 'auto' || value === 'low' || value === 'medium' || value === 'high';
}

function isOutputFormat(value: unknown): value is TaskParams['output_format'] {
	return value === 'png' || value === 'jpeg' || value === 'webp';
}

function isModeration(value: unknown): value is TaskParams['moderation'] {
	return value === 'auto' || value === 'low';
}
