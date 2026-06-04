import { describe, expect, test } from 'bun:test';
import { buildApiUrl, normalizeBaseUrl } from './url';

describe('normalizeBaseUrl', () => {
	test('adds https and v1 when the user enters a host', () => {
		expect(normalizeBaseUrl('api.example.com')).toBe('https://api.example.com');
		expect(buildApiUrl('api.example.com', 'images/generations')).toBe(
			'https://api.example.com/v1/images/generations'
		);
	});

	test('keeps only the path up to v1', () => {
		expect(normalizeBaseUrl('https://api.example.com/openai/v1/images/generations')).toBe(
			'https://api.example.com/openai/v1'
		);
		expect(buildApiUrl('https://api.example.com/openai/v1/images/generations', 'responses')).toBe(
			'https://api.example.com/openai/v1/responses'
		);
	});
});
