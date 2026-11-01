# Grants Workbench

A high-code Rayfin prototype for a private Queensland grants catalogue, human grant reviews, and grounded **GitHub Copilot SDK** chat. Fabric hosts authentication, SQL data, static assets, and functions; Azure OpenAI supplies the model through Entra authentication.

**[Deployed app](https://deft-wheat-ac5929f368-australiaeast.webapp.fabricapps.net)** (Fabric sign-in required). This is an independent proof of concept, not an official grants service or an eligibility decision.

## Data and reviews

Sign in and import normalized grant JSON, such as the root `npm run preview -- --out grants.preview.json` output. Imports update matching source IDs and add new grants to your own catalogue; they do not deactivate programs missing from an import. The deployed prototype was seeded with 320 Queensland-applicable business.gov.au programs.

`GrantRecord`, `GrantReview`, and `ChatTurn` in `rayfin/data/` enforce caller ownership. Reviews are append-only and tied to the program's content hash, so changing a grant does not silently rewrite a previous decision. Chat turns preserve the answer and cited source IDs, URLs, and revision hashes. Anonymous access and assigning another user's ownership are denied.

## Copilot SDK chat

`rayfin/functions/src/function_app.ts` retrieves caller-visible records, applies Queensland/current-date filters, and keyword-ranks up to eight evidence records. `copilotChat.ts` creates an isolated SDK session, replaces the system instructions with grounded guidance, disables tools and config discovery, and rejects empty, oversized, or invalidly cited answers.

The SDK uses Azure OpenAI BYOK with `bearerTokenProvider`; the token comes from `context.Tokens.AzureAI`. Rayfin currently uses the **AppBackend owner's external identity** for that token, while database reads remain caller-scoped. The owner needs *Cognitive Services OpenAI User* on the model resource. Neither a GitHub token nor an Azure API key is required.

The transport separates the known non-reasoning GPT-4.1 behavior profile from the configurable Azure deployment name. This avoids the SDK's fallback profile sending `reasoning_effort` to `gpt-4.1-mini`. Output is bounded to 1,000 tokens and stored answers to 4,000 characters.

## Deploy

Use the [root Fabric deployment instructions](../../README.md#fabric-backend). The Bicep entry point creates the resource group and optional dedicated model; Rayfin publishes the Fabric app into an existing capacity-backed workspace.

For subsequent app deployments, from this directory:

```bash
npm run deploy:fabric -- --workspace-id '<workspace-guid>' \
  --tenant '<tenant-guid>' --item-name 'Grants Workbench'
```

The wrapper builds functions, installs their **Linux x64 glibc** optional dependencies, and invokes `npx rayfin up` with `RAYFIN_FUNCTIONS_NO_BUNDLE=1`. This carries the SDK's native runtime rather than deploying a JavaScript-only bundle. Local-platform dependencies are restored even if publishing fails. Do not use plain `rayfin up` for this SDK app without the native packaging wrapper.

The configured Azure endpoint must be the HTTPS resource root, not a deployment/API path, and must be reachable from Fabric. The default Bicep model is regional `gpt-4.1-mini` in Australia East, 30,000 tokens/minute, with API keys disabled. A VNet-only existing model is not reachable through this public Fabric function path.

## Development and validation

Use Node **22.13+ (22.x) or 24.x**. Install the app and functions separately with `npm ci` and `npm --prefix rayfin/functions ci`.

```bash
npm run dev                  # Rayfin local frontend/functions with Fabric auth/data
npm run lint
npm test                     # offline unit tests
npm run build
npm --prefix rayfin/functions run build

# Uses existing imported data; writes one chat turn and verifies persistence:
npm run smoke -- '<normalized-grants.json>' --chat-only

# Isolates real SDK/model inference locally, using Azure CLI Entra auth:
npm run smoke -- '<normalized-grants.json>' --sdk-local \
  --ai-endpoint 'https://<account>.openai.azure.com/' --ai-deployment 'gpt-4.1-mini'
```

Without either smoke switch, the smoke script also imports the supplied catalogue and writes a labelled review, verifying immutable reviews and access policies. Live checks require credentials, write data, and incur model usage; unit tests do neither.

The lockfiles retain Rayfin 1.36.2 and Copilot SDK 1.0.28, with scoped overrides for patched Zod 4.6.7, MSAL Node 7.1.2, glob 14.0.2, and minimatch 11.0.1 because upstream dependencies still select vulnerable versions. Vitest and ESLint tooling are upgraded; functions cleanup uses Node's built-in filesystem API instead of rimraf. Check both dependency trees with `npm audit` and `npm --prefix rayfin/functions audit`; the remediated lockfiles report zero vulnerabilities.

The app approves only the pinned `keytar@7.9.0` install script, needed for Rayfin's encrypted credential cache after a clean install. Do not use `--ignore-scripts` for the app install without restoring that native module. The deployment wrapper's Linux functions install intentionally skips scripts; it uses the SDK's packaged STDIO runtime, not Koffi's in-process bindings.

## Prototype limits

The catalogue is private per user, imports are manual/additive, and no Fabric feed schedule or cross-user review workflow is implemented. Chat is stateless per question despite persisted history and scans at most 10,000 records; it is keyword-grounded, not vector/semantic search or FoundryIQ. Sources can become stale between imports, and neither geographic tags nor model answers establish eligibility. Confirm current terms with the official provider.

This package and its functions have separate dependencies/builds from the root backend. Clean dependency audits do not make this prototype production-hardened.
