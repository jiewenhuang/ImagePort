import { describe, expect, test } from 'bun:test';
import { calculateImageSize, normalizeImageSize, parseRatio } from './size';

describe('image size helpers', () => {
	test('maps common tier and ratio presets to familiar output sizes', () => {
		expect(calculateImageSize('1K', '1:1')).toBe('1024x1024');
		expect(calculateImageSize('1K', '3:2')).toBe('1536x1024');
		expect(calculateImageSize('2K', '16:9')).toBe('2560x1440');
		expect(calculateImageSize('4K', '9:16')).toBe('2160x3840');
	});

	test('normalizes custom dimensions to supported image bounds', () => {
		expect(normalizeImageSize('1000x1000')).toBe('1008x1008');
		expect(normalizeImageSize('9000x9000')).toBe('2880x2880');
	});

	test('parses colon and x separated ratios', () => {
		expect(parseRatio('2.39:1')).toEqual({ width: 2.39, height: 1 });
		expect(parseRatio('16x9')).toEqual({ width: 16, height: 9 });
		expect(parseRatio('bad')).toBe(null);
	});
});
