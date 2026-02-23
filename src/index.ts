import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { scrapeCookCountyDocket } from './scrapers/court-docket';

export type Env = {
  BROWSER: Fetcher;
  SCRAPE_KV: KVNamespace;
};

const app = new Hono<{ Bindings: Env }>();

// CORS
app.use('*', cors({
  origin: ['https://command.chitty.cc', 'https://app.command.chitty.cc'],
  allowHeaders: ['Authorization', 'Content-Type'],
}));

// Auth middleware — service token from KV
app.use('/api/*', async (c, next) => {
  const auth = c.req.header('Authorization');
  if (!auth?.startsWith('Bearer ')) return c.json({ error: 'Auth required' }, 401);
  const token = auth.slice(7);
  const valid = await c.env.SCRAPE_KV.get('scrape:service_token');
  if (!valid || token !== valid) return c.json({ error: 'Invalid token' }, 403);
  return next();
});

// Health (unauthenticated)
app.get('/health', (c) => c.json({
  status: 'ok',
  service: 'chittyscrape',
  version: '0.1.0',
  timestamp: new Date().toISOString(),
}));

// Court docket scraper
app.post('/api/scrape/court-docket', async (c) => {
  const { caseNumber } = await c.req.json<{ caseNumber: string }>();
  if (!caseNumber) return c.json({ error: 'caseNumber required' }, 400);

  const result = await scrapeCookCountyDocket(c.env.BROWSER, caseNumber);
  return c.json(result);
});

// Scraper routes will be added in subsequent tasks
// POST /api/scrape/cook-county-tax
// POST /api/scrape/mr-cooper

export default { fetch: app.fetch };
