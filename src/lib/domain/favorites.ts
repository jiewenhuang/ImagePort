import type { TaskRecord } from './types';

export interface FavoriteCollection {
	id: string;
	name: string;
	createdAt: number;
	updatedAt: number;
}

export const DEFAULT_FAVORITE_COLLECTION_ID = 'favorites-default';
export const ALL_FAVORITES_COLLECTION_ID = 'favorites-all';

export function createDefaultFavoriteCollection(now = Date.now()): FavoriteCollection {
	return {
		id: DEFAULT_FAVORITE_COLLECTION_ID,
		name: '默认收藏',
		createdAt: now,
		updatedAt: now
	};
}

export function normalizeFavoriteCollections(value: unknown, now = Date.now()): FavoriteCollection[] {
	const collections = Array.isArray(value)
		? value.map(normalizeFavoriteCollection).filter((item): item is FavoriteCollection => item != null)
		: [];
	const hasDefault = collections.some((collection) => collection.id === DEFAULT_FAVORITE_COLLECTION_ID);
	return hasDefault
		? dedupeCollections(collections)
		: [createDefaultFavoriteCollection(now), ...dedupeCollections(collections)];
}

export function normalizeTaskFavoriteCollections(task: TaskRecord, collections: FavoriteCollection[]): TaskRecord {
	const collectionIds = new Set(collections.map((collection) => collection.id));
	const ids = normalizeFavoriteCollectionIds(task.favoriteCollectionIds).filter((id) => collectionIds.has(id));
	if (!ids.length && task.isFavorite && collectionIds.has(DEFAULT_FAVORITE_COLLECTION_ID)) {
		ids.push(DEFAULT_FAVORITE_COLLECTION_ID);
	}
	return {
		...task,
		isFavorite: ids.length > 0,
		favoriteCollectionIds: ids
	};
}

export function normalizeFavoriteCollectionIds(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return [...new Set(value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0))];
}

export function filterTasksByFavoriteCollection(tasks: TaskRecord[], collectionId: string | null): TaskRecord[] {
	if (!collectionId) return tasks;
	if (collectionId === ALL_FAVORITES_COLLECTION_ID) return tasks.filter((task) => task.isFavorite);
	return tasks.filter((task) => task.favoriteCollectionIds.includes(collectionId));
}

export function toggleTaskFavoriteCollection(task: TaskRecord, collectionId: string): TaskRecord {
	const ids = new Set(task.favoriteCollectionIds);
	if (ids.has(collectionId)) ids.delete(collectionId);
	else ids.add(collectionId);
	const nextIds = [...ids];
	return {
		...task,
		isFavorite: nextIds.length > 0,
		favoriteCollectionIds: nextIds
	};
}

export function renameFavoriteCollection(
	collections: FavoriteCollection[],
	collectionId: string,
	name: string,
	now = Date.now()
): FavoriteCollection[] {
	const normalizedName = normalizeFavoriteCollectionName(name);
	if (!normalizedName) return collections;
	return collections.map((collection) =>
		collection.id === collectionId ? { ...collection, name: normalizedName, updatedAt: now } : collection
	);
}

export function deleteFavoriteCollection(
	tasks: TaskRecord[],
	collections: FavoriteCollection[],
	collectionId: string,
	options: { deleteTasks?: boolean } = {}
): { tasks: TaskRecord[]; collections: FavoriteCollection[] } {
	if (collectionId === DEFAULT_FAVORITE_COLLECTION_ID) return { tasks, collections };
	const nextCollections = collections.filter((collection) => collection.id !== collectionId);
	const nextTasks = options.deleteTasks
		? tasks.filter((task) => !task.favoriteCollectionIds.includes(collectionId))
		: tasks.map((task) => {
				const ids = task.favoriteCollectionIds.filter((id) => id !== collectionId);
				return { ...task, favoriteCollectionIds: ids, isFavorite: ids.length > 0 };
			});
	return { tasks: nextTasks, collections: nextCollections };
}

export function createFavoriteCollection(
	name: string,
	createId: () => string,
	now = Date.now()
): FavoriteCollection | null {
	const normalizedName = normalizeFavoriteCollectionName(name);
	if (!normalizedName) return null;
	return {
		id: createId(),
		name: normalizedName,
		createdAt: now,
		updatedAt: now
	};
}

function normalizeFavoriteCollection(value: unknown): FavoriteCollection | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const record = value as Record<string, unknown>;
	const id = typeof record.id === 'string' && record.id.trim() ? record.id.trim() : '';
	const name = normalizeFavoriteCollectionName(record.name);
	if (!id || !name) return null;
	const createdAt =
		typeof record.createdAt === 'number' && Number.isFinite(record.createdAt) ? record.createdAt : Date.now();
	const updatedAt =
		typeof record.updatedAt === 'number' && Number.isFinite(record.updatedAt) ? record.updatedAt : createdAt;
	return { id, name, createdAt, updatedAt };
}

function normalizeFavoriteCollectionName(value: unknown): string {
	return typeof value === 'string' ? value.trim().slice(0, 48) : '';
}

function dedupeCollections(collections: FavoriteCollection[]): FavoriteCollection[] {
	const seen = new Set<string>();
	const result: FavoriteCollection[] = [];
	for (const collection of collections) {
		if (seen.has(collection.id)) continue;
		seen.add(collection.id);
		result.push(collection);
	}
	return result;
}
