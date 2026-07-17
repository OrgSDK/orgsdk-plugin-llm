# LLM

LLM-powered generation, evaluation, and research — classification, structured
extraction, free-form text generation, and knowledge synthesis. Works with
OpenRouter, Ollama Cloud, or any OpenAI-compatible endpoint.

## What it does

The `llm` plugin gives agent workflows language-model capabilities as safe
functions. It is the backbone of any "read unstructured text, produce typed
data" workflow — invoices → rows, emails → categories, transcripts → summaries.

Typical uses:

- **Structured extraction** — pull typed fields (invoice amount, currency,
  due date) out of free text and into a Zod-validated object.
- **Classification** — tag support tickets, route emails, or yes/no gating
  ("is this a shipping notification?").
- **Generation** — draft summaries, rewrite copy, compose replies.
- **Research** — search a knowledge base, summarise long documents, and
  synthesise a cited answer from multiple findings.

## Functions

| Function | Purpose |
|---|---|
| `evalStructured` | Extract typed data into a Zod schema. Most flexible. |
| `evalBoolean` | Binary yes/no classification with positive + negative examples. |
| `evalMultiCategory` | Tag text with one or more categories from a known list. |
| `generate` | Free-form text generation (no schema enforcement). |
| `querySearch` | Knowledge-based search (not live web). |
| `summarizeText` | Condense long text to a word-budget summary. |
| `synthesizeAnswer` | Combine multiple findings into one cited answer. |

The full function list (parameters, return types) is available per-plugin via
the `plugins:info` command in the dashboard.

## Credentials

Connect a single **API Token** from the Credentials tab (or plugin row). The
token is stored under the generic `llm/default` credential key and sent as a
Bearer header to whichever OpenAI-compatible endpoint is configured in plugin
settings. Changing the provider or baseURL does **not** require reconnecting.

Resolution order:

1. `llm/default` — the generic credential written by Connect (preferred).
2. `openrouter/default` or `ollama/default` — legacy per-provider bundles
   (fallback for existing installations).
3. Environment variables (`ORGSDK_LLM_API_KEY`, `OPENROUTER_API_KEY`, …).

The `provider` setting in plugin config only controls default model/baseURL
selection — it does not choose which credential bundle is used.

## Using it in a workflow

```typescript
import { z } from "zod";

// Structured extraction — define the schema with .describe() hints
const invoiceSchema = z.object({
  provider: z.string().describe("Company or service name"),
  amount: z.number().describe("Total amount as a number"),
  currency: z.string().describe("3-letter currency code like USD or EUR"),
  dueDate: z.string().optional().describe("Due date in YYYY-MM-DD format"),
});
const result = await evalStructured(emailBody, invoiceSchema);
if (result.data === null) throw new Error(result.error);
// result.data is now typed as the schema
```

```typescript
// Boolean classification with example boundaries
const isShipping = await evalBoolean(
  subject,
  "Is this a shipping notification?",
  { text: "Your order has shipped! Tracking: 1Z999...", matches: true },
  { text: "Your order has been placed", matches: false,
    reason: "Order confirmation, not shipping" },
);
```

## Notes

- Always check `result.data !== null` on structured extraction — parse failures
  return `{ error, data: null }` rather than throwing.
- Use `quality: "medium"` for simple extractions (faster, cheaper) and
  `"high"` for complex ones.
- For deeper agent-facing patterns (choosing the right eval function,
  confidence thresholds), see `guides/usage-patterns.md`.
