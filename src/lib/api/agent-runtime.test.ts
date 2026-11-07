import { describe, expect, test } from 'bun:test';
import { DEFAULT_SETTINGS } from '$lib/domain/settings';
import {
	buildAgentResponsesRequest,
	createAgentAssistantFallbackText,
	createAgentResponsesInput,
	enforceAgentToolBudget,
	getAgentRequestBlockReason,
	getAgentStreamFailureMessage,
	hasMeaningfulAgentResponse,
	isOfficialOpenAIResponsesEndpoint,
	parseAgentImageToolStartEvent,
	parseAgentPartialImageEvent,
	parseAgentResponsesPayload,
	parseAgentResponsesStreamEvents
} from './agent-runtime';
import {
	completeAgentRound,
	createAgentConversation,
	createAgentUserRound,
	normalizeAgentConversations,
	startAgentAssistantMessage
} from '$lib/domain/agent';

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
			apiProtocol: 'openai-responses' as const,
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
			intent: 'image-edit',
			prompt: 'second',
			params,
			inputImages: [{ id: 'img', name: 'input.png', dataUrl: 'data:image/png;base64,aW1hZ2U=' }],
			mask: { targetImageId: 'img', dataUrl: 'data:image/png;base64,bWFzaw==', updatedAt: 1 },
			stream: true,
			partialImages: 2
		});

		expect(request.url).toBe('https://api.openai.com/v1/responses');
		expect(request.body?.previous_response_id).toBe('resp-prev');
		expect(request.body?.store).toBe(true);
		expect(request.body?.input).toEqual([
			{
				role: 'user',
				content: [
					{ type: 'input_text', text: 'second' },
					{ type: 'input_image', image_url: 'data:image/png;base64,aW1hZ2U=' }
				]
			}
		]);
		expect(request.body?.stream).toBe(true);
		expect(String(request.body?.instructions).includes('Do not exceed 4 tool calls')).toBe(true);
		expect(String(request.body?.instructions).includes('otherwise reply with text')).toBe(true);
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

	test('replays persisted local conversation history for third-party Responses endpoints', () => {
		let ids = 0;
		const createId = () => `local-${ids++}`;
		const first = createAgentUserRound(createAgentConversation(1, createId), {
			prompt: '记住数字 109',
			inputImages: [{ id: 'old-image', name: 'old.png', dataUrl: 'data:image/png;base64,b2xk' }],
			createId
		});
		const completed = completeAgentRound(first, first.rounds[0].id, {
			content: '记住了：109',
			responseId: 'resp-third-party',
			createId
		});
		const second = createAgentUserRound(completed, {
			prompt: '上一回我发的数字是什么？',
			inputImages: [{ id: 'current-image', name: 'current.png', dataUrl: 'data:image/png;base64,bmV3' }],
			createId
		});
		const withPlaceholder = startAgentAssistantMessage(second, second.rounds[1].id, {
			content: '正在思考...',
			createId
		});
		const restoredConversation = normalizeAgentConversations(JSON.parse(JSON.stringify([withPlaceholder])))[0];
		expect(Boolean(restoredConversation)).toBe(true);

		const request = buildAgentResponsesRequest({
			profile: {
				...DEFAULT_SETTINGS.profiles[0],
				baseUrl: 'https://api.krill-ai.com/v1',
				apiMode: 'responses',
				apiProtocol: 'openai-responses',
				model: 'gpt-5.5',
				apiKey: 'sk-test'
			},
			settings: { agentMaxToolRounds: 4, agentWebSearch: false },
			conversation: restoredConversation!,
			roundId: restoredConversation!.rounds[1].id,
			intent: 'conversation',
			prompt: '上一回我发的数字是什么？',
			params,
			inputImages: [{ id: 'current-image', name: 'current.png', dataUrl: 'data:image/png;base64,bmV3' }],
			mask: null,
			stream: false,
			partialImages: 0
		});

		expect(request.url).toBe('https://api.krill-ai.com/v1/responses');
		expect(request.body?.previous_response_id).toBe(undefined);
		expect(request.body?.store).toBe(undefined);
		expect(request.body?.input).toEqual([
			{ role: 'user', content: '记住数字 109' },
			{ role: 'assistant', content: '记住了：109' },
			{
				role: 'user',
				content: [
					{ type: 'input_text', text: '上一回我发的数字是什么？' },
					{ type: 'input_image', image_url: 'data:image/png;base64,bmV3' }
				]
			}
		]);
		expect(JSON.stringify(request.body?.input).includes('data:image/png;base64,b2xk')).toBe(false);
	});

	test('does not replay failed or running assistant placeholders into local context', () => {
		let ids = 0;
		const createId = () => `filtered-${ids++}`;
		const first = createAgentUserRound(createAgentConversation(1, createId), { prompt: '第一问', createId });
		const firstDone = completeAgentRound(first, first.rounds[0].id, {
			content: '第一答',
			createId
		});
		const failed = createAgentUserRound(firstDone, { prompt: '会失败的问题', createId });
		const failedDone = completeAgentRound(failed, failed.rounds[1].id, {
			content: 'Agent 失败：上游不可用',
			error: '上游不可用',
			createId
		});
		const running = createAgentUserRound(failedDone, { prompt: '未完成的问题', createId });
		const runningWithPlaceholder = startAgentAssistantMessage(running, running.rounds[2].id, {
			content: '正在思考...',
			createId
		});
		const current = createAgentUserRound(runningWithPlaceholder, { prompt: '当前问题', createId });

		expect(createAgentResponsesInput(current, current.rounds[3].id, '当前问题', [], 'local-history')).toEqual([
			{ role: 'user', content: '第一问' },
			{ role: 'assistant', content: '第一答' },
			{ role: 'user', content: '会失败的问题' },
			{ role: 'user', content: '未完成的问题' },
			{ role: 'user', content: '当前问题' }
		]);
	});

	test('replays useful assistant text from a partial round into local context', () => {
		let ids = 0;
		const createId = () => `partial-history-${ids++}`;
		const first = createAgentUserRound(createAgentConversation(1, createId), {
			prompt: '先做一张海报',
			createId
		});
		const partial = completeAgentRound(first, first.rounds[0].id, {
			content: '目前只有预览图，主视觉采用红色圆形。',
			status: 'partial',
			createId
		});
		const current = createAgentUserRound(partial, { prompt: '主视觉是什么？', createId });

		expect(createAgentResponsesInput(current, current.rounds[1].id, '主视觉是什么？', [], 'local-history')).toEqual([
			{ role: 'user', content: '先做一张海报' },
			{ role: 'assistant', content: '目前只有预览图，主视觉采用红色圆形。' },
			{ role: 'user', content: '主视觉是什么？' }
		]);
	});

	test('keeps local history isolated to the selected conversation', () => {
		function createConversationWithHistory(prefix: string, rememberedValue: string) {
			let ids = 0;
			const createId = () => `${prefix}-${ids++}`;
			const first = createAgentUserRound(createAgentConversation(1, createId), {
				prompt: `记住 ${rememberedValue}`,
				createId
			});
			const completed = completeAgentRound(first, first.rounds[0].id, {
				content: `已记住 ${rememberedValue}`,
				createId
			});
			return createAgentUserRound(completed, { prompt: '我让你记住了什么？', createId });
		}

		const firstConversation = createConversationWithHistory('first-conversation', '109');
		const secondConversation = createConversationWithHistory('second-conversation', '777');
		const firstInput = createAgentResponsesInput(
			firstConversation,
			firstConversation.rounds[1].id,
			'我让你记住了什么？',
			[],
			'local-history'
		);
		const secondInput = createAgentResponsesInput(
			secondConversation,
			secondConversation.rounds[1].id,
			'我让你记住了什么？',
			[],
			'local-history'
		);

		expect(JSON.stringify(firstInput).includes('109')).toBe(true);
		expect(JSON.stringify(firstInput).includes('777')).toBe(false);
		expect(JSON.stringify(secondInput).includes('777')).toBe(true);
		expect(JSON.stringify(secondInput).includes('109')).toBe(false);
	});

	test('uses server chaining only for the official OpenAI hostname', () => {
		expect(isOfficialOpenAIResponsesEndpoint('https://api.openai.com/v1')).toBe(true);
		expect(isOfficialOpenAIResponsesEndpoint('api.openai.com/v1/')).toBe(true);
		expect(isOfficialOpenAIResponsesEndpoint('https://api.krill-ai.com/v1')).toBe(false);
		expect(isOfficialOpenAIResponsesEndpoint('https://api.openai.com.example.com/v1')).toBe(false);
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
		expect(parsed.images).toEqual([
			{
				toolCallId: 'img-call',
				dataUrl: 'data:image/png;base64,final-b64',
				action: undefined,
				revisedPrompt: 'revised prompt',
				actualParams: { size: '1024x1024', quality: 'high' }
			}
		]);
		expect(parsed.toolCalls[0]).toEqual({
			id: 'img-call',
			type: 'image_generation_call',
			status: 'completed',
			title: 'revised prompt'
		});
	});

	test('keeps multiple image-generation calls as independent outputs', () => {
		const parsed = parseAgentResponsesPayload(
			{
				id: 'resp-multi',
				output: [
					{
						id: 'img-call-a',
						type: 'image_generation_call',
						status: 'completed',
						result: 'first-image',
						revised_prompt: 'first prompt'
					},
					{
						id: 'img-call-b',
						type: 'image_generation_call',
						status: 'completed',
						result: 'second-image',
						revised_prompt: 'second prompt'
					}
				]
			},
			'webp'
		);

		expect(parsed.images.map((image) => image.toolCallId)).toEqual(['img-call-a', 'img-call-b']);
		expect(parsed.images.map((image) => image.dataUrl)).toEqual([
			'data:image/webp;base64,first-image',
			'data:image/webp;base64,second-image'
		]);
		expect(parsed.toolCalls.map((toolCall) => toolCall.id)).toEqual(['img-call-a', 'img-call-b']);
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
		expect(parsed.partialImages).toEqual([
			{
				toolCallId: 'image-call-1',
				dataUrl: 'data:image/png;base64,partial-b64',
				partialImageIndex: null
			}
		]);
		expect(parsed.images).toEqual([
			{
				toolCallId: 'img-call',
				dataUrl: 'data:image/png;base64,final-b64',
				action: undefined,
				revisedPrompt: undefined,
				actualParams: undefined
			}
		]);
	});

	test('extracts image tool lifecycle events with stable tool-call ids', () => {
		expect(
			parseAgentImageToolStartEvent({
				type: 'response.output_item.added',
				item: { id: 'img-call', type: 'image_generation_call', action: 'generate' }
			})
		).toEqual({ toolCallId: 'img-call', action: 'generate', prompt: undefined });
		expect(
			parseAgentPartialImageEvent(
				{
					type: 'response.image_generation_call.partial_image',
					item_id: 'img-call',
					partial_image_index: 1,
					partial_image_b64: 'partial'
				},
				'png'
			)
		).toEqual({
			toolCallId: 'img-call',
			dataUrl: 'data:image/png;base64,partial',
			partialImageIndex: 1
		});
	});

	test('reports Agent profile blockers', () => {
		expect(getAgentRequestBlockReason(DEFAULT_SETTINGS.profiles[0], DEFAULT_SETTINGS)?.includes('Responses API')).toBe(
			true
		);
		expect(
			getAgentRequestBlockReason(
				{
					...DEFAULT_SETTINGS.profiles[0],
					apiMode: 'responses',
					apiProtocol: 'openai-responses',
					apiKey: 'sk-test'
				},
				DEFAULT_SETTINGS
			)
		).toBe(null);
		expect(
			getAgentRequestBlockReason(
				{
					...DEFAULT_SETTINGS.profiles[0],
					apiMode: 'responses',
					apiProtocol: 'openai-responses',
					apiKey: 'sk-test',
					baseUrl: ''
				},
				DEFAULT_SETTINGS
			)?.includes('HTTP(S)')
		).toBe(true);
		expect(
			createAgentAssistantFallbackText(
				{
					text: '',
					unsupportedToolOutput: false,
					images: [{ toolCallId: 'img-call', dataUrl: 'img' }],
					partialImages: [],
					responseId: null,
					rawResponsePayload: null,
					toolCalls: [],
					toolCallCount: 0
				},
				2
			)
		).toBe('已生成 1/2 张图片。');
	});

	test('treats a text-only response as a meaningful successful Agent response', () => {
		const result = parseAgentResponsesPayload(
			{
				id: 'resp-text',
				output: [{ type: 'message', content: [{ type: 'output_text', text: '你好，我可以帮你构思画面。' }] }]
			},
			'png'
		);

		expect(result.images).toEqual([]);
		expect(hasMeaningfulAgentResponse(result)).toBe(true);
		expect(createAgentAssistantFallbackText(result, 'auto')).toBe('你好，我可以帮你构思画面。');
	});

	test('hides text-shaped tool calls without executing or discarding the raw payload', () => {
		const mixed = parseAgentResponsesPayload(
			{
				id: 'resp-fake-tool',
				output: [
					{
						type: 'message',
						content: [
							{
								type: 'output_text',
								text: '我来处理。\n<tool_call>{"name":"shell","command":"pwd && apply_patch"}</tool_call>\n请配置图片模型。'
							}
						]
					}
				]
			},
			'png'
		);
		expect(mixed.text).toBe('我来处理。\n\n请配置图片模型。');
		expect(mixed.unsupportedToolOutput).toBe(true);
		expect(mixed.rawResponsePayload?.includes('apply_patch')).toBe(true);
		expect(hasMeaningfulAgentResponse(mixed)).toBe(true);

		const fakeOnly = parseAgentResponsesPayload(
			{
			output_text: '<tool_call>{"name":"shell","command":"pwd"}</tool_call>'
			},
			'png'
		);
		expect(fakeOnly.text).toBe('');
		expect(fakeOnly.unsupportedToolOutput).toBe(true);
		expect(hasMeaningfulAgentResponse(fakeOnly)).toBe(false);

		const streamed = parseAgentResponsesStreamEvents(
			[
				{ type: 'response.output_text.delta', delta: '<tool_call>{"command":"pwd"}</tool_call>' },
				{
					type: 'response.completed',
					response: {
						output: [{ type: 'message', content: [{ type: 'output_text', text: '已忽略异常工具文本。' }] }]
					}
				}
			],
			'png'
		);
		expect(streamed.text).toBe('已忽略异常工具文本。');
		expect(streamed.unsupportedToolOutput).toBe(true);

		const pseudoTool = parseAgentResponsesPayload(
			{
				output_text:
					'to=multi_tool_use.parallel app{"tool_uses":[{"recipient_name":"functions.shell_command","parameters":{"command":"pwd"}}]}\n\n下面是可直接用于图像生成模型的提示词：'
			},
			'png'
		);
		expect(pseudoTool.text).toBe('下面是可直接用于图像生成模型的提示词：');
		expect(pseudoTool.unsupportedToolOutput).toBe(true);
	});

	test('preserves explanatory text when an image tool call fails', () => {
		const result = parseAgentResponsesPayload(
			{
				id: 'resp-image-failed',
				output: [
					{
						type: 'message',
						content: [{ type: 'output_text', text: '图片工具暂时不可用，你可以稍后重试。' }]
					},
					{ id: 'img-call-failed', type: 'image_generation_call', status: 'failed' }
				]
			},
			'png'
		);

		expect(result.images).toEqual([]);
		expect(result.toolCalls[0]?.status).toBe('failed');
		expect(hasMeaningfulAgentResponse(result)).toBe(true);
		expect(createAgentAssistantFallbackText(result, 1)).toBe('图片工具暂时不可用，你可以稍后重试。');
	});

	test('extracts terminal failures from streaming Responses events', () => {
		expect(
			getAgentStreamFailureMessage([
				{
					type: 'response.failed',
					response: { error: { message: 'image generation service unavailable' } }
				}
			])
		).toBe('image generation service unavailable');
		expect(getAgentStreamFailureMessage([{ type: 'response.incomplete', response: {} }])).toBe('Agent 响应未完整结束');
	});

	test('enforces the configured tool-call budget after parsing', () => {
		const result = {
			text: '',
			unsupportedToolOutput: false,
			images: [],
			partialImages: [],
			responseId: null,
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
