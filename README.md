![ChittyOS](https://img.shields.io/badge/ChittyOS-service-6366F1?style=flat-square)
![Tier](https://img.shields.io/badge/tier-3%20operational-3730A3?style=flat-square)

# ChittyScrape

> Stateless browser automation for portals that lack APIs.

ChittyScrape uses Cloudflare Browser Rendering to scrape court dockets, property tax portals, mortgage servicers, utility providers, HOA portals, and Google Drive, returning structured JSON to callers. It is purely a service layer — no data persistence, no scheduling — those responsibilities belong to ChittyCommand and ChittyRouter. New scrapers are registered in a catalog and automatically reachable via `POST /api/scrape/:portalId`.

**Domain**: `scrape.chitty.cc`
