# Contract migration — completed

## Status: consuming `@orgsdk/plugins` from npm

This plugin imports its authoring types from the public
[`@orgsdk/plugins`](https://www.npmjs.com/package/@orgsdk/plugins) npm package.
The migration from the monorepo workspace specifier is complete.

## What changed (from the monorepo source)

1. **Import specifiers updated** — `from "orgsdk/plugins"` →
   `from "@orgsdk/plugins"`. All imports are **type-only**
   (`import type { … }`). Inline type expressions
   `import("orgsdk/plugins").ConfigStore` became
   `import("@orgsdk/plugins").ConfigStore` (also erased at compile time).
2. **devDependency** is the published npm package, pinned to an exact version
   (`@orgsdk/plugins@0.2.1`) for reproducibility.
3. **Purity guards** — type-only imports from `@orgsdk/plugins` are
   allowed; value imports and all other `@orgsdk/*` packages are blocked
   (enforced by `tests/purity.test.ts` and `orgsdk-plugin validate`).
4. **Artifact runtime dependency — `zod`.** llm imports `zod` at runtime
   (`index.ts` config schema, `llm-eval-functions.ts` output schemas that call
   `z.object` / `z.toJSONSchema`). It is declared as a runtime
   `dependencies` entry in `package.json`, so the generated artifact
   `package.json` carries `"dependencies": { "zod": "^4.0.0" }` and the
   catalog's materialise step resolves it. The authoring SDK
   (`@orgsdk/plugins`) is **not** a runtime dependency (type-only imports are
   erased at compile time).
5. **No OpenAI SDK runtime dependency.** `_llm-client.ts` calls the
   OpenAI-compatible Chat Completions API directly with `fetch` — the OpenAI
   npm package was deliberately removed in the monorepo source. This is
   preserved; `tests/purity.test.ts` guards against its re-introduction.
6. **Manifest `$schema`** — `plugin/.plugin.json` declares
   `$schema: https://orgsdk.ai/schemas/plugin-manifest.v1.json` for editor
   completion and schema validation.
7. **Provenance** — `marketplace.links.sourceRepo` points at this repository
   (canonical key supported by `plugin-manifest.v1`).
8. **No local management scripts** — `validate`, `package`, `version-guard`,
   and `publish` are npm scripts that delegate to the `orgsdk-plugin` CLI
   shipped by `@orgsdk/plugins`.
9. **Reusable CI/CD workflows** — `.github/workflows/ci.yml` and
   `publish-catalog.yml` call the centrally maintained reusable workflows in
   `OrgSDK/plugins` (pinned to an immutable commit) instead of duplicating
   CI/publish mechanics.

## What did NOT change (frozen behavior)

- The seven safe functions — `generate`, `evalBoolean`, `evalMultiCategory`,
  `evalStructured`, `querySearch`, `summarizeText`, `synthesizeAnswer` — names,
  parameters, return types, metadata, `readonly` tags, and
  `requiredCredentials: ["llm", "openrouter", "ollama"]`.
- The token auth provider — `type: "token"`, generic provider key `llm`,
  `displayName: "LLM"`, the `storeToken` write target (always the generic
  `llm` key), the `authSetup` CLI flow, and the no-callback token shape.
- The generic-first credential resolution in `_llm-client.ts`:
  `llm/default` → `<provider>/default` → env vars — byte-identical.
- The two transport modes in `_llm-client.ts`:
  - **Proxy mode (cloud):** `ORGSDK_LLM_PROXY_URL` set → routes through the
    relay LLM proxy, authenticating with `DAEMON_API_KEY` as bearer; the
    tenant BYO key forwarded as `X-OrgSDK-TenantKey`; the resolved upstream
    endpoint sent as `X-OrgSDK-Upstream-Base-URL`.
  - **Direct mode (local):** reads provider/model/baseURL from plugin config,
    the connected credential, or env vars.
- The Zod config schema in `index.ts` — five fields (`provider`,
  `model`, `baseURL`, `maxTokens`, `temperature`) and their constraints.
- `constants.ts` (`CRED_PROVIDER_LLM = "llm"`) — verbatim.
- `docs/overview.md` and `guides/usage-patterns.md` — verbatim.

> **No SSRF/proxy/security refactor.** The outbound request construction in
> `_llm-client.ts` (endpoint resolution, header set, error format) is frozen
> exactly as shipped in the monorepo. Any security hardening of the proxy/direct
> routing is a separate, deliberate change and was intentionally not combined
> with this repository extraction.

## Known pre-existing issues (recorded, not fixed in this release)

These predate the extraction and are frozen byte-for-byte per the migration
discipline (skill learning #6 — never combine a behavioral refactor with an
extraction):

- `llm-eval-functions.ts` is **372 lines** (monorepo 300-line guideline). The
  external-repo CLI does not enforce a file-size limit, so this does not block
  publication; a split is a separate change.
- A few pre-existing `as` / `any` casts in `_llm-client.ts` and the function
  modules (`as ProviderBundle`, `as any` in the `evalStructured` guard,
  `findings: any[]` in `synthesizeAnswer`). These were not introduced by the
  migration and are frozen.

## Why `@orgsdk/plugins`?

The package provides the stable, minimal, structural TypeScript contract
between plugin authors and the OrgSDK daemon — with no private daemon,
platform, storage, or database internals. See
[OrgSDK/plugins](https://github.com/OrgSDK/plugins) for the full API surface.

## Type-only contract

All imports from `@orgsdk/plugins` are `import type { … }` or inline
`import("…")` type expressions — erased at compile time. The runtime plugin
artifact carries **only** `zod` as a dependency (the OpenAI SDK and the
authoring SDK are absent). This means:

- Minimal runtime weight (one framework dependency: zod).
- Plugin source typechecks against the same contract the daemon enforces.

## Upgrading the contract version

The dependency is pinned exactly (`0.2.1`). When a new contract version is
released, update the version in `package.json`, regenerate the lockfile with
`bun install`, and confirm tests still pass. Prefer deliberate, reviewed
upgrades over floating ranges while the contract is still pre-1.0.
