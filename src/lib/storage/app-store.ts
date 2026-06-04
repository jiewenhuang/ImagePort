import { load, type Store } from '@tauri-apps/plugin-store';
import type { AppSettings } from '$lib/domain/settings';
import type { InputImage, MaskDraft, TaskParams } from '$lib/domain/types';
import { canUseTauriPlugins } from './runtime';

const STORE_PATH = 'imageport-settings.json';
const SETTINGS_KEY = 'gallery.settings';
const INPUT_DRAFT_KEY = 'gallery.inputDraft';

export interface InputDraftSnapshot {
	prompt: string;
	params: TaskParams;
	inputImages: InputImage[];
	mask: MaskDraft | null;
}

let storePromise: Promise<Store | null> | null = null;

async function getAppStore(): Promise<Store | null> {
	if (!canUseTauriPlugins()) return null;
	storePromise ??= load(STORE_PATH, { defaults: {}, autoSave: 100 });
	return storePromise;
}

export async function loadStoredSettings(): Promise<unknown | null> {
	const store = await getAppStore();
	if (!store) return null;
	return (await store.get(SETTINGS_KEY)) ?? null;
}

export async function saveStoredSettings(settings: AppSettings): Promise<boolean> {
	const store = await getAppStore();
	if (!store) return false;
	await store.set(SETTINGS_KEY, settings);
	await store.save();
	return true;
}

export async function loadStoredInputDraft(): Promise<unknown | null> {
	const store = await getAppStore();
	if (!store) return null;
	return (await store.get(INPUT_DRAFT_KEY)) ?? null;
}

export async function saveStoredInputDraft(draft: InputDraftSnapshot): Promise<boolean> {
	const store = await getAppStore();
	if (!store) return false;
	await store.set(INPUT_DRAFT_KEY, draft);
	await store.save();
	return true;
}

export async function deleteStoredInputDraft(): Promise<boolean> {
	const store = await getAppStore();
	if (!store) return false;
	await store.delete(INPUT_DRAFT_KEY);
	await store.save();
	return true;
}
