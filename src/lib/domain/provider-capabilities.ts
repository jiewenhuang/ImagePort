import type { ApiProfile, AppSettings } from './settings';
import type { TaskParams } from './types';
import type { SizeTier } from './size';

export interface ProviderCapabilities {
	maxInputImages: number;
	maxOutputImages: number;
	supportsImageEdit: boolean;
	supportsMask: boolean;
	maskUnsupportedReason: string | null;
	supportsStreaming: boolean;
	supportsPartialImages: boolean;
	supportsOutputCompression: boolean;
	usesModelControlledOutputCount: boolean;
	qualityOptions: TaskParams['quality'][];
	formatOptions: TaskParams['output_format'][];
	moderationOptions: TaskParams['moderation'][];
	sizeTiers: SizeTier[];
	aspectRatios: string[];
	supportsExactSize: boolean;
}

const COMMON_RATIOS = ['1:1', '3:2', '2:3', '16:9', '9:16', '4:3', '3:4', '21:9'];
const GOOGLE_RATIOS = [...COMMON_RATIOS, '4:5', '5:4'];
const XAI_RATIOS = [
	'1:1',
	'3:2',
	'2:3',
	'16:9',
	'9:16',
	'4:3',
	'3:4',
	'2:1',
	'1:2',
	'19.5:9',
	'9:19.5',
	'20:9',
	'9:20'
];
const OPENAI_CAPABILITIES: ProviderCapabilities = {
	maxInputImages: 16,
	maxOutputImages: 10,
	supportsImageEdit: true,
	supportsMask: true,
	maskUnsupportedReason: null,
	supportsStreaming: true,
	supportsPartialImages: true,
	supportsOutputCompression: true,
	usesModelControlledOutputCount: false,
	qualityOptions: ['auto', 'low', 'medium', 'high'],
	formatOptions: ['png', 'jpeg', 'webp'],
	moderationOptions: ['auto', 'low'],
	sizeTiers: ['1K', '2K', '4K'],
	aspectRatios: COMMON_RATIOS,
	supportsExactSize: true
};

export function getProviderCapabilities(
	profile: Pick<ApiProfile, 'provider' | 'model' | 'apiMode'>,
	settings?: Pick<AppSettings, 'customProviders'>
): ProviderCapabilities {
	if (profile.provider === 'xai') {
		return {
			...OPENAI_CAPABILITIES,
			maxInputImages: 3,
			supportsMask: false,
			maskUnsupportedReason: 'Grok Imagine 当前不支持像素级蒙版，可改用自然语言描述编辑区域。',
			supportsStreaming: false,
			supportsPartialImages: false,
			supportsOutputCompression: false,
			qualityOptions: [],
			formatOptions: [],
			moderationOptions: [],
			sizeTiers: ['1K', '2K'],
			aspectRatios: XAI_RATIOS,
			supportsExactSize: false
		};
	}

	if (profile.provider === 'google') {
		const isLite = profile.model.includes('flash-lite-image');
		return {
			...OPENAI_CAPABILITIES,
			maxInputImages: 14,
			supportsMask: false,
			maskUnsupportedReason: 'Gemini 图像模型当前使用自然语言和参考图编辑，不支持像素级蒙版。',
			supportsStreaming: false,
			supportsPartialImages: false,
			supportsOutputCompression: false,
			qualityOptions: [],
			formatOptions: ['png', 'jpeg'],
			moderationOptions: [],
			sizeTiers: isLite ? ['1K'] : ['1K', '2K', '4K'],
			aspectRatios: GOOGLE_RATIOS,
			supportsExactSize: false
		};
	}

	if (profile.provider === 'openai') {
		return {
			...OPENAI_CAPABILITIES,
			usesModelControlledOutputCount: profile.apiMode === 'responses'
		};
	}

	const customProvider = settings?.customProviders.find((provider) => provider.id === profile.provider);
	const supportsMask = Boolean(
		customProvider?.editSubmit?.files?.some((file) => file.source === 'mask') ||
		containsTemplateReference(customProvider?.editSubmit?.body, '$mask.dataUrl')
	);
	return {
		...OPENAI_CAPABILITIES,
		supportsImageEdit: Boolean(customProvider?.editSubmit),
		supportsMask,
		maskUnsupportedReason: supportsMask ? null : '当前自定义服务商没有声明蒙版文件映射。',
		supportsStreaming: false,
		supportsPartialImages: false
	};
}

function containsTemplateReference(value: unknown, reference: string): boolean {
	if (value === reference) return true;
	if (Array.isArray(value)) return value.some((item) => containsTemplateReference(item, reference));
	if (value && typeof value === 'object') {
		return Object.values(value).some((item) => containsTemplateReference(item, reference));
	}
	return false;
}

export function getProviderInputValidationMessage(
	capabilities: ProviderCapabilities,
	inputImageCount: number,
	hasMask: boolean
): string | null {
	if (inputImageCount > capabilities.maxInputImages) {
		return `当前模型最多支持 ${capabilities.maxInputImages} 张参考图，请移除多余图片后再提交。`;
	}
	if (inputImageCount > 0 && !capabilities.supportsImageEdit) {
		return '当前服务商未配置图像编辑能力，请移除参考图或切换服务商。';
	}
	if (hasMask && !capabilities.supportsMask) {
		return capabilities.maskUnsupportedReason ?? '当前模型不支持蒙版编辑。';
	}
	return null;
}
