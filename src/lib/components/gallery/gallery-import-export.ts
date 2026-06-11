import { buildFullBackupPayload, imageBytesToDataUrl, restoreFullBackupTasks } from '$lib/domain/full-backup';
import { normalizeAgentConversations, type AgentConversation } from '$lib/domain/agent';
import { normalizeSettings, type AppSettings } from '$lib/domain/settings';
import { createZipBlob, readStoredZipEntries } from '$lib/domain/zip';
import {
	buildExportedTasks,
	createTaskImportSummary,
	parseImportedTasks,
	type TaskImportSummary
} from '$lib/domain/task-storage';
import type { TaskRecord } from '$lib/domain/types';

export interface GalleryExportFile {
	fileName: string;
	blob: Blob;
}

export interface FullBackupExportInput {
	tasks: TaskRecord[];
	settings: AppSettings;
	agentConversations: AgentConversation[];
	exportedAt?: number;
	now?: Date;
}

export interface FullBackupImportInput {
	file: File;
	tasks: TaskRecord[];
	settings: AppSettings;
	agentConversations: AgentConversation[];
	activeAgentConversationId: string | null;
}

export interface FullBackupImportResult {
	settings: AppSettings;
	agentConversations: AgentConversation[];
	activeAgentConversationId: string | null;
	summary: TaskImportSummary;
}

export function buildTasksExportFile(tasks: TaskRecord[], exportedAt = Date.now()): GalleryExportFile {
	const payload = { ...buildExportedTasks(tasks), exportedAt };
	return {
		fileName: 'imageport-tasks.json',
		blob: new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
	};
}

export async function readTaskImportFile(file: File, tasks: TaskRecord[]): Promise<TaskImportSummary> {
	const imported = parseImportedTasks(await file.text());
	return createTaskImportSummary(tasks, imported);
}

export function buildFullBackupExportFile(input: FullBackupExportInput): GalleryExportFile {
	const exportedAt = input.exportedAt ?? Date.now();
	const payload = buildFullBackupPayload(input.tasks, input.settings, exportedAt, input.agentConversations);
	const manifestBytes = new TextEncoder().encode(JSON.stringify(payload.manifest, null, 2));
	return {
		fileName: `imageport-backup-${formatBackupTimestamp(input.now ?? new Date())}.zip`,
		blob: createZipBlob([{ path: 'manifest.json', data: manifestBytes }, ...payload.files])
	};
}

export async function readFullBackupImportFile(input: FullBackupImportInput): Promise<FullBackupImportResult> {
	const entries = readStoredZipEntries(new Uint8Array(await input.file.arrayBuffer()));
	const manifestBytes = entries.get('manifest.json');
	if (!manifestBytes) throw new Error('备份 ZIP 缺少 manifest.json');
	const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as Parameters<typeof restoreFullBackupTasks>[0];
	const restoredTasks = await restoreFullBackupTasks(manifest, async (path) => {
		const bytes = entries.get(path);
		return bytes ? imageBytesToDataUrl(bytes, path) : null;
	});
	const nextSettings = normalizeSettings({
		...manifest.settings,
		profiles: [...input.settings.profiles, ...manifest.settings.profiles],
		activeProfileId: input.settings.activeProfileId
	});
	let nextAgentConversations = input.agentConversations;
	let nextActiveAgentConversationId = input.activeAgentConversationId;
	if (manifest.agentConversations?.length) {
		nextAgentConversations = normalizeAgentConversations([...input.agentConversations, ...manifest.agentConversations]);
		nextActiveAgentConversationId = input.activeAgentConversationId ?? nextAgentConversations[0]?.id ?? null;
	}

	return {
		settings: nextSettings,
		agentConversations: nextAgentConversations,
		activeAgentConversationId: nextActiveAgentConversationId,
		summary: createTaskImportSummary(input.tasks, restoredTasks)
	};
}

export function createSafeExportName(value: string) {
	return (
		value
			.trim()
			.replace(/[^a-zA-Z0-9\u4e00-\u9fa5._-]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 48) || 'imageport'
	);
}

function formatBackupTimestamp(value: Date) {
	return value.toISOString().slice(0, 19).replace(/[:T]/g, '-');
}
