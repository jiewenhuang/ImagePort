export type ActiveTaskRequestIds = Record<string, string[]>;

export function addTaskRequestId(
	activeRequestIds: ActiveTaskRequestIds,
	taskId: string,
	requestId: string
): ActiveTaskRequestIds {
	const current = activeRequestIds[taskId] ?? [];
	if (current.includes(requestId)) return activeRequestIds;
	return {
		...activeRequestIds,
		[taskId]: [...current, requestId]
	};
}

export function takeTaskRequestIds(
	activeRequestIds: ActiveTaskRequestIds,
	taskIds: string[]
): { activeRequestIds: ActiveTaskRequestIds; requestIds: string[] } {
	const ids = new Set(taskIds);
	const requestIds: string[] = [];
	const nextActiveRequestIds: ActiveTaskRequestIds = {};
	for (const [taskId, taskRequestIds] of Object.entries(activeRequestIds)) {
		if (ids.has(taskId)) {
			requestIds.push(...taskRequestIds);
			continue;
		}
		nextActiveRequestIds[taskId] = taskRequestIds;
	}
	return { activeRequestIds: nextActiveRequestIds, requestIds };
}

export function mergeTaskIds(current: string[], next: string[]): string[] {
	return [...new Set([...current, ...next])];
}
