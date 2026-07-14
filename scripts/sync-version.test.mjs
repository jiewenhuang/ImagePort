import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { assertVersionsMatchTag, readVersionFiles } from './sync-version.mjs';

const scriptPath = new URL('./sync-version.mjs', import.meta.url).pathname;

describe('sync-version', () => {
	test('updates Cargo.lock package versions with CRLF line endings', async () => {
		const root = await mkdtemp(join(tmpdir(), 'imageport-sync-version-'));
		try {
			await mkdir(join(root, 'src-tauri'), { recursive: true });
			await writeFile(root + '/package.json', '{\r\n  "name": "imageport-desktop",\r\n  "version": "0.1.0"\r\n}\r\n');
			await writeFile(
				root + '/src-tauri/tauri.conf.json',
				'{\r\n  "productName": "ImagePort",\r\n  "version": "0.1.0"\r\n}\r\n'
			);
			await writeFile(
				root + '/src-tauri/Cargo.toml',
				'[package]\r\nname = "imageport-desktop"\r\nversion = "0.1.0"\r\n'
			);
			await writeFile(
				root + '/src-tauri/Cargo.lock',
				'version = 4\r\n\r\n[[package]]\r\nname = "imageport-desktop"\r\nversion = "0.1.0"\r\ndependencies = []\r\n'
			);

			const result = spawnSync('bun', [scriptPath, 'v1.2.3'], { cwd: root, encoding: 'utf8' });

			expect(result.status).toBe(0);
			expect(await readFile(root + '/src-tauri/Cargo.lock', 'utf8')).toContain(
				'[[package]]\r\nname = "imageport-desktop"\r\nversion = "1.2.3"'
			);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test('reads and verifies every release version source', async () => {
		const root = await mkdtemp(join(tmpdir(), 'imageport-release-version-'));
		try {
			await mkdir(join(root, 'src-tauri'), { recursive: true });
			await writeFile(root + '/package.json', '{"name":"imageport-desktop","version":"1.2.3"}\n');
			await writeFile(root + '/src-tauri/tauri.conf.json', '{"version":"1.2.3"}\n');
			await writeFile(root + '/src-tauri/Cargo.toml', '[package]\nname = "imageport-desktop"\nversion = "1.2.3"\n');
			await writeFile(
				root + '/src-tauri/Cargo.lock',
				'version = 4\n\n[[package]]\nname = "imageport-desktop"\nversion = "1.2.3"\n'
			);

			expect(await readVersionFiles(root)).toEqual({
				packageJson: '1.2.3',
				tauriConfig: '1.2.3',
				cargoPackage: '1.2.3',
				cargoLock: '1.2.3'
			});
			expect((await assertVersionsMatchTag(root, 'v1.2.3')).expectedVersion).toBe('1.2.3');
			await expect(assertVersionsMatchTag(root, 'v1.2.4')).rejects.toThrow('Version mismatch for package.json');
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
