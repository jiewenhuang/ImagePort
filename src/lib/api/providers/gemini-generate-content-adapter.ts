import { getConcreteOutputImageCount } from '$lib/domain/types';
import { getProviderCapabilities } from '$lib/domain/provider-capabilities';
import { normalizeBaseUrl } from '$lib/domain/url';
import { resolveAspectRatio, resolveResolutionTier, splitDataUrl } from './dimensions';
import { parseGeminiImageResponse } from './gemini-adapter';
import type {
	BuildProviderRequestGroupInput,
	BuiltInImageProtocolAdapter,
	ProviderNativeRequest,
	ProviderRequestGroup
} from './types';

export const geminiGenerateContentProviderAdapter: BuiltInImageProtocolAdapter = {
	id: 'gemini-generate-content',
	resolveEndpoint: (profile) => buildGeminiGenerateContentUrl(profile.baseUrl, profile.model),
	buildRequestGroup: buildGeminiGenerateContentRequestGroup
};

export const geminiGenerateContentResponseFormatProviderAdapter: BuiltInImageProtocolAdapter = {
	...geminiGenerateContentProviderAdapter,
	id: 'gemini-generate-content-response-format'
};

export function buildGeminiGenerateContentUrl(baseUrl: string, model: string): string {
	// This protocol uses v1beta even when the connection was copied from an OpenAI /v1 profile.
	const base = normalizeBaseUrl(baseUrl).replace(/\/v1(?:beta)?(?:\/.*)?$/i, '');
	const modelId = model.trim().replace(/^models\//, '');
	return `${base}/v1beta/models/${modelId ? encodeURIComponent(modelId) : '{model}'}:generateContent`;
}

export function buildGeminiGenerateContentRequestGroup(input: BuildProviderRequestGroupInput): ProviderRequestGroup {
	if (!input.profile.model.trim()) throw new Error('请填写 Gemini 模型名称。');
	if (input.mask) throw new Error('Gemini 图像模型当前不支持像素级蒙版，请清除蒙版后重试。');
	const capabilities = getProviderCapabilities(input.profile, input.settings);
	if (input.inputImages.length > capabilities.maxInputImages) {
		throw new Error(`当前 Gemini 模型最多支持 ${capabilities.maxInputImages} 张参考图`);
	}
	const url = buildGeminiGenerateContentUrl(input.profile.baseUrl, input.profile.model);
	const headers: Record<string, string> = {
		'x-goog-api-key': input.profile.apiKey,
		'Content-Type': 'application/json'
	};
	// Compatible gateways may authenticate with Bearer tokens instead of Google's API-key header.
	if (new URL(url).hostname !== 'generativelanguage.googleapis.com') {
		headers.Authorization = `Bearer ${input.profile.apiKey}`;
	}
	const usesResponseFormat = input.profile.apiProtocol === 'gemini-generate-content-response-format';
	const requests = Array.from({ length: getConcreteOutputImageCount(input.params.n) }, (): ProviderNativeRequest => {
		const generationConfig: Record<string, unknown> = {
			responseModalities: usesResponseFormat ? ['IMAGE'] : ['TEXT', 'IMAGE']
		};
		if (input.params.size !== 'auto') {
			const aspectRatio = resolveAspectRatio(input.params.size, capabilities.aspectRatios);
			const image = {
				...(aspectRatio !== 'auto' ? { aspectRatio } : {}),
				imageSize: resolveResolutionTier(input.params.size, capabilities.sizeTiers)
			};
			// Some gateways (including Rolldek Banana 2.1) document responseFormat.image
			// with compact ratio/size values; keep that format separate from imageConfig.
			if (usesResponseFormat) generationConfig.responseFormat = { image };
			else generationConfig.imageConfig = image;
		}
		return {
			kind: 'json',
			request: {
				url,
				method: 'POST',
				headers: { ...headers },
				body: {
					contents: [
						{
							role: 'user',
							parts: [
								{ text: input.prompt },
								...input.inputImages.map((image) => ({ inlineData: splitDataUrl(image.dataUrl) }))
							]
						}
					],
					generationConfig
				},
				timeoutSecs: input.profile.timeoutSecs
			},
			parse: parseGeminiImageResponse
		};
	});
	return { provider: input.profile.provider, requests };
}
