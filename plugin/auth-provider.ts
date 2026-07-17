import type { AuthMeta, AuthProvider, PluginContext } from "@orgsdk/plugins";
import { CRED_PROVIDER_LLM } from "./constants";

/**
 * Token-based auth provider for the llm plugin.
 *
 * All new Connect writes land under the generic `llm/<name>` credential key
 * with a provider-neutral label. Runtime resolution prefers this key and
 * falls back to legacy `openrouter/<name>` / `ollama/<name>` bundles so
 * existing installations keep working.
 *
 * The token is sent as a Bearer header to whichever OpenAI-compatible
 * endpoint is configured in plugin settings (provider/baseURL).
 */
export class LLMTokenProvider implements AuthProvider {
	readonly type = "token" as const;
	readonly authMeta: AuthMeta = { displayName: "LLM" };
	private readonly ctx: PluginContext;

	constructor(ctx: PluginContext) {
		this.ctx = ctx;
	}

	async initiate(
		credentialName: string,
	): Promise<{ authUrl: string; state: string }> {
		return {
			authUrl: `Add the LLM API token '${credentialName}' in the dashboard (Credentials tab).`,
			state: "",
		};
	}

	async handleCallback(
		_req: Request,
	): Promise<{ success: boolean; credentialName: string; error?: string }> {
		return {
			success: false,
			credentialName: "",
			error: "LLM token auth has no callback flow",
		};
	}

	async storeToken(credentialName: string, token: string): Promise<void> {
		await this.ctx.stores.credential.setSecrets(
			CRED_PROVIDER_LLM,
			credentialName,
			{ secret_apiKey: token },
			{
				label: `LLM API Token (${credentialName})`,
				valid: true,
			},
		);
	}

	async authSetup(
		options: Record<string, string>,
	): Promise<{ success: boolean; message?: string; error?: string }> {
		const token = options.token ?? "";
		const name = options.name ?? "default";
		if (!token) return { success: false, error: "Missing --token" };
		await this.storeToken(name, token);
		return {
			success: true,
			message: `Saved LLM API token 'llm/${name}'.`,
		};
	}
}
