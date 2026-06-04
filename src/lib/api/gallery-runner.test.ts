import { describe, expect, test } from 'bun:test';
import { DEFAULT_SETTINGS } from '$lib/domain/settings';
import { DEFAULT_PARAMS, type NativeJsonRequest, type NativeMultipartRequest } from '$lib/domain/types';
import { runGalleryImageRequestGroup } from './gallery-runner';

const profile = {
	...DEFAULT_SETTINGS.profiles[0],
	apiKey: 'sk-test',
	responseFormatB64Json: true
};

describe('gallery runner', () => {
	test('runs provider requests, downloads raw URLs, and summarizes multiple results', async () => {
		const sentRequestIds: Array<string | undefined> = [];
		const summary = await runGalleryImageRequestGroup({
			taskId: 'task-1',
			settings: DEFAULT_SETTINGS,
			profile,
			prompt: 'a quiet desk',
			params: { ...DEFAULT_PARAMS, n: 1 },
			inputImages: [],
			mask: null,
			createRequestId: () => 'req-1',
			nativeJsonRequest: async (request: NativeJsonRequest) => {
				sentRequestIds.push(request.requestId);
				return {
					status: 200,
					headers: {},
					body: {
						data: [
							{ b64_json: 'one', revised_prompt: 'one revised' },
							{ url: 'https://example.com/two.png', revised_prompt: 'two revised' }
						]
					}
				};
			},
			nativeMultipartRequest: async () => {
				throw new Error('multipart should not be used');
			},
			nativeJsonStreamRequest: async () => {
				throw new Error('stream should not be used');
			},
			nativeMultipartStreamRequest: async () => {
				throw new Error('multipart stream should not be used');
			},
			downloadImageAsDataUrl: async (url) => `data:image/png;base64,downloaded:${url}`,
			onPartialImages: () => undefined
		});

		expect(sentRequestIds).toEqual(['req-1']);
		expect(summary.status).toBe('done');
		expect(summary.images).toEqual(['data:image/png;base64,one', 'data:image/png;base64,downloaded:https://example.com/two.png']);
		expect(summary.revisedPrompts).toEqual(['one revised', 'two revised']);
		expect(summary.rawImageUrls).toEqual(['https://example.com/two.png']);
	});

	test('reports streaming partial images through the callback', async () => {
		const partialUpdates: string[][] = [];
		const summary = await runGalleryImageRequestGroup({
			taskId: 'task-stream',
			settings: DEFAULT_SETTINGS,
			profile: { ...profile, streamImages: true, streamPartialImages: 1 },
			prompt: 'a blue vase',
			params: { ...DEFAULT_PARAMS, n: 1 },
			inputImages: [],
			mask: null,
			createRequestId: () => 'stream-1',
			nativeJsonRequest: async () => {
				throw new Error('json should not be used');
			},
			nativeMultipartRequest: async () => {
				throw new Error('multipart should not be used');
			},
			nativeJsonStreamRequest: async (request, onChunk) => {
				expect(request.requestId).toBe('stream-1');
				onChunk('data: {"object":"image.generation.partial_image","b64_json":"partial"}\n\n');
				onChunk('data: {"object":"image.generation.result","data":[{"b64_json":"final"}]}\n\n');
				return { status: 200, headers: {}, body: null };
			},
			nativeMultipartStreamRequest: async () => {
				throw new Error('multipart stream should not be used');
			},
			downloadImageAsDataUrl: async () => {
				throw new Error('download should not be used');
			},
			onPartialImages: (_taskId, images) => partialUpdates.push(images)
		});

		expect(partialUpdates).toEqual([['data:image/png;base64,partial']]);
		expect(summary.images).toEqual(['data:image/png;base64,final']);
		expect(summary.streamPartialImages).toEqual(['data:image/png;base64,partial']);
	});
});
