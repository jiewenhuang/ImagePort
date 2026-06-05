export interface JsonServerSentEventCollector {
	push(chunk: string): void;
	finish(): void;
}

export function createJsonServerSentEventCollector(
	onEvent: (event: Record<string, unknown>) => void
): JsonServerSentEventCollector {
	let buffer = '';

	function processBlock(block: string) {
		const dataLines: string[] = [];
		for (const line of block.split(/\r?\n/)) {
			if (!line || line.startsWith(':')) continue;
			if (!line.startsWith('data:')) continue;
			dataLines.push(line.slice(5).replace(/^ /, ''));
		}
		const data = dataLines.join('\n').trim();
		if (!data || data === '[DONE]') return;
		let parsed: unknown;
		try {
			parsed = JSON.parse(data);
		} catch {
			throw new Error('流式响应包含无法解析的 JSON 事件');
		}
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) onEvent(parsed as Record<string, unknown>);
	}

	function drain() {
		let match = buffer.match(/\r?\n\r?\n/);
		while (match?.index != null) {
			const block = buffer.slice(0, match.index);
			buffer = buffer.slice(match.index + match[0].length);
			processBlock(block);
			match = buffer.match(/\r?\n\r?\n/);
		}
	}

	return {
		push(chunk: string) {
			buffer += chunk;
			drain();
		},
		finish() {
			if (!buffer.trim()) return;
			processBlock(buffer);
			buffer = '';
		}
	};
}
