<script lang="ts">
	import {
		ChevronLeft,
		ChevronRight,
		Clipboard,
		Download,
		ImagePlus,
		Minus,
		Paintbrush,
		Plus,
		RotateCcw,
		X
	} from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import {
		getWrappedImageIndex,
		panLightboxTransform,
		resetLightboxTransform,
		zoomLightboxTransform,
		type LightboxTransform
	} from '$lib/domain/lightbox';

	let {
		open = $bindable(false),
		images,
		index = $bindable(0),
		title = '图片预览',
		canUseAsReference = false,
		canEditMask = false,
		onDownload,
		onDownloadAll,
		onCopy,
		onUseAsReference,
		onEditMask
	}: {
		open?: boolean;
		images: string[];
		index?: number;
		title?: string;
		canUseAsReference?: boolean;
		canEditMask?: boolean;
		onDownload: (src: string, index: number) => void;
		onDownloadAll?: () => void;
		onCopy: (src: string) => void | Promise<void>;
		onUseAsReference?: (index: number) => void | Promise<void>;
		onEditMask?: (index: number) => void | Promise<void>;
	} = $props();

	let transform = $state<LightboxTransform>(resetLightboxTransform());
	let dragPointerId = $state<number | null>(null);
	let lastPointer = $state<{ x: number; y: number } | null>(null);
	let viewport: HTMLDivElement | undefined = $state();

	let currentImage = $derived(images[index] ?? null);

	$effect(() => {
		if (!open) {
			transform = resetLightboxTransform();
			dragPointerId = null;
			lastPointer = null;
		}
	});

	$effect(() => {
		if (!images.length) {
			index = 0;
			return;
		}
		if (index < 0 || index >= images.length) index = Math.min(Math.max(index, 0), images.length - 1);
	});

	function close() {
		open = false;
	}

	function previous() {
		if (images.length <= 1) return;
		index = getWrappedImageIndex(index, -1, images.length);
		transform = resetLightboxTransform();
	}

	function next() {
		if (images.length <= 1) return;
		index = getWrappedImageIndex(index, 1, images.length);
		transform = resetLightboxTransform();
	}

	function zoomIn() {
		transform = zoomLightboxTransform(transform, 1);
	}

	function zoomOut() {
		transform = zoomLightboxTransform(transform, -1);
	}

	function resetZoom() {
		transform = resetLightboxTransform();
	}

	function handleKeydown(event: KeyboardEvent) {
		if (!open) return;
		if (event.key === 'Escape') {
			event.preventDefault();
			close();
		} else if (event.key === 'ArrowLeft') {
			event.preventDefault();
			previous();
		} else if (event.key === 'ArrowRight') {
			event.preventDefault();
			next();
		} else if (event.key === '+' || event.key === '=') {
			event.preventDefault();
			zoomIn();
		} else if (event.key === '-') {
			event.preventDefault();
			zoomOut();
		} else if (event.key === '0') {
			event.preventDefault();
			resetZoom();
		}
	}

	function handleWheel(event: WheelEvent) {
		if (!open) return;
		event.preventDefault();
		transform = zoomLightboxTransform(transform, event.deltaY > 0 ? -1 : 1);
	}

	function startDrag(event: PointerEvent) {
		if (transform.scale <= 1) return;
		dragPointerId = event.pointerId;
		lastPointer = { x: event.clientX, y: event.clientY };
		viewport?.setPointerCapture(event.pointerId);
	}

	function moveDrag(event: PointerEvent) {
		if (dragPointerId !== event.pointerId || !lastPointer) return;
		transform = panLightboxTransform(transform, event.clientX - lastPointer.x, event.clientY - lastPointer.y);
		lastPointer = { x: event.clientX, y: event.clientY };
	}

	function stopDrag(event: PointerEvent) {
		if (dragPointerId !== event.pointerId) return;
		viewport?.releasePointerCapture(event.pointerId);
		dragPointerId = null;
		lastPointer = null;
	}

	function downloadCurrent() {
		if (!currentImage) return;
		onDownload(currentImage, index);
	}

	function downloadAll() {
		onDownloadAll?.();
	}

	function copyCurrent() {
		if (!currentImage) return;
		void onCopy(currentImage);
	}
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open && currentImage}
	<div class="fixed inset-0 z-[80] bg-black text-white">
		<div class="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.08),transparent_42%)]"></div>
		<header class="absolute top-0 right-0 left-0 z-10 flex h-14 items-center justify-between border-b border-white/10 bg-black/65 px-4 backdrop-blur">
			<div class="min-w-0">
				<p class="truncate text-sm font-medium">{title}</p>
				<p class="text-xs text-white/60">{index + 1}/{images.length} · {Math.round(transform.scale * 100)}%</p>
			</div>
			<div class="flex items-center gap-1.5">
				<Button variant="ghost" size="icon-sm" class="text-white hover:bg-white/10 hover:text-white" onclick={zoomOut} aria-label="缩小">
					<Minus class="size-4" />
				</Button>
				<Button variant="ghost" size="icon-sm" class="text-white hover:bg-white/10 hover:text-white" onclick={resetZoom} aria-label="重置缩放">
					<RotateCcw class="size-4" />
				</Button>
				<Button variant="ghost" size="icon-sm" class="text-white hover:bg-white/10 hover:text-white" onclick={zoomIn} aria-label="放大">
					<Plus class="size-4" />
				</Button>
				<Button variant="ghost" size="icon-sm" class="text-white hover:bg-white/10 hover:text-white" onclick={copyCurrent} aria-label="复制图片">
					<Clipboard class="size-4" />
				</Button>
				<Button variant="ghost" size="icon-sm" class="text-white hover:bg-white/10 hover:text-white" onclick={downloadCurrent} aria-label="保存图片">
					<Download class="size-4" />
				</Button>
				{#if onDownloadAll && images.length > 1}
					<Button variant="ghost" size="sm" class="text-white hover:bg-white/10 hover:text-white" onclick={downloadAll}>
						<Download class="size-4" />
						全部
					</Button>
				{/if}
				<Button variant="ghost" size="icon-sm" class="text-white hover:bg-white/10 hover:text-white" onclick={close} aria-label="关闭">
					<X class="size-4" />
				</Button>
			</div>
		</header>

		<div
			bind:this={viewport}
			role="presentation"
			class={`absolute inset-0 flex items-center justify-center overflow-hidden px-6 pt-16 pb-20 ${transform.scale > 1 ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'}`}
			onwheel={handleWheel}
			onpointerdown={startDrag}
			onpointermove={moveDrag}
			onpointerup={stopDrag}
			onpointercancel={stopDrag}
		>
			<img
				class="max-h-full max-w-full select-none object-contain shadow-2xl"
				src={currentImage}
				alt={title}
				draggable="false"
				style={`transform: translate3d(${transform.x}px, ${transform.y}px, 0) scale(${transform.scale}); transition: ${dragPointerId == null ? 'transform 120ms ease' : 'none'};`}
				ondblclick={transform.scale > 1 ? resetZoom : zoomIn}
			/>
		</div>

		{#if images.length > 1}
			<Button
				type="button"
				variant="secondary"
				size="icon"
				class="absolute top-1/2 left-4 z-10 size-11 -translate-y-1/2 rounded-full bg-white/12 text-white shadow-lg backdrop-blur hover:bg-white/20 hover:text-white"
				onclick={previous}
				aria-label="上一张"
			>
				<ChevronLeft class="size-6" />
			</Button>
			<Button
				type="button"
				variant="secondary"
				size="icon"
				class="absolute top-1/2 right-4 z-10 size-11 -translate-y-1/2 rounded-full bg-white/12 text-white shadow-lg backdrop-blur hover:bg-white/20 hover:text-white"
				onclick={next}
				aria-label="下一张"
			>
				<ChevronRight class="size-6" />
			</Button>
		{/if}

		<footer class="absolute right-0 bottom-0 left-0 z-10 flex items-center justify-between gap-3 border-t border-white/10 bg-black/65 px-4 py-3 backdrop-blur">
			<div class="flex min-w-0 items-center gap-1.5 overflow-x-auto">
				{#each images as image, imageIndex}
					<button
						type="button"
						class={`h-12 w-12 shrink-0 overflow-hidden rounded-md border ${index === imageIndex ? 'border-white ring-2 ring-white/45' : 'border-white/20 opacity-70 hover:opacity-100'}`}
						onclick={() => {
							index = imageIndex;
							transform = resetLightboxTransform();
						}}
						aria-label={`查看第 ${imageIndex + 1} 张`}
					>
						<img class="h-full w-full object-cover" src={image} alt="" />
					</button>
				{/each}
			</div>
			<div class="flex shrink-0 items-center gap-2">
				{#if canUseAsReference}
					<Button variant="secondary" size="sm" class="bg-white/12 text-white hover:bg-white/20 hover:text-white" onclick={() => onUseAsReference?.(index)}>
						<ImagePlus class="size-4" />
						参考图
					</Button>
				{/if}
				{#if canEditMask}
					<Button variant="secondary" size="sm" class="bg-white/12 text-white hover:bg-white/20 hover:text-white" onclick={() => onEditMask?.(index)}>
						<Paintbrush class="size-4" />
						遮罩
					</Button>
				{/if}
			</div>
		</footer>
	</div>
{/if}
