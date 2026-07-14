import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runRelease } from './release.mjs';

const tempRoots = [];

afterEach(async () => {
	await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function createFixture() {
	const root = await mkdtemp(join(tmpdir(), 'imageport-release-'));
	tempRoots.push(root);
	await mkdir(join(root, 'src-tauri'), { recursive: true });
	await writeFile(join(root, 'package.json'), '{"name":"imageport-desktop","version":"0.1.0"}\n');
	await writeFile(join(root, 'src-tauri', 'tauri.conf.json'), '{"version":"0.1.0"}\n');
	await writeFile(
		join(root, 'src-tauri', 'Cargo.toml'),
		'[package]\nname = "imageport-desktop"\nversion = "0.1.0"\nedition = "2021"\n'
	);
	await writeFile(
		join(root, 'src-tauri', 'Cargo.lock'),
		'version = 4\n\n[[package]]\nname = "imageport-desktop"\nversion = "0.1.0"\n'
	);
	return root;
}

describe('release command', () => {
	test('updates versions, commits, tags, and pushes', async () => {
		const root = await createFixture();
		const calls = [];
		const runGit = (args) => {
			calls.push(args);
			return { stdout: '', stderr: '' };
		};

		await expect(runRelease({ rootDir: root, versionInput: '1.2.3', runGit })).resolves.toEqual({
			version: '1.2.3',
			tag: 'v1.2.3'
		});
		expect(calls).toEqual([
			['status', '--porcelain'],
			['tag', '--list', 'v1.2.3'],
			['ls-remote', '--tags', 'origin', 'refs/tags/v1.2.3'],
			['add', ...VERSION_FILE_PATHS],
			['commit', '-m', 'chore: release v1.2.3'],
			['tag', 'v1.2.3'],
			['push', 'origin', 'HEAD'],
			['push', 'origin', 'v1.2.3']
		]);
		expect(JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version).toBe('1.2.3');
	});

	test('refuses a dirty worktree before changing versions', async () => {
		const root = await createFixture();
		const runGit = () => ({ stdout: ' M src/main.ts\n', stderr: '' });
		await expect(runRelease({ rootDir: root, versionInput: '1.2.3', runGit })).rejects.toThrow(
			'Working tree must be clean'
		);
		expect(JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version).toBe('0.1.0');
	});

	test('refuses an existing local tag', async () => {
		const root = await createFixture();
		const runGit = (args) => ({
			stdout: args[0] === 'tag' ? 'v1.2.3\n' : '',
			stderr: ''
		});
		await expect(runRelease({ rootDir: root, versionInput: '1.2.3', runGit })).rejects.toThrow(
			'Tag v1.2.3 already exists locally'
		);
	});

	test('refuses an existing origin tag before changing versions', async () => {
		const root = await createFixture();
		const runGit = (args) => ({
			stdout: args[0] === 'ls-remote' ? 'abc123\trefs/tags/v1.2.3\n' : '',
			stderr: ''
		});
		await expect(runRelease({ rootDir: root, versionInput: '1.2.3', runGit })).rejects.toThrow(
			'Tag v1.2.3 already exists on origin'
		);
		expect(JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version).toBe('0.1.0');
	});
});

const VERSION_FILE_PATHS = [
	'package.json',
	'src-tauri/Cargo.toml',
	'src-tauri/Cargo.lock',
	'src-tauri/tauri.conf.json'
];
