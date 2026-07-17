import type { SafeFunction } from "@orgsdk/plugins";
import { z } from "zod";
import {
	createLLMClient,
	loadPluginConfig,
	type ModelQuality,
	resolveModel,
} from "./_llm-client";

export const moduleDescription =
	"LLM-powered boolean classification, multi-category, and structured data extraction";

interface BooleanExample {
	text: string;
	matches: boolean;
	reason?: string;
}

interface BooleanResult {
	result: boolean;
	confidence: number;
}

export function createFunctions(
	configStore: import("@orgsdk/plugins").ConfigStore,
): SafeFunction[] {
	return [
		{
			name: "evalBoolean",
			requiredCredentials: ["llm", "openrouter", "ollama"],
			handler: async (
				credentials: Record<string, unknown>,
				{
					text,
					criteria,
					positiveExample,
					negativeExample,
					quality,
				}: {
					text: string;
					criteria: string;
					positiveExample: BooleanExample;
					negativeExample: BooleanExample;
					quality?: ModelQuality;
				},
			): Promise<BooleanResult> => {
				const cfg = await loadPluginConfig(configStore);
				const client = createLLMClient(credentials, cfg);

				const outputSchema = z.object({
					result: z.boolean().describe("Whether the text matches the criteria"),
					confidence: z
						.number()
						.min(0)
						.max(1)
						.describe("Confidence score from 0 to 1"),
				});

				const systemPrompt = `You are a precise classifier. Given examples and criteria, determine if the text matches.

Your job is to classify text based on explicit examples showing what DOES and DOES NOT match.
Pay careful attention to the examples - they define the boundary of the classification.

Return your classification as a boolean and a confidence score (0-1).
- Use high confidence (0.9+) when the text clearly matches one of the examples
- Use medium confidence (0.7-0.9) when the text is similar but not identical to examples
- Use low confidence (<0.7) when the text is ambiguous or doesn't fit either example well`;

				const userPrompt = `## Criteria
${criteria}

## Examples

POSITIVE (should return TRUE):
Text: "${positiveExample.text}"
${positiveExample.reason ? `Reason: ${positiveExample.reason}` : ""}

NEGATIVE (should return FALSE):
Text: "${negativeExample.text}"
${negativeExample.reason ? `Reason: ${negativeExample.reason}` : ""}

## Text to Classify
${text}

Classify this text and provide your confidence level.`;

				const response = await client.chat.completions.create({
					model: resolveModel(quality, cfg.model, undefined, cfg.provider),
					messages: [
						{ role: "system", content: systemPrompt },
						{ role: "user", content: userPrompt },
					],
					response_format: {
						type: "json_schema",
						json_schema: {
							name: "output",
							schema: z.toJSONSchema(outputSchema),
						},
					},
					temperature: 0,
					reasoning_effort: "medium",
				});

				const content = response.choices[0]?.message?.content || "";
				if (!content) {
					throw new Error("No content returned from LLM");
				}

				const parsed = JSON.parse(content);
				const validated = await outputSchema.safeParseAsync(parsed);

				if (!validated.success) {
					throw new Error("Failed to parse output with schema");
				}

				return validated.data;
			},
			description:
				"Use AI to evaluate if text matches given criteria with few-shot examples. Returns { result: boolean, confidence: number }. Requires positive and negative examples to disambiguate the classification boundary. Use confidence thresholds: >0.9 auto-process, 0.7-0.9 log for audit, <0.7 flag for human review. Optional quality parameter: 'high' (default), 'medium', 'low'.",
			returnType: "Promise<{ result: boolean; confidence: number }>",
			parameters: [
				{ name: "text", type: "string" },
				{ name: "criteria", type: "string" },
				{
					name: "positiveExample",
					type: "{ text: string; matches: true; reason?: string }",
				},
				{
					name: "negativeExample",
					type: "{ text: string; matches: false; reason?: string }",
				},
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
				tags: ["readonly", "llm", "data"],
				readonly: true,
				version: "2.0.0",
				relatedTo: ["evalMultiCategory", "evalStructured"],
			},
		},
		{
			name: "evalMultiCategory",
			requiredCredentials: ["llm", "openrouter", "ollama"],
			handler: async (
				credentials: Record<string, unknown>,
				{
					text,
					categories,
					quality,
				}: { text: string; categories: string; quality?: ModelQuality },
			) => {
				const cfg = await loadPluginConfig(configStore);
				const client = createLLMClient(credentials, cfg);

				const outputSchema = z.object({
					categories: z.array(z.string()),
				});

				const response = await client.chat.completions.create({
					model: resolveModel(quality, cfg.model, undefined, cfg.provider),
					messages: [
						{
							role: "system",
							content:
								"You are a classifier. Return JSON matching the provided schema.",
						},
						{
							role: "user",
							content: `Text: ${text}\n\nAvailable categories: ${categories}\n\nReturn the categories that apply to this text.`,
						},
					],
					response_format: {
						type: "json_schema",
						json_schema: {
							name: "output",
							schema: z.toJSONSchema(outputSchema),
						},
					},
					temperature: 0,
					reasoning_effort: "medium",
				});

				const content = response.choices[0]?.message?.content || "";

				if (!content) {
					throw new Error("No content returned from LLM");
				}

				const parsed = JSON.parse(content);
				const validated = await outputSchema.safeParseAsync(parsed);

				if (!validated.success) {
					throw new Error("Failed to parse output with schema");
				}

				return validated.data.categories;
			},
			description:
				"Use AI to categorize text into multiple categories from a comma-separated list. Returns array of category names. Optional quality parameter: 'high' (default), 'medium', 'low'.",
			returnType: "Promise<string[]>",
			parameters: [
				{ name: "text", type: "string" },
				{ name: "categories", type: "string" },
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
				tags: ["readonly", "llm", "data"],
				readonly: true,
				version: "1.0.0",
				relatedTo: ["evalBoolean", "evalStructured"],
			},
		},
		{
			name: "evalStructured",
			requiredCredentials: ["llm", "openrouter", "ollama"],
			handler: async (
				credentials: Record<string, unknown>,
				{
					text,
					schema,
					quality,
				}: { text: string; schema: z.ZodTypeAny; quality?: ModelQuality },
			) => {
				const cfg = await loadPluginConfig(configStore);
				const client = createLLMClient(credentials, cfg);

				if (!schema || typeof (schema as any).safeParse !== "function") {
					throw new Error(
						"evalStructured expects a Zod schema (e.g., z.object({...})). " +
							"JSON schema objects or plain object shapes are not supported.",
					);
				}

				const response = await client.chat.completions.create({
					model: resolveModel(quality, cfg.model, undefined, cfg.provider),
					messages: [
						{
							role: "system",
							content:
								"Extract data from text according to schema. Return only valid JSON.",
						},
						{
							role: "user",
							content: `Extract data from the following text according to schema:\n\n${text}`,
						},
					],
					response_format: {
						type: "json_schema",
						json_schema: { name: "output", schema: z.toJSONSchema(schema) },
					},
					reasoning_effort: "medium",
					temperature: 0,
				});

				const content = response.choices[0]?.message?.content || "";

				if (!content) {
					return {
						error: "No content returned from LLM",
						data: null,
					};
				}

				const parsed = JSON.parse(content);

				const validated = await schema.safeParseAsync(parsed);

				if (!validated.success) {
					return {
						error: "Failed to parse output with schema",
						data: null,
					};
				}

				return { data: validated.data };
			},
			description:
				"Use AI to extract structured data from text using a Zod schema object. Returns { data } on success, or { error, data: null } on failure. IMPORTANT: Pass a Zod schema object created with z.object({...}), z.string(), z.number(), etc. JSON schema objects or plain object shapes will fail. When defining the schema, add helpful metadata via .description('...') on each field so the model knows the expected format or details (e.g. date formats, specific keywords). Optional quality parameter: 'high' (default), 'medium', 'low'.",
			returnType:
				"Promise<{ data: Record<string, any> } | { error: string; data: null }>",
			parameters: [
				{ name: "text", type: "string" },
				{ name: "schema", type: "z.ZodType<any>" },
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
				tags: ["readonly", "llm", "data"],
				readonly: true,
				version: "1.0.0",
				relatedTo: ["evalBoolean", "evalMultiCategory"],
			},
			docs: {
				summary:
					"Extract structured data from unstructured text using a Zod schema. The LLM reads the text and returns JSON conforming to the provided schema. Always use Zod schemas (z.object, z.string, z.number, etc.) — plain objects or JSON schema will fail.",
				parameters: [
					{
						name: "text",
						type: "string",
						description:
							"The unstructured text to extract data from (email body, document, etc.).",
						example:
							'"Invoice #42 from Acme Corp. Total: $150.00 USD. Due: 2026-03-15."',
					},
					{
						name: "schema",
						type: "Zod schema",
						description:
							"A Zod schema object defining the shape of the extracted data. Use .describe() on fields to guide the model on expected format or details.",
						example:
							'z.object({ provider: z.string().describe("Company name"), amount: z.number(), currency: z.string().describe("3-letter code like USD") })',
					},
					{
						name: "quality",
						type: "'high' | 'medium' | 'low'",
						description:
							"Model quality tier. 'high' (default) uses the most capable model, 'medium' balances quality and speed, 'low' is fastest. Omit for default (high).",
						example: '"medium"',
					},
				],
				returns: {
					type: "Promise<{ data: Record<string, any> } | { error: string; data: null }>",
					description:
						"Always an object with a `data` field. On success, `data` is the extracted value matching the schema. On failure, `data` is null and `error` describes the problem.",
					example:
						'{ data: { provider: "Acme Corp", amount: 150, currency: "USD" } }',
				},
				examples: [
					{
						title: "Extract invoice data",
						code: 'const schema = z.object({\n  provider: z.string().describe("Company or service name"),\n  amount: z.number().describe("Total amount"),\n  currency: z.string().describe("3-letter currency code"),\n  dueDate: z.string().optional().describe("Due date in YYYY-MM-DD"),\n});\nconst result = await evalStructured(emailBody, schema);\nif (result.data === null) throw new Error(result.error);\nconst invoice = result.data;',
					},
					{
						title: "Extract with lower quality for speed",
						code: 'const schema = z.object({\n  name: z.string(),\n  email: z.string(),\n});\nconst { data: contact } = await evalStructured(text, schema, "low");',
					},
					{
						title: "Extract multiple items from text",
						code: "const schema = z.object({\n  items: z.array(z.object({\n    name: z.string(),\n    quantity: z.number(),\n    price: z.number(),\n  })),\n  total: z.number(),\n});\nconst { data: receipt } = await evalStructured(receiptText, schema);",
					},
				],
				caveats: [
					"Must pass a Zod schema (z.object({...})), NOT a plain object or JSON schema",
					"Use .describe() on schema fields to guide extraction — the model uses these as hints",
					"Always unwrap with `result.data`. On failure returns { error, data: null } instead of throwing — check data !== null before using",
					"The z object is pre-loaded in the VM — do not import it",
				],
				seeAlso: ["evalBoolean", "evalMultiCategory"],
			},
		},
	];
}
