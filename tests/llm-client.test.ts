/**
 * LLM plugin client — generic credential resolution + proxy/direct routing.
 *
 * Proves `createLLMClient` (used by every llm plugin safeFunction: generate,
 * eval*, research*):
 *  1. Prefers the generic `llm` credential bundle over per-provider bundles.
 *  2. Falls back to the legacy per-provider bundle when the generic key is
 *     absent (backward compatibility).
 *  3. Routes through the relay LLM proxy in cloud mode with the correct auth
 *     (DAEMON_API_KEY as bearer) and BYO-key forwarding (X-OrgSDK-TenantKey).
 *  4. Uses the connected credential or env key in direct mode.
 *
 * The fetch spy captures exactly what would hit the wire, so a header or URL
 * regression fails the assertion rather than silently mis-routing.
 *
 * Moved from the monorepo test suite (tests/llm-plugin/llm-client.test.ts) —
 * import path adjusted to ../plugin/_llm-client; assertions frozen verbatim.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createLLMClient } from "../plugin/_llm-client";

const PROXY_URL = "https://relay.test/api/llm";
const DAEMON_KEY = "daemon-key-test";

interface Captured {
	url: string;
	auth: string | null;
	tenantKey: string | null;
	scope: string | null;
	upstreamBaseURL: string | null;
}

/**
 * Replace global fetch with a recorder returning a valid chat completion.
 * Captures the request URL + the three headers the proxy contract depends on.
 */
function recordFetch(): { calls: Captured[]; restore: () => void } {
	const calls: Captured[] = [];
	const real = globalThis.fetch;
	globalThis.fetch = (async (
		input: string | URL | Request,
		init?: RequestInit,
	): Promise<Response> => {
		const headerSource =
			init?.headers ?? (input instanceof Request ? input.headers : undefined);
		const headers = new Headers((headerSource as HeadersInit) ?? undefined);
		calls.push({
			url: typeof input === "string" ? input : input.toString(),
			auth: headers.get("authorization"),
			tenantKey: headers.get("x-orgsdk-tenantkey"),
			scope: headers.get("x-orgsdk-scope"),
			upstreamBaseURL: headers.get("x-orgsdk-upstream-base-url"),
		});
		return new Response(
			JSON.stringify({
				id: "chatcmpl-test",
				object: "chat.completion",
				created: 0,
				model: "minimax/minimax-m3",
				choices: [
					{
						index: 0,
						message: { role: "assistant", content: "ok" },
						finish_reason: "stop",
					},
				],
				usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
			}),
			{ status: 200, headers: { "Content-Type": "application/json" } },
		);
	}) as typeof fetch;
	return {
		calls,
		restore: () => {
			globalThis.fetch = real;
		},
	};
}

/** Drive the client through a real chat-completions request (uses mocked fetch). */
async function fire(client: ReturnType<typeof createLLMClient>): Promise<void> {
	await client.chat.completions.create({
		model: "minimax/minimax-m3",
		messages: [{ role: "user", content: "hi" }],
	});
}

const ENV_KEYS = [
	"ORGSDK_LLM_PROXY_URL",
	"DAEMON_API_KEY",
	"ORGSDK_LLM_API_KEY",
	"OPENROUTER_API_KEY",
	"OPENAI_API_KEY",
	"ORGSDK_LLM_BASE_URL",
	"OPENAI_BASE_URL",
	"OLLAMA_API_KEY",
	"OLLAMA_BASE_URL",
];

let saved: Record<string, string | undefined> = {};

beforeEach(() => {
	saved = {};
	for (const k of ENV_KEYS) {
		saved[k] = process.env[k];
		delete process.env[k];
	}
});

afterEach(() => {
	for (const k of ENV_KEYS) {
		if (saved[k] === undefined) delete process.env[k];
		else process.env[k] = saved[k];
	}
});

describe("createLLMClient — generic credential wins", () => {
	it("prefers the generic llm bundle over a per-provider bundle in direct mode", () => {
		const client = createLLMClient(
			{
				llm: { secret_apiKey: "sk-generic" },
				openrouter: { secret_apiKey: "sk-legacy-or" },
			},
			{},
		);
		expect(client.apiKey).toBe("sk-generic");
	});

	it("falls back to the legacy openrouter bundle when no generic key exists", () => {
		const client = createLLMClient(
			{ openrouter: { secret_apiKey: "sk-legacy-or" } },
			{},
		);
		expect(client.apiKey).toBe("sk-legacy-or");
	});

	it("falls back to the legacy ollama bundle when provider is ollama and no generic key", () => {
		const client = createLLMClient(
			{ ollama: { secret_apiKey: "sk-legacy-ollama" } },
			{ provider: "ollama" },
		);
		expect(client.apiKey).toBe("sk-legacy-ollama");
		expect(client.baseURL).toBe("https://ollama.com/v1");
	});

	it("generic key still wins when provider is set to ollama", () => {
		const client = createLLMClient(
			{
				llm: { secret_apiKey: "sk-generic" },
				ollama: { secret_apiKey: "sk-legacy-ollama" },
			},
			{ provider: "ollama" },
		);
		expect(client.apiKey).toBe("sk-generic");
	});
});

describe("createLLMClient — proxy mode (cloud)", () => {
	it("routes through ORGSDK_LLM_PROXY_URL and authenticates with DAEMON_API_KEY", async () => {
		process.env.ORGSDK_LLM_PROXY_URL = PROXY_URL;
		process.env.DAEMON_API_KEY = DAEMON_KEY;

		const { calls, restore } = recordFetch();
		try {
			const client = createLLMClient(undefined, {});
			// Public SDK fields prove the routing/auth decision directly.
			expect(client.baseURL).toBe(PROXY_URL);
			expect(client.apiKey).toBe(DAEMON_KEY);

			// End-to-end: prove the wire request targets the proxy with the
			// daemon bearer key (the relay authenticates via getByDaemonApiKey).
			await fire(client);
			expect(calls[0].url).toBe(`${PROXY_URL}/chat/completions`);
			expect(calls[0].auth).toBe(`Bearer ${DAEMON_KEY}`);
		} finally {
			restore();
		}
	});

	it("forwards the generic llm tenant key as X-OrgSDK-TenantKey (BYO)", async () => {
		process.env.ORGSDK_LLM_PROXY_URL = PROXY_URL;
		process.env.DAEMON_API_KEY = DAEMON_KEY;

		const { calls, restore } = recordFetch();
		try {
			const client = createLLMClient(
				{ llm: { secret_apiKey: "sk-generic-byo" } },
				{},
			);
			await fire(client);
			expect(calls[0].tenantKey).toBe("sk-generic-byo");
			expect(calls[0].scope).toBe("plugin");
		} finally {
			restore();
		}
	});

	it("falls back to forwarding the legacy openrouter tenant key when no generic key", async () => {
		process.env.ORGSDK_LLM_PROXY_URL = PROXY_URL;
		process.env.DAEMON_API_KEY = DAEMON_KEY;

		const { calls, restore } = recordFetch();
		try {
			const client = createLLMClient(
				{ openrouter: { secret_apiKey: "sk-legacy-byo" } },
				{},
			);
			await fire(client);
			expect(calls[0].tenantKey).toBe("sk-legacy-byo");
		} finally {
			restore();
		}
	});

	it("omits X-OrgSDK-TenantKey (master-key funded) when no tenant key is connected", async () => {
		process.env.ORGSDK_LLM_PROXY_URL = PROXY_URL;
		process.env.DAEMON_API_KEY = DAEMON_KEY;

		const { calls, restore } = recordFetch();
		try {
			const client = createLLMClient(undefined, {});
			await fire(client);
			expect(calls[0].tenantKey).toBeNull();
			expect(calls[0].scope).toBe("plugin");
		} finally {
			restore();
		}
	});

	it("sends the default upstream base URL in the control header when no custom config", async () => {
		process.env.ORGSDK_LLM_PROXY_URL = PROXY_URL;
		process.env.DAEMON_API_KEY = DAEMON_KEY;

		const { calls, restore } = recordFetch();
		try {
			const client = createLLMClient(undefined, {});
			await fire(client);
			expect(calls[0].upstreamBaseURL).toBe("https://openrouter.ai/api/v1");
		} finally {
			restore();
		}
	});

	it("sends the configured custom endpoint in the control header", async () => {
		process.env.ORGSDK_LLM_PROXY_URL = PROXY_URL;
		process.env.DAEMON_API_KEY = DAEMON_KEY;

		const { calls, restore } = recordFetch();
		try {
			const client = createLLMClient(undefined, {
				baseURL: "https://api.openai.com/v1",
			});
			await fire(client);
			expect(calls[0].upstreamBaseURL).toBe("https://api.openai.com/v1");
			// HTTP client still targets the proxy, not the endpoint directly.
			expect(calls[0].url).toBe(`${PROXY_URL}/chat/completions`);
		} finally {
			restore();
		}
	});

	it("sends the ollama default endpoint when provider is ollama", async () => {
		process.env.ORGSDK_LLM_PROXY_URL = PROXY_URL;
		process.env.DAEMON_API_KEY = DAEMON_KEY;

		const { calls, restore } = recordFetch();
		try {
			const client = createLLMClient(undefined, { provider: "ollama" });
			await fire(client);
			expect(calls[0].upstreamBaseURL).toBe("https://ollama.com/v1");
		} finally {
			restore();
		}
	});
});

describe("createLLMClient — direct mode (regression)", () => {
	it("routes to OpenRouter directly using the env API key when no proxy is set", () => {
		process.env.OPENROUTER_API_KEY = "sk-or-direct";

		const client = createLLMClient(undefined, {});
		expect(client.baseURL).toBe("https://openrouter.ai/api/v1");
		expect(client.apiKey).toBe("sk-or-direct");
	});

	it("prefers the connected credential bundle key over env in direct mode", () => {
		process.env.OPENROUTER_API_KEY = "sk-or-env";

		const client = createLLMClient(
			{ openrouter: { secret_apiKey: "sk-bundle-direct" } },
			{},
		);
		expect(client.apiKey).toBe("sk-bundle-direct");
	});
});
