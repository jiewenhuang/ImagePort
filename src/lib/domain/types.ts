export type ApiMode = 'images' | 'responses';
export type OutputImageCount = number | 'auto';

export interface TaskParams {
	size: string;
	quality: 'auto' | 'low' | 'medium' | 'high';
	output_format: 'png' | 'jpeg' | 'webp';
	output_compression: number | null;
	moderation: 'auto' | 'low';
	n: OutputImageCount;
}

export interface InputImage {
	id: string;
	name: string;
	dataUrl: string;
}

export interface MaskDraft {
	targetImageId: string;
	dataUrl: string;
	updatedAt: number;
}

export interface ImageGenerationRequestInput {
	baseUrl: string;
	apiKey: string;
	model: string;
	timeoutSecs: number;
	responseFormatB64Json: boolean;
	streamImages?: boolean;
	streamPartialImages?: number;
	prompt: string;
	params: TaskParams;
}

export interface ImageEditRequestInput extends ImageGenerationRequestInput {
	inputImages: InputImage[];
	mask: MaskDraft | null;
}

export interface NativeJsonRequest {
	requestId?: string;
	url: string;
	method: 'GET' | 'POST';
	headers: Record<string, string>;
	body?: Record<string, unknown>;
	timeoutSecs: number;
}

export interface NativeJsonResponse {
	status: number;
	headers: Record<string, string>;
	body: unknown;
}

export interface NativeStreamRequest extends NativeJsonRequest {
	requestId: string;
}

export interface NativeMultipartFile {
	field: string;
	fileName: string;
	mime: string;
	dataUrl: string;
}

export interface NativeMultipartRequest {
	requestId?: string;
	url: string;
	method: 'POST';
	headers: Record<string, string>;
	fields: Record<string, string>;
	files: NativeMultipartFile[];
	timeoutSecs: number;
}

export interface NativeMultipartStreamRequest extends NativeMultipartRequest {
	requestId: string;
}

export interface CallApiResult {
	images: string[];
	revisedPrompts?: Array<string | undefined>;
	rawImageUrls?: string[];
	actualParams?: Partial<TaskParams>;
	actualParamsList?: Array<Partial<TaskParams> | undefined>;
	rawResponsePayload?: string;
	streamPartialImages?: string[];
}

export interface TaskRecord {
	id: string;
	prompt: string;
	params: TaskParams;
	inputImages: InputImage[];
	mask: MaskDraft | null;
	images: string[];
	thumbnailImages?: string[];
	status: 'running' | 'done' | 'partial' | 'error';
	error: string | null;
	createdAt: number;
	finishedAt: number | null;
	failureCount: number;
	isFavorite?: boolean;
	favoriteCollectionIds: string[];
	actualParams: Partial<TaskParams> | null;
	actualParamsByImage: Record<string, Partial<TaskParams>>;
	revisedPromptByImage: Record<string, string>;
	apiProfileId?: string | null;
	apiProfileName?: string | null;
	apiProvider?: string | null;
	apiMode?: ApiMode | null;
	model?: string | null;
	rawImageUrls: string[];
	rawResponsePayload?: string | null;
	streamPartialImageIds: string[];
	sourceMode?: 'gallery' | 'agent' | null;
	agentConversationId?: string | null;
	agentRoundId?: string | null;
	agentMessageId?: string | null;
	agentToolCallId?: string | null;
	agentToolAction?: 'generate' | 'edit' | 'auto' | string | null;
}

export const DEFAULT_PARAMS: TaskParams = {
	size: 'auto',
	quality: 'auto',
	output_format: 'png',
	output_compression: null,
	moderation: 'auto',
	n: 1
};

export function normalizeOutputImageCount(value: unknown): OutputImageCount;
export function normalizeOutputImageCount(value: unknown, fallback: OutputImageCount): OutputImageCount;
export function normalizeOutputImageCount(value: unknown, fallback: null): OutputImageCount | null;
export function normalizeOutputImageCount(value: unknown, fallback: OutputImageCount | null = DEFAULT_PARAMS.n): OutputImageCount | null {
	if (value === 'auto') return 'auto';
	if (typeof value === 'number' && Number.isFinite(value)) return Math.max(1, Math.trunc(value));
	return fallback;
}

export function getConcreteOutputImageCount(value: OutputImageCount, fallback = 1): number {
	return typeof value === 'number' && Number.isFinite(value) ? Math.max(1, Math.trunc(value)) : fallback;
}

export function getMissingOutputImageCount(expected: OutputImageCount, actualCount: number): number {
	if (expected === 'auto') return actualCount > 0 ? 0 : 1;
	return Math.max(0, getConcreteOutputImageCount(expected) - actualCount);
}

export function createEmptyTaskMetadata(): Pick<
	TaskRecord,
	| 'actualParams'
	| 'actualParamsByImage'
	| 'revisedPromptByImage'
	| 'apiProfileId'
	| 'apiProfileName'
	| 'apiProvider'
	| 'apiMode'
	| 'model'
	| 'rawImageUrls'
	| 'rawResponsePayload'
	| 'streamPartialImageIds'
	| 'favoriteCollectionIds'
> {
	return {
		actualParams: null,
		actualParamsByImage: {},
		revisedPromptByImage: {},
		apiProfileId: null,
		apiProfileName: null,
		apiProvider: null,
		apiMode: null,
		model: null,
		rawImageUrls: [],
		rawResponsePayload: null,
		streamPartialImageIds: [],
		favoriteCollectionIds: []
	};
}
