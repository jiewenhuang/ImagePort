<script lang="ts">
	import { ImagePlus, Pencil, Trash2, X } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import type { InputImage, MaskDraft } from '$lib/domain/types';

	let {
		images,
		mask,
		onAdd,
		onRemove,
		onClear,
		onEditMask
	}: {
		images: InputImage[];
		mask: MaskDraft | null;
		onAdd: () => void;
		onRemove: (id: string) => void;
		onClear: () => void;
		onEditMask: (id: string) => void;
	} = $props();
</script>

<div class="mb-3 flex items-start gap-2 overflow-x-auto pt-2 pb-1">
	{#each images as image, index}
		{@const isMaskTarget = mask?.targetImageId === image.id}
		<div class="group relative size-14 shrink-0 overflow-visible">
			<div
				class={`relative h-full w-full overflow-hidden rounded-lg border ${isMaskTarget ? 'border-primary ring-ring ring-2' : 'border-border'}`}
			>
				<img class="h-full w-full object-cover" src={image.dataUrl} alt={image.name} />
				<span class="absolute bottom-1 left-1 rounded bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-white"
					>{index + 1}</span
				>
				{#if isMaskTarget}
					<span
						class="absolute top-1 left-1 rounded bg-primary px-1.5 py-0.5 text-[9px] font-bold text-primary-foreground"
						>MASK</span
					>
				{/if}
				<button
					type="button"
					class="absolute inset-0 flex items-center justify-center bg-black/45 text-white opacity-0 transition-opacity group-hover:opacity-100"
					onclick={() => onEditMask(image.id)}
					aria-label="编辑遮罩"
				>
					<Pencil class="size-4" />
				</button>
			</div>
			<button
				type="button"
				class="absolute top-0 right-0 z-10 flex size-5 translate-x-1/4 -translate-y-1/4 items-center justify-center rounded-full bg-destructive text-white opacity-0 shadow transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
				onclick={(event) => {
					event.stopPropagation();
					onRemove(image.id);
				}}
				aria-label="移除参考图"
			>
				<X class="size-3" />
			</button>
		</div>
	{/each}

	<Button
		variant="outline"
		size="icon-lg"
		class="size-14 shrink-0 rounded-lg border-dashed"
		onclick={onAdd}
		aria-label="添加参考图"
	>
		<ImagePlus class="size-5" />
	</Button>

	{#if images.length}
		<Button
			variant="ghost"
			size="icon-lg"
			class="size-14 shrink-0 rounded-lg text-muted-foreground hover:text-destructive"
			onclick={onClear}
			aria-label="清空参考图"
		>
			<Trash2 class="size-5" />
		</Button>
	{/if}
</div>
