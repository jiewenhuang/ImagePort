export type GallerySettingsStorageTab = 'general' | 'api' | 'agent' | 'data' | 'about';

export function formatStorageBytes(bytes: number | null) {
	if (bytes == null) return '计算中...';
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function getStorageBytesTone(bytes: number | null) {
	if (bytes != null && bytes >= 4 * 1024 * 1024) return 'text-amber-700';
	return 'text-muted-foreground';
}

export function shouldRefreshStorageBytesForTab(tab: GallerySettingsStorageTab) {
	return tab === 'data' || tab === 'about';
}
