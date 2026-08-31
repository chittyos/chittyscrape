import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { ScraperCatalog } from './catalog';
import { renderDashboard } from './frontend';
import { allTargets } from './targets/catalog';

export type Env = {
  BROWSER: Fetcher;
  SCRAPE_KV: KVNamespace;
  ENVIRONMENT?: string;
  CHITTYCONNECT_URL?: string;
  CHITTYCONNECT_TOKEN?: string;
  INGESTION_API_URL?: string;
  CHITTYCONNECT_API_KEY?: string;
  FLRA_USERNAME_REF?: string;
  FLRA_PASSWORD_REF?: string;
  NWRA_USERNAME_REF?: string;
  NWRA_PASSWORD_REF?: string;
  BROWSE_AI_API_KEY_REF?: string;
};

const VERSION = '0.2.0';

/** Only allow alphanumeric + hyphens, max 64 chars for portalId */
const PORTAL_ID_RE = /^[a-z0-9-]{1,64}$/;

// Build the scraper catalog
const catalog = new ScraperCatalog();
allTargets.forEach(target => catalog.register(target));

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
  origin: ['https://command.chitty.cc', 'https://app.command.chitty.cc', 'https://router.chitty.cc', 'https://scrape.chitty.cc'],
  allowHeaders: ['Authorization', 'Content-Type'],
}));

// Dashboard UI
app.get('/', (c) => c.html(renderDashboard()));

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

    // [NEW] The Sensory Splice
    if (result.success !== false && c.env.INGESTION_API_URL) {
      c.executionCtx.waitUntil(
        fetch(c.env.INGESTION_API_URL, {
          method: 'POST',
          headers: { 
            'Authorization': `Bearer ${c.env.CHITTYCONNECT_TOKEN}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            source_entity: `chittyscrape:${portalId}`,
            focal_intensity: (result as any).focal_intensity || 1.0, 
            ttl_days: 30, // Triggers workers/shared/focal-trust.ts exponential decay
            timestamp: new Date().toISOString(),
            payload: result.data || result
          })
        }).catch(err => console.error(`Ledger ingestion failed for ${portalId}:`, err))
      );
    }

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

// Push endpoint for scrapers that cannot run inside this Worker at all --
// currently only court-docket (chittyentity/actors/chittyactor-cook-county-docket).
// Cook County Clerk's F5/Shape WAF blocks every CDP-driven/headless method
// this Worker could otherwise use (Cloudflare Browser Rendering included --
// see that actor's CHARTER.md for the full evidence trail). The only
// verified-working method is a real Safari GUI session on a specific Mac
// (chittymini-01), which stays tailnet-private -- it pushes its
// already-scraped results here instead of this Worker reaching in to pull
// them, so nothing on that host is ever exposed to the public internet.
//
// Reuses the existing /api/* Bearer-token auth (same scrape:service_token)
// and the same "Sensory Splice" ingestion side-effect as the normal
// /api/scrape/:portalId success path, so downstream consumers of a scrape
// success see no difference in how the data arrived.
app.post('/api/scrape/:portalId/submit', async (c) => {
  const portalId = c.req.param('portalId');

  if (!PORTAL_ID_RE.test(portalId)) {
    return c.json({ success: false, error: 'Invalid portal ID format' }, 400);
  }

  const scraper = catalog.get(portalId);
  if (!scraper) {
    return c.json({ success: false, error: 'no_scraper_registered', portalId }, 404);
  }

  let body: { success?: boolean; data?: unknown; error?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: 'Invalid or missing JSON request body' }, 400);
  }

  const result = {
    success: body.success !== false,
    data: body.data,
    error: body.error,
    method: 'scrape' as const,
    portal: portalId,
    scrapedAt: new Date().toISOString(),
  };

  try {
    await c.env.SCRAPE_KV.put(
      `submitted:${portalId}:${result.scrapedAt}`,
      JSON.stringify(result),
      { expirationTtl: 60 * 60 * 24 * 90 }, // 90 days
    );
  } catch (err: any) {
    console.error(`Failed to persist submitted result for ${portalId}: ${err.message}`);
    return c.json({ success: false, error: 'Failed to persist submitted result' }, 500);
  }

  // Same "Sensory Splice" ingestion side-effect as a live scrape success --
  // downstream consumers of the ledger see no difference in how the data
  // arrived.
  if (result.success && c.env.INGESTION_API_URL) {
    c.executionCtx.waitUntil(
      fetch(c.env.INGESTION_API_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${c.env.CHITTYCONNECT_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          source_entity: `chittyscrape:${portalId}:submitted`,
          focal_intensity: 1.0,
          ttl_days: 30,
          timestamp: result.scrapedAt,
          payload: result.data,
        }),
      }).catch(err => console.error(`Ledger ingestion failed for ${portalId} (submitted): ${err}`)),
    );
  }

  return c.json(result);
});

export default { fetch: app.fetch };
