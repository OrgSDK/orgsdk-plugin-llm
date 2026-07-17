# LLM Plugin — Classification & Extraction Patterns

## Choosing the Right Function

- **`evalBoolean`** — binary yes/no classification. Needs positive + negative examples.
- **`evalMultiCategory`** — tag text with one or more categories from a known list.
- **`evalStructured`** — extract typed data into a Zod schema. Most flexible.
- **`generate`** — free-form text generation. No schema enforcement.

## Structured Extraction Pattern

When extracting data from unstructured text (emails, documents, invoices):

1. Define a Zod schema with `.describe()` on every field — the LLM uses these as hints
2. Always check `result.data !== null` — on parse failure returns `{ error, data: null }`
3. Use `quality: "medium"` for simple extractions (faster, cheaper), `"high"` for complex ones

```typescript
const schema = z.object({
  provider: z.string().describe("Company or service name"),
  amount: z.number().describe("Total amount as a number"),
  currency: z.string().describe("3-letter currency code like USD or EUR"),
  dueDate: z.string().optional().describe("Due date in YYYY-MM-DD format"),
});
const result = await evalStructured(text, schema);
if (result.data === null) throw new Error(result.error);
```

## Boolean Classification with Examples

Always provide concrete positive AND negative examples to set the boundary:

```typescript
const result = await evalBoolean(
  emailSubject,
  "Is this a shipping notification?",
  { text: "Your order has shipped! Tracking: 1Z999...", matches: true },
  { text: "Your order has been placed", matches: false, reason: "Order confirmation, not shipping" },
);
// Use confidence thresholds: >0.9 auto-process, 0.7-0.9 review, <0.7 skip
```

## Research Functions

- `querySearch` — knowledge-based search (not live web). Good for general reference.
- `summarizeText` — condense long text. Set `maxLength` in words.
- `synthesizeAnswer` — combine multiple findings into one answer with citations.
