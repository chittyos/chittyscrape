# ChittyScrape Enhancement Design

**Date**: 2026-02-24
**Status**: APPROVED
**Author**: ChittyOS / Claude Code session

---

## Problem Statement

ChittyScrape currently supports 3 hardcoded scrapers (court-docket, cook-county-tax, mr-cooper). The ecosystem needs:

1. **Utility bill scraping** -- Peoples Gas, ComEd, and any bill portal with a login
2. **Court name search** -- Search by party name (Nicholas, company names) across all Cook County court divisions
3. **HOA/generic portal scraping** -- Any login-based bill or account portal
4. **Plaid/API awareness** -- Scraping is the fallback, not the default; direct API and Plaid connections take priority
5. **Router coordination** -- ChittyScrape declares capabilities, ChittyRouter decides when to use it
6. **Gap detection** -- When a portal isn't supported, flag it and recommend building a new scraper

## Architecture Decision: Service Boundaries

| Concern | Service | Rationale |
|---------|---------|-----------|
| Portal/data-source registry, routing decisions, email parsing | **ChittyRouter** | Router owns the "how do we get this data" decision |
| Scraper execution, capabilities declaration, gap reporting | **ChittyScrape** | Scrape engine -- told what to scrape, does it |
| Credential storage for portal logins | **SCRAPE_KV** | Per-portal namespaced keys |
| Business governance/compliance data | **ChittyGov** | Governance is its own domain |
| Scraper generation workflow | **Claude Chrome** (dev-time) | AI browses portal, generates scraper code |

### Data Acquisition Priority (ChittyRouter decides)

1. **Direct API** -- If the data source has an API, use it
2. **Plaid** -- If Plaid supports the institution, use it
3. **ChittyScrape** -- Fallback browser automation
4. **Manual** -- Flag for human intervention

ChittyScrape is only called when methods 1-2 are unavailable.

## Design

### 1. Scraper Module Pattern

Every scraper conforms to a standard interface:

```typescript
// src/scrapers/base.ts

interface ScraperMeta {
  id: string;                    // e.g. 'peoples-gas'
  name: string;                  // e.g. 'Peoples Gas'
  category: ScraperCategory;
  version: string;
  requiresAuth: boolean;
  credentialKeys?: string[];     // KV keys needed
}

type ScraperCategory = 'utility' | 'court' | 'mortgage' | 'tax' | 'hoa' | 'governance' | 'generic';

interface ScrapeResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  method: 'scrape';
  portal: string;
  scrapedAt: string;
}

interface ScraperModule<TInput = unknown, TOutput = unknown> {
  meta: ScraperMeta;
  execute(browser: Fetcher, env: Env, input: TInput): Promise<ScrapeResult<TOutput>>;
}
```

Existing scrapers (court-docket, cook-county-tax, mr-cooper) get refactored to conform to this interface. New scrapers implement it from day one.

### 2. Scraper Catalog

Auto-registers all scraper modules and exposes them:

```typescript
// src/catalog.ts

class ScraperCatalog {
  private scrapers: Map<string, ScraperModule>;

  register(scraper: ScraperModule): void;
  get(portalId: string): ScraperModule | undefined;
  list(): ScraperMeta[];
  listByCategory(category: ScraperCategory): ScraperMeta[];
}
```

### 3. New Scrapers

| Scraper ID | Category | Input | Output | Auth |
|-----------|----------|-------|--------|------|
| `peoples-gas` | utility | `{ accountNumber }` | Balance, usage history, payment due, billing history | Yes |
| `comed` | utility | `{ accountNumber }` | Balance, kWh usage, payment due, billing history | Yes |
| `court-name-search` | court | `{ name, divisions? }` | Array of case matches: case#, parties, status, court, filing date | No |

**`court-name-search`** searches across ALL Cook County court divisions (civil, criminal, chancery, domestic relations, law, municipal) by party name. Returns all matching cases. This is distinct from the existing `court-docket` scraper which looks up a specific case number.

### 4. API Endpoints

**New endpoints:**

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `POST /api/scrape/:portalId` | POST | Bearer | Generic scrape -- looks up portal in catalog |
| `GET /api/v1/capabilities` | GET | No | Declares all available scrapers for ChittyRouter |
| `GET /api/v1/gaps` | GET | Bearer | Returns reported capability gaps |

**Existing endpoints preserved** (backwards compat):

| Endpoint | Behavior |
|----------|----------|
| `POST /api/scrape/court-docket` | Internally routes to catalog `court-docket` |
| `POST /api/scrape/cook-county-tax` | Internally routes to catalog `cook-county-tax` |
| `POST /api/scrape/mr-cooper` | Internally routes to catalog `mr-cooper` |

### 5. Capabilities Declaration

`GET /api/v1/capabilities` returns:

```json
{
  "service": "chittyscrape",
  "version": "0.2.0",
  "scrapers": [
    { "id": "court-docket", "category": "court", "requiresAuth": false },
    { "id": "cook-county-tax", "category": "tax", "requiresAuth": false },
    { "id": "mr-cooper", "category": "mortgage", "requiresAuth": true },
    { "id": "peoples-gas", "category": "utility", "requiresAuth": true },
    { "id": "comed", "category": "utility", "requiresAuth": true },
    { "id": "court-name-search", "category": "court", "requiresAuth": false }
  ]
}
```

ChittyRouter polls this on startup/periodically to know what ChittyScrape can handle.

### 6. Gap Detection

When `POST /api/scrape/:portalId` receives an unknown portal ID:

```json
{
  "success": false,
  "error": "no_scraper_available",
  "recommendation": {
    "portalId": "hoa-lakeview-towers",
    "action": "build_scraper",
    "category": "hoa"
  }
}
```

Gaps are tracked in `SCRAPE_KV` under `gap:<portalId>` keys with request count and first/last requested timestamps. `GET /api/v1/gaps` returns all tracked gaps so ChittyRouter (or a human) can prioritize which scrapers to build next.

### 7. Claude Chrome Scraper Builder Workflow (Dev-Time)

When a gap is identified, the workflow to build a new scraper:

1. Developer or automation triggers Claude Chrome session
2. Claude navigates to the target portal
3. Claude identifies: login flow, data locations, CSS selectors, page structure
4. Claude generates a new `src/scrapers/<portal-id>.ts` conforming to `ScraperModule`
5. Developer reviews, tests locally with `npm run dev`
6. Deploy via `npm run deploy`

This replaces the need for a complex generic/config-driven scraper -- purpose-built scrapers are more reliable and Claude can generate them quickly.

## File Structure

```
src/
  index.ts                        # Hono app -- generic + legacy routes, capabilities, gaps
  catalog.ts                      # ScraperCatalog class
  scrapers/
    base.ts                       # ScraperModule interface, ScrapeResult, helpers (resolveSelector, etc.)
    court-docket.ts               # Existing -- refactored to ScraperModule
    cook-county-tax.ts            # Existing -- refactored to ScraperModule
    mr-cooper.ts                  # Existing -- refactored to ScraperModule
    peoples-gas.ts                # NEW
    comed.ts                      # NEW
    court-name-search.ts          # NEW
```

## Credential Management

Per-portal keys in `SCRAPE_KV`:

| Key Pattern | Example |
|-------------|---------|
| `<portal>:username` | `peoplesgas:username` |
| `<portal>:password` | `peoplesgas:password` |
| `scrape:service_token` | Auth token for ChittyScrape API |
| `gap:<portalId>` | JSON: `{ count, firstRequested, lastRequested }` |

Credentials injected via 1Password -> KV, never hardcoded.

## Router Contract

ChittyRouter integration points (implemented in ChittyRouter, not here):

1. **Poll capabilities**: `GET scrape.chitty.cc/api/v1/capabilities`
2. **Route scrape requests**: `POST scrape.chitty.cc/api/scrape/:portalId`
3. **Check gaps**: `GET scrape.chitty.cc/api/v1/gaps`
4. **Email-to-portal mapping**: Router parses bill emails, identifies portal, checks capabilities, routes accordingly

## Testing Strategy

- Each scraper module gets a unit test with mocked browser responses
- Integration tests against live sites are manual/periodic (sites change)
- Catalog and gap detection get standard unit tests
- Capabilities endpoint tested for correct output shape

## Version

This enhancement bumps ChittyScrape from `0.1.0` to `0.2.0`.

---

*Design approved 2026-02-24. Next step: implementation plan.*
