import type { TaskParams } from './types';

export function buildActualParamsByImage(images: string[], actualParamsList: Array<Partial<TaskParams> | undefined>) {
	return Object.fromEntries(
		images
			.map((_, index) => [String(index), actualParamsList[index]] as const)
			.filter((entry): entry is readonly [string, Partial<TaskParams>] =>
				Boolean(entry[1] && Object.keys(entry[1]).length > 0)
			)
	);
}

export function buildRevisedPromptByImage(images: string[], revisedPrompts: Array<string | undefined>) {
	return Object.fromEntries(
		images
			.map((_, index) => [String(index), revisedPrompts[index]] as const)
			.filter((entry): entry is readonly [string, string] => typeof entry[1] === 'string' && entry[1].trim().length > 0)
	);
}
