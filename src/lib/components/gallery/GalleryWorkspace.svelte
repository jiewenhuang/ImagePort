<script lang="ts">
	import { onMount } from 'svelte';
	import {
		Download,
		Eye,
		Heart,
		ImageIcon,
		ImagePlus,
		LoaderCircle,
		MoreHorizontal,
		MessagesSquare,
		RotateCcw,
		Search,
		SendHorizontal,
		Settings,
		SlidersHorizontal,
		Square,
		CheckSquare,
		Trash2
	} from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Select } from '$lib/components/ui/select';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Badge } from '$lib/components/ui/badge';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { toast } from 'svelte-sonner';
	import {
		createAgentAssistantFallbackText,
		getAgentRequestBlockReason,
		type AgentResponsesResult
	} from '$lib/api/agent-runtime';
	import { runAgentResponsesRequest } from '$lib/api/agent-runner';
	import { runGalleryImageRequestGroup } from '$lib/api/gallery-runner';
	import {
		completeAgentRound,
		createAgentConversation,
		createAgentUserRound,
		markAgentRoundCanceled,
		normalizeAgentConversations,
		startAgentAssistantMessage,
		updateAgentAssistantMessage,
		type AgentConversation
	} from '$lib/domain/agent';
	import {
		createEmptyTaskMetadata,
		DEFAULT_PARAMS,
		getConcreteOutputImageCount,
		getMissingOutputImageCount,
		type InputImage,
		type MaskDraft,
		type OutputImageCount,
		type TaskParams,
		type TaskRecord
	} from '$lib/domain/types';
	import {
		filterGalleryTasks,
		getSelectedCompletedTasks,
		getTaskPreviewImages,
		getVisibleGalleryTasks,
		pruneSelectedTaskIds,
		TASK_PAGE_SIZE
	} from '$lib/domain/task-gallery';
	import {
		ALL_FAVORITES_COLLECTION_ID,
		DEFAULT_FAVORITE_COLLECTION_ID,
		createFavoriteCollection,
		deleteFavoriteCollection,
		normalizeTaskFavoriteCollections,
		renameFavoriteCollection,
		toggleTaskFavoriteCollection,
		type FavoriteCollection
	} from '$lib/domain/favorites';
	import { buildTaskImageDownloadEntries, dataUrlToDownloadBytes, extensionFromDataUrl } from '$lib/domain/download';
	import { buildFullBackupPayload, imageBytesToDataUrl, restoreFullBackupTasks } from '$lib/domain/full-backup';
	import { createZipBlob } from '$lib/domain/zip';
	import { readStoredZipEntries } from '$lib/domain/zip';
	import { copyImageToClipboard } from '$lib/storage/image-clipboard';
	import {
		DEFAULT_SETTINGS,
		getActiveProfile,
		getProfileRequestBlockReason,
		getTaskReuseProfile,
		normalizeSettings,
		type AppSettings,
		type ApiProfile
	} from '$lib/domain/settings';
	import {
		buildExportedTasks,
		createTaskImportSummary,
		estimateTasksStorageBytes,
		mergeTaskSnapshots,
		parseImportedTasks,
		resolveStoredTasks,
		type TaskImportSummary
	} from '$lib/domain/task-storage';
	import {
		cancelNativeRequest,
		downloadImageAsDataUrl,
		nativeJsonRequest,
		nativeJsonStreamRequest,
		nativeMultipartRequest,
		nativeMultipartStreamRequest
	} from '$lib/tauri/http-client';
	import {
		deleteStoredInputDraft,
		loadStoredInputDraft,
		loadStoredSettings,
		saveStoredInputDraft,
		saveStoredSettings,
		type InputDraftSnapshot
	} from '$lib/storage/app-store';
	import {
		cleanupUnreferencedTaskImageFiles,
		deleteTaskImageFiles,
		loadStoredAgentConversations,
		loadStoredTasks,
		saveStoredAgentConversations,
		saveStoredTask,
		saveStoredTasks
	} from '$lib/storage/gallery-db';
	import { deleteTaskImageFilesWithReport } from '$lib/storage/task-file-cleanup';
	import { createTaskPersistenceController } from '$lib/storage/task-persistence';
	import { saveBlobToFile, saveDataUrlToFile } from '$lib/storage/native-download';
	import GallerySettingsModal from './GallerySettingsModal.svelte';
	import GalleryLightbox from './GalleryLightbox.svelte';
	import ImageActionContextMenu from './ImageActionContextMenu.svelte';
	import ImagePortLogo from '$lib/components/brand/ImagePortLogo.svelte';
	import MaskEditorModal from './MaskEditorModal.svelte';
	import ReferenceImageStrip from './ReferenceImageStrip.svelte';
	import SizePickerModal from './SizePickerModal.svelte';
	import TaskDetailModal from './TaskDetailModal.svelte';

	const qualityOptions: TaskParams['quality'][] = ['auto', 'low', 'medium', 'high'];
	const formatOptions: TaskParams['output_format'][] = ['png', 'jpeg', 'webp'];
	const moderationOptions: TaskParams['moderation'][] = ['auto', 'low'];
	const SETTINGS_STORAGE_KEY = 'imageport.gallery.settings';
	const INPUT_DRAFT_STORAGE_KEY = 'imageport.gallery.inputDraft';
	const TASKS_STORAGE_KEY = 'imageport.gallery.tasks';
	const AGENT_STORAGE_KEY = 'imageport.agent.conversations';
	const MAX_INPUT_IMAGES = 16;
	const MAX_OUTPUT_IMAGES = 10;

	let settings = $state<AppSettings>(DEFAULT_SETTINGS);
	let appMode = $state<'gallery' | 'agent'>('gallery');
	let prompt = $state('');
	let agentPrompt = $state('');
	let params = $state<TaskParams>({ ...DEFAULT_PARAMS });
	let inputImages = $state<InputImage[]>([]);
	let mask = $state<MaskDraft | null>(null);
	let error = $state<string | null>(null);
	let tasks = $state<TaskRecord[]>([]);
	let agentConversations = $state<AgentConversation[]>([]);
	let activeAgentConversationId = $state<string | null>(null);
	let canceledAgentRoundIds = $state<string[]>([]);
	let activeAgentRequestIds = $state<Record<string, string>>({});
	let nextGalleryProfileOverrideId = $state<string | null>(null);
	let hasHydratedAgentConversations = $state(false);
	let now = $state(Date.now());
	let searchQuery = $state('');
	let filterStatus = $state<'all' | TaskRecord['status']>('all');
	let newCollectionName = $state('');
	let renamingCollectionId = $state<string | null>(null);
	let renamingCollectionName = $state('');
	let visibleTaskLimit = $state(TASK_PAGE_SIZE);
	let lastTaskFilterKey = $state('');
	let selectionMode = $state(false);
	let selectedTaskIds = $state<string[]>([]);
	let selectionBox = $state<{ startX: number; startY: number; currentX: number; currentY: number } | null>(null);
	let showBulkDeleteDialog = $state(false);
	let showSettings = $state(false);
	let showSizePicker = $state(false);
	let showTaskDetail = $state(false);
	let showMaskEditor = $state(false);
	let showLightbox = $state(false);
	let selectedTaskId = $state<string | null>(null);
	let maskEditorImageId = $state<string | null>(null);
	let lightboxImages = $state<string[]>([]);
	let lightboxIndex = $state(0);
	let lightboxTitle = $state('图片预览');
	let lightboxTaskId = $state<string | null>(null);
	let hasHydratedSettings = $state(false);
	let hasHydratedInputDraft = $state(false);
	let hasHydratedTasks = $state(false);
	let taskHydrationFailed = $state(false);
	let fileInput: HTMLInputElement | undefined;
	let agentMessagesViewport = $state<HTMLDivElement>();
	const taskPersistence = createTaskPersistenceController({
		storageKey: TASKS_STORAGE_KEY,
		saveTasks: saveStoredTasks,
		saveTask: saveStoredTask,
		getTasks: () => tasks,
		onError(message) {
			error = message;
			toast.error('任务保存失败', { description: message });
		}
	});

	let activeFavoriteCollectionId = $derived(settings.activeFavoriteCollectionId);
	let favoriteCollections = $derived(settings.favoriteCollections as FavoriteCollection[]);
	let filteredTasks = $derived(
		filterGalleryTasks(tasks, {
			status: filterStatus,
			query: searchQuery,
			favoriteCollectionId: activeFavoriteCollectionId
		})
	);
	let visibleTasks = $derived(
		getVisibleGalleryTasks(tasks, {
			status: filterStatus,
			query: searchQuery,
			favoriteCollectionId: activeFavoriteCollectionId,
			limit: visibleTaskLimit
		})
	);
	let hasMoreTasks = $derived(filteredTasks.length > visibleTasks.length);
	let selectedDownloadableTasks = $derived(getSelectedCompletedTasks(tasks, selectedTaskIds));
	let activeFavoriteDownloadableTasks = $derived(
		activeFavoriteCollectionId
			? filteredTasks.filter(
					(task) => task.status !== 'running' && (task.images.length > 0 || task.streamPartialImageIds.length > 0)
				)
			: []
	);
	let selectedTask = $derived(tasks.find((task) => task.id === selectedTaskId) ?? null);
	let lightboxTask = $derived(tasks.find((task) => task.id === lightboxTaskId) ?? null);
	let maskEditorImage = $derived(inputImages.find((image) => image.id === maskEditorImageId) ?? null);
	let activeProfile = $derived(getActiveProfile(settings));
	let effectiveGalleryProfile = $derived(
		nextGalleryProfileOverrideId
			? (settings.profiles.find((profile) => profile.id === nextGalleryProfileOverrideId) ?? activeProfile)
			: activeProfile
	);
	let profileBlockReason = $derived(getProfileRequestBlockReason(effectiveGalleryProfile, settings));
	let agentBlockReason = $derived(getAgentRequestBlockReason(activeProfile, settings));
	let activeParams = $derived(
		normalizeParamsForRequest(params, appMode === 'agent' ? activeProfile : effectiveGalleryProfile, appMode)
	);
	let canSubmit = $derived(Boolean(prompt.trim()) && !profileBlockReason);
	let canSubmitAgent = $derived(Boolean(agentPrompt.trim()) && !agentBlockReason);
	let tasksStorageBytes = $derived(estimateTasksStorageBytes(tasks));
	let activeAgentConversation = $derived(
		agentConversations.find((conversation) => conversation.id === activeAgentConversationId) ??
			agentConversations[0] ??
			null
	);
	let activeAgentTasks = $derived(
		activeAgentConversation ? tasks.filter((task) => task.agentConversationId === activeAgentConversation.id) : []
	);

	$effect(() => {
		if (
			nextGalleryProfileOverrideId &&
			!settings.profiles.some((profile) => profile.id === nextGalleryProfileOverrideId)
		) {
			nextGalleryProfileOverrideId = null;
		}
	});

	$effect(() => {
		if (!showMaskEditor) maskEditorImageId = null;
	});

	$effect(() => {
		const nextParams = normalizeParamsForRequest(
			params,
			appMode === 'agent' ? activeProfile : effectiveGalleryProfile,
			appMode
		);
		if (nextParams.n !== params.n) params = nextParams;
	});

	$effect(() => {
		const nextKey = `${filterStatus}\n${searchQuery}\n${activeFavoriteCollectionId ?? ''}`;
		if (lastTaskFilterKey === nextKey) return;
		lastTaskFilterKey = nextKey;
		visibleTaskLimit = TASK_PAGE_SIZE;
	});

	$effect(() => {
		const pruned = pruneSelectedTaskIds(selectedTaskIds, visibleTasks);
		if (pruned.length !== selectedTaskIds.length) selectedTaskIds = pruned;
		if (selectionMode && selectedTaskIds.length === 0) selectionMode = false;
		if (selectedTaskIds.length === 0) showBulkDeleteDialog = false;
	});

	onMount(() => {
		let mounted = true;
		const timer = window.setInterval(() => {
			now = Date.now();
		}, 1000);
		void hydrateStorage(() => mounted);

		return () => {
			mounted = false;
			window.clearInterval(timer);
			taskPersistence.dispose();
		};
	});

	async function hydrateStorage(isMounted: () => boolean) {
		try {
			const saved = (await loadStoredSettings()) ?? readLocalStorageJson(SETTINGS_STORAGE_KEY);
			if (saved) {
				const nextSettings = normalizeSettings(saved);
				if (isMounted()) settings = nextSettings;
				void saveStoredSettings(nextSettings);
			}
		} catch {
			// Settings persistence is best-effort.
		} finally {
			if (isMounted()) hasHydratedSettings = true;
		}
		try {
			const savedDraft = (await loadStoredInputDraft()) ?? readLocalStorageJson(INPUT_DRAFT_STORAGE_KEY);
			if (savedDraft && isMounted()) {
				const parsed = savedDraft as Partial<InputDraftSnapshot>;
				if (typeof parsed.prompt === 'string') prompt = parsed.prompt;
				if (parsed.params && typeof parsed.params === 'object') params = { ...DEFAULT_PARAMS, ...parsed.params };
				if (Array.isArray(parsed.inputImages)) inputImages = parsed.inputImages.filter(isInputImage);
				if (parsed.mask && typeof parsed.mask === 'object') mask = parsed.mask as MaskDraft;
				void saveStoredInputDraft({ prompt, params, inputImages, mask });
			}
		} catch {
			// Input draft persistence is best-effort.
		} finally {
			if (isMounted()) hasHydratedInputDraft = true;
		}
		let tasksHydrated = false;
		try {
			const storedTasks = await loadStoredTasks();
			const savedTasks = resolveStoredTasks(storedTasks, readLocalStorageJson(TASKS_STORAGE_KEY));
			if (savedTasks && isMounted()) {
				const normalizedFavorites = normalizeTaskFavorites(
					tasks.length ? mergeTaskSnapshots(tasks, savedTasks) : savedTasks
				);
				tasks = normalizedFavorites;
			}
			if (isMounted()) {
				taskHydrationFailed = false;
				hasHydratedTasks = true;
			}
			tasksHydrated = true;
		} catch (err) {
			if (isMounted()) {
				taskHydrationFailed = true;
				error = `历史任务读取失败，已暂停自动保存以避免覆盖数据：${err instanceof Error ? err.message : String(err)}`;
			}
		} finally {
			if (isMounted() && tasksHydrated) hasHydratedTasks = true;
		}
		try {
			const storedAgentConversations =
				(await loadStoredAgentConversations()) ?? normalizeAgentConversations(readLocalStorageJson(AGENT_STORAGE_KEY));
			if (isMounted()) {
				agentConversations = storedAgentConversations.length ? storedAgentConversations : [createAgentConversation()];
				activeAgentConversationId = agentConversations[0]?.id ?? null;
				hasHydratedAgentConversations = true;
			}
		} catch (err) {
			if (isMounted()) {
				agentConversations = [createAgentConversation()];
				activeAgentConversationId = agentConversations[0]?.id ?? null;
				hasHydratedAgentConversations = true;
				toast.warning('Agent 会话读取失败', { description: err instanceof Error ? err.message : String(err) });
			}
		}
	}

	$effect(() => {
		if (!hasHydratedSettings) return;
		localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
		void saveStoredSettings(settings);
	});

	$effect(() => {
		if (!hasHydratedInputDraft) return;
		if (!settings.persistInputOnRestart) {
			localStorage.removeItem(INPUT_DRAFT_STORAGE_KEY);
			void deleteStoredInputDraft();
			return;
		}
		const draft = { prompt, params, inputImages, mask };
		localStorage.setItem(INPUT_DRAFT_STORAGE_KEY, JSON.stringify(draft));
		void saveStoredInputDraft(draft);
	});

	$effect(() => {
		if (!hasHydratedAgentConversations) return;
		localStorage.setItem(AGENT_STORAGE_KEY, JSON.stringify(agentConversations));
		void saveStoredAgentConversations(agentConversations);
	});

	$effect(() => {
		if (!settings.agentAutoScroll || appMode !== 'agent' || !agentMessagesViewport) return;
		const autoScrollKey = `${agentConversations.length}:${tasks.length}`;
		const viewport = agentMessagesViewport;
		requestAnimationFrame(() => {
			if (!autoScrollKey) return;
			viewport.scrollTop = viewport.scrollHeight;
		});
	});

	async function submitGeneration() {
		error = null;
		const trimmedPrompt = prompt.trim();
		if (!trimmedPrompt) {
			error = '请输入提示词';
			toast.warning('请输入提示词');
			return;
		}
		const submitProfile = effectiveGalleryProfile;
		if (!submitProfile.apiKey.trim()) {
			toast.warning('需要先配置 API Key');
			showSettings = true;
			return;
		}
		const blockReason = getProfileRequestBlockReason(submitProfile, settings);
		if (blockReason) {
			error = blockReason;
			toast.warning('当前配置不可用', { description: blockReason });
			showSettings = true;
			return;
		}

		const taskId = crypto.randomUUID();
		const taskInputImages = inputImages.map((image) => ({ ...image }));
		const taskMask = mask ? { ...mask } : null;
		const taskParams = normalizeParamsForRequest(params, submitProfile, 'gallery');
		const nextTasks = createRunningTaskSnapshot({
			taskId,
			taskPrompt: trimmedPrompt,
			taskParams,
			taskInputImages,
			taskMask,
			sourceMode: 'gallery',
			profile: submitProfile
		});
		tasks = nextTasks;
		if (nextTasks[0]) await taskPersistence.persistTaskSnapshotNow(nextTasks[0]);
		toast.info('任务已开始', {
			description: `预计生成 ${formatExpectedImageCount(taskParams.n)}`
		});

		void runTaskGeneration(
			taskId,
			{
				settings,
				profile: submitProfile,
				...submitProfile,
				prompt: trimmedPrompt,
				params: taskParams
			},
			taskInputImages,
			taskMask
		);
		nextGalleryProfileOverrideId = null;

		if (settings.clearInputAfterSubmit) {
			prompt = '';
			inputImages = [];
			mask = null;
		}
	}

	async function submitAgentMessage() {
		error = null;
		const trimmedPrompt = agentPrompt.trim();
		if (!trimmedPrompt) {
			toast.warning('请输入 Agent 消息');
			return;
		}
		if (agentBlockReason) {
			toast.warning('当前 Agent 配置不可用', { description: agentBlockReason });
			showSettings = true;
			return;
		}
		await startAgentRound({
			prompt: trimmedPrompt,
			inputImages: inputImages.map((image) => ({ ...image })),
			mask: mask ? { ...mask } : null,
			params: activeParams
		});
		agentPrompt = '';
	}

	async function startAgentRound(input: {
		prompt: string;
		inputImages: InputImage[];
		mask: MaskDraft | null;
		params: TaskParams;
		retryOfRoundId?: string | null;
		continuedFromRoundId?: string | null;
	}) {
		const conversation = activeAgentConversation ?? createAgentConversation();
		const startedConversation = createAgentUserRound(conversation, {
			prompt: input.prompt,
			inputImages: input.inputImages,
			mask: input.mask,
			maxToolRounds: settings.agentMaxToolRounds,
			webSearchEnabled: settings.agentWebSearch,
			retryOfRoundId: input.retryOfRoundId ?? null,
			continuedFromRoundId: input.continuedFromRoundId ?? null
		});
		const round = startedConversation.rounds.at(-1);
		if (!round) return;
		const taskId = crypto.randomUUID();
		const withAssistant = startAgentAssistantMessage(startedConversation, round.id, {
			content: '正在思考并调用图片工具...'
		});
		agentConversations = upsertAgentConversation(agentConversations, withAssistant);
		activeAgentConversationId = withAssistant.id;
		const nextTasks = createRunningTaskSnapshot({
			taskId,
			taskPrompt: input.prompt,
			taskParams: input.params,
			taskInputImages: input.inputImages,
			taskMask: input.mask,
			sourceMode: 'agent',
			profile: activeProfile,
			agentConversationId: withAssistant.id,
			agentRoundId: round.id,
			agentMessageId: round.userMessageId,
			agentToolAction: input.inputImages.length ? 'edit' : 'generate'
		});
		tasks = nextTasks;
		if (nextTasks[0]) await taskPersistence.persistTaskSnapshotNow(nextTasks[0]);
		toast.info('Agent 轮次已开始', { description: `预计生成 ${formatExpectedImageCount(input.params.n)}` });
		void runAgentResponsesRound({
			conversationId: withAssistant.id,
			roundId: round.id,
			taskId,
			profile: activeProfile,
			settings,
			prompt: input.prompt,
			params: input.params,
			inputImages: input.inputImages,
			mask: input.mask
		});
	}

	function createRunningTaskSnapshot(input: {
		taskId: string;
		taskPrompt: string;
		taskParams: TaskParams;
		taskInputImages: InputImage[];
		taskMask: MaskDraft | null;
		sourceMode: 'gallery' | 'agent';
		profile: ApiProfile;
		agentConversationId?: string;
		agentRoundId?: string;
		agentMessageId?: string;
		agentToolAction?: string;
	}) {
		const createdAt = Date.now();
		const task: TaskRecord = {
			id: input.taskId,
			prompt: input.taskPrompt,
			params: input.taskParams,
			inputImages: input.taskInputImages,
			mask: input.taskMask,
			images: [],
			status: 'running',
			error: null,
			createdAt,
			finishedAt: null,
			failureCount: 0,
			...createEmptyTaskMetadata(),
			apiProfileId: input.profile.id,
			apiProfileName: input.profile.name,
			apiProvider: input.profile.provider,
			apiMode: input.profile.apiMode,
			model: input.profile.model,
			sourceMode: input.sourceMode,
			agentConversationId: input.agentConversationId ?? null,
			agentRoundId: input.agentRoundId ?? null,
			agentMessageId: input.agentMessageId ?? null,
			agentToolAction: input.agentToolAction ?? null
		};
		return [task, ...tasks];
	}

	async function runTaskGeneration(
		taskId: string,
		requestInput: {
			settings: AppSettings;
			profile: ApiProfile;
			baseUrl: string;
			apiKey: string;
			model: string;
			timeoutSecs: number;
			responseFormatB64Json: boolean;
			prompt: string;
			params: TaskParams;
		},
		taskInputImages: InputImage[],
		taskMask: MaskDraft | null
	) {
		try {
			const result = await runGalleryImageRequestGroup({
				taskId,
				settings: requestInput.settings,
				profile: requestInput.profile,
				prompt: requestInput.prompt,
				params: requestInput.params,
				inputImages: taskInputImages,
				mask: taskMask,
				nativeJsonRequest,
				nativeMultipartRequest,
				nativeJsonStreamRequest,
				nativeMultipartStreamRequest,
				downloadImageAsDataUrl,
				createRequestId: () => `${taskId}-${crypto.randomUUID()}`,
				onPartialImages: updateTaskPartialImages
			});
			const nextTasks: TaskRecord[] = tasks.map((task) =>
				task.id === taskId
					? {
							...task,
							images: result.images,
							status: result.status,
							error: result.errorMessage,
							failureCount: result.failureCount,
							finishedAt: Date.now(),
							actualParams: result.actualParams,
							actualParamsByImage: buildActualParamsByImage(result.images, result.actualParamsList),
							revisedPromptByImage: buildRevisedPromptByImage(result.images, result.revisedPrompts),
							rawImageUrls: result.rawImageUrls,
							rawResponsePayload: result.rawResponsePayload,
							streamPartialImageIds: result.streamPartialImages
						}
					: task
			);
			tasks = nextTasks;
			const updatedTask = nextTasks.find((task) => task.id === taskId);
			if (updatedTask) await taskPersistence.persistTaskSnapshotNow(updatedTask);
			if (result.status === 'done') {
				toast.success('生成完成', { description: formatActualImageCount(result.images.length, requestInput.params.n) });
			} else {
				toast.warning('部分生成完成', {
					description: `${formatActualImageCount(result.images.length, requestInput.params.n)}，${result.failureCount} 个请求失败`
				});
			}
			notifyTaskCompleted(requestInput.prompt, result.images.length, requestInput.params.n);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			error = message;
			toast.error('生成失败', { description: message });
			const nextTasks: TaskRecord[] = tasks.map((task) =>
				task.id === taskId
					? {
							...task,
							status: 'error',
							error: message,
							finishedAt: Date.now(),
							failureCount: getFailureCountForParams(task.params.n, 0)
						}
					: task
			);
			tasks = nextTasks;
			const updatedTask = nextTasks.find((task) => task.id === taskId);
			if (updatedTask) await taskPersistence.persistTaskSnapshotNow(updatedTask);
		}
	}

	async function runAgentResponsesRound(input: {
		conversationId: string;
		roundId: string;
		taskId: string;
		profile: ApiProfile;
		settings: AppSettings;
		prompt: string;
		params: TaskParams;
		inputImages: InputImage[];
		mask: MaskDraft | null;
	}) {
		try {
			const runningConversation = getAgentConversation(input.conversationId);
			if (!runningConversation) throw new Error('Agent 会话不存在');
			const result = await runAgentResponsesRequest({
				conversation: runningConversation,
				roundId: input.roundId,
				taskId: input.taskId,
				profile: input.profile,
				settings: input.settings,
				prompt: input.prompt,
				params: input.params,
				inputImages: input.inputImages,
				mask: input.mask,
				nativeJsonRequest,
				nativeJsonStreamRequest,
				createRequestId: () => `agent-${input.roundId}-${crypto.randomUUID()}`,
				onActiveRequestId: (requestId) => setActiveAgentRequestId(input.roundId, requestId),
				onText: updateAgentRoundText,
				onPartialImages: updateTaskPartialImages,
				isCanceled: () => isAgentRoundCanceled(input.roundId)
			});
			if (isAgentRoundCanceled(input.roundId)) return;
			const content = createAgentAssistantFallbackText(result, input.params.n);
			const nextTasks: TaskRecord[] = tasks.map((task) =>
				task.id === input.taskId
					? {
							...task,
							images: result.images,
							status: result.images.length ? 'done' : result.partialImages.length ? 'partial' : 'error',
							error: result.images.length || result.partialImages.length ? null : 'Agent 没有返回图片',
							failureCount: getFailureCountForParams(input.params.n, result.images.length),
							finishedAt: Date.now(),
							actualParams: result.actualParams,
							actualParamsByImage: buildActualParamsByImage(result.images, result.actualParamsList),
							revisedPromptByImage: buildRevisedPromptByImage(result.images, result.revisedPrompts),
							rawResponsePayload: result.rawResponsePayload,
							streamPartialImageIds: result.partialImages
						}
					: task
			);
			tasks = nextTasks;
			const updatedTask = nextTasks.find((task) => task.id === input.taskId);
			if (updatedTask) await taskPersistence.persistTaskSnapshotNow(updatedTask);
			const completedConversation = getAgentConversation(input.conversationId);
			if (completedConversation) {
				agentConversations = upsertAgentConversation(
					agentConversations,
					completeAgentRound(completedConversation, input.roundId, {
						content,
						outputTaskIds: [input.taskId],
						error: result.images.length || result.partialImages.length ? null : 'Agent 没有返回图片',
						responseId: result.responseId,
						rawResponsePayload: result.rawResponsePayload,
						toolCalls: result.toolCalls,
						toolCallCount: result.toolCallCount,
						maxToolRounds: input.settings.agentMaxToolRounds,
						webSearchEnabled: input.settings.agentWebSearch
					})
				);
			}
			if (result.images.length) {
				toast.success('Agent 生成完成', { description: formatActualImageCount(result.images.length, input.params.n) });
			} else if (result.partialImages.length) {
				toast.warning('Agent 只返回了 partial 图片', {
					description: `${result.partialImages.length} 张 partial 已保留`
				});
			} else {
				toast.error('Agent 没有返回图片');
			}
			notifyTaskCompleted(input.prompt, result.images.length, input.params.n);
		} catch (err) {
			if (isAgentRoundCanceled(input.roundId)) return;
			const message = err instanceof Error ? err.message : String(err);
			error = message;
			toast.error('Agent 失败', { description: message });
			const nextTasks: TaskRecord[] = tasks.map((task) =>
				task.id === input.taskId
					? {
							...task,
							status: task.streamPartialImageIds.length ? 'partial' : 'error',
							error: message,
							finishedAt: Date.now(),
							failureCount: getFailureCountForParams(task.params.n, task.images.length)
						}
					: task
			);
			tasks = nextTasks;
			const updatedTask = nextTasks.find((task) => task.id === input.taskId);
			if (updatedTask) await taskPersistence.persistTaskSnapshotNow(updatedTask);
			const conversation = getAgentConversation(input.conversationId);
			if (conversation) {
				agentConversations = upsertAgentConversation(
					agentConversations,
					completeAgentRound(conversation, input.roundId, {
						content: `Agent 失败：${message}`,
						outputTaskIds: [input.taskId],
						error: message,
						maxToolRounds: input.settings.agentMaxToolRounds,
						webSearchEnabled: input.settings.agentWebSearch
					})
				);
			}
		}
	}

	function updateTaskPartialImages(taskId: string, partialImages: string[]) {
		const nextTasks: TaskRecord[] = tasks.map((task) =>
			task.id === taskId
				? {
						...task,
						streamPartialImageIds: partialImages
					}
				: task
		);
		tasks = nextTasks;
		taskPersistence.persistTaskSnapshotSoon(taskId);
	}

	function buildActualParamsByImage(images: string[], actualParamsList: Array<Partial<TaskParams> | undefined>) {
		return Object.fromEntries(
			images
				.map((_, index) => [String(index), actualParamsList[index]] as const)
				.filter((entry): entry is readonly [string, Partial<TaskParams>] =>
					Boolean(entry[1] && Object.keys(entry[1]).length > 0)
				)
		);
	}

	function buildRevisedPromptByImage(images: string[], revisedPrompts: Array<string | undefined>) {
		return Object.fromEntries(
			images
				.map((_, index) => [String(index), revisedPrompts[index]] as const)
				.filter(
					(entry): entry is readonly [string, string] => typeof entry[1] === 'string' && entry[1].trim().length > 0
				)
		);
	}

	function retryTask(task: TaskRecord) {
		prompt = task.prompt;
		params = { ...task.params };
		inputImages = task.inputImages.map((image) => ({ ...image }));
		mask = task.mask ? { ...task.mask } : null;
		const reuseProfile = getTaskReuseProfile(settings, task);
		nextGalleryProfileOverrideId = reuseProfile?.id ?? null;
		if (reuseProfile) {
			toast.info('已恢复任务参数', { description: `下次生成将临时使用 ${reuseProfile.name}` });
		}
	}

	function toggleTaskFavorite(taskId: string) {
		const nextTasks = tasks.map((task) =>
			task.id === taskId
				? toggleTaskFavoriteCollection(task, settings.defaultFavoriteCollectionId || DEFAULT_FAVORITE_COLLECTION_ID)
				: task
		);
		tasks = nextTasks;
		const updatedTask = nextTasks.find((task) => task.id === taskId);
		if (updatedTask) void taskPersistence.persistTaskSnapshotNow(updatedTask);
	}

	function normalizeTaskFavorites(nextTasks: TaskRecord[]) {
		return nextTasks.map((task) => normalizeTaskFavoriteCollections(task, favoriteCollections));
	}

	function upsertAgentConversation(conversations: AgentConversation[], conversation: AgentConversation) {
		const exists = conversations.some((item) => item.id === conversation.id);
		return exists
			? conversations.map((item) => (item.id === conversation.id ? conversation : item))
			: [conversation, ...conversations];
	}

	function getAgentConversation(conversationId: string) {
		return agentConversations.find((conversation) => conversation.id === conversationId) ?? null;
	}

	function isAgentRoundCanceled(roundId: string) {
		return canceledAgentRoundIds.includes(roundId);
	}

	function updateAgentRoundText(conversationId: string, roundId: string, content: string) {
		const conversation = getAgentConversation(conversationId);
		if (!conversation || isAgentRoundCanceled(roundId)) return;
		agentConversations = upsertAgentConversation(
			agentConversations,
			updateAgentAssistantMessage(conversation, roundId, { content })
		);
	}

	function setActiveAgentRequestId(roundId: string, requestId: string | null) {
		if (requestId) {
			activeAgentRequestIds = { ...activeAgentRequestIds, [roundId]: requestId };
			return;
		}
		const { [roundId]: _removed, ...rest } = activeAgentRequestIds;
		activeAgentRequestIds = rest;
	}

	function stopAgentRound(roundId: string) {
		if (!activeAgentConversation) return;
		const requestId = activeAgentRequestIds[roundId];
		if (requestId) {
			void cancelNativeRequest(requestId).catch(() => undefined);
		}
		canceledAgentRoundIds = [...new Set([...canceledAgentRoundIds, roundId])];
		agentConversations = upsertAgentConversation(
			agentConversations,
			markAgentRoundCanceled(activeAgentConversation, roundId, {
				content: '已停止。已返回的 partial 图片会保留在关联任务里。'
			})
		);
		const nextTasks = tasks.map((task) =>
			task.agentRoundId === roundId && task.status === 'running'
				? {
						...task,
						status: task.streamPartialImageIds.length ? ('partial' as const) : ('error' as const),
						error: task.streamPartialImageIds.length ? null : '用户停止了 Agent 轮次',
						finishedAt: Date.now(),
						failureCount: getFailureCountForParams(task.params.n, task.images.length)
					}
				: task
		);
		tasks = nextTasks;
		void Promise.all(
			nextTasks
				.filter((task) => task.agentRoundId === roundId)
				.map((task) => taskPersistence.persistTaskSnapshotNow(task))
		);
		toast.info('Agent 轮次已停止');
	}

	function retryAgentRound(roundId: string) {
		const round = activeAgentConversation?.rounds.find((item) => item.id === roundId);
		const userMessage = activeAgentConversation?.messages.find((message) => message.id === round?.userMessageId);
		const sourceTask = tasks.find((task) => task.agentRoundId === roundId);
		if (!round || !userMessage) return;
		void startAgentRound({
			prompt: round.prompt,
			inputImages: userMessage.inputImages?.map((image) => ({ ...image })) ?? [],
			mask: userMessage.mask ? { ...userMessage.mask } : null,
			params: { ...(sourceTask?.params ?? params) },
			retryOfRoundId: roundId
		});
	}

	function continueAgentRound(roundId: string) {
		const round = activeAgentConversation?.rounds.find((item) => item.id === roundId);
		const sourceTask = tasks.find((task) => task.agentRoundId === roundId);
		if (!round) return;
		agentPrompt = `继续上一轮结果，补充细节或再生成一组新的图片。`;
		void startAgentRound({
			prompt: agentPrompt,
			inputImages: [],
			mask: null,
			params: { ...(sourceTask?.params ?? params) },
			continuedFromRoundId: roundId
		});
		agentPrompt = '';
	}

	function getAgentRoundDownloadableTaskCount(roundId: string) {
		return tasks.filter(
			(task) =>
				task.agentRoundId === roundId &&
				task.status !== 'running' &&
				(task.images.length > 0 || task.streamPartialImageIds.length > 0)
		).length;
	}

	function createNewAgentConversation() {
		const conversation = createAgentConversation();
		agentConversations = [conversation, ...agentConversations];
		activeAgentConversationId = conversation.id;
		appMode = 'agent';
	}

	function selectAgentConversation(conversationId: string) {
		activeAgentConversationId = conversationId;
		appMode = 'agent';
	}

	function removeAgentConversation(conversationId: string) {
		const nextConversations = agentConversations.filter((conversation) => conversation.id !== conversationId);
		agentConversations = nextConversations.length ? nextConversations : [createAgentConversation()];
		if (activeAgentConversationId === conversationId) activeAgentConversationId = agentConversations[0]?.id ?? null;
	}

	function setActiveFavoriteCollection(collectionId: string | null) {
		settings = normalizeSettings({ ...settings, activeFavoriteCollectionId: collectionId });
	}

	function createCollection() {
		const collection = createFavoriteCollection(newCollectionName, () => `favorites-${crypto.randomUUID()}`);
		if (!collection) {
			toast.warning('请输入收藏集合名称');
			return;
		}
		settings = normalizeSettings({
			...settings,
			favoriteCollections: [...settings.favoriteCollections, collection],
			activeFavoriteCollectionId: collection.id
		});
		newCollectionName = '';
		toast.success('收藏集合已创建', { description: collection.name });
	}

	function startRenameCollection(collection: FavoriteCollection) {
		renamingCollectionId = collection.id;
		renamingCollectionName = collection.name;
	}

	function saveRenameCollection() {
		if (!renamingCollectionId) return;
		settings = normalizeSettings({
			...settings,
			favoriteCollections: renameFavoriteCollection(favoriteCollections, renamingCollectionId, renamingCollectionName)
		});
		renamingCollectionId = null;
		renamingCollectionName = '';
	}

	function removeCollection(collectionId: string) {
		const result = deleteFavoriteCollection(tasks, favoriteCollections, collectionId);
		tasks = result.tasks;
		settings = normalizeSettings({
			...settings,
			favoriteCollections: result.collections,
			activeFavoriteCollectionId:
				settings.activeFavoriteCollectionId === collectionId ? null : settings.activeFavoriteCollectionId
		});
		void taskPersistence.persistTasksSnapshot(result.tasks, { allowEmpty: true });
	}

	function toggleSelectionMode() {
		selectionMode = !selectionMode;
		if (!selectionMode) clearTaskSelection();
	}

	function toggleTaskSelection(taskId: string) {
		if (selectedTaskIds.includes(taskId)) {
			selectedTaskIds = selectedTaskIds.filter((id) => id !== taskId);
			return;
		}
		selectedTaskIds = [...selectedTaskIds, taskId];
	}

	function selectAllVisibleTasks() {
		selectedTaskIds = visibleTasks.map((task) => task.id);
		selectionMode = selectedTaskIds.length > 0;
	}

	function invertVisibleTaskSelection() {
		const selected = new Set(selectedTaskIds);
		selectedTaskIds = visibleTasks.filter((task) => !selected.has(task.id)).map((task) => task.id);
		selectionMode = selectedTaskIds.length > 0;
	}

	function clearTaskSelection() {
		selectedTaskIds = [];
		selectionMode = false;
	}

	function startDragSelection(event: PointerEvent) {
		if (event.button !== 0) return;
		const target = event.target as HTMLElement;
		if (target.closest('[data-no-drag-select],button,input,textarea,select,a,[role="menuitem"]')) return;
		selectionBox = { startX: event.clientX, startY: event.clientY, currentX: event.clientX, currentY: event.clientY };
		selectionMode = true;
	}

	function moveDragSelection(event: PointerEvent) {
		if (!selectionBox) return;
		selectionBox = { ...selectionBox, currentX: event.clientX, currentY: event.clientY };
		const rect = normalizeSelectionRect(selectionBox);
		const selected = visibleTasks
			.filter((task) => {
				const element = document.querySelector(`[data-task-card-id="${task.id}"]`);
				return element instanceof HTMLElement && rectsIntersect(rect, element.getBoundingClientRect());
			})
			.map((task) => task.id);
		selectedTaskIds = selected;
	}

	function stopDragSelection() {
		if (!selectionBox) return;
		selectionBox = null;
		selectionMode = selectedTaskIds.length > 0;
	}

	function normalizeSelectionRect(box: { startX: number; startY: number; currentX: number; currentY: number }) {
		const left = Math.min(box.startX, box.currentX);
		const top = Math.min(box.startY, box.currentY);
		const right = Math.max(box.startX, box.currentX);
		const bottom = Math.max(box.startY, box.currentY);
		return { left, top, right, bottom, width: right - left, height: bottom - top };
	}

	function rectsIntersect(a: DOMRect | ReturnType<typeof normalizeSelectionRect>, b: DOMRect) {
		return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
	}

	async function removeSelectedTasks() {
		const selectedIds = new Set(selectedTaskIds);
		const tasksToRemove = tasks.filter((task) => selectedIds.has(task.id));
		if (!tasksToRemove.length) return;
		const nextTasks = tasks.filter((task) => !selectedIds.has(task.id));
		tasks = nextTasks;
		if (selectedTaskId && selectedIds.has(selectedTaskId)) {
			selectedTaskId = null;
			showTaskDetail = false;
		}
		showBulkDeleteDialog = false;
		clearTaskSelection();
		void taskPersistence.persistTasksSnapshot(nextTasks, { allowEmpty: true });
		const failedImageCleanupCount = await deleteTaskImageFilesWithReport(tasksToRemove, deleteTaskImageFiles);
		if (failedImageCleanupCount) {
			toast.warning('已删除所选任务', {
				description: `${tasksToRemove.length} 个任务已移除，${failedImageCleanupCount} 个任务的图片文件清理失败`
			});
		} else {
			toast.success('已删除所选任务', { description: `${tasksToRemove.length} 个任务已移除` });
		}
	}

	function isZipRouteEnabled(route: AppSettings['zipDownloadRoutes'][number]) {
		return settings.zipDownloadRoutes.includes(route);
	}

	function saveTasksZip(tasksToDownload: TaskRecord[], fileName: string, emptyMessage: string) {
		const entries = buildTaskImageDownloadEntries(tasksToDownload);
		if (!entries.length) {
			error = emptyMessage;
			toast.warning(emptyMessage);
			return;
		}
		const blob = createZipBlob(
			entries.map((entry) => ({
				path: entry.path,
				data: dataUrlToDownloadBytes(entry.dataUrl)
			}))
		);
		void saveBlobToFile(blob, fileName)
			.then((saved) => {
				if (saved) toast.success('ZIP 已保存', { description: fileName });
			})
			.catch(handleDownloadError);
	}

	function downloadSelectedTasksZip() {
		const fileName = `imageport-selection-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.zip`;
		saveTasksZip(selectedDownloadableTasks, fileName, '所选任务没有可下载的输出图');
	}

	function downloadActiveFavoriteCollectionZip() {
		const name =
			activeFavoriteCollectionId === ALL_FAVORITES_COLLECTION_ID
				? 'all-favorites'
				: (favoriteCollections.find((collection) => collection.id === activeFavoriteCollectionId)?.name ?? 'favorites');
		const fileName = `imageport-${createSafeExportName(name)}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.zip`;
		saveTasksZip(activeFavoriteDownloadableTasks, fileName, '当前收藏集合没有可下载的图片');
	}

	function downloadAgentRoundZip(roundId: string) {
		const roundTasks = tasks.filter((task) => task.agentRoundId === roundId && task.status !== 'running');
		const fileName = `imageport-agent-round-${roundId.slice(0, 8)}.zip`;
		saveTasksZip(roundTasks, fileName, '这个 Agent 轮次没有可下载的图片');
	}

	async function removeTask(taskId: string) {
		const taskToRemove = tasks.find((task) => task.id === taskId);
		const nextTasks = tasks.filter((task) => task.id !== taskId);
		tasks = nextTasks;
		selectedTaskIds = selectedTaskIds.filter((id) => id !== taskId);
		if (selectedTaskId === taskId) {
			selectedTaskId = null;
			showTaskDetail = false;
		}
		void taskPersistence.persistTasksSnapshot(nextTasks, { allowEmpty: true });
		const failedImageCleanupCount = taskToRemove
			? await deleteTaskImageFilesWithReport([taskToRemove], deleteTaskImageFiles)
			: 0;
		if (failedImageCleanupCount) {
			toast.warning('任务已删除', { description: '关联图片文件清理失败，可稍后在设置中清理无引用图片' });
		} else {
			toast.success('任务已删除');
		}
	}

	function openTask(task: TaskRecord) {
		selectedTaskId = task.id;
		showTaskDetail = true;
	}

	function openTaskLightbox(task: TaskRecord, imageIndex: number) {
		if (!task.images[imageIndex]) return;
		lightboxImages = task.images;
		lightboxIndex = imageIndex;
		lightboxTitle = task.prompt;
		lightboxTaskId = task.id;
		showLightbox = true;
	}

	function openImagesLightbox(images: string[], imageIndex: number, title: string, taskId: string | null = null) {
		if (!images[imageIndex]) return;
		lightboxImages = images;
		lightboxIndex = imageIndex;
		lightboxTitle = title;
		lightboxTaskId = taskId;
		showLightbox = true;
	}

	function openTaskInputLightbox(task: TaskRecord, imageIndex: number) {
		const images = task.inputImages.map((image) => image.dataUrl);
		openImagesLightbox(images, imageIndex, `${task.prompt} 输入图`, null);
	}

	function clearPrompt() {
		if (appMode === 'agent') agentPrompt = '';
		else prompt = '';
	}

	function loadMoreTasks() {
		visibleTaskLimit += TASK_PAGE_SIZE;
	}

	function formatTaskTime(timestamp: number) {
		return new Intl.DateTimeFormat('zh-CN', {
			hour: '2-digit',
			minute: '2-digit'
		}).format(timestamp);
	}

	function getStatusLabel(status: TaskRecord['status']) {
		if (status === 'running') return '生成中';
		if (status === 'partial') return '部分完成';
		if (status === 'error') return '失败';
		return '已完成';
	}

	function getStatusClass(status: TaskRecord['status']) {
		if (status === 'running') return 'border-blue-200 bg-blue-50 text-blue-700';
		if (status === 'partial') return 'border-amber-200 bg-amber-50 text-amber-700';
		if (status === 'error') return 'border-red-200 bg-red-50 text-red-700';
		return 'border-emerald-200 bg-emerald-50 text-emerald-700';
	}

	function formatDuration(ms: number) {
		const totalSeconds = Math.max(0, Math.floor(ms / 1000));
		const minutes = Math.floor(totalSeconds / 60);
		const seconds = totalSeconds % 60;
		if (minutes <= 0) return `${seconds}s`;
		return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
	}

	function getTaskElapsedMs(task: TaskRecord) {
		return (task.finishedAt ?? now) - task.createdAt;
	}

	function getTaskProgressText(task: TaskRecord) {
		const prefix = task.status === 'running' ? '等待' : '耗时';
		const partial = task.streamPartialImageIds.length ? ` · partial ${task.streamPartialImageIds.length} 张` : '';
		return `${prefix} ${formatDuration(getTaskElapsedMs(task))} · 预计 ${formatExpectedImageCount(task.params.n)} · 实际 ${task.images.length} 张${partial}`;
	}

	function normalizeParamsForRequest(value: TaskParams, profile: ApiProfile, mode: 'gallery' | 'agent'): TaskParams {
		const modelControlsOutputCount =
			mode === 'agent' || (profile.provider === 'openai' && profile.apiMode === 'responses');
		if (modelControlsOutputCount) return { ...value, n: 'auto' };
		return {
			...value,
			n: getConcreteOutputImageCount(value.n)
		};
	}

	function formatExpectedImageCount(value: OutputImageCount) {
		return value === 'auto' ? 'auto（由模型控制）' : `${value} 张`;
	}

	function formatActualImageCount(actualCount: number, expectedCount: OutputImageCount) {
		return expectedCount === 'auto' ? `已生成 ${actualCount} 张` : `已生成 ${actualCount}/${expectedCount} 张图片`;
	}

	function formatImageCountRatio(actualCount: number, expectedCount: OutputImageCount) {
		return expectedCount === 'auto' ? `${actualCount}/auto 张` : `${actualCount}/${expectedCount} 张`;
	}

	function getFailureCountForParams(expectedCount: OutputImageCount, actualCount: number) {
		return getMissingOutputImageCount(expectedCount, actualCount);
	}

	function getTaskDownloadableImageCount(task: TaskRecord) {
		return task.images.length + task.streamPartialImageIds.length;
	}

	function getAgentRoundLabel(roundStatus: string | undefined) {
		if (roundStatus === 'running') return '运行中';
		if (roundStatus === 'error') return '失败';
		if (roundStatus === 'canceled') return '已停止';
		return '完成';
	}

	function getAgentRoundClass(roundStatus: string | undefined) {
		if (roundStatus === 'running') return 'border-blue-200 bg-blue-50 text-blue-700';
		if (roundStatus === 'error') return 'border-red-200 bg-red-50 text-red-700';
		if (roundStatus === 'canceled') return 'border-slate-200 bg-slate-50 text-slate-700';
		return 'border-emerald-200 bg-emerald-50 text-emerald-700';
	}

	function updateImageCount(event: Event) {
		if (params.n === 'auto') return;
		const input = event.currentTarget as HTMLInputElement;
		const numeric = Number(input.value);
		params.n = Number.isFinite(numeric) ? Math.min(MAX_OUTPUT_IMAGES, Math.max(1, Math.trunc(numeric))) : 1;
	}

	function updateCompression(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const trimmed = input.value.trim();
		if (!trimmed) {
			params.output_compression = null;
			return;
		}
		const numeric = Number(trimmed);
		params.output_compression = Number.isFinite(numeric) ? Math.min(100, Math.max(0, Math.trunc(numeric))) : null;
	}

	function isInputImage(value: unknown): value is InputImage {
		return (
			Boolean(value) &&
			typeof value === 'object' &&
			typeof (value as InputImage).id === 'string' &&
			typeof (value as InputImage).dataUrl === 'string'
		);
	}

	function notifyTaskCompleted(taskPrompt: string, actualCount: number, expectedCount: OutputImageCount) {
		if (!settings.taskCompletionNotification || typeof Notification === 'undefined') return;
		if (Notification.permission !== 'granted') return;
		new Notification('ImagePort 生成完成', {
			body: `${formatImageCountRatio(actualCount, expectedCount)} · ${taskPrompt.slice(0, 48)}`
		});
	}

	function handlePromptKeydown(event: KeyboardEvent) {
		if (!settings.enterSubmit) return;
		if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
		event.preventDefault();
		void (appMode === 'agent' ? submitAgentMessage() : submitGeneration());
	}

	function openFilePicker() {
		fileInput?.click();
	}

	async function handleFileSelection(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		await addFiles(input.files);
		input.value = '';
	}

	async function handlePaste(event: ClipboardEvent) {
		const files = Array.from(event.clipboardData?.files ?? []).filter((file) => file.type.startsWith('image/'));
		if (!files.length) return;
		event.preventDefault();
		await addFiles(files);
	}

	async function handleDrop(event: DragEvent) {
		event.preventDefault();
		const files = Array.from(event.dataTransfer?.files ?? []).filter((file) => file.type.startsWith('image/'));
		if (!files.length) return;
		await addFiles(files);
	}

	function handleDragOver(event: DragEvent) {
		event.preventDefault();
	}

	async function addFiles(files: FileList | File[] | null) {
		if (!files) return;
		const accepted = Array.from(files).filter((file) => file.type.startsWith('image/'));
		const remaining = MAX_INPUT_IMAGES - inputImages.length;
		if (remaining <= 0) {
			error = `参考图数量已达上限（${MAX_INPUT_IMAGES} 张）`;
			return;
		}

		const additions = await Promise.all(accepted.slice(0, remaining).map(fileToInputImage));
		if (!additions.length) return;
		const existingIds = new Set(inputImages.map((image) => image.id));
		inputImages = [...inputImages, ...additions.filter((image) => !existingIds.has(image.id))];
	}

	async function fileToInputImage(file: File): Promise<InputImage> {
		const dataUrl = await readFileAsDataUrl(file);
		return {
			id: await hashText(dataUrl),
			name: file.name || 'input.png',
			dataUrl
		};
	}

	function readFileAsDataUrl(file: File) {
		return new Promise<string>((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => resolve(String(reader.result));
			reader.onerror = () => reject(reader.error ?? new Error('读取图片失败'));
			reader.readAsDataURL(file);
		});
	}

	async function hashText(text: string) {
		const data = new TextEncoder().encode(text);
		const digest = await crypto.subtle.digest('SHA-256', data);
		return Array.from(new Uint8Array(digest))
			.map((byte) => byte.toString(16).padStart(2, '0'))
			.join('')
			.slice(0, 24);
	}

	function removeInputImage(id: string) {
		inputImages = inputImages.filter((image) => image.id !== id);
		if (mask?.targetImageId === id) {
			mask = null;
		}
	}

	function clearInputImages() {
		inputImages = [];
		mask = null;
	}

	async function clearTasks() {
		const tasksToClear = tasks;
		tasks = [];
		clearTaskSelection();
		selectedTaskId = null;
		showTaskDetail = false;
		localStorage.removeItem(TASKS_STORAGE_KEY);
		void taskPersistence.persistTasksSnapshot([], { allowEmpty: true });
		const failedImageCleanupCount = await deleteTaskImageFilesWithReport(tasksToClear, deleteTaskImageFiles);
		if (failedImageCleanupCount) {
			toast.warning('任务已清空', {
				description: `${tasksToClear.length} 个任务已移除，${failedImageCleanupCount} 个任务的图片文件清理失败`
			});
		} else {
			toast.success('任务已清空', { description: `${tasksToClear.length} 个任务已移除` });
		}
	}

	async function cleanupImages() {
		const result = await cleanupUnreferencedTaskImageFiles(tasks);
		if (result.failedCount > 0) {
			toast.warning('图片清理完成', {
				description: `已清理 ${result.removedCount} 个文件，${result.failedCount} 个失败`
			});
		} else {
			toast.success('图片清理完成', {
				description: result.removedCount ? `已清理 ${result.removedCount} 个无引用文件` : '没有发现需要清理的图片文件'
			});
		}
		return result;
	}

	function exportTasks() {
		const payload = buildExportedTasks(tasks);
		const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
		void saveBlobToFile(blob, 'imageport-tasks.json')
			.then((saved) => {
				if (saved) toast.success('任务已导出', { description: `${tasks.length} 个任务` });
			})
			.catch(handleDownloadError);
	}

	function exportFullBackup() {
		const payload = buildFullBackupPayload(tasks, settings, Date.now(), agentConversations);
		const manifestBytes = new TextEncoder().encode(JSON.stringify(payload.manifest, null, 2));
		const blob = createZipBlob([{ path: 'manifest.json', data: manifestBytes }, ...payload.files]);
		const fileName = `imageport-backup-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.zip`;
		void saveBlobToFile(blob, fileName)
			.then((saved) => {
				if (saved) toast.success('完整备份已导出', { description: fileName });
			})
			.catch(handleDownloadError);
	}

	async function importTasksFromFile(file: File): Promise<TaskImportSummary> {
		const imported = parseImportedTasks(await file.text());
		const summary = createTaskImportSummary(tasks, imported);
		tasks = summary.tasks;
		await taskPersistence.persistTasksSnapshot(summary.tasks);
		toast.success('任务已导入', {
			description: `新增 ${summary.addedCount} 个，跳过 ${summary.skippedDuplicateCount} 个重复任务`
		});
		return summary;
	}

	async function importFullBackupFromFile(file: File): Promise<TaskImportSummary> {
		const entries = readStoredZipEntries(new Uint8Array(await file.arrayBuffer()));
		const manifestBytes = entries.get('manifest.json');
		if (!manifestBytes) throw new Error('备份 ZIP 缺少 manifest.json');
		const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as Parameters<
			typeof restoreFullBackupTasks
		>[0];
		const restoredTasks = await restoreFullBackupTasks(manifest, async (path) => {
			const bytes = entries.get(path);
			return bytes ? imageBytesToDataUrl(bytes, path) : null;
		});
		settings = normalizeSettings({
			...manifest.settings,
			profiles: [...settings.profiles, ...manifest.settings.profiles],
			activeProfileId: settings.activeProfileId
		});
		if (manifest.agentConversations?.length) {
			agentConversations = normalizeAgentConversations([...agentConversations, ...manifest.agentConversations]);
			activeAgentConversationId = activeAgentConversationId ?? agentConversations[0]?.id ?? null;
		}
		const summary = createTaskImportSummary(tasks, restoredTasks);
		tasks = summary.tasks;
		await taskPersistence.persistTasksSnapshot(summary.tasks);
		toast.success('完整备份已恢复', {
			description: `新增 ${summary.addedCount} 个任务，跳过 ${summary.skippedDuplicateCount} 个重复任务`
		});
		return summary;
	}

	function saveMask(nextMask: MaskDraft) {
		mask = nextMask;
	}

	function readLocalStorageJson(key: string): unknown | null {
		const value = localStorage.getItem(key);
		if (!value) return null;
		return JSON.parse(value) as unknown;
	}

	function downloadImage(src: string, task: TaskRecord, index: number) {
		const fileName = `imageport-${task.id}-${index + 1}.${extensionFromDataUrl(src)}`;
		void saveDataUrlToFile(src, fileName)
			.then((saved) => {
				if (saved) toast.success('图片已保存', { description: fileName });
			})
			.catch(handleDownloadError);
	}

	function downloadLightboxImage(src: string, index: number) {
		const task = lightboxTask;
		if (task) {
			downloadImage(src, task, index);
			return;
		}
		const fileName = `imageport-image-${index + 1}.${extensionFromDataUrl(src)}`;
		void saveDataUrlToFile(src, fileName)
			.then((saved) => {
				if (saved) toast.success('图片已保存', { description: fileName });
			})
			.catch(handleDownloadError);
	}

	function copyImage(src: string) {
		void copyImageToClipboard(src)
			.then(() => {
				toast.success('图片已复制');
			})
			.catch((err) => {
				const message = `复制失败：${err instanceof Error ? err.message : String(err)}`;
				error = message;
				toast.error('复制失败', { description: message });
			});
	}

	async function addDataUrlAsReference(dataUrl: string, name: string) {
		if (inputImages.length >= MAX_INPUT_IMAGES) {
			error = `参考图数量已达上限（${MAX_INPUT_IMAGES} 张）`;
			toast.warning('参考图数量已达上限', { description: `最多 ${MAX_INPUT_IMAGES} 张` });
			return false;
		}
		const id = await hashText(dataUrl);
		if (inputImages.some((item) => item.id === id)) {
			toast.info('参考图已存在');
			return false;
		}
		inputImages = [
			...inputImages,
			{
				id,
				name,
				dataUrl
			}
		];
		toast.success('已添加到参考图');
		return true;
	}

	function downloadTaskZip(task: TaskRecord) {
		saveTasksZip([task], `imageport-${task.id}.zip`, '这个任务没有可下载的输出图');
	}

	async function useOutputAsReference(task: TaskRecord, imageIndex: number) {
		const image = task.images[imageIndex];
		if (!image) return;
		await addDataUrlAsReference(image, `output-${task.id}-${imageIndex + 1}.${extensionFromDataUrl(image)}`);
	}

	async function editOutputWithMask(task: TaskRecord, imageIndex: number) {
		await useOutputAsReference(task, imageIndex);
		const image = task.images[imageIndex];
		if (!image) return;
		maskEditorImageId = await hashText(image);
		showMaskEditor = true;
	}

	function handleDownloadError(err: unknown) {
		const message = `下载失败：${err instanceof Error ? err.message : String(err)}`;
		error = message;
		toast.error('下载失败', { description: message });
	}

	function createSafeExportName(value: string) {
		return (
			value
				.trim()
				.replace(/[^a-zA-Z0-9\u4e00-\u9fa5._-]+/g, '-')
				.replace(/^-+|-+$/g, '')
				.slice(0, 48) || 'imageport'
		);
	}
</script>

<svelte:head>
	<title>ImagePort</title>
</svelte:head>

<div class="bg-background text-foreground flex h-screen min-h-0 flex-col overflow-hidden">
	<header data-no-drag-select class="border-border/80 bg-background/95 z-40 shrink-0 border-b backdrop-blur">
		<div class="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6">
			<div class="flex min-w-0 items-center gap-3">
				<ImagePortLogo class="size-8 rounded-lg shadow-xs" />
				<div class="min-w-0">
					<h1 class="truncate text-lg font-bold tracking-normal">ImagePort</h1>
					<p class="text-muted-foreground text-xs">Gallery</p>
				</div>
			</div>

			<div class="flex items-center gap-2">
				<div class="border-border bg-muted/60 hidden items-center gap-1 rounded-lg border p-1 shadow-xs sm:flex">
					<Button
						variant={appMode === 'gallery' ? 'default' : 'ghost'}
						size="sm"
						class={`h-7 px-3 ${appMode === 'gallery' ? 'shadow-xs' : 'text-muted-foreground hover:text-foreground'}`}
						aria-pressed={appMode === 'gallery'}
						onclick={() => (appMode = 'gallery')}
					>
						画廊
					</Button>
					<Button
						variant={appMode === 'agent' ? 'default' : 'ghost'}
						size="sm"
						class={`h-7 px-3 ${appMode === 'agent' ? 'shadow-xs' : 'text-muted-foreground hover:text-foreground'}`}
						aria-pressed={appMode === 'agent'}
						onclick={() => (appMode = 'agent')}
					>
						<MessagesSquare class="size-4" />
						Agent
					</Button>
				</div>
				<Button variant="ghost" size="icon-sm" onclick={() => (showSettings = true)} aria-label="设置">
					<Settings class="size-4" />
				</Button>
			</div>
		</div>
	</header>

	<main
		data-home-main
		data-drag-select-surface
		class="min-h-0 flex-1 overflow-y-auto px-4 pb-8 sm:px-6"
		ondrop={handleDrop}
		ondragover={handleDragOver}
		onpointerdown={startDragSelection}
		onpointermove={moveDragSelection}
		onpointerup={stopDragSelection}
		onpointercancel={stopDragSelection}
	>
		{#if appMode === 'gallery'}
			<div class="mx-auto max-w-7xl">
				<div data-no-drag-select class="sticky top-0 z-20 bg-background/95 pt-5 pb-4 backdrop-blur">
					<div class="flex gap-3">
						<div class="relative w-32 shrink-0">
							<Select bind:value={filterStatus} name="filterStatus" class="h-10 rounded-lg">
								<option value="all">全部状态</option>
								<option value="done">已完成</option>
								<option value="partial">部分完成</option>
								<option value="running">生成中</option>
								<option value="error">失败</option>
							</Select>
						</div>
						<div class="relative min-w-0 flex-1">
							<Search
								class="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
							/>
							<Input
								bind:value={searchQuery}
								name="searchQuery"
								class="h-10 rounded-lg pl-9"
								placeholder="搜索提示词、参数..."
							/>
						</div>
						<DropdownMenu.Root>
							<DropdownMenu.Trigger>
								<Button
									type="button"
									variant={activeFavoriteCollectionId ? 'secondary' : 'outline'}
									class="h-10 shrink-0"
								>
									<Heart class={`size-4 ${activeFavoriteCollectionId ? 'fill-current' : ''}`} />
									{activeFavoriteCollectionId === ALL_FAVORITES_COLLECTION_ID
										? '全部收藏'
										: (favoriteCollections.find((collection) => collection.id === activeFavoriteCollectionId)?.name ??
											'收藏')}
								</Button>
							</DropdownMenu.Trigger>
							<DropdownMenu.Content align="end" class="w-72">
								<DropdownMenu.Item onclick={() => setActiveFavoriteCollection(null)}>
									<Heart class="size-4" />
									全部任务
								</DropdownMenu.Item>
								<DropdownMenu.Item onclick={() => setActiveFavoriteCollection(ALL_FAVORITES_COLLECTION_ID)}>
									<Heart class="size-4 fill-current text-rose-600" />
									全部收藏
								</DropdownMenu.Item>
								<DropdownMenu.Separator />
								{#each favoriteCollections as collection}
									<div class="flex items-center gap-1 rounded-sm px-1 py-1">
										{#if renamingCollectionId === collection.id}
											<Input
												bind:value={renamingCollectionName}
												name={`rename-${collection.id}`}
												class="h-8 flex-1 text-xs"
												onclick={(event) => event.stopPropagation()}
												onkeydown={(event) => {
													if (event.key === 'Enter') saveRenameCollection();
													if (event.key === 'Escape') {
														renamingCollectionId = null;
														renamingCollectionName = '';
													}
												}}
											/>
											<Button type="button" variant="ghost" size="xs" onclick={saveRenameCollection}>保存</Button>
										{:else}
											<button
												type="button"
												class={`hover:bg-accent flex h-8 min-w-0 flex-1 items-center gap-2 rounded-sm px-2 text-left text-sm ${activeFavoriteCollectionId === collection.id ? 'bg-accent text-accent-foreground' : ''}`}
												onclick={() => setActiveFavoriteCollection(collection.id)}
											>
												<Heart class="size-4" />
												<span class="truncate">{collection.name}</span>
											</button>
											<Button type="button" variant="ghost" size="xs" onclick={() => startRenameCollection(collection)}
												>重命名</Button
											>
											<Button
												type="button"
												variant="ghost"
												size="icon-xs"
												disabled={collection.id === DEFAULT_FAVORITE_COLLECTION_ID}
												onclick={() => removeCollection(collection.id)}
												aria-label="删除收藏集合"
											>
												<Trash2 class="size-3.5" />
											</Button>
										{/if}
									</div>
								{/each}
								{#if activeFavoriteCollectionId && isZipRouteEnabled('favorite-collection-selection')}
									<DropdownMenu.Separator />
									<DropdownMenu.Item
										onclick={downloadActiveFavoriteCollectionZip}
										disabled={!activeFavoriteDownloadableTasks.length}
									>
										<Download class="size-4" />
										下载当前集合 ZIP
									</DropdownMenu.Item>
								{/if}
								<DropdownMenu.Separator />
								<div class="flex gap-2 p-1" role="presentation" onpointerdown={(event) => event.stopPropagation()}>
									<Input
										bind:value={newCollectionName}
										name="newFavoriteCollection"
										class="h-8 text-xs"
										placeholder="新收藏集合"
									/>
									<Button type="button" variant="outline" size="sm" onclick={createCollection}>创建</Button>
								</div>
							</DropdownMenu.Content>
						</DropdownMenu.Root>
						<Button
							type="button"
							variant={selectionMode ? 'secondary' : 'outline'}
							class="h-10 shrink-0"
							onclick={toggleSelectionMode}
						>
							{#if selectionMode}
								<CheckSquare class="size-4" />
							{:else}
								<Square class="size-4" />
							{/if}
							选择
						</Button>
					</div>

					{#if selectionMode || selectedTaskIds.length > 0}
						<div
							class="border-border bg-card mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2 shadow-xs"
						>
							<div class="flex min-w-0 items-center gap-2 text-sm">
								<CheckSquare class="text-primary size-4" />
								<span class="font-medium">已选 {selectedTaskIds.length} 个任务</span>
								<Badge variant="secondary">可下载 {selectedDownloadableTasks.length}</Badge>
							</div>
							<div class="flex flex-wrap items-center gap-2">
								<Button
									type="button"
									variant="outline"
									size="sm"
									onclick={selectAllVisibleTasks}
									disabled={!visibleTasks.length}
								>
									全选当前
								</Button>
								<Button
									type="button"
									variant="outline"
									size="sm"
									onclick={invertVisibleTaskSelection}
									disabled={!visibleTasks.length}
								>
									反选
								</Button>
								{#if isZipRouteEnabled('task-selection')}
									<Button
										type="button"
										variant="outline"
										size="sm"
										onclick={downloadSelectedTasksZip}
										disabled={!selectedDownloadableTasks.length}
									>
										<Download class="size-4" />
										ZIP 下载
									</Button>
								{/if}
								<AlertDialog.Root bind:open={showBulkDeleteDialog}>
									<AlertDialog.Trigger>
										<Button type="button" variant="destructive" size="sm" disabled={!selectedTaskIds.length}>
											<Trash2 class="size-4" />
											删除
										</Button>
									</AlertDialog.Trigger>
									<AlertDialog.Content>
										<AlertDialog.Header>
											<AlertDialog.Title>删除所选任务？</AlertDialog.Title>
											<AlertDialog.Description>
												将删除 {selectedTaskIds.length} 个任务及其本地图片文件。此操作不可恢复。
											</AlertDialog.Description>
										</AlertDialog.Header>
										<AlertDialog.Footer>
											<AlertDialog.Cancel>取消</AlertDialog.Cancel>
											<AlertDialog.Action onclick={removeSelectedTasks}>确认删除</AlertDialog.Action>
										</AlertDialog.Footer>
									</AlertDialog.Content>
								</AlertDialog.Root>
								<Button type="button" variant="ghost" size="sm" onclick={clearTaskSelection}>取消</Button>
							</div>
						</div>
					{/if}
				</div>

				{#if visibleTasks.length === 0}
					<section
						class="border-border/80 bg-muted/20 flex min-h-[calc(100vh-24rem)] items-center justify-center rounded-lg border border-dashed p-10 text-center"
					>
						<div>
							<div
								class="bg-background border-border mx-auto mb-4 flex size-12 items-center justify-center rounded-lg border"
							>
								<ImageIcon class="text-muted-foreground size-5" />
							</div>
							<p class="text-lg font-medium">暂无图片</p>
							<p class="text-muted-foreground mt-1 text-sm">在底部输入提示词开始生成。</p>
						</div>
					</section>
				{:else}
					<section class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
						{#each visibleTasks as task}
							{@const previewImages = task.images.length
								? getTaskPreviewImages(task)
								: task.streamPartialImageIds.slice(-4)}
							{@const isSelected = selectedTaskIds.includes(task.id)}
							<article
								data-task-card-id={task.id}
								class={`border-border bg-card group overflow-hidden rounded-lg border shadow-xs ${isSelected ? 'border-primary ring-ring ring-2' : ''}`}
							>
								<div class="bg-muted relative aspect-square w-full overflow-hidden">
									{#if task.images[0] || task.streamPartialImageIds[0]}
										<ImageActionContextMenu
											canDownloadAll={getTaskDownloadableImageCount(task) > 1}
											canUseAsReference
											canEditMask={Boolean(task.images[0])}
											onOpen={() =>
												task.images[0]
													? openTaskLightbox(task, 0)
													: openImagesLightbox(task.streamPartialImageIds, 0, `${task.prompt} partial`, task.id)}
											onDownload={() => downloadImage(task.images[0] ?? task.streamPartialImageIds[0], task, 0)}
											onDownloadAll={() => downloadTaskZip(task)}
											onCopy={() => copyImage(task.images[0] ?? task.streamPartialImageIds[0])}
											onUseAsReference={() =>
												void addDataUrlAsReference(
													task.images[0] ?? task.streamPartialImageIds[0],
													`partial-${task.id}-1.png`
												)}
											onEditMask={() => (task.images[0] ? void editOutputWithMask(task, 0) : undefined)}
										>
											<button
												type="button"
												class="absolute inset-0 z-[1] block w-full text-left"
												onclick={() => openTask(task)}
												aria-label="打开任务详情"
											></button>
										</ImageActionContextMenu>
									{:else}
										<button
											type="button"
											class="absolute inset-0 z-[1] block w-full text-left"
											onclick={() => openTask(task)}
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
													selectionMode = true;
													toggleTaskSelection(task.id);
												}}
											/>
										</div>
										<button
											type="button"
											class={`flex size-7 items-center justify-center rounded-full border shadow-sm backdrop-blur transition ${task.isFavorite ? 'border-rose-200 bg-rose-50 text-rose-600' : 'border-white/60 bg-black/45 text-white hover:bg-black/65'}`}
											onclick={(event) => {
												event.stopPropagation();
												toggleTaskFavorite(task.id);
											}}
											aria-label={task.isFavorite ? '取消收藏' : '收藏任务'}
										>
											<Heart class={`size-4 ${task.isFavorite ? 'fill-current' : ''}`} />
										</button>
									</div>
									{#if task.status === 'running' && !previewImages.length}
										<div class="absolute inset-0 flex flex-col items-center justify-center gap-3">
											<LoaderCircle class="text-muted-foreground size-6 animate-spin" />
											<span class="text-muted-foreground text-sm"
												>生成中 · {formatDuration(getTaskElapsedMs(task))}</span
											>
											<span class="text-muted-foreground text-xs">预计 {formatExpectedImageCount(task.params.n)}</span>
										</div>
									{:else if task.status === 'running' && previewImages.length}
										<img
											class="h-full w-full object-cover opacity-90 transition-transform duration-300 group-hover:scale-[1.02]"
											src={previewImages.at(-1)}
											alt={`${task.prompt} partial`}
										/>
										<div
											class="absolute inset-x-0 bottom-0 bg-linear-to-t from-black/65 to-transparent p-3 pt-8 text-xs text-white"
										>
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
										<div
											class="text-muted-foreground absolute inset-0 flex items-center justify-center px-4 text-center text-sm"
										>
											{task.error ?? '没有图片'}
										</div>
									{/if}
									<span
										class={`absolute top-2 right-2 rounded-full border px-2 py-0.5 text-xs ${getStatusClass(task.status)}`}
									>
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
											{task.params.size} · {task.params.quality} · {task.params.output_format} · {formatTaskTime(
												task.createdAt
											)}
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
											onclick={() => openTask(task)}
											disabled={!task.images.length && !task.streamPartialImageIds.length}
										>
											<Eye class="size-3" />
											查看
										</Button>
										<Button variant="outline" size="xs" onclick={() => retryTask(task)}>
											<RotateCcw class="size-3" />
											复用
										</Button>
										<Button
											variant="ghost"
											size="xs"
											onclick={() =>
												(task.images[0] || task.streamPartialImageIds[0]) &&
												downloadImage(task.images[0] ?? task.streamPartialImageIds[0], task, 0)}
											disabled={!task.images[0] && !task.streamPartialImageIds[0]}
										>
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
													onclick={() => openTask(task)}
													disabled={!task.images.length && !task.streamPartialImageIds.length}
												>
													<Eye class="size-4" />
													查看详情
												</DropdownMenu.Item>
												<DropdownMenu.Item onclick={() => toggleTaskFavorite(task.id)}>
													<Heart class={`size-4 ${task.isFavorite ? 'fill-current text-rose-600' : ''}`} />
													{task.isFavorite ? '取消收藏' : '收藏任务'}
												</DropdownMenu.Item>
												{#if isZipRouteEnabled('task-card')}
													<DropdownMenu.Item
														onclick={() => downloadTaskZip(task)}
														disabled={!task.images.length && !task.streamPartialImageIds.length}
													>
														<Download class="size-4" />
														下载全部 ZIP
													</DropdownMenu.Item>
												{/if}
												<DropdownMenu.Item
													onclick={() => void useOutputAsReference(task, 0)}
													disabled={!task.images[0]}
												>
													<ImagePlus class="size-4" />
													首图作参考
												</DropdownMenu.Item>
												<DropdownMenu.Separator />
												<DropdownMenu.Item variant="destructive" onclick={() => removeTask(task.id)}>
													<Trash2 class="size-4" />
													删除任务
												</DropdownMenu.Item>
											</DropdownMenu.Content>
										</DropdownMenu.Root>
									</div>
								</div>
							</article>
						{/each}
					</section>
					{#if hasMoreTasks}
						<div data-no-drag-select class="flex justify-center pt-5">
							<Button type="button" variant="outline" onclick={loadMoreTasks}>
								加载更多
								<span class="text-muted-foreground text-xs">{visibleTasks.length}/{filteredTasks.length}</span>
							</Button>
						</div>
					{/if}
				{/if}
				{#if selectionBox}
					{@const rect = normalizeSelectionRect(selectionBox)}
					<div
						class="pointer-events-none fixed z-50 border border-primary bg-primary/10"
						style={`left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;`}
					></div>
				{/if}
			</div>
		{:else}
			<div
				class="mx-auto grid h-full min-h-0 w-full max-w-7xl grid-cols-[260px_minmax(0,1fr)_320px] gap-4 py-5 max-xl:grid-cols-[220px_minmax(0,1fr)] max-lg:grid-cols-1"
			>
				<aside
					data-no-drag-select
					class="border-border bg-card min-h-0 overflow-hidden rounded-lg border shadow-xs max-lg:hidden"
				>
					<div class="border-border flex items-center justify-between border-b p-3">
						<div>
							<h2 class="text-sm font-semibold">Agent 会话</h2>
							<p class="text-muted-foreground text-xs">{agentConversations.length} 个会话</p>
						</div>
						<Button
							type="button"
							variant="outline"
							size="icon-sm"
							onclick={createNewAgentConversation}
							aria-label="新建会话"
						>
							<MessagesSquare class="size-4" />
						</Button>
					</div>
					<div class="min-h-0 overflow-y-auto p-2">
						{#each agentConversations as conversation}
							<button
								type="button"
								class={`mb-1 flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm ${activeAgentConversation?.id === conversation.id ? 'bg-primary/10 text-primary' : 'hover:bg-muted'}`}
								onclick={() => selectAgentConversation(conversation.id)}
							>
								<MessagesSquare class="size-4 shrink-0" />
								<span class="min-w-0 flex-1 truncate">{conversation.title}</span>
								<span class="text-muted-foreground text-xs">{conversation.rounds.length}</span>
							</button>
						{/each}
					</div>
				</aside>

				<section class="border-border bg-card flex min-h-0 flex-col overflow-hidden rounded-lg border shadow-xs">
					<header data-no-drag-select class="border-border flex items-center justify-between border-b px-4 py-3">
						<div class="min-w-0">
							<h2 class="truncate text-sm font-semibold">{activeAgentConversation?.title ?? 'Agent'}</h2>
							<p class="text-muted-foreground text-xs">
								{activeProfile.name} · {activeProfile.model} · 最大工具轮数 {settings.agentMaxToolRounds}
							</p>
						</div>
						<div class="flex items-center gap-2">
							<Button type="button" variant="outline" size="sm" onclick={createNewAgentConversation}>新会话</Button>
							<Button
								type="button"
								variant="ghost"
								size="icon-sm"
								disabled={!activeAgentConversation}
								onclick={() => activeAgentConversation && removeAgentConversation(activeAgentConversation.id)}
								aria-label="删除会话"
							>
								<Trash2 class="size-4" />
							</Button>
						</div>
					</header>
					<div bind:this={agentMessagesViewport} class="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
						{#if !activeAgentConversation?.messages.length}
							<div
								class="border-border bg-muted/20 flex h-full min-h-96 items-center justify-center rounded-lg border border-dashed p-8 text-center"
							>
								<div>
									<MessagesSquare class="text-muted-foreground mx-auto mb-3 size-8" />
									<p class="font-medium">开始一个 Agent 生成会话</p>
									<p class="text-muted-foreground mt-1 text-sm">
										Agent 通过 Responses API 调用图片工具，输出会沉淀为 Gallery 任务。
									</p>
								</div>
							</div>
						{:else}
							{#each activeAgentConversation.messages as message}
								{@const round = activeAgentConversation.rounds.find((item) => item.id === message.roundId)}
								<div class={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
									<div
										class={`max-w-[78%] rounded-lg border px-3 py-2 text-sm leading-relaxed ${message.role === 'user' ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted/35'}`}
									>
										<div class="flex items-start justify-between gap-3">
											<p class="whitespace-pre-wrap">
												{message.content || (message.role === 'assistant' ? '...' : '')}
											</p>
											{#if message.role === 'assistant' && round}
												<Badge variant="outline" class={`shrink-0 ${getAgentRoundClass(round.status)}`}
													>{getAgentRoundLabel(round.status)}</Badge
												>
											{/if}
										</div>
										{#if message.role === 'assistant' && round}
											<div class="text-muted-foreground mt-2 flex flex-wrap items-center gap-2 text-xs">
												<span>工具 {round.toolCallCount}/{round.maxToolRounds ?? settings.agentMaxToolRounds}</span>
												{#if round.webSearchEnabled}
													<span>Web Search</span>
												{/if}
												{#if round.responseId}
													<span class="max-w-44 truncate">response {round.responseId}</span>
												{/if}
											</div>
											{#if round.error}
												<p class="text-destructive mt-2 text-xs">{round.error}</p>
											{/if}
											{#if round.toolCalls.length}
												<div class="mt-2 flex flex-wrap gap-1">
													{#each round.toolCalls as toolCall}
														<Badge variant="secondary" class="max-w-56 truncate">
															{toolCall.type}{toolCall.status ? ` · ${toolCall.status}` : ''}{toolCall.title
																? ` · ${toolCall.title}`
																: ''}
														</Badge>
													{/each}
												</div>
											{/if}
											<div class="mt-2 flex flex-wrap gap-2">
												{#if round.status === 'running'}
													<Button
														type="button"
														variant="outline"
														size="sm"
														class="h-7"
														onclick={() => stopAgentRound(round.id)}>停止</Button
													>
												{:else if round.status === 'error' || round.status === 'canceled'}
													<Button
														type="button"
														variant="outline"
														size="sm"
														class="h-7"
														onclick={() => retryAgentRound(round.id)}>重试</Button
													>
												{:else}
													<Button
														type="button"
														variant="outline"
														size="sm"
														class="h-7"
														onclick={() => continueAgentRound(round.id)}>继续</Button
													>
													<Button
														type="button"
														variant="ghost"
														size="sm"
														class="h-7"
														onclick={() => retryAgentRound(round.id)}>再跑一次</Button
													>
												{/if}
												{#if isZipRouteEnabled('agent-round-all') && getAgentRoundDownloadableTaskCount(round.id) > 0}
													<Button
														type="button"
														variant="ghost"
														size="sm"
														class="h-7"
														onclick={() => downloadAgentRoundZip(round.id)}
													>
														<Download class="size-4" />
														下载本轮
													</Button>
												{/if}
											</div>
										{/if}
										{#if message.outputTaskIds?.length}
											<div class="mt-2 grid grid-cols-2 gap-2">
												{#each message.outputTaskIds as taskId}
													{@const task = tasks.find((item) => item.id === taskId)}
													{#if task}
														<button
															type="button"
															class="overflow-hidden rounded-md border bg-background text-left"
															onclick={() => openTask(task)}
														>
															{#if task.images[0] || task.streamPartialImageIds[0]}
																<img
																	class="aspect-square w-full object-cover"
																	src={task.images[0] ?? task.streamPartialImageIds.at(-1)}
																	alt={task.prompt}
																/>
															{:else}
																<div
																	class="text-muted-foreground flex aspect-square items-center justify-center text-xs"
																>
																	{getStatusLabel(task.status)}
																</div>
															{/if}
															<div class="p-2 text-xs text-foreground">
																{formatImageCountRatio(task.images.length, task.params.n)}
															</div>
														</button>
													{/if}
												{/each}
											</div>
										{/if}
									</div>
								</div>
							{/each}
						{/if}
					</div>
				</section>

				<aside
					data-no-drag-select
					class="border-border bg-card min-h-0 overflow-hidden rounded-lg border shadow-xs max-xl:hidden"
				>
					<div class="border-border border-b p-3">
						<h2 class="text-sm font-semibold">Agent 图片</h2>
						<p class="text-muted-foreground text-xs">当前会话输出任务</p>
					</div>
					<div class="grid max-h-full gap-2 overflow-y-auto p-3">
						{#each activeAgentTasks as task}
							<button
								type="button"
								class="overflow-hidden rounded-lg border bg-muted/15 text-left"
								onclick={() => openTask(task)}
							>
								{#if task.images[0] || task.streamPartialImageIds[0]}
									<img
										class="aspect-video w-full object-cover"
										src={task.images[0] ?? task.streamPartialImageIds.at(-1)}
										alt={task.prompt}
									/>
								{:else}
									<div class="text-muted-foreground flex aspect-video items-center justify-center text-xs">
										{getStatusLabel(task.status)}
									</div>
								{/if}
								<div class="p-2">
									<p class="line-clamp-2 text-xs font-medium">{task.prompt}</p>
									<p class="text-muted-foreground mt-1 text-xs">
										{formatImageCountRatio(task.images.length, task.params.n)} · {getStatusLabel(task.status)}
									</p>
								</div>
							</button>
						{/each}
					</div>
				</aside>
			</div>
		{/if}
	</main>

	<div data-input-bar class="pointer-events-none fixed bottom-4 left-1/2 z-30 w-full max-w-4xl -translate-x-1/2 px-3">
		<div class="pointer-events-auto w-full">
			<form
				class="border-border bg-card/95 rounded-xl border p-3 shadow-2xl backdrop-blur"
				onsubmit={(event) => {
					event.preventDefault();
					void (appMode === 'agent' ? submitAgentMessage() : submitGeneration());
				}}
				onpaste={handlePaste}
			>
				{#if inputImages.length > 0}
					<ReferenceImageStrip
						images={inputImages}
						{mask}
						onAdd={openFilePicker}
						onRemove={removeInputImage}
						onClear={clearInputImages}
						onEditMask={(id) => {
							maskEditorImageId = id;
							showMaskEditor = true;
						}}
					/>
				{/if}

				<div class="mb-3 grid grid-cols-[auto_repeat(6,minmax(0,1fr))] items-end gap-2 max-lg:grid-cols-3">
					<div class="text-muted-foreground flex h-9 items-center gap-1.5 text-xs font-medium max-lg:col-span-3">
						<SlidersHorizontal class="size-3.5" />
						参数
					</div>
					<Button
						type="button"
						variant="outline"
						class="justify-start overflow-hidden px-3 text-xs"
						onclick={() => (showSizePicker = true)}
					>
						<span class="truncate">{params.size}</span>
					</Button>
					<Select bind:value={params.quality} name="quality" class="h-9 rounded-lg text-xs" aria-label="质量">
						{#each qualityOptions as option}
							<option value={option}>质量 {option}</option>
						{/each}
					</Select>
					<Select
						bind:value={params.output_format}
						name="outputFormat"
						class="h-9 rounded-lg text-xs"
						aria-label="格式"
					>
						{#each formatOptions as option}
							<option value={option}>格式 {option}</option>
						{/each}
					</Select>
					<Select bind:value={params.moderation} name="moderation" class="h-9 rounded-lg text-xs" aria-label="审核强度">
						{#each moderationOptions as option}
							<option value={option}>审核 {option}</option>
						{/each}
					</Select>
					<Input
						value={params.output_compression ?? ''}
						name="outputCompression"
						type="number"
						min="0"
						max="100"
						class="h-9 rounded-lg text-xs"
						placeholder="压缩"
						disabled={params.output_format === 'png'}
						oninput={updateCompression}
					/>
					<Input
						value={activeParams.n}
						name="imageCount"
						type={activeParams.n === 'auto' ? 'text' : 'number'}
						min="1"
						max={MAX_OUTPUT_IMAGES}
						class="h-9 rounded-lg text-xs"
						disabled={activeParams.n === 'auto'}
						aria-label="生成数量"
						oninput={updateImageCount}
					/>
				</div>

				<div class="flex gap-3">
					<Textarea
						value={appMode === 'agent' ? agentPrompt : prompt}
						name="prompt"
						class="max-h-36 min-h-20 flex-1 resize-none rounded-lg border-0 bg-muted/40 p-3 shadow-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-0"
						placeholder={appMode === 'agent'
							? '给 Agent 发送图片生成或修改需求...'
							: inputImages.length
								? '描述如何编辑或参考这些图片...'
								: '描述你想生成的图片...'}
						oninput={(event) => {
							if (appMode === 'agent') agentPrompt = (event.currentTarget as HTMLTextAreaElement).value;
							else prompt = (event.currentTarget as HTMLTextAreaElement).value;
						}}
						onkeydown={handlePromptKeydown}
					/>
					<div class="flex w-11 flex-col gap-2">
						<Button
							type="button"
							variant="outline"
							size="icon"
							onclick={openFilePicker}
							disabled={inputImages.length >= MAX_INPUT_IMAGES}
							aria-label="添加参考图"
						>
							<ImagePlus class="size-4" />
						</Button>
						<Button
							type="button"
							variant="ghost"
							size="icon"
							onclick={clearPrompt}
							disabled={appMode === 'agent' ? !agentPrompt.trim() : !prompt.trim()}
							aria-label="清空提示词"
						>
							<span class="text-base leading-none">×</span>
						</Button>
						<Button
							type="submit"
							size="icon"
							disabled={appMode === 'agent' ? !canSubmitAgent : !canSubmit}
							aria-label={activeProfile.apiKey ? (appMode === 'agent' ? '发送 Agent 消息' : '生成图像') : '配置 API'}
						>
							<SendHorizontal class="size-4" />
						</Button>
					</div>
				</div>

				<div class="mt-2 flex items-center justify-between gap-3">
					<p class="text-muted-foreground truncate text-xs">
						{!activeProfile.apiKey
							? '尚未配置 API'
							: appMode === 'agent' && agentBlockReason
								? agentBlockReason
								: profileBlockReason
									? profileBlockReason
									: appMode === 'agent'
										? `Agent · 最大工具轮数 ${settings.agentMaxToolRounds}${settings.agentWebSearch ? ' · Web Search' : ''} · ${activeProfile.name} · ${activeProfile.model} · ${activeProfile.timeoutSecs}s${activeProfile.responseFormatB64Json ? ' · b64_json' : ''}`
										: `${nextGalleryProfileOverrideId ? '临时复用 · ' : ''}${effectiveGalleryProfile.name} · ${effectiveGalleryProfile.model} · ${effectiveGalleryProfile.timeoutSecs}s${effectiveGalleryProfile.responseFormatB64Json ? ' · b64_json' : ''}`}
					</p>
					<p class="text-muted-foreground hidden text-xs sm:block">可粘贴或拖拽图片到窗口</p>
				</div>

				{#if error}
					<div
						class="border-destructive/30 bg-destructive/10 text-destructive mt-3 rounded-md border px-3 py-2 text-sm"
					>
						{error}
					</div>
				{/if}
			</form>
		</div>
	</div>

	<input
		bind:this={fileInput}
		name="referenceImages"
		type="file"
		accept="image/*"
		multiple
		class="hidden"
		onchange={handleFileSelection}
	/>

	<GallerySettingsModal
		bind:open={showSettings}
		bind:settings
		{tasks}
		{tasksStorageBytes}
		onClearTasks={clearTasks}
		onCleanupImages={cleanupImages}
		onExportTasks={exportTasks}
		onImportTasks={importTasksFromFile}
		onExportFullBackup={exportFullBackup}
		onImportFullBackup={importFullBackupFromFile}
	/>
	<SizePickerModal bind:open={showSizePicker} currentSize={params.size} onSelect={(size) => (params.size = size)} />
	<TaskDetailModal
		bind:open={showTaskDetail}
		task={selectedTask}
		onReuse={retryTask}
		onDelete={removeTask}
		onToggleFavorite={toggleTaskFavorite}
		onDownloadAll={downloadTaskZip}
		canDownloadAll={isZipRouteEnabled('task-detail-all')}
		onUseAsReference={useOutputAsReference}
		onEditMask={editOutputWithMask}
		onOpenLightbox={(task, index) => openTaskLightbox(task, index)}
		onOpenInputLightbox={openTaskInputLightbox}
		onCopyImage={copyImage}
	/>
	<GalleryLightbox
		bind:open={showLightbox}
		images={lightboxImages}
		bind:index={lightboxIndex}
		title={lightboxTitle}
		canUseAsReference={Boolean(lightboxTask)}
		canEditMask={Boolean(lightboxTask)}
		onDownload={downloadLightboxImage}
		onDownloadAll={lightboxTask && isZipRouteEnabled('lightbox') ? () => downloadTaskZip(lightboxTask) : undefined}
		onCopy={copyImage}
		onUseAsReference={(index) => {
			if (lightboxTask) void useOutputAsReference(lightboxTask, index);
		}}
		onEditMask={(index) => {
			if (lightboxTask) {
				showLightbox = false;
				void editOutputWithMask(lightboxTask, index);
			}
		}}
	/>
	<MaskEditorModal bind:open={showMaskEditor} image={maskEditorImage} existingMask={mask} onSave={saveMask} />
</div>
