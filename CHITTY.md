---
uri: chittycanon://docs/ops/summary/chittyscrape
namespace: chittycanon://docs/ops
type: summary
version: 1.0.0
status: DRAFT
registered_with: chittycanon://core/services/canon
title: "ChittyScrape"
certifier: chittycanon://core/services/chittycertify
visibility: PUBLIC
---

# ChittyScrape

> `chittycanon://core/services/chittyscrape` | Tier 3 (Service Layer) | scrape.chitty.cc

## What It Does

Stateless browser automation service that scrapes portals lacking APIs — court dockets, property tax sites, mortgage servicer portals — and returns structured JSON to calling services.

## Architecture

Cloudflare Worker deployed at scrape.chitty.cc with Browser Rendering binding for headless Puppeteer sessions. Authenticated via Bearer token from KV. Called by ChittyCommand via bridge routes and cron schedules.

### Stack
- **Runtime**: Cloudflare Workers + Hono
- **Browser**: Cloudflare Browser Rendering (`@cloudflare/puppeteer`)
- **Auth**: Bearer token from KV (`SCRAPE_KV`)
- **Credentials**: Portal logins stored in KV

### Scrape Targets
| Target | Endpoint | Input |
|--------|----------|-------|
| Cook County Circuit Clerk | `POST /api/scrape/court-docket` | `{ caseNumber }` |
| Cook County Treasurer | `POST /api/scrape/cook-county-tax` | `{ pin }` |
| Mr. Cooper Mortgage | `POST /api/scrape/mr-cooper` | `{ property }` |

## Three Aspects (TY VY RY)

Source: `chittycanon://gov/governance#three-aspects`

| Aspect | Abbrev | Answer |
|--------|--------|--------|
| **Identity** | TY | Stateless browser automation service — scrapes portals without APIs and returns structured JSON to calling services |
| **Connectivity** | VY | Cloudflare Browser Rendering for headless sessions; POST endpoints per scrape target (court dockets, property tax, mortgage); called by ChittyCommand via bridge routes and cron |
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
| Cloudflare Browser Rendering | Headless browser instances |
| Cloudflare KV | Service token and scrape credentials |

### Endpoints
| Path | Method | Auth | Purpose |
|------|--------|------|---------|
| `/health` | GET | No | Health check |
| `/api/v1/status` | GET | No | Service metadata |
| `/api/scrape/court-docket` | POST | Bearer | Scrape Cook County court docket |
| `/api/scrape/cook-county-tax` | POST | Bearer | Scrape Cook County property tax |
| `/api/scrape/mr-cooper` | POST | Bearer | Scrape Mr. Cooper mortgage portal |

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
