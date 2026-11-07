import type { ApiProfile, BuiltInImageApiProtocol } from '$lib/domain/settings';
import { geminiImageProviderAdapter } from './gemini-adapter';
import {
	geminiGenerateContentProviderAdapter,
	geminiGenerateContentResponseFormatProviderAdapter
} from './gemini-generate-content-adapter';
import { openAIImagesProviderAdapter, openAIResponsesProviderAdapter } from './openai-adapter';
import type { BuiltInImageProtocolAdapter } from './types';
import { xaiImageProviderAdapter } from './xai-adapter';

const ADAPTERS: Record<BuiltInImageApiProtocol, BuiltInImageProtocolAdapter> = {
	'openai-images': openAIImagesProviderAdapter,
	'openai-responses': openAIResponsesProviderAdapter,
	'xai-imagine': xaiImageProviderAdapter,
	'gemini-interactions': geminiImageProviderAdapter,
	'gemini-generate-content': geminiGenerateContentProviderAdapter,
	'gemini-generate-content-response-format': geminiGenerateContentResponseFormatProviderAdapter
};

export function getBuiltInImageProtocolAdapter(protocol: string): BuiltInImageProtocolAdapter | null {
	return protocol in ADAPTERS ? ADAPTERS[protocol as BuiltInImageApiProtocol] : null;
}

export function resolveImageApiEndpoint(
	profile: ApiProfile,
	operation: 'generate' | 'edit' = 'generate'
): string | null {
	return getBuiltInImageProtocolAdapter(profile.apiProtocol)?.resolveEndpoint(profile, operation) ?? null;
}

export function getImageApiProtocolWarning(profile: ApiProfile): string | null {
	if (profile.apiProtocol === 'gemini-generate-content-response-format') {
		return '适用于 Rolldek Banana 2.1 等要求 generationConfig.responseFormat.image 的中转。文生图和参考图编辑均使用 generateContent；尺寸和比例通过 responseFormat.image 发送。';
	}
	if (profile.apiProtocol === 'gemini-generate-content') {
		return '文生图和参考图编辑均使用 /v1beta/models/{model}:generateContent，参考图随 JSON 请求发送。中转地址需要支持此协议。';
	}
	if (profile.apiProtocol === 'gemini-interactions' && profile.provider === 'google') {
		const base = profile.baseUrl.trim().replace(/\/+$/, '');
		if (!/^https:\/\/generativelanguage\.googleapis\.com\/v1beta$/i.test(base)) {
			return '当前是 Gemini Interactions 协议，请确认该地址明确支持 POST /interactions；普通 OpenAI /v1 网关通常不支持。';
		}
	}
	if (profile.apiProtocol === 'openai-images' && profile.provider === 'google') {
		if (/^https:\/\/generativelanguage\.googleapis\.com(?:\/|$)/i.test(profile.baseUrl.trim())) {
			return 'Google 官方地址不提供 OpenAI Images 接口；请恢复官方连接，或把 API URL 改成兼容该协议的中转地址。';
		}
		return 'OpenAI Images 在有参考图时使用 /images/edits，无需遮罩。如果中转提示该模型不支持 edits、支持 generateContent，请切换到 Gemini generateContent。';
	}
	if (profile.apiProtocol === 'openai-images' && profile.provider === 'xai') {
		return '当前使用标准 OpenAI Images 请求体；如果网关要求 Grok 的 aspect_ratio/resolution 参数，请改用 xAI Imagine 协议。';
	}
	return null;
}
