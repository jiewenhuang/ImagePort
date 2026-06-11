import { describe, expect, test } from 'bun:test';
import { createEmptyTaskMetadata, DEFAULT_PARAMS, type TaskRecord } from '$lib/domain/types';
import { DEFAULT_SETTINGS, type AppSettings } from '$lib/domain/settings';
import { readStoredZipEntries } from '$lib/domain/zip';
import {
	buildFullBackupExportFile,
	buildTasksExportFile,
	createSafeExportName,
	readFullBackupImportFile
} from './gallery-import-export';

const PNG_DATA_URL = 'data:image/png;base64,aGVsbG8=';

function task(id: string, createdAt = 100): TaskRecord {
	return {
		id,
		prompt: `prompt ${id}`,
		params: { ...DEFAULT_PARAMS },
		inputImages: [],
		mask: null,
		images: [PNG_DATA_URL],
		status: 'done',
		error: null,
		createdAt,
		finishedAt: createdAt + 10,
		failureCount: 0,
		...createEmptyTaskMetadata()
	};
}

describe('gallery import/export helpers', () => {
	test('builds a JSON task export file', async () => {
		const file = buildTasksExportFile([task('a')], 123);
		const parsed = JSON.parse(await file.blob.text()) as { version: number; exportedAt: number; tasks: TaskRecord[] };

		expect(file.fileName).toBe('imageport-tasks.json');
		expect(file.blob.type.startsWith('application/json')).toBe(true);
		expect(parsed.version).toBe(1);
		expect(parsed.exportedAt).toBe(123);
		expect(parsed.tasks.map((item) => item.id)).toEqual(['a']);
	});

	test('creates safe export names for filenames', () => {
		expect(createSafeExportName('  我的/收藏:01 ? ')).toBe('我的-收藏-01');
		expect(createSafeExportName('')).toBe('imageport');
	});

	test('builds a full backup zip with a stable file name', async () => {
		const file = buildFullBackupExportFile({
			tasks: [task('a')],
			settings: DEFAULT_SETTINGS,
			agentConversations: [],
			exportedAt: 123,
			now: new Date('2026-06-11T08:09:10Z')
		});
		const entries = readStoredZipEntries(new Uint8Array(await file.blob.arrayBuffer()));
		const manifest = JSON.parse(new TextDecoder().decode(entries.get('manifest.json'))) as { exportedAt: number };

		expect(file.fileName).toBe('imageport-backup-2026-06-11-08-09-10.zip');
		expect(file.blob.type).toBe('application/zip');
		expect(manifest.exportedAt).toBe(123);
		expect(entries.has('tasks/a/outputs/1.png')).toBe(true);
	});

	test('reads full backup imports and keeps parent-owned merge results explicit', async () => {
		const backupSettings: AppSettings = {
			...DEFAULT_SETTINGS,
			profiles: [{ ...DEFAULT_SETTINGS.profiles[0], id: 'backup-profile', name: 'Backup Profile' }],
			activeProfileId: 'backup-profile'
		};
		const backup = buildFullBackupExportFile({
			tasks: [task('imported', 200)],
			settings: backupSettings,
			agentConversations: [],
			exportedAt: 123,
			now: new Date('2026-06-11T08:09:10Z')
		});
		const result = await readFullBackupImportFile({
			file: new File([backup.blob], 'backup.zip'),
			tasks: [task('existing', 100)],
			settings: DEFAULT_SETTINGS,
			agentConversations: [],
			activeAgentConversationId: null
		});

		expect(result.summary.addedCount).toBe(1);
		expect(result.summary.skippedDuplicateCount).toBe(0);
		expect(result.summary.tasks.map((item) => item.id)).toEqual(['imported', 'existing']);
		expect(result.settings.profiles.some((profile) => profile.id === 'backup-profile')).toBe(true);
		expect(result.settings.activeProfileId).toBe(DEFAULT_SETTINGS.activeProfileId);
		expect(result.activeAgentConversationId).toBe(null);
	});
});
