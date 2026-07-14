import { getConcreteOutputImageCount } from '$lib/domain/types';
import { getProviderCapabilities } from '$lib/domain/provider-capabilities';
import { buildApiUrl } from '$lib/domain/url';
import { parseImagesGenerationResponse } from '../openai-compatible';
import { resolveAspectRatio, resolveResolutionTier } from './dimensions';
import type {
	BuildProviderRequestGroupInput,
	BuiltInImageProtocolAdapter,
	ProviderNativeRequest,
	ProviderRequestGroup
} from './types';

export const xaiImageProviderAdapter: BuiltInImageProtocolAdapter = {
	id: 'xai-imagine',
	resolveEndpoint: (profile, operation) =>
		buildApiUrl(profile.baseUrl, operation === 'edit' ? 'images/edits' : 'images/generations'),
	buildRequestGroup: buildXaiRequestGroup
};

export function buildXaiRequestGroup(input: BuildProviderRequestGroupInput): ProviderRequestGroup {
	if (input.mask) throw new Error('Grok Imagine 当前不支持像素级蒙版，请清除蒙版后重试。');
	const capabilities = getProviderCapabilities(input.profile, input.settings);
	if (input.inputImages.length > capabilities.maxInputImages) {
		throw new Error(`Grok Imagine 最多支持 ${capabilities.maxInputImages} 张参考图`);
	}
	const body: Record<string, unknown> = {
		model: input.profile.model,
		prompt: input.prompt,
		n: getConcreteOutputImageCount(input.params.n)
	};
	if (input.params.size !== 'auto') {
		body.aspect_ratio = resolveAspectRatio(input.params.size, capabilities.aspectRatios);
		body.resolution = resolveResolutionTier(input.params.size, capabilities.sizeTiers).toLowerCase();
	}
	if (input.profile.responseFormatB64Json) body.response_format = 'b64_json';
	if (input.inputImages.length === 1) {
		body.image = { url: input.inputImages[0].dataUrl, type: 'image_url' };
	} else if (input.inputImages.length > 1) {
		body.images = input.inputImages.map((image) => ({ url: image.dataUrl, type: 'image_url' }));
	}
	const path = input.inputImages.length ? 'images/edits' : 'images/generations';
	const request: ProviderNativeRequest = {
		kind: 'json',
		request: {
			url: buildApiUrl(input.profile.baseUrl, path),
			method: 'POST',
			headers: {
				Authorization: `Bearer ${input.profile.apiKey}`,
				'Content-Type': 'application/json'
			},
			body,
			timeoutSecs: input.profile.timeoutSecs
		},
		parse: (payload) => parseImagesGenerationResponse(payload, input.params.output_format)
	};
	return { provider: input.profile.provider, requests: [request] };
}
