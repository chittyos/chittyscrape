# CLAUDE.md

## Project Overview

ChittyScrape is a stateless browser automation service for the ChittyOS ecosystem. It scrapes portals that lack APIs (court dockets, property tax sites, mortgage servicer portals, HOA and resident portals) and returns structured JSON.

**Repo:** `chittyos/chittyscrape`
**Deploy:** Cloudflare Workers at `scrape.chitty.cc`
**Stack:** Hono TypeScript, Cloudflare Browser Rendering (`@cloudflare/puppeteer`)

## Common Commands

```bash
npm run dev          # Start local dev server (wrangler dev)
npm run deploy       # Deploy to Cloudflare Workers
npm run typecheck    # TypeScript type checking
npm test             # Run vitest tests
npm run test:watch   # Run vitest in watch mode
```

## Architecture

- **Entry:** `src/index.ts` — Hono app, builds the catalog from `allTargets` and serves the generic scrape route, MCP surface, health/status and capabilities endpoints
- **Base types:** `src/targets/base.ts` — `ScraperModule` interface, `ScraperMeta`, `ScrapeResult`, `wrapResult`, `resolveSelector`
- **Catalog class:** `src/catalog.ts` — `ScraperCatalog`, lookup by ID/category
- **Target registry:** `src/targets/catalog.ts` — the `allTargets` array; a target is live only once it appears here
- **Targets:** `src/targets/` — each implements `ScraperModule` with `meta` + `execute()`
- **Credentials:** `src/chittyconnect.ts` — ChittyConnect broker client, plus per-portal keys in `SCRAPE_KV`
- **Auth:** Bearer token validated against `SCRAPE_KV` key `scrape:service_token`
- **No database** — stateless service, results returned to caller (ChittyCommand/ChittyRouter)

## Targets

All targets are reachable via `POST /api/scrape/:portalId`.

| Portal ID | Target | Category | Auth | Input |
|---|---|---|---|---|
| `court-docket` | Cook County Court Docket | court | no | `{ caseNumber }` |
| `court-name-search` | Cook County Court Name Search | court | no | `{ name }` |
| `colombia-vur` | Colombia VUR Certificado de Tradicion | governance | no | `{ matricula, oficina_registro?, auto_pay? }` |
| `cook-county-recorder` | Cook County Recorder of Deeds — PIN Filing Search | governance | no | `{ pin }` |
| `fl-registered-agent` | Florida Registered Agent LLC | governance | yes | `{ entity? }` |
| `fl-sunbiz` | Florida Sunbiz — Division of Corporations Lookup | governance | no | `{ entityName }` |
| `il-sos` | Illinois Secretary of State — LLC/Corp Lookup | governance | no | `{ entityName }` |
| `nw-registered-agent` | Northwest Registered Agent | governance | yes | `{ entity?, downloadPdfs? }` |
| `wyoming-sos` | Wyoming Secretary of State — Entity Lookup | governance | no | `{ entityName }` |
| `cook-county-assessor` | Cook County Assessor — Property Assessment & Appeal Window | tax | no | `{ pin }` |
| `cook-county-tax` | Cook County Property Tax | tax | no | `{ pin }` |
| `comed` | ComEd (Commonwealth Edison) | utility | yes | `{ accountNumber }` |
| `peoples-gas` | Peoples Gas | utility | yes | `{ accountNumber }` |
| `mr-cooper` | Mr. Cooper Mortgage | mortgage | yes | `{ property }` |
| `appfolio-hoa` | AppFolio HOA | hoa | yes | `{ portfolio, account_index? }` |
| `buildinglink` | BuildingLink Resident Portal | hoa | yes | `{ building, action, payload?, mode?, idempotency_key? }` |
| `browse-ai` | Browse AI | generic | yes | `{ action, robotId?, taskId?, inputParameters? }` |
| `firecrawl` | Firecrawl AI Scraper | generic | yes | `{ url, apiKey?, formats? }` |
| `google-drive` | Google Drive Search | generic | yes | `{ query, mimeType?, folderId?, maxResults?, flagForIngestion? }` |
| `rei-hub` | REI Hub | generic | yes | `{ maxPages?, includeChartOfAccounts? }` |

All return `{ success: boolean; data?: T; error?: string; method: 'scrape'; portal: string; scrapedAt: string }`.

## Platform Endpoints

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `/` | GET | No | Dashboard |
| `/health` | GET | No | Liveness |
| `/api/v1/status` | GET | No | Service status |
| `/api/v1/capabilities` | GET | No | Declares available targets for ChittyRouter |
| `/api/v1/gaps` | GET | Bearer | Lists unknown portal requests (gap detection) |
| `/api/scrape/:portalId` | POST | Bearer | Generic scrape route |
| `/mcp` | POST | — | MCP surface |
| `/mcp/manifest` | GET | No | Static MCP manifest |

## Credentials

Two mechanisms are in use. Check which one a target uses before adding keys.

| Portal ID | Resolves via | Keys / refs |
|---|---|---|
| `fl-registered-agent` | ChittyConnect | `FLRA_USERNAME_REF`, `FLRA_PASSWORD_REF` |
| `nw-registered-agent` | ChittyConnect | `NWRA_USERNAME_REF`, `NWRA_PASSWORD_REF` |
| `comed` | KV | `comed:username`, `comed:password` |
| `peoples-gas` | KV | `peoplesgas:username`, `peoplesgas:password` |
| `mr-cooper` | KV | `mrcooper:username`, `mrcooper:password` |
| `appfolio-hoa` | KV | `appfolio-propertyhill:username`, `appfolio-propertyhill:password`, `appfolio-chicagoland:username`, `appfolio-chicagoland:password` |
| `buildinglink` | KV | `buildinglink-clarendon:username`, `buildinglink-clarendon:password`, `buildinglink-commodore:username`, `buildinglink-commodore:password` |
| `browse-ai` | ChittyConnect | `BROWSE_AI_API_KEY_REF` |
| `firecrawl` | see note | `FIRECRAWL_API_KEY` |
| `google-drive` | KV | `google-drive:service-account-key` |
| `rei-hub` | ChittyConnect | `REIHUB_USERNAME_REF`, `REIHUB_PASSWORD_REF` |

- **SCRAPE_KV** — per-portal keys read directly from the KV namespace.
- **ChittyConnect** — resolved at runtime through the broker (`src/chittyconnect.ts`), which requires `CHITTYCONNECT_TOKEN` or `CHITTYCONNECT_API_KEY`.
- **firecrawl** is the exception: it reads neither `SCRAPE_KV` nor ChittyConnect. It declares `FIRECRAWL_API_KEY` and also accepts an optional `apiKey` on its input, so the key arrives per-call or from an env binding. Confirm the precedence in `src/targets/firecrawl.ts` before relying on either.

Some ChittyConnect refs still use the legacy `op://vault/item/field` form. `resolveCredential` keeps a 404 fallback that rewrites those into a broker path, so they work but are **not** the shape for new integrations — use the canonical broker path instead. Nothing here reads 1Password directly.

Secret values are never hardcoded and never committed; only key names and refs appear in this repo.

## Adding a New Target

1. Create `src/targets/<name>.ts` implementing `ScraperModule` from `./base`
2. Export a `const xyzScraper: ScraperModule<TInput, TOutput>` with `meta` and `execute()`
3. Use `puppeteer.launch(browser)` and always close the page and browser in a `finally` block
4. Use `wrapResult()` for all return paths, including errors
5. Import it in `src/targets/catalog.ts` and add it to the `allTargets` array — `src/index.ts` registers everything in that array automatically
6. Declare `credentialKeys` in `meta` and store the values in `SCRAPE_KV` or ChittyConnect; never in the repo
7. Add `test/<name>.test.ts` (at minimum: metadata validation)
8. The generic `POST /api/scrape/:portalId` route picks it up with no further wiring

**Claude Chrome workflow:** Use Claude's browser tools to explore a new portal, identify selectors and login flows, then generate the target module.

## Security

- No secret values in code, repos, logs or chat — key names and refs only
- Service token auth on all `/api/*` routes
- Browser sessions are ephemeral (Cloudflare Browser Rendering)
- A target that mutates a third-party system of record gates writes fail-closed; see `src/targets/buildinglink.ts` for the pattern
