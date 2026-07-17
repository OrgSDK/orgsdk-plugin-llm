/**
 * Plugin-local constants for the llm plugin.
 *
 * Plugin source is shipped raw and materialised onto a cloud volume
 * (`/data/plugins/llm`) where monorepo workspace aliases like
 * `@orgsdk/shared` do NOT resolve (the runtime image strips
 * `@orgsdk/*` from node_modules). Only the supported `orgsdk/plugins`
 * contract and real npm packages (zod) may be imported here. Keep this
 * file self-contained — no `@orgsdk/*` imports.
 */

/**
 * Generic LLM credential provider key. New Connect writes always land here
 * regardless of provider/baseURL selection, so changing endpoints does not
 * require reconnecting. Resolution prefers this key and falls back to the
 * legacy per-provider keys ("openrouter"/"ollama") for existing installs.
 *
 * Mirrors `CRED_PROVIDER_LLM` in `@orgsdk/shared` — kept as a local copy so
 * the plugin resolves standalone after materialisation.
 */
export const CRED_PROVIDER_LLM = "llm" as const;
