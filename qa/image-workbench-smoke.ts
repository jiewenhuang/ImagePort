// Local desktop smoke environment. Uses a separate application identifier and a loopback-only mock API.
// bun qa/image-workbench-smoke.ts --init
import { Database } from 'bun:sqlite';
import { mkdir, writeFile, access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/lib/domain/settings';
import { DEFAULT_PARAMS } from '../src/lib/domain/types';
import { createRunningTask } from '../src/lib/domain/task-factory';
import { createFileBackedTaskPayload } from '../src/lib/storage/gallery-db';

const identifier = 'run.jiewen.imageport-desktop.preview';
const port = 23361;
const png = await Bun.file(new URL('../src-tauri/icons/128x128@2x.png', import.meta.url)).bytes();
const b64 = Buffer.from(png).toString('base64');
const image = `data:image/png;base64,${b64}`;
const dataDir = join(homedir(), 'Library/Application Support', identifier);

if (process.argv.includes('--init')) {
	if (process.platform !== 'darwin') throw new Error('This fixture profile initializer currently targets macOS.');
	let exists = false;
	try {
		await access(join(dataDir, 'imageport-settings.json'));
		exists = true;
	} catch {
		/* New isolated profile. */
	}
	if (exists) throw new Error(`Preview profile already exists; refusing to overwrite: ${dataDir}`);
	await mkdir(dataDir, { recursive: true, mode: 0o700 });
	const profile = {
		...DEFAULT_SETTINGS.profiles[0],
		id: 'qa-images',
		name: '本地验收图片',
		baseUrl: `http://127.0.0.1:${port}/v1`,
		apiKey: 'local-test-only',
		responseFormatB64Json: true
	};
	const settings = normalizeSettings({
		...DEFAULT_SETTINGS,
		profiles: [
			profile,
			{
				...profile,
				id: 'qa-think',
				name: '本地验收 Agent',
				apiProtocol: 'openai-responses',
				apiMode: 'responses',
				model: 'local-reasoner'
			}
		],
		activeProfileId: profile.id,
		workspaceRouting: { galleryProfileId: profile.id, agentProfileId: 'qa-think', agentImageProfileId: profile.id },
		persistInputOnRestart: true
	});
	await writeFile(
		join(dataDir, 'imageport-settings.json'),
		JSON.stringify({
			'gallery.settings': {
				...settings,
				schemaVersion: 1,
				videoProviderConnections: [{ apiKey: 'retired-fixture' }],
				s3Storage: { bucket: 'retired-fixture' }
			}
		})
	);
	const db = new Database(join(dataDir, 'imageport.db'));
	db.exec(
		'CREATE TABLE gallery_tasks (id TEXT PRIMARY KEY,prompt TEXT NOT NULL,status TEXT NOT NULL,created_at INTEGER NOT NULL,finished_at INTEGER,payload TEXT NOT NULL,updated_at INTEGER NOT NULL)'
	);
	db.exec('CREATE TABLE studio_projects (id TEXT PRIMARY KEY,payload TEXT NOT NULL)');
	db.query('INSERT INTO studio_projects VALUES (?,?)').run('retained', 'legacy fixture');
	for (let index = 1; index <= 26; index++) {
		const id = `qa-history-${String(index).padStart(2, '0')}`;
		const task = {
			...createRunningTask({
				taskId: id,
				taskPrompt: `历史回归样例 ${index}`,
				taskParams: { ...DEFAULT_PARAMS },
				taskInputImages: [],
				taskMask: null,
				sourceMode: 'gallery',
				profile
			}),
			createdAt: Date.now() - index * 1000,
			finishedAt: Date.now(),
			images: [image],
			status: index === 26 ? ('running' as const) : ('done' as const),
			isFavorite: index === 25,
			favoriteCollectionIds: index === 25 ? ['favorites-default'] : []
		};
		const payload = await createFileBackedTaskPayload(
			task,
			{
				async save(kind, fileId, dataUrl) {
					const path = `images/${kind}/${fileId}.png`;
					await mkdir(join(dataDir, 'images', kind), { recursive: true });
					await writeFile(join(dataDir, path), Buffer.from(dataUrl.split(',')[1], 'base64'));
					return { path, mime: 'image/png' };
				},
				async read() {
					return null;
				}
			},
			async () => image
		);
		db.query('INSERT INTO gallery_tasks VALUES (?,?,?,?,?,?,?)').run(
			id,
			task.prompt,
			task.status,
			task.createdAt,
			task.finishedAt,
			JSON.stringify(payload),
			Date.now()
		);
	}
	db.close();
	const studio = new Database(join(dataDir, 'imageport-studio.db'));
	studio.exec(
		"CREATE TABLE studio_projects(id TEXT PRIMARY KEY,payload TEXT); INSERT INTO studio_projects VALUES ('retained','legacy fixture')"
	);
	studio.close();
	await mkdir(join(dataDir, 'studio-media'), { recursive: true });
	await writeFile(join(dataDir, 'studio-media/retained-marker.txt'), 'Legacy media must remain untouched.');
	console.log(`Initialized isolated preview profile: ${dataDir}`);
}

const requests: Array<{ path: string; stream: boolean; references: number; mask: boolean; failed: boolean }> = [];
Bun.serve({
	hostname: '127.0.0.1',
	port,
	async fetch(request) {
		const path = new URL(request.url).pathname;
		if (path === '/stats') return Response.json({ requests });
		if (!path.startsWith('/v1/') || request.method !== 'POST') return new Response('Mock API only', { status: 404 });
		let body: Record<string, unknown>;
		let references = 0;
		let mask = false;
		if (request.headers.get('content-type')?.includes('multipart/form-data')) {
			const form = await request.formData();
			body = Object.fromEntries(form.entries());
			references = [...form.entries()].filter(([key]) => key.startsWith('image')).length;
			mask = form.has('mask');
		} else body = (await request.json()) as Record<string, unknown>;
		const prompt = String(body.prompt ?? JSON.stringify(body.input ?? ''));
		const failed = prompt.includes('[error]');
		requests.push({ path, stream: body.stream === true || body.stream === 'true', references, mask, failed });
		if (prompt.includes('[slow]')) await Bun.sleep(5000);
		if (failed) return Response.json({ error: { message: '本地验收模拟失败，可复用后重试' } }, { status: 503 });
		if (path.endsWith('/responses'))
			return Response.json({
				id: `local-${requests.length}`,
				output: [{ type: 'message', content: [{ type: 'output_text', text: '本地验收回复：可以继续调整图片细节。' }] }]
			});
		if (body.stream === true || body.stream === 'true') {
			return new Response(
				new ReadableStream({
					async start(controller) {
						const send = (value: unknown) =>
							controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`));
						send({ object: 'image.generation.partial_image', b64_json: b64 });
						await Bun.sleep(350);
						send({ object: 'image.generation.result', data: [{ b64_json: b64 }] });
						controller.close();
					}
				}),
				{ headers: { 'content-type': 'text/event-stream' } }
			);
		}
		return Response.json({ data: [{ b64_json: b64, revised_prompt: '本地验收固定样例' }] });
	}
});
console.log(`Loopback mock API: http://127.0.0.1:${port}/v1`);
