---
uri: chittycanon://docs/ops/summary/chittyscrape
namespace: chittycanon://docs/ops
type: summary
version: 1.1.0
status: DRAFT
registered_with: chittycanon://core/services/canon
title: "ChittyScrape"
certifier: chittycanon://core/services/chittycertify
visibility: PUBLIC
---

# ChittyScrape

> `chittycanon://core/services/chittyscrape` | Tier 3 (Service Layer) | scrape.chitty.cc

## What It Does

Stateless browser automation service that scrapes portals lacking APIs — court dockets, property tax sites, utility portals, mortgage servicers — and returns structured JSON to calling services. Catalog-driven architecture: scrapers self-register and are discoverable via capabilities endpoint.

## Architecture

Cloudflare Worker at scrape.chitty.cc with Browser Rendering binding for headless Puppeteer sessions. Catalog-driven generic route (`POST /api/scrape/:portalId`) with per-scraper `ScraperModule` implementations. Authenticated via Bearer token from KV.

### Stack
- **Runtime**: Cloudflare Workers + Hono
- **Browser**: Cloudflare Browser Rendering (`@cloudflare/puppeteer`)
- **Auth**: Bearer token from KV (`SCRAPE_KV`)
- **Credentials**: Per-portal logins stored in KV
- **Pattern**: Catalog-driven `ScraperModule` interface (`meta` + `execute()`)

### Scrape Targets
| Portal ID | Target | Input |
|-----------|--------|-------|
| `court-docket` | Cook County Circuit Clerk | `{ caseNumber }` |
| `cook-county-tax` | Cook County Treasurer | `{ pin }` |
| `mr-cooper` | Mr. Cooper mortgage portal | `{ property }` |
| `peoples-gas` | Peoples Gas utility portal | `{ accountNumber }` |
| `comed` | ComEd utility portal | `{ accountNumber }` |
| `court-name-search` | Cook County courts (by name) | `{ name, divisions? }` |

## Three Aspects (TY VY RY)

Source: `chittycanon://gov/governance#three-aspects`

| Aspect | Abbrev | Answer |
|--------|--------|--------|
| **Identity** | TY | Stateless browser automation service — scrapes portals without APIs and returns structured JSON to calling services |
| **Connectivity** | VY | Cloudflare Browser Rendering for headless sessions; catalog-driven `POST /api/scrape/:portalId` endpoint; capabilities discovery for ChittyRouter; called by ChittyCommand and ChittyRouter |
| **Authority** | RY | Tier 3 Service — execution layer only, no data persistence; caller (ChittyCommand) owns scheduling, storage, and orchestration |

## ChittyOS Ecosystem

### Certification
- **Badge**: --
- **Certifier**: ChittyCertify (`chittycanon://core/services/chittycertify`)
- **Last Certified**: --

### ChittyDNA
- **ChittyID**: --
- **DNA Hash**: --
- **Lineage**: root (browser automation)

### Dependencies
| Service | Purpose |
|---------|---------|
| ChittyCommand | Primary caller via bridge routes and cron |
| ChittyRouter | Routes data requests, discovers capabilities |
| Cloudflare Browser Rendering | Headless browser instances |
| Cloudflare KV | Service token and scrape credentials |

### Endpoints
| Path | Method | Auth | Purpose |
|------|--------|------|---------|
| `/health` | GET | No | Health check |
| `/api/v1/status` | GET | No | Service metadata |
| `/api/v1/capabilities` | GET | No | Scraper capability declaration for ChittyRouter |
| `/api/v1/gaps` | GET | Bearer | Reported capability gaps |
| `/api/scrape/:portalId` | POST | Bearer | Generic scrape (catalog lookup) |
| `/api/scrape/court-docket` | POST | Bearer | Scrape Cook County court docket |
| `/api/scrape/cook-county-tax` | POST | Bearer | Scrape Cook County property tax |
| `/api/scrape/mr-cooper` | POST | Bearer | Scrape Mr. Cooper mortgage portal |
| `/api/scrape/peoples-gas` | POST | Bearer | Scrape Peoples Gas utility portal |
| `/api/scrape/comed` | POST | Bearer | Scrape ComEd utility portal |
| `/api/scrape/court-name-search` | POST | Bearer | Search Cook County courts by party name |

## Document Triad

This badge is part of a synchronized documentation triad. Changes to shared fields must propagate.

| Field | Canonical Source | Also In |
|-------|-----------------|---------|
| Canonical URI | CHARTER.md (Classification) | CHITTY.md (blockquote) |
| Tier | CHARTER.md (Classification) | CHITTY.md (blockquote) |
| Domain | CHARTER.md (Classification) | CHITTY.md (blockquote), CLAUDE.md (header) |
| Endpoints | CHARTER.md (API Contract) | CHITTY.md (Endpoints table), CLAUDE.md (API section) |
| Dependencies | CHARTER.md (Dependencies) | CHITTY.md (Dependencies table), CLAUDE.md (Architecture) |
| Certification badge | CHITTY.md (Certification) | CHARTER.md frontmatter `status` |

**Related docs**: [CHARTER.md](CHARTER.md) (charter/policy) | [CLAUDE.md](CLAUDE.md) (developer guide)
