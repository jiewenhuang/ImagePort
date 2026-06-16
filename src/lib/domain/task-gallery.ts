import type { TaskRecord } from './types';

export const TASK_PAGE_SIZE = 24;

export interface GalleryTaskFilter {
	status: 'all' | TaskRecord['status'];
	query: string;
	favoriteOnly?: boolean;
	favoriteCollectionId?: string | null;
}

export interface GalleryTaskPage extends GalleryTaskFilter {
	limit: number;
}

export interface TaskHydrationSkeletonState {
	hasHydratedTasks: boolean;
	taskHydrationFailed: boolean;
	visibleTaskCount: number;
}

export interface TaskViewportBottomPaddingOptions {
	gapPx?: number;
	minimumPx?: number;
}

export function filterGalleryTasks(tasks: TaskRecord[], filter: GalleryTaskFilter): TaskRecord[] {
	const query = filter.query.trim().toLowerCase();
	return tasks.filter((task) => {
		if (filter.status !== 'all' && task.status !== filter.status) return false;
		if (filter.favoriteOnly && !task.isFavorite) return false;
		if (filter.favoriteCollectionId) {
			if (filter.favoriteCollectionId === 'favorites-all') {
				if (!task.isFavorite) return false;
			} else if (!task.favoriteCollectionIds.includes(filter.favoriteCollectionId)) {
				return false;
			}
		}
		if (!query) return true;
		return task.prompt.toLowerCase().includes(query) || JSON.stringify(task.params).toLowerCase().includes(query);
	});
}

export function getVisibleGalleryTasks(tasks: TaskRecord[], page: GalleryTaskPage): TaskRecord[] {
	return filterGalleryTasks(tasks, page).slice(0, Math.max(0, page.limit));
}

export function shouldShowTaskHydrationSkeleton(state: TaskHydrationSkeletonState): boolean {
	return !state.hasHydratedTasks && !state.taskHydrationFailed && state.visibleTaskCount === 0;
}

export function getTaskViewportBottomPadding(
	inputBarHeight: number,
	options: TaskViewportBottomPaddingOptions = {}
): number {
	const safeInputBarHeight = Number.isFinite(inputBarHeight) ? Math.max(0, inputBarHeight) : 0;
	const gapPx = options.gapPx ?? 32;
	const minimumPx = options.minimumPx ?? 32;
	return Math.max(minimumPx, safeInputBarHeight + gapPx);
}

export function getTaskPreviewImages(task: TaskRecord): string[] {
	const thumbnails = task.thumbnailImages?.filter((image) => image.trim().length > 0) ?? [];
	return thumbnails.length ? thumbnails : task.images;
}

export function pruneSelectedTaskIds(selectedTaskIds: string[], availableTasks: TaskRecord[]): string[] {
	const availableIds = new Set(availableTasks.map((task) => task.id));
	return selectedTaskIds.filter((id) => availableIds.has(id));
}

export function getSelectedCompletedTasks(tasks: TaskRecord[], selectedTaskIds: string[]): TaskRecord[] {
	const selectedIds = new Set(selectedTaskIds);
	return tasks.filter(
		(task) =>
			selectedIds.has(task.id) &&
			(task.images.length > 0 || task.streamPartialImageIds.length > 0) &&
			task.status !== 'running'
	);
}
