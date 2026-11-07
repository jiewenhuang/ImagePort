<script lang="ts">
	import { Download, Upload, Trash2 } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import SettingSwitch from './SettingSwitch.svelte';
	import { getTaskOutputCount } from '$lib/domain/task-media';
	import {
		buildExportedSettings,
		parseImportedSettings,
		normalizeSettings,
		normalizeZipDownloadRoutes,
		type AppSettings,
		type ZipDownloadRoute
	} from '$lib/domain/settings';
	import type { TaskRecord } from '$lib/domain/types';
	import type { TaskImportSummary } from '$lib/domain/task-storage';
	import { saveBlobToFile } from '$lib/storage/native-download';
	import {
		formatStorageBytes,
		getStorageBytesTone,
		formatLoadedTaskCount,
		getTaskStorageEstimateLabel
	} from './gallery-settings-storage';
	let {
		settings = $bindable(),
		tasks,
		totalTaskCount = null,
		tasksStorageBytes,
		onExportTasks,
		onExportFullBackup,
		onImportTasks,
		onImportFullBackup,
		onClearTasks,
		onCleanupImages
	}: {
		settings: AppSettings;
		tasks: TaskRecord[];
		totalTaskCount?: number | null;
		tasksStorageBytes: number | null;
		onExportTasks: () => void | Promise<void>;
		onExportFullBackup: () => void | Promise<void>;
		onImportTasks: (file: File) => Promise<TaskImportSummary>;
		onImportFullBackup: (file: File) => Promise<TaskImportSummary>;
		onClearTasks: () => void | Promise<void>;
		onCleanupImages: () => Promise<{ removedCount: number; failedCount: number }>;
	} = $props();
	let includeApiKeys = $state(false);
	let importError = $state<string | null>(null);
	let importSuccess = $state<string | null>(null);
	let taskImportError = $state<string | null>(null);
	let taskImportSuccess = $state<string | null>(null);
	let cleanupError = $state<string | null>(null);
	let cleanupSuccess = $state<string | null>(null);
	let isCleaningImages = $state(false);
	let exporting = $state<'tasks' | 'backup' | null>(null);
	let showClearTasksDialog = $state(false);
	let importInput = $state<HTMLInputElement>();
	let taskImportInput = $state<HTMLInputElement>();
	let fullBackupImportInput = $state<HTMLInputElement>();
	let taskCountLabel = $derived(formatLoadedTaskCount(tasks.length, totalTaskCount));
	let taskStorageEstimateLabel = $derived(getTaskStorageEstimateLabel(tasks.length, totalTaskCount));
	function updateSettings(patch: Partial<AppSettings>) {
		settings = normalizeSettings({ ...settings, ...patch });
	}
	function toggleZipDownloadRoute(route: ZipDownloadRoute) {
		const current = new Set(settings.zipDownloadRoutes);
		if (current.has(route)) current.delete(route);
		else current.add(route);
		updateSettings({ zipDownloadRoutes: normalizeZipDownloadRoutes([...current]) });
	}

	function exportSettings() {
		const payload = buildExportedSettings(settings, includeApiKeys);
		const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
		void saveBlobToFile(blob, 'imageport-settings.json')
			.then((saved) => {
				if (saved) toast.success('设置已导出', { description: includeApiKeys ? '已包含 API Key' : '未包含 API Key' });
			})
			.catch((err) => {
				importError = `导出失败：${err instanceof Error ? err.message : String(err)}`;
				toast.error('设置导出失败', { description: importError });
			});
	}

	function openImportPicker() {
		importInput?.click();
	}

	function openTaskImportPicker() {
		taskImportInput?.click();
	}

	function openFullBackupImportPicker() {
		fullBackupImportInput?.click();
	}

	async function importSettings(event: Event) {
		showClearTasksDialog = false;
		importError = null;
		importSuccess = null;
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		try {
			settings = parseImportedSettings(await file.text());
			importSuccess = '设置已导入';
			toast.success('设置已导入');
		} catch (err) {
			importError = err instanceof Error ? err.message : String(err);
			toast.error('设置导入失败', { description: importError });
		}
	}

	async function importTasks(event: Event) {
		showClearTasksDialog = false;
		taskImportError = null;
		taskImportSuccess = null;
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		try {
			const summary = await onImportTasks(file);
			taskImportSuccess = `已导入 ${summary.addedCount} 个任务，跳过 ${summary.skippedDuplicateCount} 个重复任务`;
		} catch (err) {
			taskImportError = err instanceof Error ? err.message : String(err);
			toast.error('任务导入失败', { description: taskImportError });
		}
	}

	async function importFullBackup(event: Event) {
		showClearTasksDialog = false;
		taskImportError = null;
		taskImportSuccess = null;
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		try {
			const summary = await onImportFullBackup(file);
			taskImportSuccess = `完整备份已恢复：新增 ${summary.addedCount} 个任务，跳过 ${summary.skippedDuplicateCount} 个重复任务`;
		} catch (err) {
			taskImportError = err instanceof Error ? err.message : String(err);
			toast.error('完整备份恢复失败', { description: taskImportError });
		}
	}

	async function clearTasks() {
		if (!tasks.length) return;
		taskImportSuccess = null;
		showClearTasksDialog = false;
		try {
			await onClearTasks();
		} catch (err) {
			toast.error('清空任务失败', { description: err instanceof Error ? err.message : String(err) });
		}
	}

	async function exportData(kind: 'tasks' | 'backup', action: () => void | Promise<void>) {
		if (exporting) return;
		exporting = kind;
		try {
			await action();
		} catch (error) {
			toast.error('导出失败', { description: error instanceof Error ? error.message : String(error) });
		} finally {
			exporting = null;
		}
	}

	async function cleanupImages() {
		showClearTasksDialog = false;
		cleanupError = null;
		cleanupSuccess = null;
		isCleaningImages = true;
		try {
			const result = await onCleanupImages();
			cleanupSuccess =
				result.removedCount > 0
					? `已清理 ${result.removedCount} 个无引用图片文件${result.failedCount ? `，${result.failedCount} 个文件清理失败` : ''}`
					: result.failedCount
						? `${result.failedCount} 个无引用图片文件清理失败`
						: '没有发现需要清理的图片文件';
		} catch (err) {
			cleanupError = err instanceof Error ? err.message : String(err);
			toast.error('图片清理失败', { description: cleanupError });
		} finally {
			isCleaningImages = false;
		}
	}

	const zipRouteOptions: Array<{ route: ZipDownloadRoute; label: string; description: string }> = [
		{ route: 'task-card', label: '任务卡片', description: '任务卡片和更多菜单里的整任务下载。' },
		{ route: 'task-detail-all', label: '详情页全部', description: '任务详情页下载全部输出图。' },
		{ route: 'task-selection', label: '批量选择', description: '选择多个任务后下载 ZIP。' },
		{ route: 'lightbox', label: '大图预览', description: 'Lightbox 内的批量下载入口。' },
		{ route: 'favorite-collection-selection', label: '收藏集合', description: '收藏集合视图中的批量下载。' },
		{ route: 'agent-round-all', label: 'Agent 轮次', description: 'Agent 某轮回复关联图片的批量下载。' }
	];
</script>

<div class="grid gap-4">
	<section class="rounded-lg border bg-muted/20 p-4">
		<h4 class="text-sm font-semibold">ZIP 下载策略</h4>
		<p class="text-muted-foreground mt-1 text-xs">控制哪些入口默认以 ZIP 方式下载多张图片。</p>
		<div class="mt-3 grid gap-2 sm:grid-cols-2">
			{#each zipRouteOptions as option}
				<SettingSwitch
					title={option.label}
					description={option.description}
					checked={settings.zipDownloadRoutes.includes(option.route)}
					onToggle={() => toggleZipDownloadRoute(option.route)}
				/>
			{/each}
		</div>
	</section>
	<section class="rounded-lg border bg-muted/20 p-4">
		<div class="flex items-start justify-between gap-4">
			<div>
				<h4 class="text-sm font-semibold">完整备份 ZIP</h4>
				<p class="text-muted-foreground mt-1 text-xs">
					导出设置、Agent 会话、全部历史任务和对应图片文件；恢复时默认合并导入，不覆盖现有任务。
				</p>
			</div>
			<div class="flex shrink-0 gap-2">
				<Button onclick={() => exportData('backup', onExportFullBackup)} disabled={!tasks.length || !!exporting}>
					<Download class="size-4" />
					{exporting === 'backup' ? '备份中…' : '备份'}
				</Button>
				<Button variant="outline" onclick={openFullBackupImportPicker}>
					<Upload class="size-4" />
					恢复
				</Button>
			</div>
		</div>
		<input
			bind:this={fullBackupImportInput}
			type="file"
			accept="application/zip,.zip"
			class="hidden"
			onchange={importFullBackup}
		/>
	</section>

	<section class="rounded-lg border bg-muted/20 p-4">
		<h4 class="text-sm font-semibold">数据库诊断</h4>
		<div class="mt-3 grid grid-cols-3 gap-3 text-xs">
			<div class="rounded-lg border bg-background/70 p-3">
				<div class="text-muted-foreground">已加载任务</div>
				<div class="mt-1 font-medium">{taskCountLabel}</div>
			</div>
			<div class="rounded-lg border bg-background/70 p-3">
				<div class="text-muted-foreground">输出图</div>
				<div class="mt-1 font-medium">{tasks.reduce((total, task) => total + getTaskOutputCount(task), 0)}</div>
			</div>
			<div class="rounded-lg border bg-background/70 p-3">
				<div class="text-muted-foreground">{taskStorageEstimateLabel}</div>
				<div class="mt-1 font-medium">{formatStorageBytes(tasksStorageBytes)}</div>
			</div>
		</div>
		<p class="text-muted-foreground mt-3 text-xs">
			更深入的丢失文件扫描会在完整数据管理阶段继续增强；当前不会自动删除任何历史图片。
		</p>
	</section>

	<section class="rounded-lg border bg-muted/20 p-4">
		<div class="flex items-start justify-between gap-4">
			<div>
				<h4 class="text-sm font-semibold">导出设置</h4>
				<p class="text-muted-foreground mt-1 text-xs">导出当前设置 JSON。默认不包含 API Key。</p>
			</div>
			<Button onclick={exportSettings}>
				<Download class="size-4" />
				导出
			</Button>
		</div>
		<label class="mt-3 flex items-center gap-2 text-xs">
			<input bind:checked={includeApiKeys} type="checkbox" class="size-4" />
			<span>包含 API Key</span>
		</label>
	</section>

	<section class="rounded-lg border bg-muted/20 p-4">
		<div class="flex items-start justify-between gap-4">
			<div>
				<h4 class="text-sm font-semibold">导入设置</h4>
				<p class="text-muted-foreground mt-1 text-xs">支持导入 ImagePort 设置 JSON，兼容旧版单配置字段。</p>
				{#if importError}
					<p class="mt-2 text-xs text-destructive">{importError}</p>
				{/if}
				{#if importSuccess}
					<p class="mt-2 text-xs text-emerald-700">{importSuccess}</p>
				{/if}
			</div>
			<Button variant="outline" onclick={openImportPicker}>
				<Upload class="size-4" />
				导入
			</Button>
		</div>
		<input
			bind:this={importInput}
			type="file"
			accept="application/json,.json"
			class="hidden"
			onchange={importSettings}
		/>
	</section>

	<section class="rounded-lg border bg-muted/20 p-4">
		<div class="flex items-start justify-between gap-4">
			<div>
				<h4 class="text-sm font-semibold">导出任务</h4>
				<p class="text-muted-foreground mt-1 text-xs">
					导出全部 {totalTaskCount ?? tasks.length} 个历史任务，包含生成图片和参考图。
				</p>
				<p class={`mt-1 text-xs ${getStorageBytesTone(tasksStorageBytes)}`}>
					当前预览数据约 {formatStorageBytes(tasksStorageBytes)}，完整备份包含原图，建议定期备份。
				</p>
			</div>
			<Button onclick={() => exportData('tasks', onExportTasks)} disabled={!tasks.length || !!exporting}>
				<Download class="size-4" />
				{exporting === 'tasks' ? '导出中…' : '导出任务'}
			</Button>
		</div>
	</section>

	<section class="rounded-lg border bg-muted/20 p-4">
		<div class="flex items-start justify-between gap-4">
			<div>
				<h4 class="text-sm font-semibold">导入任务</h4>
				<p class="text-muted-foreground mt-1 text-xs">导入 ImagePort 任务 JSON，重复 ID 会自动跳过。</p>
				{#if taskImportError}
					<p class="mt-2 text-xs text-destructive">{taskImportError}</p>
				{/if}
				{#if taskImportSuccess}
					<p class="mt-2 text-xs text-emerald-700">{taskImportSuccess}</p>
				{/if}
			</div>
			<Button variant="outline" onclick={openTaskImportPicker}>
				<Upload class="size-4" />
				导入任务
			</Button>
		</div>
		<input
			bind:this={taskImportInput}
			type="file"
			accept="application/json,.json"
			class="hidden"
			onchange={importTasks}
		/>
	</section>

	<section class="rounded-lg border bg-muted/20 p-4">
		<div class="flex items-start justify-between gap-4">
			<div>
				<h4 class="text-sm font-semibold">清理图片文件</h4>
				<p class="text-muted-foreground mt-1 text-xs">清理不再被任何历史任务引用的图片文件，保留其他分页中的图片。</p>
				{#if cleanupError}
					<p class="mt-2 text-xs text-destructive">{cleanupError}</p>
				{/if}
				{#if cleanupSuccess}
					<p class="mt-2 text-xs text-emerald-700">{cleanupSuccess}</p>
				{/if}
			</div>
			<Button variant="outline" onclick={cleanupImages} disabled={isCleaningImages}>
				<Trash2 class="size-4" />
				{isCleaningImages ? '清理中' : '清理图片'}
			</Button>
		</div>
	</section>

	<section class="rounded-lg border border-destructive/25 bg-destructive/5 p-4">
		<div class="flex items-start justify-between gap-4">
			<div>
				<h4 class="text-sm font-semibold text-destructive">清空任务</h4>
				<p class="text-muted-foreground mt-1 text-xs">
					当前任务：{totalTaskCount ?? tasks.length} 个。此操作不会清除 API 配置。
				</p>
			</div>
			<AlertDialog.Root bind:open={showClearTasksDialog}>
				<AlertDialog.Trigger>
					<Button variant="destructive" disabled={!tasks.length}>
						<Trash2 class="size-4" />
						清空
					</Button>
				</AlertDialog.Trigger>
				<AlertDialog.Content>
					<AlertDialog.Header>
						<AlertDialog.Title>清空全部任务？</AlertDialog.Title>
						<AlertDialog.Description>
							将删除全部 {totalTaskCount ?? tasks.length} 个任务及其本地图片文件，但不会清除 API 配置。此操作不可恢复。
						</AlertDialog.Description>
					</AlertDialog.Header>
					<AlertDialog.Footer>
						<AlertDialog.Cancel>取消</AlertDialog.Cancel>
						<AlertDialog.Action onclick={clearTasks}>确认清空</AlertDialog.Action>
					</AlertDialog.Footer>
				</AlertDialog.Content>
			</AlertDialog.Root>
		</div>
	</section>
</div>
