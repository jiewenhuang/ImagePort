export function getNativeResponseErrorMessage(body: unknown, status: number): string {
	if (body && typeof body === 'object') {
		const record = body as Record<string, unknown>;
		const errorValue = record.error;
		if (errorValue && typeof errorValue === 'object') {
			const message = (errorValue as Record<string, unknown>).message;
			if (typeof message === 'string' && message.trim()) return message;
		}
		if (typeof record.message === 'string' && record.message.trim()) return record.message;
	}
	if (typeof body === 'string' && body.trim()) return body;
	return `HTTP ${status}`;
}
