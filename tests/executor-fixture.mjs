import assert from "node:assert/strict";

export default async function createFixture() {
	delete process.env.ORGSDK_LLM_PROXY_URL;
	return {
		provider: "llm",
		secret: { secret_apiKey: "synthetic-llm-key" },
		configuration: {
			model: "synthetic-model",
			baseURL: "https://model.invalid/v1",
		},
		async fetch(request) {
			assert.equal(request.url, "https://model.invalid/v1/chat/completions");
			assert.equal(request.method, "POST");
			assert.equal(
				request.headers.get("authorization"),
				"Bearer synthetic-llm-key",
			);
			const body = await request.json();
			assert.equal(body.model, "synthetic-model");
			const properties = body.response_format?.json_schema?.schema?.properties;
			let content = "Synthetic model result";
			if (properties?.result)
				content = JSON.stringify({
					result: true,
					confidence: 0.95,
					reason: "Synthetic classification",
				});
			else if (properties?.categories)
				content = JSON.stringify({ categories: ["support"] });
			else if (properties) content = JSON.stringify({ name: "Example" });
			return Response.json({
				choices: [{ message: { content } }],
				usage: { total_tokens: 9 },
			});
		},
		async run(call) {
			assert.equal(
				(await call("generate", { userPrompt: "Say hello" })).content,
				"Synthetic model result",
			);
			assert.equal(
				(
					await call("evalBoolean", {
						text: "Please help",
						criteria: "Support request",
						positiveExample: { text: "Help", matches: true },
						negativeExample: { text: "Hello", matches: false },
					})
				).result,
				true,
			);
			assert(
				(
					await call("evalMultiCategory", {
						text: "Please help",
						categories: "support, sales",
					})
				).includes("support"),
			);
			assert.deepEqual(
				await call(
					"evalStructured",
					'{ text: "Example", schema: z.object({ name: z.string() }) }',
				),
				{ data: { name: "Example" } },
			);
			assert.equal(
				(await call("querySearch", { query: "Synthetic knowledge" })).results[0]
					.source,
				"llm",
			);
			assert.equal(
				(await call("summarizeText", { text: "Synthetic document" })).summary,
				"Synthetic model result",
			);
			assert.equal(
				(
					await call("synthesizeAnswer", {
						question: "What happened?",
						findings: [{ url: "https://example.invalid/evidence" }],
					})
				).answer,
				"Synthetic model result",
			);
		},
	};
}
