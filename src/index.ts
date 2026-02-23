import { Hono } from 'hono';
import { cors } from 'hono/cors';

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

// Scraper routes will be added in subsequent tasks
// POST /api/scrape/court-docket
// POST /api/scrape/cook-county-tax
// POST /api/scrape/mr-cooper

export default { fetch: app.fetch };
