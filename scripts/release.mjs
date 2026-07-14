#!/usr/bin/env bun

import { spawnSync } from 'node:child_process';
import { normalizeVersionInput, syncVersionFiles } from './sync-version.mjs';

const VERSION_FILE_PATHS = [
	'package.json',
	'src-tauri/Cargo.toml',
	'src-tauri/Cargo.lock',
	'src-tauri/tauri.conf.json'
];

export async function runRelease({ rootDir = process.cwd(), versionInput, runGit = createGitRunner(rootDir) } = {}) {
	const { version, tag } = normalizeVersionInput(versionInput);
	const status = runGit(['status', '--porcelain']);

	if (status.stdout.trim() !== '') {
		throw new Error(
			`Working tree must be clean before releasing. Commit or stash these changes first:\n${status.stdout}`
		);
	}

	const existingTag = runGit(['tag', '--list', tag]);
	if (existingTag.stdout.trim() !== '') throw new Error(`Tag ${tag} already exists locally`);
	const remoteTag = runGit(['ls-remote', '--tags', 'origin', `refs/tags/${tag}`]);
	if (remoteTag.stdout.trim() !== '') throw new Error(`Tag ${tag} already exists on origin`);

	await syncVersionFiles(rootDir, version);
	runGit(['add', ...VERSION_FILE_PATHS]);
	runGit(['commit', '-m', `chore: release ${tag}`]);
	runGit(['tag', tag]);
	runGit(['push', 'origin', 'HEAD']);
	runGit(['push', 'origin', tag]);

	return { version, tag };
}

function createGitRunner(rootDir) {
	return (args) => {
		const result = spawnSync('git', args, { cwd: rootDir, encoding: 'utf8', stdio: 'pipe' });
		if (result.status !== 0) {
			throw new Error(
				`git ${args.join(' ')} failed with exit code ${result.status}\n${result.stderr || result.stdout}`
			);
		}
		return { stdout: result.stdout, stderr: result.stderr };
	};
}

async function main() {
	const versionInput = process.argv[2];
	if (!versionInput) {
		console.error('Usage: bun run release <version>');
		console.error('Example: bun run release 0.2.0');
		process.exitCode = 1;
		return;
	}

	try {
		const { version, tag } = await runRelease({ versionInput });
		console.log(`Released ${version}. Pushed commit and tag ${tag}.`);
		console.log(`Create and publish a GitHub Release from ${tag} to build and upload Tauri bundles.`);
	} catch (error) {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	}
}

if (import.meta.main) await main();
