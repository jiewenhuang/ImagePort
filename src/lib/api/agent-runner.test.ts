import { describe, expect, test } from 'bun:test';
import { createAgentConversation, createAgentUserRound } from '$lib/domain/agent';
import { DEFAULT_SETTINGS } from '$lib/domain/settings';
import { DEFAULT_PARAMS } from '$lib/domain/types';
import { runAgentResponsesRequest } from './agent-runner';

const profile = {
	...DEFAULT_SETTINGS.profiles[0],
	apiMode: 'responses' as const,
	apiProtocol: 'openai-responses' as const,
	apiKey: 'sk-test',
	model: 'gpt-5.5'
};

describe('agent runner', () => {
	test('runs a non-streaming Responses request with a cancellable request id', async () => {
		const conversation = createAgentUserRound(
			createAgentConversation(1, () => 'conv-1'),
			{
				prompt: 'draw a small icon',
				createId: (() => {
					let id = 0;
					return () => `id-${id++}`;
				})()
			}
		);
		const result = await runAgentResponsesRequest({
			conversation,
			roundId: conversation.rounds[0].id,
			intent: 'image-generate',
			profile,
			settings: DEFAULT_SETTINGS,
			prompt: 'draw a small icon',
			params: { ...DEFAULT_PARAMS, n: 'auto' },
			inputImages: [],
			mask: null,
			createRequestId: () => 'agent-json-1',
			nativeJsonRequest: async (request) => {
				expect(request.requestId).toBe('agent-json-1');
				return {
					status: 200,
					headers: {},
					body: {
						id: 'resp-1',
						output: [
							{ type: 'message', content: [{ type: 'output_text', text: 'ok' }] },
							{ type: 'image_generation_call', result: 'final' }
						]
					}
				};
			},
			nativeJsonStreamRequest: async () => {
				throw new Error('stream should not be used');
			},
			onActiveRequestId: () => undefined,
			onText: () => undefined,
			onImageToolStarted: () => undefined,
			onPartialImage: () => undefined,
			isCanceled: () => false
		});

		expect(result.responseId).toBe('resp-1');
		expect(result.text).toBe('ok');
		expect(result.images).toEqual([
			{
				toolCallId: 'image-call-1',
				dataUrl: 'data:image/png;base64,final',
				action: undefined,
				revisedPrompt: undefined,
				actualParams: undefined
			}
		]);
	});

	test('returns a successful text-only response without starting an image tool', async () => {
		const startedToolCallIds: string[] = [];
		const conversation = createAgentUserRound(
			createAgentConversation(1, () => 'conv-text'),
			{
				prompt: 'help me improve this idea',
				createId: (() => {
					let id = 0;
					return () => `text-id-${id++}`;
				})()
			}
		);
		const result = await runAgentResponsesRequest({
			conversation,
			roundId: conversation.rounds[0].id,
			intent: 'conversation',
			profile,
			settings: DEFAULT_SETTINGS,
			prompt: 'help me improve this idea',
			params: { ...DEFAULT_PARAMS, n: 'auto' },
			inputImages: [],
			mask: null,
			createRequestId: () => 'agent-text-1',
			nativeJsonRequest: async () => ({
				status: 200,
				headers: {},
				body: {
					id: 'resp-text',
					output: [{ type: 'message', content: [{ type: 'output_text', text: 'Try a warmer color palette.' }] }]
				}
			}),
			nativeJsonStreamRequest: async () => {
				throw new Error('stream should not be used');
			},
			onActiveRequestId: () => undefined,
			onText: () => undefined,
			onImageToolStarted: (event) => startedToolCallIds.push(event.toolCallId),
			onPartialImage: () => undefined,
			isCanceled: () => false
		});

		expect(result.text).toBe('Try a warmer color palette.');
		expect(result.images).toEqual([]);
		expect(result.toolCalls).toEqual([]);
		expect(startedToolCallIds).toEqual([]);
	});

	test('streams text and partial images, then clears the active request id', async () => {
		const activeIds: Array<string | null> = [];
		const textUpdates: string[] = [];
		const startedToolCallIds: string[] = [];
		const partialUpdates: Array<{ toolCallId: string; dataUrl: string }> = [];
		const conversation = createAgentUserRound(
			createAgentConversation(1, () => 'conv-1'),
			{
				prompt: 'stream it',
				createId: (() => {
					let id = 0;
					return () => `id-${id++}`;
				})()
			}
		);
		const result = await runAgentResponsesRequest({
			conversation,
			roundId: conversation.rounds[0].id,
			intent: 'image-generate',
			profile: { ...profile, streamImages: true, streamPartialImages: 1 },
			settings: DEFAULT_SETTINGS,
			prompt: 'stream it',
			params: { ...DEFAULT_PARAMS, n: 'auto' },
			inputImages: [],
			mask: null,
			createRequestId: () => 'agent-stream-1',
			nativeJsonRequest: async () => {
				throw new Error('json should not be used');
			},
			nativeJsonStreamRequest: async (request, onChunk) => {
				expect(request.requestId).toBe('agent-stream-1');
				onChunk('data: {"type":"response.output_text.delta","delta":"hello"}\n\n');
				onChunk(
					'data: {"type":"response.output_item.added","item":{"id":"img-call","type":"image_generation_call","action":"generate"}}\n\n'
				);
				onChunk(
					'data: {"type":"response.image_generation_call.partial_image","item_id":"img-call","partial_image_b64":"partial"}\n\n'
				);
				onChunk(
					'data: {"type":"response.output_item.done","item":{"id":"img-call","type":"image_generation_call","result":"final"}}\n\n'
				);
				return { status: 200, headers: {}, body: null };
			},
			onActiveRequestId: (requestId) => activeIds.push(requestId),
			onText: (_conversationId, _roundId, text) => textUpdates.push(text),
			onImageToolStarted: (event) => startedToolCallIds.push(event.toolCallId),
			onPartialImage: (event) => partialUpdates.push({ toolCallId: event.toolCallId, dataUrl: event.dataUrl }),
			isCanceled: () => false
		});

		expect(activeIds).toEqual(['agent-stream-1', null]);
		expect(textUpdates).toEqual(['hello']);
		expect(startedToolCallIds).toEqual(['img-call']);
		expect(partialUpdates).toEqual([{ toolCallId: 'img-call', dataUrl: 'data:image/png;base64,partial' }]);
		expect(result.images[0]?.toolCallId).toBe('img-call');
		expect(result.images[0]?.dataUrl).toBe('data:image/png;base64,final');
		expect(result.partialImages[0]?.toolCallId).toBe('img-call');
		expect(result.partialImages[0]?.dataUrl).toBe('data:image/png;base64,partial');
	});

	test('throws a stopped message when cancellation wins after streaming completes', async () => {
		const conversation = createAgentUserRound(
			createAgentConversation(1, () => 'conv-1'),
			{
				prompt: 'stop',
				createId: (() => {
					let id = 0;
					return () => `id-${id++}`;
				})()
			}
		);
		let message = '';
		try {
			await runAgentResponsesRequest({
				conversation,
				roundId: conversation.rounds[0].id,
				intent: 'conversation',
				profile: { ...profile, streamImages: true },
				settings: DEFAULT_SETTINGS,
				prompt: 'stop',
				params: { ...DEFAULT_PARAMS, n: 'auto' },
				inputImages: [],
				mask: null,
				createRequestId: () => 'agent-stream-2',
				nativeJsonRequest: async () => {
					throw new Error('json should not be used');
				},
				nativeJsonStreamRequest: async () => ({ status: 200, headers: {}, body: null }),
				onActiveRequestId: () => undefined,
				onText: () => undefined,
				onImageToolStarted: () => undefined,
				onPartialImage: () => undefined,
				isCanceled: () => true
			});
		} catch (err) {
			message = err instanceof Error ? err.message : String(err);
		}

		expect(message).toBe('用户停止了 Agent 轮次');
	});

	test('throws the Responses failure message from a successful SSE transport', async () => {
		const conversation = createAgentUserRound(
			createAgentConversation(1, () => 'conv-failed'),
			{
				prompt: 'stream failure',
				createId: (() => {
					let id = 0;
					return () => `failed-id-${id++}`;
				})()
			}
		);

		let message = '';
		try {
			await runAgentResponsesRequest({
				conversation,
				roundId: conversation.rounds[0].id,
				intent: 'conversation',
				profile: { ...profile, streamImages: true },
				settings: DEFAULT_SETTINGS,
				prompt: 'stream failure',
				params: { ...DEFAULT_PARAMS, n: 'auto' },
				inputImages: [],
				mask: null,
				createRequestId: () => 'agent-stream-failed',
				nativeJsonRequest: async () => {
					throw new Error('json should not be used');
				},
				nativeJsonStreamRequest: async (_request, onChunk) => {
					onChunk('data: {"type":"response.failed","response":{"error":{"message":"upstream failed"}}}\n\n');
					return { status: 200, headers: {}, body: null };
				},
				onActiveRequestId: () => undefined,
				onText: () => undefined,
				onImageToolStarted: () => undefined,
				onPartialImage: () => undefined,
				isCanceled: () => false
			});
		} catch (err) {
			message = err instanceof Error ? err.message : String(err);
		}

		expect(message).toBe('upstream failed');
	});
});
