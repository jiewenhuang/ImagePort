import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

const scriptPath = new URL("./sync-version.mjs", import.meta.url).pathname;

describe("sync-version", () => {
	test("updates Cargo.lock package versions with CRLF line endings", async () => {
		const root = await mkdtemp(join(tmpdir(), "imageport-sync-version-"));
		try {
			await mkdir(join(root, "src-tauri"), { recursive: true });
			await writeFile(root + "/package.json", '{\r\n  "name": "imageport-desktop",\r\n  "version": "0.1.0"\r\n}\r\n');
			await writeFile(
				root + "/src-tauri/tauri.conf.json",
				'{\r\n  "productName": "ImagePort",\r\n  "version": "0.1.0"\r\n}\r\n',
			);
			await writeFile(
				root + "/src-tauri/Cargo.toml",
				'[package]\r\nname = "imageport-desktop"\r\nversion = "0.1.0"\r\n',
			);
			await writeFile(
				root + "/src-tauri/Cargo.lock",
				'version = 4\r\n\r\n[[package]]\r\nname = "imageport-desktop"\r\nversion = "0.1.0"\r\ndependencies = []\r\n',
			);

			const result = spawnSync("bun", [scriptPath, "v1.2.3"], { cwd: root, encoding: "utf8" });

			expect(result.status).toBe(0);
			expect(await readFile(root + "/src-tauri/Cargo.lock", "utf8")).toContain(
				'[[package]]\r\nname = "imageport-desktop"\r\nversion = "1.2.3"',
			);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
