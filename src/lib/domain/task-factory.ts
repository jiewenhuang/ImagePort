import { createEmptyTaskMetadata, type InputImage, type MaskDraft, type TaskParams, type TaskRecord } from './types';
import type { ApiProfile } from './settings';

export type RunningTaskInput = {
	taskId: string;
	taskPrompt: string;
	taskParams: TaskParams;
	taskInputImages: InputImage[];
	taskMask: MaskDraft | null;
	sourceMode: 'gallery' | 'agent';
	profile: ApiProfile;
	agentConversationId?: string;
	agentRoundId?: string;
	agentMessageId?: string;
	agentToolCallId?: string;
	agentToolAction?: string;
};

export function createRunningTask(input: RunningTaskInput): TaskRecord {
	const createdAt = Date.now();
	const task: TaskRecord = {
		id: input.taskId,
		prompt: input.taskPrompt,
		params: input.taskParams,
		inputImages: input.taskInputImages,
		mask: input.taskMask,
		images: [],
		status: 'running',
		error: null,
		createdAt,
		finishedAt: null,
		failureCount: 0,
		...createEmptyTaskMetadata(),
		apiProfileId: input.profile.id,
		apiProfileName: input.profile.name,
		apiProvider: input.profile.provider,
		apiMode: input.profile.apiMode,
		apiProtocol: input.profile.apiProtocol,
		model: input.profile.model,
		sourceMode: input.sourceMode,
		agentConversationId: input.agentConversationId ?? null,
		agentRoundId: input.agentRoundId ?? null,
		agentMessageId: input.agentMessageId ?? null,
		agentToolCallId: input.agentToolCallId ?? null,
		agentToolAction: input.agentToolAction ?? null
	};
	return task;
}
