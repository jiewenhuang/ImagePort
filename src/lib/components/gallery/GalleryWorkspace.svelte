<script lang="ts">
	import { onMount } from 'svelte';
	import {
		Download,
		Heart,
		ImageIcon,
		MessagesSquare,
		Search,
		Settings,
		Square,
		CheckSquare,
		Trash2
	} from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Select } from '$lib/components/ui/select';
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
		getVisibleGalleryTasks,
		pruneSelectedTaskIds,
		TASK_PAGE_SIZE
	} from '$lib/domain/task-gallery';
	import {
		createDragSelectionBox,
		getDragSelectedTaskIds,
		getVisibleTaskIds,
		invertVisibleTaskSelection as invertVisibleTaskIdsSelection,
		moveDragSelectionBox,
		normalizeSelectionRect,
		toggleTaskIdSelection,
		type DragSelectionBox
	} from '$lib/domain/task-selection';
	import { addTaskRequestId, takeTaskRequestIds, type ActiveTaskRequestIds } from '$lib/domain/task-lifecycle';
	import {
		applyTaskPartialImages,
		markTaskError,
		removeTasksById,
		updateTaskById,
		updateTasksWhere
	} from '$lib/domain/task-state';
	import { normalizeInputDraftSnapshot, readLocalStorageJson } from '$lib/domain/gallery-hydration';
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
	import { createZipBlob } from '$lib/domain/zip';
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
		estimateTasksStorageBytes,
		mergeTaskSnapshots,
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
		saveStoredSettings
	} from '$lib/storage/app-store';
	import {
		cleanupUnreferencedTaskImageFiles,
		deleteTaskImageFiles,
		deleteStoredTasks,
		loadStoredAgentConversations,
		loadStoredTasksPage,
		saveStoredAgentConversations,
		saveStoredTask,
		saveStoredTasks
	} from '$lib/storage/gallery-db';
	import { deleteTaskImageFilesWithReport } from '$lib/storage/task-file-cleanup';
	import { createTaskPersistenceController } from '$lib/storage/task-persistence';
	import { saveBlobToFile, saveDataUrlToFile } from '$lib/storage/native-download';
	import AgentWorkspace from './AgentWorkspace.svelte';
	import GalleryComposer from './GalleryComposer.svelte';
	import {
		buildFullBackupExportFile,
		buildTasksExportFile,
		createSafeExportName,
		readFullBackupImportFile,
		readTaskImportFile
	} from './gallery-import-export';
	import GallerySettingsModal from './GallerySettingsModal.svelte';
	import GalleryLightbox from './GalleryLightbox.svelte';
	import ImagePortLogo from '$lib/components/brand/ImagePortLogo.svelte';
	import MaskEditorModal from './MaskEditorModal.svelte';
	import SizePickerModal from './SizePickerModal.svelte';
	import TaskCard from './TaskCard.svelte';
	import TaskDetailModal from './TaskDetailModal.svelte';
	import TaskSelectionBar from './TaskSelectionBar.svelte';

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
	let activeGalleryRequestIds = $state<ActiveTaskRequestIds>({});
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
	let loadedStoredTaskCount = $state(0);
	let totalStoredTaskCount = $state(0);
	let hasMoreStoredTasks = $state(false);
	let isLoadingStoredTasks = $state(false);
	let lastTaskFilterKey = $state('');
	let selectionMode = $state(false);
	let selectedTaskIds = $state<string[]>([]);
	let selectionBox = $state<DragSelectionBox | null>(null);
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
		deleteTasks: deleteStoredTasks,
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
	let hasMoreTasks = $derived(filteredTasks.length > visibleTasks.length || hasMoreStoredTasks);
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
	let tasksStorageBytes = $state(0);
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
			const saved = (await loadStoredSettings()) ?? readLocalStorageJson(localStorage, SETTINGS_STORAGE_KEY);
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
			const savedDraft = (await loadStoredInputDraft()) ?? readLocalStorageJson(localStorage, INPUT_DRAFT_STORAGE_KEY);
			if (savedDraft && isMounted()) {
				const parsed = normalizeInputDraftSnapshot(savedDraft);
				if (parsed) {
					if (typeof parsed.prompt === 'string') prompt = parsed.prompt;
					if (parsed.params && typeof parsed.params === 'object') params = { ...DEFAULT_PARAMS, ...parsed.params };
					if (parsed.inputImages) inputImages = parsed.inputImages;
					if (parsed.mask) mask = parsed.mask;
					void saveStoredInputDraft({ prompt, params, inputImages, mask });
				}
			}
		} catch {
			// Input draft persistence is best-effort.
		} finally {
			if (isMounted()) hasHydratedInputDraft = true;
		}
		let tasksHydrated = false;
		try {
			const storedTaskPage = await loadStoredTasksPage({ offset: 0, limit: TASK_PAGE_SIZE });
			const fallbackTasks = resolveStoredTasks(null, readLocalStorageJson(localStorage, TASKS_STORAGE_KEY));
			const savedTasks =
				storedTaskPage && (storedTaskPage.total > 0 || !fallbackTasks.length) ? storedTaskPage.tasks : fallbackTasks;
			if (isMounted()) {
				if (savedTasks.length) {
					const normalizedFavorites = normalizeTaskFavorites(
						tasks.length ? mergeTaskSnapshots(tasks, savedTasks) : savedTasks
					);
					tasks = normalizedFavorites;
				}
				loadedStoredTaskCount = storedTaskPage ? storedTaskPage.tasks.length : fallbackTasks.length;
				totalStoredTaskCount = storedTaskPage ? storedTaskPage.total : fallbackTasks.length;
				hasMoreStoredTasks = storedTaskPage?.hasMore ?? false;
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
				(await loadStoredAgentConversations()) ??
				normalizeAgentConversations(readLocalStorageJson(localStorage, AGENT_STORAGE_KEY));
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
			openSettings();
			return;
		}
		const blockReason = getProfileRequestBlockReason(submitProfile, settings);
		if (blockReason) {
			error = blockReason;
			toast.warning('当前配置不可用', { description: blockReason });
			openSettings();
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
		noteStoredTasksAdded(1);
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
			openSettings();
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
		noteStoredTasksAdded(1);
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
				createRequestId: () => createGalleryRequestId(taskId),
				onPartialImages: updateTaskPartialImages,
				isCanceled: () => !hasTask(taskId)
			});
			if (!hasTask(taskId)) return;
			const nextTasks = updateTaskById(tasks, taskId, (task) => ({
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
			}));
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
			if (!hasTask(taskId)) return;
			const message = err instanceof Error ? err.message : String(err);
			error = message;
			toast.error('生成失败', { description: message });
			const failedTask = tasks.find((task) => task.id === taskId);
			const nextTasks = failedTask
				? markTaskError(tasks, taskId, {
						message,
						finishedAt: Date.now(),
						failureCount: getFailureCountForParams(failedTask.params.n, 0)
					})
				: tasks;
			tasks = nextTasks;
			const updatedTask = nextTasks.find((task) => task.id === taskId);
			if (updatedTask) await taskPersistence.persistTaskSnapshotNow(updatedTask);
		} finally {
			releaseGalleryTaskRequests(taskId);
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
			const nextTasks = updateTaskById(tasks, input.taskId, (task) => ({
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
			}));
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
			const nextTasks = updateTaskById(tasks, input.taskId, (task) => ({
				...task,
				status: task.streamPartialImageIds.length ? 'partial' : 'error',
				error: message,
				finishedAt: Date.now(),
				failureCount: getFailureCountForParams(task.params.n, task.images.length)
			}));
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
		if (!hasTask(taskId)) return;
		const nextTasks = applyTaskPartialImages(tasks, taskId, partialImages);
		tasks = nextTasks;
		taskPersistence.persistTaskSnapshotSoon(taskId);
	}

	function hasTask(taskId: string) {
		return tasks.some((task) => task.id === taskId);
	}

	function createGalleryRequestId(taskId: string) {
		const requestId = `${taskId}-${crypto.randomUUID()}`;
		activeGalleryRequestIds = addTaskRequestId(activeGalleryRequestIds, taskId, requestId);
		return requestId;
	}

	function releaseGalleryTaskRequests(taskId: string) {
		activeGalleryRequestIds = takeTaskRequestIds(activeGalleryRequestIds, [taskId]).activeRequestIds;
	}

	function cancelGalleryTaskRequests(taskIds: string[]) {
		const result = takeTaskRequestIds(activeGalleryRequestIds, taskIds);
		activeGalleryRequestIds = result.activeRequestIds;
		for (const requestId of result.requestIds) void cancelNativeRequest(requestId).catch(() => undefined);
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
		const nextTasks = updateTaskById(tasks, taskId, (task) =>
			toggleTaskFavoriteCollection(task, settings.defaultFavoriteCollectionId || DEFAULT_FAVORITE_COLLECTION_ID)
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
		const nextTasks = updateTasksWhere(
			tasks,
			(task) => task.agentRoundId === roundId && task.status === 'running',
			(task) => ({
				...task,
				status: task.streamPartialImageIds.length ? 'partial' : 'error',
				error: task.streamPartialImageIds.length ? null : '用户停止了 Agent 轮次',
				finishedAt: Date.now(),
				failureCount: getFailureCountForParams(task.params.n, task.images.length)
			})
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
		selectedTaskIds = toggleTaskIdSelection(selectedTaskIds, taskId);
	}

	function selectAllVisibleTasks() {
		selectedTaskIds = getVisibleTaskIds(visibleTasks);
		selectionMode = selectedTaskIds.length > 0;
	}

	function invertVisibleTaskSelection() {
		selectedTaskIds = invertVisibleTaskIdsSelection(visibleTasks, selectedTaskIds);
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
		selectionBox = createDragSelectionBox(event.clientX, event.clientY);
		selectionMode = true;
	}

	function moveDragSelection(event: PointerEvent) {
		if (!selectionBox) return;
		selectionBox = moveDragSelectionBox(selectionBox, event.clientX, event.clientY);
		const rect = normalizeSelectionRect(selectionBox);
		selectedTaskIds = getDragSelectedTaskIds(visibleTasks, rect, (taskId) => {
			const element = document.querySelector(`[data-task-card-id="${taskId}"]`);
			return element instanceof HTMLElement ? element.getBoundingClientRect() : null;
		});
	}

	function stopDragSelection() {
		if (!selectionBox) return;
		selectionBox = null;
		selectionMode = selectedTaskIds.length > 0;
	}

	function removeSelectedTasks() {
		const selectedIds = new Set(selectedTaskIds);
		const tasksToRemove = tasks.filter((task) => selectedIds.has(task.id));
		if (!tasksToRemove.length) return;
		const nextTasks = removeTasksById(
			tasks,
			tasksToRemove.map((task) => task.id)
		);
		tasks = nextTasks;
		noteStoredTasksRemoved(tasksToRemove.length);
		cancelGalleryTaskRequests(tasksToRemove.map((task) => task.id));
		if (selectedTaskId && selectedIds.has(selectedTaskId)) {
			selectedTaskId = null;
			showTaskDetail = false;
		}
		showBulkDeleteDialog = false;
		clearTaskSelection();
		void taskPersistence.deleteTaskSnapshots(tasksToRemove.map((task) => task.id));
		toast.success('已删除所选任务', { description: `${tasksToRemove.length} 个任务已移除` });
		cleanupDeletedTaskImages(tasksToRemove, (failedCount) => `${failedCount} 个任务的图片文件清理失败`);
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

	function removeTask(taskId: string) {
		const taskToRemove = tasks.find((task) => task.id === taskId);
		const nextTasks = removeTasksById(tasks, [taskId]);
		tasks = nextTasks;
		noteStoredTasksRemoved(1);
		cancelGalleryTaskRequests([taskId]);
		selectedTaskIds = selectedTaskIds.filter((id) => id !== taskId);
		if (selectedTaskId === taskId) {
			selectedTaskId = null;
			showTaskDetail = false;
		}
		void taskPersistence.deleteTaskSnapshots([taskId]);
		toast.success('任务已删除');
		if (taskToRemove) {
			cleanupDeletedTaskImages([taskToRemove], () => '关联图片文件清理失败，可稍后在设置中清理无引用图片');
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

	function getTaskPrimaryImage(task: TaskRecord) {
		return task.images[0] ?? task.streamPartialImageIds[0] ?? null;
	}

	function openTaskCardPreview(task: TaskRecord) {
		if (task.images[0]) {
			openTaskLightbox(task, 0);
			return;
		}
		openImagesLightbox(task.streamPartialImageIds, 0, `${task.prompt} partial`, task.id);
	}

	function downloadTaskPrimaryImage(task: TaskRecord) {
		const image = getTaskPrimaryImage(task);
		if (image) downloadImage(image, task, 0);
	}

	function copyTaskPrimaryImage(task: TaskRecord) {
		const image = getTaskPrimaryImage(task);
		if (image) void copyImage(image);
	}

	function useTaskPrimaryImageAsReference(task: TaskRecord) {
		const image = getTaskPrimaryImage(task);
		if (image) void addDataUrlAsReference(image, `partial-${task.id}-1.png`);
	}

	function openTaskInputLightbox(task: TaskRecord, imageIndex: number) {
		const images = task.inputImages.map((image) => image.dataUrl);
		openImagesLightbox(images, imageIndex, `${task.prompt} 输入图`, null);
	}

	function refreshTasksStorageBytes(nextTasks: TaskRecord[] = tasks) {
		tasksStorageBytes = estimateTasksStorageBytes(nextTasks);
	}

	function openSettings() {
		refreshTasksStorageBytes();
		showSettings = true;
	}

	async function loadMoreTasks() {
		if (hasMoreStoredTasks) await loadMoreStoredTasks();
		visibleTaskLimit += TASK_PAGE_SIZE;
	}

	async function loadMoreStoredTasks() {
		if (isLoadingStoredTasks || !hasMoreStoredTasks) return;
		isLoadingStoredTasks = true;
		try {
			const page = await loadStoredTasksPage({ offset: loadedStoredTaskCount, limit: TASK_PAGE_SIZE });
			if (!page) {
				hasMoreStoredTasks = false;
				return;
			}
			if (page.tasks.length) {
				tasks = normalizeTaskFavorites(mergeTaskSnapshots(tasks, page.tasks));
			}
			loadedStoredTaskCount = Math.max(loadedStoredTaskCount, page.offset + page.tasks.length);
			totalStoredTaskCount = page.total;
			hasMoreStoredTasks = page.hasMore;
		} catch (err) {
			toast.warning('历史任务加载失败', { description: err instanceof Error ? err.message : String(err) });
			hasMoreStoredTasks = false;
		} finally {
			isLoadingStoredTasks = false;
		}
	}

	function noteStoredTasksRemoved(count: number) {
		loadedStoredTaskCount = Math.max(0, loadedStoredTaskCount - count);
		totalStoredTaskCount = Math.max(0, totalStoredTaskCount - count);
		hasMoreStoredTasks = loadedStoredTaskCount < totalStoredTaskCount;
	}

	function noteStoredTasksAdded(count: number) {
		if (!hasMoreStoredTasks) loadedStoredTaskCount += count;
		totalStoredTaskCount += count;
		hasMoreStoredTasks = loadedStoredTaskCount < totalStoredTaskCount;
	}

	function markAllStoredTasksLoaded(count: number) {
		loadedStoredTaskCount = count;
		totalStoredTaskCount = count;
		hasMoreStoredTasks = false;
	}

	function getStatusLabel(status: TaskRecord['status']) {
		if (status === 'running') return '生成中';
		if (status === 'partial') return '部分完成';
		if (status === 'error') return '失败';
		return '已完成';
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

	function notifyTaskCompleted(taskPrompt: string, actualCount: number, expectedCount: OutputImageCount) {
		if (!settings.taskCompletionNotification || typeof Notification === 'undefined') return;
		if (Notification.permission !== 'granted') return;
		new Notification('ImagePort 生成完成', {
			body: `${formatImageCountRatio(actualCount, expectedCount)} · ${taskPrompt.slice(0, 48)}`
		});
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

	function clearTasks() {
		const tasksToClear = tasks;
		tasks = [];
		markAllStoredTasksLoaded(0);
		refreshTasksStorageBytes([]);
		cancelGalleryTaskRequests(tasksToClear.map((task) => task.id));
		clearTaskSelection();
		selectedTaskId = null;
		showTaskDetail = false;
		localStorage.removeItem(TASKS_STORAGE_KEY);
		void taskPersistence.deleteTaskSnapshots(tasksToClear.map((task) => task.id));
		toast.success('任务已清空', { description: `${tasksToClear.length} 个任务已移除` });
		cleanupDeletedTaskImages(tasksToClear, (failedCount) => `${failedCount} 个任务的图片文件清理失败`);
	}

	function cleanupDeletedTaskImages(
		tasksToCleanup: TaskRecord[],
		getFailureDescription: (failedCount: number) => string
	) {
		if (!tasksToCleanup.length) return;
		void deleteTaskImageFilesWithReport(tasksToCleanup, deleteTaskImageFiles)
			.then((failedCount) => {
				if (failedCount) toast.warning('图片文件清理失败', { description: getFailureDescription(failedCount) });
			})
			.catch((err) => {
				toast.warning('图片文件清理失败', { description: err instanceof Error ? err.message : String(err) });
			});
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
		const file = buildTasksExportFile(tasks);
		void saveBlobToFile(file.blob, file.fileName)
			.then((saved) => {
				if (saved) toast.success('任务已导出', { description: `${tasks.length} 个任务` });
			})
			.catch(handleDownloadError);
	}

	function exportFullBackup() {
		const file = buildFullBackupExportFile({ tasks, settings, agentConversations });
		void saveBlobToFile(file.blob, file.fileName)
			.then((saved) => {
				if (saved) toast.success('完整备份已导出', { description: file.fileName });
			})
			.catch(handleDownloadError);
	}

	async function importTasksFromFile(file: File): Promise<TaskImportSummary> {
		const summary = await readTaskImportFile(file, tasks);
		tasks = summary.tasks;
		markAllStoredTasksLoaded(summary.tasks.length);
		refreshTasksStorageBytes(summary.tasks);
		await taskPersistence.persistTasksSnapshot(summary.tasks);
		toast.success('任务已导入', {
			description: `新增 ${summary.addedCount} 个，跳过 ${summary.skippedDuplicateCount} 个重复任务`
		});
		return summary;
	}

	async function importFullBackupFromFile(file: File): Promise<TaskImportSummary> {
		const result = await readFullBackupImportFile({
			file,
			tasks,
			settings,
			agentConversations,
			activeAgentConversationId
		});
		settings = result.settings;
		agentConversations = result.agentConversations;
		activeAgentConversationId = result.activeAgentConversationId;
		const summary = result.summary;
		tasks = summary.tasks;
		markAllStoredTasksLoaded(summary.tasks.length);
		refreshTasksStorageBytes(summary.tasks);
		await taskPersistence.persistTasksSnapshot(summary.tasks);
		toast.success('完整备份已恢复', {
			description: `新增 ${summary.addedCount} 个任务，跳过 ${summary.skippedDuplicateCount} 个重复任务`
		});
		return summary;
	}

	function saveMask(nextMask: MaskDraft) {
		mask = nextMask;
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
				<Button variant="ghost" size="icon-sm" onclick={openSettings} aria-label="设置">
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
						<TaskSelectionBar
							selectedCount={selectedTaskIds.length}
							downloadableCount={selectedDownloadableTasks.length}
							visibleCount={visibleTasks.length}
							canDownloadZip={isZipRouteEnabled('task-selection')}
							bind:deleteDialogOpen={showBulkDeleteDialog}
							onSelectAll={selectAllVisibleTasks}
							onInvert={invertVisibleTaskSelection}
							onDownloadZip={downloadSelectedTasksZip}
							onDeleteSelected={removeSelectedTasks}
							onClear={clearTaskSelection}
						/>
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
							<TaskCard
								{task}
								{now}
								isSelected={selectedTaskIds.includes(task.id)}
								canDownloadZip={isZipRouteEnabled('task-card')}
								onOpen={openTask}
								onOpenPreview={openTaskCardPreview}
								onSelect={(taskId) => {
									selectionMode = true;
									toggleTaskSelection(taskId);
								}}
								onToggleFavorite={toggleTaskFavorite}
								onRetry={retryTask}
								onDownloadPrimary={downloadTaskPrimaryImage}
								onDownloadAll={downloadTaskZip}
								onCopyPrimary={copyTaskPrimaryImage}
								onUsePrimaryReference={useTaskPrimaryImageAsReference}
								onUseFirstOutputReference={(task) => useOutputAsReference(task, 0)}
								onEditMask={(task) => editOutputWithMask(task, 0)}
								onDelete={removeTask}
							/>
						{/each}
					</section>
						{#if hasMoreTasks}
							<div data-no-drag-select class="flex justify-center pt-5">
								<Button type="button" variant="outline" onclick={loadMoreTasks} disabled={isLoadingStoredTasks}>
									{isLoadingStoredTasks ? '加载中...' : '加载更多'}
									<span class="text-muted-foreground text-xs">
										{hasMoreStoredTasks
											? `${tasks.length}/${totalStoredTaskCount || '...'}`
											: `${visibleTasks.length}/${filteredTasks.length}`}
									</span>
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
			<AgentWorkspace
				{agentConversations}
				{activeAgentConversation}
				{activeAgentTasks}
				{activeProfile}
				{settings}
				{tasks}
				bind:messagesViewport={agentMessagesViewport}
				canDownloadRoundZip={isZipRouteEnabled('agent-round-all')}
				onCreateConversation={createNewAgentConversation}
				onSelectConversation={selectAgentConversation}
				onRemoveConversation={removeAgentConversation}
				onStopRound={stopAgentRound}
				onRetryRound={retryAgentRound}
				onContinueRound={continueAgentRound}
				onDownloadRoundZip={downloadAgentRoundZip}
				onOpenTask={openTask}
				{formatImageCountRatio}
				{getAgentRoundClass}
				{getAgentRoundDownloadableTaskCount}
				{getAgentRoundLabel}
				{getStatusLabel}
			/>
		{/if}
	</main>

	<GalleryComposer
		{appMode}
		bind:prompt
		bind:agentPrompt
		bind:params
		{inputImages}
		{mask}
		{error}
		{settings}
		{activeProfile}
		{effectiveGalleryProfile}
		{activeParams}
		{profileBlockReason}
		{agentBlockReason}
		{nextGalleryProfileOverrideId}
		{canSubmit}
		{canSubmitAgent}
		maxInputImages={MAX_INPUT_IMAGES}
		maxOutputImages={MAX_OUTPUT_IMAGES}
		{qualityOptions}
		{formatOptions}
		{moderationOptions}
		onSubmit={() => void (appMode === 'agent' ? submitAgentMessage() : submitGeneration())}
		onPaste={handlePaste}
		onOpenFilePicker={openFilePicker}
		onOpenSizePicker={() => (showSizePicker = true)}
		onRemoveInputImage={removeInputImage}
		onClearInputImages={clearInputImages}
		onEditMask={(id) => {
			maskEditorImageId = id;
			showMaskEditor = true;
		}}
	/>

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
