import { describe, expect, test } from 'bun:test';
import { createEmptyTaskMetadata, DEFAULT_PARAMS, type TaskRecord } from '$lib/domain/types';
import { buildTaskCardViewModel } from './task-card-view-model';

function task(patch: Partial<TaskRecord> = {}): TaskRecord {
	return {
		id: 'task-a',
		prompt: 'a small harbor at dawn',
		params: { ...DEFAULT_PARAMS, n: 3 },
		inputImages: [],
		mask: null,
		images: [],
		status: 'done',
		error: null,
		createdAt: 1_000,
		finishedAt: 66_000,
		failureCount: 0,
		...createEmptyTaskMetadata(),
		...patch
	};
}

describe('task card view model', () => {
	test('summarizes completed tasks for card rendering', () => {
		const model = buildTaskCardViewModel(
			task({
				images: ['full-1', 'full-2', 'full-3'],
				thumbnailImages: ['thumb-1', 'thumb-2', 'thumb-3'],
				inputImages: [{ id: 'input-a', name: 'input.png', dataUrl: 'data:image/png;base64,aGVsbG8=' }]
			}),
			{ now: 70_000, canDownloadZip: true, formatTaskTime: () => '12:34' }
		);

		expect(model.previewImages).toEqual(['thumb-1', 'thumb-2', 'thumb-3']);
		expect(model.primaryImage).toBe('full-1');
		expect(model.canOpenPreview).toBe(true);
		expect(model.canDownloadAll).toBe(true);
		expect(model.canEditMask).toBe(true);
		expect(model.statusLabel).toBe('已完成');
		expect(model.statusClass).toBe('border-emerald-200 bg-emerald-50 text-emerald-700');
		expect(model.imageCountRatio).toBe('3/3 张');
		expect(model.detailText).toBe('auto · auto · png · 12:34');
		expect(model.progressText).toBe('耗时 1m 05s · 预计 3 张 · 实际 3 张');
		expect(model.inputImageCountText).toBe('参考图 1');
	});

	test('uses partial images for running tasks before final images exist', () => {
		const model = buildTaskCardViewModel(
			task({
				params: { ...DEFAULT_PARAMS, n: 'auto' },
				status: 'running',
				finishedAt: null,
				streamPartialImageIds: ['partial-1', 'partial-2']
			}),
			{ now: 3_500, canDownloadZip: true, formatTaskTime: () => '12:34' }
		);

		expect(model.previewImages).toEqual(['partial-1', 'partial-2']);
		expect(model.primaryImage).toBe('partial-1');
		expect(model.canOpenPreview).toBe(true);
		expect(model.canDownloadAll).toBe(true);
		expect(model.canEditMask).toBe(false);
		expect(model.statusLabel).toBe('生成中');
		expect(model.runningElapsedText).toBe('生成中 · 2s');
		expect(model.runningExpectedText).toBe('预计 auto（由模型控制）');
		expect(model.runningPartialText).toBe('生成中 · partial 2 张');
		expect(model.progressText).toBe('等待 2s · 预计 auto（由模型控制） · 实际 0 张 · partial 2 张');
	});

	test('keeps single-image zip downloads distinct from multi-image download-all actions', () => {
		const model = buildTaskCardViewModel(task({ images: ['full-1'] }), {
			now: 70_000,
			canDownloadZip: true,
			formatTaskTime: () => '12:34'
		});

		expect(model.canDownloadAll).toBe(false);
		expect(model.canDownloadZip).toBe(true);
	});
});
