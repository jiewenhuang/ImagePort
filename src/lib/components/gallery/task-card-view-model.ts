import { getTaskPreviewImages } from '$lib/domain/task-gallery';
import type { OutputImageCount, TaskRecord } from '$lib/domain/types';

export interface TaskCardViewModelOptions {
	now: number;
	canDownloadZip: boolean;
	formatTaskTime?: (timestamp: number) => string;
}

export interface TaskCardViewModel {
	previewImages: string[];
	primaryImage: string | null;
	downloadableImageCount: number;
	canOpenPreview: boolean;
	canDownloadPrimary: boolean;
	canDownloadAll: boolean;
	canDownloadZip: boolean;
	canEditMask: boolean;
	statusLabel: string;
	statusClass: string;
	imageCountRatio: string;
	detailText: string;
	progressText: string;
	runningElapsedText: string;
	runningExpectedText: string;
	runningPartialText: string;
	inputImageCountText: string | null;
}

export function buildTaskCardViewModel(task: TaskRecord, options: TaskCardViewModelOptions): TaskCardViewModel {
	const previewImages = task.images.length ? getTaskPreviewImages(task) : task.streamPartialImageIds.slice(-4);
	const primaryImage = task.images[0] ?? task.streamPartialImageIds[0] ?? null;
	const downloadableImageCount = task.images.length + task.streamPartialImageIds.length;
	const elapsedText = formatDuration((task.finishedAt ?? options.now) - task.createdAt);
	const expectedText = formatExpectedImageCount(task.params.n);
	const partialText = task.streamPartialImageIds.length ? ` · partial ${task.streamPartialImageIds.length} 张` : '';
	const formatTaskTime = options.formatTaskTime ?? defaultFormatTaskTime;

	return {
		previewImages,
		primaryImage,
		downloadableImageCount,
		canOpenPreview: Boolean(task.images.length || task.streamPartialImageIds.length),
		canDownloadPrimary: Boolean(primaryImage),
		canDownloadAll: downloadableImageCount > 1,
		canDownloadZip: options.canDownloadZip && downloadableImageCount > 0,
		canEditMask: Boolean(task.images[0]),
		statusLabel: getStatusLabel(task.status),
		statusClass: getStatusClass(task.status),
		imageCountRatio: formatImageCountRatio(task.images.length, task.params.n),
		detailText: `${task.params.size} · ${task.params.quality} · ${task.params.output_format} · ${formatTaskTime(task.createdAt)}`,
		progressText: `${task.status === 'running' ? '等待' : '耗时'} ${elapsedText} · 预计 ${expectedText} · 实际 ${task.images.length} 张${partialText}`,
		runningElapsedText: `生成中 · ${elapsedText}`,
		runningExpectedText: `预计 ${expectedText}`,
		runningPartialText: `生成中 · partial ${task.streamPartialImageIds.length} 张`,
		inputImageCountText: task.inputImages.length ? `参考图 ${task.inputImages.length}` : null
	};
}

function defaultFormatTaskTime(timestamp: number) {
	return new Intl.DateTimeFormat('zh-CN', {
		hour: '2-digit',
		minute: '2-digit'
	}).format(timestamp);
}

function getStatusLabel(status: TaskRecord['status']) {
	if (status === 'running') return '生成中';
	if (status === 'partial') return '部分完成';
	if (status === 'error') return '失败';
	return '已完成';
}

function getStatusClass(status: TaskRecord['status']) {
	if (status === 'running') return 'border-blue-200 bg-blue-50 text-blue-700';
	if (status === 'partial') return 'border-amber-200 bg-amber-50 text-amber-700';
	if (status === 'error') return 'border-red-200 bg-red-50 text-red-700';
	return 'border-emerald-200 bg-emerald-50 text-emerald-700';
}

function formatDuration(ms: number) {
	const totalSeconds = Math.max(0, Math.floor(ms / 1000));
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	if (minutes <= 0) return `${seconds}s`;
	return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
}

function formatExpectedImageCount(value: OutputImageCount) {
	return value === 'auto' ? 'auto（由模型控制）' : `${value} 张`;
}

function formatImageCountRatio(actualCount: number, expectedCount: OutputImageCount) {
	return expectedCount === 'auto' ? `${actualCount}/auto 张` : `${actualCount}/${expectedCount} 张`;
}
