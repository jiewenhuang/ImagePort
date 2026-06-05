import {
	buildCustomPollRequest,
	buildImageProviderRequestGroup,
	getCustomPollState,
	parseImageStreamEvents,
	readCustomTaskId,
	type ProviderNativeRequest
} from './provider-adapter';
import { createJsonServerSentEventCollector } from './server-sent-events';
import { summarizeImageRequestGroup, type ImageRequestGroupSummary } from './image-request-group';
import { getNativeResponseErrorMessage } from './http-error';
import type {
	CallApiResult,
	InputImage,
	MaskDraft,
	NativeJsonRequest,
	NativeJsonResponse,
	NativeMultipartRequest,
	NativeMultipartStreamRequest,
	NativeStreamRequest,
	TaskParams
} from '$lib/domain/types';
import type { ApiProfile, AppSettings } from '$lib/domain/settings';

export interface GalleryImageRunnerDependencies {
	nativeJsonRequest(request: NativeJsonRequest): Promise<NativeJsonResponse>;
	nativeMultipartRequest(request: NativeMultipartRequest): Promise<NativeJsonResponse>;
	nativeJsonStreamRequest(request: NativeStreamRequest, onChunk: (chunk: string) => void): Promise<NativeJsonResponse>;
	nativeMultipartStreamRequest(
		request: NativeMultipartStreamRequest,
		onChunk: (chunk: string) => void
	): Promise<NativeJsonResponse>;
	downloadImageAsDataUrl(url: string, fallbackMime: string): Promise<string>;
	onPartialImages(taskId: string, partialImages: string[]): void;
	createRequestId(): string;
}

export interface GalleryImageRunnerInput extends GalleryImageRunnerDependencies {
	taskId: string;
	settings: AppSettings;
	profile: ApiProfile;
	prompt: string;
	params: TaskParams;
	inputImages: InputImage[];
	mask: MaskDraft | null;
}

export async function runGalleryImageRequestGroup(input: GalleryImageRunnerInput): Promise<ImageRequestGroupSummary> {
	const outputFormat = input.params.output_format;
	const group = buildImageProviderRequestGroup({
		settings: input.settings,
		profile: input.profile,
		prompt: input.prompt,
		params: input.params,
		inputImages: input.inputImages,
		mask: input.mask
	});
	const requestPromises = group.requests.map((request) =>
		requestProviderNativeResponse(request, outputFormat, input.profile, input.taskId, input)
	);

	return summarizeImageRequestGroup(await Promise.allSettled(requestPromises));
}

async function requestProviderNativeResponse(
	providerRequest: ProviderNativeRequest,
	outputFormat: TaskParams['output_format'],
	profile: ApiProfile,
	taskId: string,
	deps: GalleryImageRunnerDependencies
): Promise<CallApiResult> {
	if (profile.provider === 'openai' && profile.streamImages) {
		return requestStreamImageResponse(providerRequest, outputFormat, taskId, deps);
	}
	const response = await sendProviderNativeRequest(providerRequest, deps);
	if (response.status < 200 || response.status >= 300) {
		throw new Error(getNativeResponseErrorMessage(response.body, response.status));
	}

	const payload = await resolveCustomQueuePayload(response.body, profile, providerRequest, deps);
	const result = providerRequest.parse(payload);
	const downloadedImages = result.rawImageUrls?.length
		? await Promise.all(
				result.rawImageUrls.map((url) =>
					deps.downloadImageAsDataUrl(url, `image/${outputFormat === 'jpeg' ? 'jpeg' : outputFormat}`)
				)
			)
		: [];
	return {
		...result,
		images: [...result.images, ...downloadedImages]
	};
}

async function requestStreamImageResponse(
	providerRequest: ProviderNativeRequest,
	outputFormat: TaskParams['output_format'],
	taskId: string,
	deps: GalleryImageRunnerDependencies
): Promise<CallApiResult> {
	const events: Array<Record<string, unknown>> = [];
	const requestId = deps.createRequestId();
	let lastPartialImageCount = 0;
	const collector = createJsonServerSentEventCollector((event) => {
		events.push(event);
		const partialImages = parseImageStreamPartialImages(events, outputFormat);
		if (partialImages.length > lastPartialImageCount) {
			lastPartialImageCount = partialImages.length;
			deps.onPartialImages(taskId, partialImages);
		}
	});
	const response =
		providerRequest.kind === 'multipart'
			? await deps.nativeMultipartStreamRequest(
					{
						...providerRequest.request,
						requestId
					},
					(chunk) => collector.push(chunk)
				)
			: await deps.nativeJsonStreamRequest(
					{
						...providerRequest.request,
						requestId
					},
					(chunk) => collector.push(chunk)
				);
	collector.finish();
	if (response.status < 200 || response.status >= 300) {
		throw new Error(getNativeResponseErrorMessage(response.body, response.status));
	}
	const parsed = parseImageStreamEvents(events, outputFormat);
	return {
		...parsed.result,
		streamPartialImages: parsed.partialImages
	};
}

function sendProviderNativeRequest(providerRequest: ProviderNativeRequest, deps: GalleryImageRunnerDependencies) {
	const requestId = deps.createRequestId();
	if (providerRequest.kind === 'multipart') {
		return deps.nativeMultipartRequest({ ...providerRequest.request, requestId });
	}
	return deps.nativeJsonRequest({ ...providerRequest.request, requestId });
}

async function resolveCustomQueuePayload(
	payload: unknown,
	profile: ApiProfile,
	providerRequest: ProviderNativeRequest,
	deps: GalleryImageRunnerDependencies
) {
	if (!providerRequest.customAsync) return payload;
	const taskId = readCustomTaskId(payload, providerRequest.customAsync.submit);
	if (!taskId) return payload;
	const deadline = Date.now() + Math.max(1, profile.timeoutSecs) * 1000;
	const poll = providerRequest.customAsync.poll;
	while (Date.now() < deadline) {
		await sleep(Math.max(1, poll.intervalSeconds ?? 5) * 1000);
		const pollResponse = await deps.nativeJsonRequest({
			...buildCustomPollRequest(profile, poll, taskId),
			requestId: deps.createRequestId()
		});
		if (pollResponse.status < 200 || pollResponse.status >= 300) {
			throw new Error(getNativeResponseErrorMessage(pollResponse.body, pollResponse.status));
		}
		const state = getCustomPollState(pollResponse.body, poll);
		if (state === 'failure') throw new Error(getNativeResponseErrorMessage(pollResponse.body, pollResponse.status));
		if (state === 'success') return pollResponse.body;
	}
	throw new Error('自定义服务商异步任务等待超时');
}

function sleep(ms: number) {
	return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

function parseImageStreamPartialImages(
	events: Array<Record<string, unknown>>,
	outputFormat: TaskParams['output_format']
): string[] {
	try {
		return parseImageStreamEvents(events, outputFormat).partialImages;
	} catch {
		return events.flatMap((event) => readPartialImageFromEvent(event, outputFormat));
	}
}

function readPartialImageFromEvent(
	event: Record<string, unknown>,
	outputFormat: TaskParams['output_format']
): string[] {
	const type = typeof event.type === 'string' ? event.type : '';
	const object = typeof event.object === 'string' ? event.object : '';
	const mime = `image/${outputFormat === 'jpeg' ? 'jpeg' : outputFormat}`;
	if (
		type === 'image_generation.partial_image' ||
		type === 'image_edit.partial_image' ||
		object.endsWith('.partial_image')
	) {
		const b64 = typeof event.b64_json === 'string' ? event.b64_json : null;
		return b64 ? [`data:${mime};base64,${b64}`] : [];
	}
	if (type === 'response.image_generation_call.partial_image') {
		const b64 = typeof event.partial_image_b64 === 'string' ? event.partial_image_b64 : null;
		return b64 ? [`data:${mime};base64,${b64}`] : [];
	}
	return [];
}
