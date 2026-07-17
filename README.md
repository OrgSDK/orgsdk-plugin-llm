# @orgsdk/plugin-llm

Official OrgSDK plugin for LLM-powered generation, evaluation, and research —
read-only model calls from agent workflows via any OpenAI-compatible endpoint
(OpenRouter, Ollama Cloud, or a custom baseURL). Free-form generation, boolean
classification, multi-category tagging, structured Zod-validated extraction,
knowledge-based search, summarization, and multi-finding synthesis. Token auth
with a generic `llm` credential key (openrouter/ollama legacy fallback), cloud
proxy and direct transport modes, no OpenAI SDK dependency (fetch-based client).

[![CI](https://github.com/OrgSDK/orgsdk-plugin-llm/actions/workflows/ci.yml/badge.svg)](https://github.com/OrgSDK/orgsdk-plugin-llm/actions/workflows/ci.yml)

## Repository layout

```
orgsdk-plugin-llm/
├── .github/workflows/
│   ├── ci.yml                 # calls the shared reusable CI workflow (OrgSDK/plugins)
│   └── publish-catalog.yml    # calls the shared reusable publish workflow (opt-in; manual dry-run)
├── plugin/                    # the publishable plugin folder
│   ├── .plugin.json           # manifest (slug, version, auth, marketplace)
│   ├── index.ts               # entry — factory(ctx) → PluginModule
│   ├── _llm-client.ts         # fetch-based OpenAI-compatible client (no SDK dependency)
│   ├── auth-provider.ts       # token auth provider (generic llm credential key)
│   ├── constants.ts           # CRED_PROVIDER_LLM local constant
│   ├── llm-generate-functions.ts  # generate safe function
│   ├── llm-eval-functions.ts      # evalBoolean / evalMultiCategory / evalStructured
│   ├── research-functions.ts      # querySearch / summarizeText / synthesizeAnswer
│   ├── docs/overview.md       # plugin-local docs
│   └── guides/usage-patterns.md   # agent-facing guide (surfaced at load)
├── tests/                     # bun:test — manifest, source purity, plugin shape, packaging, client
├── docs/                      # contract migration, release/promotion contract
├── package.json
├── tsconfig.json
├── biome.json
└── README.md
```

The `plugin/` folder is the canonical source for the llm plugin; it is
published to the OrgSDK catalog on merge to `main` when opted in via the
`ORGSDK_ENABLE_CATALOG_PUBLISH` repo variable (see [docs/release.md](docs/release.md)).

## Local development

Requires [Bun](https://bun.sh) ≥ 1.3.x.

```bash
# Install (frozen lockfile in CI; dev: generates one)
bun install

# Lint + format check
bun run check

# Typecheck (no emit)
bun run typecheck

# Run tests
bun run test

# Validate manifest + source purity (orgsdk-plugin validate)
bun run validate

# Stage distributable artifact into dist/ (orgsdk-plugin package)
bun run package

# Full build pipeline (typecheck → validate → package)
bun run build
```

The `validate`, `package`, `version-guard`, and `publish` npm scripts delegate to
the [`orgsdk-plugin`](https://www.npmjs.com/package/@orgsdk/plugins) CLI shipped
by the `@orgsdk/plugins` dev dependency. There are no local management scripts.

## Functions

| Function | Purpose | Mode |
|---|---|---|
| `generate` | Free-form text generation with an optional system prompt and quality tier. | readonly |
| `evalBoolean` | Binary yes/no classification with positive + negative examples + confidence. | readonly |
| `evalMultiCategory` | Tag text with one or more categories from a known list. | readonly |
| `evalStructured` | Extract typed data into a Zod schema (the most flexible extractor). | readonly |
| `querySearch` | Knowledge-based search (not live web). | readonly / discovery |
| `summarizeText` | Condense long text to a word-budget summary. | readonly |
| `synthesizeAnswer` | Combine multiple findings into one cited answer. | readonly |

All functions require the `llm` credential (openrouter/ollama legacy bundles
accepted as fallback for existing installations).

## Credentials & transport

Connect a single **API Token** from the Credentials tab. It is stored under the
generic `llm/default` key and sent as a Bearer header to whichever
OpenAI-compatible endpoint is configured. Two transport modes:

- **Proxy mode (cloud):** `ORGSDK_LLM_PROXY_URL` set → routes through the relay
  LLM proxy (authenticates with `DAEMON_API_KEY`; the tenant BYO key is
  forwarded as `X-OrgSDK-TenantKey`).
- **Direct mode (local):** reads provider/model/baseURL from plugin config, the
  connected credential, or env vars.

Resolution order: `llm/default` → `openrouter/default` | `ollama/default`
(legacy) → env vars. Changing the provider/baseURL does **not** require
reconnecting.

## Manifest & version rules

- The manifest lives at `plugin/.plugin.json`.
- `version` is the **source of truth** for the catalog — bump it on every
  publishable content change (the CI version guard enforces this).
- `package.json` → `version` is kept in sync with the manifest (enforced by
  the version guard).
- Versions are **write-once** in the catalog: re-publishing the same
  `(slug, version)` with identical content is idempotent; differing content is
  rejected (HTTP 409). Treat every publish as forward-only.
- See [docs/release.md](docs/release.md) for the automatic publish model and
  required repository settings.

## CI/CD

CI and catalog publishing delegate to centrally maintained **reusable
workflows** in [OrgSDK/plugins](https://github.com/OrgSDK/plugins), pinned to an
immutable commit. The caller workflows (`.github/workflows/`) only wire up
triggers, the opt-in gate, artifact names, and secrets — no plugin mechanics are
duplicated. See the
[reusable-workflows docs](https://github.com/OrgSDK/plugins/blob/main/docs/reusable-workflows.md)
for the full contract.

## Security constraints

- LLM API tokens are injected at call time via `requiredCredentials:
  ["llm", "openrouter", "ollama"]` — they are **never** hardcoded, logged, or
  persisted in plugin source. The bundle flows through the daemon's
  `CredentialStore`.
- Plugin handlers receive credentials as a parameter; they must not return,
  log, or store them.
- Source purity is enforced: no imports from private `@orgsdk/*` packages, no
  cross-plugin imports, no runtime value imports from the authoring SDK, no
  OpenAI SDK runtime dependency. The `validate` script and
  `tests/purity.test.ts` guard this.
- Publish credentials (`ORGSDK_PUBLISH_TOKEN`) live as a GitHub secret
  (repository-level or `catalog-publish` environment); they are never committed
  to the repo. See [docs/release.md](docs/release.md).

## Authoring contract & runtime dependency

The plugin authoring types come from the public
[`@orgsdk/plugins`](https://www.npmjs.com/package/@orgsdk/plugins) npm package,
imported type-only (`import type { … } from "@orgsdk/plugins"`). The SDK is a
dev-only dependency. The runtime artifact carries **one** runtime dependency —
`zod` (`^4.0.0`) — because the config schema and the eval output schemas use
`z.object` / `z.toJSONSchema` at runtime. There is **no** OpenAI SDK dependency
(`_llm-client.ts` calls the API directly with `fetch`).
See [docs/contract-migration.md](docs/contract-migration.md).

## Source attribution

Extracted from the OrgSDK monorepo at:

- **Source path:** `packages/plugins/src/llm/`
- **llm source first added (monorepo commit):** `a3cbecf123be62e99b1a9c3b2eef06a5a137977b`
- **Last monorepo commit touching the source:** `446411bc3ea23928e5bafe256e03d5870f56bbfc`
- **Monorepo HEAD at extraction:** `dd8e17ecd6495fd12a4957b7785822737d76aaf0`

No plugin behavior changed in this extraction — only the type-only import
specifiers (`orgsdk/plugins` → `@orgsdk/plugins`), the manifest `$schema`,
`version`, and `marketplace.links.sourceRepo` were added.

## License

Proprietary — All rights reserved. This source is the confidential property
of OrgSDK. No part of this repository may be reproduced, distributed, or
transmitted in any form without the prior written permission of OrgSDK.
Unauthorized use, modification, or redistribution is strictly prohibited.
