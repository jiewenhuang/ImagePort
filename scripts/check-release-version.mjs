#!/usr/bin/env bun

import { assertVersionsMatchTag } from './sync-version.mjs';

export async function runCheckReleaseVersion({ rootDir = process.cwd(), tagName } = {}) {
	if (!tagName) throw new Error('Missing release tag name');
	return assertVersionsMatchTag(rootDir, tagName);
}

async function main() {
	const tagName = process.argv[2] || process.env.GITHUB_REF_NAME;
	try {
		const { expectedVersion } = await runCheckReleaseVersion({ tagName });
		console.log(`Release tag version matches app version: ${expectedVersion}`);
	} catch (error) {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	}
}

if (import.meta.main) await main();
