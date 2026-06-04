import { describe, expect, test } from 'bun:test';
import { createJsonServerSentEventCollector } from './server-sent-events';

describe('createJsonServerSentEventCollector', () => {
	test('collects JSON data events across chunks', () => {
		const events: Record<string, unknown>[] = [];
		const collector = createJsonServerSentEventCollector((event) => events.push(event));

		collector.push('data: {"type":"image_generation.partial');
		collector.push('_image","b64_json":"one"}\n\n');
		collector.push('data: [DONE]\n\n');
		collector.finish();

		expect(events).toEqual([{ type: 'image_generation.partial_image', b64_json: 'one' }]);
	});

	test('throws on invalid JSON events', () => {
		const collector = createJsonServerSentEventCollector(() => {});
		let message = '';
		try {
			collector.push('data: {bad}\n\n');
		} catch (err) {
			message = err instanceof Error ? err.message : String(err);
		}

		expect(message).toBe('流式响应包含无法解析的 JSON 事件');
	});
});
