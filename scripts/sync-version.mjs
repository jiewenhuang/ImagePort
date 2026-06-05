import { readFile, writeFile } from "node:fs/promises";

const rawVersion = process.argv[2];

if (!rawVersion) {
	console.error("Usage: bun scripts/sync-version.mjs <version>");
	process.exit(1);
}

const version = rawVersion.replace(/^v/, "");

if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
	console.error(`Invalid semver version: ${rawVersion}`);
	process.exit(1);
}

const replaceOrFail = (source, pattern, replacement, label) => {
	if (!pattern.test(source)) {
		console.error(`Could not update ${label}`);
		process.exit(1);
	}
	const next = source.replace(pattern, replacement);
	return next;
};

const updateJsonFile = async (path, updater) => {
	const source = await readFile(path, "utf8");
	const json = JSON.parse(source);
	updater(json);
	const indent = source.includes("\t") ? "\t" : 2;
	await writeFile(path, `${JSON.stringify(json, null, indent)}\n`);
};

await updateJsonFile("package.json", (json) => {
	json.version = version;
});

await updateJsonFile("src-tauri/tauri.conf.json", (json) => {
	json.version = version;
});

const cargoTomlPath = "src-tauri/Cargo.toml";
const cargoToml = await readFile(cargoTomlPath, "utf8");
await writeFile(
	cargoTomlPath,
	replaceOrFail(
		cargoToml,
		/^version = ".*"$/m,
		`version = "${version}"`,
		cargoTomlPath,
	),
);

const cargoLockPath = "src-tauri/Cargo.lock";
const cargoLock = await readFile(cargoLockPath, "utf8");
await writeFile(
	cargoLockPath,
	replaceOrFail(
		cargoLock,
		/(\[\[package\]\]\r?\nname = "imageport-desktop"\r?\nversion = )".*"/,
		`$1"${version}"`,
		cargoLockPath,
	),
);

console.log(`Synced ImagePort version to ${version}`);
