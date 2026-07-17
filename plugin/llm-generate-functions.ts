import type { SafeFunction } from "@orgsdk/plugins";
import {
	createLLMClient,
	loadPluginConfig,
	type ModelQuality,
	resolveModel,
} from "./_llm-client";

export const moduleDescription =
	"Generate text, summaries, and structured content using LLM";

/**
 * Create the generate safeFunctions with access to the plugin config store
 * for lazy config reads.
 */
export function createFunctions(
	configStore: import("@orgsdk/plugins").ConfigStore,
): SafeFunction[] {
	return [
		{
			name: "generate",
			requiredCredentials: ["llm", "openrouter", "ollama"],
			handler: async (
				credentials: Record<string, unknown>,
				{
					userPrompt,
					systemPrompt,
					quality,
				}: {
					userPrompt: string;
					systemPrompt?: string;
					quality?: ModelQuality;
				},
			): Promise<{ content: string; tokensUsed: number }> => {
				const cfg = await loadPluginConfig(configStore);
				const client = createLLMClient(credentials, cfg);

				const messages: { role: "system" | "user"; content: string }[] = [];

				if (systemPrompt) {
					messages.push({ role: "system", content: systemPrompt });
				}

				messages.push({ role: "user", content: userPrompt });

				const response = await client.chat.completions.create({
					model: resolveModel(quality, cfg.model, undefined, cfg.provider),
					messages,
					temperature: cfg.temperature ?? 0,
					...(cfg.maxTokens && { max_tokens: cfg.maxTokens }),
				});

				const tokensUsed = response.usage?.total_tokens ?? 0;
				const content = response.choices[0]?.message?.content ?? "";
				if (!content) {
					throw new Error("No content returned from LLM");
				}

				return { content, tokensUsed };
			},
			description:
				"Generate free-form text using an LLM. Takes a user prompt and an optional system prompt to guide the response style/behavior. Optional quality parameter controls model intelligence: 'high' (default, most capable), 'medium' (balanced), 'low' (fastest). Returns an object { content: string, tokensUsed: number } with the generated text and the token usage for billing.",
			returnType: "Promise<{ content: string; tokensUsed: number }>",
			parameters: [
				{ name: "userPrompt", type: "string" },
				{ name: "systemPrompt", type: "string", optional: true },
				{
					name: "quality",
					type: "'high' | 'medium' | 'low'",
					optional: true,
					description:
						"Model quality tier: 'high' (default), 'medium', or 'low'",
				},
			],
			metadata: {
				category: "llm",
				tags: ["readonly", "llm"],
				readonly: true,
				version: "1.0.0",
				relatedTo: ["evalBoolean", "evalStructured", "evalMultiCategory"],
			},
		},
	];
}
