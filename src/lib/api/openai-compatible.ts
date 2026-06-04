import {
	getConcreteOutputImageCount,
	normalizeOutputImageCount,
	type CallApiResult,
	type ImageEditRequestInput,
	type ImageGenerationRequestInput,
	type NativeJsonRequest,
	type NativeMultipartRequest,
	type TaskParams
} from '../domain/types';
import { buildApiUrl } from '../domain/url';

const MIME_MAP: Record<string, string> = {
	png: 'image/png',
	jpeg: 'image/jpeg',
	webp: 'image/webp'
};

interface ImageResponseItem {
	b64_json?: string;
	url?: string;
	revised_prompt?: string;
	size?: string;
	quality?: string;
	output_format?: string;
	output_compression?: number;
	moderation?: string;
	n?: number;
}

interface ImageApiResponse {
	data?: ImageResponseItem[];
}

export function buildImagesGenerationRequest(input: ImageGenerationRequestInput): NativeJsonRequest {
	const body: Record<string, unknown> = {
		model: input.model,
		prompt: input.prompt,
		size: input.params.size,
		quality: input.params.quality,
		output_format: input.params.output_format,
		moderation: input.params.moderation
	};

	if (input.params.output_format !== 'png' && input.params.output_compression != null) {
		body.output_compression = input.params.output_compression;
	}
	const outputCount = getConcreteOutputImageCount(input.params.n);
	if (outputCount > 1) {
		body.n = outputCount;
	}
	if (input.responseFormatB64Json) {
		body.response_format = 'b64_json';
	}
	if ('streamImages' in input && input.streamImages === true) {
		body.stream = true;
		body.partial_images = 'streamPartialImages' in input ? input.streamPartialImages : 2;
	}

	return {
		url: buildApiUrl(input.baseUrl, 'images/generations'),
		method: 'POST',
		headers: {
			Authorization: `Bearer ${input.apiKey}`,
			'Content-Type': 'application/json'
		},
		body,
		timeoutSecs: input.timeoutSecs
	};
}

export function buildImagesGenerationRequests(input: ImageGenerationRequestInput): NativeJsonRequest[] {
	return Array.from({ length: getRequestCount(input.params.n) }, () =>
		buildImagesGenerationRequest({
			...input,
			params: {
				...input.params,
				n: 1
			}
		})
	);
}

export function buildImagesEditRequest(input: ImageEditRequestInput): NativeMultipartRequest {
	if (!input.inputImages.length) {
		throw new Error('图像编辑需要至少一张输入图');
	}

	const fields: Record<string, string> = {
		model: input.model,
		prompt: input.prompt,
		size: input.params.size,
		quality: input.params.quality,
		output_format: input.params.output_format,
		moderation: input.params.moderation
	};

	if (input.params.output_format !== 'png' && input.params.output_compression != null) {
		fields.output_compression = String(input.params.output_compression);
	}
	const outputCount = getConcreteOutputImageCount(input.params.n);
	if (outputCount > 1) {
		fields.n = String(outputCount);
	}
	if (input.responseFormatB64Json) {
		fields.response_format = 'b64_json';
	}
	if ('streamImages' in input && input.streamImages === true) {
		fields.stream = 'true';
		fields.partial_images = String('streamPartialImages' in input ? input.streamPartialImages : 2);
	}

	const files = input.inputImages.map((image) => ({
		field: 'image[]',
		fileName: image.name || `${image.id}.png`,
		mime: getDataUrlMime(image.dataUrl) ?? 'image/png',
		dataUrl: image.dataUrl
	}));

	if (input.mask) {
		files.push({
			field: 'mask',
			fileName: 'mask.png',
			mime: 'image/png',
			dataUrl: input.mask.dataUrl
		});
	}

	return {
		url: buildApiUrl(input.baseUrl, 'images/edits'),
		method: 'POST',
		headers: {
			Authorization: `Bearer ${input.apiKey}`
		},
		fields,
		files,
		timeoutSecs: input.timeoutSecs
	};
}

export function buildImagesEditRequests(input: ImageEditRequestInput): NativeMultipartRequest[] {
	return Array.from({ length: getRequestCount(input.params.n) }, () =>
		buildImagesEditRequest({
			...input,
			params: {
				...input.params,
				n: 1
			}
		})
	);
}

export function parseImagesGenerationResponse(payload: unknown, outputFormat: string): CallApiResult {
	const response = payload as ImageApiResponse;
	const data = Array.isArray(response.data) ? response.data : [];
	if (!data.length) {
		throw new Error('接口没有返回图片数据');
	}

	const mime = MIME_MAP[outputFormat] ?? 'image/png';
	const images: string[] = [];
	const rawImageUrls: string[] = [];
	const revisedPrompts: Array<string | undefined> = [];
	const actualParamsList: Array<Partial<TaskParams> | undefined> = [];

	for (const item of data) {
		const actualParams = pickActualParams(item);
		if (typeof item.b64_json === 'string' && item.b64_json.trim()) {
			images.push(normalizeBase64Image(item.b64_json, mime));
			revisedPrompts.push(item.revised_prompt);
			actualParamsList.push(actualParams);
			continue;
		}

		if (typeof item.url === 'string' && /^https?:\/\//i.test(item.url)) {
			rawImageUrls.push(item.url);
			revisedPrompts.push(item.revised_prompt);
			actualParamsList.push(actualParams);
		}
	}

	if (!images.length && !rawImageUrls.length) {
		throw new Error('接口没有返回可识别的图片数据');
	}

	return {
		images,
		revisedPrompts,
		actualParams: actualParamsList.find((item) => item && Object.keys(item).length > 0),
		actualParamsList,
		rawResponsePayload: safeStringify(payload),
		...(rawImageUrls.length ? { rawImageUrls } : {})
	};
}

function pickActualParams(item: ImageResponseItem) {
	const params: Partial<TaskParams> = {};
	if (typeof item.size === 'string' && item.size.trim()) params.size = item.size;
	if (item.quality === 'auto' || item.quality === 'low' || item.quality === 'medium' || item.quality === 'high') {
		params.quality = item.quality;
	}
	if (item.output_format === 'png' || item.output_format === 'jpeg' || item.output_format === 'webp') {
		params.output_format = item.output_format;
	}
	if (typeof item.output_compression === 'number' && Number.isFinite(item.output_compression)) {
		params.output_compression = item.output_compression;
	}
	if (item.moderation === 'auto' || item.moderation === 'low') params.moderation = item.moderation;
	const count = normalizeOutputImageCount(item.n, null);
	if (count != null) params.n = count;
	return Object.keys(params).length ? params : undefined;
}

function safeStringify(value: unknown) {
	try {
		return JSON.stringify(value);
	} catch {
		return undefined;
	}
}

function getRequestCount(value: TaskParams['n']) {
	return getConcreteOutputImageCount(value);
}

function normalizeBase64Image(value: string, fallbackMime: string): string {
	return value.startsWith('data:') ? value : `data:${fallbackMime};base64,${value}`;
}

function getDataUrlMime(dataUrl: string) {
	const match = dataUrl.match(/^data:([^;,]+)[;,]/);
	return match?.[1];
}
