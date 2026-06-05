import type { InputImage, MaskDraft, TaskRecord } from './types';

export type AgentMessageRole = 'user' | 'assistant';
export type AgentRoundStatus = 'running' | 'done' | 'error' | 'canceled';

export interface AgentToolCallSummary {
	id: string | null;
	type: string;
	status: string | null;
	title: string | null;
}

export interface AgentMessage {
	id: string;
	role: AgentMessageRole;
	content: string;
	roundId: string;
	inputImages?: InputImage[];
	mask?: MaskDraft | null;
	outputTaskIds?: string[];
	createdAt: number;
}

export interface AgentRound {
	id: string;
	index: number;
	userMessageId: string;
	assistantMessageId?: string | null;
	prompt: string;
	outputTaskIds: string[];
	status: AgentRoundStatus;
	error: string | null;
	responseId: string | null;
	rawResponsePayload: string | null;
	toolCalls: AgentToolCallSummary[];
	toolCallCount: number;
	maxToolRounds: number | null;
	webSearchEnabled: boolean;
	retryOfRoundId: string | null;
	continuedFromRoundId: string | null;
	createdAt: number;
	finishedAt: number | null;
}

export interface AgentConversation {
	id: string;
	title: string;
	messages: AgentMessage[];
	rounds: AgentRound[];
	createdAt: number;
	updatedAt: number;
}

export function createAgentConversation(now = Date.now(), createId: () => string = createAgentId): AgentConversation {
	return {
		id: createId(),
		title: '新会话',
		messages: [],
		rounds: [],
		createdAt: now,
		updatedAt: now
	};
}

export function createAgentUserRound(
	conversation: AgentConversation,
	input: {
		prompt: string;
		inputImages?: InputImage[];
		mask?: MaskDraft | null;
		maxToolRounds?: number | null;
		webSearchEnabled?: boolean;
		retryOfRoundId?: string | null;
		continuedFromRoundId?: string | null;
		now?: number;
		createId?: () => string;
	}
): AgentConversation {
	const prompt = input.prompt.trim();
	if (!prompt) return conversation;
	const now = input.now ?? Date.now();
	const createId = input.createId ?? createAgentId;
	const roundId = createId();
	const userMessageId = createId();
	const round: AgentRound = {
		id: roundId,
		index: conversation.rounds.length + 1,
		userMessageId,
		prompt,
		outputTaskIds: [],
		status: 'running',
		error: null,
		responseId: null,
		rawResponsePayload: null,
		toolCalls: [],
		toolCallCount: 0,
		maxToolRounds: input.maxToolRounds ?? null,
		webSearchEnabled: input.webSearchEnabled ?? false,
		retryOfRoundId: input.retryOfRoundId ?? null,
		continuedFromRoundId: input.continuedFromRoundId ?? null,
		createdAt: now,
		finishedAt: null
	};
	const message: AgentMessage = {
		id: userMessageId,
		role: 'user',
		content: prompt,
		roundId,
		inputImages: input.inputImages ?? [],
		mask: input.mask ?? null,
		outputTaskIds: [],
		createdAt: now
	};
	return {
		...conversation,
		title: conversation.messages.length ? conversation.title : createConversationTitle(prompt),
		messages: [...conversation.messages, message],
		rounds: [...conversation.rounds, round],
		updatedAt: now
	};
}

export function completeAgentRound(
	conversation: AgentConversation,
	roundId: string,
	input: {
		content: string;
		outputTaskIds?: string[];
		error?: string | null;
		status?: AgentRoundStatus;
		responseId?: string | null;
		rawResponsePayload?: string | null;
		toolCalls?: AgentToolCallSummary[];
		toolCallCount?: number;
		maxToolRounds?: number | null;
		webSearchEnabled?: boolean;
		retryOfRoundId?: string | null;
		continuedFromRoundId?: string | null;
		now?: number;
		createId?: () => string;
	}
): AgentConversation {
	const now = input.now ?? Date.now();
	const createId = input.createId ?? createAgentId;
	const round = conversation.rounds.find((item) => item.id === roundId);
	if (!round) return conversation;
	const assistantMessageId = round.assistantMessageId ?? createId();
	const outputTaskIds = input.outputTaskIds ?? [];
	const hasAssistantMessage = conversation.messages.some((message) => message.id === assistantMessageId);
	const messages = hasAssistantMessage
		? conversation.messages.map((message) =>
				message.id === assistantMessageId
					? {
							...message,
							content: input.content,
							outputTaskIds,
							createdAt: message.createdAt || now
						}
					: message
			)
		: [
				...conversation.messages,
				{
					id: assistantMessageId,
					role: 'assistant',
					content: input.content,
					roundId,
					outputTaskIds,
					createdAt: now
				} satisfies AgentMessage
			];
	const status = input.status ?? (input.error ? 'error' : 'done');
	return {
		...conversation,
		messages,
		rounds: conversation.rounds.map((item) =>
			item.id === roundId
				? {
						...item,
						assistantMessageId,
						outputTaskIds,
						status,
						error: input.error ?? null,
						responseId: input.responseId ?? item.responseId,
						rawResponsePayload: input.rawResponsePayload ?? item.rawResponsePayload,
						toolCalls: input.toolCalls ?? item.toolCalls,
						toolCallCount: input.toolCallCount ?? item.toolCallCount,
						maxToolRounds: input.maxToolRounds ?? item.maxToolRounds,
						webSearchEnabled: input.webSearchEnabled ?? item.webSearchEnabled,
						retryOfRoundId: input.retryOfRoundId ?? item.retryOfRoundId,
						continuedFromRoundId: input.continuedFromRoundId ?? item.continuedFromRoundId,
						finishedAt: now
					}
				: item
		),
		updatedAt: now
	};
}

export function startAgentAssistantMessage(
	conversation: AgentConversation,
	roundId: string,
	input: {
		content?: string;
		now?: number;
		createId?: () => string;
	}
): AgentConversation {
	const round = conversation.rounds.find((item) => item.id === roundId);
	if (!round) return conversation;
	const now = input.now ?? Date.now();
	const createId = input.createId ?? createAgentId;
	const assistantMessageId = round.assistantMessageId ?? createId();
	const hasAssistantMessage = conversation.messages.some((message) => message.id === assistantMessageId);
	const messages = hasAssistantMessage
		? conversation.messages
		: [
				...conversation.messages,
				{
					id: assistantMessageId,
					role: 'assistant',
					content: input.content ?? '',
					roundId,
					outputTaskIds: [],
					createdAt: now
				} satisfies AgentMessage
			];
	return {
		...conversation,
		messages,
		rounds: conversation.rounds.map((item) => (item.id === roundId ? { ...item, assistantMessageId } : item)),
		updatedAt: now
	};
}

export function updateAgentAssistantMessage(
	conversation: AgentConversation,
	roundId: string,
	input: {
		content?: string;
		appendContent?: string;
		outputTaskIds?: string[];
		now?: number;
	}
): AgentConversation {
	const now = input.now ?? Date.now();
	const round = conversation.rounds.find((item) => item.id === roundId);
	if (!round?.assistantMessageId) return conversation;
	return {
		...conversation,
		messages: conversation.messages.map((message) =>
			message.id === round.assistantMessageId
				? {
						...message,
						content: input.content ?? `${message.content}${input.appendContent ?? ''}`,
						outputTaskIds: input.outputTaskIds ?? message.outputTaskIds
					}
				: message
		),
		updatedAt: now
	};
}

export function markAgentRoundCanceled(
	conversation: AgentConversation,
	roundId: string,
	input: {
		content?: string;
		now?: number;
	}
): AgentConversation {
	return completeAgentRound(conversation, roundId, {
		content: input.content ?? '已停止。',
		status: 'canceled',
		error: null,
		now: input.now
	});
}

export function normalizeAgentConversations(value: unknown): AgentConversation[] {
	if (!Array.isArray(value)) return [];
	return value.map(normalizeAgentConversation).filter((item): item is AgentConversation => item != null);
}

export function findAgentOutputTasks(conversation: AgentConversation, tasks: TaskRecord[]): TaskRecord[] {
	const ids = new Set(conversation.rounds.flatMap((round) => round.outputTaskIds));
	return tasks.filter((task) => ids.has(task.id));
}

function normalizeAgentConversation(value: unknown): AgentConversation | null {
	if (!isRecord(value)) return null;
	const id = getString(value.id, '');
	if (!id) return null;
	const createdAt = getNumber(value.createdAt, Date.now());
	return {
		id,
		title: getString(value.title, '未命名会话'),
		messages: normalizeAgentMessages(value.messages),
		rounds: normalizeAgentRounds(value.rounds),
		createdAt,
		updatedAt: getNumber(value.updatedAt, createdAt)
	};
}

function normalizeAgentMessages(value: unknown): AgentMessage[] {
	if (!Array.isArray(value)) return [];
	return value.filter(isRecord).map((item) => ({
		id: getString(item.id, createAgentId()),
		role: item.role === 'assistant' ? 'assistant' : 'user',
		content: getString(item.content, ''),
		roundId: getString(item.roundId, ''),
		inputImages: Array.isArray(item.inputImages) ? item.inputImages.filter(isInputImage) : [],
		mask: normalizeMask(item.mask),
		outputTaskIds: normalizeStringArray(item.outputTaskIds),
		createdAt: getNumber(item.createdAt, Date.now())
	}));
}

function normalizeAgentRounds(value: unknown): AgentRound[] {
	if (!Array.isArray(value)) return [];
	return value.filter(isRecord).map((item, index) => ({
		id: getString(item.id, createAgentId()),
		index: getNumber(item.index, index + 1),
		userMessageId: getString(item.userMessageId, ''),
		assistantMessageId: getNullableString(item.assistantMessageId),
		prompt: getString(item.prompt, ''),
		outputTaskIds: normalizeStringArray(item.outputTaskIds),
		status: item.status === 'done' || item.status === 'error' || item.status === 'canceled' ? item.status : 'running',
		error: getNullableString(item.error),
		responseId: getNullableString(item.responseId),
		rawResponsePayload: getNullableString(item.rawResponsePayload),
		toolCalls: normalizeToolCalls(item.toolCalls),
		toolCallCount: getNumber(item.toolCallCount, normalizeToolCalls(item.toolCalls).length),
		maxToolRounds: getNullableNumber(item.maxToolRounds),
		webSearchEnabled: getBoolean(item.webSearchEnabled, false),
		retryOfRoundId: getNullableString(item.retryOfRoundId),
		continuedFromRoundId: getNullableString(item.continuedFromRoundId),
		createdAt: getNumber(item.createdAt, Date.now()),
		finishedAt: getNullableNumber(item.finishedAt)
	}));
}

function normalizeToolCalls(value: unknown): AgentToolCallSummary[] {
	if (!Array.isArray(value)) return [];
	return value.filter(isRecord).map((item) => ({
		id: getNullableString(item.id),
		type: getString(item.type, 'tool_call'),
		status: getNullableString(item.status),
		title: getNullableString(item.title)
	}));
}

function createConversationTitle(prompt: string) {
	return prompt.trim().replace(/\s+/g, ' ').slice(0, 32) || '新会话';
}

function createAgentId() {
	if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function isInputImage(value: unknown): value is InputImage {
	return isRecord(value) && typeof value.id === 'string' && typeof value.dataUrl === 'string';
}

function normalizeMask(value: unknown): MaskDraft | null {
	if (!isRecord(value)) return null;
	const targetImageId = getString(value.targetImageId, '');
	const dataUrl = getString(value.dataUrl, '');
	if (!targetImageId || !dataUrl) return null;
	return {
		targetImageId,
		dataUrl,
		updatedAt: getNumber(value.updatedAt, Date.now())
	};
}

function normalizeStringArray(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
		: [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getString(value: unknown, fallback: string): string {
	return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function getNumber(value: unknown, fallback: number): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function getBoolean(value: unknown, fallback: boolean): boolean {
	return typeof value === 'boolean' ? value : fallback;
}

function getNullableString(value: unknown): string | null {
	return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function getNullableNumber(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
