import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { scrapeCookCountyDocket } from './scrapers/court-docket';
import { scrapeCookCountyTax } from './scrapers/cook-county-tax';
import { scrapeMrCooper } from './scrapers/mr-cooper';

export type Env = {
  BROWSER: Fetcher;
  SCRAPE_KV: KVNamespace;
  ENVIRONMENT?: string;
};

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
  origin: ['https://command.chitty.cc', 'https://app.command.chitty.cc'],
  allowHeaders: ['Authorization', 'Content-Type'],
}));

// Auth middleware — service token from KV (timing-safe comparison)
app.use('/api/*', async (c, next) => {
  // Skip auth for status endpoint
  if (c.req.path === '/api/v1/status') return next();

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
  version: '0.1.0',
  timestamp: new Date().toISOString(),
}));

// Service status (unauthenticated) — ChittyOS standard
app.get('/api/v1/status', (c) => c.json({
  name: 'ChittyScrape',
  version: '0.1.0',
  environment: c.env.ENVIRONMENT || 'production',
  canonicalUri: 'chittycanon://core/services/chittyscrape',
  tier: 3,
}));

// Court docket scraper
app.post('/api/scrape/court-docket', async (c) => {
  const { caseNumber } = await c.req.json<{ caseNumber: string }>();
  if (!caseNumber) return c.json({ error: 'caseNumber required' }, 400);

  const result = await scrapeCookCountyDocket(c.env.BROWSER, caseNumber);
  return c.json(result);
});

// Cook County property tax scraper
app.post('/api/scrape/cook-county-tax', async (c) => {
  const { pin } = await c.req.json<{ pin: string }>();
  if (!pin) return c.json({ error: 'pin required' }, 400);

  const result = await scrapeCookCountyTax(c.env.BROWSER, pin);
  return c.json(result);
});

// Mr. Cooper mortgage portal scraper
app.post('/api/scrape/mr-cooper', async (c) => {
  const { property } = await c.req.json<{ property: string }>();
  if (!property) return c.json({ error: 'property required' }, 400);

  // Get credentials from KV
  const username = await c.env.SCRAPE_KV.get('mrcooper:username');
  const password = await c.env.SCRAPE_KV.get('mrcooper:password');
  if (!username || !password) return c.json({ error: 'Mr. Cooper credentials not configured' }, 503);

  const result = await scrapeMrCooper(c.env.BROWSER, { username, password }, property);
  return c.json(result);
});

export default { fetch: app.fetch };
