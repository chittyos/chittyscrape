---
uri: chittycanon://docs/ops/summary/chittyscrape
namespace: chittycanon://docs/ops
type: summary
version: 1.0.0
status: DRAFT
registered_with: chittycanon://core/services/canon
title: "ChittyScrape"
visibility: PUBLIC
---

# ChittyScrape

> `chittycanon://core/services/chittyscrape` | Tier 3 (Service Layer) | scrape.chitty.cc

## What It Does

Stateless browser automation service that scrapes portals lacking APIs — court dockets, property tax sites, mortgage servicer portals — and returns structured JSON to calling services.

## How It Works

Cloudflare Worker deployed at scrape.chitty.cc with Browser Rendering binding for headless Puppeteer sessions. Authenticated via Bearer token from KV. Called by ChittyCommand via bridge routes and cron schedules.
