import { getConcreteOutputImageCount, type CallApiResult } from '$lib/domain/types';
import { getProviderCapabilities } from '$lib/domain/provider-capabilities';
import { normalizeBaseUrl } from '$lib/domain/url';
import { resolveAspectRatio, resolveResolutionTier, splitDataUrl } from './dimensions';
import type {
	BuildProviderRequestGroupInput,
	BuiltInImageProtocolAdapter,
	ProviderNativeRequest,
	ProviderRequestGroup
} from './types';

export const geminiImageProviderAdapter: BuiltInImageProtocolAdapter = {
	id: 'gemini-interactions',
	resolveEndpoint: (profile) => buildGeminiInteractionsUrl(profile.baseUrl),
	buildRequestGroup: buildGeminiRequestGroup
};

export function buildGeminiRequestGroup(input: BuildProviderRequestGroupInput): ProviderRequestGroup {
	if (input.mask) throw new Error('Gemini 图像模型当前不支持像素级蒙版，请清除蒙版后重试。');
	const capabilities = getProviderCapabilities(input.profile, input.settings);
	if (input.inputImages.length > capabilities.maxInputImages) {
		throw new Error(`当前 Gemini 模型最多支持 ${capabilities.maxInputImages} 张参考图`);
	}
	const requestCount = getConcreteOutputImageCount(input.params.n);
	const requests = Array.from({ length: requestCount }, (): ProviderNativeRequest => {
		const body: Record<string, unknown> = {
			model: input.profile.model,
			input: createGeminiInput(input.prompt, input.inputImages),
			response_format: createGeminiResponseFormat(input, capabilities)
		};
		return {
			kind: 'json',
			request: {
				url: buildGeminiInteractionsUrl(input.profile.baseUrl),
				method: 'POST',
				headers: {
					'x-goog-api-key': input.profile.apiKey,
					'Content-Type': 'application/json'
				},
				body,
				timeoutSecs: input.profile.timeoutSecs
			},
			parse: parseGeminiImageResponse
		};
	});
	return { provider: input.profile.provider, requests };
}

function createGeminiInput(prompt: string, images: BuildProviderRequestGroupInput['inputImages']): unknown {
	if (!images.length) return prompt;
	return [
		{ type: 'text', text: prompt },
		...images.map((image) => {
			const parsed = splitDataUrl(image.dataUrl);
			return { type: 'image', data: parsed.data, mime_type: parsed.mimeType };
		})
	];
}

function createGeminiResponseFormat(
	input: BuildProviderRequestGroupInput,
	capabilities: ReturnType<typeof getProviderCapabilities>
) {
	const format: Record<string, unknown> = {
		type: 'image',
		mime_type: input.params.output_format === 'jpeg' ? 'image/jpeg' : 'image/png'
	};
	if (input.params.size !== 'auto') {
		format.aspect_ratio = resolveAspectRatio(input.params.size, capabilities.aspectRatios);
		format.image_size = resolveResolutionTier(input.params.size, capabilities.sizeTiers);
	}
	return format;
}

export function buildGeminiInteractionsUrl(baseUrl: string): string {
	const base = normalizeBaseUrl(baseUrl).replace(/\/interactions$/i, '');
	if (!base) return '/v1beta/interactions';
	if (/^https:\/\/generativelanguage\.googleapis\.com\/v1$/i.test(base)) {
		return 'https://generativelanguage.googleapis.com/v1beta/interactions';
	}
	if (/\/v1(?:beta)?$/i.test(base)) return `${base}/interactions`;
	return `${base}/v1beta/interactions`;
}

export function parseGeminiImageResponse(payload: unknown): CallApiResult {
	const images: string[] = [];
	const seen = new Set<string>();
	const addImage = (value: unknown) => {
		if (!isRecord(value)) return;
		const data = readString(value, 'data') ?? readString(value, 'b64_json');
		if (!data || seen.has(data)) return;
		seen.add(data);
		const mime = readString(value, 'mime_type') ?? readString(value, 'mimeType') ?? 'image/png';
		images.push(data.startsWith('data:') ? data : `data:${mime};base64,${data}`);
	};

	if (isRecord(payload)) {
		addImage(payload.output_image);
		addImage(payload.outputImage);
		if (Array.isArray(payload.steps)) {
			for (const step of payload.steps) {
				if (!isRecord(step) || step.type !== 'model_output' || !Array.isArray(step.content)) continue;
				for (const content of step.content) {
					if (isRecord(content) && content.type === 'image') addImage(content);
				}
			}
		}
		if (Array.isArray(payload.candidates)) {
			for (const candidate of payload.candidates) {
				if (!isRecord(candidate) || !isRecord(candidate.content) || !Array.isArray(candidate.content.parts)) continue;
				for (const part of candidate.content.parts) {
					if (!isRecord(part) || part.thought === true) continue;
					addImage(part.inlineData);
					addImage(part.inline_data);
				}
			}
		}
	}
	if (!images.length) throw new Error('Gemini API 没有返回可识别的最终图片');
	return { images, rawResponsePayload: safeStringify(payload) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readString(value: Record<string, unknown>, key: string): string | undefined {
	const item = value[key];
	return typeof item === 'string' && item.trim() ? item : undefined;
}

function safeStringify(value: unknown) {
	try {
		return JSON.stringify(value);
	} catch {
		return undefined;
	}
}
