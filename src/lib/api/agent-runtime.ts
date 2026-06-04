import { buildApiUrl } from '$lib/domain/url';
import type { AgentConversation, AgentToolCallSummary } from '$lib/domain/agent';
import type { ApiProfile, AppSettings } from '$lib/domain/settings';
import { normalizeOutputImageCount, type InputImage, type MaskDraft, type NativeJsonRequest, type TaskParams } from '$lib/domain/types';

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
	prompt: string;
	params: TaskParams;
	inputImages: InputImage[];
	mask: MaskDraft | null;
	stream: boolean;
	partialImages: number;
}

export interface AgentResponsesResult {
	responseId: string | null;
	text: string;
	images: string[];
	partialImages: string[];
	revisedPrompts: Array<string | undefined>;
	actualParamsList: Array<Partial<TaskParams> | undefined>;
	actualParams: Partial<TaskParams> | null;
	rawResponsePayload: string | null;
	toolCalls: AgentToolCallSummary[];
	toolCallCount: number;
}

export function buildAgentResponsesRequest(input: BuildAgentResponsesRequestInput): NativeJsonRequest {
	const previousResponseId = findPreviousResponseId(input.conversation, input.roundId);
	const tools: Array<Record<string, unknown>> = [
		buildAgentImageTool(input.params, input.inputImages.length > 0 || Boolean(input.mask), input.mask, input.partialImages)
	];
	if (input.settings.agentWebSearch) {
		tools.unshift({ type: 'web_search' });
	}

	const body: Record<string, unknown> = {
		model: input.profile.model,
		input: createAgentResponsesInput(input.prompt, input.inputImages),
		tools,
		tool_choice: 'auto',
		stream: input.stream,
		instructions: createAgentInstructions(input.settings.agentMaxToolRounds)
	};
	if (previousResponseId) body.previous_response_id = previousResponseId;

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

export function parseAgentResponsesPayload(payload: unknown, outputFormat: TaskParams['output_format']): AgentResponsesResult {
	const output = isRecord(payload) && Array.isArray(payload.output) ? payload.output : [];
	const text = readResponseText(payload, output);
	const imageResult = readImageGenerationItems(output, outputFormat);
	const toolCalls = readToolCalls(output);
	return {
		responseId: isRecord(payload) ? getString(payload.id) ?? null : null,
		text,
		images: imageResult.images,
		partialImages: [],
		revisedPrompts: imageResult.revisedPrompts,
		actualParamsList: imageResult.actualParamsList,
		actualParams: imageResult.actualParamsList.find((item) => item && Object.keys(item).length > 0) ?? null,
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
	const partialImages: string[] = [];
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
			const b64 = getString(event.partial_image_b64);
			if (b64) partialImages.push(normalizeBase64Image(b64, MIME_MAP[outputFormat] ?? 'image/png'));
			continue;
		}
		if (type === 'response.output_item.done' && isRecord(event.item)) {
			outputItems.push(event.item);
			continue;
		}
		if ((type === 'response.completed' || type === 'response.failed' || type === 'response.incomplete') && isRecord(event.response)) {
			completedPayload = event.response;
		}
	}

	const base = completedPayload
		? parseAgentResponsesPayload(completedPayload, outputFormat)
		: parseAgentResponsesPayload({ output: outputItems }, outputFormat);
	const streamedText = textDeltas.join('');
	return {
		...base,
		text: base.text || streamedText,
		partialImages,
		rawResponsePayload: safeStringify({
			...(completedPayload && isRecord(completedPayload) ? completedPayload : { output: outputItems }),
			streamEventCount: events.length
		})
	};
}

export function createAgentAssistantFallbackText(result: AgentResponsesResult, expectedImages: TaskParams['n']): string {
	if (result.text.trim()) return result.text.trim();
	if (result.images.length) {
		return expectedImages === 'auto'
			? `已生成 ${result.images.length} 张图片。`
			: `已生成 ${result.images.length}/${expectedImages} 张图片。`;
	}
	if (result.partialImages.length) return `已收到 ${result.partialImages.length} 张 partial 图片，但没有最终图。`;
	return '这轮没有返回文字或图片。';
}

export function getAgentRequestBlockReason(profile: ApiProfile, settings: AppSettings): string | null {
	if (profile.provider !== 'openai') return 'Agent 模式目前使用 OpenAI Responses API，请选择 OpenAI 配置。';
	if (profile.apiMode !== 'responses') return 'Agent 模式需要 Responses API 配置，请在 API 设置中切换到 Responses。';
	if (!profile.apiKey.trim()) return '需要先配置 API Key';
	if (settings.agentMaxToolRounds < 1) return 'Agent 最大工具轮数配置无效';
	return null;
}

export function enforceAgentToolBudget(result: AgentResponsesResult, maxToolRounds: number): AgentResponsesResult {
	const normalizedMax = Math.max(1, Math.trunc(maxToolRounds));
	if (result.toolCallCount <= normalizedMax) return result;
	throw new Error(`Agent 工具调用超过上限：${result.toolCallCount}/${normalizedMax}`);
}

function buildAgentImageTool(params: TaskParams, isEdit: boolean, mask: MaskDraft | null, partialImages: number) {
	const tool: Record<string, unknown> = {
		type: 'image_generation',
		action: isEdit ? 'edit' : 'auto',
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

function createAgentResponsesInput(prompt: string, inputImages: InputImage[]) {
	if (!inputImages.length) return prompt;
	return [
		{
			role: 'user',
			content: [
				{ type: 'input_text', text: prompt },
				...inputImages.map((image) => ({
					type: 'input_image',
					image_url: image.dataUrl
				}))
			]
		}
	];
}

function createAgentInstructions(maxToolRounds: number) {
	const normalizedMax = Math.max(1, Math.trunc(maxToolRounds));
	return [
		'You are ImagePort Desktop Agent, focused on image generation and editing.',
		`Do not exceed ${normalizedMax} tool calls in this turn.`,
		'When creating or editing images, use the image_generation tool and keep text concise.'
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
	if (isRecord(payload) && typeof payload.output_text === 'string' && payload.output_text.trim()) return payload.output_text.trim();
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
	const images: string[] = [];
	const revisedPrompts: Array<string | undefined> = [];
	const actualParamsList: Array<Partial<TaskParams> | undefined> = [];
	for (const item of output) {
		if (!isRecord(item) || item.type !== 'image_generation_call') continue;
		const b64 = readImageResultBase64(item.result);
		if (!b64) continue;
		images.push(normalizeBase64Image(b64, mime));
		revisedPrompts.push(getString(item.revised_prompt));
		actualParamsList.push(pickActualParamsFromRecord(item));
	}
	return { images, revisedPrompts, actualParamsList };
}

function readToolCalls(output: unknown[]): AgentToolCallSummary[] {
	return output.filter(isRecord).flatMap((item) => {
		const type = getString(item.type);
		if (!type || (!type.endsWith('_call') && type !== 'web_search_call')) return [];
		return [
			{
				id: getString(item.id) ?? null,
				type,
				status: getString(item.status) ?? null,
				title: getToolCallTitle(item)
			}
		];
	});
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
	if (typeof outputCompression === 'number' && Number.isFinite(outputCompression)) params.output_compression = outputCompression;
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

function safeStringify(value: unknown) {
	try {
		return JSON.stringify(value);
	} catch {
		return null;
	}
}
