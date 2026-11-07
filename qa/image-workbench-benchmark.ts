// Reads an archived data copy and reports aggregate metrics only. Never writes application data.
// bun qa/image-workbench-benchmark.ts /absolute/path/to/copied-app-data
import { Database } from 'bun:sqlite';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
	hydrateFileBackedTaskPayload,
	previewFileBackedTaskPayload,
	selectTaskRowsPage,
	type FileBackedTaskPayload
} from '../src/lib/storage/gallery-db';
import { normalizeSettings } from '../src/lib/domain/settings';
import type { TaskRecord } from '../src/lib/domain/types';

const dataDir = process.argv[2];
if (!dataDir) throw new Error('Pass an archived app-data directory; do not benchmark a live database.');
// The copied database has been checkpointed; immutable mode avoids creating WAL sidecars in the archive.
const databaseUrl = pathToFileURL(resolve(dataDir, 'imageport.db'));
databaseUrl.searchParams.set('immutable', '1');
const db = new Database(databaseUrl.href, { readonly: true });
const total = db.query('SELECT COUNT(*) AS count FROM gallery_tasks').get() as { count: number };
const rows = db.query('SELECT payload FROM gallery_tasks ORDER BY created_at DESC LIMIT 24').all() as Array<{
	payload: string;
}>;
const previewRows = await selectTaskRowsPage(
	{
		async select<T>(sql: string, values: unknown[] = []): Promise<T> {
			return db.query(sql).all(...(values as any[])) as T;
		}
	},
	{ limit: 24, offset: 0 }
);
db.close();
const settingsStore = JSON.parse(await readFile(join(dataDir, 'imageport-settings.json'), 'utf8'));
const previous = settingsStore['gallery.settings'];
const migrated = normalizeSettings(previous);
const credentialsPreserved = previous.profiles.every(
	(profile: { id: string; apiKey: string }) =>
		migrated.profiles.find((item) => item.id === profile.id)?.apiKey === profile.apiKey
);
if (!credentialsPreserved || migrated.profiles.length !== previous.profiles.length)
	throw new Error('Profile migration changed credentials or profile membership.');

async function measure(mode: 'full' | 'preview') {
	Bun.gc(true);
	let fileReads = 0;
	let bytesRead = 0;
	const started = performance.now();
	const tasks = await Promise.all(
		(mode === 'full' ? rows : previewRows).map(async ({ payload }) => {
			const parsed = JSON.parse(payload);
			if (parsed.version !== 2) return parsed as TaskRecord;
			const files = {
				async save() {
					return null;
				},
				async read(file: { path: string; mime: string }) {
					if (file.mime === 'inline/data-url') return file.path;
					try {
						const bytes = await readFile(join(dataDir, file.path));
						fileReads++;
						bytesRead += bytes.length;
						return `data:${file.mime};base64,${bytes.toString('base64')}`;
					} catch {
						return null;
					}
				}
			};
			return mode === 'full'
				? hydrateFileBackedTaskPayload(parsed as FileBackedTaskPayload, files)
				: previewFileBackedTaskPayload(parsed as FileBackedTaskPayload, files);
		})
	);
	const elapsedMs = Math.round((performance.now() - started) * 100) / 100;
	const mediaCharacters = tasks.reduce(
		(total, task) =>
			total +
			(task
				? [
						...task.images,
						...(task.thumbnailImages ?? []),
						...task.streamPartialImageIds,
						...task.inputImages.map((image) => image.dataUrl),
						task.mask?.dataUrl ?? ''
					].reduce((sum, image) => sum + image.length, 0)
				: 0),
		0
	);
	return { fileReads, bytesRead, elapsedMs, mediaCharacters };
}

const full = await measure('full');
const preview = await measure('preview');
console.log(
	JSON.stringify(
		{
			platform: `${process.platform}/${process.arch}`,
			totalTasks: total.count,
			pageSize: rows.length,
			sqlPayloadBytes: {
				full: rows.reduce((sum, row) => sum + Buffer.byteLength(row.payload), 0),
				preview: previewRows.reduce((sum, row) => sum + Buffer.byteLength(row.payload), 0)
			},
			profileMigration: {
				count: migrated.profiles.length,
				credentialsPreserved,
				schemaVersion: migrated.schemaVersion
			},
			full,
			preview,
			fileBytesReductionPercent: Math.round((1 - preview.bytesRead / full.bytesRead) * 10000) / 100,
			note: 'Same archived first page; filesystem bridge and WebView rendering excluded. Timing is indicative, not a cold-start benchmark.'
		},
		null,
		2
	)
);
