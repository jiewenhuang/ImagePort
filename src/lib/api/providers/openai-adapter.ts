import {
	buildImagesEditRequests,
	buildImagesGenerationRequests,
	parseImagesGenerationResponse
} from '../openai-compatible';
import {
	normalizeOutputImageCount,
	type CallApiResult,
	type ImageEditRequestInput,
	type ImageGenerationRequestInput,
	type InputImage,
	type NativeJsonRequest,
	type TaskParams
} from '$lib/domain/types';
import { buildApiUrl } from '$lib/domain/url';
import type {
	BuildProviderRequestGroupInput,
	BuiltInImageProtocolAdapter,
	ProviderNativeRequest,
	ProviderRequestGroup
} from './types';

const MIME_MAP: Record<string, string> = {
	png: 'image/png',
	jpeg: 'image/jpeg',
	webp: 'image/webp'
};

export const openAIImagesProviderAdapter: BuiltInImageProtocolAdapter = {
	id: 'openai-images',
	resolveEndpoint: (profile, operation) =>
		buildApiUrl(profile.baseUrl, operation === 'edit' ? 'images/edits' : 'images/generations'),
	buildRequestGroup: buildOpenAIImagesRequestGroup
};

export const openAIResponsesProviderAdapter: BuiltInImageProtocolAdapter = {
	id: 'openai-responses',
	resolveEndpoint: (profile) => buildApiUrl(profile.baseUrl, 'responses'),
	buildRequestGroup: buildOpenAIResponsesRequestGroup
};

export function buildOpenAIRequestGroup(input: BuildProviderRequestGroupInput): ProviderRequestGroup {
	return input.profile.apiProtocol === 'openai-responses'
		? buildOpenAIResponsesRequestGroup(input)
		: buildOpenAIImagesRequestGroup(input);
}

export function buildOpenAIResponsesRequestGroup(input: BuildProviderRequestGroupInput): ProviderRequestGroup {
	return {
		provider: input.profile.provider,
		requests: [
			{
				kind: 'json',
				request: buildResponsesImageRequest(input),
				parse: (payload) => parseResponsesImageResponse(payload, input.params.output_format)
			}
		]
	};
}

export function buildOpenAIImagesRequestGroup(input: BuildProviderRequestGroupInput): ProviderRequestGroup {
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

	return { provider: input.profile.provider, requests };
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
	if (input.mask) tool.input_image_mask = { image_url: input.mask.dataUrl };
	if (input.profile.streamImages) tool.partial_images = input.profile.streamPartialImages;
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
				...inputImages.map((image) => ({ type: 'input_image', image_url: image.dataUrl }))
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
	if (!images.length) throw new Error('Responses API 没有返回可识别的图片数据');
	return {
		images,
		revisedPrompts,
		actualParams: actualParamsList.find((item) => item && Object.keys(item).length > 0),
		actualParamsList,
		rawResponsePayload: safeStringify(payload)
	};
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
		if (type === 'response.output_item.done' && isRecord(event.item)) responseOutputItems.push(event.item);
		else if (isRecord(event.response) && Array.isArray(event.response.output)) resultPayload = event.response;
		else if (object === 'image.generation.result' || object === 'image.edit.result') resultPayload = event;
		else if (type === 'image_generation.completed' || type === 'image_edit.completed') completedItems.push(event);
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

function readResponsesImageResultBase64(result: unknown): string | undefined {
	if (typeof result === 'string' && result.trim()) return result;
	if (!isRecord(result)) return undefined;
	for (const key of ['b64_json', 'base64', 'image', 'data']) {
		const value = result[key];
		if (typeof value === 'string' && value.trim()) return value;
	}
	return undefined;
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

function normalizeBase64Image(value: string, fallbackMime: string): string {
	return value.startsWith('data:') ? value : `data:${fallbackMime};base64,${value}`;
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
