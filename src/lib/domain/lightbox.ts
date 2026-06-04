export interface LightboxTransform {
	scale: number;
	x: number;
	y: number;
}

export const LIGHTBOX_MIN_SCALE = 1;
export const LIGHTBOX_MAX_SCALE = 6;
export const LIGHTBOX_SCALE_STEP = 0.5;

export function getWrappedImageIndex(currentIndex: number, delta: number, total: number): number {
	if (!Number.isFinite(total) || total <= 0) return 0;
	const index = Math.trunc(currentIndex);
	return ((index + Math.trunc(delta)) % total + total) % total;
}

export function zoomLightboxTransform(
	transform: LightboxTransform,
	delta: number,
	options: { min?: number; max?: number; step?: number } = {}
): LightboxTransform {
	const min = options.min ?? LIGHTBOX_MIN_SCALE;
	const max = options.max ?? LIGHTBOX_MAX_SCALE;
	const step = options.step ?? LIGHTBOX_SCALE_STEP;
	const nextScale = clamp(transform.scale + delta * step, min, max);
	if (nextScale <= min) return { scale: min, x: 0, y: 0 };
	return { ...transform, scale: nextScale };
}

export function panLightboxTransform(transform: LightboxTransform, dx: number, dy: number): LightboxTransform {
	if (transform.scale <= LIGHTBOX_MIN_SCALE) return { scale: LIGHTBOX_MIN_SCALE, x: 0, y: 0 };
	return {
		...transform,
		x: transform.x + dx,
		y: transform.y + dy
	};
}

export function resetLightboxTransform(): LightboxTransform {
	return { scale: LIGHTBOX_MIN_SCALE, x: 0, y: 0 };
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}
