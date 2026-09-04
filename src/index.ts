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
// Portals allowed to push results here, instead of this Worker scraping them
// itself. The shared /api/* Bearer token authenticates ANY caller for ANY
// portal -- without this allowlist, a valid token could submit forged data
// under a portalId it has no business touching (e.g. push fabricated
// property-tax records while only ever having been meant to push
// court-docket ones). Add a portal here only when its scraper genuinely
// cannot run inside this Worker (see chittyactor-cook-county-docket's
// CHARTER.md for why court-docket is the first entry) -- this is not a
// rubber-stamp list.
const SUBMIT_ALLOWED_PORTALS = new Set(['court-docket']);

/** caseId is a KV-key segment (case number or a caller-supplied label) -- keep it narrow. */
const CASE_ID_RE = /^[A-Za-z0-9._-]{1,128}$/;

/**
 * Derive the case-scoped identifier a submitted result is keyed and later
 * looked up by. Prefers the real court case number the scraper itself
 * resolved (`data.case_number`, e.g. "2024D007847") over a caller-supplied
 * `caseId` (used for not-found results, or callers searching by company
 * name whose case number wasn't resolved) -- the real case number is the
 * more canonical, generically-queryable identifier, and any case pushed
 * here (not just the ones this endpoint was first built for) gets keyed
 * the same way, so /latest works for any case without special-casing.
 */
function deriveCaseId(body: { data?: unknown; caseId?: unknown }): string | null {
  const fromData = body.data && typeof body.data === 'object' ? (body.data as any).case_number : undefined;
  const candidate = (typeof fromData === 'string' && fromData) || (typeof body.caseId === 'string' && body.caseId) || null;
  return candidate && CASE_ID_RE.test(candidate) ? candidate : null;
}

app.post('/api/scrape/:portalId/submit', async (c) => {
  const portalId = c.req.param('portalId');

  if (!PORTAL_ID_RE.test(portalId)) {
    return c.json({ success: false, error: 'Invalid portal ID format' }, 400);
  }

  if (!SUBMIT_ALLOWED_PORTALS.has(portalId)) {
    return c.json({ success: false, error: 'portal_not_submittable', portalId }, 403);
  }

  const scraper = catalog.get(portalId);
  if (!scraper) {
    return c.json({ success: false, error: 'no_scraper_registered', portalId }, 404);
  }

  let body: { success?: boolean; data?: unknown; error?: string; caseId?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: 'Invalid or missing JSON request body' }, 400);
  }

  const caseId = deriveCaseId(body);
  if (!caseId) {
    return c.json({ success: false, error: 'Missing or invalid case identifier (data.case_number or caseId)' }, 400);
  }

  const result = {
    success: body.success !== false,
    data: body.data,
    error: body.error,
    method: 'scrape' as const,
    portal: portalId,
    caseId,
    scrapedAt: new Date().toISOString(),
  };

  try {
    // Case-scoped key so /latest can look up any case's most recent result
    // by prefix -- not just the case(s) this portal was first wired for.
    await c.env.SCRAPE_KV.put(
      `submitted:${portalId}:${caseId}:${result.scrapedAt}`,
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

// Generic read-back for submitted results -- ?case=<caseNumber-or-caseId> is
// required so this works for ANY case pushed via /submit, not just whichever
// case(s) prompted this endpoint to be built. Consumers that used to POST
// /api/scrape/:portalId (a live synchronous scrape, which court-docket can
// never satisfy -- see the /submit route's comment for why) should GET this
// instead once their portal only ever arrives via /submit.
app.get('/api/scrape/:portalId/latest', async (c) => {
  const portalId = c.req.param('portalId');

  if (!PORTAL_ID_RE.test(portalId)) {
    return c.json({ success: false, error: 'Invalid portal ID format' }, 400);
  }
  if (!SUBMIT_ALLOWED_PORTALS.has(portalId)) {
    return c.json({ success: false, error: 'portal_not_submittable', portalId }, 403);
  }

  const caseId = c.req.query('case');
  if (!caseId || !CASE_ID_RE.test(caseId)) {
    return c.json({ success: false, error: 'Missing or invalid ?case query param' }, 400);
  }

  const prefix = `submitted:${portalId}:${caseId}:`;
  let keys: { name: string }[];
  try {
    // ISO-8601 timestamps sort lexicographically, so the last key in KV's
    // (lexicographically ascending) listing is the most recent result.
    const list = await c.env.SCRAPE_KV.list({ prefix });
    keys = list.keys;
  } catch (err: any) {
    console.error(`Failed to list submitted results for ${portalId}/${caseId}: ${err.message}`);
    return c.json({ success: false, error: 'Failed to list submitted results' }, 500);
  }

  if (keys.length === 0) {
    return c.json({ success: false, error: 'no_submitted_result', portalId, caseId }, 404);
  }

  const latestKey = keys[keys.length - 1].name;
  let raw: string | null;
  try {
    raw = await c.env.SCRAPE_KV.get(latestKey);
  } catch (err: any) {
    console.error(`Failed to read ${latestKey}: ${err.message}`);
    return c.json({ success: false, error: 'Failed to read submitted result' }, 500);
  }
  if (!raw) {
    return c.json({ success: false, error: 'no_submitted_result', portalId, caseId }, 404);
  }

  try {
    return c.json(JSON.parse(raw));
  } catch (err: any) {
    console.error(`Corrupted submitted result at ${latestKey}: ${err.message}`);
    return c.json({ success: false, error: 'Corrupted submitted result' }, 500);
  }
});

export default { fetch: app.fetch };
