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

export function formatLoadedTaskCount(loadedCount: number, totalCount: number | null) {
	const loaded = normalizeCount(loadedCount);
	const total = normalizeCount(totalCount);
	return total > loaded ? `${loaded} / ${total}` : String(loaded);
}

export function getTaskStorageEstimateLabel(loadedCount: number, totalCount: number | null) {
	return normalizeCount(totalCount) > normalizeCount(loadedCount) ? '已加载任务导出 JSON 估算' : '导出 JSON 估算';
}

export function shouldRefreshStorageBytesForTab(tab: GallerySettingsStorageTab) {
	return tab === 'data' || tab === 'about';
}

function normalizeCount(value: number | null | undefined) {
	return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}
