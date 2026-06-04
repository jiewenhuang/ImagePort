import { describe, expect, test } from 'bun:test';
import { createEmptyTaskMetadata, DEFAULT_PARAMS, type TaskRecord } from './types';
import {
	ALL_FAVORITES_COLLECTION_ID,
	DEFAULT_FAVORITE_COLLECTION_ID,
	createFavoriteCollection,
	deleteFavoriteCollection,
	filterTasksByFavoriteCollection,
	normalizeFavoriteCollections,
	normalizeTaskFavoriteCollections,
	renameFavoriteCollection,
	toggleTaskFavoriteCollection
} from './favorites';

function task(overrides: Partial<TaskRecord> = {}): TaskRecord {
	return {
		id: 'task-1',
		prompt: 'a quiet desk',
		params: { ...DEFAULT_PARAMS },
		inputImages: [],
		mask: null,
		images: ['img'],
		status: 'done',
		error: null,
		createdAt: 100,
		finishedAt: 200,
		failureCount: 0,
		...createEmptyTaskMetadata(),
		isFavorite: false,
		favoriteCollectionIds: [],
		...overrides
	};
}

describe('favorite collections', () => {
	test('ensures a default collection and migrates legacy favorite tasks into it', () => {
		const collections = normalizeFavoriteCollections([], 1000);
		const migrated = normalizeTaskFavoriteCollections(task({ isFavorite: true }), collections);

		expect(collections[0].id).toBe(DEFAULT_FAVORITE_COLLECTION_ID);
		expect(migrated.favoriteCollectionIds).toEqual([DEFAULT_FAVORITE_COLLECTION_ID]);
		expect(migrated.isFavorite).toBe(true);
	});

	test('filters tasks by all favorites or a concrete collection', () => {
		const tasks = [
			task({ id: 'a', isFavorite: true, favoriteCollectionIds: ['work'] }),
			task({ id: 'b', isFavorite: true, favoriteCollectionIds: ['personal'] }),
			task({ id: 'c' })
		];

		expect(filterTasksByFavoriteCollection(tasks, ALL_FAVORITES_COLLECTION_ID).map((item) => item.id)).toEqual(['a', 'b']);
		expect(filterTasksByFavoriteCollection(tasks, 'work').map((item) => item.id)).toEqual(['a']);
	});

	test('toggles task membership and keeps isFavorite in sync', () => {
		const added = toggleTaskFavoriteCollection(task(), 'work');
		const removed = toggleTaskFavoriteCollection(added, 'work');

		expect(added.favoriteCollectionIds).toEqual(['work']);
		expect(added.isFavorite).toBe(true);
		expect(removed.favoriteCollectionIds).toEqual([]);
		expect(removed.isFavorite).toBe(false);
	});

	test('creates, renames, and deletes custom collections', () => {
		const collection = createFavoriteCollection(' Work ', () => 'work', 100);
		expect(collection).toEqual({ id: 'work', name: 'Work', createdAt: 100, updatedAt: 100 });

		const renamed = renameFavoriteCollection([collection!], 'work', 'Archive', 200);
		expect(renamed[0].name).toBe('Archive');
		expect(renamed[0].updatedAt).toBe(200);

		const result = deleteFavoriteCollection(
			[task({ id: 'a', isFavorite: true, favoriteCollectionIds: ['work'] })],
			renamed,
			'work'
		);
		expect(result.collections).toEqual([]);
		expect(result.tasks[0].favoriteCollectionIds).toEqual([]);
		expect(result.tasks[0].isFavorite).toBe(false);
	});
});
