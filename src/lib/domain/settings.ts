export type BuiltInApiProvider = 'openai';
export type ApiProvider = BuiltInApiProvider | string;
export type ApiMode = 'images' | 'responses';
export type ReferenceImageEditAction = 'ask' | 'replace-reference' | 'add-mask';
export type CustomProviderRequestMethod = 'GET' | 'POST';
export type CustomProviderContentType = 'json' | 'multipart';
export type CustomProviderFileSource = 'inputImages' | 'mask';

interface ReusableTaskProfileSnapshot {
	apiProfileId?: string | null;
	apiProvider?: string | null;
	apiMode?: ApiMode | null;
	model?: string | null;
}

export interface CustomProviderFileMapping {
	field: string;
	source: CustomProviderFileSource;
	array?: boolean;
}

export interface CustomProviderResultMapping {
	imageUrlPaths?: string[];
	b64JsonPaths?: string[];
}

export interface CustomProviderSubmitMapping {
	path: string;
	method?: CustomProviderRequestMethod;
	contentType?: CustomProviderContentType;
	query?: Record<string, string>;
	body?: Record<string, unknown>;
	files?: CustomProviderFileMapping[];
	taskIdPath?: string;
	result?: CustomProviderResultMapping;
}

export interface CustomProviderPollMapping {
	path: string;
	method?: CustomProviderRequestMethod;
	query?: Record<string, string>;
	intervalSeconds?: number;
	statusPath: string;
	successValues: string[];
	failureValues: string[];
	errorPath?: string;
	result: CustomProviderResultMapping;
}

export interface CustomProviderDefinition {
	id: string;
	name: string;
	template?: 'http-image';
	submit: CustomProviderSubmitMapping;
	editSubmit?: CustomProviderSubmitMapping;
	poll?: CustomProviderPollMapping;
}

export interface FavoriteCollectionSetting {
	id: string;
	name: string;
	createdAt: number;
	updatedAt: number;
}
export type ZipDownloadRoute =
	| 'task-card'
	| 'task-detail-all'
	| 'task-selection'
	| 'lightbox'
	| 'favorite-collection-selection'
	| 'agent-round-all';

export interface ApiProfile {
	id: string;
	name: string;
	provider: ApiProvider;
	baseUrl: string;
	apiKey: string;
	model: string;
	timeoutSecs: number;
	apiMode: ApiMode;
	codexCli: boolean;
	responseFormatB64Json: boolean;
	streamImages: boolean;
	streamPartialImages: number;
	providerDrafts?: Partial<
		Record<
			ApiProvider,
			Partial<
				Pick<
					ApiProfile,
					| 'baseUrl'
					| 'model'
					| 'apiMode'
					| 'codexCli'
					| 'responseFormatB64Json'
					| 'streamImages'
					| 'streamPartialImages'
				>
			>
		>
	>;
}

export interface AppSettings {
	profiles: ApiProfile[];
	activeProfileId: string;
	customProviders: CustomProviderDefinition[];
	clearInputAfterSubmit: boolean;
	persistInputOnRestart: boolean;
	enterSubmit: boolean;
	taskCompletionNotification: boolean;
	referenceImageEditAction: ReferenceImageEditAction;
	reuseTaskApiProfileTemporarily: boolean;
	alwaysShowRetryButton: boolean;
	zipDownloadRoutes: ZipDownloadRoute[];
	agentMaxToolRounds: number;
	agentAutoScroll: boolean;
	agentWebSearch: boolean;
	favoriteCollections: FavoriteCollectionSetting[];
	activeFavoriteCollectionId: string | null;
	defaultFavoriteCollectionId: string;
}

export interface ExportedSettings {
	version: 1;
	settings: AppSettings;
}

export const DEFAULT_IMAGES_MODEL = 'gpt-image-2';
export const DEFAULT_RESPONSES_MODEL = 'gpt-5.5';
const LEGACY_DEFAULT_RESPONSES_MODELS = new Set(['gpt-5.1']);
export const DEFAULT_API_TIMEOUT_SECS = 600;
export const DEFAULT_STREAM_PARTIAL_IMAGES = 2;
export const DEFAULT_PROFILE_ID = 'openai-default';
export const DEFAULT_AGENT_MAX_TOOL_ROUNDS = 15;
export const DEFAULT_ZIP_DOWNLOAD_ROUTES: ZipDownloadRoute[] = [
	'task-card',
	'task-detail-all',
	'task-selection',
	'lightbox'
];
export const DEFAULT_FAVORITE_COLLECTION_ID = 'favorites-default';

export const DEFAULT_SETTINGS: AppSettings = {
	profiles: [
		{
			id: DEFAULT_PROFILE_ID,
			name: 'OpenAI',
			provider: 'openai',
			baseUrl: 'https://api.openai.com/v1',
			apiKey: '',
			model: DEFAULT_IMAGES_MODEL,
			timeoutSecs: DEFAULT_API_TIMEOUT_SECS,
			apiMode: 'images',
			codexCli: false,
			responseFormatB64Json: false,
			streamImages: false,
			streamPartialImages: DEFAULT_STREAM_PARTIAL_IMAGES
		}
	],
	activeProfileId: DEFAULT_PROFILE_ID,
	customProviders: [],
	clearInputAfterSubmit: false,
	persistInputOnRestart: true,
	enterSubmit: false,
	taskCompletionNotification: false,
	referenceImageEditAction: 'ask',
	reuseTaskApiProfileTemporarily: false,
	alwaysShowRetryButton: true,
	zipDownloadRoutes: DEFAULT_ZIP_DOWNLOAD_ROUTES,
	agentMaxToolRounds: DEFAULT_AGENT_MAX_TOOL_ROUNDS,
	agentAutoScroll: true,
	agentWebSearch: false,
	favoriteCollections: [
		{
			id: DEFAULT_FAVORITE_COLLECTION_ID,
			name: '默认收藏',
			createdAt: 0,
			updatedAt: 0
		}
	],
	activeFavoriteCollectionId: null,
	defaultFavoriteCollectionId: DEFAULT_FAVORITE_COLLECTION_ID
};

export function normalizeSettings(value: unknown): AppSettings {
	const record = isRecord(value) ? value : {};
	const customProviders = normalizeCustomProviderDefinitions(record.customProviders);
	const customProviderIds = new Set(customProviders.map((provider) => provider.id));
	const fallbackProfile = normalizeProfile({
		...DEFAULT_SETTINGS.profiles[0],
		baseUrl: getString(record.baseUrl, DEFAULT_SETTINGS.profiles[0].baseUrl),
		apiKey: getString(record.apiKey, DEFAULT_SETTINGS.profiles[0].apiKey),
		model: getString(record.model, DEFAULT_SETTINGS.profiles[0].model),
		timeoutSecs: getNumber(record.timeoutSecs, getNumber(record.timeout, DEFAULT_API_TIMEOUT_SECS)),
		responseFormatB64Json: getBoolean(record.responseFormatB64Json, DEFAULT_SETTINGS.profiles[0].responseFormatB64Json),
		streamImages: getBoolean(record.streamImages, DEFAULT_SETTINGS.profiles[0].streamImages),
		streamPartialImages: getNumber(record.streamPartialImages, DEFAULT_STREAM_PARTIAL_IMAGES)
	}, customProviderIds) ?? DEFAULT_SETTINGS.profiles[0];
	const rawProfiles = Array.isArray(record.profiles) ? record.profiles : [];
	const profiles: ApiProfile[] = [];
	for (const rawProfile of rawProfiles) {
		const profile = normalizeProfile(rawProfile, customProviderIds);
		if (profile) profiles.push(profile);
	}
	const normalizedProfiles: ApiProfile[] = profiles.length ? dedupeProfiles(profiles) : [fallbackProfile];
	const activeProfileId = getString(record.activeProfileId, DEFAULT_SETTINGS.activeProfileId);
	const hasActive = normalizedProfiles.some((profile) => profile.id === activeProfileId);

	return {
		profiles: normalizedProfiles,
		activeProfileId: hasActive ? activeProfileId : normalizedProfiles[0].id,
		customProviders,
		clearInputAfterSubmit: getBoolean(record.clearInputAfterSubmit, DEFAULT_SETTINGS.clearInputAfterSubmit),
		persistInputOnRestart: getBoolean(record.persistInputOnRestart, DEFAULT_SETTINGS.persistInputOnRestart),
		enterSubmit: getBoolean(record.enterSubmit, DEFAULT_SETTINGS.enterSubmit),
		taskCompletionNotification: getBoolean(record.taskCompletionNotification, DEFAULT_SETTINGS.taskCompletionNotification),
		referenceImageEditAction: normalizeReferenceImageEditAction(record.referenceImageEditAction),
		reuseTaskApiProfileTemporarily: getBoolean(record.reuseTaskApiProfileTemporarily, DEFAULT_SETTINGS.reuseTaskApiProfileTemporarily),
		alwaysShowRetryButton: getBoolean(record.alwaysShowRetryButton, DEFAULT_SETTINGS.alwaysShowRetryButton),
		zipDownloadRoutes: normalizeZipDownloadRoutes(record.zipDownloadRoutes),
		agentMaxToolRounds: normalizeAgentMaxToolRounds(record.agentMaxToolRounds),
		agentAutoScroll: getBoolean(record.agentAutoScroll, DEFAULT_SETTINGS.agentAutoScroll),
		agentWebSearch: getBoolean(record.agentWebSearch, DEFAULT_SETTINGS.agentWebSearch),
		favoriteCollections: normalizeFavoriteCollectionSettings(record.favoriteCollections),
		activeFavoriteCollectionId: getNullableString(record.activeFavoriteCollectionId),
		defaultFavoriteCollectionId: getString(record.defaultFavoriteCollectionId, DEFAULT_FAVORITE_COLLECTION_ID)
	};
}

export function getActiveProfile(settings: AppSettings): ApiProfile {
	return settings.profiles.find((profile) => profile.id === settings.activeProfileId) ?? settings.profiles[0];
}

export function getTaskReuseProfile(settings: AppSettings, task: ReusableTaskProfileSnapshot): ApiProfile | null {
	if (!settings.reuseTaskApiProfileTemporarily) return null;
	const byId = task.apiProfileId ? settings.profiles.find((profile) => profile.id === task.apiProfileId) : null;
	if (byId) return byId;
	return (
		settings.profiles.find(
			(profile) =>
				profile.provider === task.apiProvider &&
				profile.apiMode === task.apiMode &&
				profile.model === task.model
		) ?? null
	);
}

export function getProfileRequestBlockReason(profile: ApiProfile, settings?: AppSettings): string | null {
	if (!isKnownProvider(profile.provider, settings)) return '当前服务商没有可用的生成请求配置';
	return null;
}

export function addApiProfile(
	settings: AppSettings,
	provider: ApiProvider = 'openai',
	createId: () => string = () => createProfileId(provider)
): AppSettings {
	const customProvider = getCustomProviderDefinition(settings, provider);
	const profile = createDefaultProfile(provider, createUniqueProfileId(settings.profiles, createId), customProvider);
	return normalizeSettings({
		...settings,
		profiles: [...settings.profiles, profile],
		activeProfileId: profile.id
	});
}

export function addOpenAIProfile(settings: AppSettings, createId: () => string = createProfileId): AppSettings {
	return addApiProfile(settings, 'openai', createId);
}

export function duplicateProfile(settings: AppSettings, profileId: string, createId: () => string = createProfileId): AppSettings {
	const source = settings.profiles.find((profile) => profile.id === profileId) ?? getActiveProfile(settings);
	const profile: ApiProfile = {
		...source,
		id: createUniqueProfileId(settings.profiles, createId),
		name: `${source.name}（复制）`
	};
	return normalizeSettings({
		...settings,
		profiles: [...settings.profiles, profile],
		activeProfileId: profile.id
	});
}

export function removeProfile(settings: AppSettings, profileId: string): AppSettings {
	if (settings.profiles.length <= 1) return normalizeSettings(settings);
	const profiles = settings.profiles.filter((profile) => profile.id !== profileId);
	if (!profiles.length) return normalizeSettings(settings);
	return {
		...settings,
		profiles,
		activeProfileId: settings.activeProfileId === profileId ? profiles[0]?.id : settings.activeProfileId
	};
}

export function switchApiProfileProvider(
	profile: ApiProfile,
	provider: ApiProvider,
	customProvider?: CustomProviderDefinition | null
): ApiProfile {
	const providerDrafts = {
		...profile.providerDrafts,
		[profile.provider]: {
			baseUrl: profile.baseUrl,
			model: profile.model,
			apiMode: profile.apiMode,
			codexCli: profile.codexCli,
			responseFormatB64Json: profile.responseFormatB64Json,
			streamImages: profile.streamImages,
			streamPartialImages: profile.streamPartialImages
		}
	};
	const savedDraft = providerDrafts[provider];
	const defaultProfile = createDefaultProfile(provider, profile.id, customProvider);

	return {
		...profile,
		provider: defaultProfile.provider,
		baseUrl: savedDraft?.baseUrl ?? defaultProfile.baseUrl,
		model: savedDraft?.model ?? defaultProfile.model,
		apiMode: savedDraft?.apiMode ?? defaultProfile.apiMode,
		codexCli: savedDraft?.codexCli ?? defaultProfile.codexCli,
		responseFormatB64Json: savedDraft?.responseFormatB64Json ?? defaultProfile.responseFormatB64Json,
		streamImages: savedDraft?.streamImages ?? defaultProfile.streamImages,
		streamPartialImages: savedDraft?.streamPartialImages ?? defaultProfile.streamPartialImages,
		providerDrafts
	};
}

export function removeCustomProvider(settings: AppSettings, providerId: string): AppSettings {
	const customProviders = settings.customProviders.filter((provider) => provider.id !== providerId);
	const profiles = settings.profiles.map((profile) =>
		profile.provider === providerId ? switchApiProfileProvider(profile, 'openai') : profile
	);
	return normalizeSettings({
		...settings,
		customProviders,
		profiles
	});
}

export function serializeSettingsForExport(settings: AppSettings, includeApiKeys: boolean): AppSettings {
	const normalized = normalizeSettings(settings);
	return {
		...normalized,
		profiles: normalized.profiles.map((profile) => ({
			...profile,
			apiKey: includeApiKeys ? profile.apiKey : ''
		}))
	};
}

export function buildExportedSettings(settings: AppSettings, includeApiKeys: boolean): ExportedSettings {
	return {
		version: 1,
		settings: serializeSettingsForExport(settings, includeApiKeys)
	};
}

export function parseImportedSettings(text: string): AppSettings {
	const parsed = JSON.parse(text) as unknown;
	if (isRecord(parsed) && isRecord(parsed.settings)) return normalizeSettings(parsed.settings);
	return normalizeSettings(parsed);
}

export function getCustomProviderDefinition(settings: AppSettings | Partial<AppSettings> | unknown, provider: ApiProvider): CustomProviderDefinition | null {
	if (provider === 'openai') return null;
	if (!isRecord(settings)) return null;
	const providers = normalizeCustomProviderDefinitions(settings.customProviders);
	return providers.find((item) => item.id === provider) ?? null;
}

export function getApiProviderLabel(settings: AppSettings | Partial<AppSettings> | unknown, provider: ApiProvider): string {
	if (provider === 'openai') return 'OpenAI Compatible';
	return getCustomProviderDefinition(settings, provider)?.name ?? provider;
}

export function importCustomProviderDefinitionFromJson(jsonText: string, existingProviders: CustomProviderDefinition[] = []): CustomProviderDefinition {
	let parsed: unknown;
	try {
		parsed = JSON.parse(stripMarkdownCodeFence(jsonText));
	} catch {
		throw new Error('JSON 格式无效');
	}
	const usedIds = new Set(existingProviders.map((provider) => provider.id));
	const provider = normalizeCustomProviderDefinition(parsed, usedIds);
	if (!provider) throw new Error('无法识别该 JSON。请粘贴自定义服务商配置。');
	return provider;
}

export function normalizeTimeoutSecs(value: number): number {
	return Math.min(1800, Math.max(10, Math.trunc(value)));
}

export function normalizeStreamPartialImages(value: unknown): number {
	const numeric = typeof value === 'number' ? value : Number(value);
	return Number.isFinite(numeric) ? Math.min(3, Math.max(0, Math.trunc(numeric))) : DEFAULT_STREAM_PARTIAL_IMAGES;
}

export function normalizeAgentMaxToolRounds(value: unknown): number {
	const numeric = typeof value === 'number' ? value : Number(value);
	return Number.isFinite(numeric) ? Math.min(50, Math.max(1, Math.trunc(numeric))) : DEFAULT_AGENT_MAX_TOOL_ROUNDS;
}

export function normalizeZipDownloadRoutes(value: unknown): ZipDownloadRoute[] {
	const allowed: ZipDownloadRoute[] = [
		'task-card',
		'task-detail-all',
		'task-selection',
		'lightbox',
		'favorite-collection-selection',
		'agent-round-all'
	];
	if (!Array.isArray(value)) return [...DEFAULT_ZIP_DOWNLOAD_ROUTES];
	const result = value.filter((item): item is ZipDownloadRoute => allowed.includes(item as ZipDownloadRoute));
	return [...new Set(result)];
}

function normalizeProfile(value: unknown, customProviderIds = new Set<string>()): ApiProfile | null {
	if (!isRecord(value)) return null;
	const rawProvider = typeof value.provider === 'string' ? value.provider.trim() : 'openai';
	const provider: ApiProvider = rawProvider === 'openai' || customProviderIds.has(rawProvider) ? rawProvider : 'openai';
	const wasRemovedProvider = provider !== rawProvider;
	const apiMode = wasRemovedProvider ? 'images' : value.apiMode === 'responses' ? 'responses' : 'images';
	const defaultProfile = createDefaultProfile(provider, DEFAULT_PROFILE_ID);
	const defaultModel = apiMode === 'responses' ? DEFAULT_RESPONSES_MODEL : defaultProfile.model;
	const rawModel = getString(value.model, defaultModel);
	const model = wasRemovedProvider || isLegacyDefaultModel(apiMode, rawModel) ? defaultModel : rawModel;
	const rawBaseUrl = wasRemovedProvider ? defaultProfile.baseUrl : getString(value.baseUrl, defaultProfile.baseUrl);

	return {
		id: getString(value.id, DEFAULT_PROFILE_ID),
		name: wasRemovedProvider ? 'OpenAI' : getString(value.name, 'OpenAI'),
		provider,
		baseUrl: rawBaseUrl,
		apiKey: wasRemovedProvider ? '' : getString(value.apiKey, ''),
		model,
		timeoutSecs: normalizeTimeoutSecs(getNumber(value.timeoutSecs, DEFAULT_API_TIMEOUT_SECS)),
		apiMode,
		codexCli: provider === 'openai' ? getBoolean(value.codexCli, false) : false,
		responseFormatB64Json: wasRemovedProvider ? false : getBoolean(value.responseFormatB64Json, false),
		streamImages: provider === 'openai' && !wasRemovedProvider ? getBoolean(value.streamImages, false) : false,
		streamPartialImages: normalizeStreamPartialImages(value.streamPartialImages),
		providerDrafts: normalizeProviderDrafts(value.providerDrafts, customProviderIds)
	};
}

function createDefaultProfile(provider: ApiProvider, id: string, customProvider?: CustomProviderDefinition | null): ApiProfile {
	if (customProvider) {
		return {
			...DEFAULT_SETTINGS.profiles[0],
			id,
			name: '新配置',
			provider: customProvider.id,
			apiMode: 'images',
			codexCli: false,
			responseFormatB64Json: false,
			streamImages: false
		};
	}
	return {
		...DEFAULT_SETTINGS.profiles[0],
		id,
		name: '新配置',
		provider: 'openai',
		baseUrl: DEFAULT_SETTINGS.profiles[0].baseUrl,
		model: DEFAULT_IMAGES_MODEL
	};
}

function isLegacyDefaultModel(apiMode: ApiMode, model: string): boolean {
	return apiMode === 'responses' && LEGACY_DEFAULT_RESPONSES_MODELS.has(model.trim());
}

function dedupeProfiles(profiles: ApiProfile[]): ApiProfile[] {
	const used = new Set<string>();
	return profiles.map((profile, index) => {
		let id = profile.id.trim() || `${DEFAULT_PROFILE_ID}-${index + 1}`;
		while (used.has(id)) id = `${id}-${index + 1}`;
		used.add(id);
		return { ...profile, id };
	});
}

function createProfileId(provider: ApiProvider = 'openai'): string {
	const prefix = provider === 'openai' ? 'openai' : 'custom';
	if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return `${prefix}-${crypto.randomUUID()}`;
	return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function createUniqueProfileId(existingProfiles: ApiProfile[], createId: () => string): string {
	const used = new Set(existingProfiles.map((profile) => profile.id));
	let id = createId().trim();
	let index = 2;
	while (!id || used.has(id)) {
		id = `${createId().trim() || DEFAULT_PROFILE_ID}-${index}`;
		index += 1;
	}
	return id;
}

function normalizeReferenceImageEditAction(value: unknown): ReferenceImageEditAction {
	if (value === 'replace-reference' || value === 'add-mask') return value;
	return 'ask';
}

function normalizeCustomProviderDefinitions(input: unknown): CustomProviderDefinition[] {
	const usedIds = new Set<string>();
	const providers = Array.isArray(input)
		? input
				.map((item) => normalizeCustomProviderDefinition(item, usedIds))
				.filter((item): item is CustomProviderDefinition => item != null)
		: [];
	return providers;
}

function normalizeCustomProviderDefinition(input: unknown, usedIds = new Set<string>()): CustomProviderDefinition | null {
	if (!isRecord(input)) return null;
	const template = input.template == null || input.template === 'http-image' ? 'http-image' : null;
	if (!template || !isRecord(input.submit)) return null;
	const rawName = getString(input.name, '自定义服务商');
	const rawId = typeof input.id === 'string' ? input.id.trim() : '';
	const id = rawId && !isBuiltInProvider(rawId) && !usedIds.has(rawId) ? rawId : createCustomProviderId(rawName, usedIds);
	usedIds.add(id);
	return {
		id,
		name: rawName,
		template,
		submit: normalizeSubmitMapping(input.submit, {
			path: 'images/generations',
			method: 'POST',
			contentType: 'json',
			body: DEFAULT_GENERATE_BODY,
			result: DEFAULT_OPENAI_RESULT
		}),
		editSubmit: isRecord(input.editSubmit)
			? normalizeSubmitMapping(input.editSubmit, {
					path: 'images/edits',
					method: 'POST',
					contentType: 'multipart',
					body: DEFAULT_GENERATE_BODY,
					files: DEFAULT_EDIT_FILES,
					result: DEFAULT_OPENAI_RESULT
				})
			: undefined,
		poll: normalizePollMapping(input.poll)
	};
}

const DEFAULT_GENERATE_BODY: Record<string, unknown> = {
	model: '$profile.model',
	prompt: '$prompt',
	size: '$params.size',
	quality: '$params.quality',
	output_format: '$params.output_format',
	moderation: '$params.moderation',
	output_compression: '$params.output_compression',
	n: '$params.n'
};

const DEFAULT_OPENAI_RESULT: CustomProviderResultMapping = {
	imageUrlPaths: ['data.*.url'],
	b64JsonPaths: ['data.*.b64_json']
};

const DEFAULT_EDIT_FILES: CustomProviderFileMapping[] = [
	{ field: 'image[]', source: 'inputImages', array: true },
	{ field: 'mask', source: 'mask' }
];

function normalizeSubmitMapping(input: unknown, fallback: CustomProviderSubmitMapping): CustomProviderSubmitMapping {
	const record = isRecord(input) ? input : {};
	const contentType = record.contentType === 'multipart' ? 'multipart' : fallback.contentType ?? 'json';
	return {
		path: normalizeProviderPath(record.path, fallback.path),
		method: record.method === 'GET' || record.method === 'POST' ? record.method : fallback.method ?? 'POST',
		contentType,
		query: normalizeStringRecord(record.query) ?? fallback.query,
		body: isRecord(record.body) ? record.body : fallback.body,
		files: contentType === 'multipart' ? normalizeFileMappings(record.files, fallback.files) : undefined,
		taskIdPath: typeof record.taskIdPath === 'string' && record.taskIdPath.trim() ? record.taskIdPath.trim() : fallback.taskIdPath,
		result: normalizeResultMapping(record.result, fallback.result ?? DEFAULT_OPENAI_RESULT)
	};
}

function normalizePollMapping(input: unknown): CustomProviderPollMapping | undefined {
	if (!isRecord(input)) return undefined;
	const statusPath = typeof input.statusPath === 'string' && input.statusPath.trim() ? input.statusPath.trim() : '';
	if (!statusPath) return undefined;
	return {
		path: normalizeProviderPath(input.path, 'images/tasks/{task_id}'),
		method: input.method === 'POST' ? 'POST' : 'GET',
		query: normalizeStringRecord(input.query),
		intervalSeconds:
			typeof input.intervalSeconds === 'number' && Number.isFinite(input.intervalSeconds)
				? Math.max(1, Math.trunc(input.intervalSeconds))
				: 5,
		statusPath,
		successValues: normalizeStringArray(input.successValues, ['SUCCESS', 'succeeded', 'completed', 'COMPLETED']),
		failureValues: normalizeStringArray(input.failureValues, ['FAILURE', 'failed', 'error', 'FAILED', 'cancelled']),
		errorPath: typeof input.errorPath === 'string' && input.errorPath.trim() ? input.errorPath.trim() : undefined,
		result: normalizeResultMapping(input.result, DEFAULT_OPENAI_RESULT)
	};
}

function normalizeResultMapping(input: unknown, fallback: CustomProviderResultMapping): CustomProviderResultMapping {
	const record = isRecord(input) ? input : {};
	return {
		imageUrlPaths: normalizeStringArray(record.imageUrlPaths, fallback.imageUrlPaths ?? []),
		b64JsonPaths: normalizeStringArray(record.b64JsonPaths, fallback.b64JsonPaths ?? [])
	};
}

function normalizeFileMappings(input: unknown, fallback: CustomProviderFileMapping[] = []): CustomProviderFileMapping[] {
	if (!Array.isArray(input)) return fallback;
	const files = input
		.map((item): CustomProviderFileMapping | null => {
			if (!isRecord(item)) return null;
			const field = getString(item.field, '');
			if (!field) return null;
			if (item.source !== 'inputImages' && item.source !== 'mask') return null;
			return { field, source: item.source, array: getBoolean(item.array, false) };
		})
		.filter((item): item is CustomProviderFileMapping => item != null);
	return files.length ? files : fallback;
}

function normalizeProviderDrafts(input: unknown, customProviderIds: Set<string>): ApiProfile['providerDrafts'] {
	if (!isRecord(input)) return undefined;
	const entries = Object.entries(input)
		.filter(([provider]) => provider === 'openai' || customProviderIds.has(provider))
		.map(([provider, draft]) => [provider, normalizeProviderDraft(draft)] as const)
		.filter((entry): entry is [string, NonNullable<ReturnType<typeof normalizeProviderDraft>>] => Boolean(entry[1]));
	return entries.length ? Object.fromEntries(entries) : undefined;
}

function normalizeProviderDraft(input: unknown) {
	if (!isRecord(input)) return undefined;
	const apiMode: ApiMode | undefined = input.apiMode === 'responses' || input.apiMode === 'images' ? input.apiMode : undefined;
	return {
		baseUrl: typeof input.baseUrl === 'string' ? input.baseUrl : undefined,
		model: typeof input.model === 'string' ? input.model : undefined,
		apiMode,
		codexCli: typeof input.codexCli === 'boolean' ? input.codexCli : undefined,
		responseFormatB64Json: typeof input.responseFormatB64Json === 'boolean' ? input.responseFormatB64Json : undefined,
		streamImages: typeof input.streamImages === 'boolean' ? input.streamImages : undefined,
		streamPartialImages: normalizeStreamPartialImages(input.streamPartialImages)
	};
}

function normalizeStringRecord(input: unknown): Record<string, string> | undefined {
	if (!isRecord(input)) return undefined;
	const entries = Object.entries(input)
		.filter((entry): entry is [string, string | number | boolean] =>
			typeof entry[0] === 'string' && ['string', 'number', 'boolean'].includes(typeof entry[1])
		)
		.map(([key, value]) => [key, String(value)] as const);
	return entries.length ? Object.fromEntries(entries) : undefined;
}

function normalizeStringArray(input: unknown, fallback: string[]): string[] {
	if (!Array.isArray(input)) return fallback;
	const items = input.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim());
	return items.length ? items : fallback;
}

function normalizeProviderPath(input: unknown, fallback: string): string {
	const value = getString(input, fallback);
	return value.replace(/^\/+/, '').replace(/^v1\//, '');
}

function createCustomProviderId(name: string, usedIds: Set<string>): string {
	const slug = name
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '') || 'provider';
	let id = `custom-${slug}`;
	let index = 2;
	while (usedIds.has(id) || isBuiltInProvider(id)) {
		id = `custom-${slug}-${index}`;
		index += 1;
	}
	return id;
}

function stripMarkdownCodeFence(text: string): string {
	const trimmed = text.trim();
	const match = trimmed.match(/^```[^\r\n]*\r?\n([\s\S]*?)\r?\n```$/);
	return match ? match[1].trim() : trimmed;
}

function isBuiltInProvider(provider: string): provider is BuiltInApiProvider {
	return provider === 'openai';
}

function isKnownProvider(provider: ApiProvider, settings?: AppSettings): boolean {
	if (provider === 'openai') return true;
	return Boolean(settings?.customProviders.some((item) => item.id === provider));
}

function normalizeFavoriteCollectionSettings(value: unknown): FavoriteCollectionSetting[] {
	const collections = Array.isArray(value)
		? value.map(normalizeFavoriteCollectionSetting).filter((item): item is FavoriteCollectionSetting => item != null)
		: [];
	const hasDefault = collections.some((collection) => collection.id === DEFAULT_FAVORITE_COLLECTION_ID);
	return hasDefault ? dedupeFavoriteCollections(collections) : [DEFAULT_SETTINGS.favoriteCollections[0], ...dedupeFavoriteCollections(collections)];
}

function normalizeFavoriteCollectionSetting(value: unknown): FavoriteCollectionSetting | null {
	if (!isRecord(value)) return null;
	const id = getString(value.id, '');
	const name = getString(value.name, '');
	if (!id || !name) return null;
	const createdAt = getNumber(value.createdAt, 0);
	const updatedAt = getNumber(value.updatedAt, createdAt);
	return { id, name, createdAt, updatedAt };
}

function dedupeFavoriteCollections(collections: FavoriteCollectionSetting[]): FavoriteCollectionSetting[] {
	const seen = new Set<string>();
	const result: FavoriteCollectionSetting[] = [];
	for (const collection of collections) {
		if (seen.has(collection.id)) continue;
		seen.add(collection.id);
		result.push(collection);
	}
	return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getString(value: unknown, fallback: string): string {
	return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function getNumber(value: unknown, fallback: number): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function getBoolean(value: unknown, fallback: boolean): boolean {
	return typeof value === 'boolean' ? value : fallback;
}

function getNullableString(value: unknown): string | null {
	return typeof value === 'string' && value.trim() ? value.trim() : null;
}
