import { describe, expect, test } from 'bun:test';
import { addTaskRequestId, mergeTaskIds, takeTaskRequestIds } from './task-lifecycle';

describe('task lifecycle helpers', () => {
	test('tracks active request ids per task without duplicates', () => {
		const active = addTaskRequestId({}, 'task-1', 'request-1');
		const withSecond = addTaskRequestId(active, 'task-1', 'request-2');
		const deduped = addTaskRequestId(withSecond, 'task-1', 'request-2');

		expect(deduped).toEqual({ 'task-1': ['request-1', 'request-2'] });
	});

	test('takes request ids for deleted tasks and removes only those entries', () => {
		const result = takeTaskRequestIds(
			{
				'task-1': ['request-1'],
				'task-2': ['request-2', 'request-3'],
				'task-3': ['request-4']
			},
			['task-1', 'task-2']
		);

		expect(result.requestIds).toEqual(['request-1', 'request-2', 'request-3']);
		expect(result.activeRequestIds).toEqual({ 'task-3': ['request-4'] });
	});

	test('merges task ids without reordering existing ids', () => {
		expect(mergeTaskIds(['task-1', 'task-2'], ['task-2', 'task-3'])).toEqual(['task-1', 'task-2', 'task-3']);
	});
});
