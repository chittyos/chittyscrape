import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { ScraperCatalog } from './catalog';
import { courtDocketScraper } from './scrapers/court-docket';
import { cookCountyTaxScraper } from './scrapers/cook-county-tax';
import { mrCooperScraper } from './scrapers/mr-cooper';
import { peoplesGasScraper } from './scrapers/peoples-gas';
import { comedScraper } from './scrapers/comed';
import { courtNameSearchScraper } from './scrapers/court-name-search';

export type Env = {
  BROWSER: Fetcher;
  SCRAPE_KV: KVNamespace;
  ENVIRONMENT?: string;
};

const VERSION = '0.2.0';

// Build the scraper catalog
const catalog = new ScraperCatalog();
catalog.register(courtDocketScraper);
catalog.register(cookCountyTaxScraper);
catalog.register(mrCooperScraper);
catalog.register(peoplesGasScraper);
catalog.register(comedScraper);
catalog.register(courtNameSearchScraper);

/** Timing-safe string comparison to prevent timing attacks on token validation */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const encoder = new TextEncoder();
  const bufA = encoder.encode(a);
  const bufB = encoder.encode(b);
  return crypto.subtle.timingSafeEqual(bufA, bufB);
}

const app = new Hono<{ Bindings: Env }>();

// CORS
app.use('*', cors({
  origin: ['https://command.chitty.cc', 'https://app.command.chitty.cc', 'https://router.chitty.cc'],
  allowHeaders: ['Authorization', 'Content-Type'],
}));

// Auth middleware -- service token from KV (timing-safe comparison)
app.use('/api/*', async (c, next) => {
  // Skip auth for unauthenticated endpoints
  const unauthPaths = ['/api/v1/status', '/api/v1/capabilities'];
  if (unauthPaths.includes(c.req.path)) return next();

  const auth = c.req.header('Authorization');
  if (!auth?.startsWith('Bearer ')) return c.json({ error: 'Auth required' }, 401);
  const token = auth.slice(7);
  const valid = await c.env.SCRAPE_KV.get('scrape:service_token');
  if (!valid || !timingSafeEqual(token, valid)) return c.json({ error: 'Invalid token' }, 403);
  return next();
});

// Health (unauthenticated)
app.get('/health', (c) => c.json({
  status: 'ok',
  service: 'chittyscrape',
  version: VERSION,
  timestamp: new Date().toISOString(),
}));

// Service status (unauthenticated)
app.get('/api/v1/status', (c) => c.json({
  name: 'ChittyScrape',
  version: VERSION,
  environment: c.env.ENVIRONMENT || 'production',
  canonicalUri: 'chittycanon://core/services/chittyscrape',
  tier: 3,
}));

// Capabilities (unauthenticated) -- ChittyRouter discovery
app.get('/api/v1/capabilities', (c) => c.json({
  service: 'chittyscrape',
  version: VERSION,
  scrapers: catalog.list(),
}));

// Gaps (authenticated) -- list reported capability gaps
app.get('/api/v1/gaps', async (c) => {
  const gaps: Array<{ portalId: string; count: number; firstRequested: string; lastRequested: string }> = [];
  const gapList = await c.env.SCRAPE_KV.list({ prefix: 'gap:' });
  for (const key of gapList.keys) {
    const raw = await c.env.SCRAPE_KV.get(key.name);
    if (raw) {
      try {
        const gap = JSON.parse(raw);
        gaps.push({ portalId: key.name.replace('gap:', ''), ...gap });
      } catch { /* skip malformed */ }
    }
  }
  return c.json({ gaps });
});

// Generic scrape route -- looks up portal in catalog
app.post('/api/scrape/:portalId', async (c) => {
  const portalId = c.req.param('portalId');
  const scraper = catalog.get(portalId);

  if (!scraper) {
    // Track the gap
    const gapKey = `gap:${portalId}`;
    const existing = await c.env.SCRAPE_KV.get(gapKey);
    const now = new Date().toISOString();
    let gapData: { count: number; firstRequested: string; lastRequested: string };
    if (existing) {
      try {
        const parsed = JSON.parse(existing);
        gapData = { count: parsed.count + 1, firstRequested: parsed.firstRequested, lastRequested: now };
      } catch {
        gapData = { count: 1, firstRequested: now, lastRequested: now };
      }
    } else {
      gapData = { count: 1, firstRequested: now, lastRequested: now };
    }
    await c.env.SCRAPE_KV.put(gapKey, JSON.stringify(gapData));

    return c.json({
      success: false,
      error: 'no_scraper_available',
      recommendation: {
        portalId,
        action: 'build_scraper',
      },
    }, 404);
  }

  const input = await c.req.json();
  const result = await scraper.execute(c.env.BROWSER, c.env, input);
  return c.json(result);
});

export default { fetch: app.fetch };
