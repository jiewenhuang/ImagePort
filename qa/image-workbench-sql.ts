// Exercises the production SQL against a real in-memory SQLite database. No application data is accessed.
import { Database } from 'bun:sqlite';
import assert from 'node:assert/strict';
import { createRunningTask } from '../src/lib/domain/task-factory';
import { DEFAULT_PARAMS } from '../src/lib/domain/types';
import { DEFAULT_SETTINGS } from '../src/lib/domain/settings';
import {
	createFileBackedTaskPayload,
	previewFileBackedTaskPayload,
	selectTaskRowsPage,
	selectStoredTaskRows,
	upsertTaskRow
} from '../src/lib/storage/gallery-db';

const db = new Database(':memory:');
db.exec(
	'CREATE TABLE gallery_tasks(id TEXT PRIMARY KEY,prompt TEXT,status TEXT,created_at INTEGER,finished_at INTEGER,payload TEXT,updated_at INTEGER)'
);
const executor = {
	async execute(sql: string, values: unknown[] = []) {
		return db.query(sql).run(...(values as any[]));
	}
};
const selector = {
	async select<T>(sql: string, values: unknown[] = []): Promise<T> {
		return db.query(sql).all(...(values as any[])) as T;
	}
};
const original = {
	...createRunningTask({
		taskId: 'fixture',
		taskPrompt: 'fixture',
		taskParams: DEFAULT_PARAMS,
		taskInputImages: [],
		taskMask: null,
		sourceMode: 'gallery',
		profile: DEFAULT_SETTINGS.profiles[0]
	}),
	status: 'done' as const,
	images: ['data:image/png;base64,aW1n'],
	rawResponsePayload: '{"retained":"original provider payload"}'
};
const files = {
	async save(kind: string, id: string) {
		return { path: `images/${kind}/${id}.png`, mime: 'image/png' };
	},
	async read() {
		return 'data:image/png;base64,aW1n';
	}
};
const payload = await createFileBackedTaskPayload(original, files);
await upsertTaskRow(executor, original, payload);
const [row] = await selectTaskRowsPage(selector, { limit: 24, offset: 0 });
assert.equal(JSON.parse(row.payload).task.rawResponsePayload, undefined);
const preview = await previewFileBackedTaskPayload(JSON.parse(row.payload), files);
assert(preview.storedMedia);
await upsertTaskRow(
	executor,
	{ ...preview, isFavorite: true },
	await createFileBackedTaskPayload({ ...preview, isFavorite: true }, files)
);
const [stored] = await selectStoredTaskRows(selector, 'full');
const saved = JSON.parse(stored.payload);
assert.equal(saved.task.rawResponsePayload, original.rawResponsePayload);
assert.equal(saved.task.isFavorite, true);
assert.deepEqual(saved.imageRefs, payload.imageRefs);
assert.equal(
	JSON.parse((await selectStoredTaskRows(selector, 'preview'))[0].payload).task.rawResponsePayload,
	undefined
);
db.close();
console.log('SQLite preview projection and metadata update preserved original response and file references.');
