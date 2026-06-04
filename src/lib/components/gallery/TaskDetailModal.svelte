<script lang="ts">
	import { ChevronLeft, ChevronRight, Download, Heart, ImagePlus, Paintbrush, RotateCcw, Trash2, X } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import ImageActionContextMenu from './ImageActionContextMenu.svelte';
	import { saveDataUrlToFile } from '$lib/storage/native-download';
	import type { OutputImageCount, TaskRecord } from '$lib/domain/types';
	import { toast } from 'svelte-sonner';

	let {
		task,
		open = $bindable(false),
		onReuse,
		onDelete,
		onToggleFavorite,
		onDownloadAll,
		onUseAsReference,
		onEditMask,
		onOpenLightbox,
		onOpenInputLightbox,
		onCopyImage,
		canDownloadAll = true
	}: {
		task: TaskRecord | null;
		open?: boolean;
		canDownloadAll?: boolean;
		onReuse: (task: TaskRecord) => void;
		onDelete: (taskId: string) => void;
		onToggleFavorite: (taskId: string) => void;
		onDownloadAll: (task: TaskRecord) => void;
		onUseAsReference: (task: TaskRecord, imageIndex: number) => void | Promise<void>;
		onEditMask: (task: TaskRecord, imageIndex: number) => void | Promise<void>;
		onOpenLightbox: (task: TaskRecord, imageIndex: number) => void;
		onOpenInputLightbox: (task: TaskRecord, imageIndex: number) => void;
		onCopyImage: (src: string) => void | Promise<void>;
	} = $props();

	let selectedIndex = $state(0);
	let now = $state(Date.now());
	let downloadError = $state<string | null>(null);

	$effect(() => {
		if (task) selectedIndex = Math.min(selectedIndex, Math.max(0, getPreviewImages(task).length - 1));
	});

	$effect(() => {
		if (!open || task?.status !== 'running') return;
		const timer = window.setInterval(() => {
			now = Date.now();
		}, 1000);
		return () => window.clearInterval(timer);
	});

	function close() {
		open = false;
	}

	function downloadImage(src: string, index: number) {
		downloadError = null;
		const fileName = `imageport-${task?.id ?? 'image'}-${index + 1}.${extensionFromDataUrl(src)}`;
		void saveDataUrlToFile(src, fileName)
			.then((saved) => {
				if (saved) toast.success('图片已保存', { description: fileName });
			})
			.catch((err) => {
				downloadError = `下载失败：${err instanceof Error ? err.message : String(err)}`;
				toast.error('下载失败', { description: downloadError });
			});
	}

	function selectPreviousImage() {
		const previewImages = task ? getPreviewImages(task) : [];
		if (!previewImages.length) return;
		selectedIndex = (selectedIndex - 1 + previewImages.length) % previewImages.length;
	}

	function selectNextImage() {
		const previewImages = task ? getPreviewImages(task) : [];
		if (!previewImages.length) return;
		selectedIndex = (selectedIndex + 1) % previewImages.length;
	}

	function extensionFromDataUrl(src: string) {
		if (src.startsWith('data:image/jpeg')) return 'jpg';
		if (src.startsWith('data:image/webp')) return 'webp';
		return 'png';
	}

	function formatDuration(ms: number) {
		const totalSeconds = Math.max(0, Math.floor(ms / 1000));
		const minutes = Math.floor(totalSeconds / 60);
		const seconds = totalSeconds % 60;
		if (minutes <= 0) return `${seconds}s`;
		return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
	}

	function getElapsedMs(record: TaskRecord) {
		return (record.finishedAt ?? now) - record.createdAt;
	}

	function formatTaskParamValue(value: unknown) {
		if (value == null || value === '') return '未返回';
		return String(value);
	}

	function formatExpectedImageCount(value: OutputImageCount) {
		return value === 'auto' ? 'auto' : `${value} 张`;
	}

	function formatImageCountRatio(actualCount: number, expectedCount: OutputImageCount) {
		return expectedCount === 'auto' ? `${actualCount}/auto` : `${actualCount}/${expectedCount}`;
	}

	function currentActualParams(record: TaskRecord) {
		return record.actualParamsByImage[String(selectedIndex)] ?? record.actualParams;
	}

	function currentRevisedPrompt(record: TaskRecord) {
		return record.revisedPromptByImage[String(selectedIndex)]?.trim() ?? '';
	}

	function getPreviewImages(record: TaskRecord) {
		return record.images.length ? record.images : record.streamPartialImageIds;
	}

	function isPreviewingPartial(record: TaskRecord) {
		return !record.images.length && record.streamPartialImageIds.length > 0;
	}
</script>

{#if open && task}
	{@const previewImages = getPreviewImages(task)}
	{@const previewingPartial = isPreviewingPartial(task)}
	<div class="fixed inset-0 z-[60] flex items-center justify-center p-4">
		<button type="button" class="absolute inset-0 cursor-default bg-black/40 backdrop-blur-sm" aria-label="关闭任务详情" onclick={close}></button>
		<section class="bg-card text-card-foreground relative z-10 grid h-[86vh] w-full max-w-6xl grid-cols-[minmax(0,1fr)_320px] overflow-hidden rounded-lg border shadow-2xl max-lg:grid-cols-1">
			<div class="bg-muted/50 flex min-h-0 flex-col">
				<header class="border-border bg-background/80 flex items-center justify-between border-b px-4 py-3">
					<div class="text-sm font-medium">{previewingPartial ? 'Partial 预览' : '输出预览'} {selectedIndex + 1}/{previewImages.length || 1}</div>
					<div class="flex items-center gap-1.5">
						<Button variant={task.isFavorite ? 'secondary' : 'ghost'} size="icon-sm" onclick={() => onToggleFavorite(task.id)} aria-label={task.isFavorite ? '取消收藏' : '收藏任务'}>
							<Heart class={`size-4 ${task.isFavorite ? 'fill-current text-rose-600' : ''}`} />
						</Button>
						<Button variant="ghost" size="icon-sm" onclick={close} aria-label="关闭">
							<X class="size-4" />
						</Button>
					</div>
				</header>
				<div class="relative flex min-h-0 flex-1 items-center justify-center p-4">
					{#if previewImages[selectedIndex]}
						<div class="relative flex h-full w-full items-center justify-center">
							<ImageActionContextMenu
								canDownloadAll={canDownloadAll && previewImages.length > 1}
								canUseAsReference
								canEditMask={!previewingPartial}
								onOpen={() => onOpenLightbox(previewingPartial ? { ...task, images: task.streamPartialImageIds } : task, selectedIndex)}
								onDownload={() => downloadImage(previewImages[selectedIndex], selectedIndex)}
								onDownloadAll={() => onDownloadAll(task)}
								onCopy={() => onCopyImage(previewImages[selectedIndex])}
								onUseAsReference={() => onUseAsReference(previewingPartial ? { ...task, images: task.streamPartialImageIds } : task, selectedIndex)}
								onEditMask={() => {
									if (previewingPartial) return;
									onEditMask(task, selectedIndex);
									close();
								}}
							>
								<button type="button" class="flex h-full w-full items-center justify-center" onclick={() => onOpenLightbox(previewingPartial ? { ...task, images: task.streamPartialImageIds } : task, selectedIndex)} aria-label="查看大图">
									<img class="max-h-full max-w-full rounded-lg object-contain shadow-xl" src={previewImages[selectedIndex]} alt={task.prompt} />
								</button>
							</ImageActionContextMenu>
							{#if previewImages.length > 1}
								<Button
									type="button"
									variant="secondary"
									size="icon"
									class="absolute left-3 top-1/2 size-10 -translate-y-1/2 rounded-full bg-background/85 shadow-lg backdrop-blur hover:bg-background"
									onclick={selectPreviousImage}
									aria-label="上一张"
								>
									<ChevronLeft class="size-5" />
								</Button>
								<Button
									type="button"
									variant="secondary"
									size="icon"
									class="absolute right-3 top-1/2 size-10 -translate-y-1/2 rounded-full bg-background/85 shadow-lg backdrop-blur hover:bg-background"
									onclick={selectNextImage}
									aria-label="下一张"
								>
									<ChevronRight class="size-5" />
								</Button>
								<div class="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-black/55 px-3 py-1.5 text-xs text-white shadow-lg backdrop-blur">
									<span>{selectedIndex + 1}/{task.images.length}</span>
									<div class="flex items-center gap-1">
										{#each task.images as _, index}
											<button
												type="button"
												class={`size-1.5 rounded-full transition ${selectedIndex === index ? 'bg-white' : 'bg-white/45 hover:bg-white/75'}`}
												onclick={() => (selectedIndex = index)}
												aria-label={`查看第 ${index + 1} 张`}
											></button>
										{/each}
									</div>
								</div>
							{/if}
							{#if previewingPartial}
								<Badge variant="outline" class="absolute top-3 left-3 bg-background/85 backdrop-blur">Partial</Badge>
							{/if}
						</div>
					{:else}
						<div class="text-muted-foreground">没有可预览的图片</div>
					{/if}
				</div>
			</div>

			<aside class="border-border flex min-h-0 flex-col border-l bg-background max-lg:hidden">
				<div class="min-h-0 flex-1 overflow-y-auto p-4">
					<p class="text-sm font-medium leading-relaxed">{task.prompt}</p>
					<p class="text-muted-foreground mt-2 text-xs">
						{task.params.size} · {task.params.quality} · {task.params.output_format}
					</p>
					<div class="border-border bg-muted/25 mt-4 rounded-lg border p-3 text-xs">
						<div class="text-muted-foreground mb-2 font-medium">使用配置</div>
						<div class="grid grid-cols-[88px_minmax(0,1fr)] gap-x-2 gap-y-1">
							<span class="text-muted-foreground">配置</span>
							<span class="truncate">{task.apiProfileName ?? '未知配置'}</span>
							<span class="text-muted-foreground">模式</span>
							<span>{task.apiProvider ?? 'openai'} · {task.apiMode ?? 'images'}</span>
							<span class="text-muted-foreground">模型</span>
							<span class="truncate">{task.model ?? '未知模型'}</span>
						</div>
					</div>
					<div class="border-border bg-muted/35 mt-4 grid grid-cols-3 gap-2 rounded-lg border p-3 text-center text-xs">
						<div>
							<div class="text-muted-foreground">预计</div>
							<Badge variant="secondary" class="mt-1">{formatExpectedImageCount(task.params.n)}</Badge>
						</div>
						<div>
							<div class="text-muted-foreground">实际</div>
							<Badge variant={task.params.n === 'auto' || task.images.length === task.params.n ? 'secondary' : 'outline'} class="mt-1">{formatImageCountRatio(task.images.length, task.params.n)} 张</Badge>
							{#if task.streamPartialImageIds.length}
								<div class="text-muted-foreground mt-1">partial {task.streamPartialImageIds.length}</div>
							{/if}
						</div>
						<div>
							<div class="text-muted-foreground">{task.status === 'running' ? '等待' : '耗时'}</div>
							<Badge variant="outline" class="mt-1">{formatDuration(getElapsedMs(task))}</Badge>
						</div>
					</div>
					{#if task.failureCount > 0 || task.error}
						<div class="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-800">
							{#if task.failureCount > 0}
								<p>{task.failureCount} 个请求未成功。</p>
							{/if}
							{#if task.error}
								<p class="mt-1">{task.error}</p>
							{/if}
						</div>
					{/if}
					{#if currentActualParams(task) || currentRevisedPrompt(task) || task.rawImageUrls.length}
						{@const actualParams = currentActualParams(task)}
						{@const revisedPrompt = currentRevisedPrompt(task)}
						<div class="border-border bg-muted/25 mt-3 space-y-3 rounded-lg border p-3 text-xs">
							{#if actualParams}
								<div>
									<div class="text-muted-foreground mb-2 font-medium">实际返回参数</div>
									<div class="grid grid-cols-2 gap-2">
										<div>
											<span class="text-muted-foreground">尺寸</span>
											<div class="font-medium">{formatTaskParamValue(actualParams.size)}</div>
										</div>
										<div>
											<span class="text-muted-foreground">质量</span>
											<div class="font-medium">{formatTaskParamValue(actualParams.quality)}</div>
										</div>
										<div>
											<span class="text-muted-foreground">格式</span>
											<div class="font-medium">{formatTaskParamValue(actualParams.output_format)}</div>
										</div>
										<div>
											<span class="text-muted-foreground">审核</span>
											<div class="font-medium">{formatTaskParamValue(actualParams.moderation)}</div>
										</div>
									</div>
								</div>
							{/if}
							{#if revisedPrompt}
								<div>
									<div class="text-muted-foreground mb-1 font-medium">Revised prompt</div>
									<p class="line-clamp-4 leading-relaxed">{revisedPrompt}</p>
								</div>
							{/if}
							{#if task.rawImageUrls.length}
								<div class="text-muted-foreground">原始 URL：{task.rawImageUrls.length} 个</div>
							{/if}
						</div>
					{/if}
					{#if downloadError}
						<div class="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs leading-relaxed text-destructive">
							{downloadError}
						</div>
					{/if}

					{#if task.inputImages.length}
						<div class="mt-5">
							<div class="text-muted-foreground mb-2 text-xs font-medium">输入图</div>
							<div class="grid grid-cols-4 gap-2">
								{#each task.inputImages as image, index}
									<ImageActionContextMenu
										canDownloadAll={false}
										canUseAsReference
										canEditMask={false}
										onOpen={() => onOpenInputLightbox(task, index)}
										onDownload={() => downloadImage(image.dataUrl, index)}
										onDownloadAll={() => undefined}
										onCopy={() => onCopyImage(image.dataUrl)}
										onUseAsReference={() => onUseAsReference({ ...task, images: task.inputImages.map((item) => item.dataUrl) }, index)}
										onEditMask={() => undefined}
									>
										<button class="overflow-hidden rounded-md border border-border" onclick={() => onOpenInputLightbox(task, index)} aria-label={`查看输入图 ${index + 1}`}>
											<img class="aspect-square w-full object-cover" src={image.dataUrl} alt={image.name} />
										</button>
									</ImageActionContextMenu>
								{/each}
							</div>
						</div>
					{/if}

					{#if task.streamPartialImageIds.length}
						<div class="mt-5">
							<div class="text-muted-foreground mb-2 text-xs font-medium">Partial images</div>
							<div class="grid grid-cols-3 gap-2">
								{#each task.streamPartialImageIds as image, index}
									<ImageActionContextMenu
										canDownloadAll={canDownloadAll && task.streamPartialImageIds.length > 1}
										canUseAsReference
										canEditMask={false}
										onOpen={() => onOpenLightbox({ ...task, images: task.streamPartialImageIds }, index)}
										onDownload={() => downloadImage(image, index)}
										onDownloadAll={() => onDownloadAll(task)}
										onCopy={() => onCopyImage(image)}
										onUseAsReference={() => onUseAsReference({ ...task, images: task.streamPartialImageIds }, index)}
										onEditMask={() => undefined}
									>
										<button class="relative overflow-hidden rounded-md border border-border" onclick={() => onOpenLightbox({ ...task, images: task.streamPartialImageIds }, index)}>
											<img class="aspect-square w-full object-cover" src={image} alt={`${task.prompt} partial ${index + 1}`} />
											<span class="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">P{index + 1}</span>
										</button>
									</ImageActionContextMenu>
								{/each}
							</div>
						</div>
					{/if}

					<div class="mt-5">
						<div class="text-muted-foreground mb-2 text-xs font-medium">输出图</div>
							<div class="grid grid-cols-3 gap-2">
								{#each task.images as image, index}
									<ImageActionContextMenu
										canDownloadAll={canDownloadAll && task.images.length > 1}
										canUseAsReference
										canEditMask
										onOpen={() => onOpenLightbox(task, index)}
										onDownload={() => downloadImage(image, index)}
										onDownloadAll={() => onDownloadAll(task)}
										onCopy={() => onCopyImage(image)}
										onUseAsReference={() => onUseAsReference(task, index)}
										onEditMask={() => {
											onEditMask(task, index);
											close();
										}}
									>
										<button class={`relative overflow-hidden rounded-md border ${selectedIndex === index ? 'border-primary ring-ring ring-2' : 'border-border'}`} onclick={() => (selectedIndex = index)}>
											<img class="aspect-square w-full object-cover" src={image} alt={`${task.prompt} ${index + 1}`} />
											<span class="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">{index + 1}</span>
										</button>
									</ImageActionContextMenu>
								{/each}
							</div>
					</div>
				</div>

				<footer class="border-border grid grid-cols-2 gap-2 border-t p-4">
					<Button variant="outline" onclick={() => { onReuse(task); close(); }}>
						<RotateCcw class="size-4" />
						复用
					</Button>
					<Button variant="outline" disabled={!previewImages[selectedIndex]} onclick={() => downloadImage(previewImages[selectedIndex], selectedIndex)}>
						<Download class="size-4" />
						下载当前
					</Button>
					{#if canDownloadAll}
						<Button variant="outline" disabled={!task.images.length && !task.streamPartialImageIds.length} onclick={() => onDownloadAll(task)}>
							<Download class="size-4" />
							下载全部
						</Button>
					{/if}
					<Button variant="outline" disabled={!previewImages[selectedIndex]} onclick={() => onUseAsReference(previewingPartial ? { ...task, images: task.streamPartialImageIds } : task, selectedIndex)}>
						<ImagePlus class="size-4" />
						用作参考
					</Button>
					<Button variant="outline" disabled={previewingPartial || !task.images[selectedIndex]} onclick={() => { onEditMask(task, selectedIndex); close(); }}>
						<Paintbrush class="size-4" />
						遮罩编辑
					</Button>
					<AlertDialog.Root>
						<AlertDialog.Trigger>
							<Button variant="destructive">
								<Trash2 class="size-4" />
								删除
							</Button>
						</AlertDialog.Trigger>
						<AlertDialog.Content>
							<AlertDialog.Header>
								<AlertDialog.Title>删除这个任务？</AlertDialog.Title>
								<AlertDialog.Description>
									将删除当前任务及其本地图片文件。此操作不可恢复。
								</AlertDialog.Description>
							</AlertDialog.Header>
							<AlertDialog.Footer>
								<AlertDialog.Cancel>取消</AlertDialog.Cancel>
								<AlertDialog.Action onclick={() => { onDelete(task.id); close(); }}>确认删除</AlertDialog.Action>
							</AlertDialog.Footer>
						</AlertDialog.Content>
					</AlertDialog.Root>
				</footer>
			</aside>
		</section>
	</div>
{/if}
