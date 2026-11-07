<script lang="ts">
	import GalleryDataSettings from './GalleryDataSettings.svelte';
	import GalleryPreferencesSettings from './GalleryPreferencesSettings.svelte';
	import { getTaskOutputCount } from '$lib/domain/task-media';
	import {
		Bot,
		ChevronDown,
		Code,
		Copy,
		Download,
		ExternalLink,
		FileJson,
		Info,
		Plus,
		RefreshCw,
		Settings2,
		SlidersHorizontal,
		Trash2,
		Upload,
		Workflow,
		X
	} from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Select } from '$lib/components/ui/select';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { toast } from 'svelte-sonner';
	import packageInfo from '../../../../package.json';
	import type { TaskRecord } from '$lib/domain/types';
	import type { TaskImportSummary } from '$lib/domain/task-storage';
	import { checkForGitHubUpdate, GITHUB_REPOSITORY_URL, type UpdateCheckResult } from '$lib/domain/update-check';
	import type { CleanupImageFilesResult } from '$lib/storage/gallery-db';
	import { openExternalUrl } from '$lib/storage/external-link';
	import { saveBlobToFile } from '$lib/storage/native-download';
	import {
		buildExportedSettings,
		DEFAULT_IMAGES_MODEL,
		DEFAULT_RESPONSES_MODEL,
		addApiProfile,
		addOpenAIProfile,
		duplicateProfile,
		getApiProviderLabel,
		getApiModeForProtocol,
		getActiveProfile,
		getAvailableImageApiProtocols,
		getDefaultImageApiProtocol,
		getDefaultProviderBaseUrl,
		getDefaultProviderModel,
		getImageApiProtocolLabel,
		getProfileRequestBlockReason,
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
		supportsResponseFormatB64Json,
		type AppSettings,
		type ApiProfile,
		type ApiProvider,
		type CustomProviderDefinition,
		type ImageApiProtocol,
		type ReferenceImageEditAction,
		type ZipDownloadRoute
	} from '$lib/domain/settings';
	import { buildApiUrl } from '$lib/domain/url';
	import { getProviderCapabilities } from '$lib/domain/provider-capabilities';
	import { getImageApiProtocolWarning, resolveImageApiEndpoint } from '$lib/api/providers/registry';
	import SettingSwitch from './SettingSwitch.svelte';
	import WorkspaceRoutingSettings from './WorkspaceRoutingSettings.svelte';
	import {
		formatLoadedTaskCount,
		formatStorageBytes,
		getStorageBytesTone,
		getTaskStorageEstimateLabel,
		shouldRefreshStorageBytesForTab
	} from './gallery-settings-storage';

	let {
		open = $bindable(false),
		settings = $bindable(),
		tasks = [],
		totalTaskCount = null,
		tasksStorageBytes = null,
		onClearTasks,
		onCleanupImages,
		onExportTasks,
		onImportTasks,
		onExportFullBackup,
		onImportFullBackup,
		onRequestTasksStorageBytes
	}: {
		open?: boolean;
		settings: AppSettings;
		tasks?: TaskRecord[];
		totalTaskCount?: number | null;
		tasksStorageBytes?: number | null;
		onClearTasks: () => void;
		onCleanupImages: () => Promise<CleanupImageFilesResult>;
		onExportTasks: () => void;
		onImportTasks: (file: File) => Promise<TaskImportSummary>;
		onExportFullBackup: () => void;
		onImportFullBackup: (file: File) => Promise<TaskImportSummary>;
		onRequestTasksStorageBytes?: () => void;
	} = $props();

	let activeTab = $state<'general' | 'api' | 'workspace' | 'agent' | 'data' | 'about'>('api');
	let settingsScrollViewport = $state<HTMLDivElement>();
	let pendingDeleteProfileId = $state<string | null>(null);
	let pendingDeleteCustomProviderId = $state<string | null>(null);
	let customProviderJson = $state('');
	let customProviderError = $state<string | null>(null);
	let customProviderSuccess = $state<string | null>(null);
	let appVersion = $state(packageInfo.version);
	let isCheckingUpdate = $state(false);
	let updateCheckResult = $state<UpdateCheckResult | null>(null);
	let updateCheckError = $state<string | null>(null);

	let activeProfile = $derived(getActiveProfile(settings));
	let activeCapabilities = $derived(getProviderCapabilities(activeProfile, settings));
	let activeProtocolOptions = $derived(getAvailableImageApiProtocols(activeProfile.provider));
	let activeEndpointPreview = $derived(getProfileEndpointPreview(activeProfile));
	let activeEditEndpointPreview = $derived(getProfileEndpointPreview(activeProfile, 'edit'));
	let activeProfileBlockReason = $derived(getProfileRequestBlockReason(activeProfile, settings));
	let activeProtocolWarning = $derived(getImageApiProtocolWarning(activeProfile));
	let isUsingOfficialConnection = $derived(isOfficialConnection(activeProfile));
	let taskCountLabel = $derived(formatLoadedTaskCount(tasks.length, totalTaskCount));
	let taskStorageEstimateLabel = $derived(getTaskStorageEstimateLabel(tasks.length, totalTaskCount));

	$effect(() => {
		if (!open) return;
		void import('@tauri-apps/api/app')
			.then(({ getVersion }) => getVersion())
			.then((version) => {
				appVersion = version;
			})
			.catch(() => {
				appVersion = packageInfo.version;
			});
	});

	$effect(() => {
		if (!open || tasksStorageBytes != null || !shouldRefreshStorageBytesForTab(activeTab)) return;
		onRequestTasksStorageBytes?.();
	});

	function close() {
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

	async function checkForUpdates() {
		if (isCheckingUpdate) return;
		isCheckingUpdate = true;
		updateCheckError = null;
		updateCheckResult = null;
		try {
			const result = await checkForGitHubUpdate({ currentVersion: appVersion });
			updateCheckResult = result;
			if (result.status === 'update-available') {
				toast.success('发现新版本', { description: `${result.latest.tagName} 可用` });
			} else {
				toast.success('当前已是最新版本', { description: appVersion });
			}
		} catch (err) {
			updateCheckError = err instanceof Error ? err.message : String(err);
			toast.error('检查更新失败', { description: updateCheckError });
		} finally {
			isCheckingUpdate = false;
		}
	}

	function openProjectRepository() {
		void openExternalUrl(GITHUB_REPOSITORY_URL).catch((err) => {
			toast.error('打开 GitHub 失败', { description: err instanceof Error ? err.message : String(err) });
		});
	}

	function openReleaseUrl(url: string) {
		void openExternalUrl(url).catch((err) => {
			toast.error('打开 Release 失败', { description: err instanceof Error ? err.message : String(err) });
		});
	}

	function switchProfile(profileId: string) {
		pendingDeleteProfileId = null;
		settings = normalizeSettings({ ...settings, activeProfileId: profileId });
	}

	function createProfile() {
		pendingDeleteProfileId = null;
		settings = addOpenAIProfile(settings);
	}

	function createResponsesProfile() {
		pendingDeleteProfileId = null;
		const nextSettings = addOpenAIProfile(settings);
		settings = normalizeSettings({
			...nextSettings,
			profiles: nextSettings.profiles.map((profile) =>
				profile.id === nextSettings.activeProfileId
					? {
							...profile,
							name: 'OpenAI Responses',
							apiMode: 'responses',
							apiProtocol: 'openai-responses',
							model: DEFAULT_RESPONSES_MODEL
						}
					: profile
			)
		});
	}

	function createBuiltInProfile(provider: 'xai' | 'google') {
		createProfileForProvider(provider);
	}

	function createProfileForProvider(provider: ApiProvider) {
		pendingDeleteProfileId = null;
		settings = addApiProfile(settings, provider);
	}

	function copyProfile() {
		pendingDeleteProfileId = null;
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

	function updateApiProtocol(event: Event) {
		const apiProtocol = (event.currentTarget as HTMLSelectElement).value as ImageApiProtocol;
		const apiMode = getApiModeForProtocol(apiProtocol);
		const currentModel = activeProfile.model.trim();
		const switchingOpenAiMode =
			(activeProfile.apiProtocol === 'openai-images' && apiProtocol === 'openai-responses') ||
			(activeProfile.apiProtocol === 'openai-responses' && apiProtocol === 'openai-images');
		const shouldUseDefaultModel =
			switchingOpenAiMode &&
			(currentModel === DEFAULT_IMAGES_MODEL ||
				currentModel === DEFAULT_RESPONSES_MODEL ||
				currentModel === 'gpt-5.1' ||
				!currentModel);
		updateActiveProfile({
			apiProtocol,
			apiMode,
			model: shouldUseDefaultModel
				? apiMode === 'responses'
					? DEFAULT_RESPONSES_MODEL
					: DEFAULT_IMAGES_MODEL
				: activeProfile.model,
			codexCli: apiProtocol.startsWith('openai-') ? activeProfile.codexCli : false,
			streamImages: apiProtocol.startsWith('openai-') ? activeProfile.streamImages : false,
			responseFormatB64Json: supportsResponseFormatB64Json(apiProtocol) ? activeProfile.responseFormatB64Json : false
		});
	}

	function applyOfficialConnectionPreset() {
		if (!isBuiltInProfileProvider(activeProfile.provider)) return;
		const apiProtocol = getDefaultImageApiProtocol(activeProfile.provider);
		updateActiveProfile({
			baseUrl: getDefaultProviderBaseUrl(activeProfile.provider),
			apiProtocol,
			apiMode: getApiModeForProtocol(apiProtocol),
			codexCli: false,
			streamImages: false,
			responseFormatB64Json: supportsResponseFormatB64Json(apiProtocol) ? activeProfile.responseFormatB64Json : false
		});
		toast.success('已恢复官方连接', { description: getApiProviderLabel(settings, activeProfile.provider) });
	}

	function isBuiltInProfileProvider(provider: ApiProvider): provider is 'openai' | 'xai' | 'google' {
		return provider === 'openai' || provider === 'xai' || provider === 'google';
	}

	function isOfficialConnection(profile: ApiProfile): boolean {
		if (!isBuiltInProfileProvider(profile.provider)) return false;
		return (
			profile.apiProtocol === getDefaultImageApiProtocol(profile.provider) &&
			profile.baseUrl.trim().replace(/\/+$/, '') === getDefaultProviderBaseUrl(profile.provider)
		);
	}

	function getProfileEndpointPreview(
		profile: ApiProfile,
		operation: 'generate' | 'edit' = 'generate'
	): { method: string; url: string } | null {
		const builtInEndpoint = resolveImageApiEndpoint(profile, operation);
		if (builtInEndpoint) return { method: 'POST', url: builtInEndpoint };
		const customProvider = settings.customProviders.find((provider) => provider.id === profile.provider);
		if (!customProvider) return null;
		const mapping = operation === 'edit' ? customProvider.editSubmit : customProvider.submit;
		if (!mapping) return null;
		return {
			method: mapping.method ?? 'POST',
			url: buildApiUrl(profile.baseUrl, mapping.path)
		};
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

	function getTabTitle() {
		if (activeTab === 'api') return 'API 配置';
		if (activeTab === 'workspace') return '模型分工';
		if (activeTab === 'general') return '通用设置';
		if (activeTab === 'agent') return 'Agent 配置';
		if (activeTab === 'about') return '关于';
		return '下载与数据';
	}

	function getTabDescription() {
		if (activeTab === 'api') return '管理图片生成、编辑与 Agent 推理使用的 API 连接。';
		if (activeTab === 'general') return '控制输入、通知、复用和任务提交习惯。';
		if (activeTab === 'workspace') return '分别指定画廊图片生成、Agent 推理与图片执行使用的连接。';
		if (activeTab === 'agent') return 'Agent Workspace 使用 OpenAI Responses API，生成图片会落到 Gallery 任务。';
		if (activeTab === 'about') return '应用版本、数据说明和当前能力边界。';
		return '导入导出设置和任务，配置 ZIP 下载策略，或清空全部历史任务。';
	}

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
						variant={activeTab === 'workspace' ? 'secondary' : 'ghost'}
						class="justify-start"
						onclick={() => (activeTab = 'workspace')}
					>
						<Workflow class="size-4" />
						模型分工
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
				<header class={`border-border border-b px-5 ${activeTab === 'api' ? 'py-4' : 'py-3.5'}`}>
					<h3 class="text-sm font-semibold">
						{getTabTitle()}
					</h3>
					<p class="text-muted-foreground mt-1 text-xs">
						{getTabDescription()}
					</p>
				</header>

				<div bind:this={settingsScrollViewport} class="min-h-0 flex-1 overflow-y-auto p-5">
					{#if activeTab === 'api'}
						<div class="grid gap-4">
							<section class="rounded-lg border bg-muted/20 p-3">
								<div class="mb-3 flex items-center justify-between gap-3">
									<div class="flex items-center gap-2">
										<h4 class="text-sm font-semibold">图片与推理 Profile</h4>
										<span
											class="text-muted-foreground rounded-full border bg-background px-1.5 py-0.5 text-[10px] tabular-nums"
										>
											{settings.profiles.length}
										</span>
									</div>
									<div class="flex shrink-0 items-center gap-1.5">
										<DropdownMenu.Root>
											<DropdownMenu.Trigger>
												<Button type="button" variant="outline" size="sm">
													<Plus class="size-4" />
													添加 Profile
													<ChevronDown class="text-muted-foreground size-3.5" />
												</Button>
											</DropdownMenu.Trigger>
											<DropdownMenu.Content align="end" class="w-64">
												<DropdownMenu.Item class="items-start py-2.5" onclick={createProfile}>
													<div class="grid gap-0.5">
														<span class="font-medium">OpenAI 图片</span>
														<span class="text-muted-foreground text-xs">Images · GPT Image</span>
													</div>
												</DropdownMenu.Item>
												<DropdownMenu.Item class="items-start py-2.5" onclick={createResponsesProfile}>
													<div class="grid gap-0.5">
														<span class="font-medium">OpenAI 文字与推理</span>
														<span class="text-muted-foreground text-xs">Responses · 剧本 / Agent</span>
													</div>
												</DropdownMenu.Item>
												<DropdownMenu.Item class="items-start py-2.5" onclick={() => createBuiltInProfile('xai')}>
													<div class="grid gap-0.5">
														<span class="font-medium">xAI 官方</span>
														<span class="text-muted-foreground text-xs">Grok Imagine Images</span>
													</div>
												</DropdownMenu.Item>
												<DropdownMenu.Item class="items-start py-2.5" onclick={() => createBuiltInProfile('google')}>
													<div class="grid gap-0.5">
														<span class="font-medium">Google 官方</span>
														<span class="text-muted-foreground text-xs">Interactions / generateContent</span>
													</div>
												</DropdownMenu.Item>
												{#if settings.customProviders.length}
													<DropdownMenu.Separator />
													{#each settings.customProviders as provider}
														<DropdownMenu.Item
															class="items-start py-2.5"
															onclick={() => createProfileForProvider(provider.id)}
														>
															<div class="grid min-w-0 gap-0.5">
																<span class="truncate font-medium">{provider.name}</span>
																<span class="text-muted-foreground text-xs">自定义 Manifest</span>
															</div>
														</DropdownMenu.Item>
													{/each}
												{/if}
											</DropdownMenu.Content>
										</DropdownMenu.Root>
										<Button
											type="button"
											variant="outline"
											size="icon-sm"
											onclick={copyProfile}
											aria-label="复制当前配置"
											title="复制当前连接"
										>
											<Copy class="size-4" />
										</Button>
									</div>
								</div>

								<div class="grid max-h-72 gap-2 overflow-y-auto pr-1" aria-label="图片与推理 Profile 列表">
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
													{getApiProviderLabel(settings, profile.provider)} · {getImageApiProtocolLabel(
														profile.apiProtocol
													)} · {profile.model}
												</span>
											</button>
											{#if profile.id === activeProfile.id}
												<span
													class="rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-xs text-primary"
													>编辑中</span
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
									<span class="text-sm font-medium">模型能力预设</span>
									<Select value={activeProfile.provider} name="provider" onchange={updateProvider}>
										<option value="openai">OpenAI Compatible</option>
										<option value="xai">xAI Grok Imagine</option>
										<option value="google">Google Nano Banana</option>
										{#each settings.customProviders as provider}
											<option value={provider.id}>{provider.name}</option>
										{/each}
									</Select>
									<span class="text-muted-foreground text-xs">
										决定比例、参考图等可用能力，不代表 API 网站；切换时会保留各自草稿。
									</span>
								</label>

								<label class="block space-y-1.5 sm:col-span-2">
									<span class="text-sm font-medium">API URL</span>
									<Input
										value={activeProfile.baseUrl}
										name="baseUrl"
										placeholder={getDefaultProviderBaseUrl(activeProfile.provider)}
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
									<span class="text-sm font-medium">接口协议</span>
									{#if activeProfile.apiProtocol !== 'custom'}
										<Select value={activeProfile.apiProtocol} name="apiProtocol" onchange={updateApiProtocol}>
											{#each activeProtocolOptions as protocol}
												<option value={protocol}>{getImageApiProtocolLabel(protocol)}</option>
											{/each}
										</Select>
									{:else}
										<Input value={getImageApiProtocolLabel(activeProfile.apiProtocol)} disabled />
									{/if}
									<span class="text-muted-foreground text-xs">协议决定请求路径、鉴权、请求体和响应解析方式。</span>
								</label>

								<label class="block space-y-1.5">
									<span class="text-sm font-medium">Model</span>
									<Input
										value={activeProfile.model}
										name="model"
										placeholder={getDefaultProviderModel(activeProfile.provider, activeProfile.apiMode)}
										oninput={(event) => updateActiveProfile({ model: (event.currentTarget as HTMLInputElement).value })}
									/>
								</label>

								<div class="sm:col-span-2 rounded-lg border bg-muted/25 p-3">
									<div class="flex items-start justify-between gap-3">
										<div class="min-w-0">
											<div class="text-muted-foreground text-xs font-medium">请求地址预览</div>
											{#if activeEndpointPreview}
												<p class="text-muted-foreground mt-2 text-xs">
													{activeEditEndpointPreview?.url === activeEndpointPreview.url &&
													activeEditEndpointPreview?.method === activeEndpointPreview.method
														? '文生图 / 参考图编辑'
														: '无参考图'}
												</p>
												<code class="mt-1 block break-all text-xs leading-relaxed">
													{activeEndpointPreview.method}
													{activeEndpointPreview.url}
												</code>
											{:else}
												<p class="mt-1 text-xs">当前配置没有可预览的请求地址。</p>
											{/if}
											{#if activeEditEndpointPreview && (activeEditEndpointPreview.url !== activeEndpointPreview?.url || activeEditEndpointPreview.method !== activeEndpointPreview?.method)}
												<p class="text-muted-foreground mt-3 text-xs">有参考图（无需遮罩）</p>
												<code class="mt-1 block break-all text-xs leading-relaxed">
													{activeEditEndpointPreview.method}
													{activeEditEndpointPreview.url}
												</code>
											{/if}
										</div>
										{#if isBuiltInProfileProvider(activeProfile.provider)}
											<Button
												type="button"
												variant="outline"
												size="xs"
												disabled={isUsingOfficialConnection}
												onclick={applyOfficialConnectionPreset}
											>
												{isUsingOfficialConnection ? '官方连接' : '恢复官方连接'}
											</Button>
										{/if}
									</div>
									{#if activeProfileBlockReason}
										<p class="mt-2 border-t pt-2 text-xs leading-relaxed text-destructive">
											{activeProfileBlockReason}
										</p>
									{:else if activeProtocolWarning}
										<p class="mt-2 border-t pt-2 text-xs leading-relaxed text-amber-700 dark:text-amber-400">
											{activeProtocolWarning}
										</p>
									{/if}
								</div>

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

								{#if activeCapabilities.supportsStreaming}
									<SettingSwitch
										title="流式图片"
										description="流式接收并保存 partial 图片。"
										checked={activeProfile.streamImages}
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
										<span class="text-muted-foreground text-xs">0-3。Gallery 和 Agent 会保存 partial 图片。</span>
									</label>
								{/if}

								{#if supportsResponseFormatB64Json(activeProfile.apiProtocol)}
									<SettingSwitch
										title="返回 Base64 图片数据"
										description="请求体追加 response_format: b64_json。部分网关不支持。"
										checked={activeProfile.responseFormatB64Json}
										onToggle={() =>
											updateActiveProfile({ responseFormatB64Json: !activeProfile.responseFormatB64Json })}
									/>
								{/if}

								<SettingSwitch
									title="Codex CLI 兼容模式"
									description="兼容部分 OpenAI 代理网关的预留开关；默认不需要开启。"
									checked={activeProfile.codexCli}
									disabled={!activeProfile.apiProtocol.startsWith('openai-')}
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
					{:else if activeTab === 'workspace'}
						<WorkspaceRoutingSettings
							{settings}
							onSettingsChange={(nextSettings) => (settings = normalizeSettings(nextSettings))}
						/>
					{:else if activeTab === 'general' || activeTab === 'agent'}
						<GalleryPreferencesSettings section={activeTab} bind:settings />
					{:else if activeTab === 'data'}
						<GalleryDataSettings
							bind:settings
							{tasks}
							{totalTaskCount}
							{tasksStorageBytes}
							{onExportTasks}
							{onExportFullBackup}
							{onImportTasks}
							{onImportFullBackup}
							{onClearTasks}
							{onCleanupImages}
						/>
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
										<div class="mt-1 font-medium">{appVersion}</div>
									</div>
									<div class="rounded-lg border bg-background/70 p-3">
										<div class="text-muted-foreground">已加载任务</div>
										<div class="mt-1 font-medium">{taskCountLabel} 个</div>
									</div>
									<div class="rounded-lg border bg-background/70 p-3">
										<div class="text-muted-foreground">{taskStorageEstimateLabel}</div>
										<div class="mt-1 font-medium">{formatStorageBytes(tasksStorageBytes)}</div>
									</div>
									<div class="rounded-lg border bg-background/70 p-3">
										<div class="text-muted-foreground">当前 API 模式</div>
										<div class="mt-1 font-medium">{getImageApiProtocolLabel(activeProfile.apiProtocol)}</div>
									</div>
								</div>
								<div class="mt-4 flex flex-wrap gap-2">
									<Button variant="outline" onclick={openProjectRepository}>
										<Code class="size-4" />
										GitHub 仓库
										<ExternalLink class="size-3" />
									</Button>
									<Button variant="outline" onclick={checkForUpdates} disabled={isCheckingUpdate}>
										<RefreshCw class={`size-4 ${isCheckingUpdate ? 'animate-spin' : ''}`} />
										{isCheckingUpdate ? '检查中' : '检查更新'}
									</Button>
								</div>
								{#if updateCheckResult}
									<div class="mt-3 rounded-lg border bg-background/70 p-3 text-sm">
										{#if updateCheckResult.status === 'update-available'}
											<div class="font-medium">发现新版本 {updateCheckResult.latest.tagName}</div>
											<p class="text-muted-foreground mt-1 text-xs">
												当前版本 {updateCheckResult.currentVersion}，最新版本 {updateCheckResult.latest.version}。
											</p>
											<div class="mt-3">
												<Button
													size="sm"
													variant="outline"
													onclick={() => openReleaseUrl(updateCheckResult!.latest.releaseUrl)}
												>
													查看 Release
													<ExternalLink class="size-3" />
												</Button>
											</div>
										{:else}
											<div class="font-medium">当前已是最新版本</div>
											<p class="text-muted-foreground mt-1 text-xs">
												已检查 GitHub Releases：{updateCheckResult.latest.tagName}
											</p>
										{/if}
									</div>
								{:else if updateCheckError}
									<div
										class="mt-3 rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-xs text-destructive"
									>
										{updateCheckError}
									</div>
								{/if}
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
