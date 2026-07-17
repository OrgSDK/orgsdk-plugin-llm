/**
 * Packaging tests — determinism, stale-output removal, and generated
 * package.json in the staged artifact.
 *
 * llm imports `zod` at runtime (the config schema in index.ts and the output
 * schemas in llm-eval-functions.ts call `z.object` / `z.toJSONSchema`). It is
 * NOT a no-dependency plugin: zod is declared as a runtime dependency in
 * package.json so the catalog's materialise step resolves it. The OpenAI SDK is
 * intentionally NOT a dependency — `_llm-client.ts` calls the OpenAI-compatible
 * Chat Completions API directly with `fetch`.
 */
import { describe, expect, it } from "bun:test";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { $ } from "bun";

const ROOT = resolve(import.meta.dir, "..");
const DIST_DIR = join(ROOT, "dist");

interface ManifestInfo {
	name: string;
	version: string;
}

async function readManifestInfo(): Promise<ManifestInfo> {
	const raw = await readFile(join(ROOT, "plugin", ".plugin.json"), "utf-8");
	return JSON.parse(raw) as ManifestInfo;
}

async function manifestPath(): Promise<string> {
	const { name, version } = await readManifestInfo();
	return join(DIST_DIR, `${name}-${version}.manifest.json`);
}

describe("packaging", () => {
	it("removes stale files from dist/ before staging", async () => {
		await rm(DIST_DIR, { recursive: true, force: true });
		await mkdir(DIST_DIR, { recursive: true });
		const sentinel = join(DIST_DIR, "STALE_SENTINEL.txt");
		await writeFile(sentinel, "this should not survive packaging");

		await $`bun run package`.cwd(ROOT).quiet();

		await expect(stat(sentinel)).rejects.toThrow();
	});

	it("produces deterministic output across runs", async () => {
		await $`bun run package`.cwd(ROOT).quiet();
		const first = await readFile(await manifestPath(), "utf-8");

		await $`bun run package`.cwd(ROOT).quiet();
		const second = await readFile(await manifestPath(), "utf-8");

		expect(second).toBe(first);
	});

	it("manifest entries are sorted by path", async () => {
		await $`bun run package`.cwd(ROOT).quiet();
		const raw = await readFile(await manifestPath(), "utf-8");
		const parsed = JSON.parse(raw) as {
			files: Array<{ path: string }>;
		};
		const paths = parsed.files.map((f) => f.path);
		const sorted = [...paths].sort((a, b) => a.localeCompare(b));
		expect(paths).toEqual(sorted);
	});

	it("generated package.json in artifact carries zod as the only runtime dep (no @orgsdk/plugins, no openai)", async () => {
		const { name, version } = await readManifestInfo();
		await $`bun run package`.cwd(ROOT).quiet();
		const pkgPath = join(DIST_DIR, name, "package.json");
		const pkg = JSON.parse(await readFile(pkgPath, "utf-8")) as Record<
			string,
			unknown
		>;

		expect(pkg.name).toBe("@orgsdk/plugin-llm");
		expect(pkg.version).toBe(version);
		expect(pkg.type).toBe("module");
		// zod IS a runtime dependency (config + output schemas use it).
		const deps = pkg.dependencies as Record<string, string> | undefined;
		expect(deps).toBeDefined();
		expect(deps?.zod).toBe("^4.0.0");
		// The authoring SDK must NOT be a runtime dependency (type-only).
		expect(deps?.["@orgsdk/plugins"]).toBeUndefined();
		// The OpenAI SDK must NOT be a runtime dependency (fetch-based client).
		expect(deps?.openai).toBeUndefined();
		expect(pkg.devDependencies).toBeUndefined();
		expect(pkg.scripts).toBeUndefined();
		expect(pkg.private).toBeUndefined();
	});

	it("manifest includes the generated package.json entry", async () => {
		await $`bun run package`.cwd(ROOT).quiet();
		const raw = await readFile(await manifestPath(), "utf-8");
		const parsed = JSON.parse(raw) as {
			files: Array<{ path: string }>;
		};
		const paths = parsed.files.map((f) => f.path);
		expect(paths).toContain("package.json");
	});
});
