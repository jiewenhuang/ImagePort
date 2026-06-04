const SIZE_PATTERN = /^\s*(\d+)\s*[xX×]\s*(\d+)\s*$/;
const RATIO_PATTERN = /^\s*(\d+(?:\.\d+)?)\s*[:xX×]\s*(\d+(?:\.\d+)?)\s*$/;
const SIZE_MULTIPLE = 16;
const MAX_EDGE = 3840;
const MAX_ASPECT_RATIO = 3;
const MIN_PIXELS = 655_360;
const MAX_PIXELS = 8_294_400;

export type SizeTier = '1K' | '2K' | '4K';
type PresetRatio = '1:1' | '3:2' | '2:3' | '16:9' | '9:16' | '4:3' | '3:4' | '21:9';

const COMMON_SIZE_PRESETS: Record<SizeTier, Record<PresetRatio, string>> = {
	'1K': {
		'1:1': '1024x1024',
		'3:2': '1536x1024',
		'2:3': '1024x1536',
		'16:9': '1280x720',
		'9:16': '720x1280',
		'4:3': '1024x768',
		'3:4': '768x1024',
		'21:9': '1280x544'
	},
	'2K': {
		'1:1': '2048x2048',
		'3:2': '2160x1440',
		'2:3': '1440x2160',
		'16:9': '2560x1440',
		'9:16': '1440x2560',
		'4:3': '2048x1536',
		'3:4': '1536x2048',
		'21:9': '2560x1088'
	},
	'4K': {
		'1:1': '2880x2880',
		'3:2': '3456x2304',
		'2:3': '2304x3456',
		'16:9': '3840x2160',
		'9:16': '2160x3840',
		'4:3': '3200x2400',
		'3:4': '2400x3200',
		'21:9': '3840x1600'
	}
};

const TIER_PIXEL_BUDGET: Record<SizeTier, number> = {
	'1K': 1_572_864,
	'2K': 4_194_304,
	'4K': MAX_PIXELS
};

const MAX_RATIO_ERROR = 0.01;

function roundToMultiple(value: number, multiple: number) {
	return Math.max(multiple, Math.round(value / multiple) * multiple);
}

function floorToMultiple(value: number, multiple: number) {
	return Math.max(multiple, Math.floor(value / multiple) * multiple);
}

function ceilToMultiple(value: number, multiple: number) {
	return Math.max(multiple, Math.ceil(value / multiple) * multiple);
}

function normalizeDimensions(width: number, height: number) {
	let normalizedWidth = roundToMultiple(width, SIZE_MULTIPLE);
	let normalizedHeight = roundToMultiple(height, SIZE_MULTIPLE);

	const scaleToFit = (scale: number) => {
		normalizedWidth = floorToMultiple(normalizedWidth * scale, SIZE_MULTIPLE);
		normalizedHeight = floorToMultiple(normalizedHeight * scale, SIZE_MULTIPLE);
	};

	const scaleToFill = (scale: number) => {
		normalizedWidth = ceilToMultiple(normalizedWidth * scale, SIZE_MULTIPLE);
		normalizedHeight = ceilToMultiple(normalizedHeight * scale, SIZE_MULTIPLE);
	};

	for (let i = 0; i < 4; i += 1) {
		const maxEdge = Math.max(normalizedWidth, normalizedHeight);
		if (maxEdge > MAX_EDGE) {
			scaleToFit(MAX_EDGE / maxEdge);
		}

		if (normalizedWidth / normalizedHeight > MAX_ASPECT_RATIO) {
			normalizedWidth = floorToMultiple(normalizedHeight * MAX_ASPECT_RATIO, SIZE_MULTIPLE);
		} else if (normalizedHeight / normalizedWidth > MAX_ASPECT_RATIO) {
			normalizedHeight = floorToMultiple(normalizedWidth * MAX_ASPECT_RATIO, SIZE_MULTIPLE);
		}

		const pixels = normalizedWidth * normalizedHeight;
		if (pixels > MAX_PIXELS) {
			scaleToFit(Math.sqrt(MAX_PIXELS / pixels));
		} else if (pixels < MIN_PIXELS) {
			scaleToFill(Math.sqrt(MIN_PIXELS / pixels));
		}
	}

	return { width: normalizedWidth, height: normalizedHeight };
}

export function normalizeImageSize(size: string) {
	const trimmed = size.trim();
	const match = trimmed.match(SIZE_PATTERN);
	if (!match) return trimmed;

	const { width, height } = normalizeDimensions(Number(match[1]), Number(match[2]));
	return `${width}x${height}`;
}

export function parseRatio(ratio: string) {
	const match = ratio.match(RATIO_PATTERN);
	if (!match) return null;

	const width = Number(match[1]);
	const height = Number(match[2]);
	if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
		return null;
	}

	return { width, height };
}

function getPresetRatioKey(ratioWidth: number, ratioHeight: number): PresetRatio | null {
	if (!Number.isInteger(ratioWidth) || !Number.isInteger(ratioHeight)) return null;

	const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
	const divisor = gcd(ratioWidth, ratioHeight);
	const key = `${ratioWidth / divisor}:${ratioHeight / divisor}`;

	return key in COMMON_SIZE_PRESETS['1K'] ? (key as PresetRatio) : null;
}

export function calculateImageSize(tier: SizeTier, ratio: string) {
	const parsed = parseRatio(ratio);
	if (!parsed) return null;

	const { width: ratioWidth, height: ratioHeight } = parsed;
	const presetRatioKey = getPresetRatioKey(ratioWidth, ratioHeight);
	if (presetRatioKey) return COMMON_SIZE_PRESETS[tier][presetRatioKey];

	const targetRatio = ratioWidth / ratioHeight;
	const pixelBudget = TIER_PIXEL_BUDGET[tier];

	let bestWidth = 0;
	let bestHeight = 0;
	let bestPixels = 0;

	for (let width = SIZE_MULTIPLE; width <= MAX_EDGE; width += SIZE_MULTIPLE) {
		const idealHeight = width / targetRatio;
		const candidateHeights = [
			Math.floor(idealHeight / SIZE_MULTIPLE) * SIZE_MULTIPLE,
			Math.ceil(idealHeight / SIZE_MULTIPLE) * SIZE_MULTIPLE
		];

		for (const height of candidateHeights) {
			if (height < SIZE_MULTIPLE || height > MAX_EDGE) continue;

			const pixels = width * height;
			if (pixels > pixelBudget || pixels < MIN_PIXELS) continue;
			if (Math.max(width / height, height / width) > MAX_ASPECT_RATIO) continue;

			const actualRatio = width / height;
			const ratioError = Math.abs(actualRatio - targetRatio) / targetRatio;
			if (ratioError > MAX_RATIO_ERROR) continue;

			if (pixels > bestPixels) {
				bestPixels = pixels;
				bestWidth = width;
				bestHeight = height;
			}
		}
	}

	if (bestPixels === 0) return null;
	return `${bestWidth}x${bestHeight}`;
}
