import { buildApiUrl } from '$lib/domain/url';
import type { AgentConversation, AgentRoundIntent, AgentToolCallSummary } from '$lib/domain/agent';
import { isOfficialOpenAIResponsesEndpoint } from '$lib/domain/agent-routing';
import { getProfileRequestBlockReason, type ApiProfile, type AppSettings } from '$lib/domain/settings';
import {
	normalizeOutputImageCount,
	type InputImage,
	type MaskDraft,
	type NativeJsonRequest,
	type TaskParams
} from '$lib/domain/types';

const MIME_MAP: Record<string, string> = {
	png: 'image/png',
	jpeg: 'image/jpeg',
	webp: 'image/webp'
};

export interface BuildAgentResponsesRequestInput {
	profile: ApiProfile;
	settings: Pick<AppSettings, 'agentMaxToolRounds' | 'agentWebSearch'>;
	conversation: AgentConversation;
	roundId: string;
	intent: AgentRoundIntent;
	prompt: string;
	params: TaskParams;
	inputImages: InputImage[];
	mask: MaskDraft | null;
	stream: boolean;
	partialImages: number;
}

export interface AgentResponseImage {
	toolCallId: string;
	dataUrl: string;
	action?: string;
	revisedPrompt?: string;
	actualParams?: Partial<TaskParams>;
}

export interface AgentPartialImage {
	toolCallId: string;
	dataUrl: string;
	partialImageIndex: number | null;
}

export interface AgentImageToolStart {
	toolCallId: string;
	action?: string;
	prompt?: string;
}

export interface AgentResponsesResult {
	responseId: string | null;
	text: string;
	unsupportedToolOutput: boolean;
	images: AgentResponseImage[];
	partialImages: AgentPartialImage[];
	rawResponsePayload: string | null;
	toolCalls: AgentToolCallSummary[];
	toolCallCount: number;
}

export { isOfficialOpenAIResponsesEndpoint } from '$lib/domain/agent-routing';

export type AgentContextStrategy = 'server-chain' | 'local-history';

export function buildAgentResponsesRequest(input: BuildAgentResponsesRequestInput): NativeJsonRequest {
	const contextStrategy: AgentContextStrategy = isOfficialOpenAIResponsesEndpoint(input.profile.baseUrl)
		? 'server-chain'
		: 'local-history';
	const previousResponseId =
		contextStrategy === 'server-chain' ? findPreviousResponseId(input.conversation, input.roundId) : null;
	const tools: Array<Record<string, unknown>> = [
		buildAgentImageTool(
			input.params,
			input.intent,
			input.mask,
			input.partialImages
		)
	];
	if (input.settings.agentWebSearch) {
		tools.unshift({ type: 'web_search' });
	}

	const body: Record<string, unknown> = {
		model: input.profile.model,
		input: createAgentResponsesInput(
			input.conversation,
			input.roundId,
			input.prompt,
			input.inputImages,
			contextStrategy
		),
		tools,
		tool_choice: 'auto',
		stream: input.stream,
		instructions: createAgentInstructions(input.settings.agentMaxToolRounds)
	};
	if (contextStrategy === 'server-chain') {
		body.store = true;
		if (previousResponseId) body.previous_response_id = previousResponseId;
	}

	return {
		url: buildApiUrl(input.profile.baseUrl, 'responses'),
		method: 'POST',
		headers: {
			Authorization: `Bearer ${input.profile.apiKey}`,
			'Content-Type': 'application/json'
		},
		body,
		timeoutSecs: input.profile.timeoutSecs
	};
}

export function parseAgentResponsesPayload(
	payload: unknown,
	outputFormat: TaskParams['output_format']
): AgentResponsesResult {
	const output = isRecord(payload) && Array.isArray(payload.output) ? payload.output : [];
	const sanitizedText = sanitizeUnsupportedToolOutput(readResponseText(payload, output));
	const imageResult = readImageGenerationItems(output, outputFormat);
	const toolCalls = readToolCalls(output);
	return {
		responseId: isRecord(payload) ? (getString(payload.id) ?? null) : null,
		text: sanitizedText.text,
		unsupportedToolOutput: sanitizedText.unsupportedToolOutput,
		images: imageResult.images,
		partialImages: [],
		rawResponsePayload: safeStringify(payload),
		toolCalls,
		toolCallCount: toolCalls.length
	};
}

export function parseAgentResponsesStreamEvents(
	events: Array<Record<string, unknown>>,
	outputFormat: TaskParams['output_format']
): AgentResponsesResult {
	const textDeltas: string[] = [];
	const outputItems: unknown[] = [];
	const partialImages: AgentPartialImage[] = [];
	let completedPayload: unknown = null;

	for (const event of events) {
		const type = getString(event.type);
		if (type === 'response.output_text.delta' || type === 'response.refusal.delta') {
			const delta = getRawString(event.delta);
			if (delta) textDeltas.push(delta);
			continue;
		}
		if (type === 'response.output_text.done') {
			const text = getString(event.text);
			if (text && !textDeltas.length) textDeltas.push(text);
			continue;
		}
		if (type === 'response.image_generation_call.partial_image') {
			const partialImage = parseAgentPartialImageEvent(event, outputFormat);
			if (partialImage) partialImages.push(partialImage);
			continue;
		}
		if (type === 'response.output_item.done' && isRecord(event.item)) {
			outputItems.push(event.item);
			continue;
		}
		if (
			(type === 'response.completed' || type === 'response.failed' || type === 'response.incomplete') &&
			isRecord(event.response)
		) {
			completedPayload = event.response;
		}
	}

	const base = completedPayload
		? parseAgentResponsesPayload(completedPayload, outputFormat)
		: parseAgentResponsesPayload({ output: outputItems }, outputFormat);
	const streamedText = sanitizeUnsupportedToolOutput(textDeltas.join(''));
	return {
		...base,
		text: base.text || streamedText.text,
		unsupportedToolOutput: base.unsupportedToolOutput || streamedText.unsupportedToolOutput,
		partialImages,
		rawResponsePayload: safeStringify({
			...(completedPayload && isRecord(completedPayload) ? completedPayload : { output: outputItems }),
			streamEventCount: events.length
		})
	};
}

export function sanitizeUnsupportedToolOutput(value: string): {
	text: string;
	unsupportedToolOutput: boolean;
} {
	const hasXmlToolCall = /<tool_call\b/i.test(value);
	const hasPseudoToolCall =
		/(?:^|\n)\s*to=(?:multi_tool_use\.[\w.-]+|functions\.[\w.-]+)\b/i.test(value) ||
	/"recipient_name"\s*:\s*"(?:functions|multi_tool_use)\.[\w.-]+"/i.test(value);
	if (!hasXmlToolCall && !hasPseudoToolCall) {
		return { text: value.trim(), unsupportedToolOutput: false };
	}
	let text = value.replace(/<tool_call\b[^>]*>[\s\S]*?(?:<\/tool_call\s*>|$)/gi, '');
	if (hasPseudoToolCall) text = removePseudoToolCallText(text);
	text = text.replace(/\n{3,}/g, '\n\n').trim();
	return { text, unsupportedToolOutput: true };
}

export function createAgentAssistantFallbackText(
	result: AgentResponsesResult,
	expectedImages: TaskParams['n']
): string {
	if (result.text.trim()) return result.text.trim();
	if (result.images.length) {
		return expectedImages === 'auto'
			? `已生成 ${result.images.length} 张图片。`
			: `已生成 ${result.images.length}/${expectedImages} 张图片。`;
	}
	if (result.partialImages.length) return `已收到 ${result.partialImages.length} 张 partial 图片，但没有最终图。`;
	if (result.toolCalls.some((toolCall) => toolCall.type === 'image_generation_call')) {
		return '图片工具已执行，但没有返回最终图片。';
	}
	return '这轮没有返回文字或工具结果。';
}

export function hasMeaningfulAgentResponse(result: AgentResponsesResult): boolean {
	return Boolean(
		result.text.trim() ||
		result.images.length ||
		result.partialImages.length ||
		result.toolCalls.some((toolCall) => toolCall.type === 'image_generation_call')
	);
}

export function parseAgentImageToolStartEvent(event: Record<string, unknown>): AgentImageToolStart | null {
	const type = getString(event.type);
	const item = isRecord(event.item) ? event.item : null;
	if (type === 'response.output_item.added' && item?.type === 'image_generation_call') {
		return {
			toolCallId: getString(item.id) ?? getImageToolCallFallbackId(event),
			action: getString(item.action),
			prompt: getString(item.revised_prompt)
		};
	}
	if (type === 'response.image_generation_call.in_progress' || type === 'response.image_generation_call.generating') {
		return {
			toolCallId: getString(event.item_id) ?? getImageToolCallFallbackId(event),
			action: getString(event.action),
			prompt: getString(event.revised_prompt)
		};
	}
	return null;
}

export function parseAgentPartialImageEvent(
	event: Record<string, unknown>,
	outputFormat: TaskParams['output_format']
): AgentPartialImage | null {
	if (getString(event.type) !== 'response.image_generation_call.partial_image') return null;
	const b64 = getString(event.partial_image_b64);
	if (!b64) return null;
	return {
		toolCallId: getString(event.item_id) ?? getImageToolCallFallbackId(event),
		dataUrl: normalizeBase64Image(b64, MIME_MAP[outputFormat] ?? 'image/png'),
		partialImageIndex: getFiniteNumber(event.partial_image_index)
	};
}

export function getAgentStreamFailureMessage(events: Array<Record<string, unknown>>): string | null {
	for (let index = events.length - 1; index >= 0; index -= 1) {
		const event = events[index];
		const type = getString(event.type);
		if (type !== 'response.failed' && type !== 'response.incomplete') continue;
		const response = isRecord(event.response) ? event.response : null;
		const error = response && isRecord(response.error) ? response.error : isRecord(event.error) ? event.error : null;
		const message = error ? getString(error.message) : undefined;
		return message ?? (type === 'response.incomplete' ? 'Agent 响应未完整结束' : 'Agent 响应失败');
	}
	return null;
}

export function getAgentRequestBlockReason(profile: ApiProfile, settings: AppSettings): string | null {
	if (profile.provider !== 'openai') return 'Agent 模式目前使用 OpenAI Responses API，请选择 OpenAI 配置。';
	if (profile.apiProtocol !== 'openai-responses') {
		return 'Agent 模式需要 OpenAI Responses API 协议，请在 API 设置中切换接口协议。';
	}
	if (!profile.apiKey.trim()) return '需要先配置 API Key';
	const profileBlockReason = getProfileRequestBlockReason(profile, settings);
	if (profileBlockReason) return profileBlockReason;
	if (settings.agentMaxToolRounds < 1) return 'Agent 最大工具轮数配置无效';
	return null;
}

export function enforceAgentToolBudget(result: AgentResponsesResult, maxToolRounds: number): AgentResponsesResult {
	const normalizedMax = Math.max(1, Math.trunc(maxToolRounds));
	if (result.toolCallCount <= normalizedMax) return result;
	throw new Error(`Agent 工具调用超过上限：${result.toolCallCount}/${normalizedMax}`);
}

function buildAgentImageTool(
	params: TaskParams,
	intent: AgentRoundIntent,
	mask: MaskDraft | null,
	partialImages: number
) {
	const tool: Record<string, unknown> = {
		type: 'image_generation',
		action: intent === 'image-edit' ? 'edit' : intent === 'image-generate' ? 'generate' : 'auto',
		size: params.size,
		quality: params.quality,
		output_format: params.output_format,
		moderation: params.moderation
	};
	if (params.output_format !== 'png' && params.output_compression != null) {
		tool.output_compression = params.output_compression;
	}
	if (mask) tool.input_image_mask = { image_url: mask.dataUrl };
	if (partialImages > 0) tool.partial_images = Math.min(3, Math.max(0, Math.trunc(partialImages)));
	return tool;
}

export function createAgentResponsesInput(
	conversation: AgentConversation,
	roundId: string,
	prompt: string,
	inputImages: InputImage[],
	contextStrategy: AgentContextStrategy
) {
	const currentMessage = {
		role: 'user' as const,
		content: inputImages.length
			? [
					{ type: 'input_text', text: prompt },
					...inputImages.map((image) => ({
						type: 'input_image',
						image_url: image.dataUrl
					}))
				]
			: prompt
	};
	if (contextStrategy === 'server-chain') return inputImages.length ? [currentMessage] : prompt;
	return [...createAgentLocalHistory(conversation, roundId), currentMessage];
}

function createAgentLocalHistory(conversation: AgentConversation, roundId: string) {
	const currentRound = conversation.rounds.find((round) => round.id === roundId);
	if (!currentRound) return [];
	const roundsById = new Map(conversation.rounds.map((round) => [round.id, round]));
	return conversation.messages.flatMap((message) => {
		const round = roundsById.get(message.roundId);
		if (!round || round.index >= currentRound.index) return [];
		const content =
			message.role === 'assistant' ? sanitizeUnsupportedToolOutput(message.content).text : message.content.trim();
		if (!content) return [];
		if (
			message.role === 'assistant' &&
			((round.status !== 'done' && round.status !== 'partial') ||
				Boolean(round.error) ||
				content === '正在思考...' ||
				content.startsWith('Agent 失败：'))
		) {
			return [];
		}
		return [{ role: message.role, content }];
	});
}

function createAgentInstructions(maxToolRounds: number) {
	const normalizedMax = Math.max(1, Math.trunc(maxToolRounds));
	return [
		'You are ImagePort Desktop Agent, an image-creation assistant in a multi-turn workspace.',
		`Do not exceed ${normalizedMax} tool calls in this turn.`,
		'Only call image_generation when the user explicitly asks to create or edit an image; otherwise reply with text.',
		'When creating or editing images, use the image_generation tool and keep visible text concise.'
	].join('\n');
}

function findPreviousResponseId(conversation: AgentConversation, roundId: string) {
	const currentRound = conversation.rounds.find((round) => round.id === roundId);
	const currentIndex = currentRound?.index ?? Number.MAX_SAFE_INTEGER;
	return (
		[...conversation.rounds]
			.filter((round) => round.id !== roundId && round.index < currentIndex && round.responseId)
			.sort((a, b) => b.index - a.index)[0]?.responseId ?? null
	);
}

function readResponseText(payload: unknown, output: unknown[]) {
	if (isRecord(payload) && typeof payload.output_text === 'string' && payload.output_text.trim())
		return payload.output_text.trim();
	const chunks: string[] = [];
	for (const item of output) {
		if (!isRecord(item)) continue;
		if (typeof item.text === 'string' && item.text.trim()) chunks.push(item.text);
		if (!Array.isArray(item.content)) continue;
		for (const content of item.content) {
			if (!isRecord(content)) continue;
			const text = getString(content.text);
			if (text) chunks.push(text);
		}
	}
	return chunks.join('\n').trim();
}

function readImageGenerationItems(output: unknown[], outputFormat: TaskParams['output_format']) {
	const mime = MIME_MAP[outputFormat] ?? 'image/png';
	const images: AgentResponseImage[] = [];
	let imageCallIndex = 0;
	for (const item of output) {
		if (!isRecord(item) || item.type !== 'image_generation_call') continue;
		const toolCallId = getString(item.id) ?? `image-call-${imageCallIndex + 1}`;
		imageCallIndex += 1;
		const b64 = readImageResultBase64(item.result);
		if (!b64) continue;
		images.push({
			toolCallId,
			dataUrl: normalizeBase64Image(b64, mime),
			action: getString(item.action),
			revisedPrompt: getString(item.revised_prompt),
			actualParams: pickActualParamsFromRecord(item)
		});
	}
	return { images };
}

function readToolCalls(output: unknown[]): AgentToolCallSummary[] {
	const toolCalls: AgentToolCallSummary[] = [];
	let imageCallIndex = 0;
	for (const item of output.filter(isRecord)) {
		const type = getString(item.type);
		if (!type || (!type.endsWith('_call') && type !== 'web_search_call')) continue;
		const id =
			type === 'image_generation_call'
				? (getString(item.id) ?? `image-call-${imageCallIndex + 1}`)
				: (getString(item.id) ?? null);
		if (type === 'image_generation_call') imageCallIndex += 1;
		toolCalls.push({
			id,
			type,
			status: getString(item.status) ?? null,
			title: getToolCallTitle(item)
		});
	}
	return toolCalls;
}

function getToolCallTitle(item: Record<string, unknown>) {
	const query = getString(item.query);
	if (query) return query;
	const action = getString(item.action);
	if (action) return action;
	const revisedPrompt = getString(item.revised_prompt);
	if (revisedPrompt) return revisedPrompt;
	return null;
}

function readImageResultBase64(result: unknown): string | undefined {
	if (typeof result === 'string' && result.trim()) return result;
	if (!isRecord(result)) return undefined;
	for (const key of ['b64_json', 'base64', 'image', 'data']) {
		const value = result[key];
		if (typeof value === 'string' && value.trim()) return value;
	}
	return undefined;
}

function pickActualParamsFromRecord(record: Record<string, unknown>): Partial<TaskParams> | undefined {
	const params: Partial<TaskParams> = {};
	const size = getString(record.size);
	if (size) params.size = size;
	const quality = getString(record.quality);
	if (quality === 'auto' || quality === 'low' || quality === 'medium' || quality === 'high') params.quality = quality;
	const outputFormat = getString(record.output_format);
	if (outputFormat === 'png' || outputFormat === 'jpeg' || outputFormat === 'webp') params.output_format = outputFormat;
	const outputCompression = record.output_compression;
	if (typeof outputCompression === 'number' && Number.isFinite(outputCompression))
		params.output_compression = outputCompression;
	const moderation = getString(record.moderation);
	if (moderation === 'auto' || moderation === 'low') params.moderation = moderation;
	const count = normalizeOutputImageCount(record.n, null);
	if (count != null) params.n = count;
	return Object.keys(params).length ? params : undefined;
}

function normalizeBase64Image(value: string, fallbackMime: string): string {
	return value.startsWith('data:') ? value : `data:${fallbackMime};base64,${value}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getString(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function getRawString(value: unknown): string | undefined {
	return typeof value === 'string' && value.length ? value : undefined;
}

function getFiniteNumber(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function getImageToolCallFallbackId(event: Record<string, unknown>) {
	const outputIndex = getFiniteNumber(event.output_index) ?? 0;
	return `image-call-${outputIndex + 1}`;
}

function safeStringify(value: unknown) {
	try {
		return JSON.stringify(value);
	} catch {
		return null;
	}
}

function removePseudoToolCallText(value: string) {
	const marker = /(?:^|\n)\s*to=(?:multi_tool_use\.[\w.-]+|functions\.[\w.-]+)\b[^\n]*/i.exec(value);
	if (!marker || marker.index < 0) return value;
	const start = marker.index;
	const afterMarker = start + marker[0].length;
	const remainder = value.slice(afterMarker);
	const jsonStart = remainder.search(/[[{]/);
	if (jsonStart < 0) return `${value.slice(0, start)}${remainder}`;
	const absoluteJsonStart = afterMarker + jsonStart;
	const jsonEnd = findBalancedJsonEnd(value, absoluteJsonStart);
	if (jsonEnd === -1) return `${value.slice(0, start)}${value.slice(absoluteJsonStart)}`;
	return `${value.slice(0, start)}${value.slice(jsonEnd + 1)}`;
}

function findBalancedJsonEnd(value: string, start: number) {
	const opening = value[start];
	if (opening !== '{' && opening !== '[') return -1;
	const closing = opening === '{' ? '}' : ']';
	let depth = 0;
	let inString = false;
	let escaped = false;
	for (let index = start; index < value.length; index += 1) {
		const char = value[index];
		if (inString) {
			if (escaped) escaped = false;
			else if (char === '\\') escaped = true;
			else if (char === '"') inString = false;
			continue;
		}
		if (char === '"') {
			inString = true;
			continue;
		}
		if (char === opening) depth += 1;
		else if (char === closing) {
			depth -= 1;
			if (depth === 0) return index;
		}
	}
	return -1;
}
