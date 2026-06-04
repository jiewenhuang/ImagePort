import {
	buildAgentResponsesRequest,
	enforceAgentToolBudget,
	parseAgentResponsesPayload,
	parseAgentResponsesStreamEvents,
	type AgentResponsesResult
} from './agent-runtime';
import { getNativeResponseErrorMessage } from './http-error';
import { createJsonServerSentEventCollector } from './server-sent-events';
import type { AgentConversation } from '$lib/domain/agent';
import type { ApiProfile, AppSettings } from '$lib/domain/settings';
import type {
	InputImage,
	MaskDraft,
	NativeJsonRequest,
	NativeJsonResponse,
	NativeStreamRequest,
	TaskParams
} from '$lib/domain/types';

export interface AgentResponsesRunnerInput {
	conversation: AgentConversation;
	roundId: string;
	taskId: string;
	profile: ApiProfile;
	settings: AppSettings;
	prompt: string;
	params: TaskParams;
	inputImages: InputImage[];
	mask: MaskDraft | null;
	createRequestId(): string;
	nativeJsonRequest(request: NativeJsonRequest): Promise<NativeJsonResponse>;
	nativeJsonStreamRequest(request: NativeStreamRequest, onChunk: (chunk: string) => void): Promise<NativeJsonResponse>;
	onActiveRequestId(requestId: string | null): void;
	onText(conversationId: string, roundId: string, content: string): void;
	onPartialImages(taskId: string, partialImages: string[]): void;
	isCanceled(): boolean;
}

export async function runAgentResponsesRequest(input: AgentResponsesRunnerInput): Promise<AgentResponsesResult> {
	const shouldStream = input.profile.streamImages;
	const request = buildAgentResponsesRequest({
		profile: input.profile,
		settings: input.settings,
		conversation: input.conversation,
		roundId: input.roundId,
		prompt: input.prompt,
		params: input.params,
		inputImages: input.inputImages,
		mask: input.mask,
		stream: shouldStream,
		partialImages: shouldStream ? input.profile.streamPartialImages : 0
	});
	const requestId = input.createRequestId();
	input.onActiveRequestId(requestId);
	try {
		if (!shouldStream) {
			const response = await input.nativeJsonRequest({ ...request, requestId });
			if (input.isCanceled()) throw new Error('用户停止了 Agent 轮次');
			if (response.status < 200 || response.status >= 300) {
				throw new Error(getNativeResponseErrorMessage(response.body, response.status));
			}
			return enforceAgentToolBudget(
				parseAgentResponsesPayload(response.body, input.params.output_format),
				input.settings.agentMaxToolRounds
			);
		}

		const events: Array<Record<string, unknown>> = [];
		let lastText = '';
		let lastPartialImageCount = 0;
		const collector = createJsonServerSentEventCollector((event) => {
			events.push(event);
			const parsed = parseAgentResponsesStreamEvents(events, input.params.output_format);
			if (parsed.text && parsed.text !== lastText) {
				lastText = parsed.text;
				input.onText(input.conversation.id, input.roundId, parsed.text);
			}
			if (parsed.partialImages.length > lastPartialImageCount) {
				lastPartialImageCount = parsed.partialImages.length;
				input.onPartialImages(input.taskId, parsed.partialImages);
			}
		});
		const response = await input.nativeJsonStreamRequest(
			{
				...request,
				requestId
			},
			(chunk) => collector.push(chunk)
		);
		collector.finish();
		if (input.isCanceled()) throw new Error('用户停止了 Agent 轮次');
		if (response.status < 200 || response.status >= 300) {
			throw new Error(getNativeResponseErrorMessage(response.body, response.status));
		}
		return enforceAgentToolBudget(
			parseAgentResponsesStreamEvents(events, input.params.output_format),
			input.settings.agentMaxToolRounds
		);
	} finally {
		input.onActiveRequestId(null);
	}
}
