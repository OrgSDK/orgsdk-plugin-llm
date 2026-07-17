import type {
	PluginContext,
	PluginFactory,
	PluginModule,
} from "@orgsdk/plugins";
import { z } from "zod";
import { loadPluginConfig } from "./_llm-client";
import { LLMTokenProvider } from "./auth-provider";
import { CRED_PROVIDER_LLM } from "./constants";
import { createFunctions as createEvalFns } from "./llm-eval-functions";
import { createFunctions as createGenerateFns } from "./llm-generate-functions";
import { createFunctions as createResearchFns } from "./research-functions";

const createPlugin: PluginFactory = (ctx: PluginContext): PluginModule => {
	const authProvider = new LLMTokenProvider(ctx);

	// Create safeFunctions with access to config store for lazy config reads
	const generateFns = createGenerateFns(ctx.stores.config);
	const evalFns = createEvalFns(ctx.stores.config);
	const researchFns = createResearchFns(ctx.stores.config);

	return {
		safeFunctions: [...generateFns, ...evalFns, ...researchFns],
		authProvider,
		config: {
			title: "LLM",
			description:
				"The model and provider agents use to generate, evaluate, and research text in their workflows.",
			schema: z.object({
				provider: z
					.enum(["openrouter", "ollama"])
					.optional()
					.describe(
						"Default provider for model/baseURL. OpenRouter (default) or Ollama Cloud. Does not affect which credential is used.",
					),
				model: z
					.string()
					.optional()
					.describe(
						"Model name (e.g. anthropic/claude-sonnet-4). Leave blank for the default.",
					),
				baseURL: z
					.string()
					.optional()
					.describe("Custom API endpoint. Overrides the provider default."),
				maxTokens: z
					.number()
					.int()
					.min(1)
					.max(128000)
					.optional()
					.describe("Maximum tokens per response"),
				temperature: z
					.number()
					.min(0)
					.max(2)
					.optional()
					.describe("Sampling temperature (0 = deterministic, 1 = creative)"),
			}),
		},
		async onLoad() {
			if (process.env.ORGSDK_LLM_PROXY_URL) return;
			const hasGeneric = await ctx.stores.credential.get(
				CRED_PROVIDER_LLM,
				"default",
			);
			if (hasGeneric) return;
			const cfg = await loadPluginConfig(ctx.stores.config);
			const provider = cfg.provider ?? "openrouter";
			const hasLegacy = await ctx.stores.credential.get(provider, "default");
			if (!hasLegacy) {
				ctx.logger.warn(
					"No LLM API token connected. Add one in Credentials to use LLM tools.",
				);
			}
		},
	};
};

export default createPlugin;
