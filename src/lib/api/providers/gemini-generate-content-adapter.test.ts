import { describe, expect, test } from 'bun:test';
import { addApiProfile, DEFAULT_SETTINGS, getActiveProfile } from '$lib/domain/settings';
import { DEFAULT_PARAMS, type InputImage } from '$lib/domain/types';
import { buildImageProviderRequestGroup } from '../provider-adapter';
import { buildGeminiGenerateContentUrl } from './gemini-generate-content-adapter';
import { resolveImageApiEndpoint } from './registry';
import type { BuildProviderRequestGroupInput } from './types';

const settings = addApiProfile(DEFAULT_SETTINGS, 'google', () => 'google-profile');
const profile = {
	...getActiveProfile(settings),
	apiProtocol: 'gemini-generate-content' as const,
	baseUrl: 'https://gateway.example.com/v1',
	model: 'gemini-nano-banana-2.1',
	apiKey: 'test-key'
};
const inputImages: InputImage[] = [
	{ id: 'one', name: 'one.png', dataUrl: 'data:image/png;base64,b25l' },
	{ id: 'two', name: 'two.jpg', dataUrl: 'data:image/jpeg;base64,dHdv' }
];
const input: BuildProviderRequestGroupInput = {
	settings,
	profile,
	prompt: 'combine',
	params: { ...DEFAULT_PARAMS, size: '2048x2048', n: 2 },
	inputImages,
	mask: null
};

describe('Gemini generateContent adapter', () => {
	test('matches Rolldek Banana 2.1 for text, references, and repeated submissions', () => {
		const rolldekProfile = {
			...profile,
			baseUrl: 'https://rolldek.com/v1beta',
			apiProtocol: 'gemini-generate-content-response-format' as const
		};
		for (const references of [[], inputImages, inputImages, [inputImages[1]]]) {
			const group = buildImageProviderRequestGroup({ ...input, profile: rolldekProfile, inputImages: references });
			expect(group.requests.length).toBe(2);
			for (const item of group.requests) {
				if (item.kind !== 'json') throw new Error('expected JSON');
				expect(item.request.url).toBe('https://rolldek.com/v1beta/models/gemini-nano-banana-2.1:generateContent');
				expect(item.request.body?.generationConfig).toEqual({
					responseModalities: ['IMAGE'],
					responseFormat: { image: { aspectRatio: '1:1', imageSize: '2K' } }
				});
				expect(item.request.body?.contents).toEqual([
					{
						role: 'user',
						parts: [
							{ text: 'combine' },
							...references.map((image) => ({
								inlineData: {
									mimeType: image.id === 'one' ? 'image/png' : 'image/jpeg',
									data: image.dataUrl.split(',')[1]
								}
							}))
						]
					}
				]);
			}
		}
		expect(resolveImageApiEndpoint(rolldekProfile, 'generate')).toBe(resolveImageApiEndpoint(rolldekProfile, 'edit'));
	});

	test('does not send an auto aspect ratio or imageConfig in responseFormat mode', () => {
		for (const size of ['auto', '1234x888']) {
			const group = buildImageProviderRequestGroup({
				...input,
				profile: { ...profile, apiProtocol: 'gemini-generate-content-response-format' },
				params: { ...input.params, size }
			});
			const item = group.requests[0];
			if (item.kind !== 'json') throw new Error('expected JSON');
			expect(item.request.body?.generationConfig).toEqual({
				responseModalities: ['IMAGE'],
				...(size !== 'auto' ? { responseFormat: { image: { imageSize: '1K' } } } : {})
			});
		}
	});

	test('uses the native model endpoint for base, OpenAI, and full Gemini URLs', () => {
		for (const base of [
			'gateway.example.com',
			'https://gateway.example.com/v1',
			'https://gateway.example.com/v1/v1beta',
			'https://gateway.example.com/v1beta/',
			'https://gateway.example.com/v1beta/models/old:generateContent'
		]) {
			expect(buildGeminiGenerateContentUrl(base, profile.model)).toBe(
				'https://gateway.example.com/v1beta/models/gemini-nano-banana-2.1:generateContent'
			);
		}
		expect(buildGeminiGenerateContentUrl('https://gateway.example.com/proxy/v1beta', 'models/gemini-image')).toBe(
			'https://gateway.example.com/proxy/v1beta/models/gemini-image:generateContent'
		);
	});

	test('sends every reference as inline data and requests one image per native call', () => {
		const group = buildImageProviderRequestGroup(input);
		expect(group.requests.length).toBe(2);
		const request = group.requests[0];
		if (request.kind !== 'json') throw new Error('expected JSON');
		expect(request.request.url).toBe(resolveImageApiEndpoint(profile, 'edit')!);
		expect(request.request.body).toEqual({
			contents: [
				{
					role: 'user',
					parts: [
						{ text: 'combine' },
						{ inlineData: { mimeType: 'image/png', data: 'b25l' } },
						{ inlineData: { mimeType: 'image/jpeg', data: 'dHdv' } }
					]
				}
			],
			generationConfig: {
				responseModalities: ['TEXT', 'IMAGE'],
				imageConfig: { aspectRatio: '1:1', imageSize: '2K' }
			}
		});
		expect(request.request.headers.Authorization).toBe('Bearer test-key');
		expect(request.request.headers['x-goog-api-key']).toBe('test-key');
		expect(group.requests[1].request).toEqual(request.request);
	});

	test('keeps the same endpoint on repeated submissions and after replacing references', () => {
		const original = JSON.stringify(input);
		const first = buildImageProviderRequestGroup(input);
		const second = buildImageProviderRequestGroup(input);
		const replaced = buildImageProviderRequestGroup({ ...input, inputImages: [inputImages[1]] });
		const textOnly = buildImageProviderRequestGroup({
			...input,
			inputImages: [],
			params: { ...input.params, size: 'auto' }
		});
		for (const group of [first, second, replaced, textOnly]) {
			expect(group.requests.every((entry) => entry.kind === 'json')).toBe(true);
			expect(group.requests[0].request.url).toBe(resolveImageApiEndpoint(profile)!);
		}
		expect(second.requests.map((entry) => entry.request)).toEqual(first.requests.map((entry) => entry.request));
		const textRequest = textOnly.requests[0];
		if (textRequest.kind !== 'json') throw new Error('expected JSON');
		expect(textRequest.request.body).toEqual({
			contents: [{ role: 'user', parts: [{ text: 'combine' }] }],
			generationConfig: { responseModalities: ['TEXT', 'IMAGE'] }
		});
		expect(JSON.stringify(input)).toBe(original);
	});

	test('uses Google API-key authentication for the official endpoint', () => {
		const group = buildImageProviderRequestGroup({
			...input,
			profile: { ...profile, baseUrl: 'https://generativelanguage.googleapis.com/v1beta' }
		});
		expect(group.requests[0].request.headers['x-goog-api-key']).toBe('test-key');
		expect('Authorization' in group.requests[0].request.headers).toBe(false);
	});

	test('parses final candidate images and excludes intermediate thought images', () => {
		const group = buildImageProviderRequestGroup(input);
		const result = group.requests[0].parse({
			candidates: [
				{
					content: {
						parts: [
							{ thought: true, inlineData: { mimeType: 'image/png', data: 'thought' } },
							{ text: 'Here is the final image.' },
							{ inlineData: { mimeType: 'image/png', data: 'final' } },
							{ inline_data: { mime_type: 'image/png', data: 'final' } }
						]
					}
				}
			]
		});
		expect(result.images).toEqual(['data:image/png;base64,final']);
		let error = '';
		try {
			group.requests[0].parse({ candidates: [] });
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		}
		expect(error.includes('没有返回可识别的最终图片')).toBe(true);
	});

	test('keeps OpenAI previews honest about the reference-image route', () => {
		const openAIProfile = { ...profile, apiProtocol: 'openai-images' as const };
		expect(resolveImageApiEndpoint(openAIProfile, 'generate')).toBe(
			'https://gateway.example.com/v1/images/generations'
		);
		expect(resolveImageApiEndpoint(openAIProfile, 'edit')).toBe('https://gateway.example.com/v1/images/edits');
		expect(resolveImageApiEndpoint(profile, 'generate')).toBe(resolveImageApiEndpoint(profile, 'edit'));
	});
});
