import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const dataDir = '/Users/jevon/Library/Application Support/run.jiewen.imageport-desktop';
const dbPath = path.join(dataDir, 'imageport.db');
const recoveredPath = '/private/tmp/imageport-recovered-gallery-payloads.preview.json';

function fail(message) {
	console.error(message);
	process.exit(1);
}

function sqlString(value) {
	if (value === null || value === undefined) return 'NULL';
	return `'${String(value).replaceAll("'", "''")}'`;
}

function runSql(sql) {
	const result = spawnSync('sqlite3', [dbPath], {
		input: sql,
		encoding: 'utf8',
		maxBuffer: 10 * 1024 * 1024
	});
	if (result.status !== 0) {
		fail(`sqlite3 failed:\n${result.stderr || result.stdout}`);
	}
	return result.stdout.trim();
}

if (!existsSync(dbPath)) fail(`Database not found: ${dbPath}`);
if (!existsSync(recoveredPath)) fail(`Recovered payloads not found: ${recoveredPath}`);

const recoveredPayloads = JSON.parse(readFileSync(recoveredPath, 'utf8'));
if (!Array.isArray(recoveredPayloads)) fail('Recovered payload file is not an array.');

const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
const backups = [];
for (const suffix of ['', '-wal', '-shm']) {
	const file = `${dbPath}${suffix}`;
	if (!existsSync(file)) continue;
	const backup = `${file}.backup-${timestamp}`;
	copyFileSync(file, backup);
	backups.push(backup);
}

let sql = `
CREATE TABLE IF NOT EXISTS gallery_tasks (
	id TEXT PRIMARY KEY,
	prompt TEXT NOT NULL,
	status TEXT NOT NULL,
	created_at INTEGER NOT NULL,
	finished_at INTEGER,
	payload TEXT NOT NULL,
	updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_gallery_tasks_created_at ON gallery_tasks(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gallery_tasks_status ON gallery_tasks(status);
BEGIN IMMEDIATE;
`;

let candidateCount = 0;
for (const payload of recoveredPayloads) {
	const task = payload?.task;
	if (!task?.id || !task?.prompt || !task?.status || !Number.isFinite(task?.createdAt)) continue;
	candidateCount += 1;
	sql += `
INSERT INTO gallery_tasks (id, prompt, status, created_at, finished_at, payload, updated_at)
VALUES (
	${sqlString(task.id)},
	${sqlString(task.prompt)},
	${sqlString(task.status)},
	${Math.trunc(task.createdAt)},
	${Number.isFinite(task.finishedAt) ? Math.trunc(task.finishedAt) : 'NULL'},
	${sqlString(JSON.stringify(payload))},
	${Date.now()}
)
ON CONFLICT(id) DO NOTHING;
`;
}

sql += 'COMMIT;';

const before = runSql('SELECT COUNT(*) FROM gallery_tasks;');
runSql(sql);
const after = runSql('SELECT COUNT(*) FROM gallery_tasks;');
const rows = runSql("SELECT id || ' | ' || status || ' | ' || prompt FROM gallery_tasks ORDER BY created_at DESC;");

console.log(JSON.stringify(
	{
		dbPath,
		recoveredPath,
		backups,
		candidateCount,
		countBefore: Number(before),
		countAfter: Number(after),
		rows: rows ? rows.split('\n') : []
	},
	null,
	2
));
