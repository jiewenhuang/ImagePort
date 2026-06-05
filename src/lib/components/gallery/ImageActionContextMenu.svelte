<script lang="ts">
	import { Clipboard, Download, Eye, ImagePlus, Images, Paintbrush } from '@lucide/svelte';
	import * as ContextMenu from '$lib/components/ui/context-menu';

	let {
		disabled = false,
		canDownloadAll = false,
		canUseAsReference = false,
		canEditMask = false,
		showOpen = true,
		openLabel = '查看大图',
		onOpen,
		onDownload,
		onDownloadAll,
		onCopy,
		onUseAsReference,
		onEditMask,
		children
	}: {
		disabled?: boolean;
		canDownloadAll?: boolean;
		canUseAsReference?: boolean;
		canEditMask?: boolean;
		showOpen?: boolean;
		openLabel?: string;
		onOpen?: () => void;
		onDownload: () => void;
		onDownloadAll?: () => void;
		onCopy: () => void | Promise<void>;
		onUseAsReference?: () => void | Promise<void>;
		onEditMask?: () => void | Promise<void>;
		children: import('svelte').Snippet;
	} = $props();
</script>

<ContextMenu.Root>
	<ContextMenu.Trigger {disabled} class="contents">
		{@render children?.()}
	</ContextMenu.Trigger>
	<ContextMenu.Content class="z-[100] w-48">
		{#if showOpen && onOpen}
			<ContextMenu.Item onclick={onOpen}>
				<Eye class="size-4" />
				{openLabel}
			</ContextMenu.Item>
		{/if}
		<ContextMenu.Item onclick={onDownload}>
			<Download class="size-4" />
			保存当前
		</ContextMenu.Item>
		<ContextMenu.Item onclick={() => onDownloadAll?.()} disabled={!canDownloadAll || !onDownloadAll}>
			<Images class="size-4" />
			保存全部
		</ContextMenu.Item>
		<ContextMenu.Item onclick={() => void onCopy()}>
			<Clipboard class="size-4" />
			复制图片
		</ContextMenu.Item>
		<ContextMenu.Separator />
		<ContextMenu.Item onclick={() => void onUseAsReference?.()} disabled={!canUseAsReference || !onUseAsReference}>
			<ImagePlus class="size-4" />
			用作参考图
		</ContextMenu.Item>
		<ContextMenu.Item onclick={() => void onEditMask?.()} disabled={!canEditMask || !onEditMask}>
			<Paintbrush class="size-4" />
			遮罩编辑
		</ContextMenu.Item>
	</ContextMenu.Content>
</ContextMenu.Root>
