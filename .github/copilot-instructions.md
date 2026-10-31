# Copilot instructions

## Commands

```bash
npm ci
npm run build                      # tsc -p tsconfig.build.json -> dist/ (Functions entry: dist/functions/*.js)
npm run typecheck                  # tsc --noEmit
npm test                           # vitest run (all)
npx vitest run test/dates.test.ts  # single file
npx vitest run -t "name fragment"  # single test by name
npm run preview                    # live APIs -> normalized/deduped docs, no Azure (needs QLD_API_KEY)
npm start                          # func start (needs local.settings.json from local.settings.sample.json + Azurite)
npm run setup:search               # publish search/*.json (index, datasource, skillset, indexer, knowledge source/base)
npm run setup:agent                # publish agents/*.yaml as a Foundry prompt agent version
npm run query -- <status|keyword|vector|hybrid|semantic|facets|filtered|agentic> "text"
npm run chat                       # chat with the deployed agent
```

No linter is configured. Node >= 22, ESM (`"type": "module"`): relative imports use `.js` extensions even in `.ts` files.

## Architecture

Pipeline: weekly timer / `POST /api/sync` Azure Function (`src/functions/syncGrants.ts`) -> `src/lib/sync.ts::runSync`:

1. Fetch QLD Grants Finder (`qldClient.ts`, services + dimension tables joined in `transform.ts`) and business.gov.au Coveo finder (`businessClient.ts` -> `businessGrants.ts`). Both are normalized to the shared `GrantDocument` (`types.ts`, helpers in `normalize.ts`/`dates.ts`) and deduplicated by content fingerprint (`dedupe.ts`; lowest upstream id wins, others kept in `sourceIds`).
2. `blobStore.ts` writes one `grants/<id>.json` blob per program **only if `contentHash` changed**, and soft-deletes (`IsDeleted` metadata, purged after `SOFT_DELETE_RETENTION_DAYS`) programs that disappeared. Blob is the staging layer because AI Search pull indexers can't call HTTP endpoints.
3. If anything changed, `searchClient.ts` runs the AI Search indexer, which embeds title/description via the skillset into the `grants` index. A FoundryIQ knowledge base sits over that index; `agents/grants-agent.yaml` defines a Foundry prompt agent that calls it via MCP (`knowledge_base_retrieve`).

Source specifics:
- QLD: `qldClient.ts` sends `X-Api-Key` and fetches `services.json` (the facts) plus five dimension tables (`DIMENSIONS` in `types.ts`); `normalize.ts` joins tag ids to dimension values (negative "Select all" keys are skipped) and reads fields by their raw detail keys (`F` map). `dates.ts` parses the feed's mixed date formats into ISO with a fixed `+10:00` offset (Queensland has no DST).
- business.gov.au: `businessClient.ts` scrapes a page-scoped Coveo search key and query from the public finder page, then pages the Coveo API. It fails loudly if the page markup or Coveo organization changes, so a sync never runs against an unrecognised feed. `businessGrants.ts` strips HTML to text and maps Coveo fields (`z32x`-style names) onto `GrantDocument`.
- Config: `config.ts::loadConfig` reads app settings (`GRANTS_STORAGE_ACCOUNT_URL` required; `SEARCH_ENDPOINT` optional, in which case the indexer step is skipped as `notConfigured`).

Infrastructure (`infra/main.bicep` + `modules/`: monitoring, storage, search, foundry, function, roles) deploys everything keyless: managed identities and RBAC role assignments (`roles.bicep`), shared storage keys disabled, Flex Consumption Function (Node 22), serverless AI Search, a Foundry account/project with `text-embedding-3-small` and `gpt-5.4-mini` deployments, and project connections (Search, knowledge-base MCP, App Insights). Resource names derive from `environmentName` plus a hash token. Preview API versions are intentional (Bicep may warn `BCP081`; `az deployment group validate` still passes). `main.bicepparam` reads `QLD_API_KEY`, `AZURE_PRINCIPAL_ID` and `STORAGE_POLICY_OPT_OUT` from environment variables. Bicep outputs (UPPER_SNAKE_CASE) are the contract that feeds `.env` for the scripts, so adding a script setting usually means adding an output.

Data-plane objects are declarative JSON in `search/` applied by `scripts/setup-search.ts` in dependency order: index -> data source -> skillset -> indexer -> knowledge source -> knowledge base. The indexer uses `parsingMode: json`, zero tolerated failures, and `outputFieldMappings` for the `titleVector`/`descriptionVector` fields produced by the skillset. Its own `P1D` schedule is only a safety net; the Function triggers it when blobs change. `SEARCH_API_VERSION` in `searchClient.ts` is the single data-plane version used by the repo.

Scripts (`scripts/`, run with `tsx`, share `env.ts`): `foundry.ts` is a minimal Foundry Agent Service/Responses client (`AgentFile`, `outputText`); `setup-agent.ts` renders and publishes every `agents/*.yaml` as a new agent version; `chat.ts` and `query.ts` are terminal clients; `preview-grants.ts` runs the whole fetch/normalize/dedupe path with no Azure.

`demo/grants-finder-extension/` is a separate, self-contained MV3 Edge/Chrome extension prototype with its own `package.json` (`npm run bridge`, `npm run capture`; Node 20+, plain JS, no build step, Playwright only for screenshots). It is not covered by the root `tsc`/`vitest` and is not deployed by `infra/`.
- `bridge/server.mjs`: zero-dependency localhost-only (`127.0.0.1:8787`) relay that gets an Entra token via `az account get-access-token` and forwards only `/health`, `/v1/conversations` and `/v1/responses` (streamed, pinned to `AGENT_NAME`). It accepts only extension origins and caps request size. Needs `FOUNDRY_PROJECT_ENDPOINT`.
- `extension/background.js`: service worker that owns all network I/O and conversation state in `chrome.storage`; each question starts a fresh Foundry conversation seeded with a compact recap (full history would blow the TPM quota) and retries rate limits with a countdown. `content.js` only renders state from storage and sends intents; its UI lives in a Shadow DOM (`panel.css`) and depends on the grants site's current DOM and routes.
- `extension/lib/grants.js` builds grant cards from the `knowledge_base_retrieve` MCP output and matches them to the answer by title (citation numbering is unreliable); `lib/markdown.js` renders model text as DOM nodes, never `innerHTML`.
- `tools/capture.mjs` (Playwright, needs the bridge running; `--no-video`, `--headed`) regenerates `screenshots/` referenced by the READMEs and `JOURNEY.md`; `tools/icons.mjs` regenerates icons.

## Conventions

- Script config comes from `.env`, generated from Bicep deployment outputs by `scripts/env.ts::loadScriptEnv` (set `AZURE_RESOURCE_GROUP` or pass `-g <rg>`; output names are normalized to UPPER_SNAKE_CASE because ARM mangles casing). `agents/*.yaml` and `search/*.json` are templates whose `${UPPER_SNAKE}` placeholders are filled from `.env` by `renderTemplate`, which throws when a value is empty. Update `test/agent.test.ts` when the agent YAML changes.
- Queensland is the default jurisdiction: query scripts and agent instructions filter `jurisdictions/any(j: j eq 'Queensland')` unless `--all-jurisdictions`/another jurisdiction is requested.
- `isOpen` is computed at sync time; for always-current results filter at query time on `status eq 'Open'` and `closingDate`.
- Changing any field in `GrantDocument` changes `contentHash` and re-stages every blob; keep bookkeeping fields (`id`, `sourceIds`, `contentHash`, `lastChangedAt`) excluded from the hashes as in `dedupe.ts`.
- Tests are pure unit tests (fixtures in `test/fixtures/`; `blobStore.test.ts` uses an in-memory container fake), no Azure or network access needed. Add a test file under `test/` named after the module it covers.
- Deploy flow (README "Deploy"): infra via `az deployment group create -p infra/main.bicepparam` -> `npm run build` + `func azure functionapp publish <app> --typescript --no-build` -> `npm run setup:search` -> trigger `POST /api/sync?code=<function key>` -> `npm run setup:agent`. `.funcignore` keeps sources, infra, scripts, search and tests out of the published package; `dist/` and `.env`/`local.settings.json` are git-ignored.
- Never commit secrets: `QLD_API_KEY` is a secure Bicep parameter / app setting, and `local.settings.json` and `.env` are ignored. Use `DefaultAzureCredential`, not keys, for Azure access.
- Function timeout is 10 minutes (`host.json`); the sync must stay inside it. The sync cron (`SYNC_SCHEDULE`) is NCRONTAB in UTC.
- Docs: the root `README.md` is the product/architecture/deploy reference (it duplicates the architecture diagram, config table and agent description); update it, and the demo README/`JOURNEY.md` where relevant, when behavior changes.
- Agent metadata values in the YAML must be strings of at most 512 characters; `starterPrompts` is newline-separated.
- The agent must stay grounded: retrieve before answering, cite sources, never invent programs/amounts/dates/links, and not give eligibility verdicts.
