import { describe, expect, test } from 'bun:test';
import { createEmptyTaskMetadata, DEFAULT_PARAMS, type TaskRecord } from './types';
import {
	buildExportedTasks,
	createTaskImportSummary,
	estimateTasksStorageBytes,
	mergeTaskSnapshots,
	normalizeTasks,
	parseImportedTasks,
	resolveStoredTasks,
	shouldPersistTaskSnapshot
} from './task-storage';

function task(overrides: Partial<TaskRecord> = {}): TaskRecord {
	return {
		id: 'task-1',
		prompt: 'a small ceramic cup',
		params: { ...DEFAULT_PARAMS, n: 2 },
		inputImages: [],
		mask: null,
		images: ['data:image/png;base64,one'],
		status: 'done',
		error: null,
		createdAt: 100,
		finishedAt: 200,
		failureCount: 0,
		...createEmptyTaskMetadata(),
		...overrides
	};
}

describe('normalizeTasks', () => {
	test('keeps valid tasks and restores missing runtime fields', () => {
		const tasks = normalizeTasks([
			{
				id: 'saved',
				prompt: 'saved prompt',
				params: { size: '1024x1024' },
				images: ['data:image/png;base64,img'],
				thumbnailImages: ['data:image/jpeg;base64,thumb'],
				status: 'partial',
				createdAt: 123
			}
		]);

		expect(tasks.length).toBe(1);
		expect(tasks[0].id).toBe('saved');
		expect(tasks[0].params.size).toBe('1024x1024');
		expect(tasks[0].params.quality).toBe(DEFAULT_PARAMS.quality);
		expect(tasks[0].thumbnailImages).toEqual(['data:image/jpeg;base64,thumb']);
		expect(tasks[0].status).toBe('partial');
		expect(tasks[0].finishedAt).toBe(null);
		expect(tasks[0].failureCount).toBe(0);
		expect(tasks[0].isFavorite).toBe(false);
		expect(tasks[0].favoriteCollectionIds).toEqual([]);
		expect(tasks[0].actualParams).toBe(null);
		expect(tasks[0].actualParamsByImage).toEqual({});
		expect(tasks[0].revisedPromptByImage).toEqual({});
		expect(tasks[0].rawImageUrls).toEqual([]);
		expect(tasks[0].streamPartialImageIds).toEqual([]);
	});

	test('preserves auto output count for model-controlled tasks', () => {
		const tasks = normalizeTasks([
			task({
				params: { ...DEFAULT_PARAMS, n: 'auto' },
				apiMode: 'responses',
				model: 'gpt-5.5'
			})
		]);

		expect(tasks[0].params.n).toBe('auto');
	});

	test('preserves favorite state', () => {
		const tasks = normalizeTasks([task({ isFavorite: true })]);

		expect(tasks[0].isFavorite).toBe(true);
	});

	test('preserves API profile snapshots and per-image metadata', () => {
		const tasks = normalizeTasks([
			task({
				actualParams: { size: '1536x1024', quality: 'high' },
				actualParamsByImage: {
					'0': { size: '1536x1024' }
				},
				revisedPromptByImage: {
					'0': 'a rewritten prompt'
				},
				apiProfileId: 'profile-1',
				apiProfileName: 'Work',
				apiProvider: 'openai',
				apiMode: 'images',
				model: 'gpt-image-2',
				rawImageUrls: ['https://example.com/image.png'],
				rawResponsePayload: '{"data":[]}',
				streamPartialImageIds: ['partial-1']
			})
		]);

		expect(tasks[0].actualParams).toEqual({ size: '1536x1024', quality: 'high' });
		expect(tasks[0].actualParamsByImage).toEqual({ '0': { size: '1536x1024' } });
		expect(tasks[0].revisedPromptByImage).toEqual({ '0': 'a rewritten prompt' });
		expect(tasks[0].apiProfileId).toBe('profile-1');
		expect(tasks[0].apiProfileName).toBe('Work');
		expect(tasks[0].apiProvider).toBe('openai');
		expect(tasks[0].apiMode).toBe('images');
		expect(tasks[0].model).toBe('gpt-image-2');
		expect(tasks[0].rawImageUrls).toEqual(['https://example.com/image.png']);
		expect(tasks[0].rawResponsePayload).toBe('{"data":[]}');
		expect(tasks[0].streamPartialImageIds).toEqual(['partial-1']);
	});

	test('marks running tasks as interrupted after reload', () => {
		const tasks = normalizeTasks([task({ status: 'running', finishedAt: null })]);

		expect(tasks[0].status).toBe('error');
		expect(tasks[0].error).toBe('任务在应用关闭或刷新时中断');
		expect(tasks[0].finishedAt).toBe(100);
	});
});

describe('task import/export', () => {
	test('round-trips exported tasks', () => {
		const exported = buildExportedTasks([task()]);
		const imported = parseImportedTasks(JSON.stringify(exported));

		expect(imported.length).toBe(1);
		expect(imported[0].prompt).toBe('a small ceramic cup');
		expect(imported[0].images).toEqual(['data:image/png;base64,one']);
	});

	test('summarizes imported task merge results', () => {
		const summary = createTaskImportSummary(
			[task({ id: 'existing' })],
			[
				task({ id: 'newer', createdAt: 300 }),
				task({ id: 'existing', prompt: 'duplicate' }),
				task({ id: 'older', createdAt: 50 })
			]
		);

		expect(summary.addedCount).toBe(2);
		expect(summary.skippedDuplicateCount).toBe(1);
		expect(summary.tasks.map((item) => item.id)).toEqual(['newer', 'existing', 'older']);
	});

	test('estimates serialized task storage size in bytes', () => {
		expect(estimateTasksStorageBytes([task({ images: ['data:image/png;base64,abcd'] })]) > 0).toBe(true);
		expect(estimateTasksStorageBytes([])).toBe(2);
	});
});

describe('resolveStoredTasks', () => {
	test('migrates local fallback tasks when primary storage exists but is empty', () => {
		const resolved = resolveStoredTasks([], [task({ id: 'legacy-local' })]);

		expect(resolved.map((item) => item.id)).toEqual(['legacy-local']);
	});

	test('keeps non-empty primary storage over stale fallback tasks', () => {
		const resolved = resolveStoredTasks([task({ id: 'sqlite-task' })], [task({ id: 'legacy-local' })]);

		expect(resolved.map((item) => item.id)).toEqual(['sqlite-task']);
	});
});

describe('mergeTaskSnapshots', () => {
	test('keeps preferred tasks when duplicate ids exist', () => {
		const resolved = mergeTaskSnapshots(
			[task({ id: 'same', prompt: 'current prompt', createdAt: 200 })],
			[task({ id: 'same', prompt: 'stored prompt', createdAt: 100 })]
		);

		expect(resolved.length).toBe(1);
		expect(resolved[0].prompt).toBe('current prompt');
	});

	test('adds stored tasks around newer in-memory tasks', () => {
		const resolved = mergeTaskSnapshots([task({ id: 'new', createdAt: 300 })], [task({ id: 'old', createdAt: 100 })]);

		expect(resolved.map((item) => item.id)).toEqual(['new', 'old']);
	});
});

describe('shouldPersistTaskSnapshot', () => {
	test('skips empty passive snapshots so hydration cannot clear history', () => {
		expect(shouldPersistTaskSnapshot([])).toBe(false);
	});

	test('allows explicit empty snapshots for user deletes and clear actions', () => {
		expect(shouldPersistTaskSnapshot([], { allowEmpty: true })).toBe(true);
	});

	test('persists non-empty snapshots by default', () => {
		expect(shouldPersistTaskSnapshot([task()])).toBe(true);
	});
});
