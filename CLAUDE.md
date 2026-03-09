# CLAUDE.md

## Project Overview

ChittyScrape is a stateless browser automation service for the ChittyOS ecosystem. It scrapes portals that lack APIs (court dockets, property tax sites, mortgage servicer portals) and returns structured JSON.

**Repo:** `CHITTYOS/chittyscrape`
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

- **Entry:** `src/index.ts` — Hono app with catalog-driven generic route, capabilities + gap endpoints
- **Base types:** `src/scrapers/base.ts` — `ScraperModule` interface, `ScrapeResult`, `wrapResult`, `resolveSelector`
- **Catalog:** `src/catalog.ts` — `ScraperCatalog` class, registers all scrapers, lookup by ID/category
- **Scrapers:** `src/scrapers/` — Each scraper implements `ScraperModule` with `meta` + `execute()`
- **Auth:** Bearer token validated against `SCRAPE_KV` key `scrape:service_token`
- **Credentials:** Per-portal keys in `SCRAPE_KV` (e.g. `mrcooper:username`, `peoplesgas:password`)
- **No database** — stateless service, results returned to caller (ChittyCommand/ChittyRouter)

## Scrapers

All scrapers are accessed via `POST /api/scrape/:portalId` (generic) or their specific paths.

| Portal ID | Target | Input |
|-----------|--------|-------|
| `court-docket` | Cook County Circuit Clerk | `{ caseNumber }` |
| `cook-county-tax` | cookcountytreasurer.com | `{ pin }` |
| `mr-cooper` | mrcooper.com portal | `{ property }` |
| `peoples-gas` | Peoples Gas portal | `{ accountNumber }` |
| `comed` | ComEd portal | `{ accountNumber }` |
| `court-name-search` | Cook County courts (by name) | `{ name, divisions? }` |

All return `{ success: boolean; data?: T; error?: string; method: 'scrape'; portal: string; scrapedAt: string }`.

## Platform Endpoints

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/api/v1/capabilities` | GET | No | Declares available scrapers for ChittyRouter |
| `/api/v1/gaps` | GET | Bearer | Lists unknown portal requests (gap detection) |

## Adding a New Scraper

1. Create `src/scrapers/<name>.ts` implementing `ScraperModule` from `./base`
2. Export a `const xyzScraper: ScraperModule<TInput, TOutput>` with `meta` and `execute()`
3. Use `puppeteer.launch(browser)` and always close in a `finally` block
4. Use `wrapResult()` for all return paths
5. Import and `catalog.register()` in `src/index.ts`
6. Add test in `test/<name>.test.ts` (at minimum: metadata validation)
7. The generic `POST /api/scrape/:portalId` route picks it up automatically

**Claude Chrome workflow:** Use Claude's browser tools to explore a new portal, identify selectors and login flows, then generate the scraper module.

## Security

- Credentials via 1Password → KV (never hardcoded)
- Service token auth on all `/api/*` routes
- Browser sessions are ephemeral (Cloudflare Browser Rendering)
