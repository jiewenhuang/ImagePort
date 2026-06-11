import { describe, expect, test } from 'bun:test';
import { createEmptyTaskMetadata, DEFAULT_PARAMS, type TaskRecord } from './types';
import {
	filterGalleryTasks,
	getSelectedCompletedTasks,
	getTaskPreviewImages,
	getVisibleGalleryTasks,
	pruneSelectedTaskIds,
	shouldShowTaskHydrationSkeleton,
	TASK_PAGE_SIZE
} from './task-gallery';

function task(overrides: Partial<TaskRecord> = {}): TaskRecord {
	return {
		id: 'task-1',
		prompt: 'a quiet desk',
		params: { ...DEFAULT_PARAMS, size: '1024x1024' },
		inputImages: [],
		mask: null,
		images: ['full-1'],
		status: 'done',
		error: null,
		createdAt: 100,
		finishedAt: 200,
		failureCount: 0,
		...createEmptyTaskMetadata(),
		...overrides
	};
}

describe('gallery task helpers', () => {
	test('filters tasks by status and search query', () => {
		const tasks = [
			task({ id: 'a', prompt: 'blue ceramic cup', status: 'done' }),
			task({ id: 'b', prompt: 'red desk lamp', status: 'error' }),
			task({ id: 'c', prompt: 'plain object', status: 'done', params: { ...DEFAULT_PARAMS, size: '1536x1024' } })
		];

		expect(filterGalleryTasks(tasks, { status: 'done', query: 'blue' }).map((item) => item.id)).toEqual(['a']);
		expect(filterGalleryTasks(tasks, { status: 'done', query: '1536' }).map((item) => item.id)).toEqual(['c']);
	});

	test('filters favorite tasks independently of status and search query', () => {
		const tasks = [
			task({
				id: 'a',
				prompt: 'blue ceramic cup',
				status: 'done',
				isFavorite: true,
				favoriteCollectionIds: ['favorites-default']
			}),
			task({ id: 'b', prompt: 'blue desk lamp', status: 'error', isFavorite: true, favoriteCollectionIds: ['work'] }),
			task({ id: 'c', prompt: 'blue wall', status: 'done', isFavorite: false })
		];

		expect(
			filterGalleryTasks(tasks, { status: 'all', query: 'blue', favoriteOnly: true }).map((item) => item.id)
		).toEqual(['a', 'b']);
		expect(
			filterGalleryTasks(tasks, { status: 'done', query: 'blue', favoriteOnly: true }).map((item) => item.id)
		).toEqual(['a']);
		expect(
			filterGalleryTasks(tasks, { status: 'all', query: 'blue', favoriteCollectionId: 'work' }).map((item) => item.id)
		).toEqual(['b']);
		expect(
			filterGalleryTasks(tasks, { status: 'all', query: 'blue', favoriteCollectionId: 'favorites-all' }).map(
				(item) => item.id
			)
		).toEqual(['a', 'b']);
	});

	test('returns a limited page of filtered tasks', () => {
		const tasks = Array.from({ length: TASK_PAGE_SIZE + 3 }, (_, index) => task({ id: `task-${index}` }));

		const visible = getVisibleGalleryTasks(tasks, { status: 'all', query: '', limit: TASK_PAGE_SIZE });

		expect(visible.length).toBe(TASK_PAGE_SIZE);
		expect(visible[0].id).toBe('task-0');
		expect(visible.at(-1)?.id).toBe(`task-${TASK_PAGE_SIZE - 1}`);
	});

	test('prefers thumbnails for card previews and falls back to full images', () => {
		expect(
			getTaskPreviewImages(task({ images: ['full-1', 'full-2'], thumbnailImages: ['thumb-1', 'thumb-2'] }))
		).toEqual(['thumb-1', 'thumb-2']);
		expect(getTaskPreviewImages(task({ images: ['full-1', 'full-2'], thumbnailImages: [] }))).toEqual([
			'full-1',
			'full-2'
		]);
	});

	test('prunes selected task ids that are no longer visible', () => {
		expect(pruneSelectedTaskIds(['a', 'missing', 'b'], [task({ id: 'a' }), task({ id: 'b' })])).toEqual(['a', 'b']);
	});

	test('returns selected completed tasks that have downloadable images or partials', () => {
		const tasks = [
			task({ id: 'a', status: 'done', images: ['a'] }),
			task({ id: 'b', status: 'running', images: [] }),
			task({ id: 'c', status: 'partial', images: ['c'] }),
			task({ id: 'd', status: 'partial', images: [], streamPartialImageIds: ['partial-d'] })
		];

		expect(getSelectedCompletedTasks(tasks, ['d', 'c', 'b', 'a']).map((item) => item.id)).toEqual(['a', 'c', 'd']);
	});

	test('shows a hydration skeleton only while an empty task grid is still loading', () => {
		expect(
			shouldShowTaskHydrationSkeleton({
				hasHydratedTasks: false,
				taskHydrationFailed: false,
				visibleTaskCount: 0
			})
		).toBe(true);
		expect(
			shouldShowTaskHydrationSkeleton({
				hasHydratedTasks: false,
				taskHydrationFailed: false,
				visibleTaskCount: 1
			})
		).toBe(false);
		expect(
			shouldShowTaskHydrationSkeleton({
				hasHydratedTasks: true,
				taskHydrationFailed: false,
				visibleTaskCount: 0
			})
		).toBe(false);
		expect(
			shouldShowTaskHydrationSkeleton({
				hasHydratedTasks: false,
				taskHydrationFailed: true,
				visibleTaskCount: 0
			})
		).toBe(false);
	});
});
