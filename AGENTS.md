# ChittyScrape — Agent Guide

Service: `chittyscrape`  
Canonical URI: `chittycanon://core/services/chittyscrape`  
Domain: `scrape.chitty.cc`  
Tier: 3

## Purpose

ChittyScrape is the stateless portal-I/O execution layer for sources without a supported API. It returns structured scrape results; it does not own downstream business state.

## Development

```bash
npm install
npm run typecheck
npm test
npm run dev
```

Production deploy remains operator-gated:

```bash
npm run deploy
```

## Architecture

- Cloudflare Workers + Hono.
- Cloudflare Browser Rendering via `env.BROWSER`.
- Scrapers implement `ScraperModule` and register through `src/targets/catalog.ts`.
- Generic execution route: `POST /api/scrape/:portalId`.
- Service bearer lives in `SCRAPE_KV`.
- Supported portal credentials are resolved at point of use through ChittyConnect using opaque credential refs. Do not expose or persist returned secret values.
- Some older targets still read credentials from KV; treat those as migration debt, not the preferred pattern.

## REI Hub

Portal ID: `rei-hub`.

The REI Hub adapter is read-only. It captures Booked Transactions and, when available, Chart of Accounts into a structured snapshot with a SHA-256 fingerprint. It must not create or edit accounting records in REI Hub.

Downstream authority belongs to ChittyFinance. REI Hub snapshots are comparison evidence for reconciliation; they are not a second financial ledger.

Credential env refs:
- `REIHUB_USERNAME_REF`
- `REIHUB_PASSWORD_REF`

Both refs are dereferenced through ChittyConnect. Never hardcode account credentials.

## MCP Surface

Endpoint: `POST /mcp`.

The MCP surface is deliberately narrower than the REST scraper catalog. It exposes:
- `list-scrapers` — read scraper metadata.
- `rei-hub-snapshot` — execute the read-only REI Hub snapshot adapter.

Authentication uses the existing ecosystem `ch1tty_mcp_token` through a Cloudflare Secrets Store binding named `CHITTY_MCP_TOKEN`. The secret value must never be logged, copied to KV, or committed.

The MCP transport is stateless JSON-RPC. It supports initialize, ping, tools list/call, empty resource/template lists, empty prompt list, and initialized notifications.

## Agent Rules

1. Discover an existing scraper before adding a target.
2. Keep extraction deterministic; use resilient selectors and fail closed on authentication/challenge failures.
3. Never log credentials, cookies, tokens, or raw secret values.
4. Do not add a datastore for scraped business data.
5. Preserve idempotency at downstream consumers; ChittyScrape itself is stateless.
6. If a source can be consumed through a supported API, prefer the API owner/service instead of browser automation.
7. Browser writes require an explicit chartered write workflow and pre/post verification. REI Hub has no write workflow in this branch.
8. Run typecheck and tests before marking a PR ready.
