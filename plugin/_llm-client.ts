/**
 * Self-contained LLM client utilities for the llm plugin.
 *
 * No OpenAI SDK dependency — calls the OpenAI-compatible Chat Completions
 * API directly with fetch. This keeps the plugin dependency-free (shipped as
 * raw source, no __bundle.js) and gives full control over auth and errors.
 *
 * Credential resolution order (generic-first):
 *   1. `llm/default` — the single generic credential written by Connect.
 *   2. `<provider>/default` — legacy per-provider bundle (openrouter/ollama).
 *   3. Environment variables.
 *
 * Changing the provider/baseURL in settings never requires reconnecting
 * because the credential identity is independent of the endpoint.
 *
 * Two transport modes:
 *   - Proxy mode (cloud): ORGSDK_LLM_PROXY_URL set. Routes through the relay
 *     LLM proxy, authenticating with DAEMON_API_KEY (the daemon holds no
 *     upstream key — the proxy injects it). The tenant's own key, if connected,
 *     is forwarded as X-OrgSDK-TenantKey so BYO calls bill their provider.
 *   - Direct mode (local): reads provider/model/baseURL from plugin config
 *     (`plugin:llm` in tenant_config), the connected credential, or env vars.
 *       - "openrouter" (default): https://openrouter.ai/api/v1
 *       - "ollama":               https://ollama.com/v1 (OpenAI-compatible)
 */

import type { ConfigStore } from "@orgsdk/plugins";
import { CRED_PROVIDER_LLM } from "./constants";

export type ModelQuality = "high" | "medium" | "low";
export type LLMProvider = "openrouter" | "ollama";

const DEFAULT_OPENROUTER_MODEL = "minimax/minimax-m3";
const DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_OLLAMA_MODEL = "gpt-oss:120b";
const DEFAULT_OLLAMA_BASE_URL = "https://ollama.com/v1";

export function resolveModel(
	_quality: ModelQuality | undefined,
	pluginModel: string | undefined,
	projectModel: string | undefined,
	provider: LLMProvider = "openrouter",
): string {
	if (pluginModel) return pluginModel;
	if (projectModel) return projectModel;
	return provider === "ollama"
		? DEFAULT_OLLAMA_MODEL
		: DEFAULT_OPENROUTER_MODEL;
}

export function getProjectModel(): string {
	return process.env.ORGSDK_LLM_MODEL ?? DEFAULT_OPENROUTER_MODEL;
}

export interface LLMPluginConfig {
	provider?: LLMProvider;
	model?: string;
	baseURL?: string;
	maxTokens?: number;
	temperature?: number;
}

/**
 * Read plugin-scoped config from tenant_config lazily.
 */
export async function loadPluginConfig(
	configStore: ConfigStore,
): Promise<LLMPluginConfig> {
	const entry = await configStore.get("plugin:llm");
	if (!entry) return {};
	return (entry.value ?? {}) as LLMPluginConfig;
}

/** Shape stored under credential_metadata for an LLM provider bundle. */
interface ProviderBundle {
	secret_apiKey?: string;
	secret_token?: string;
	baseURL?: string;
}

function readBundle(
	credentials: Record<string, unknown> | undefined,
	provider: string,
): ProviderBundle | undefined {
	const raw = credentials?.[provider];
	if (typeof raw !== "object" || raw === null) return undefined;
	return raw as ProviderBundle;
}

/**
 * Resolve the active credential bundle, preferring the generic `llm` key and
 * falling back to the legacy per-provider bundle for existing installations.
 */
function resolveBundle(
	credentials: Record<string, unknown> | undefined,
	provider: LLMProvider,
): ProviderBundle | undefined {
	return (
		readBundle(credentials, CRED_PROVIDER_LLM) ??
		readBundle(credentials, provider)
	);
}

interface ChatMessage {
	role: "system" | "user" | "assistant";
	content: string;
}

interface ChatCompletionOptions {
	model: string;
	messages: ChatMessage[];
	temperature?: number;
	max_tokens?: number;
	[key: string]: unknown;
}

interface ChatCompletionResponse {
	choices: Array<{ message?: { content?: string } }>;
	usage?: { total_tokens?: number };
}

interface ResolvedConnection {
	apiKey: string;
	baseURL: string;
	/** Resolved provider endpoint — sent as X-OrgSDK-Upstream-Base-URL in proxy mode. */
	upstreamBaseURL: string;
	headers: Record<string, string>;
}

/**
 * Resolve the connection (apiKey, baseURL, upstreamBaseURL, headers) from
 * proxy env, the connected credential, plugin config, or env vars — in that
 * priority order.
 *
 * In proxy mode the HTTP client base is the proxy URL, but the resolved
 * provider endpoint (upstreamBaseURL) is sent as X-OrgSDK-Upstream-Base-URL
 * so the relay knows which upstream to target. The generic-first tenant key
 * is forwarded unchanged as X-OrgSDK-TenantKey.
 */
function resolveConnection(
	credentials: Record<string, unknown> | undefined,
	pluginConfig: LLMPluginConfig | undefined,
): ResolvedConnection {
	const provider = pluginConfig?.provider ?? "openrouter";
	const bundle = resolveBundle(credentials, provider);
	const tenantKey = bundle?.secret_apiKey ?? bundle?.secret_token;

	// Resolve the provider endpoint once — used directly in direct mode, or
	// sent in the control header in proxy mode.
	const directBaseURL =
		provider === "ollama"
			? (pluginConfig?.baseURL ??
				bundle?.baseURL ??
				process.env.OLLAMA_BASE_URL ??
				DEFAULT_OLLAMA_BASE_URL)
			: (pluginConfig?.baseURL ??
				bundle?.baseURL ??
				process.env.ORGSDK_LLM_BASE_URL ??
				process.env.OPENAI_BASE_URL ??
				DEFAULT_OPENROUTER_BASE_URL);

	// Proxy mode: bearer = DAEMON_API_KEY (proxy auth); tenant key forwarded
	// as a header so BYO calls bill the tenant's provider. The resolved
	// upstream endpoint goes in the control header so the relay routes there.
	const proxyUrl = process.env.ORGSDK_LLM_PROXY_URL;
	if (proxyUrl) {
		const headers: Record<string, string> = {
			"X-OrgSDK-Scope": "plugin",
			"X-OrgSDK-Upstream-Base-URL": directBaseURL,
		};
		if (tenantKey) headers["X-OrgSDK-TenantKey"] = tenantKey;
		return {
			apiKey: process.env.DAEMON_API_KEY ?? "",
			baseURL: proxyUrl,
			upstreamBaseURL: directBaseURL,
			headers,
		};
	}

	// Direct mode
	const directApiKey =
		provider === "ollama"
			? (bundle?.secret_apiKey ??
				bundle?.secret_token ??
				process.env.OLLAMA_API_KEY ??
				"")
			: (bundle?.secret_apiKey ??
				bundle?.secret_token ??
				process.env.ORGSDK_LLM_API_KEY ??
				process.env.OPENROUTER_API_KEY ??
				process.env.OPENAI_API_KEY ??
				"");

	return {
		apiKey: directApiKey,
		baseURL: directBaseURL,
		upstreamBaseURL: directBaseURL,
		headers: {},
	};
}

async function chatCompletions(
	conn: ResolvedConnection,
	opts: ChatCompletionOptions,
): Promise<ChatCompletionResponse> {
	if (!conn.apiKey) {
		throw new Error(
			`No LLM API key resolved. proxy=${
				process.env.ORGSDK_LLM_PROXY_URL ? "on" : "off"
			}, DAEMON_API_KEY.len=${(process.env.DAEMON_API_KEY ?? "").length}, ` +
				`hasCredential=${!!conn.headers["X-OrgSDK-TenantKey"]}.`,
		);
	}

	const res = await fetch(`${conn.baseURL}/chat/completions`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${conn.apiKey}`,
			...conn.headers,
		},
		body: JSON.stringify(opts),
	});

	if (!res.ok) {
		const detail = await res.text().catch(() => "");
		throw new Error(
			`LLM request failed (${res.status} ${res.statusText}): ${detail.slice(0, 500)}`,
		);
	}

	return (await res.json()) as ChatCompletionResponse;
}

/**
 * Minimal client shim exposing `chat.completions.create` so call sites stay
 * unchanged after dropping the OpenAI SDK. Returns a plain object — no class.
 * `baseURL` and `apiKey` are exposed for testability.
 */
export function createLLMClient(
	credentials?: Record<string, unknown>,
	pluginConfig?: LLMPluginConfig,
): {
	baseURL: string;
	apiKey: string;
	upstreamBaseURL: string;
	chat: {
		completions: {
			create: (o: ChatCompletionOptions) => Promise<ChatCompletionResponse>;
		};
	};
} {
	const conn = resolveConnection(credentials, pluginConfig);
	return {
		baseURL: conn.baseURL,
		apiKey: conn.apiKey,
		upstreamBaseURL: conn.upstreamBaseURL,
		chat: {
			completions: {
				create: (opts: ChatCompletionOptions) => chatCompletions(conn, opts),
			},
		},
	};
}
