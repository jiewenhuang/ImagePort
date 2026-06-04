import { isTauri } from '@tauri-apps/api/core';

export function canUseTauriPlugins(): boolean {
	try {
		return isTauri();
	} catch {
		return false;
	}
}
