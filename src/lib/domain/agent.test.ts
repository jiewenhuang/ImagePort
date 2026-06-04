import { describe, expect, test } from 'bun:test';
import {
	completeAgentRound,
	createAgentConversation,
	createAgentUserRound,
	markAgentRoundCanceled,
	normalizeAgentConversations,
	startAgentAssistantMessage,
	updateAgentAssistantMessage
} from './agent';

describe('agent conversation domain', () => {
	test('creates a user round and uses the first prompt as title', () => {
		let ids = 0;
		const conversation = createAgentUserRound(createAgentConversation(100, () => `id-${ids++}`), {
			prompt: 'generate a calm desktop wallpaper',
			now: 120,
			createId: () => `id-${ids++}`
		});

		expect(conversation.title).toBe('generate a calm desktop wallpape');
		expect(conversation.rounds.length).toBe(1);
		expect(conversation.rounds[0].status).toBe('running');
		expect(conversation.messages[0].role).toBe('user');
	});

	test('completes a round with assistant output task ids', () => {
		let ids = 0;
		const started = createAgentUserRound(createAgentConversation(100, () => `id-${ids++}`), {
			prompt: 'draw',
			now: 120,
			createId: () => `id-${ids++}`
		});
		const completed = completeAgentRound(started, started.rounds[0].id, {
			content: '已生成图片',
			outputTaskIds: ['task-1'],
			now: 200,
			createId: () => `id-${ids++}`
		});

		expect(completed.rounds[0].status).toBe('done');
		expect(completed.rounds[0].outputTaskIds).toEqual(['task-1']);
		expect(completed.messages.at(-1)?.role).toBe('assistant');
	});

	test('streams assistant text into a running round and preserves metadata on completion', () => {
		let ids = 0;
		const started = createAgentUserRound(createAgentConversation(100, () => `id-${ids++}`), {
			prompt: 'draw',
			now: 120,
			maxToolRounds: 8,
			webSearchEnabled: true,
			createId: () => `id-${ids++}`
		});
		const withAssistant = startAgentAssistantMessage(started, started.rounds[0].id, {
			content: 'thinking',
			now: 130,
			createId: () => `id-${ids++}`
		});
		const updated = updateAgentAssistantMessage(withAssistant, started.rounds[0].id, {
			content: 'streamed text',
			now: 140
		});
		const completed = completeAgentRound(updated, started.rounds[0].id, {
			content: 'final text',
			responseId: 'resp-1',
			toolCalls: [{ id: 'tool-1', type: 'image_generation_call', status: 'completed', title: 'generate' }],
			toolCallCount: 1,
			now: 200,
			createId: () => `id-${ids++}`
		});

		expect(completed.messages.filter((message) => message.role === 'assistant').length).toBe(1);
		expect(completed.messages.at(-1)?.content).toBe('final text');
		expect(completed.rounds[0].responseId).toBe('resp-1');
		expect(completed.rounds[0].webSearchEnabled).toBe(true);
		expect(completed.rounds[0].maxToolRounds).toBe(8);
		expect(completed.rounds[0].toolCalls[0].type).toBe('image_generation_call');
	});

	test('marks a running round canceled without treating it as an error', () => {
		let ids = 0;
		const started = createAgentUserRound(createAgentConversation(100, () => `id-${ids++}`), {
			prompt: 'draw',
			now: 120,
			createId: () => `id-${ids++}`
		});
		const canceled = markAgentRoundCanceled(started, started.rounds[0].id, {
			content: 'stopped',
			now: 180
		});

		expect(canceled.rounds[0].status).toBe('canceled');
		expect(canceled.rounds[0].error).toBe(null);
		expect(canceled.messages.at(-1)?.content).toBe('stopped');
	});

	test('normalizes persisted conversations', () => {
		const conversations = normalizeAgentConversations([
			{
				id: 'conv',
				title: '',
				messages: [{ id: 'msg', role: 'assistant', content: 'ok', roundId: 'round', createdAt: 1 }],
				rounds: [{
					id: 'round',
					index: 1,
					userMessageId: 'user',
					prompt: 'hello',
					status: 'canceled',
					responseId: 'resp-1',
					toolCalls: [{ id: 'tool', type: 'web_search_call', status: 'completed', title: 'query' }],
					webSearchEnabled: true,
					createdAt: 1
				}],
				createdAt: 1
			},
			{ bad: true }
		]);

		expect(conversations.length).toBe(1);
		expect(conversations[0].title).toBe('未命名会话');
		expect(conversations[0].messages[0].role).toBe('assistant');
		expect(conversations[0].rounds[0].status).toBe('canceled');
		expect(conversations[0].rounds[0].responseId).toBe('resp-1');
		expect(conversations[0].rounds[0].toolCalls[0].type).toBe('web_search_call');
	});
});
