import { describe, expect, test } from 'bun:test';
import {
	buildImagesEditRequest,
	buildImagesEditRequests,
	buildImagesGenerationRequest,
	buildImagesGenerationRequests,
	parseImagesGenerationResponse
} from './openai-compatible';

describe('buildImagesGenerationRequest', () => {
	test('builds a JSON request for text-to-image generation', () => {
		const request = buildImagesGenerationRequest({
			baseUrl: 'https://api.openai.com/v1',
			apiKey: 'sk-test',
			model: 'gpt-image-2',
			timeoutSecs: 120,
			responseFormatB64Json: true,
			prompt: 'a quiet desktop image generation tool',
			params: {
				size: '1024x1024',
				quality: 'auto',
				output_format: 'png',
				output_compression: null,
				moderation: 'auto',
				n: 2
			}
		});

		expect(request.url).toBe('https://api.openai.com/v1/images/generations');
		expect(request.method).toBe('POST');
		expect(request.headers.Authorization).toBe('Bearer sk-test');
		expect(request.body).toEqual({
			model: 'gpt-image-2',
			prompt: 'a quiet desktop image generation tool',
			size: '1024x1024',
			quality: 'auto',
			output_format: 'png',
			moderation: 'auto',
			n: 2,
			response_format: 'b64_json'
		});
		expect(request.timeoutSecs).toBe(120);
	});

	test('builds a multipart request for image edits', () => {
		const request = buildImagesEditRequest({
			baseUrl: 'https://api.openai.com/v1/',
			apiKey: 'sk-test',
			model: 'gpt-image-2',
			timeoutSecs: 180,
			responseFormatB64Json: true,
			prompt: 'replace the marked area with a brass lamp',
			inputImages: [
				{
					id: 'source',
					name: 'source.png',
					dataUrl: 'data:image/png;base64,c291cmNl'
				}
			],
			mask: {
				targetImageId: 'source',
				dataUrl: 'data:image/png;base64,bWFzaw==',
				updatedAt: 1
			},
			params: {
				size: '1024x1024',
				quality: 'high',
				output_format: 'png',
				output_compression: null,
				moderation: 'auto',
				n: 1
			}
		});

		expect(request.url).toBe('https://api.openai.com/v1/images/edits');
		expect(request.method).toBe('POST');
		expect(request.headers.Authorization).toBe('Bearer sk-test');
		expect(request.fields).toEqual({
			model: 'gpt-image-2',
			prompt: 'replace the marked area with a brass lamp',
			size: '1024x1024',
			quality: 'high',
			output_format: 'png',
			moderation: 'auto',
			response_format: 'b64_json'
		});
		expect(request.files.map((file) => file.field)).toEqual(['image[]', 'mask']);
		expect(request.timeoutSecs).toBe(180);
	});

	test('splits multi-image generation into single-image requests', () => {
		const requests = buildImagesGenerationRequests({
			baseUrl: 'https://api.openai.com/v1',
			apiKey: 'sk-test',
			model: 'gpt-image-2',
			timeoutSecs: 120,
			responseFormatB64Json: true,
			prompt: 'three desktop gallery variations',
			params: {
				size: '1024x1024',
				quality: 'auto',
				output_format: 'png',
				output_compression: null,
				moderation: 'auto',
				n: 3
			}
		});

		expect(requests.length).toBe(3);
		for (const request of requests) {
			expect(request.body?.n).toBe(undefined);
			expect(request.body?.prompt).toBe('three desktop gallery variations');
		}
	});

	test('splits multi-image edits into single-image multipart requests', () => {
		const requests = buildImagesEditRequests({
			baseUrl: 'https://api.openai.com/v1',
			apiKey: 'sk-test',
			model: 'gpt-image-2',
			timeoutSecs: 120,
			responseFormatB64Json: true,
			prompt: 'two edited lamp variations',
			inputImages: [
				{
					id: 'source',
					name: 'source.png',
					dataUrl: 'data:image/png;base64,c291cmNl'
				}
			],
			mask: null,
			params: {
				size: '1024x1024',
				quality: 'auto',
				output_format: 'png',
				output_compression: null,
				moderation: 'auto',
				n: 2
			}
		});

		expect(requests.length).toBe(2);
		for (const request of requests) {
			expect(Object.hasOwn(request.fields, 'n')).toBe(false);
			expect(request.files.map((file) => file.field)).toEqual(['image[]']);
		}
	});

	test('keeps the mask file on every split edit request', () => {
		const requests = buildImagesEditRequests({
			baseUrl: 'https://api.openai.com/v1',
			apiKey: 'sk-test',
			model: 'gpt-image-2',
			timeoutSecs: 120,
			responseFormatB64Json: true,
			prompt: 'two masked edits',
			inputImages: [
				{
					id: 'source',
					name: 'source.png',
					dataUrl: 'data:image/png;base64,c291cmNl'
				}
			],
			mask: {
				targetImageId: 'source',
				dataUrl: 'data:image/png;base64,bWFzaw==',
				updatedAt: 1
			},
			params: {
				size: '1024x1024',
				quality: 'auto',
				output_format: 'png',
				output_compression: null,
				moderation: 'auto',
				n: 2
			}
		});

		expect(requests.length).toBe(2);
		for (const request of requests) {
			expect(Object.hasOwn(request.fields, 'n')).toBe(false);
			expect(request.files.map((file) => file.field)).toEqual(['image[]', 'mask']);
		}
	});
});

describe('parseImagesGenerationResponse', () => {
	test('normalizes base64 image payloads into data URLs', () => {
		const parsed = parseImagesGenerationResponse(
			{ data: [{ b64_json: 'abc123', revised_prompt: 'revised', size: '1536x1024', quality: 'high' }] },
			'png'
		);

		expect(parsed.images).toEqual(['data:image/png;base64,abc123']);
		expect(parsed.revisedPrompts).toEqual(['revised']);
		expect(parsed.actualParams).toEqual({ size: '1536x1024', quality: 'high' });
		expect(parsed.actualParamsList).toEqual([{ size: '1536x1024', quality: 'high' }]);
	});

	test('keeps raw image URLs and raw response payload metadata', () => {
		const payload = { data: [{ url: 'https://example.com/image.png', revised_prompt: 'rewritten' }] };
		const parsed = parseImagesGenerationResponse(payload, 'png');

		expect(parsed.rawImageUrls).toEqual(['https://example.com/image.png']);
		expect(parsed.revisedPrompts).toEqual(['rewritten']);
		expect(parsed.rawResponsePayload).toBe(JSON.stringify(payload));
	});

	test('keeps every returned image in response order', () => {
		const parsed = parseImagesGenerationResponse({ data: [{ b64_json: 'first' }, { b64_json: 'second' }] }, 'webp');

		expect(parsed.images).toEqual(['data:image/webp;base64,first', 'data:image/webp;base64,second']);
	});
});
