import {
	buildImagesEditRequests,
	buildImagesGenerationRequests,
	parseImagesGenerationResponse
} from './openai-compatible';
import {
	normalizeOutputImageCount,
	type CallApiResult,
	type ImageEditRequestInput,
	type ImageGenerationRequestInput,
	type InputImage,
	type MaskDraft,
	type NativeJsonRequest,
	type NativeMultipartRequest,
	type TaskParams
} from '$lib/domain/types';
import {
	type ApiProfile,
	type AppSettings,
	type CustomProviderDefinition,
	type CustomProviderPollMapping,
	type CustomProviderResultMapping,
	type CustomProviderSubmitMapping
} from '$lib/domain/settings';
import { buildApiUrl } from '$lib/domain/url';

const MIME_MAP: Record<string, string> = {
	png: 'image/png',
	jpeg: 'image/jpeg',
	webp: 'image/webp'
};

export type ProviderNativeRequest =
	| {
			kind: 'json';
			request: NativeJsonRequest;
			parse: (payload: unknown) => CallApiResult;
			customAsync?: {
				submit: CustomProviderSubmitMapping;
				poll: CustomProviderPollMapping;
			};
	  }
	| {
			kind: 'multipart';
			request: NativeMultipartRequest;
			parse: (payload: unknown) => CallApiResult;
			customAsync?: {
				submit: CustomProviderSubmitMapping;
				poll: CustomProviderPollMapping;
			};
	  };

export interface ProviderRequestGroup {
	provider: string;
	requests: ProviderNativeRequest[];
}

export interface BuildProviderRequestGroupInput {
	settings: AppSettings;
	profile: ApiProfile;
	prompt: string;
	params: TaskParams;
	inputImages: InputImage[];
	mask: MaskDraft | null;
}

export function buildImageProviderRequestGroup(input: BuildProviderRequestGroupInput): ProviderRequestGroup {
	const customProvider = getCustomProvider(input.settings, input.profile.provider);
	if (customProvider) return buildCustomProviderRequestGroup(input, customProvider);

	return buildOpenAIRequestGroup(input);
}

function buildOpenAIRequestGroup(input: BuildProviderRequestGroupInput): ProviderRequestGroup {
	if (input.profile.apiMode === 'responses') {
		return {
			provider: 'openai',
			requests: [
				{
					kind: 'json',
					request: buildResponsesImageRequest(input),
					parse: (payload) => parseResponsesImageResponse(payload, input.params.output_format)
				}
			]
		};
	}
	const requestInput: ImageGenerationRequestInput = {
		baseUrl: input.profile.baseUrl,
		apiKey: input.profile.apiKey,
		model: input.profile.model,
		timeoutSecs: input.profile.timeoutSecs,
		responseFormatB64Json: input.profile.responseFormatB64Json,
		streamImages: input.profile.streamImages,
		streamPartialImages: input.profile.streamPartialImages,
		prompt: input.prompt,
		params: input.params
	};
	const requests = input.inputImages.length
		? buildImagesEditRequests({
				...requestInput,
				inputImages: input.mask ? orderImagesForMask(input.inputImages, input.mask.targetImageId) : input.inputImages,
				mask: input.mask
			} satisfies ImageEditRequestInput).map(
				(request): ProviderNativeRequest => ({
					kind: 'multipart',
					request,
					parse: (payload) => parseImagesGenerationResponse(payload, input.params.output_format)
				})
			)
		: buildImagesGenerationRequests(requestInput).map(
				(request): ProviderNativeRequest => ({
					kind: 'json',
					request,
					parse: (payload) => parseImagesGenerationResponse(payload, input.params.output_format)
				})
			);

	return {
		provider: 'openai',
		requests
	};
}

export function buildResponsesImageRequest(input: BuildProviderRequestGroupInput): NativeJsonRequest {
	const isEdit = input.inputImages.length > 0;
	const tool: Record<string, unknown> = {
		type: 'image_generation',
		action: isEdit ? 'edit' : 'generate',
		size: input.params.size,
		quality: input.params.quality,
		output_format: input.params.output_format,
		moderation: input.params.moderation
	};
	if (input.params.output_format !== 'png' && input.params.output_compression != null) {
		tool.output_compression = input.params.output_compression;
	}
	if (input.mask) {
		tool.input_image_mask = { image_url: input.mask.dataUrl };
	}
	if (input.profile.streamImages) {
		tool.partial_images = input.profile.streamPartialImages;
	}
	const body: Record<string, unknown> = {
		model: input.profile.model,
		input: createResponsesInput(input.prompt, input.inputImages),
		tools: [tool]
	};
	if (input.profile.streamImages) body.stream = true;

	return {
		url: buildApiUrl(input.profile.baseUrl, 'responses'),
		method: 'POST',
		headers: {
			Authorization: `Bearer ${input.profile.apiKey}`,
			'Content-Type': 'application/json'
		},
		body,
		timeoutSecs: input.profile.timeoutSecs
	};
}

function createResponsesInput(prompt: string, inputImages: InputImage[]): unknown {
	if (!inputImages.length) return prompt;
	return [
		{
			role: 'user',
			content: [
				{ type: 'input_text', text: prompt },
				...inputImages.map((image) => ({
					type: 'input_image',
					image_url: image.dataUrl
				}))
			]
		}
	];
}

export interface ParsedImageStreamEvents {
	partialImages: string[];
	result: CallApiResult;
}

export function parseResponsesImageResponse(
	payload: unknown,
	outputFormat: TaskParams['output_format']
): CallApiResult {
	const output = isRecord(payload) && Array.isArray(payload.output) ? payload.output : [];
	const mime = MIME_MAP[outputFormat] ?? 'image/png';
	const images: string[] = [];
	const revisedPrompts: Array<string | undefined> = [];
	const actualParamsList: Array<Partial<TaskParams> | undefined> = [];
	for (const item of output) {
		if (!isRecord(item) || item.type !== 'image_generation_call') continue;
		const b64 = readResponsesImageResultBase64(item.result);
		if (!b64) continue;
		images.push(normalizeBase64Image(b64, mime));
		revisedPrompts.push(getStringValue(item, 'revised_prompt'));
		actualParamsList.push(pickActualParamsFromRecord(item));
	}
	if (!images.length) {
		throw new Error('Responses API 没有返回可识别的图片数据');
	}
	return {
		images,
		revisedPrompts,
		actualParams: actualParamsList.find((item) => item && Object.keys(item).length > 0),
		actualParamsList,
		rawResponsePayload: safeStringify(payload)
	};
}

function readResponsesImageResultBase64(result: unknown): string | undefined {
	if (typeof result === 'string' && result.trim()) return result;
	if (!isRecord(result)) return undefined;
	for (const key of ['b64_json', 'base64', 'image', 'data']) {
		const value = result[key];
		if (typeof value === 'string' && value.trim()) return value;
	}
	return undefined;
}

export function parseImageStreamEvents(
	events: Array<Record<string, unknown>>,
	outputFormat: TaskParams['output_format']
): ParsedImageStreamEvents {
	const mime = MIME_MAP[outputFormat] ?? 'image/png';
	const partialImages: string[] = [];
	const completedItems: Array<Record<string, unknown>> = [];
	const responseOutputItems: Array<Record<string, unknown>> = [];
	let resultPayload: unknown = null;

	for (const event of events) {
		const type = getStringValue(event, 'type');
		const object = getStringValue(event, 'object');
		if (
			type === 'image_generation.partial_image' ||
			type === 'image_edit.partial_image' ||
			object === 'image.generation.partial_image' ||
			object === 'image.edit.partial_image'
		) {
			const b64 = getStringValue(event, 'b64_json');
			if (b64) partialImages.push(normalizeBase64Image(b64, mime));
			continue;
		}
		if (type === 'response.image_generation_call.partial_image') {
			const b64 = getStringValue(event, 'partial_image_b64');
			if (b64) partialImages.push(normalizeBase64Image(b64, mime));
			continue;
		}
		if (type === 'response.output_item.done' && isRecord(event.item)) {
			responseOutputItems.push(event.item);
			continue;
		}
		if (isRecord(event.response) && Array.isArray(event.response.output)) {
			resultPayload = event.response;
			continue;
		}
		if (object === 'image.generation.result' || object === 'image.edit.result') {
			resultPayload = event;
			continue;
		}
		if (type === 'image_generation.completed' || type === 'image_edit.completed') {
			completedItems.push(event);
		}
	}

	const result = resultPayload
		? parseStreamResultPayload(resultPayload, outputFormat)
		: responseOutputItems.length
			? parseResponsesImageResponse({ output: responseOutputItems }, outputFormat)
			: parseCompletedStreamItems(completedItems, outputFormat);
	return { partialImages, result };
}

function parseStreamResultPayload(payload: unknown, outputFormat: TaskParams['output_format']): CallApiResult {
	if (isRecord(payload) && Array.isArray(payload.output)) return parseResponsesImageResponse(payload, outputFormat);
	return parseImagesGenerationResponse(payload, outputFormat);
}

function parseCompletedStreamItems(
	items: Array<Record<string, unknown>>,
	outputFormat: TaskParams['output_format']
): CallApiResult {
	if (!items.length) throw new Error('流式接口未返回最终图片数据');
	const mime = MIME_MAP[outputFormat] ?? 'image/png';
	const images = items
		.map((item) => getStringValue(item, 'b64_json'))
		.filter((item): item is string => Boolean(item))
		.map((b64) => normalizeBase64Image(b64, mime));
	if (!images.length) throw new Error('流式接口未返回可用图片数据');
	const actualParamsList = items.map(pickActualParamsFromRecord);
	return {
		images,
		revisedPrompts: items.map((item) => getStringValue(item, 'revised_prompt')),
		actualParams: actualParamsList.find((item) => item && Object.keys(item).length > 0),
		actualParamsList,
		rawResponsePayload: safeStringify({ events: items })
	};
}

export function buildCustomProviderRequestGroup(
	input: BuildProviderRequestGroupInput,
	customProvider = getCustomProvider(input.settings, input.profile.provider)
): ProviderRequestGroup {
	if (!customProvider) throw new Error('自定义服务商配置不存在');
	const isEdit = input.inputImages.length > 0;
	const mapping = isEdit ? customProvider.editSubmit : customProvider.submit;
	if (!mapping) throw new Error('当前自定义服务商未配置图像编辑接口');
	const request = buildCustomProviderRequest(mapping, input);
	return {
		provider: customProvider.id,
		requests: [
			{
				kind: request.kind,
				request: request.request as NativeJsonRequest & NativeMultipartRequest,
				parse: (payload) => parseCustomProviderResponse(payload, mapping.result ?? {}, input.params.output_format),
				customAsync:
					mapping.taskIdPath && customProvider.poll ? { submit: mapping, poll: customProvider.poll } : undefined
			} as ProviderNativeRequest
		]
	};
}

export function readCustomTaskId(payload: unknown, mapping: CustomProviderSubmitMapping): string | null {
	const value = getByPath(payload, mapping.taskIdPath);
	return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function buildCustomPollRequest(
	profile: ApiProfile,
	poll: CustomProviderPollMapping,
	taskId: string
): NativeJsonRequest {
	return {
		url: buildApiUrl(profile.baseUrl, appendQuery(buildTaskPath(poll.path, taskId), poll.query)),
		method: poll.method ?? 'GET',
		headers: {
			Authorization: `Bearer ${profile.apiKey}`
		},
		timeoutSecs: profile.timeoutSecs
	};
}

export function getCustomPollState(
	payload: unknown,
	poll: CustomProviderPollMapping
): 'success' | 'failure' | 'pending' {
	const status = getByPath(payload, poll.statusPath);
	const statusText = typeof status === 'string' ? status : String(status ?? '');
	if (poll.successValues.includes(statusText)) return 'success';
	if (poll.failureValues.includes(statusText)) return 'failure';
	return 'pending';
}

function buildCustomProviderRequest(mapping: CustomProviderSubmitMapping, input: BuildProviderRequestGroupInput) {
	const context = createCustomProviderContext(input);
	const path = appendQuery(mapping.path, renderQuery(mapping.query, context));
	const url = buildApiUrl(input.profile.baseUrl, path);
	const headers = {
		Authorization: `Bearer ${input.profile.apiKey}`
	};
	if ((mapping.contentType ?? 'json') === 'multipart') {
		return {
			kind: 'multipart' as const,
			request: {
				url,
				method: 'POST',
				headers,
				fields: createCustomFields(mapping, context, input.profile.responseFormatB64Json),
				files: createCustomFiles(mapping, input),
				timeoutSecs: input.profile.timeoutSecs
			} satisfies NativeMultipartRequest
		};
	}

	const body = resolveTemplateValue(mapping.body ?? {}, context);
	if (input.profile.responseFormatB64Json && isRecord(body)) body.response_format = 'b64_json';
	return {
		kind: 'json' as const,
		request: {
			url,
			method: mapping.method ?? 'POST',
			headers: {
				...headers,
				'Content-Type': 'application/json'
			},
			body: isRecord(body) ? body : {},
			timeoutSecs: input.profile.timeoutSecs
		} satisfies NativeJsonRequest
	};
}

export function parseCustomProviderResponse(
	payload: unknown,
	result: CustomProviderResultMapping,
	outputFormat: TaskParams['output_format']
): CallApiResult {
	const mime = MIME_MAP[outputFormat] ?? 'image/png';
	const images: string[] = [];
	const imageUrls = (result.imageUrlPaths ?? []).flatMap((path) =>
		getAllByPath(payload, path).filter(
			(value): value is string => typeof value === 'string' && (isHttpUrl(value) || isDataUrl(value))
		)
	);
	for (const path of result.b64JsonPaths ?? []) {
		for (const value of getAllByPath(payload, path)) {
			if (typeof value === 'string' && value.trim()) images.push(normalizeBase64Image(value, mime));
		}
	}
	const rawImageUrls = imageUrls.filter(isHttpUrl);
	if (!images.length && !rawImageUrls.length) {
		throw new Error('接口没有返回可识别的图片数据，请检查自定义服务商的结果提取路径。');
	}
	return {
		images,
		rawImageUrls,
		rawResponsePayload: safeStringify(payload)
	};
}

function createCustomProviderContext(input: BuildProviderRequestGroupInput) {
	return {
		profile: input.profile,
		prompt: input.prompt,
		params: input.params,
		inputImages: {
			dataUrls: input.inputImages.map((image) => image.dataUrl),
			count: input.inputImages.length
		},
		mask: {
			dataUrl: input.mask?.dataUrl
		}
	};
}

function createCustomFields(
	mapping: CustomProviderSubmitMapping,
	context: Record<string, unknown>,
	responseFormatB64Json: boolean
) {
	const resolved = resolveTemplateValue(mapping.body ?? {}, context);
	const record = isRecord(resolved) ? resolved : {};
	if (responseFormatB64Json) record.response_format = 'b64_json';
	const fields: Record<string, string> = {};
	for (const [key, value] of Object.entries(record)) {
		if (value == null) continue;
		if (Array.isArray(value)) {
			value.forEach((item) => {
				if (item != null) fields[key] = String(item);
			});
		} else {
			fields[key] = String(value);
		}
	}
	return fields;
}

function createCustomFiles(mapping: CustomProviderSubmitMapping, input: BuildProviderRequestGroupInput) {
	const files: NativeMultipartRequest['files'] = [];
	for (const file of mapping.files ?? []) {
		if (file.source === 'inputImages') {
			for (const image of input.inputImages) {
				files.push({
					field: file.field,
					fileName: image.name || `${image.id}.png`,
					mime: getDataUrlMime(image.dataUrl) ?? 'image/png',
					dataUrl: image.dataUrl
				});
			}
		}
		if (file.source === 'mask' && input.mask) {
			files.push({
				field: file.field,
				fileName: 'mask.png',
				mime: 'image/png',
				dataUrl: input.mask.dataUrl
			});
		}
	}
	return files;
}

function resolveTemplateValue(value: unknown, context: Record<string, unknown>): unknown {
	if (typeof value === 'string' && value.startsWith('$')) return getByPath(context, value.slice(1));
	if (Array.isArray(value)) {
		return value.map((item) => resolveTemplateValue(item, context)).filter((item) => item != null);
	}
	if (isRecord(value)) {
		return Object.fromEntries(
			Object.entries(value)
				.map(([key, item]) => [key, resolveTemplateValue(item, context)] as const)
				.filter(([, item]) => item != null && (!Array.isArray(item) || item.length > 0))
		);
	}
	return value;
}

function renderQuery(query: Record<string, string> | undefined, context: Record<string, unknown>) {
	if (!query) return undefined;
	return Object.fromEntries(
		Object.entries(query)
			.map(([key, value]) => [key, resolveTemplateValue(value, context)] as const)
			.filter(([, value]) => value != null && String(value).trim().length > 0)
			.map(([key, value]) => [key, String(value)] as const)
	);
}

function appendQuery(path: string, query?: Record<string, string>) {
	if (!query || !Object.keys(query).length) return path;
	const params = new URLSearchParams(query);
	return `${path}${path.includes('?') ? '&' : '?'}${params.toString()}`;
}

function buildTaskPath(path: string, taskId: string) {
	return path.replace(/\{task_id\}/g, encodeURIComponent(taskId)).replace(/\{taskId\}/g, encodeURIComponent(taskId));
}

function getCustomProvider(settings: AppSettings, provider: string): CustomProviderDefinition | null {
	return settings.customProviders.find((item) => item.id === provider) ?? null;
}

function orderImagesForMask(images: InputImage[], targetImageId: string) {
	const target = images.find((image) => image.id === targetImageId);
	if (!target) return images;
	return [target, ...images.filter((image) => image.id !== targetImageId)];
}

function pickActualParamsFromRecord(record: Record<string, unknown>): Partial<TaskParams> | undefined {
	const params: Partial<TaskParams> = {};
	const size = getStringValue(record, 'size');
	if (size) params.size = size;
	const quality = getStringValue(record, 'quality');
	if (quality === 'auto' || quality === 'low' || quality === 'medium' || quality === 'high') params.quality = quality;
	const outputFormat = getStringValue(record, 'output_format');
	if (outputFormat === 'png' || outputFormat === 'jpeg' || outputFormat === 'webp') params.output_format = outputFormat;
	const outputCompression = record.output_compression;
	if (typeof outputCompression === 'number' && Number.isFinite(outputCompression))
		params.output_compression = outputCompression;
	const moderation = getStringValue(record, 'moderation');
	if (moderation === 'auto' || moderation === 'low') params.moderation = moderation;
	const count = normalizeOutputImageCount(record.n, null);
	if (count != null) params.n = count;
	return Object.keys(params).length ? params : undefined;
}

function getByPath(source: unknown, path: string | undefined): unknown {
	if (!path) return source;
	return path
		.split('.')
		.filter(Boolean)
		.reduce<unknown>((current, key) => {
			if (current == null) return undefined;
			if (/^\d+$/.test(key) && Array.isArray(current)) return current[Number(key)];
			if (isRecord(current)) return current[key];
			return undefined;
		}, source);
}

function getAllByPath(source: unknown, path: string | undefined): unknown[] {
	if (!path) return [source];
	let current: unknown[] = [source];
	for (const key of path.split('.').filter(Boolean)) {
		const next: unknown[] = [];
		for (const item of current) {
			if (item == null) continue;
			if (key === '*') {
				if (Array.isArray(item)) next.push(...item);
				else if (isRecord(item)) next.push(...Object.values(item));
				continue;
			}
			if (/^\d+$/.test(key) && Array.isArray(item)) {
				next.push(item[Number(key)]);
				continue;
			}
			if (isRecord(item)) next.push(item[key]);
		}
		current = next;
	}
	return current.flatMap((item) => (Array.isArray(item) ? item : [item])).filter((item) => item != null);
}

function normalizeBase64Image(value: string, fallbackMime: string): string {
	return value.startsWith('data:') ? value : `data:${fallbackMime};base64,${value}`;
}

function getDataUrlMime(dataUrl: string) {
	const match = dataUrl.match(/^data:([^;,]+)[;,]/);
	return match?.[1];
}

function isHttpUrl(value: unknown): value is string {
	return typeof value === 'string' && /^https?:\/\//i.test(value);
}

function isDataUrl(value: unknown): value is string {
	return typeof value === 'string' && value.startsWith('data:');
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getStringValue(source: Record<string, unknown>, key: string): string | undefined {
	const value = source[key];
	return typeof value === 'string' && value.trim() ? value : undefined;
}

function safeStringify(value: unknown) {
	try {
		return JSON.stringify(value);
	} catch {
		return undefined;
	}
}
