import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const MANIFEST_PATH = resolve(import.meta.dir, "..", "plugin", ".plugin.json");

async function readManifest() {
	const raw = await readFile(MANIFEST_PATH, "utf-8");
	return JSON.parse(raw) as Record<string, unknown>;
}

describe("manifest", () => {
	it("has the expected slug (name)", async () => {
		const m = await readManifest();
		expect(m.name).toBe("llm");
	});

	it("has the bumped version 1.2.5", async () => {
		const m = await readManifest();
		expect(m.version).toBe("1.2.5");
	});

	it("declares the canonical $schema", async () => {
		const m = await readManifest();
		expect(m.$schema).toBe("https://orgsdk.ai/schemas/plugin-manifest.v1.json");
	});

	it("has a non-empty description", async () => {
		const m = await readManifest();
		expect(typeof m.description).toBe("string");
		expect((m.description as string).length).toBeGreaterThan(0);
	});

	it("declares entry as index.ts", async () => {
		const m = await readManifest();
		expect(m.entry).toBe("index.ts");
	});

	it("declares token auth with the llm provider key", async () => {
		const m = await readManifest();
		const auth = m.auth as Record<string, unknown>;
		expect(auth.type).toBe("token");
		expect(auth.provider).toBe("llm");
		expect(auth.label).toBe("API Token");
		expect(typeof auth.hint).toBe("string");
	});

	// Token-only plugins have no OAuth callback. The monorepo lifecycle suite
	// (shape 8) asserts `httpEndpoints` is empty for llm; the manifest must not
	// declare a callbackPath either.
	it("declares no callbackPath (token-only auth, no OAuth flow)", async () => {
		const m = await readManifest();
		const auth = m.auth as Record<string, unknown>;
		expect(auth.callbackPath).toBeUndefined();
	});

	it("declares marketplace metadata with the source-repo provenance link", async () => {
		const m = await readManifest();
		const mp = m.marketplace as Record<string, unknown>;
		expect(mp.displayName).toBe("LLM");
		expect(mp.category).toBe("Data & AI");
		expect(Array.isArray(mp.tags)).toBe(true);
		const links = mp.links as Record<string, string>;
		expect(links.sourceRepo).toBe(
			"https://github.com/OrgSDK/orgsdk-plugin-llm",
		);
		expect(links.homepage).toBe("https://openrouter.ai");
		expect(links.docs).toBe("https://openrouter.ai/docs");
	});
});
