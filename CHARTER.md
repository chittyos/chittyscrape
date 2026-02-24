---
uri: chittycanon://docs/ops/policy/chittyscrape-charter
namespace: chittycanon://docs/ops
type: policy
version: 1.1.0
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
- Authenticated portal scraping (Mr. Cooper mortgage, Peoples Gas, ComEd)
- Court name search across all Cook County divisions
- Returning structured, typed JSON results from scrape operations
- Managing scrape-specific credentials in KV
- Declaring scraper capabilities for ChittyRouter discovery
- Tracking capability gaps for unknown portal requests

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
| Upstream | ChittyRouter | Routes data requests, discovers capabilities |
| Platform | Cloudflare Browser Rendering | Headless browser instances |
| Storage | Cloudflare KV | Service token and scrape credentials |

## API Contract

**Base URL**: https://scrape.chitty.cc

### Core Endpoints
| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/health` | GET | No | Health check |
| `/api/v1/status` | GET | No | Service metadata |
| `/api/v1/capabilities` | GET | No | Scraper capability declaration for ChittyRouter |
| `/api/v1/gaps` | GET | Bearer | Reported capability gaps |
| `/api/scrape/:portalId` | POST | Bearer | Generic scrape -- catalog lookup |
| `/api/scrape/court-docket` | POST | Bearer | Scrape Cook County court docket |
| `/api/scrape/cook-county-tax` | POST | Bearer | Scrape Cook County property tax |
| `/api/scrape/mr-cooper` | POST | Bearer | Scrape Mr. Cooper mortgage portal |
| `/api/scrape/peoples-gas` | POST | Bearer | Scrape Peoples Gas utility portal |
| `/api/scrape/comed` | POST | Bearer | Scrape ComEd utility portal |
| `/api/scrape/court-name-search` | POST | Bearer | Search Cook County courts by party name |

### Response Shape
All scrape endpoints return: `{ success: boolean; data?: T; error?: string; method: 'scrape'; portal: string; scrapedAt: string }`

## Ownership

| Role | Owner |
|------|-------|
| Service Owner | ChittyOS |
| Technical Lead | @chittyos-infrastructure |
| Contact | chittyscrape@chitty.cc |

## Three Aspects (TY VY RY)

Source: `chittycanon://gov/governance#three-aspects`

| Aspect | Abbrev | Question | ChittyScrape Answer |
|--------|--------|----------|--------------------|
| **Identity** | TY | What IS it? | Stateless browser automation service — scrapes portals without APIs and returns structured JSON to calling services |
| **Connectivity** | VY | How does it ACT? | Cloudflare Browser Rendering for headless sessions; catalog-driven POST /api/scrape/:portalId endpoint; capabilities discovery for ChittyRouter; called by ChittyCommand and ChittyRouter |
| **Authority** | RY | Where does it SIT? | Tier 3 Service — execution layer only, no data persistence; caller (ChittyCommand) owns scheduling, storage, and orchestration |

## Document Triad

This charter is part of a synchronized documentation triad. Changes to shared fields must propagate.

| Field | Canonical Source | Also In |
|-------|-----------------|---------|
| Canonical URI | CHARTER.md (Classification) | CHITTY.md (blockquote) |
| Tier | CHARTER.md (Classification) | CHITTY.md (blockquote) |
| Domain | CHARTER.md (Classification) | CHITTY.md (blockquote), CLAUDE.md (header) |
| Endpoints | CHARTER.md (API Contract) | CHITTY.md (Endpoints table), CLAUDE.md (API section) |
| Dependencies | CHARTER.md (Dependencies) | CHITTY.md (Dependencies table), CLAUDE.md (Architecture) |
| Certification badge | CHITTY.md (Certification) | CHARTER.md frontmatter `status` |

**Related docs**: [CHITTY.md](CHITTY.md) (badge/one-pager) | [CLAUDE.md](CLAUDE.md) (developer guide)

## Compliance

- [ ] Service registered in ChittyRegistry
- [x] Health endpoint operational at /health
- [x] CLAUDE.md development guide present
- [x] CHARTER.md present
- [x] CHITTY.md present

---
*Charter Version: 1.1.0 | Last Updated: 2026-02-24*
