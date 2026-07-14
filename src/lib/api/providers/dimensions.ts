const SIZE_PATTERN = /^\s*(\d+)\s*[xX×]\s*(\d+)\s*$/;

export function resolveAspectRatio(size: string, supportedRatios: string[]): string {
	if (size === 'auto') return 'auto';
	const match = size.match(SIZE_PATTERN);
	if (!match) return supportedRatios.includes(size) ? size : 'auto';
	const ratio = Number(match[1]) / Number(match[2]);
	let best = supportedRatios[0] ?? '1:1';
	let bestError = Number.POSITIVE_INFINITY;
	for (const candidate of supportedRatios) {
		const [width, height] = candidate.split(':').map(Number);
		if (!width || !height) continue;
		const error = Math.abs(width / height - ratio) / ratio;
		if (error < bestError) {
			best = candidate;
			bestError = error;
		}
	}
	return bestError <= 0.03 ? best : 'auto';
}

export function resolveResolutionTier(size: string, allowed: Array<'1K' | '2K' | '4K'>): '1K' | '2K' | '4K' {
	if (!allowed.length) return '1K';
	const match = size.match(SIZE_PATTERN);
	if (!match) return allowed[0];
	const pixels = Number(match[1]) * Number(match[2]);
	const preferred = pixels > 5_000_000 ? '4K' : pixels > 2_000_000 ? '2K' : '1K';
	if (allowed.includes(preferred)) return preferred;
	if (preferred === '4K' && allowed.includes('2K')) return '2K';
	return allowed[0];
}

export function splitDataUrl(dataUrl: string): { mimeType: string; data: string } {
	const match = dataUrl.match(/^data:([^;,]+);base64,([\s\S]+)$/);
	if (!match) throw new Error('参考图不是有效的 Base64 data URL');
	return { mimeType: match[1], data: match[2] };
}
