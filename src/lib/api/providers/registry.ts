import type { ApiProfile, BuiltInImageApiProtocol } from '$lib/domain/settings';
import { geminiImageProviderAdapter } from './gemini-adapter';
import { openAIImagesProviderAdapter, openAIResponsesProviderAdapter } from './openai-adapter';
import type { BuiltInImageProtocolAdapter } from './types';
import { xaiImageProviderAdapter } from './xai-adapter';

const ADAPTERS: Record<BuiltInImageApiProtocol, BuiltInImageProtocolAdapter> = {
	'openai-images': openAIImagesProviderAdapter,
	'openai-responses': openAIResponsesProviderAdapter,
	'xai-imagine': xaiImageProviderAdapter,
	'gemini-interactions': geminiImageProviderAdapter
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
		return '当前会把 Gemini/Banana 模型作为 OpenAI Images 兼容模型调用，支持的参数以中转站文档为准。';
	}
	if (profile.apiProtocol === 'openai-images' && profile.provider === 'xai') {
		return '当前使用标准 OpenAI Images 请求体；如果网关要求 Grok 的 aspect_ratio/resolution 参数，请改用 xAI Imagine 协议。';
	}
	return null;
}
