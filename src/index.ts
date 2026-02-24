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

/** Only allow alphanumeric + hyphens, max 64 chars for portalId */
const PORTAL_ID_RE = /^[a-z0-9-]{1,64}$/;

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

// Global error handler -- structured JSON for all unhandled errors
app.onError((err, c) => {
  console.error(`Unhandled error: ${err.message}`, err.stack);
  return c.json({ success: false, error: `Internal error: ${err.message}` }, 500);
});

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

  let valid: string | null;
  try {
    valid = await c.env.SCRAPE_KV.get('scrape:service_token');
  } catch (err: any) {
    console.error(`Failed to read service token from KV: ${err.message}`);
    return c.json({ error: 'Authentication service unavailable' }, 503);
  }
  if (!valid) {
    console.error('scrape:service_token not found in SCRAPE_KV');
    return c.json({ error: 'Authentication service unavailable' }, 503);
  }
  if (!timingSafeEqual(token, valid)) return c.json({ error: 'Invalid token' }, 403);
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
  let malformedCount = 0;
  const gapList = await c.env.SCRAPE_KV.list({ prefix: 'gap:' });
  for (const key of gapList.keys) {
    const raw = await c.env.SCRAPE_KV.get(key.name);
    if (raw) {
      try {
        const gap = JSON.parse(raw);
        if (typeof gap.count !== 'number' || !gap.firstRequested || !gap.lastRequested) {
          malformedCount++;
          console.error(`Malformed gap record: key=${key.name}`);
          continue;
        }
        gaps.push({ portalId: key.name.replace('gap:', ''), ...gap });
      } catch (err) {
        malformedCount++;
        console.error(`Failed to parse gap record: key=${key.name}, error=${err}`);
      }
    }
  }
  return c.json({ gaps, ...(malformedCount > 0 ? { malformedCount } : {}) });
});

// Generic scrape route -- looks up portal in catalog
app.post('/api/scrape/:portalId', async (c) => {
  const portalId = c.req.param('portalId');

  // Validate portalId format to prevent KV namespace pollution
  if (!PORTAL_ID_RE.test(portalId)) {
    return c.json({ success: false, error: 'Invalid portal ID format' }, 400);
  }

  const scraper = catalog.get(portalId);

  if (!scraper) {
    // Track the gap -- wrapped in try-catch so KV failures don't prevent the 404 response
    try {
      const gapKey = `gap:${portalId}`;
      const existing = await c.env.SCRAPE_KV.get(gapKey);
      const now = new Date().toISOString();
      let gapData: { count: number; firstRequested: string; lastRequested: string };
      if (existing) {
        try {
          const parsed = JSON.parse(existing);
          const prevCount = typeof parsed.count === 'number' ? parsed.count : 0;
          const prevFirst = typeof parsed.firstRequested === 'string' ? parsed.firstRequested : now;
          gapData = { count: prevCount + 1, firstRequested: prevFirst, lastRequested: now };
        } catch (err) {
          console.error(`Corrupted gap record for gap:${portalId}, resetting: ${err}`);
          gapData = { count: 1, firstRequested: now, lastRequested: now };
        }
      } else {
        gapData = { count: 1, firstRequested: now, lastRequested: now };
      }
      await c.env.SCRAPE_KV.put(gapKey, JSON.stringify(gapData));
    } catch (err) {
      console.error(`Failed to track gap for ${portalId}: ${err}`);
    }

    return c.json({
      success: false,
      error: 'no_scraper_available',
      recommendation: { portalId, action: 'build_scraper' },
    }, 404);
  }

  // Parse request body
  let input: unknown;
  try {
    input = await c.req.json();
  } catch {
    return c.json({ success: false, error: 'Invalid or missing JSON request body' }, 400);
  }

  // Execute scraper
  try {
    const result = await scraper.execute(c.env.BROWSER, c.env, input);
    return c.json(result);
  } catch (err: any) {
    console.error(`Scraper ${portalId} threw unhandled error: ${err.message}`, err.stack);
    return c.json({
      success: false,
      error: `Scraper execution failed: ${err.message}`,
      method: 'scrape',
      portal: portalId,
      scrapedAt: new Date().toISOString(),
    }, 500);
  }
});

export default { fetch: app.fetch };
