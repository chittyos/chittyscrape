---
uri: chittycanon://docs/ops/policy/chittyscrape-charter
namespace: chittycanon://docs/ops
type: policy
version: 1.0.0
status: DRAFT
registered_with: chittycanon://core/services/canon
title: "ChittyScrape Charter"
certifier: chittycanon://core/services/chittycertify
visibility: PUBLIC
---

# ChittyScrape Charter

## Classification
- **Canonical URI**: `chittycanon://core/services/chittyscrape`
- **Tier**: 3 (Service Layer)
- **Organization**: CHITTYOS
- **Domain**: scrape.chitty.cc

## Mission

Provide stateless browser automation for the ChittyOS ecosystem, scraping portals that lack APIs and returning structured JSON to calling services.

## Scope

### IS Responsible For
- Browser-based scraping of court docket systems (Cook County Circuit Clerk)
- Browser-based scraping of property tax portals (Cook County Treasurer)
- Authenticated portal scraping (Mr. Cooper mortgage)
- Returning structured, typed JSON results from scrape operations
- Managing scrape-specific credentials in KV

### IS NOT Responsible For
- Identity generation (ChittyID)
- Token provisioning (ChittyAuth)
- Service registration (ChittyRegister)
- Data persistence or storage (caller handles that)
- Scheduling or orchestration (ChittyCommand cron handles that)

## Dependencies

| Type | Service | Purpose |
|------|---------|---------|
| Upstream | ChittyCommand | Primary caller via bridge routes and cron |
| Platform | Cloudflare Browser Rendering | Headless browser instances |
| Storage | Cloudflare KV | Service token and scrape credentials |

## API Contract

**Base URL**: https://scrape.chitty.cc

### Core Endpoints
| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/health` | GET | No | Health check |
| `/api/v1/status` | GET | No | Service metadata |
| `/api/scrape/court-docket` | POST | Bearer | Scrape Cook County court docket |
| `/api/scrape/cook-county-tax` | POST | Bearer | Scrape Cook County property tax |
| `/api/scrape/mr-cooper` | POST | Bearer | Scrape Mr. Cooper mortgage portal |

### Response Shape
All scrape endpoints return: `{ success: boolean; data?: T; error?: string }`

## Ownership

| Role | Owner |
|------|-------|
| Service Owner | ChittyOS |
| Technical Lead | @chittyos-infrastructure |
| Contact | chittyscrape@chitty.cc |

## Compliance

- [ ] Service registered in ChittyRegistry
- [x] Health endpoint operational at /health
- [x] CLAUDE.md development guide present
- [x] CHARTER.md present
- [x] CHITTY.md present

---
*Charter Version: 1.0.0 | Last Updated: 2026-02-23*
