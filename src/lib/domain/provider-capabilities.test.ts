import { describe, expect, test } from 'bun:test';
import { getProviderCapabilities, getProviderInputValidationMessage } from './provider-capabilities';

describe('provider capabilities', () => {
	test('does not offer unsupported output formats for generateContent', () => {
		for (const apiProtocol of ['gemini-generate-content', 'gemini-generate-content-response-format'] as const) {
			const capabilities = getProviderCapabilities({
				provider: 'google',
				model: 'gemini-nano-banana-2.1',
				apiMode: 'images',
				apiProtocol
			});
			expect(capabilities.formatOptions).toEqual(['png']);
		}
	});

	test('exposes xAI edit constraints', () => {
		const capabilities = getProviderCapabilities({
			provider: 'xai',
			model: 'grok-imagine-image-quality',
			apiMode: 'images'
		});
		expect(capabilities.maxInputImages).toBe(3);
		expect(capabilities.supportsMask).toBe(false);
		expect(capabilities.sizeTiers).toEqual(['1K', '2K']);
		expect(getProviderInputValidationMessage(capabilities, 4, false)?.includes('最多支持 3 张')).toBe(true);
		expect(getProviderInputValidationMessage(capabilities, 1, true)?.includes('不支持像素级蒙版')).toBe(true);
	});

	test('limits Gemini Flash Lite to 1K', () => {
		const capabilities = getProviderCapabilities({
			provider: 'google',
			model: 'gemini-3.1-flash-lite-image',
			apiMode: 'images'
		});
		expect(capabilities.sizeTiers).toEqual(['1K']);
		expect(capabilities.formatOptions).toEqual(['png', 'jpeg']);
	});
});
