/**
 * Plugin shape / contract tests.
 *
 * Imports the real entry through Bun's module system (no daemon, no DB) and
 * exercises the factory with a no-op PluginContext — mirrors the monorepo's
 * tests/plugins approach. These are the implementation-equivalence tests: they
 * pin the exact seven function names/count, the generic `llm` credential
 * provider plus the legacy openrouter/ollama compatibility providers, the Zod
 * config schema (provider/model/baseURL/maxTokens/temperature), the token auth
 * provider, and the absence of http endpoints (token-only plugin).
 *
 * Behavioral parity with monorepo `packages/plugins/src/llm` v1.2.2:
 *  - generate / evalBoolean / evalMultiCategory / evalStructured /
 *    querySearch / summarizeText / synthesizeAnswer (exactly seven)
 *  - requiredCredentials: ["llm", "openrouter", "ollama"] on every function
 *  - all readonly (read-only model calls)
 *  - token authProvider (provider key `llm`, displayName "LLM")
 *  - Zod config with the five supported fields
 */
import { describe, expect, it } from "bun:test";
import type {
	AuthProvider,
	PluginContext,
	PluginModule,
} from "@orgsdk/plugins";

const EXPECTED_FUNCTIONS = [
	"generate",
	"evalBoolean",
	"evalMultiCategory",
	"evalStructured",
	"querySearch",
	"summarizeText",
	"synthesizeAnswer",
] as const;

const noopCtx: PluginContext = {
	stores: {
		credential: {
			get: async () => null,
			list: async () => [],
			upsert: async () => {},
			delete: async () => {},
			getSecrets: async () => null,
			setSecrets: async () => {},
		},
		config: {
			list: async () => [],
			get: async () => null,
			set: async () => ({ key: "", value: {}, updatedAt: null }),
			delete: async () => {},
		},
	},
	publicBaseUrl: "http://localhost:3000",
	logger: {
		trace() {},
		debug() {},
		info() {},
		warn() {},
		error() {},
		fatal() {},
		child() {
			return this;
		},
	},
};

async function loadPlugin(ctx: PluginContext = noopCtx): Promise<PluginModule> {
	const mod = await import("../plugin/index");
	const factory = mod.default as (ctx: PluginContext) => PluginModule;
	return factory(ctx);
}

describe("plugin shape", () => {
	it("factory returns a module with safeFunctions", async () => {
		const mod = await loadPlugin();
		expect(Array.isArray(mod.safeFunctions)).toBe(true);
		expect(mod.safeFunctions?.length).toBeGreaterThan(0);
	});

	it("exposes exactly the seven expected safe functions (no more, no less)", async () => {
		const mod = await loadPlugin();
		const names = (mod.safeFunctions ?? []).map((f) => f.name).sort();
		expect(names).toEqual([...EXPECTED_FUNCTIONS].sort());
	});

	it('every function declares requiredCredentials: ["llm", "openrouter", "ollama"]', async () => {
		const mod = await loadPlugin();
		const fns = mod.safeFunctions ?? [];
		for (const fn of fns) {
			expect(fn.requiredCredentials).toEqual(["llm", "openrouter", "ollama"]);
		}
	});

	it("every function is readonly (read-only model calls)", async () => {
		const mod = await loadPlugin();
		const fns = mod.safeFunctions ?? [];
		expect(fns.length).toBe(7);
		for (const fn of fns) {
			expect(fn.metadata?.readonly).toBe(true);
			expect(fn.metadata?.tags).toContain("readonly");
		}
	});

	it("every function is categorized under llm", async () => {
		const mod = await loadPlugin();
		for (const fn of mod.safeFunctions ?? []) {
			expect(fn.metadata?.category).toBe("llm");
		}
	});

	it("querySearch is tagged discovery", async () => {
		const mod = await loadPlugin();
		const byName = new Map((mod.safeFunctions ?? []).map((f) => [f.name, f]));
		expect(byName.get("querySearch")?.metadata?.tags).toContain("discovery");
		expect(byName.get("querySearch")?.metadata?.discovery).toBe(true);
	});

	it("has a token authProvider with displayName LLM", async () => {
		const mod = await loadPlugin();
		const auth = mod.authProvider as AuthProvider | undefined;
		expect(auth).toBeDefined();
		expect(auth?.type).toBe("token");
		expect(auth?.authMeta?.displayName).toBe("LLM");
	});

	it("has no httpEndpoints (token-only plugin, no callback flow)", async () => {
		const mod = await loadPlugin();
		expect(mod.httpEndpoints ?? []).toEqual([]);
	});

	it("declares a Zod config schema with the five supported fields", async () => {
		const mod = await loadPlugin();
		const config = mod.config;
		if (!config) throw new Error("plugin config missing");
		// Behavioural proof: parse a complete config (plus a stray key) and
		// confirm zod keeps exactly the five supported fields (object schemas
		// strip unknown keys by default). No JSON-schema introspection needed.
		const result = config.schema.safeParse({
			provider: "openrouter",
			model: "anthropic/claude-sonnet-4",
			baseURL: "https://example.com/v1",
			maxTokens: 4096,
			temperature: 0.7,
			unknownStrayKey: "stripped",
		});
		if (!result.success) throw new Error("schema rejected a valid config");
		expect(Object.keys(result.data).sort()).toEqual(
			["baseURL", "maxTokens", "model", "provider", "temperature"].sort(),
		);
	});

	it("provider config field is restricted to openrouter/ollama", async () => {
		const mod = await loadPlugin();
		const config = mod.config;
		if (!config) throw new Error("plugin config missing");
		expect(config.schema.safeParse({ provider: "openrouter" }).success).toBe(
			true,
		);
		expect(config.schema.safeParse({ provider: "ollama" }).success).toBe(true);
		expect(config.schema.safeParse({ provider: "anthropic" }).success).toBe(
			false,
		);
	});

	it("storeToken writes the generic llm credential key", async () => {
		let captured: Record<string, unknown> | undefined;
		const ctx: PluginContext = {
			...noopCtx,
			stores: {
				...noopCtx.stores,
				credential: {
					...noopCtx.stores.credential,
					async setSecrets(provider, name, secrets) {
						captured = { provider, name, secrets };
					},
				},
			},
		};
		const mod = await loadPlugin(ctx);
		const auth = mod.authProvider as AuthProvider & {
			storeToken(name: string, token: string): Promise<void>;
		};
		expect(typeof auth.storeToken).toBe("function");
		await auth.storeToken("default", "sk-test");
		// Connect writes land under the generic `llm` provider key.
		expect(captured?.provider).toBe("llm");
		expect(captured?.name).toBe("default");
		const secrets = (captured?.secrets ?? {}) as Record<string, string>;
		expect(secrets.secret_apiKey).toBe("sk-test");
	});

	it("authSetup rejects a missing token", async () => {
		const mod = await loadPlugin();
		const auth = mod.authProvider as AuthProvider & {
			authSetup(
				options: Record<string, string>,
			): Promise<{ success: boolean; error?: string }>;
		};
		const result = await auth.authSetup({ name: "default" });
		expect(result.success).toBe(false);
		expect(result.error).toMatch(/token/i);
	});
});
