import { describe, expect, test } from 'bun:test';
import { detectAgentRoundIntent, isOfficialOpenAIResponsesEndpoint, resolveAgentExecutionRoute } from './agent-routing';

describe('agent routing', () => {
	test('detects explicit image generation without treating image questions as generation', () => {
		expect(detectAgentRoundIntent('ok，生成一张异瞳猫咪给我')).toBe('image-generate');
		expect(detectAgentRoundIntent('Draw an image of a quiet harbor')).toBe('image-generate');
		expect(detectAgentRoundIntent('帮我画个异瞳猫')).toBe('image-generate');
		expect(detectAgentRoundIntent('draw me a quiet harbor')).toBe('image-generate');
		expect(detectAgentRoundIntent('生成一座悬浮在云海中的未来城市全景，清晨柔光，电影级构图。')).toBe('image-generate');
		expect(detectAgentRoundIntent('设计一款温暖、克制的智能桌面设备，产品摄影风格。')).toBe('image-generate');
		expect(detectAgentRoundIntent('如何生成一张高质量图片？')).toBe('conversation');
		expect(detectAgentRoundIntent('分析一下这个构图为什么有效')).toBe('conversation');
	});

	test('detects edits only when the user supplies an image or mask', () => {
		const inputImages = [{ id: 'image', name: 'image.png', dataUrl: 'data:image/png;base64,aW1hZ2U=' }];
		expect(detectAgentRoundIntent('把背景换成夜景', inputImages)).toBe('image-edit');
		expect(detectAgentRoundIntent('分析一下这张图片', inputImages)).toBe('conversation');
		expect(detectAgentRoundIntent('修改这张图片，让背景变成夜景')).toBe('image-generate');
	});

	test('uses native tools only for official OpenAI in auto mode', () => {
		expect(
			resolveAgentExecutionRoute({
				intent: 'image-generate',
				strategy: 'auto',
				agentBaseUrl: 'https://api.openai.com/v1'
			})
		).toBe('native-image-tool');
		expect(
			resolveAgentExecutionRoute({
				intent: 'image-generate',
				strategy: 'auto',
				agentBaseUrl: 'https://api.krill-ai.com/v1'
			})
		).toBe('image-profile');
		expect(
			resolveAgentExecutionRoute({
				intent: 'image-generate',
				strategy: 'native',
				agentBaseUrl: 'https://proxy.example.com/v1'
			})
		).toBe('native-image-tool');
		expect(isOfficialOpenAIResponsesEndpoint('https://api.openai.com.example.com/v1')).toBe(false);
	});
});
