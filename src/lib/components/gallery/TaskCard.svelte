<script lang="ts">
	import { Download, Eye, Heart, ImagePlus, LoaderCircle, MoreHorizontal, RotateCcw, Trash2 } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { getTaskPreviewImages } from '$lib/domain/task-gallery';
	import type { OutputImageCount, TaskRecord } from '$lib/domain/types';
	import ImageActionContextMenu from './ImageActionContextMenu.svelte';

	let {
		task,
		isSelected,
		canDownloadZip,
		onOpen,
		onOpenPreview,
		onSelect,
		onToggleFavorite,
		onRetry,
		onDownloadPrimary,
		onDownloadAll,
		onCopyPrimary,
		onUsePrimaryReference,
		onUseFirstOutputReference,
		onEditMask,
		onDelete,
		formatDuration,
		formatExpectedImageCount,
		formatImageCountRatio,
		formatTaskTime,
		getTaskDownloadableImageCount,
		getTaskElapsedMs,
		getTaskProgressText,
		getStatusClass,
		getStatusLabel
	}: {
		task: TaskRecord;
		isSelected: boolean;
		canDownloadZip: boolean;
		onOpen: (task: TaskRecord) => void;
		onOpenPreview: (task: TaskRecord) => void;
		onSelect: (taskId: string) => void;
		onToggleFavorite: (taskId: string) => void;
		onRetry: (task: TaskRecord) => void;
		onDownloadPrimary: (task: TaskRecord) => void;
		onDownloadAll: (task: TaskRecord) => void;
		onCopyPrimary: (task: TaskRecord) => void | Promise<void>;
		onUsePrimaryReference: (task: TaskRecord) => void | Promise<void>;
		onUseFirstOutputReference: (task: TaskRecord) => void | Promise<void>;
		onEditMask: (task: TaskRecord) => void | Promise<void>;
		onDelete: (taskId: string) => void;
		formatDuration: (ms: number) => string;
		formatExpectedImageCount: (value: OutputImageCount) => string;
		formatImageCountRatio: (actualCount: number, expectedCount: OutputImageCount) => string;
		formatTaskTime: (timestamp: number) => string;
		getTaskDownloadableImageCount: (task: TaskRecord) => number;
		getTaskElapsedMs: (task: TaskRecord) => number;
		getTaskProgressText: (task: TaskRecord) => string;
		getStatusClass: (status: TaskRecord['status']) => string;
		getStatusLabel: (status: TaskRecord['status']) => string;
	} = $props();

	let previewImages = $derived(task.images.length ? getTaskPreviewImages(task) : task.streamPartialImageIds.slice(-4));
	let primaryImage = $derived(task.images[0] ?? task.streamPartialImageIds[0]);
</script>

<article
	data-task-card-id={task.id}
	class={`border-border bg-card group overflow-hidden rounded-lg border shadow-xs ${isSelected ? 'border-primary ring-ring ring-2' : ''}`}
>
	<div class="bg-muted relative aspect-square w-full overflow-hidden">
		{#if primaryImage}
			<ImageActionContextMenu
				canDownloadAll={getTaskDownloadableImageCount(task) > 1}
				canUseAsReference
				canEditMask={Boolean(task.images[0])}
				onOpen={() => onOpenPreview(task)}
				onDownload={() => onDownloadPrimary(task)}
				onDownloadAll={() => onDownloadAll(task)}
				onCopy={() => onCopyPrimary(task)}
				onUseAsReference={() => onUsePrimaryReference(task)}
				onEditMask={() => (task.images[0] ? onEditMask(task) : undefined)}
			>
				<button
					type="button"
					class="absolute inset-0 z-[1] block w-full text-left"
					onclick={() => onOpen(task)}
					aria-label="打开任务详情"
				></button>
			</ImageActionContextMenu>
		{:else}
			<button
				type="button"
				class="absolute inset-0 z-[1] block w-full text-left"
				onclick={() => onOpen(task)}
				aria-label="打开任务详情"
			></button>
		{/if}
		<div class="absolute top-2 left-2 z-10 flex items-center gap-1.5">
			<div
				class={`flex size-7 items-center justify-center rounded-full border shadow-sm backdrop-blur transition ${isSelected ? 'border-primary bg-primary text-primary-foreground' : 'border-white/60 bg-black/45 text-white hover:bg-black/65'}`}
			>
				<Checkbox
					checked={isSelected}
					class="border-white/70 bg-transparent data-checked:border-primary-foreground data-checked:bg-primary-foreground data-checked:text-primary"
					aria-label={isSelected ? '取消选择任务' : '选择任务'}
					onclick={(event) => {
						event.stopPropagation();
						onSelect(task.id);
					}}
				/>
			</div>
			<button
				type="button"
				class={`flex size-7 items-center justify-center rounded-full border shadow-sm backdrop-blur transition ${task.isFavorite ? 'border-rose-200 bg-rose-50 text-rose-600' : 'border-white/60 bg-black/45 text-white hover:bg-black/65'}`}
				onclick={(event) => {
					event.stopPropagation();
					onToggleFavorite(task.id);
				}}
				aria-label={task.isFavorite ? '取消收藏' : '收藏任务'}
			>
				<Heart class={`size-4 ${task.isFavorite ? 'fill-current' : ''}`} />
			</button>
		</div>
		{#if task.status === 'running' && !previewImages.length}
			<div class="absolute inset-0 flex flex-col items-center justify-center gap-3">
				<LoaderCircle class="text-muted-foreground size-6 animate-spin" />
				<span class="text-muted-foreground text-sm">生成中 · {formatDuration(getTaskElapsedMs(task))}</span>
				<span class="text-muted-foreground text-xs">预计 {formatExpectedImageCount(task.params.n)}</span>
			</div>
		{:else if task.status === 'running' && previewImages.length}
			<img
				class="h-full w-full object-cover opacity-90 transition-transform duration-300 group-hover:scale-[1.02]"
				src={previewImages.at(-1)}
				alt={`${task.prompt} partial`}
			/>
			<div class="absolute inset-x-0 bottom-0 bg-linear-to-t from-black/65 to-transparent p-3 pt-8 text-xs text-white">
				生成中 · partial {task.streamPartialImageIds.length} 张
			</div>
		{:else if previewImages.length === 1}
			<img
				class="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
				src={previewImages[0]}
				alt={task.prompt}
			/>
		{:else if previewImages.length > 1}
			<div class="grid h-full w-full grid-cols-2 gap-1 p-1">
				{#each previewImages.slice(0, 4) as image, index}
					<div class="relative overflow-hidden rounded-md">
						<img class="h-full w-full object-cover" src={image} alt={`${task.prompt} ${index + 1}`} />
						{#if index === 3 && previewImages.length > 4}
							<div
								class="absolute inset-0 flex items-center justify-center bg-black/50 text-sm font-semibold text-white"
							>
								+{previewImages.length - 4}
							</div>
						{/if}
					</div>
				{/each}
			</div>
		{:else}
			<div class="text-muted-foreground absolute inset-0 flex items-center justify-center px-4 text-center text-sm">
				{task.error ?? '没有图片'}
			</div>
		{/if}
		<span class={`absolute top-2 right-2 rounded-full border px-2 py-0.5 text-xs ${getStatusClass(task.status)}`}>
			{getStatusLabel(task.status)}
		</span>
		{#if task.status !== 'running'}
			<span class="absolute right-2 bottom-2 rounded-full bg-black/60 px-2 py-0.5 text-xs text-white"
				>{formatImageCountRatio(task.images.length, task.params.n)}</span
			>
		{/if}
		{#if task.inputImages.length}
			<span class="absolute bottom-2 left-2 rounded-full bg-black/60 px-2 py-0.5 text-xs text-white"
				>参考图 {task.inputImages.length}</span
			>
		{/if}
	</div>
	<div class="space-y-3 p-3">
		<div>
			<p class="line-clamp-2 text-sm font-medium">{task.prompt}</p>
			<p class="text-muted-foreground mt-1 text-xs">
				{task.params.size} · {task.params.quality} · {task.params.output_format} · {formatTaskTime(task.createdAt)}
			</p>
			<p class="text-muted-foreground mt-1 text-xs">{getTaskProgressText(task)}</p>
			{#if task.error && task.status !== 'error'}
				<p class="mt-1 line-clamp-2 text-xs text-amber-700">{task.error}</p>
			{/if}
		</div>
		<div class="grid grid-cols-4 gap-2">
			<Button
				variant="outline"
				size="xs"
				onclick={() => onOpen(task)}
				disabled={!task.images.length && !task.streamPartialImageIds.length}
			>
				<Eye class="size-3" />
				查看
			</Button>
			<Button variant="outline" size="xs" onclick={() => onRetry(task)}>
				<RotateCcw class="size-3" />
				复用
			</Button>
			<Button variant="ghost" size="xs" onclick={() => onDownloadPrimary(task)} disabled={!primaryImage}>
				<Download class="size-3" />
				下载
			</Button>
			<DropdownMenu.Root>
				<DropdownMenu.Trigger>
					<Button variant="ghost" size="xs">
						<MoreHorizontal class="size-3" />
						更多
					</Button>
				</DropdownMenu.Trigger>
				<DropdownMenu.Content align="end" class="w-44">
					<DropdownMenu.Item
						onclick={() => onOpen(task)}
						disabled={!task.images.length && !task.streamPartialImageIds.length}
					>
						<Eye class="size-4" />
						查看详情
					</DropdownMenu.Item>
					<DropdownMenu.Item onclick={() => onToggleFavorite(task.id)}>
						<Heart class={`size-4 ${task.isFavorite ? 'fill-current text-rose-600' : ''}`} />
						{task.isFavorite ? '取消收藏' : '收藏任务'}
					</DropdownMenu.Item>
					{#if canDownloadZip}
						<DropdownMenu.Item
							onclick={() => onDownloadAll(task)}
							disabled={!task.images.length && !task.streamPartialImageIds.length}
						>
							<Download class="size-4" />
							下载全部 ZIP
						</DropdownMenu.Item>
					{/if}
					<DropdownMenu.Item onclick={() => onUseFirstOutputReference(task)} disabled={!task.images[0]}>
						<ImagePlus class="size-4" />
						首图作参考
					</DropdownMenu.Item>
					<DropdownMenu.Separator />
					<DropdownMenu.Item variant="destructive" onclick={() => onDelete(task.id)}>
						<Trash2 class="size-4" />
						删除任务
					</DropdownMenu.Item>
				</DropdownMenu.Content>
			</DropdownMenu.Root>
		</div>
	</div>
</article>
