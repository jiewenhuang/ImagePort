import { describe, expect, test } from 'bun:test';
import { DEFAULT_SETTINGS } from '$lib/domain/settings';
import {
	buildAgentResponsesRequest,
	createAgentAssistantFallbackText,
	enforceAgentToolBudget,
	getAgentRequestBlockReason,
	parseAgentResponsesPayload,
	parseAgentResponsesStreamEvents
} from './agent-runtime';
import { createAgentConversation, createAgentUserRound, completeAgentRound } from '$lib/domain/agent';

const params = {
	size: '1024x1024',
	quality: 'high',
	output_format: 'png',
	output_compression: null,
	moderation: 'auto',
	n: 'auto'
} as const;

describe('agent runtime', () => {
	test('builds a Responses request with image generation, web search and previous response id', () => {
		let ids = 0;
		const first = createAgentUserRound(
			createAgentConversation(1, () => `id-${ids++}`),
			{
				prompt: 'first',
				createId: () => `id-${ids++}`
			}
		);
		const completed = completeAgentRound(first, first.rounds[0].id, {
			content: 'ok',
			responseId: 'resp-prev',
			createId: () => `id-${ids++}`
		});
		const second = createAgentUserRound(completed, {
			prompt: 'second',
			inputImages: [{ id: 'img', name: 'input.png', dataUrl: 'data:image/png;base64,aW1hZ2U=' }],
			createId: () => `id-${ids++}`
		});
		const profile = {
			...DEFAULT_SETTINGS.profiles[0],
			apiMode: 'responses' as const,
			model: 'gpt-5.5',
			apiKey: 'sk-test',
			streamImages: true,
			streamPartialImages: 2
		};
		const request = buildAgentResponsesRequest({
			profile,
			settings: { agentMaxToolRounds: 4, agentWebSearch: true },
			conversation: second,
			roundId: second.rounds[1].id,
			prompt: 'second',
			params,
			inputImages: [{ id: 'img', name: 'input.png', dataUrl: 'data:image/png;base64,aW1hZ2U=' }],
			mask: { targetImageId: 'img', dataUrl: 'data:image/png;base64,bWFzaw==', updatedAt: 1 },
			stream: true,
			partialImages: 2
		});

		expect(request.url).toBe('https://api.openai.com/v1/responses');
		expect(request.body?.previous_response_id).toBe('resp-prev');
		expect(request.body?.stream).toBe(true);
		expect(String(request.body?.instructions).includes('Do not exceed 4 tool calls')).toBe(true);
		expect(request.body?.tools).toEqual([
			{ type: 'web_search' },
			{
				type: 'image_generation',
				action: 'edit',
				size: '1024x1024',
				quality: 'high',
				output_format: 'png',
				moderation: 'auto',
				input_image_mask: { image_url: 'data:image/png;base64,bWFzaw==' },
				partial_images: 2
			}
		]);
	});

	test('parses Responses payload text, images and tool calls', () => {
		const parsed = parseAgentResponsesPayload(
			{
				id: 'resp-1',
				output: [
					{
						type: 'message',
						content: [{ type: 'output_text', text: 'Here is the image.' }]
					},
					{
						id: 'img-call',
						type: 'image_generation_call',
						status: 'completed',
						result: 'final-b64',
						revised_prompt: 'revised prompt',
						size: '1024x1024',
						quality: 'high'
					}
				]
			},
			'png'
		);

		expect(parsed.responseId).toBe('resp-1');
		expect(parsed.text).toBe('Here is the image.');
		expect(parsed.images).toEqual(['data:image/png;base64,final-b64']);
		expect(parsed.revisedPrompts).toEqual(['revised prompt']);
		expect(parsed.actualParams).toEqual({ size: '1024x1024', quality: 'high' });
		expect(parsed.toolCalls[0]).toEqual({
			id: 'img-call',
			type: 'image_generation_call',
			status: 'completed',
			title: 'revised prompt'
		});
	});

	test('parses streaming text deltas, partial images and final output items', () => {
		const parsed = parseAgentResponsesStreamEvents(
			[
				{ type: 'response.output_text.delta', delta: 'hello' },
				{ type: 'response.image_generation_call.partial_image', partial_image_b64: 'partial-b64' },
				{ type: 'response.output_text.delta', delta: ' world' },
				{
					type: 'response.output_item.done',
					item: {
						id: 'img-call',
						type: 'image_generation_call',
						status: 'completed',
						result: 'final-b64'
					}
				}
			],
			'png'
		);

		expect(parsed.text).toBe('hello world');
		expect(parsed.partialImages).toEqual(['data:image/png;base64,partial-b64']);
		expect(parsed.images).toEqual(['data:image/png;base64,final-b64']);
	});

	test('reports Agent profile blockers', () => {
		expect(getAgentRequestBlockReason(DEFAULT_SETTINGS.profiles[0], DEFAULT_SETTINGS)?.includes('Responses API')).toBe(
			true
		);
		expect(
			getAgentRequestBlockReason(
				{ ...DEFAULT_SETTINGS.profiles[0], apiMode: 'responses', apiKey: 'sk-test' },
				DEFAULT_SETTINGS
			)
		).toBe(null);
		expect(
			createAgentAssistantFallbackText(
				{
					text: '',
					images: ['img'],
					partialImages: [],
					responseId: null,
					revisedPrompts: [],
					actualParamsList: [],
					actualParams: null,
					rawResponsePayload: null,
					toolCalls: [],
					toolCallCount: 0
				},
				2
			)
		).toBe('已生成 1/2 张图片。');
	});

	test('enforces the configured tool-call budget after parsing', () => {
		const result = {
			text: '',
			images: [],
			partialImages: [],
			responseId: null,
			revisedPrompts: [],
			actualParamsList: [],
			actualParams: null,
			rawResponsePayload: null,
			toolCalls: [
				{ id: 'one', type: 'web_search_call', status: 'completed', title: null },
				{ id: 'two', type: 'image_generation_call', status: 'completed', title: null }
			],
			toolCallCount: 2
		};

		expect(enforceAgentToolBudget(result, 2)).toBe(result);
		let message = '';
		try {
			enforceAgentToolBudget(result, 1);
		} catch (err) {
			message = err instanceof Error ? err.message : String(err);
		}
		expect(message.includes('Agent 工具调用超过上限')).toBe(true);
	});
});
