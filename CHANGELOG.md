# Changelog

All notable releases of `@orgsdk/plugin-llm` are documented here.

The catalog treats versions as **write-once**: a given `(slug, version)` may be
re-published only with identical artifact content; differing content is
rejected with HTTP 409. Every entry below is therefore forward-only.

## [1.2.3] — standalone repository + artifact-format release

A forward-only patch release that migrates the llm plugin from the OrgSDK
monorepo (`packages/plugins/src/llm/`) into this standalone repository.
**No plugin source behavior changed** — the seven safe functions (`generate`,
`evalBoolean`, `evalMultiCategory`, `evalStructured`, `querySearch`,
`summarizeText`, `synthesizeAnswer`), the token auth provider (generic `llm`
credential key with `openrouter`/`ollama` legacy fallback), the generic-first
credential resolution, the cloud proxy / direct transport modes, the Zod config
schema (provider/model/baseURL/maxTokens/temperature), the agent-facing docs and
guides, the no-http-endpoint (token-only) shape, and the fetch-based client (no
OpenAI SDK dependency) are identical to the monorepo `1.2.2`.

### Why a bump at all?

The repository/package/schema additions alter the **immutable publishable
content** of the staged artifact, even though no plugin *behavior* changed:

- The manifest gains the canonical `$schema` and
  `marketplace.links.sourceRepo` provenance fields.
- The type-only import specifiers changed from `orgsdk/plugins` (monorepo
  workspace) to `@orgsdk/plugins` (public npm SDK). These imports are erased
  at compile time, so they do not affect runtime behavior — but the manifest
  and the generated artifact `package.json` do change.
- The generated artifact `package.json` is now produced by the deterministic
  `orgsdk-plugin package` step (`name: @orgsdk/plugin-llm`, `version: 1.2.3`,
  `dependencies: { zod: ^4.0.0 }`). The `zod` runtime dependency was implicit
  (workspace-hoisted) in the monorepo; it is now explicit in the artifact.

Because catalog versions are write-once, the existing `1.2.2` artifact on
record cannot be re-published with this changed content — it would differ and
be rejected with HTTP 409. Rather than mutate the published history of
`1.2.2`, the new artifact lands as a fresh `1.2.3` entry.

### Changed

- Bump `plugin/.plugin.json` version `1.2.2` → `1.2.3` (catalog source of
  truth).
- Bump `package.json` version `1.2.2` → `1.2.3` (kept in sync; enforced by
  the CI version guard).
- Add `plugin/.plugin.json` `$schema` and `marketplace.links.sourceRepo`.
- Adopt `@orgsdk/plugins@0.2.1` authoring contract (CLI + reusable workflows).
- Convert type-only imports `orgsdk/plugins` → `@orgsdk/plugins`.
- Declare `zod@^4.0.0` as an explicit runtime `dependencies` entry (was
  workspace-hoisted in the monorepo).

### Frozen (unchanged from monorepo 1.2.2)

- All seven safe functions — names, parameters, return types, metadata,
  `requiredCredentials: ["llm", "openrouter", "ollama"]`, `readonly` tags.
- Token auth provider — `type: token`, generic provider key `llm`,
  `displayName: LLM`, `storeToken` write target, `authSetup` CLI flow, no
  callback path.
- Generic-first credential resolution in `_llm-client.ts` (`llm/default` →
  `<provider>/default` → env vars).
- Cloud proxy / direct transport modes in `_llm-client.ts` (bearer auth,
  `X-OrgSDK-TenantKey` forwarding, `X-OrgSDK-Upstream-Base-URL` control
  header, endpoint resolution).
- The fetch-based OpenAI-compatible Chat Completions client (no OpenAI SDK).
- The Zod config schema (provider/model/baseURL/maxTokens/temperature).
- `constants.ts` (`CRED_PROVIDER_LLM = "llm"`) — verbatim.
- `docs/overview.md` and `guides/usage-patterns.md` — verbatim.

> **No SSRF/proxy/security refactor.** The outbound request construction is
> frozen exactly as shipped in the monorepo. Any hardening is a separate,
> deliberate change and was intentionally not combined with this extraction.

### Known pre-existing issues (recorded, not fixed)

- `llm-eval-functions.ts` is 372 lines (monorepo 300-line guideline). Not
  enforced by the external-repo CLI; a split is a separate change.
- A few pre-existing `as` / `any` casts (`as ProviderBundle`, the `evalStructured`
  `as any` guard, `findings: any[]`). Frozen byte-for-byte; not introduced by
  the migration.

## [1.2.2]

- Monorepo release (`packages/plugins/src/llm/`). Behavior identical to `1.2.3`
  above; superseded in the catalog by this standalone-repository release.
