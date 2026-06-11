import { describe, expect, test } from 'bun:test';
import { createEmptyTaskMetadata, DEFAULT_PARAMS, type TaskRecord } from './types';
import {
	createDragSelectionBox,
	getDragSelectionStartIntent,
	getDragSelectedTaskIds,
	invertVisibleTaskSelection,
	normalizeSelectionRect,
	rectsIntersect,
	toggleTaskIdSelection
} from './task-selection';

function task(id: string): TaskRecord {
	return {
		id,
		prompt: 'selection',
		params: { ...DEFAULT_PARAMS },
		inputImages: [],
		mask: null,
		images: [],
		status: 'done',
		error: null,
		createdAt: 100,
		finishedAt: 200,
		failureCount: 0,
		...createEmptyTaskMetadata()
	};
}

describe('task selection helpers', () => {
	test('toggles a task id without reordering other selections', () => {
		expect(toggleTaskIdSelection(['a', 'b'], 'b')).toEqual(['a']);
		expect(toggleTaskIdSelection(['a'], 'b')).toEqual(['a', 'b']);
	});

	test('inverts selection across visible tasks only', () => {
		expect(invertVisibleTaskSelection([task('a'), task('b'), task('c')], ['b', 'hidden'])).toEqual(['a', 'c']);
	});

	test('selects task ids whose rectangles intersect the drag box', () => {
		const box = createDragSelectionBox(120, 120);
		const rect = normalizeSelectionRect({ ...box, currentX: 20, currentY: 20 });

		expect(rect).toEqual({ left: 20, top: 20, right: 120, bottom: 120, width: 100, height: 100 });
		expect(rectsIntersect(rect, { left: 10, top: 10, right: 30, bottom: 30 })).toBe(true);
		expect(rectsIntersect(rect, { left: 130, top: 10, right: 150, bottom: 30 })).toBe(false);
		expect(
			getDragSelectedTaskIds([task('a'), task('b'), task('c')], rect, (id) => {
				if (id === 'a') return { left: 10, top: 10, right: 30, bottom: 30 };
				if (id === 'b') return { left: 90, top: 90, right: 130, bottom: 130 };
				return { left: 130, top: 130, right: 150, bottom: 150 };
			})
		).toEqual(['a', 'b']);
	});

	test('suppresses native browser selection when starting a drag selection', () => {
		expect(getDragSelectionStartIntent({ button: 0, target: closestTarget(false) })).toEqual({
			shouldStart: true,
			shouldPreventDefault: true
		});
		expect(getDragSelectionStartIntent({ button: 0, target: closestTarget(true) })).toEqual({
			shouldStart: false,
			shouldPreventDefault: false
		});
		expect(getDragSelectionStartIntent({ button: 2, target: closestTarget(false) })).toEqual({
			shouldStart: false,
			shouldPreventDefault: false
		});
	});
});

function closestTarget(matchesIgnoredSelector: boolean) {
	return {
		closest: () => (matchesIgnoredSelector ? {} : null)
	};
}
