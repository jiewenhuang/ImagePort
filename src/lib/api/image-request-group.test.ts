import { describe, expect, test } from 'bun:test';
import { summarizeImageRequestGroup } from './image-request-group';

describe('summarizeImageRequestGroup', () => {
	test('keeps successful images and reports partial failures', () => {
		const summary = summarizeImageRequestGroup([
			{
				status: 'fulfilled',
				value: {
					images: ['data:image/png;base64,one'],
					revisedPrompts: ['rewritten'],
					rawImageUrls: ['https://example.com/image.png'],
					actualParams: { size: '1024x1024' },
					actualParamsList: [{ size: '1024x1024' }],
					rawResponsePayload: '{"data":[]}',
					streamPartialImages: ['data:image/png;base64,partial']
				}
			},
			{ status: 'rejected', reason: new Error('mask request failed') }
		]);

		expect(summary.images).toEqual(['data:image/png;base64,one']);
		expect(summary.revisedPrompts).toEqual(['rewritten']);
		expect(summary.rawImageUrls).toEqual(['https://example.com/image.png']);
		expect(summary.actualParams).toEqual({ size: '1024x1024' });
		expect(summary.actualParamsList).toEqual([{ size: '1024x1024' }]);
		expect(summary.rawResponsePayload).toBe('{"data":[]}');
		expect(summary.streamPartialImages).toEqual(['data:image/png;base64,partial']);
		expect(summary.failureCount).toBe(1);
		expect(summary.status).toBe('partial');
		expect(summary.errorMessage).toBe('1 个请求失败：mask request failed');
	});

	test('throws the first error when every request fails', () => {
		let message = '';
		try {
			summarizeImageRequestGroup([
				{ status: 'rejected', reason: new Error('first failure') },
				{ status: 'rejected', reason: 'second failure' }
			]);
		} catch (err) {
			message = err instanceof Error ? err.message : String(err);
		}

		expect(message).toBe('first failure');
	});
});
