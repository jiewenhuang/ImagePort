import { describe, expect, test } from 'bun:test';
import { addApiProfile, DEFAULT_SETTINGS, getActiveProfile } from '$lib/domain/settings';
import { DEFAULT_PARAMS, type InputImage } from '$lib/domain/types';
import { buildGeminiInteractionsUrl, buildGeminiRequestGroup, parseGeminiImageResponse } from './gemini-adapter';
import { getImageApiProtocolWarning, resolveImageApiEndpoint } from './registry';
import { buildXaiRequestGroup } from './xai-adapter';

const referenceImages: InputImage[] = [
	{ id: 'one', name: 'one.png', dataUrl: 'data:image/png;base64,b25l' },
	{ id: 'two', name: 'two.jpg', dataUrl: 'data:image/jpeg;base64,dHdv' }
];

describe('xAI Imagine adapter', () => {
	test('maps shared dimensions to xAI aspect ratio and resolution', () => {
		const settings = addApiProfile(DEFAULT_SETTINGS, 'xai', () => 'xai-profile');
		const profile = getActiveProfile(settings);
		const group = buildXaiRequestGroup({
			settings,
			profile,
			prompt: 'city',
			params: { ...DEFAULT_PARAMS, size: '2560x1440', n: 3 },
			inputImages: [],
			mask: null
		});
		const request = group.requests[0];
		expect(request.kind).toBe('json');
		if (request.kind !== 'json') throw new Error('expected json request');
		expect(request.request.url).toBe('https://api.x.ai/v1/images/generations');
		expect(request.request.body).toEqual({
			model: 'grok-imagine-image-quality',
			prompt: 'city',
			n: 3,
			aspect_ratio: '16:9',
			resolution: '2k'
		});
	});

	test('keeps tall 1K dimensions in the 1K tier', () => {
		const settings = addApiProfile(DEFAULT_SETTINGS, 'xai', () => 'xai-profile');
		const profile = getActiveProfile(settings);
		const group = buildXaiRequestGroup({
			settings,
			profile,
			prompt: 'portrait',
			params: { ...DEFAULT_PARAMS, size: '880x1760' },
			inputImages: [],
			mask: null
		});
		const request = group.requests[0];
		if (request.kind !== 'json') throw new Error('expected json request');
		expect(request.request.body?.aspect_ratio).toBe('1:2');
		expect(request.request.body?.resolution).toBe('1k');
	});

	test('builds JSON multi-reference edit requests', () => {
		const settings = addApiProfile(DEFAULT_SETTINGS, 'xai', () => 'xai-profile');
		const profile = getActiveProfile(settings);
		const group = buildXaiRequestGroup({
			settings,
			profile,
			prompt: 'combine',
			params: DEFAULT_PARAMS,
			inputImages: referenceImages,
			mask: null
		});
		const request = group.requests[0];
		expect(request.kind).toBe('json');
		if (request.kind !== 'json') throw new Error('expected json request');
		expect(request.request.url).toBe('https://api.x.ai/v1/images/edits');
		expect(request.request.body?.images).toEqual([
			{ url: referenceImages[0].dataUrl, type: 'image_url' },
			{ url: referenceImages[1].dataUrl, type: 'image_url' }
		]);
	});
});

describe('Gemini image adapter', () => {
	test('normalizes the official Google v1 URL to the required v1beta endpoint', () => {
		expect(buildGeminiInteractionsUrl('https://generativelanguage.googleapis.com/v1')).toBe(
			'https://generativelanguage.googleapis.com/v1beta/interactions'
		);
	});

	test('normalizes scheme-less and full Gemini Interactions URLs', () => {
		expect(buildGeminiInteractionsUrl('gateway.example.com/v1')).toBe('https://gateway.example.com/v1/interactions');
		expect(buildGeminiInteractionsUrl('https://gateway.example.com/v1beta/interactions')).toBe(
			'https://gateway.example.com/v1beta/interactions'
		);
	});

	test('previews and warns about custom Interactions gateways', () => {
		const settings = addApiProfile(DEFAULT_SETTINGS, 'google', () => 'google-profile');
		const profile = {
			...getActiveProfile(settings),
			baseUrl: 'https://gateway.example.com/v1'
		};

		expect(resolveImageApiEndpoint(profile)).toBe('https://gateway.example.com/v1/interactions');
		expect(getImageApiProtocolWarning(profile)?.includes('普通 OpenAI /v1 网关通常不支持')).toBe(true);
	});

	test('builds one Interactions request per requested output', () => {
		const settings = addApiProfile(DEFAULT_SETTINGS, 'google', () => 'google-profile');
		const profile = getActiveProfile(settings);
		const group = buildGeminiRequestGroup({
			settings,
			profile,
			prompt: 'combine',
			params: { ...DEFAULT_PARAMS, size: '2048x2048', output_format: 'jpeg', n: 2 },
			inputImages: referenceImages,
			mask: null
		});
		expect(group.requests.length).toBe(2);
		const request = group.requests[0];
		expect(request.kind).toBe('json');
		if (request.kind !== 'json') throw new Error('expected json request');
		expect(request.request.url).toBe('https://generativelanguage.googleapis.com/v1beta/interactions');
		expect(request.request.headers['x-goog-api-key']).toBe(profile.apiKey);
		expect(request.request.body).toEqual({
			model: 'gemini-3.1-flash-image',
			input: [
				{ type: 'text', text: 'combine' },
				{ type: 'image', data: 'b25l', mime_type: 'image/png' },
				{ type: 'image', data: 'dHdv', mime_type: 'image/jpeg' }
			],
			response_format: { type: 'image', mime_type: 'image/jpeg', aspect_ratio: '1:1', image_size: '2K' }
		});
	});

	test('parses final model output images without keeping thought images', () => {
		const result = parseGeminiImageResponse({
			output_image: { data: 'final', mime_type: 'image/jpeg' },
			steps: [
				{ type: 'thought', summary: [{ type: 'image', data: 'thought', mime_type: 'image/png' }] },
				{ type: 'model_output', content: [{ type: 'image', data: 'final', mime_type: 'image/jpeg' }] }
			]
		});
		expect(result.images).toEqual(['data:image/jpeg;base64,final']);
	});
});
