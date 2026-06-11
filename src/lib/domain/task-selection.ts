import type { TaskRecord } from './types';

export interface DragSelectionBox {
	startX: number;
	startY: number;
	currentX: number;
	currentY: number;
}

export interface RectLike {
	left: number;
	top: number;
	right: number;
	bottom: number;
}

export interface SelectionRect extends RectLike {
	width: number;
	height: number;
}

export function toggleTaskIdSelection(selectedTaskIds: string[], taskId: string): string[] {
	if (selectedTaskIds.includes(taskId)) return selectedTaskIds.filter((id) => id !== taskId);
	return [...selectedTaskIds, taskId];
}

export function getVisibleTaskIds(tasks: TaskRecord[]): string[] {
	return tasks.map((task) => task.id);
}

export function invertVisibleTaskSelection(visibleTasks: TaskRecord[], selectedTaskIds: string[]): string[] {
	const selected = new Set(selectedTaskIds);
	return visibleTasks.filter((task) => !selected.has(task.id)).map((task) => task.id);
}

export function createDragSelectionBox(x: number, y: number): DragSelectionBox {
	return { startX: x, startY: y, currentX: x, currentY: y };
}

export function moveDragSelectionBox(box: DragSelectionBox, x: number, y: number): DragSelectionBox {
	return { ...box, currentX: x, currentY: y };
}

export function normalizeSelectionRect(box: DragSelectionBox): SelectionRect {
	const left = Math.min(box.startX, box.currentX);
	const top = Math.min(box.startY, box.currentY);
	const right = Math.max(box.startX, box.currentX);
	const bottom = Math.max(box.startY, box.currentY);
	return { left, top, right, bottom, width: right - left, height: bottom - top };
}

export function rectsIntersect(a: RectLike, b: RectLike): boolean {
	return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

export function getDragSelectedTaskIds(
	visibleTasks: TaskRecord[],
	selectionRect: RectLike,
	getTaskRect: (taskId: string) => RectLike | null
): string[] {
	return visibleTasks
		.filter((task) => {
			const taskRect = getTaskRect(task.id);
			return taskRect != null && rectsIntersect(selectionRect, taskRect);
		})
		.map((task) => task.id);
}
