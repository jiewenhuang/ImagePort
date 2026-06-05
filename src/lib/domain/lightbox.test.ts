import { describe, expect, test } from 'bun:test';
import { getWrappedImageIndex, panLightboxTransform, resetLightboxTransform, zoomLightboxTransform } from './lightbox';

describe('lightbox helpers', () => {
	test('wraps navigation in both directions', () => {
		expect(getWrappedImageIndex(0, -1, 4)).toBe(3);
		expect(getWrappedImageIndex(3, 1, 4)).toBe(0);
		expect(getWrappedImageIndex(1, 2, 4)).toBe(3);
	});

	test('zooms within bounds and resets pan at minimum scale', () => {
		expect(zoomLightboxTransform({ scale: 1, x: 20, y: -10 }, 1)).toEqual({ scale: 1.5, x: 20, y: -10 });
		expect(zoomLightboxTransform({ scale: 1.5, x: 20, y: -10 }, -1)).toEqual({ scale: 1, x: 0, y: 0 });
		expect(zoomLightboxTransform({ scale: 6, x: 0, y: 0 }, 1)).toEqual({ scale: 6, x: 0, y: 0 });
	});

	test('only pans when zoomed', () => {
		expect(panLightboxTransform(resetLightboxTransform(), 10, 12)).toEqual({ scale: 1, x: 0, y: 0 });
		expect(panLightboxTransform({ scale: 2, x: 1, y: 2 }, 10, 12)).toEqual({ scale: 2, x: 11, y: 14 });
	});
});
