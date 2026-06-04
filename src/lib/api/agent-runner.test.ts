import { describe, expect, test } from 'bun:test';
import { createAgentConversation, createAgentUserRound } from '$lib/domain/agent';
import { DEFAULT_SETTINGS } from '$lib/domain/settings';
import { DEFAULT_PARAMS } from '$lib/domain/types';
import { runAgentResponsesRequest } from './agent-runner';

const profile = {
	...DEFAULT_SETTINGS.profiles[0],
	apiMode: 'responses' as const,
	apiKey: 'sk-test',
	model: 'gpt-5.5'
};

describe('agent runner', () => {
	test('runs a non-streaming Responses request with a cancellable request id', async () => {
		const conversation = createAgentUserRound(createAgentConversation(1, () => 'conv-1'), {
			prompt: 'draw a small icon',
			createId: (() => {
				let id = 0;
				return () => `id-${id++}`;
			})()
		});
		const result = await runAgentResponsesRequest({
			conversation,
			roundId: conversation.rounds[0].id,
			taskId: 'task-1',
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
			onPartialImages: () => undefined,
			isCanceled: () => false
		});

		expect(result.responseId).toBe('resp-1');
		expect(result.text).toBe('ok');
		expect(result.images).toEqual(['data:image/png;base64,final']);
	});

	test('streams text and partial images, then clears the active request id', async () => {
		const activeIds: Array<string | null> = [];
		const textUpdates: string[] = [];
		const partialUpdates: string[][] = [];
		const conversation = createAgentUserRound(createAgentConversation(1, () => 'conv-1'), {
			prompt: 'stream it',
			createId: (() => {
				let id = 0;
				return () => `id-${id++}`;
			})()
		});
		const result = await runAgentResponsesRequest({
			conversation,
			roundId: conversation.rounds[0].id,
			taskId: 'task-1',
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
				onChunk('data: {"type":"response.image_generation_call.partial_image","partial_image_b64":"partial"}\n\n');
				onChunk('data: {"type":"response.output_item.done","item":{"type":"image_generation_call","result":"final"}}\n\n');
				return { status: 200, headers: {}, body: null };
			},
			onActiveRequestId: (requestId) => activeIds.push(requestId),
			onText: (_conversationId, _roundId, text) => textUpdates.push(text),
			onPartialImages: (_taskId, images) => partialUpdates.push(images),
			isCanceled: () => false
		});

		expect(activeIds).toEqual(['agent-stream-1', null]);
		expect(textUpdates).toEqual(['hello']);
		expect(partialUpdates).toEqual([['data:image/png;base64,partial']]);
		expect(result.images).toEqual(['data:image/png;base64,final']);
		expect(result.partialImages).toEqual(['data:image/png;base64,partial']);
	});

	test('throws a stopped message when cancellation wins after streaming completes', async () => {
		const conversation = createAgentUserRound(createAgentConversation(1, () => 'conv-1'), {
			prompt: 'stop',
			createId: (() => {
				let id = 0;
				return () => `id-${id++}`;
			})()
		});
		let message = '';
		try {
			await runAgentResponsesRequest({
				conversation,
				roundId: conversation.rounds[0].id,
				taskId: 'task-1',
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
				onPartialImages: () => undefined,
				isCanceled: () => true
			});
		} catch (err) {
			message = err instanceof Error ? err.message : String(err);
		}

		expect(message).toBe('用户停止了 Agent 轮次');
	});
});
