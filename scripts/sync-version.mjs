#!/usr/bin/env bun

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const VERSION_FILES = {
	packageJson: 'package.json',
	tauriConfig: 'src-tauri/tauri.conf.json',
	cargoPackage: 'src-tauri/Cargo.toml',
	cargoLock: 'src-tauri/Cargo.lock'
};

const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export function normalizeVersionInput(input) {
	const rawVersion = String(input ?? '').trim();
	const version = rawVersion.startsWith('v') ? rawVersion.slice(1) : rawVersion;

	if (!SEMVER_PATTERN.test(version)) {
		throw new Error(`Expected a semantic version like 1.2.3 or v1.2.3, got "${rawVersion}"`);
	}

	return { version, tag: `v${version}` };
}

export async function readVersionFiles(rootDir = process.cwd()) {
	const cargoPackagePath = join(rootDir, VERSION_FILES.cargoPackage);
	const cargoPackage = await readFile(cargoPackagePath, 'utf8');
	const cargoPackageName = readCargoPackageName(cargoPackage, cargoPackagePath);

	return {
		packageJson: await readJsonVersion(join(rootDir, VERSION_FILES.packageJson)),
		tauriConfig: await readJsonVersion(join(rootDir, VERSION_FILES.tauriConfig)),
		cargoPackage: readCargoPackageVersion(cargoPackage, cargoPackagePath),
		cargoLock: readCargoLockPackageVersion(
			await readFile(join(rootDir, VERSION_FILES.cargoLock), 'utf8'),
			join(rootDir, VERSION_FILES.cargoLock),
			cargoPackageName
		)
	};
}

export async function syncVersionFiles(rootDir, versionInput) {
	const { version, tag } = normalizeVersionInput(versionInput);

	await updateJsonVersion(join(rootDir, VERSION_FILES.packageJson), version);
	await updateJsonVersion(join(rootDir, VERSION_FILES.tauriConfig), version);

	const cargoPackagePath = join(rootDir, VERSION_FILES.cargoPackage);
	const cargoPackage = await readFile(cargoPackagePath, 'utf8');
	const cargoPackageName = readCargoPackageName(cargoPackage, cargoPackagePath);
	await writeFile(cargoPackagePath, updateCargoPackageVersion(cargoPackage, cargoPackagePath, version));

	const cargoLockPath = join(rootDir, VERSION_FILES.cargoLock);
	const cargoLock = await readFile(cargoLockPath, 'utf8');
	await writeFile(cargoLockPath, updateCargoLockPackageVersion(cargoLock, cargoLockPath, cargoPackageName, version));

	return { version, tag };
}

export async function assertVersionsMatchTag(rootDir, tagName) {
	const { version: expectedVersion } = normalizeVersionInput(tagName);
	const versions = await readVersionFiles(rootDir);

	for (const [name, version] of Object.entries(versions)) {
		if (version !== expectedVersion) {
			throw new Error(
				`Version mismatch for ${formatVersionSource(name)}: expected ${expectedVersion} from ${tagName}, got ${version}`
			);
		}
	}

	return { expectedVersion, versions };
}

async function readJsonVersion(filePath) {
	const data = JSON.parse(await readFile(filePath, 'utf8'));
	if (typeof data.version !== 'string') throw new Error(`${filePath} must contain a string version field`);
	return data.version;
}

async function updateJsonVersion(filePath, version) {
	const source = await readFile(filePath, 'utf8');
	const data = JSON.parse(source);
	data.version = version;
	const indent = source.includes('\t') ? '\t' : 2;
	const newline = source.includes('\r\n') ? '\r\n' : '\n';
	const content = JSON.stringify(data, null, indent).replace(/\n/g, newline);
	await writeFile(filePath, `${content}${newline}`);
}

function readCargoPackageVersion(content, filePath) {
	const packageSection = getCargoPackageSection(content, filePath);
	const match = packageSection.match(/^version\s*=\s*"([^"]+)"/m);
	if (!match) throw new Error(`${filePath} [package] section must contain a version field`);
	return match[1];
}

function readCargoPackageName(content, filePath) {
	const packageSection = getCargoPackageSection(content, filePath);
	const match = packageSection.match(/^name\s*=\s*"([^"]+)"/m);
	if (!match) throw new Error(`${filePath} [package] section must contain a name field`);
	return match[1];
}

function updateCargoPackageVersion(content, filePath, version) {
	const packageSection = getCargoPackageSection(content, filePath);
	if (!/^version\s*=\s*"[^"]+"/m.test(packageSection)) {
		throw new Error(`${filePath} [package] section must contain a version field`);
	}
	const updated = packageSection.replace(/^version\s*=\s*"[^"]+"/m, `version = "${version}"`);
	return content.replace(packageSection, updated);
}

function readCargoLockPackageVersion(content, filePath, packageName) {
	const packageSection = getCargoLockPackageSection(content, filePath, packageName);
	const match = packageSection.match(/^version\s*=\s*"([^"]+)"/m);
	if (!match) throw new Error(`${filePath} package ${packageName} must contain a version field`);
	return match[1];
}

function updateCargoLockPackageVersion(content, filePath, packageName, version) {
	const packageSection = getCargoLockPackageSection(content, filePath, packageName);
	if (!/^version\s*=\s*"[^"]+"/m.test(packageSection)) {
		throw new Error(`${filePath} package ${packageName} must contain a version field`);
	}
	const updated = packageSection.replace(/^version\s*=\s*"[^"]+"/m, `version = "${version}"`);
	return content.replace(packageSection, updated);
}

function getCargoLockPackageSection(content, filePath, packageName) {
	const packageHeaders = [...content.matchAll(/^\[\[package\]\]\s*$/gm)];
	for (const [index, header] of packageHeaders.entries()) {
		const start = header.index;
		const end = packageHeaders[index + 1]?.index ?? content.length;
		const section = content.slice(start, end);
		if (new RegExp(`^name\\s*=\\s*"${escapeRegExp(packageName)}"`, 'm').test(section)) return section;
	}
	throw new Error(`${filePath} must contain package ${packageName}`);
}

function getCargoPackageSection(content, filePath) {
	const match = content.match(/^\[package\]\s*$/m);
	if (!match) throw new Error(`${filePath} must contain a [package] section`);
	const start = match.index;
	const afterHeaderStart = start + match[0].length;
	const afterHeader = content.slice(afterHeaderStart);
	const nextHeaderIndex = afterHeader.search(/\r?\n\[[^\]]+\]/);
	const end = nextHeaderIndex === -1 ? content.length : afterHeaderStart + nextHeaderIndex + 1;
	return content.slice(start, end);
}

function formatVersionSource(name) {
	return VERSION_FILES[name] ?? name;
}

function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function main() {
	const versionInput = process.argv[2];
	if (!versionInput) {
		console.error('Usage: bun scripts/sync-version.mjs <version>');
		process.exitCode = 1;
		return;
	}

	try {
		const { version } = await syncVersionFiles(process.cwd(), versionInput);
		console.log(`Synced ImagePort version to ${version}`);
	} catch (error) {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	}
}

if (import.meta.main) await main();
