<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { Eraser, Paintbrush, RotateCcw, Save, X } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import type { InputImage, MaskDraft } from '$lib/domain/types';

	let {
		open = $bindable(false),
		image,
		existingMask,
		onSave
	}: {
		open?: boolean;
		image: InputImage | null;
		existingMask: MaskDraft | null;
		onSave: (mask: MaskDraft) => void;
	} = $props();

	let imageCanvas = $state<HTMLCanvasElement>();
	let maskCanvas = $state<HTMLCanvasElement>();
	let previewCanvas = $state<HTMLCanvasElement>();
	let brushSize = $state(72);
	let mode = $state<'erase' | 'restore'>('erase');
	let isDrawing = false;
	let lastPoint: { x: number; y: number } | null = null;
	let loadedImage: HTMLImageElement | null = null;

	$effect(() => {
		if (open && image) {
			void initializeCanvas();
		}
	});

	onMount(() => {
		return () => {
			isDrawing = false;
			lastPoint = null;
		};
	});

	async function initializeCanvas() {
		await tick();
		if (!imageCanvas || !maskCanvas || !previewCanvas || !image) return;
		loadedImage = await loadImage(image.dataUrl);
		const width = loadedImage.naturalWidth;
		const height = loadedImage.naturalHeight;
		for (const canvas of [imageCanvas, maskCanvas, previewCanvas]) {
			canvas.width = width;
			canvas.height = height;
		}
		const imageCtx = imageCanvas.getContext('2d');
		const maskCtx = maskCanvas.getContext('2d');
		if (!imageCtx || !maskCtx) return;

		imageCtx.clearRect(0, 0, width, height);
		imageCtx.drawImage(loadedImage, 0, 0);

		maskCtx.clearRect(0, 0, width, height);
		maskCtx.fillStyle = '#ffffff';
		maskCtx.fillRect(0, 0, width, height);

		if (existingMask?.targetImageId === image.id) {
			try {
				const maskImage = await loadImage(existingMask.dataUrl);
				maskCtx.clearRect(0, 0, width, height);
				maskCtx.drawImage(maskImage, 0, 0, width, height);
			} catch {
				maskCtx.fillStyle = '#ffffff';
				maskCtx.fillRect(0, 0, width, height);
			}
		}
		renderPreview();
	}

	function close() {
		open = false;
	}

	function resetMask() {
		const ctx = maskCanvas?.getContext('2d');
		if (!ctx || !maskCanvas) return;
		ctx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
		ctx.fillStyle = '#ffffff';
		ctx.fillRect(0, 0, maskCanvas.width, maskCanvas.height);
		renderPreview();
	}

	function saveMask() {
		if (!image || !maskCanvas) return;
		onSave({
			targetImageId: image.id,
			dataUrl: maskCanvas.toDataURL('image/png'),
			updatedAt: Date.now()
		});
		close();
	}

	function pointerToCanvas(event: PointerEvent) {
		if (!maskCanvas) return { x: 0, y: 0 };
		const rect = maskCanvas.getBoundingClientRect();
		return {
			x: ((event.clientX - rect.left) / rect.width) * maskCanvas.width,
			y: ((event.clientY - rect.top) / rect.height) * maskCanvas.height
		};
	}

	function drawStroke(from: { x: number; y: number }, to: { x: number; y: number }) {
		if (!maskCanvas) return;
		const ctx = maskCanvas.getContext('2d');
		if (!ctx) return;
		ctx.save();
		ctx.globalCompositeOperation = mode === 'erase' ? 'destination-out' : 'source-over';
		ctx.lineWidth = Number(brushSize) || 72;
		ctx.lineCap = 'round';
		ctx.lineJoin = 'round';
		ctx.strokeStyle = mode === 'erase' ? '#000000' : '#ffffff';
		ctx.fillStyle = mode === 'erase' ? '#000000' : '#ffffff';
		ctx.beginPath();
		ctx.moveTo(from.x, from.y);
		ctx.lineTo(to.x, to.y);
		ctx.stroke();
		ctx.beginPath();
		ctx.arc(to.x, to.y, (Number(brushSize) || 72) / 2, 0, Math.PI * 2);
		ctx.fill();
		ctx.restore();
		renderPreview();
	}

	function renderPreview() {
		if (!maskCanvas || !previewCanvas) return;
		const previewCtx = previewCanvas.getContext('2d');
		if (!previewCtx) return;
		previewCtx.save();
		previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
		previewCtx.globalCompositeOperation = 'source-over';
		previewCtx.fillStyle = 'rgba(59, 130, 246, 0.58)';
		previewCtx.fillRect(0, 0, previewCanvas.width, previewCanvas.height);
		previewCtx.globalCompositeOperation = 'destination-out';
		previewCtx.drawImage(maskCanvas, 0, 0);
		previewCtx.restore();
	}

	function startDrawing(event: PointerEvent) {
		event.preventDefault();
		isDrawing = true;
		if (!maskCanvas) return;
		maskCanvas.setPointerCapture(event.pointerId);
		lastPoint = pointerToCanvas(event);
		drawStroke(lastPoint, lastPoint);
	}

	function moveDrawing(event: PointerEvent) {
		if (!isDrawing) return;
		event.preventDefault();
		const point = pointerToCanvas(event);
		drawStroke(lastPoint ?? point, point);
		lastPoint = point;
	}

	function stopDrawing(event: PointerEvent) {
		isDrawing = false;
		lastPoint = null;
		try {
			maskCanvas?.releasePointerCapture(event.pointerId);
		} catch {
			// Pointer capture may already be released by the browser.
		}
	}

	function loadImage(src: string) {
		return new Promise<HTMLImageElement>((resolve, reject) => {
			const img = new Image();
			img.onload = () => resolve(img);
			img.onerror = () => reject(new Error('图片加载失败'));
			img.src = src;
		});
	}
</script>

{#if open && image}
	<div class="fixed inset-0 z-[70] flex items-center justify-center p-4">
		<button
			type="button"
			class="absolute inset-0 cursor-default bg-black/45 backdrop-blur-sm"
			aria-label="关闭遮罩编辑"
			onclick={close}
		></button>

		<section
			class="bg-card text-card-foreground relative z-10 grid h-[88vh] w-full max-w-6xl grid-cols-[minmax(0,1fr)_300px] overflow-hidden rounded-lg border shadow-2xl max-md:grid-cols-1"
		>
			<div class="bg-muted/60 flex min-h-0 flex-col">
				<header class="border-border bg-background/90 flex items-center justify-between border-b px-4 py-3">
					<div>
						<h2 class="text-sm font-semibold">编辑遮罩</h2>
						<p class="text-muted-foreground mt-0.5 text-xs">擦除的透明区域会作为编辑区域提交。</p>
					</div>
					<Button variant="ghost" size="icon-sm" onclick={close} aria-label="关闭">
						<X class="size-4" />
					</Button>
				</header>

				<div class="flex min-h-0 flex-1 items-center justify-center p-4">
					<div class="relative max-h-full max-w-full overflow-hidden rounded-lg border bg-background shadow-xl">
						<canvas bind:this={imageCanvas} class="block max-h-[calc(88vh-7rem)] max-w-full" aria-hidden="true"
						></canvas>
						<canvas
							bind:this={previewCanvas}
							class="pointer-events-none absolute inset-0 block h-full w-full"
							aria-hidden="true"
						></canvas>
						<canvas
							bind:this={maskCanvas}
							class="absolute inset-0 block h-full w-full cursor-crosshair touch-none opacity-0"
							onpointerdown={startDrawing}
							onpointermove={moveDrawing}
							onpointerup={stopDrawing}
							onpointercancel={stopDrawing}
						></canvas>
					</div>
				</div>
			</div>

			<aside class="border-border flex flex-col border-l bg-background p-4">
				<div class="space-y-5">
					<div>
						<div class="text-sm font-medium">画笔模式</div>
						<div class="mt-2 grid grid-cols-2 gap-2">
							<Button variant={mode === 'erase' ? 'default' : 'outline'} onclick={() => (mode = 'erase')}>
								<Eraser class="size-4" />
								擦除
							</Button>
							<Button variant={mode === 'restore' ? 'default' : 'outline'} onclick={() => (mode = 'restore')}>
								<Paintbrush class="size-4" />
								恢复
							</Button>
						</div>
					</div>

					<label class="block space-y-2">
						<span class="text-sm font-medium">画笔大小</span>
						<Input bind:value={brushSize} name="brushSize" type="range" min="12" max="240" />
						<div class="text-muted-foreground text-xs">{brushSize}px</div>
					</label>

					<div class="border-border bg-muted/40 rounded-lg border p-3 text-xs leading-relaxed text-muted-foreground">
						OpenAI edits 的 mask 规则是：透明区域代表需要编辑的区域；不透明区域会尽量保留。
					</div>
				</div>

				<div class="mt-auto grid gap-2">
					<Button variant="outline" onclick={resetMask}>
						<RotateCcw class="size-4" />
						重置遮罩
					</Button>
					<Button onclick={saveMask}>
						<Save class="size-4" />
						保存遮罩
					</Button>
				</div>
			</aside>
		</section>
	</div>
{/if}
