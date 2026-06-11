<script lang="ts">
	import { CheckSquare, Download, Trash2 } from '@lucide/svelte';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';

	let {
		selectedCount,
		downloadableCount,
		visibleCount,
		canDownloadZip,
		deleteDialogOpen = $bindable(false),
		onSelectAll,
		onInvert,
		onDownloadZip,
		onDeleteSelected,
		onClear
	}: {
		selectedCount: number;
		downloadableCount: number;
		visibleCount: number;
		canDownloadZip: boolean;
		deleteDialogOpen?: boolean;
		onSelectAll: () => void;
		onInvert: () => void;
		onDownloadZip: () => void;
		onDeleteSelected: () => void | Promise<void>;
		onClear: () => void;
	} = $props();
</script>

<div
	class="border-border bg-card mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2 shadow-xs"
>
	<div class="flex min-w-0 items-center gap-2 text-sm">
		<CheckSquare class="text-primary size-4" />
		<span class="font-medium">已选 {selectedCount} 个任务</span>
		<Badge variant="secondary">可下载 {downloadableCount}</Badge>
	</div>
	<div class="flex flex-wrap items-center gap-2">
		<Button type="button" variant="outline" size="sm" onclick={onSelectAll} disabled={!visibleCount}>全选当前</Button>
		<Button type="button" variant="outline" size="sm" onclick={onInvert} disabled={!visibleCount}>反选</Button>
		{#if canDownloadZip}
			<Button type="button" variant="outline" size="sm" onclick={onDownloadZip} disabled={!downloadableCount}>
				<Download class="size-4" />
				ZIP 下载
			</Button>
		{/if}
		<AlertDialog.Root bind:open={deleteDialogOpen}>
			<AlertDialog.Trigger>
				<Button type="button" variant="destructive" size="sm" disabled={!selectedCount}>
					<Trash2 class="size-4" />
					删除
				</Button>
			</AlertDialog.Trigger>
			<AlertDialog.Content>
				<AlertDialog.Header>
					<AlertDialog.Title>删除所选任务？</AlertDialog.Title>
					<AlertDialog.Description>
						将删除 {selectedCount} 个任务及其本地图片文件。此操作不可恢复。
					</AlertDialog.Description>
				</AlertDialog.Header>
				<AlertDialog.Footer>
					<AlertDialog.Cancel>取消</AlertDialog.Cancel>
					<AlertDialog.Action onclick={onDeleteSelected}>确认删除</AlertDialog.Action>
				</AlertDialog.Footer>
			</AlertDialog.Content>
		</AlertDialog.Root>
		<Button type="button" variant="ghost" size="sm" onclick={onClear}>取消</Button>
	</div>
</div>
