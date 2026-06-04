import type { CallApiResult, TaskParams } from '$lib/domain/types';

export type ImageRequestGroupStatus = 'done' | 'partial';

export interface ImageRequestGroupSummary {
	images: string[];
	status: ImageRequestGroupStatus;
	failureCount: number;
	errorMessage: string | null;
	revisedPrompts: Array<string | undefined>;
	rawImageUrls: string[];
	actualParams: Partial<TaskParams> | null;
	actualParamsList: Array<Partial<TaskParams> | undefined>;
	rawResponsePayload: string | null;
	streamPartialImages: string[];
}

export function summarizeImageRequestGroup(results: PromiseSettledResult<CallApiResult>[]): ImageRequestGroupSummary {
	const successfulResults = results.filter((result): result is PromiseFulfilledResult<CallApiResult> => result.status === 'fulfilled');
	const images = successfulResults.flatMap((result) => result.value.images);
	const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');

	if (images.length) {
		const actualParamsList = successfulResults.flatMap((result) =>
			result.value.actualParamsList?.length
				? result.value.actualParamsList
				: result.value.images.map(() => result.value.actualParams)
		);
		const rawResponsePayloads = successfulResults.map((result) => result.value.rawResponsePayload).filter(isNonEmptyString);
		const streamPartialImages = successfulResults.flatMap((result) => result.value.streamPartialImages ?? []);
		return {
			images,
			status: failures.length ? 'partial' : 'done',
			failureCount: failures.length,
			errorMessage: failures.length ? `${failures.length} 个请求失败：${formatErrorReason(failures[0].reason)}` : null,
			revisedPrompts: successfulResults.flatMap((result) =>
				result.value.revisedPrompts?.length ? result.value.revisedPrompts : result.value.images.map(() => undefined)
			),
			rawImageUrls: successfulResults.flatMap((result) => result.value.rawImageUrls ?? []),
			actualParams: actualParamsList.find((params) => params && Object.keys(params).length > 0) ?? null,
			actualParamsList,
			rawResponsePayload: rawResponsePayloads.length === 0
				? null
				: rawResponsePayloads.length === 1
					? rawResponsePayloads[0]
					: JSON.stringify(rawResponsePayloads),
			streamPartialImages
		};
	}

	if (failures[0]) throw failures[0].reason;
	throw new Error('所有并发请求均失败');
}

function formatErrorReason(reason: unknown) {
	return reason instanceof Error ? reason.message : String(reason);
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.trim().length > 0;
}
