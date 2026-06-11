import type { InputImage, MaskDraft, TaskParams } from './types';

export interface LegacyLocalStorageReader {
	getItem(key: string): string | null;
}

export interface NormalizedInputDraftSnapshot {
	prompt?: string;
	params?: Partial<TaskParams>;
	inputImages?: InputImage[];
	mask?: MaskDraft;
}

export function readLocalStorageJson(storage: LegacyLocalStorageReader, key: string): unknown | null {
	const value = storage.getItem(key);
	if (!value) return null;
	return JSON.parse(value) as unknown;
}

export function normalizeInputDraftSnapshot(value: unknown): NormalizedInputDraftSnapshot | null {
	if (!isRecord(value)) return null;
	const draft: NormalizedInputDraftSnapshot = {};
	if (typeof value.prompt === 'string') draft.prompt = value.prompt;
	if (isRecord(value.params)) draft.params = value.params as Partial<TaskParams>;
	if (Array.isArray(value.inputImages)) draft.inputImages = value.inputImages.filter(isInputImage);
	if (isRecord(value.mask)) draft.mask = value.mask as unknown as MaskDraft;
	return draft;
}

function isInputImage(value: unknown): value is InputImage {
	return isRecord(value) && typeof value.id === 'string' && typeof value.dataUrl === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
