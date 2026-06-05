<script lang="ts">
	import {
		Bot,
		Copy,
		Download,
		FileJson,
		Info,
		Plus,
		Settings2,
		SlidersHorizontal,
		Trash2,
		Upload,
		X
	} from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Select } from '$lib/components/ui/select';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import { toast } from 'svelte-sonner';
	import type { TaskRecord } from '$lib/domain/types';
	import type { TaskImportSummary } from '$lib/domain/task-storage';
	import type { CleanupImageFilesResult } from '$lib/storage/gallery-db';
	import { saveBlobToFile } from '$lib/storage/native-download';
	import {
		buildExportedSettings,
		DEFAULT_IMAGES_MODEL,
		DEFAULT_RESPONSES_MODEL,
		addApiProfile,
		addOpenAIProfile,
		duplicateProfile,
		getApiProviderLabel,
		getActiveProfile,
		importCustomProviderDefinitionFromJson,
		normalizeSettings,
		normalizeAgentMaxToolRounds,
		normalizeStreamPartialImages,
		normalizeTimeoutSecs,
		normalizeZipDownloadRoutes,
		parseImportedSettings,
		removeCustomProvider,
		removeProfile,
		switchApiProfileProvider,
		type AppSettings,
		type ApiMode,
		type ApiProvider,
		type CustomProviderDefinition,
		type ReferenceImageEditAction,
		type ZipDownloadRoute
	} from '$lib/domain/settings';
	import SettingSwitch from './SettingSwitch.svelte';

	let {
		open = $bindable(false),
		settings = $bindable(),
		tasks = [],
		tasksStorageBytes = 0,
		onClearTasks,
		onCleanupImages,
		onExportTasks,
		onImportTasks,
		onExportFullBackup,
		onImportFullBackup
	}: {
		open?: boolean;
		settings: AppSettings;
		tasks?: TaskRecord[];
		tasksStorageBytes?: number;
		onClearTasks: () => void;
		onCleanupImages: () => Promise<CleanupImageFilesResult>;
		onExportTasks: () => void;
		onImportTasks: (file: File) => Promise<TaskImportSummary>;
		onExportFullBackup: () => void;
		onImportFullBackup: (file: File) => Promise<TaskImportSummary>;
	} = $props();

	let activeTab = $state<'general' | 'api' | 'agent' | 'data' | 'about'>('api');
	let includeApiKeys = $state(false);
	let importError = $state<string | null>(null);
	let importSuccess = $state<string | null>(null);
	let taskImportError = $state<string | null>(null);
	let taskImportSuccess = $state<string | null>(null);
	let cleanupError = $state<string | null>(null);
	let cleanupSuccess = $state<string | null>(null);
	let isCleaningImages = $state(false);
	let pendingDeleteProfileId = $state<string | null>(null);
	let pendingDeleteCustomProviderId = $state<string | null>(null);
	let customProviderJson = $state('');
	let customProviderError = $state<string | null>(null);
	let customProviderSuccess = $state<string | null>(null);
	let showClearTasksDialog = $state(false);
	let importInput = $state<HTMLInputElement>();
	let taskImportInput = $state<HTMLInputElement>();
	let fullBackupImportInput = $state<HTMLInputElement>();

	let activeProfile = $derived(getActiveProfile(settings));

	$effect(() => {
		if (!tasks.length) showClearTasksDialog = false;
	});

	function close() {
		showClearTasksDialog = false;
		open = false;
	}

	function updateActiveProfile(patch: Partial<typeof activeProfile>) {
		settings = {
			...settings,
			profiles: settings.profiles.map((profile) =>
				profile.id === activeProfile.id ? { ...profile, ...patch } : profile
			)
		};
	}

	function updateSettings(patch: Partial<AppSettings>) {
		settings = normalizeSettings({ ...settings, ...patch });
	}

	function switchProfile(profileId: string) {
		pendingDeleteProfileId = null;
		showClearTasksDialog = false;
		settings = normalizeSettings({ ...settings, activeProfileId: profileId });
	}

	function createProfile() {
		pendingDeleteProfileId = null;
		showClearTasksDialog = false;
		settings = addOpenAIProfile(settings);
	}

	function createProfileForProvider(provider: ApiProvider) {
		pendingDeleteProfileId = null;
		showClearTasksDialog = false;
		settings = addApiProfile(settings, provider);
	}

	function copyProfile() {
		pendingDeleteProfileId = null;
		showClearTasksDialog = false;
		settings = duplicateProfile(settings, activeProfile.id);
	}

	function deleteProfile(profileId: string) {
		if (settings.profiles.length <= 1) return;
		if (pendingDeleteProfileId !== profileId) {
			pendingDeleteProfileId = profileId;
			return;
		}
		settings = removeProfile(settings, profileId);
		pendingDeleteProfileId = null;
	}

	function updateTimeout(event: Event) {
		const value = Number((event.currentTarget as HTMLInputElement).value);
		updateActiveProfile({
			timeoutSecs: normalizeTimeoutSecs(Number.isFinite(value) ? value : activeProfile.timeoutSecs)
		});
	}

	function updateStreamPartialImages(event: Event) {
		updateActiveProfile({
			streamPartialImages: normalizeStreamPartialImages((event.currentTarget as HTMLInputElement).value)
		});
	}

	function updateProvider(event: Event) {
		const provider = (event.currentTarget as HTMLSelectElement).value as ApiProvider;
		const customProvider = settings.customProviders.find((item) => item.id === provider) ?? null;
		updateActiveProfile(switchApiProfileProvider(activeProfile, provider, customProvider));
	}

	function updateAgentMaxToolRounds(event: Event) {
		updateSettings({
			agentMaxToolRounds: normalizeAgentMaxToolRounds((event.currentTarget as HTMLInputElement).value)
		});
	}

	function toggleZipDownloadRoute(route: ZipDownloadRoute) {
		const current = new Set(settings.zipDownloadRoutes);
		if (current.has(route)) current.delete(route);
		else current.add(route);
		updateSettings({ zipDownloadRoutes: normalizeZipDownloadRoutes([...current]) });
	}

	function updateApiMode(event: Event) {
		const apiMode = (event.currentTarget as HTMLSelectElement).value as ApiMode;
		const currentModel = activeProfile.model.trim();
		const shouldUseDefaultModel =
			currentModel === DEFAULT_IMAGES_MODEL ||
			currentModel === DEFAULT_RESPONSES_MODEL ||
			currentModel === 'gpt-5.1' ||
			!currentModel;
		updateActiveProfile({
			apiMode,
			model: shouldUseDefaultModel
				? apiMode === 'responses'
					? DEFAULT_RESPONSES_MODEL
					: DEFAULT_IMAGES_MODEL
				: activeProfile.model
		});
	}

	function importCustomProvider() {
		customProviderError = null;
		customProviderSuccess = null;
		try {
			const provider = importCustomProviderDefinitionFromJson(customProviderJson, settings.customProviders);
			const providers = replaceOrAppendCustomProvider(settings.customProviders, provider);
			settings = normalizeSettings({
				...settings,
				customProviders: providers
			});
			customProviderJson = JSON.stringify(provider, null, 2);
			customProviderSuccess = `已保存 ${provider.name}`;
			toast.success('自定义服务商已保存', { description: provider.name });
		} catch (err) {
			customProviderError = err instanceof Error ? err.message : String(err);
			toast.error('自定义服务商导入失败', { description: customProviderError });
		}
	}

	function editCustomProvider(provider: CustomProviderDefinition) {
		customProviderJson = JSON.stringify(provider, null, 2);
		customProviderError = null;
		customProviderSuccess = null;
	}

	function deleteCustomProvider(providerId: string) {
		if (pendingDeleteCustomProviderId !== providerId) {
			pendingDeleteCustomProviderId = providerId;
			return;
		}
		settings = removeCustomProvider(settings, providerId);
		pendingDeleteCustomProviderId = null;
		toast.success('自定义服务商已删除');
	}

	function replaceOrAppendCustomProvider(providers: CustomProviderDefinition[], provider: CustomProviderDefinition) {
		const exists = providers.some((item) => item.id === provider.id);
		return exists ? providers.map((item) => (item.id === provider.id ? provider : item)) : [...providers, provider];
	}

	function displayProfileName(name: string) {
		return name.trim() || '未命名配置';
	}

	function updateReferenceImageEditAction(event: Event) {
		updateSettings({
			referenceImageEditAction: (event.currentTarget as HTMLSelectElement).value as ReferenceImageEditAction
		});
	}

	function requestNotificationPermission() {
		if (typeof Notification === 'undefined') return;
		void Notification.requestPermission().then((permission) => {
			updateSettings({ taskCompletionNotification: permission === 'granted' });
		});
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

	function clearTasks() {
		if (!tasks.length) return;
		taskImportSuccess = null;
		showClearTasksDialog = false;
		onClearTasks();
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

	function formatBytes(bytes: number) {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
	}

	function getStorageTone(bytes: number) {
		if (bytes >= 4 * 1024 * 1024) return 'text-amber-700';
		return 'text-muted-foreground';
	}

	function getTabTitle() {
		if (activeTab === 'api') return 'API 配置';
		if (activeTab === 'general') return '通用设置';
		if (activeTab === 'agent') return 'Agent 配置';
		if (activeTab === 'about') return '关于';
		return '下载与数据';
	}

	function getTabDescription() {
		if (activeTab === 'api')
			return '请求通过 Tauri 后端发送，支持 OpenAI-compatible Images、Responses 和自定义 HTTP 图像服务商。';
		if (activeTab === 'general') return '控制输入、通知、复用和任务提交习惯。';
		if (activeTab === 'agent') return 'Agent Workspace 使用 OpenAI Responses API，生成图片会落到 Gallery 任务。';
		if (activeTab === 'about') return '应用版本、数据说明和当前能力边界。';
		return '导入导出设置和任务，配置 ZIP 下载策略，或清空当前任务列表。';
	}

	const zipRouteOptions: Array<{ route: ZipDownloadRoute; label: string; description: string }> = [
		{ route: 'task-card', label: '任务卡片', description: '任务卡片和更多菜单里的整任务下载。' },
		{ route: 'task-detail-all', label: '详情页全部', description: '任务详情页下载全部输出图。' },
		{ route: 'task-selection', label: '批量选择', description: '选择多个任务后下载 ZIP。' },
		{ route: 'lightbox', label: '大图预览', description: 'Lightbox 内的批量下载入口。' },
		{ route: 'favorite-collection-selection', label: '收藏集合', description: '收藏集合视图中的批量下载。' },
		{ route: 'agent-round-all', label: 'Agent 轮次', description: 'Agent 某轮回复关联图片的批量下载。' }
	];

	const defaultCustomProviderExample = JSON.stringify(
		{
			id: 'custom-lab',
			name: 'Lab Gateway',
			submit: {
				path: 'images/generations',
				contentType: 'json',
				body: {
					model: '$profile.model',
					prompt: '$prompt',
					size: '$params.size',
					quality: '$params.quality',
					output_format: '$params.output_format',
					n: '$params.n'
				},
				result: {
					imageUrlPaths: ['data.*.url'],
					b64JsonPaths: ['data.*.b64_json']
				}
			},
			editSubmit: {
				path: 'images/edits',
				contentType: 'multipart',
				body: {
					model: '$profile.model',
					prompt: '$prompt',
					size: '$params.size'
				},
				files: [
					{ field: 'image[]', source: 'inputImages', array: true },
					{ field: 'mask', source: 'mask' }
				],
				result: {
					imageUrlPaths: ['data.*.url'],
					b64JsonPaths: ['data.*.b64_json']
				}
			}
		},
		null,
		2
	);
</script>

{#if open}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/25 px-4 backdrop-blur-sm">
		<button type="button" class="absolute inset-0 cursor-default" aria-label="关闭设置" onclick={close}></button>

		<section
			class="bg-card text-card-foreground relative grid h-[88vh] w-full max-w-4xl grid-cols-[190px_minmax(0,1fr)] overflow-hidden rounded-lg border shadow-xl max-md:grid-cols-1"
		>
			<aside class="border-border bg-muted/35 border-r p-3 max-md:border-r-0 max-md:border-b">
				<div class="mb-4 flex items-center justify-between px-2">
					<div>
						<h2 class="text-base font-semibold">设置</h2>
						<p class="text-muted-foreground text-xs">ImagePort</p>
					</div>
					<Button variant="ghost" size="icon-sm" onclick={close} aria-label="关闭">
						<X class="size-4" />
					</Button>
				</div>

				<nav class="grid gap-1">
					<Button
						variant={activeTab === 'general' ? 'secondary' : 'ghost'}
						class="justify-start"
						onclick={() => (activeTab = 'general')}
					>
						<SlidersHorizontal class="size-4" />
						通用设置
					</Button>
					<Button
						variant={activeTab === 'api' ? 'secondary' : 'ghost'}
						class="justify-start"
						onclick={() => (activeTab = 'api')}
					>
						<Settings2 class="size-4" />
						API 配置
					</Button>
					<Button
						variant={activeTab === 'agent' ? 'secondary' : 'ghost'}
						class="justify-start"
						onclick={() => (activeTab = 'agent')}
					>
						<Bot class="size-4" />
						Agent 配置
					</Button>
					<Button
						variant={activeTab === 'data' ? 'secondary' : 'ghost'}
						class="justify-start"
						onclick={() => (activeTab = 'data')}
					>
						<FileJson class="size-4" />
						下载与数据
					</Button>
					<Button
						variant={activeTab === 'about' ? 'secondary' : 'ghost'}
						class="justify-start"
						onclick={() => (activeTab = 'about')}
					>
						<Info class="size-4" />
						关于
					</Button>
				</nav>
			</aside>

			<div class="flex min-h-0 flex-col">
				<header class="border-border border-b px-5 py-4">
					<h3 class="text-sm font-semibold">
						{getTabTitle()}
					</h3>
					<p class="text-muted-foreground mt-1 text-xs">
						{getTabDescription()}
					</p>
				</header>

				<div class="min-h-0 flex-1 overflow-y-auto p-5">
					{#if activeTab === 'api'}
						<div class="grid gap-4">
							<section class="rounded-lg border bg-muted/20 p-3">
								<div class="mb-3 flex items-center justify-between gap-3">
									<div>
										<h4 class="text-sm font-semibold">API 配置组</h4>
										<p class="text-muted-foreground mt-1 text-xs">为不同模型、代理或环境保存独立配置。</p>
									</div>
									<div class="flex shrink-0 items-center gap-1.5">
										<Button
											type="button"
											variant="outline"
											size="icon-sm"
											onclick={createProfile}
											aria-label="新建配置"
											title="新建配置"
										>
											<Plus class="size-4" />
										</Button>
										{#if settings.customProviders.length}
											<Button
												type="button"
												variant="outline"
												size="sm"
												onclick={() => createProfileForProvider(settings.customProviders[0].id)}
												title="新建自定义服务商配置"
											>
												自定义
											</Button>
										{/if}
										<Button
											type="button"
											variant="outline"
											size="icon-sm"
											onclick={copyProfile}
											aria-label="复制当前配置"
											title="复制当前配置"
										>
											<Copy class="size-4" />
										</Button>
									</div>
								</div>

								<div class="grid gap-2">
									{#each settings.profiles as profile}
										<div
											class={`flex items-center gap-2 rounded-lg border px-2 py-2 ${profile.id === activeProfile.id ? 'border-primary/35 bg-primary/5' : 'bg-background/70'}`}
										>
											<button
												type="button"
												class="min-w-0 flex-1 text-left"
												onclick={() => switchProfile(profile.id)}
												aria-current={profile.id === activeProfile.id ? 'true' : undefined}
											>
												<span class="block truncate text-sm font-medium">{displayProfileName(profile.name)}</span>
												<span class="text-muted-foreground block truncate text-xs">
													{getApiProviderLabel(settings, profile.provider)} · {profile.apiMode === 'responses'
														? 'Responses'
														: 'Images'} · {profile.model}
												</span>
											</button>
											{#if profile.id === activeProfile.id}
												<span
													class="rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-xs text-primary"
													>当前</span
												>
											{/if}
											<Button
												type="button"
												variant="ghost"
												size="icon-xs"
												disabled={settings.profiles.length <= 1}
												onclick={() => deleteProfile(profile.id)}
												aria-label={`${pendingDeleteProfileId === profile.id ? '确认删除配置' : '删除配置'} ${displayProfileName(profile.name)}`}
												title={pendingDeleteProfileId === profile.id ? '再次点击确认删除' : '删除配置'}
												class={pendingDeleteProfileId === profile.id
													? 'text-destructive hover:text-destructive'
													: undefined}
											>
												<Trash2 class="size-3.5" />
											</Button>
										</div>
									{/each}
								</div>
							</section>

							<div class="grid gap-4 sm:grid-cols-2">
								<label class="block space-y-1.5">
									<span class="text-sm font-medium">配置名称</span>
									<Input
										value={activeProfile.name}
										name="profileName"
										oninput={(event) => updateActiveProfile({ name: (event.currentTarget as HTMLInputElement).value })}
									/>
								</label>

								<label class="block space-y-1.5">
									<span class="text-sm font-medium">服务商</span>
									<Select value={activeProfile.provider} name="provider" onchange={updateProvider}>
										<option value="openai">OpenAI Compatible</option>
										{#each settings.customProviders as provider}
											<option value={provider.id}>{provider.name}</option>
										{/each}
									</Select>
									<span class="text-muted-foreground text-xs"
										>切换服务商会保留当前服务商草稿，并套用新服务商默认 URL 和模型。</span
									>
								</label>

								<label class="block space-y-1.5 sm:col-span-2">
									<span class="text-sm font-medium">API URL</span>
									<Input
										value={activeProfile.baseUrl}
										name="baseUrl"
										placeholder="https://api.openai.com/v1"
										oninput={(event) =>
											updateActiveProfile({ baseUrl: (event.currentTarget as HTMLInputElement).value })}
									/>
								</label>

								<label class="block space-y-1.5">
									<span class="text-sm font-medium">API Key</span>
									<Input
										value={activeProfile.apiKey}
										name="apiKey"
										type="password"
										placeholder="sk-..."
										autocomplete="off"
										oninput={(event) =>
											updateActiveProfile({ apiKey: (event.currentTarget as HTMLInputElement).value })}
									/>
								</label>

								<label class="block space-y-1.5">
									<span class="text-sm font-medium">API 接口</span>
									<Select
										value={activeProfile.apiMode}
										name="apiMode"
										onchange={updateApiMode}
										disabled={activeProfile.provider !== 'openai'}
									>
										<option value="images">Images API (/v1/images)</option>
										<option value="responses">Responses API (/v1/responses)</option>
									</Select>
								</label>

								<label class="block space-y-1.5">
									<span class="text-sm font-medium">Model</span>
									<Input
										value={activeProfile.model}
										name="model"
										placeholder={activeProfile.apiMode === 'responses' ? DEFAULT_RESPONSES_MODEL : DEFAULT_IMAGES_MODEL}
										oninput={(event) => updateActiveProfile({ model: (event.currentTarget as HTMLInputElement).value })}
									/>
								</label>

								<label class="block space-y-1.5">
									<span class="text-sm font-medium">请求超时 (秒)</span>
									<Input
										value={activeProfile.timeoutSecs}
										name="timeoutSecs"
										type="number"
										min="10"
										max="1800"
										oninput={updateTimeout}
									/>
								</label>

								<SettingSwitch
									title="流式图片"
									description="OpenAI Images / Responses 可流式接收 partial 图片；自定义服务商当前使用普通请求。"
									checked={activeProfile.streamImages}
									disabled={activeProfile.provider !== 'openai'}
									onToggle={() => updateActiveProfile({ streamImages: !activeProfile.streamImages })}
								/>

								<label class={`block space-y-1.5 ${activeProfile.streamImages ? '' : 'opacity-60'}`}>
									<span class="text-sm font-medium">中间图数量 partial_images</span>
									<Input
										value={activeProfile.streamPartialImages}
										name="streamPartialImages"
										type="number"
										min="0"
										max="3"
										disabled={!activeProfile.streamImages}
										oninput={updateStreamPartialImages}
									/>
									<span class="text-muted-foreground text-xs"
										>0-3。开启流式图片后，Gallery 和 Agent 会保存 partial 图片。</span
									>
								</label>

								<SettingSwitch
									title="返回 Base64 图片数据"
									description="请求体追加 response_format: b64_json。部分网关不支持。"
									checked={activeProfile.responseFormatB64Json}
									onToggle={() => updateActiveProfile({ responseFormatB64Json: !activeProfile.responseFormatB64Json })}
								/>

								<SettingSwitch
									title="Codex CLI 兼容模式"
									description="兼容部分 OpenAI 代理网关的预留开关；默认不需要开启。"
									checked={activeProfile.codexCli}
									disabled={activeProfile.provider !== 'openai'}
									onToggle={() => updateActiveProfile({ codexCli: !activeProfile.codexCli })}
								/>
							</div>

							<section class="rounded-lg border bg-muted/20 p-3">
								<div class="mb-3 flex items-center justify-between gap-3">
									<div>
										<h4 class="text-sm font-semibold">自定义服务商 Manifest</h4>
										<p class="text-muted-foreground mt-1 text-xs">
											支持 JSON / multipart 提交、同步结果路径解析和 poll 异步任务轮询。
										</p>
									</div>
									<Button
										type="button"
										variant="outline"
										size="sm"
										onclick={() =>
											(customProviderJson = customProviderJson.trim()
												? customProviderJson
												: defaultCustomProviderExample)}
									>
										填入示例
									</Button>
								</div>

								{#if settings.customProviders.length}
									<div class="mb-3 grid gap-2">
										{#each settings.customProviders as provider}
											<div class="flex items-center gap-2 rounded-lg border bg-background/70 px-2 py-2">
												<div class="min-w-0 flex-1">
													<div class="truncate text-sm font-medium">{provider.name}</div>
													<div class="text-muted-foreground truncate text-xs">
														{provider.id} · {provider.submit.contentType ?? 'json'} · {provider.submit.path}
													</div>
												</div>
												<Button type="button" variant="ghost" size="xs" onclick={() => editCustomProvider(provider)}
													>编辑</Button
												>
												<Button
													type="button"
													variant="ghost"
													size="icon-xs"
													onclick={() => deleteCustomProvider(provider.id)}
													title={pendingDeleteCustomProviderId === provider.id ? '再次点击确认删除' : '删除服务商'}
													class={pendingDeleteCustomProviderId === provider.id
														? 'text-destructive hover:text-destructive'
														: undefined}
												>
													<Trash2 class="size-3.5" />
												</Button>
											</div>
										{/each}
									</div>
								{/if}

								<label class="block space-y-1.5">
									<span class="text-sm font-medium">Manifest JSON</span>
									<textarea
										bind:value={customProviderJson}
										class="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring min-h-44 w-full rounded-md border px-3 py-2 font-mono text-xs focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
										placeholder={defaultCustomProviderExample}
									></textarea>
								</label>
								<div class="mt-3 flex items-center justify-between gap-3">
									<div class="min-w-0 text-xs">
										{#if customProviderError}
											<p class="text-destructive">{customProviderError}</p>
										{:else if customProviderSuccess}
											<p class="text-emerald-700">{customProviderSuccess}</p>
										{:else}
											<p class="text-muted-foreground">
												模板变量：$prompt、$params.*、$profile.*、$inputImages.dataUrls、$mask.dataUrl。
											</p>
										{/if}
									</div>
									<Button type="button" onclick={importCustomProvider} disabled={!customProviderJson.trim()}>
										<Upload class="size-4" />
										保存服务商
									</Button>
								</div>
							</section>
						</div>
					{:else if activeTab === 'general'}
						<div class="grid gap-3">
							<SettingSwitch
								title="复用任务时临时使用原配置"
								description="复用历史任务时，如果原 API 配置还存在，会优先用原配置生成。"
								checked={settings.reuseTaskApiProfileTemporarily}
								onToggle={() =>
									updateSettings({ reuseTaskApiProfileTemporarily: !settings.reuseTaskApiProfileTemporarily })}
							/>
							<SettingSwitch
								title="总是显示重试按钮"
								description="任务失败或部分完成时保持复用/重试入口可见。"
								checked={settings.alwaysShowRetryButton}
								onToggle={() => updateSettings({ alwaysShowRetryButton: !settings.alwaysShowRetryButton })}
							/>
							<SettingSwitch
								title="生成后清空输入"
								description="提交任务后清空提示词、参考图和遮罩。"
								checked={settings.clearInputAfterSubmit}
								onToggle={() => updateSettings({ clearInputAfterSubmit: !settings.clearInputAfterSubmit })}
							/>
							<SettingSwitch
								title="重启后保留输入草稿"
								description="保存提示词、参数、参考图和遮罩草稿。"
								checked={settings.persistInputOnRestart}
								onToggle={() => updateSettings({ persistInputOnRestart: !settings.persistInputOnRestart })}
							/>
							<SettingSwitch
								title="Enter 发送"
								description="开启后 Enter 发送，Shift + Enter 换行；关闭后 Ctrl/Command + Enter 暂未接入。"
								checked={settings.enterSubmit}
								onToggle={() => updateSettings({ enterSubmit: !settings.enterSubmit })}
							/>
							<SettingSwitch
								title="任务完成通知"
								description="生成完成时发送系统通知。首次开启会请求浏览器通知权限。"
								checked={settings.taskCompletionNotification}
								onToggle={() =>
									settings.taskCompletionNotification
										? updateSettings({ taskCompletionNotification: false })
										: requestNotificationPermission()}
							/>
							<label class="block space-y-1.5 rounded-lg border bg-muted/25 p-3">
								<span class="text-sm font-medium">参考图编辑默认行为</span>
								<Select
									value={settings.referenceImageEditAction}
									name="referenceImageEditAction"
									onchange={updateReferenceImageEditAction}
								>
									<option value="ask">每次询问</option>
									<option value="add-mask">添加遮罩</option>
									<option value="replace-reference">替换参考图</option>
								</Select>
								<span class="text-muted-foreground text-xs"
									>遮罩编辑会直接打开画笔；替换参考图会清空旧参考图后添加当前图。</span
								>
							</label>
						</div>
					{:else if activeTab === 'agent'}
						<div class="grid gap-3">
							<label class="block space-y-1.5 rounded-lg border bg-muted/25 p-3">
								<span class="text-sm font-medium">最大工具轮数</span>
								<Input
									value={settings.agentMaxToolRounds}
									name="agentMaxToolRounds"
									type="number"
									min="1"
									max="50"
									oninput={updateAgentMaxToolRounds}
								/>
								<span class="text-muted-foreground text-xs"
									>默认 15，范围 1-50。用于限制 Agent 连续调用工具，避免无限循环。</span
								>
							</label>
							<SettingSwitch
								title="Agent 回复后自动滚动到底部"
								description="发送消息、收到文字流或 partial 图片时保持最新内容可见。"
								checked={settings.agentAutoScroll}
								onToggle={() => updateSettings({ agentAutoScroll: !settings.agentAutoScroll })}
							/>
							<SettingSwitch
								title="允许 Agent 使用 Web Search"
								description="向 Responses 请求加入 hosted Web Search 工具，让 Agent 可按需检索网页信息。"
								checked={settings.agentWebSearch}
								onToggle={() => updateSettings({ agentWebSearch: !settings.agentWebSearch })}
							/>
							<div class="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs leading-relaxed text-blue-800">
								Agent 当前需要 OpenAI 服务商 + Responses API 配置。会话会持久化到 SQLite，图片结果会同步成为 Gallery
								任务。
							</div>
						</div>
					{:else if activeTab === 'data'}
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
											导出 manifest.json、设置、任务和图片文件；恢复时默认合并导入，不覆盖现有任务。
										</p>
									</div>
									<div class="flex shrink-0 gap-2">
										<Button onclick={onExportFullBackup} disabled={!tasks.length}>
											<Download class="size-4" />
											备份
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
										<div class="text-muted-foreground">任务数</div>
										<div class="mt-1 font-medium">{tasks.length}</div>
									</div>
									<div class="rounded-lg border bg-background/70 p-3">
										<div class="text-muted-foreground">输出图</div>
										<div class="mt-1 font-medium">{tasks.reduce((total, task) => total + task.images.length, 0)}</div>
									</div>
									<div class="rounded-lg border bg-background/70 p-3">
										<div class="text-muted-foreground">估算大小</div>
										<div class="mt-1 font-medium">{formatBytes(tasksStorageBytes)}</div>
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
											导出当前 {tasks.length} 个任务，包含生成图片 data URL。
										</p>
										<p class={`mt-1 text-xs ${getStorageTone(tasksStorageBytes)}`}>
											本地任务占用约 {formatBytes(tasksStorageBytes)}。图片较多时建议定期导出并清理。
										</p>
									</div>
									<Button onclick={onExportTasks} disabled={!tasks.length}>
										<Download class="size-4" />
										导出任务
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
										<p class="text-muted-foreground mt-1 text-xs">
											扫描 AppLocalData 中不再被当前任务引用的输出图、缩略图、参考图和遮罩。
										</p>
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
											当前任务：{tasks.length} 个。此操作不会清除 API 配置。
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
													将删除当前 {tasks.length} 个任务及其本地图片文件，但不会清除 API 配置。此操作不可恢复。
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
					{:else if activeTab === 'about'}
						<div class="grid gap-4">
							<section class="rounded-lg border bg-muted/20 p-4">
								<h4 class="text-sm font-semibold">ImagePort</h4>
								<p class="text-muted-foreground mt-2 text-sm leading-relaxed">
									ImagePort 是面向 OpenAI-compatible
									图像生成工作流的桌面工作台，集中管理生成、参考图、遮罩编辑、历史归档和 Agent 辅助创作。
								</p>
								<div class="mt-4 grid grid-cols-2 gap-3 text-xs">
									<div class="rounded-lg border bg-background/70 p-3">
										<div class="text-muted-foreground">版本</div>
										<div class="mt-1 font-medium">0.1.0</div>
									</div>
									<div class="rounded-lg border bg-background/70 p-3">
										<div class="text-muted-foreground">历史任务</div>
										<div class="mt-1 font-medium">{tasks.length} 个</div>
									</div>
									<div class="rounded-lg border bg-background/70 p-3">
										<div class="text-muted-foreground">存储估算</div>
										<div class="mt-1 font-medium">{formatBytes(tasksStorageBytes)}</div>
									</div>
									<div class="rounded-lg border bg-background/70 p-3">
										<div class="text-muted-foreground">当前 API 模式</div>
										<div class="mt-1 font-medium">{activeProfile.apiMode}</div>
									</div>
								</div>
							</section>
							<section class="rounded-lg border bg-muted/20 p-4 text-sm leading-relaxed">
								<h4 class="text-sm font-semibold">当前能力</h4>
								<p class="text-muted-foreground mt-2">
									Gallery 已支持 OpenAI-compatible Images / Responses、自定义服务商、参考图、遮罩编辑、多任务并发、流式
									partial、历史持久化、Lightbox、右键菜单、下载、收藏集合和配置管理。
								</p>
								<p class="text-muted-foreground mt-2">
									Agent 已接入 Responses Workspace、会话持久化、停止/重试/继续、Web Search 开关、流式 partial 和图片落地
									Gallery。
								</p>
							</section>
						</div>
					{/if}
				</div>

				<footer class="border-border flex justify-end gap-2 border-t px-5 py-4">
					<Button variant="outline" onclick={close}>关闭</Button>
				</footer>
			</div>
		</section>
	</div>
{/if}
