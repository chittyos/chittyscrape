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
```

## Architecture

- **Entry:** `src/index.ts` — Hono app with service token auth, health endpoint, 3 scrape routes
- **Scrapers:** `src/scrapers/` — Each scraper is a pure function: `(browser: Fetcher, ...args) => Promise<Result>`
- **Auth:** Bearer token validated against `SCRAPE_KV` key `scrape:service_token`
- **Credentials:** Mr. Cooper login stored in `SCRAPE_KV` (`mrcooper:username`, `mrcooper:password`)
- **No database** — stateless service, results returned to caller (ChittyCommand)

## Scrapers

| Endpoint | Target | Input |
|----------|--------|-------|
| `POST /api/scrape/court-docket` | Cook County Circuit Clerk | `{ caseNumber }` |
| `POST /api/scrape/cook-county-tax` | cookcountytreasurer.com | `{ pin }` |
| `POST /api/scrape/mr-cooper` | mrcooper.com portal | `{ property }` |

All return `{ success: boolean; data?: ...; error?: string }`.

## Adding a New Scraper

1. Create `src/scrapers/<name>.ts` exporting an async function
2. Use `puppeteer.launch(env.BROWSER)` for browser instance
3. Always close browser in a `finally` block
4. Wire route in `src/index.ts`
5. Add corresponding bridge route in ChittyCommand (`src/routes/bridge.ts`)

## Security

- Credentials via 1Password → KV (never hardcoded)
- Service token auth on all `/api/*` routes
- Browser sessions are ephemeral (Cloudflare Browser Rendering)
