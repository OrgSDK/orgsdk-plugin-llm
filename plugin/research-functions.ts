import type { SafeFunction } from "@orgsdk/plugins";
import { createLLMClient, loadPluginConfig, resolveModel } from "./_llm-client";

export const moduleDescription =
	"LLM-powered search, summarization, and synthesis";

export function createFunctions(
	configStore: import("@orgsdk/plugins").ConfigStore,
): SafeFunction[] {
	// Tool 1: querySearch - Web search using LLM knowledge
	async function querySearchHandler(
		credentials: Record<string, unknown>,
		{ query, maxResults = 10 }: { query: string; maxResults?: number },
	): Promise<{
		content: string;
		results: Array<{
			url: string;
			title: string;
			snippet: string;
			source: string;
			publishedDate: string;
		}>;
	}> {
		const cfg = await loadPluginConfig(configStore);
		const client = createLLMClient(credentials, cfg);

		const response = await client.chat.completions.create({
			model: resolveModel(undefined, cfg.model, undefined, cfg.provider),
			messages: [
				{
					role: "system",
					content:
						"You are a search assistant. For the given query, provide a comprehensive answer based on your knowledge. Structure your response with key facts, relevant context, and any caveats about information freshness.",
				},
				{
					role: "user",
					content: `Search for: ${query} (provide up to ${maxResults} relevant points)`,
				},
			],
			temperature: 0,
		});

		const content = response.choices[0]?.message?.content || "";

		return {
			content,
			results: [
				{
					url: "",
					title: "LLM Response",
					snippet: content,
					source: "llm",
					publishedDate: new Date().toISOString(),
				},
			],
		};
	}

	// Tool 2: summarizeText - Summarization using LLM
	async function summarizeTextHandler(
		credentials: Record<string, unknown>,
		{ text, maxLength = 300 }: { text: string; maxLength?: number },
	): Promise<{
		summary: string;
		originalLength: number;
		summaryLength: number;
		tokensUsed: number;
	}> {
		const cfg = await loadPluginConfig(configStore);
		const client = createLLMClient(credentials, cfg);

		const response = await client.chat.completions.create({
			model: resolveModel(undefined, cfg.model, undefined, cfg.provider),
			messages: [
				{
					role: "system",
					content: `Summarize the given text concisely. Maximum ${maxLength} words. Focus on key points and main ideas.`,
				},
				{
					role: "user",
					content: `Text to summarize:\n\n${text}`,
				},
			],
			temperature: 0,
		});

		const content = response.choices[0]?.message?.content || "";

		return {
			summary: content,
			originalLength: text.length,
			summaryLength: content.length,
			tokensUsed: response.usage?.total_tokens || 0,
		};
	}

	// Tool 3: synthesizeAnswer - Synthesis using LLM
	async function synthesizeAnswerHandler(
		credentials: Record<string, unknown>,
		{ question, findings }: { question: string; findings: any[] },
	): Promise<{
		answer: string;
		question: string;
		sources: string[];
		tokensUsed: number;
	}> {
		const cfg = await loadPluginConfig(configStore);
		const client = createLLMClient(credentials, cfg);

		const findingsText = JSON.stringify(findings, null, 2);

		const response = await client.chat.completions.create({
			model: resolveModel(undefined, cfg.model, undefined, cfg.provider),
			messages: [
				{
					role: "system",
					content: `You are a research assistant. Synthesize the following research findings into a comprehensive answer to the user's question. Include:
1. Direct answer to the question
2. Key findings from sources
3. Source citations (include URLs where available)
4. Methodology notes

Be thorough but concise. Base your answer ONLY on the provided findings.`,
				},
				{
					role: "user",
					content: `Question: ${question}\n\nFindings:\n${findingsText}`,
				},
			],
			temperature: 0,
		});

		const content = response.choices[0]?.message?.content || "";

		const sources = findings
			.map((f: any) => f.url || f.source || "")
			.filter((s: string) => s.length > 0);

		return {
			answer: content,
			question,
			sources,
			tokensUsed: response.usage?.total_tokens || 0,
		};
	}

	return [
		{
			name: "querySearch",
			requiredCredentials: ["llm", "openrouter", "ollama"],
			handler: querySearchHandler,
			description:
				"Search for information using LLM. Returns {content, results: [{url, title, snippet, source, publishedDate}]}",
			returnType:
				"Promise<{content: string, results: Array<{url: string, title: string, snippet: string, source: string, publishedDate: string}>}>",
			parameters: [
				{ name: "query", type: "string" },
				{ name: "maxResults", type: "number" },
			],
			metadata: {
				category: "llm",
				tags: ["readonly", "network", "llm", "discovery"],
				readonly: true,
				discovery: true,
				version: "2.0.0",
				relatedTo: ["summarizeText", "synthesizeAnswer"],
			},
		},
		{
			name: "summarizeText",
			requiredCredentials: ["llm", "openrouter", "ollama"],
			handler: summarizeTextHandler,
			description:
				"Summarize text content using LLM. Returns {summary, originalLength, summaryLength, tokensUsed}",
			returnType:
				"Promise<{summary: string, originalLength: number, summaryLength: number, tokensUsed: number}>",
			parameters: [
				{ name: "text", type: "string" },
				{ name: "maxLength", type: "number" },
			],
			metadata: {
				category: "llm",
				tags: ["readonly", "llm", "data"],
				readonly: true,
				version: "2.0.0",
				relatedTo: ["querySearch", "synthesizeAnswer"],
			},
		},
		{
			name: "synthesizeAnswer",
			requiredCredentials: ["llm", "openrouter", "ollama"],
			handler: synthesizeAnswerHandler,
			description:
				"Synthesize research findings into a comprehensive answer using LLM. Returns {answer, question, sources, tokensUsed}",
			returnType:
				"Promise<{answer: string, question: string, sources: string[], tokensUsed: number}>",
			parameters: [
				{ name: "question", type: "string" },
				{ name: "findings", type: "any[]" },
			],
			metadata: {
				category: "llm",
				tags: ["readonly", "llm", "data"],
				readonly: true,
				version: "2.0.0",
				relatedTo: ["querySearch", "summarizeText"],
			},
		},
	];
}
