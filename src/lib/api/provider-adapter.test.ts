import { describe, expect, test } from 'bun:test';
import type { NativeJsonRequest, NativeMultipartRequest } from '$lib/domain/types';
import { DEFAULT_SETTINGS, normalizeSettings } from '$lib/domain/settings';
import {
	buildCustomProviderRequestGroup,
	buildCustomPollRequest,
	buildResponsesImageRequest,
	buildImageProviderRequestGroup,
	getCustomPollState,
	readCustomTaskId,
	parseImageStreamEvents,
	parseCustomProviderResponse
} from './provider-adapter';

const params = {
	size: '1024x1024',
	quality: 'high',
	output_format: 'png',
	output_compression: null,
	moderation: 'auto',
	n: 2
} as const;

const autoCountParams = {
	...params,
	n: 'auto'
} as const;

describe('buildImageProviderRequestGroup', () => {
	test('keeps OpenAI Images requests split into single-image native requests', () => {
		const group = buildImageProviderRequestGroup({
			settings: DEFAULT_SETTINGS,
			profile: DEFAULT_SETTINGS.profiles[0],
			prompt: 'two gallery images',
			params,
			inputImages: [],
			mask: null
		});

		expect(group.provider).toBe('openai');
		expect(group.requests.length).toBe(2);
		expect(group.requests.every((request) => request.kind === 'json')).toBe(true);
		expect((group.requests[0].request as NativeJsonRequest).url).toBe('https://api.openai.com/v1/images/generations');
		expect((group.requests[0].request as NativeJsonRequest).body?.n).toBe(undefined);
	});

	test('builds OpenAI Responses image requests with reference images', () => {
		const request = buildResponsesImageRequest({
			settings: DEFAULT_SETTINGS,
			profile: { ...DEFAULT_SETTINGS.profiles[0], apiMode: 'responses', model: 'gpt-5.5' },
			prompt: 'edit this image',
			params: autoCountParams,
			inputImages: [{ id: 'image', name: 'input.png', dataUrl: 'data:image/png;base64,aW1hZ2U=' }],
			mask: { targetImageId: 'image', dataUrl: 'data:image/png;base64,bWFzaw==', updatedAt: 1 }
		});

		expect(request.url).toBe('https://api.openai.com/v1/responses');
		expect(request.body?.model).toBe('gpt-5.5');
		expect(request.body?.tools).toEqual([
			{
				type: 'image_generation',
				action: 'edit',
				size: '1024x1024',
				quality: 'high',
				output_format: 'png',
				moderation: 'auto',
				input_image_mask: { image_url: 'data:image/png;base64,bWFzaw==' }
			}
		]);
		expect(Array.isArray(request.body?.input)).toBe(true);
	});

	test('builds custom JSON requests from manifest templates', () => {
		const settings = normalizeSettings({
			customProviders: [
				{
					id: 'custom-lab',
					name: 'Lab',
					submit: {
						path: 'render',
						contentType: 'json',
						query: { async: 'false' },
						body: {
							prompt: '$prompt',
							model: '$profile.model',
							size: '$params.size',
							n: '$params.n'
						},
						result: { b64JsonPaths: ['data.*.b64_json'] }
					}
				}
			],
			profiles: [
				{
					...DEFAULT_SETTINGS.profiles[0],
					provider: 'custom-lab',
					baseUrl: 'https://lab.example.com/v1',
					model: 'lab-model'
				}
			]
		});
		const group = buildCustomProviderRequestGroup({
			settings,
			profile: settings.profiles[0],
			prompt: 'lab image',
			params,
			inputImages: [],
			mask: null
		});

		expect(group.requests.length).toBe(1);
		expect(group.requests[0].kind).toBe('json');
		const request = group.requests[0].request as NativeJsonRequest;
		expect(request.url).toBe('https://lab.example.com/v1/render?async=false');
		expect(request.body).toEqual({
			prompt: 'lab image',
			model: 'lab-model',
			size: '1024x1024',
			n: 2
		});
	});

	test('reads custom async task ids and builds poll requests', () => {
		const settings = normalizeSettings({
			customProviders: [
				{
					id: 'custom-async',
					name: 'Async',
					submit: {
						path: 'submit',
						taskIdPath: 'data.task_id',
						result: { b64JsonPaths: ['data.*.b64_json'] }
					},
					poll: {
						path: 'tasks/{task_id}',
						statusPath: 'data.status',
						successValues: ['done'],
						failureValues: ['failed'],
						result: { imageUrlPaths: ['data.images.*.url'] }
					}
				}
			],
			profiles: [
				{
					...DEFAULT_SETTINGS.profiles[0],
					provider: 'custom-async',
					baseUrl: 'https://async.example.com/v1'
				}
			]
		});
		const provider = settings.customProviders[0];
		const profile = settings.profiles[0];

		expect(readCustomTaskId({ data: { task_id: 'task-1' } }, provider.submit)).toBe('task-1');
		expect(getCustomPollState({ data: { status: 'done' } }, provider.poll!)).toBe('success');
		expect(getCustomPollState({ data: { status: 'queued' } }, provider.poll!)).toBe('pending');
		expect(getCustomPollState({ data: { status: 'failed' } }, provider.poll!)).toBe('failure');
		expect(buildCustomPollRequest(profile, provider.poll!, 'task-1').url).toBe(
			'https://async.example.com/v1/tasks/task-1'
		);
	});

	test('builds custom multipart edit requests from manifest file mappings', () => {
		const settings = normalizeSettings({
			customProviders: [
				{
					id: 'custom-edit',
					name: 'Edit',
					submit: { path: 'render', result: { b64JsonPaths: ['data.*.b64_json'] } },
					editSubmit: {
						path: 'edit',
						contentType: 'multipart',
						body: { prompt: '$prompt', model: '$profile.model' },
						files: [
							{ field: 'image', source: 'inputImages', array: true },
							{ field: 'mask', source: 'mask' }
						],
						result: { imageUrlPaths: ['images.*.url'] }
					}
				}
			],
			profiles: [
				{
					...DEFAULT_SETTINGS.profiles[0],
					provider: 'custom-edit',
					baseUrl: 'https://edit.example.com/v1',
					model: 'edit-model'
				}
			]
		});
		const group = buildCustomProviderRequestGroup({
			settings,
			profile: settings.profiles[0],
			prompt: 'edit this',
			params,
			inputImages: [{ id: 'image', name: 'input.png', dataUrl: 'data:image/png;base64,aW1hZ2U=' }],
			mask: { targetImageId: 'image', dataUrl: 'data:image/png;base64,bWFzaw==', updatedAt: 1 }
		});

		expect(group.requests.length).toBe(1);
		expect(group.requests[0].kind).toBe('multipart');
		const request = group.requests[0].request as NativeMultipartRequest;
		expect(request.url).toBe('https://edit.example.com/v1/edit');
		expect(request.fields).toEqual({ prompt: 'edit this', model: 'edit-model' });
		expect(request.files.map((file) => file.field)).toEqual(['image', 'mask']);
	});
});

describe('provider response parsing', () => {
	test('parses OpenAI-compatible stream events into partial and final images', () => {
		const parsed = parseImageStreamEvents(
			[
				{ type: 'image_generation.partial_image', b64_json: 'partial', partial_image_index: 0 },
				{ type: 'image_generation.completed', b64_json: 'final', revised_prompt: 'revised', size: '1024x1024' }
			],
			'png'
		);

		expect(parsed.partialImages).toEqual(['data:image/png;base64,partial']);
		expect(parsed.result.images).toEqual(['data:image/png;base64,final']);
		expect(parsed.result.revisedPrompts).toEqual(['revised']);
		expect(parsed.result.actualParamsList).toEqual([{ size: '1024x1024' }]);
	});

	test('parses Responses stream partial and output item events', () => {
		const parsed = parseImageStreamEvents(
			[
				{ type: 'response.image_generation_call.partial_image', partial_image_b64: 'partial', partial_image_index: 0 },
				{
					type: 'response.output_item.done',
					item: {
						type: 'image_generation_call',
						result: { b64_json: 'final' },
						revised_prompt: 'revised response',
						size: '1024x1024'
					}
				}
			],
			'png'
		);

		expect(parsed.partialImages).toEqual(['data:image/png;base64,partial']);
		expect(parsed.result.images).toEqual(['data:image/png;base64,final']);
		expect(parsed.result.revisedPrompts).toEqual(['revised response']);
	});

	test('parses Responses image output items', () => {
		const parsed = parseCustomProviderResponse(
			{
				output: [
					{
						type: 'image_generation_call',
						result: { b64_json: 'response-image' },
						revised_prompt: 'response revised',
						size: '1024x1024'
					}
				]
			},
			{ b64JsonPaths: ['output.*.result.b64_json'] },
			'png'
		);

		expect(parsed.images).toEqual(['data:image/png;base64,response-image']);
	});

	test('extracts custom provider images from configured paths', () => {
		const settings = normalizeSettings({
			customProviders: [
				{
					id: 'custom-lab',
					name: 'Lab',
					submit: {
						path: 'render',
						result: {
							b64JsonPaths: ['data.*.b64_json'],
							imageUrlPaths: ['extra.urls.*']
						}
					}
				}
			]
		});
		const parsed = parseCustomProviderResponse(
			{
				data: [{ b64_json: 'one' }],
				extra: { urls: ['https://cdn.example.com/two.webp'] }
			},
			settings.customProviders[0].submit.result!,
			'webp'
		);

		expect(parsed.images).toEqual(['data:image/webp;base64,one']);
		expect(parsed.rawImageUrls).toEqual(['https://cdn.example.com/two.webp']);
	});
});
