import { describe, expect, test } from 'bun:test';
import { DEFAULT_SETTINGS } from './settings';
import { createEmptyTaskMetadata, DEFAULT_PARAMS, type TaskRecord } from './types';
import { buildFullBackupPayload, restoreFullBackupTasks } from './full-backup';

function task(overrides: Partial<TaskRecord> = {}): TaskRecord {
	return {
		id: 'task-1',
		prompt: 'backup image',
		params: { ...DEFAULT_PARAMS },
		inputImages: [{ id: 'input-1', name: 'input.png', dataUrl: 'data:image/png;base64,aW5wdXQ=' }],
		mask: { targetImageId: 'input-1', dataUrl: 'data:image/png;base64,bWFzaw==', updatedAt: 100 },
		images: ['data:image/png;base64,b3V0'],
		thumbnailImages: ['data:image/webp;base64,dGh1bWI='],
		status: 'done',
		error: null,
		createdAt: 100,
		finishedAt: 200,
		failureCount: 0,
		...createEmptyTaskMetadata(),
		...overrides
	};
}

describe('full backup helpers', () => {
	test('moves task images into backup files and stores manifest references', async () => {
		const payload = buildFullBackupPayload([task()], DEFAULT_SETTINGS, 123, [
			{ id: 'conv-1', title: 'Agent', messages: [], rounds: [], createdAt: 1, updatedAt: 2 }
		]);

		expect(payload.manifest.exportedAt).toBe(123);
		expect(payload.manifest.agentConversations?.[0].id).toBe('conv-1');
		expect(payload.manifest.tasks[0].images[0]).toBe('tasks/task-1/outputs/1.png');
		expect(payload.files.map((file) => file.path)).toEqual([
			'tasks/task-1/outputs/1.png',
			'tasks/task-1/thumbs/1.webp',
			'tasks/task-1/inputs/1-input.png.png',
			'tasks/task-1/masks/input-1.png'
		]);

		const files = new Map(payload.files.map((file) => [file.path, `data:image/png;base64,${bytesToBase64(file.data)}`]));
		const restored = await restoreFullBackupTasks(payload.manifest, async (path) => files.get(path) ?? null);

		expect(restored[0].images[0]).toBe('data:image/png;base64,b3V0');
		expect(restored[0].inputImages[0].dataUrl).toBe('data:image/png;base64,aW5wdXQ=');
		expect(restored[0].mask?.dataUrl).toBe('data:image/png;base64,bWFzaw==');
	});
});

function bytesToBase64(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}
