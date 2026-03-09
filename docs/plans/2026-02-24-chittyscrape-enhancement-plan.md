# ChittyScrape Enhancement Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform ChittyScrape from 3 hardcoded scrapers into a catalog-driven scraping engine with capabilities declaration, gap detection, and new scrapers for utilities and court name search.

**Architecture:** Scraper Registry pattern -- each scraper conforms to a `ScraperModule` interface, registered in a `ScraperCatalog`. New generic `POST /api/scrape/:portalId` endpoint looks up the catalog. Capabilities endpoint lets ChittyRouter discover what ChittyScrape can handle. Gap detection tracks unknown portal requests in KV.

**Tech Stack:** Hono (TypeScript), @cloudflare/puppeteer, Cloudflare Workers, KV, vitest for testing.

**Design doc:** `docs/plans/2026-02-24-chittyscrape-enhancement-design.md`

---

## Task 1: Add test infrastructure

No tests exist yet. Add vitest with Cloudflare Workers miniflare environment.

**Files:**
- Modify: `package.json` (add vitest + scripts)
- Modify: `tsconfig.json` (add test include path)
- Create: `vitest.config.ts`
- Create: `test/catalog.test.ts` (placeholder -- proves vitest works)

**Step 1: Install vitest**

Run:
```bash
npm install -D vitest @cloudflare/vitest-pool-workers
```

**Step 2: Create vitest config**

Create `vitest.config.ts`:
```typescript
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.toml' },
      },
    },
  },
});
```

**Step 3: Add test script to package.json**

Add to `"scripts"`:
```json
"test": "vitest run",
"test:watch": "vitest"
```

**Step 4: Update tsconfig to include tests**

Change `"include": ["src"]` to `"include": ["src", "test"]`.

**Step 5: Create smoke test**

Create `test/catalog.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';

describe('smoke test', () => {
  it('vitest runs', () => {
    expect(1 + 1).toBe(2);
  });
});
```

**Step 6: Run test to verify it passes**

Run: `npm test`
Expected: 1 test passes.

**Step 7: Commit**

```bash
git add vitest.config.ts test/catalog.test.ts package.json package-lock.json tsconfig.json
git commit -m "chore: add vitest test infrastructure"
```

---

## Task 2: Create base types and helpers (`src/scrapers/base.ts`)

Extract the shared `ScraperModule` interface, `ScrapeResult` type, `ScraperMeta`, `ScraperCategory`, and the `resolveSelector` helper (currently duplicated in mr-cooper.ts).

**Files:**
- Create: `src/scrapers/base.ts`
- Create: `test/base.test.ts`

**Step 1: Write the failing test**

Create `test/base.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { wrapResult } from '../src/scrapers/base';

describe('wrapResult', () => {
  it('creates a success result with portal and timestamp', () => {
    const result = wrapResult('test-portal', true, { balance: 100 });
    expect(result.success).toBe(true);
    expect(result.portal).toBe('test-portal');
    expect(result.method).toBe('scrape');
    expect(result.data).toEqual({ balance: 100 });
    expect(result.scrapedAt).toBeDefined();
    expect(result.error).toBeUndefined();
  });

  it('creates a failure result with error', () => {
    const result = wrapResult('test-portal', false, undefined, 'something broke');
    expect(result.success).toBe(false);
    expect(result.error).toBe('something broke');
    expect(result.data).toBeUndefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL -- `wrapResult` not defined.

**Step 3: Write the implementation**

Create `src/scrapers/base.ts`:
```typescript
import type { Env } from '../index';

export type ScraperCategory = 'utility' | 'court' | 'mortgage' | 'tax' | 'hoa' | 'governance' | 'generic';

export interface ScraperMeta {
  id: string;
  name: string;
  category: ScraperCategory;
  version: string;
  requiresAuth: boolean;
  credentialKeys?: string[];
}

export interface ScrapeResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  method: 'scrape';
  portal: string;
  scrapedAt: string;
}

export interface ScraperModule<TInput = unknown, TOutput = unknown> {
  meta: ScraperMeta;
  execute(browser: Fetcher, env: Env, input: TInput): Promise<ScrapeResult<TOutput>>;
}

export function wrapResult<T>(
  portal: string,
  success: boolean,
  data?: T,
  error?: string,
): ScrapeResult<T> {
  return {
    success,
    data,
    error,
    method: 'scrape',
    portal,
    scrapedAt: new Date().toISOString(),
  };
}

/**
 * Try multiple CSS selectors and return the first one that matches an element.
 * Returns null if none match. Shared across all scrapers that need resilient selectors.
 */
export async function resolveSelector(page: any, selectors: string[]): Promise<string | null> {
  for (const selector of selectors) {
    try {
      const el = await page.$(selector);
      if (el) return selector;
    } catch {
      // Some selectors (like :has-text) may not be valid CSS -- skip
    }
  }
  return null;
}
```

**Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/scrapers/base.ts test/base.test.ts
git commit -m "feat: add ScraperModule base types, wrapResult helper, resolveSelector"
```

---

## Task 3: Create ScraperCatalog (`src/catalog.ts`)

The catalog registers scrapers and provides lookup by ID and category.

**Files:**
- Create: `src/catalog.ts`
- Modify: `test/catalog.test.ts` (replace smoke test with real tests)

**Step 1: Write the failing tests**

Replace `test/catalog.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { ScraperCatalog } from '../src/catalog';
import type { ScraperModule, ScrapeResult } from '../src/scrapers/base';

function makeFakeScraper(id: string, category: string = 'utility'): ScraperModule {
  return {
    meta: {
      id,
      name: id,
      category: category as any,
      version: '1.0.0',
      requiresAuth: false,
    },
    execute: async () => ({ success: true, method: 'scrape' as const, portal: id, scrapedAt: '' }),
  };
}

describe('ScraperCatalog', () => {
  let catalog: ScraperCatalog;

  beforeEach(() => {
    catalog = new ScraperCatalog();
  });

  it('registers and retrieves a scraper by id', () => {
    catalog.register(makeFakeScraper('test-portal'));
    expect(catalog.get('test-portal')).toBeDefined();
    expect(catalog.get('test-portal')!.meta.id).toBe('test-portal');
  });

  it('returns undefined for unknown id', () => {
    expect(catalog.get('nope')).toBeUndefined();
  });

  it('lists all registered scraper metadata', () => {
    catalog.register(makeFakeScraper('a'));
    catalog.register(makeFakeScraper('b'));
    const list = catalog.list();
    expect(list).toHaveLength(2);
    expect(list.map((m) => m.id)).toEqual(['a', 'b']);
  });

  it('filters by category', () => {
    catalog.register(makeFakeScraper('gas', 'utility'));
    catalog.register(makeFakeScraper('court', 'court'));
    const utils = catalog.listByCategory('utility');
    expect(utils).toHaveLength(1);
    expect(utils[0].id).toBe('gas');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL -- `ScraperCatalog` not defined.

**Step 3: Write the implementation**

Create `src/catalog.ts`:
```typescript
import type { ScraperModule, ScraperMeta, ScraperCategory } from './scrapers/base';

export class ScraperCatalog {
  private scrapers = new Map<string, ScraperModule>();

  register(scraper: ScraperModule): void {
    this.scrapers.set(scraper.meta.id, scraper);
  }

  get(portalId: string): ScraperModule | undefined {
    return this.scrapers.get(portalId);
  }

  list(): ScraperMeta[] {
    return Array.from(this.scrapers.values()).map((s) => s.meta);
  }

  listByCategory(category: ScraperCategory): ScraperMeta[] {
    return this.list().filter((m) => m.category === category);
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npm test`
Expected: ALL PASS.

**Step 5: Commit**

```bash
git add src/catalog.ts test/catalog.test.ts
git commit -m "feat: add ScraperCatalog with register, get, list, listByCategory"
```

---

## Task 4: Refactor existing scrapers to ScraperModule interface

Wrap existing scraper functions in ScraperModule objects. Keep the actual scrape logic unchanged -- just wrap the exports.

**Files:**
- Modify: `src/scrapers/court-docket.ts`
- Modify: `src/scrapers/cook-county-tax.ts`
- Modify: `src/scrapers/mr-cooper.ts`

**Step 1: Refactor court-docket.ts**

Keep `scrapeCookCountyDocket` function as-is. Add a `ScraperModule` export at the bottom:

```typescript
// Add at top:
import type { Env } from '../index';
import { wrapResult, type ScraperModule, type ScrapeResult } from './base';

// Add at bottom, after existing function:
export const courtDocketScraper: ScraperModule<{ caseNumber: string }, DocketResult['data']> = {
  meta: {
    id: 'court-docket',
    name: 'Cook County Court Docket',
    category: 'court',
    version: '0.1.0',
    requiresAuth: false,
  },
  async execute(browser, env, input) {
    const result = await scrapeCookCountyDocket(browser, input.caseNumber);
    return wrapResult('court-docket', result.success, result.data, result.error);
  },
};
```

Do NOT remove the existing `scrapeCookCountyDocket` export -- legacy routes in index.ts still use it.

**Step 2: Refactor cook-county-tax.ts**

Same pattern. Add at bottom:

```typescript
import type { Env } from '../index';
import { wrapResult, type ScraperModule } from './base';

export const cookCountyTaxScraper: ScraperModule<{ pin: string }, TaxResult['data']> = {
  meta: {
    id: 'cook-county-tax',
    name: 'Cook County Property Tax',
    category: 'tax',
    version: '0.1.0',
    requiresAuth: false,
  },
  async execute(browser, env, input) {
    const result = await scrapeCookCountyTax(browser, input.pin);
    return wrapResult('cook-county-tax', result.success, result.data, result.error);
  },
};
```

**Step 3: Refactor mr-cooper.ts**

This one needs credentials from KV. The `execute` method reads them from `env.SCRAPE_KV`.

Remove the local `resolveSelector` function and import from base.ts instead (it's identical).

Add at bottom:

```typescript
import type { Env } from '../index';
import { wrapResult, resolveSelector as baseResolveSelector, type ScraperModule } from './base';

export const mrCooperScraper: ScraperModule<{ property: string }, MrCooperResult['data']> = {
  meta: {
    id: 'mr-cooper',
    name: 'Mr. Cooper Mortgage',
    category: 'mortgage',
    version: '0.1.0',
    requiresAuth: true,
    credentialKeys: ['mrcooper:username', 'mrcooper:password'],
  },
  async execute(browser, env, input) {
    const username = await env.SCRAPE_KV.get('mrcooper:username');
    const password = await env.SCRAPE_KV.get('mrcooper:password');
    if (!username || !password) {
      return wrapResult('mr-cooper', false, undefined, 'Mr. Cooper credentials not configured');
    }
    const result = await scrapeMrCooper(browser, { username, password }, input.property);
    return wrapResult('mr-cooper', result.success, result.data, result.error);
  },
};
```

Also: replace the local `resolveSelector` with an import from `./base` (they are identical). Change `async function resolveSelector(...)` to use the import. Update all internal calls.

**Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: No errors. The `Env` type import from `../index` should work since `Env` is exported.

**Step 5: Commit**

```bash
git add src/scrapers/court-docket.ts src/scrapers/cook-county-tax.ts src/scrapers/mr-cooper.ts
git commit -m "refactor: wrap existing scrapers in ScraperModule interface"
```

---

## Task 5: Wire catalog into index.ts + generic route + capabilities + gaps

This is the biggest task. Rewrite `index.ts` to:
1. Build the catalog from all scrapers
2. Add `POST /api/scrape/:portalId` generic route
3. Add `GET /api/v1/capabilities` endpoint
4. Add `GET /api/v1/gaps` endpoint
5. Keep legacy routes working (they delegate to catalog internally)
6. Update auth middleware to skip capabilities endpoint
7. Bump version to `0.2.0`

**Files:**
- Modify: `src/index.ts`
- Modify: `package.json` (bump version)

**Step 1: Rewrite index.ts**

Full replacement of `src/index.ts`:

```typescript
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { ScraperCatalog } from './catalog';
import { courtDocketScraper } from './scrapers/court-docket';
import { cookCountyTaxScraper } from './scrapers/cook-county-tax';
import { mrCooperScraper } from './scrapers/mr-cooper';

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
```

Note: Legacy-specific routes (`/api/scrape/court-docket`, etc.) are now handled by the generic `/:portalId` route. The Hono param route matches them. Backwards compatible because the input shapes are the same.

**Step 2: Update package.json version**

Change `"version": "0.1.0"` to `"version": "0.2.0"`.

**Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: No errors.

**Step 4: Commit**

```bash
git add src/index.ts package.json
git commit -m "feat: catalog-driven generic route, capabilities endpoint, gap detection"
```

---

## Task 6: Peoples Gas scraper

**Files:**
- Create: `src/scrapers/peoples-gas.ts`
- Create: `test/peoples-gas.test.ts`

**Step 1: Write the failing test**

Create `test/peoples-gas.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { peoplesGasScraper } from '../src/scrapers/peoples-gas';

describe('peoples-gas scraper meta', () => {
  it('has correct metadata', () => {
    expect(peoplesGasScraper.meta.id).toBe('peoples-gas');
    expect(peoplesGasScraper.meta.category).toBe('utility');
    expect(peoplesGasScraper.meta.requiresAuth).toBe(true);
    expect(peoplesGasScraper.meta.credentialKeys).toEqual([
      'peoplesgas:username',
      'peoplesgas:password',
    ]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL -- module not found.

**Step 3: Write the implementation**

Create `src/scrapers/peoples-gas.ts`:
```typescript
import puppeteer from '@cloudflare/puppeteer';
import type { Env } from '../index';
import { wrapResult, resolveSelector, type ScraperModule } from './base';

export interface PeoplesGasData {
  accountNumber: string;
  currentBalance: number;
  dueDate?: string;
  lastPayment?: { date: string; amount: number };
  billingHistory: Array<{ date: string; amount: number; therms?: number }>;
}

export const peoplesGasScraper: ScraperModule<{ accountNumber: string }, PeoplesGasData> = {
  meta: {
    id: 'peoples-gas',
    name: 'Peoples Gas',
    category: 'utility',
    version: '0.1.0',
    requiresAuth: true,
    credentialKeys: ['peoplesgas:username', 'peoplesgas:password'],
  },

  async execute(browser, env, input) {
    const username = await env.SCRAPE_KV.get('peoplesgas:username');
    const password = await env.SCRAPE_KV.get('peoplesgas:password');
    if (!username || !password) {
      return wrapResult('peoples-gas', false, undefined, 'Peoples Gas credentials not configured');
    }

    let browserInstance: any;
    let page: any;
    try {
      browserInstance = await puppeteer.launch(browser);
      page = await browserInstance.newPage();
      await page.setViewport({ width: 1280, height: 800 });

      // Navigate to Peoples Gas / WEC Energy login
      await page.goto('https://www.peoplesgasdelivery.com/login', {
        waitUntil: 'networkidle0',
        timeout: 30000,
      });

      // Login flow
      const userSel = await resolveSelector(page, [
        '#username', 'input[name="username"]', 'input[name="email"]',
        'input[type="email"]', '#userId', 'input[data-testid="username"]',
      ]);
      if (!userSel) return wrapResult('peoples-gas', false, undefined, 'Could not find username input');
      await page.type(userSel, username);

      const passSel = await resolveSelector(page, [
        '#password', 'input[name="password"]', 'input[type="password"]',
      ]);
      if (!passSel) return wrapResult('peoples-gas', false, undefined, 'Could not find password input');
      await page.type(passSel, password);

      const submitSel = await resolveSelector(page, [
        'button[type="submit"]', '#loginButton', 'input[type="submit"]',
        'button.btn-primary', '.login-btn',
      ]);
      if (!submitSel) return wrapResult('peoples-gas', false, undefined, 'Could not find submit button');
      await page.click(submitSel);

      await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 20000 }).catch(() => {});
      await new Promise((r) => setTimeout(r, 3000));

      // Check login failure
      const stillOnLogin = await page.evaluate(() => {
        const url = (globalThis as any).location?.href || '';
        return url.includes('/login') || url.includes('/signin');
      });
      if (stillOnLogin) {
        return wrapResult('peoples-gas', false, undefined, 'Login failed -- check credentials or CAPTCHA');
      }

      // Extract account data from dashboard
      const data = await page.evaluate((acctNum: string) => {
        const doc = (globalThis as any).document;
        if (!doc) return null;

        const text = (...sels: string[]): string => {
          for (const sel of sels) {
            const el = doc.querySelector(sel);
            if (el) { const t = (el.textContent || '').trim(); if (t) return t; }
          }
          return '';
        };

        const parseCurrency = (s: string): number => {
          const v = parseFloat(s.replace(/[$,\s]/g, ''));
          return isNaN(v) ? 0 : v;
        };

        const currentBalance = parseCurrency(text(
          '.current-balance', '.balance-amount', '.amount-due',
          '[data-testid="balance"]', '#currentBalance',
        ));

        const dueDate = text(
          '.due-date', '.payment-due-date', '[data-testid="due-date"]',
          '#dueDate',
        ) || undefined;

        // Billing history -- best effort from table
        const billingHistory: Array<{ date: string; amount: number; therms?: number }> = [];
        const rows = doc.querySelectorAll(
          '.billing-history tr, .bill-history tbody tr, ' +
          '[data-testid="billing-row"], .transaction-row',
        );
        if (rows) {
          for (let i = 0; i < rows.length && i < 24; i++) {
            const cells = rows[i].querySelectorAll('td');
            if (cells.length >= 2) {
              const dateText = (cells[0]?.textContent || '').trim();
              if (!dateText || dateText.toLowerCase().includes('date')) continue;
              const entry: { date: string; amount: number; therms?: number } = {
                date: dateText,
                amount: parseCurrency(cells[1]?.textContent || ''),
              };
              if (cells.length >= 3) {
                const therms = parseFloat((cells[2]?.textContent || '').replace(/[^\d.]/g, ''));
                if (!isNaN(therms)) entry.therms = therms;
              }
              if (entry.amount > 0) billingHistory.push(entry);
            }
          }
        }

        return {
          accountNumber: acctNum,
          currentBalance,
          dueDate,
          billingHistory,
        };
      }, input.accountNumber);

      if (!data) {
        return wrapResult('peoples-gas', false, undefined, 'Could not extract account data');
      }

      return wrapResult('peoples-gas', true, data as PeoplesGasData);
    } catch (err: any) {
      return wrapResult('peoples-gas', false, undefined, err.message);
    } finally {
      if (page) await page.close().catch(() => {});
      if (browserInstance) await browserInstance.close().catch(() => {});
    }
  },
};
```

**Step 4: Register in index.ts**

Add import and registration:
```typescript
import { peoplesGasScraper } from './scrapers/peoples-gas';
// ... after existing registrations:
catalog.register(peoplesGasScraper);
```

**Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: No errors.

**Step 6: Commit**

```bash
git add src/scrapers/peoples-gas.ts test/peoples-gas.test.ts src/index.ts
git commit -m "feat: add Peoples Gas utility scraper"
```

---

## Task 7: ComEd scraper

**Files:**
- Create: `src/scrapers/comed.ts`
- Create: `test/comed.test.ts`

**Step 1: Write the failing test**

Create `test/comed.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { comedScraper } from '../src/scrapers/comed';

describe('comed scraper meta', () => {
  it('has correct metadata', () => {
    expect(comedScraper.meta.id).toBe('comed');
    expect(comedScraper.meta.category).toBe('utility');
    expect(comedScraper.meta.requiresAuth).toBe(true);
    expect(comedScraper.meta.credentialKeys).toEqual([
      'comed:username',
      'comed:password',
    ]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL.

**Step 3: Write the implementation**

Create `src/scrapers/comed.ts`:
```typescript
import puppeteer from '@cloudflare/puppeteer';
import type { Env } from '../index';
import { wrapResult, resolveSelector, type ScraperModule } from './base';

export interface ComEdData {
  accountNumber: string;
  currentBalance: number;
  dueDate?: string;
  lastPayment?: { date: string; amount: number };
  billingHistory: Array<{ date: string; amount: number; kwhUsage?: number }>;
}

export const comedScraper: ScraperModule<{ accountNumber: string }, ComEdData> = {
  meta: {
    id: 'comed',
    name: 'ComEd (Commonwealth Edison)',
    category: 'utility',
    version: '0.1.0',
    requiresAuth: true,
    credentialKeys: ['comed:username', 'comed:password'],
  },

  async execute(browser, env, input) {
    const username = await env.SCRAPE_KV.get('comed:username');
    const password = await env.SCRAPE_KV.get('comed:password');
    if (!username || !password) {
      return wrapResult('comed', false, undefined, 'ComEd credentials not configured');
    }

    let browserInstance: any;
    let page: any;
    try {
      browserInstance = await puppeteer.launch(browser);
      page = await browserInstance.newPage();
      await page.setViewport({ width: 1280, height: 800 });

      // ComEd uses Exelon's secure login
      await page.goto('https://secure.comed.com/MyAccount/MyBillUsage/pages/secure/BillActivity.aspx', {
        waitUntil: 'networkidle0',
        timeout: 30000,
      });

      // Login flow
      const userSel = await resolveSelector(page, [
        '#username', 'input[name="username"]', 'input[name="email"]',
        '#userName', 'input[type="email"]', '#signInName',
      ]);
      if (!userSel) return wrapResult('comed', false, undefined, 'Could not find username input');
      await page.type(userSel, username);

      const passSel = await resolveSelector(page, [
        '#password', 'input[name="password"]', 'input[type="password"]',
      ]);
      if (!passSel) return wrapResult('comed', false, undefined, 'Could not find password input');
      await page.type(passSel, password);

      const submitSel = await resolveSelector(page, [
        'button[type="submit"]', '#next', '#loginButton',
        'input[type="submit"]', 'button.btn-primary',
      ]);
      if (!submitSel) return wrapResult('comed', false, undefined, 'Could not find submit button');
      await page.click(submitSel);

      await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 20000 }).catch(() => {});
      await new Promise((r) => setTimeout(r, 3000));

      const stillOnLogin = await page.evaluate(() => {
        const url = (globalThis as any).location?.href || '';
        return url.includes('/login') || url.includes('/signin') || url.includes('B2C');
      });
      if (stillOnLogin) {
        return wrapResult('comed', false, undefined, 'Login failed -- check credentials or CAPTCHA');
      }

      // Extract billing data
      const data = await page.evaluate((acctNum: string) => {
        const doc = (globalThis as any).document;
        if (!doc) return null;

        const text = (...sels: string[]): string => {
          for (const sel of sels) {
            const el = doc.querySelector(sel);
            if (el) { const t = (el.textContent || '').trim(); if (t) return t; }
          }
          return '';
        };

        const parseCurrency = (s: string): number => {
          const v = parseFloat(s.replace(/[$,\s]/g, ''));
          return isNaN(v) ? 0 : v;
        };

        const currentBalance = parseCurrency(text(
          '.total-amount-due', '.balance-due', '.current-balance',
          '[data-testid="balance"]', '#totalAmountDue', '.amount-due',
        ));

        const dueDate = text(
          '.due-date', '.payment-due-date', '[data-testid="due-date"]',
          '#dueDate', '.bill-due-date',
        ) || undefined;

        const billingHistory: Array<{ date: string; amount: number; kwhUsage?: number }> = [];
        const rows = doc.querySelectorAll(
          '.bill-history-table tr, .billing-table tbody tr, ' +
          '[data-testid="bill-row"], .bill-activity-row',
        );
        if (rows) {
          for (let i = 0; i < rows.length && i < 24; i++) {
            const cells = rows[i].querySelectorAll('td');
            if (cells.length >= 2) {
              const dateText = (cells[0]?.textContent || '').trim();
              if (!dateText || dateText.toLowerCase().includes('date')) continue;
              const entry: { date: string; amount: number; kwhUsage?: number } = {
                date: dateText,
                amount: parseCurrency(cells[1]?.textContent || ''),
              };
              if (cells.length >= 3) {
                const kwh = parseFloat((cells[2]?.textContent || '').replace(/[^\d.]/g, ''));
                if (!isNaN(kwh)) entry.kwhUsage = kwh;
              }
              if (entry.amount > 0) billingHistory.push(entry);
            }
          }
        }

        return {
          accountNumber: acctNum,
          currentBalance,
          dueDate,
          billingHistory,
        };
      }, input.accountNumber);

      if (!data) {
        return wrapResult('comed', false, undefined, 'Could not extract billing data');
      }

      return wrapResult('comed', true, data as ComEdData);
    } catch (err: any) {
      return wrapResult('comed', false, undefined, err.message);
    } finally {
      if (page) await page.close().catch(() => {});
      if (browserInstance) await browserInstance.close().catch(() => {});
    }
  },
};
```

**Step 4: Register in index.ts**

Add import and registration:
```typescript
import { comedScraper } from './scrapers/comed';
catalog.register(comedScraper);
```

**Step 5: Run typecheck and tests**

Run: `npm run typecheck && npm test`
Expected: All pass.

**Step 6: Commit**

```bash
git add src/scrapers/comed.ts test/comed.test.ts src/index.ts
git commit -m "feat: add ComEd utility scraper"
```

---

## Task 8: Court name search scraper

This is the most distinct new scraper -- searches by party name across all Cook County divisions.

**Files:**
- Create: `src/scrapers/court-name-search.ts`
- Create: `test/court-name-search.test.ts`

**Step 1: Write the failing test**

Create `test/court-name-search.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { courtNameSearchScraper } from '../src/scrapers/court-name-search';

describe('court-name-search scraper meta', () => {
  it('has correct metadata', () => {
    expect(courtNameSearchScraper.meta.id).toBe('court-name-search');
    expect(courtNameSearchScraper.meta.category).toBe('court');
    expect(courtNameSearchScraper.meta.requiresAuth).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL.

**Step 3: Write the implementation**

Create `src/scrapers/court-name-search.ts`:
```typescript
import puppeteer from '@cloudflare/puppeteer';
import type { Env } from '../index';
import { wrapResult, type ScraperModule } from './base';

export interface CaseMatch {
  caseNumber: string;
  parties?: string;
  court?: string;
  division?: string;
  status?: string;
  filingDate?: string;
  judge?: string;
}

export interface CourtNameSearchData {
  searchName: string;
  totalResults: number;
  cases: CaseMatch[];
}

const DIVISIONS = ['civil', 'criminal', 'chancery', 'domestic', 'law', 'municipal'] as const;

export const courtNameSearchScraper: ScraperModule<
  { name: string; divisions?: string[] },
  CourtNameSearchData
> = {
  meta: {
    id: 'court-name-search',
    name: 'Cook County Court Name Search',
    category: 'court',
    version: '0.1.0',
    requiresAuth: false,
  },

  async execute(browser, env, input) {
    const searchName = input.name?.trim();
    if (!searchName) {
      return wrapResult('court-name-search', false, undefined, 'name is required');
    }

    let browserInstance: any;
    let page: any;
    try {
      browserInstance = await puppeteer.launch(browser);
      page = await browserInstance.newPage();
      await page.setViewport({ width: 1280, height: 800 });

      const allCases: CaseMatch[] = [];

      // Cook County Circuit Clerk case search
      // The clerk site may have an API or HTML search -- try API first
      // Civil case search API endpoint
      const apiUrl = `https://casesearch.cookcountyclerkofcourt.org/CivilCaseSearchAPI/api/CivilCases?LastName=${encodeURIComponent(searchName)}`;

      await page.goto(apiUrl, {
        waitUntil: 'networkidle0',
        timeout: 30000,
      });

      const bodyText = await page.evaluate(() =>
        (globalThis as any).document?.body?.innerText || '',
      );

      let apiData: any;
      try {
        apiData = JSON.parse(bodyText);
      } catch {
        apiData = null;
      }

      if (apiData && Array.isArray(apiData)) {
        for (const item of apiData) {
          allCases.push({
            caseNumber: item.caseNumber || item.caseId || '',
            parties: item.caseTitle || item.parties || undefined,
            court: 'Cook County Circuit Court',
            division: item.division || item.caseType || undefined,
            status: item.caseStatus || item.status || undefined,
            filingDate: item.filingDate || item.fileDate || undefined,
            judge: item.judgeName || item.judge || undefined,
          });
        }
      }

      // If API didn't return results, try the HTML search page
      if (allCases.length === 0) {
        await page.goto('https://casesearch.cookcountyclerkofcourt.org/CivilCaseSearchAPI.html', {
          waitUntil: 'networkidle0',
          timeout: 20000,
        });

        // Try to find and fill name search input
        const nameInput = await page.$('input[name="lastName"], #lastName, input[placeholder*="name" i]');
        if (nameInput) {
          await page.type('input[name="lastName"], #lastName, input[placeholder*="name" i]', searchName);

          const searchBtn = await page.$('button[type="submit"], #searchButton, .search-btn, input[type="submit"]');
          if (searchBtn) {
            await searchBtn.click();
            await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 15000 }).catch(() => {});
            await new Promise((r) => setTimeout(r, 2000));

            // Try to parse HTML results table
            const htmlCases = await page.evaluate(() => {
              const doc = (globalThis as any).document;
              if (!doc) return [];
              const results: Array<{
                caseNumber: string;
                parties?: string;
                division?: string;
                status?: string;
                filingDate?: string;
              }> = [];
              const rows = doc.querySelectorAll('table tr, .search-result, .case-row, [data-testid="case-row"]');
              if (rows) {
                for (let i = 0; i < rows.length && i < 100; i++) {
                  const cells = rows[i].querySelectorAll('td');
                  if (cells.length >= 2) {
                    const caseNum = (cells[0]?.textContent || '').trim();
                    if (!caseNum || caseNum.toLowerCase().includes('case')) continue;
                    results.push({
                      caseNumber: caseNum,
                      parties: cells.length >= 2 ? (cells[1]?.textContent || '').trim() : undefined,
                      division: cells.length >= 3 ? (cells[2]?.textContent || '').trim() : undefined,
                      status: cells.length >= 4 ? (cells[3]?.textContent || '').trim() : undefined,
                      filingDate: cells.length >= 5 ? (cells[4]?.textContent || '').trim() : undefined,
                    });
                  }
                }
              }
              return results;
            });

            for (const c of htmlCases) {
              allCases.push({
                ...c,
                court: 'Cook County Circuit Court',
              });
            }
          }
        }
      }

      return wrapResult('court-name-search', true, {
        searchName,
        totalResults: allCases.length,
        cases: allCases,
      });
    } catch (err: any) {
      return wrapResult('court-name-search', false, undefined, err.message);
    } finally {
      if (page) await page.close().catch(() => {});
      if (browserInstance) await browserInstance.close().catch(() => {});
    }
  },
};
```

**Step 4: Register in index.ts**

Add import and registration:
```typescript
import { courtNameSearchScraper } from './scrapers/court-name-search';
catalog.register(courtNameSearchScraper);
```

**Step 5: Run typecheck and tests**

Run: `npm run typecheck && npm test`
Expected: All pass.

**Step 6: Commit**

```bash
git add src/scrapers/court-name-search.ts test/court-name-search.test.ts src/index.ts
git commit -m "feat: add court name search scraper across all Cook County divisions"
```

---

## Task 9: Update CHARTER.md and CLAUDE.md

Update documentation to reflect the new v0.2.0 capabilities.

**Files:**
- Modify: `CHARTER.md` (add new endpoints, update scope)
- Modify: `CLAUDE.md` (add new scrapers to table, update architecture)

**Step 1: Update CHARTER.md API Contract**

Add new endpoints to the API Contract table:

```markdown
| `/api/scrape/peoples-gas` | POST | Bearer | Scrape Peoples Gas utility portal |
| `/api/scrape/comed` | POST | Bearer | Scrape ComEd utility portal |
| `/api/scrape/court-name-search` | POST | Bearer | Search Cook County courts by party name |
| `/api/scrape/:portalId` | POST | Bearer | Generic scrape -- catalog lookup |
| `/api/v1/capabilities` | GET | No | Scraper capability declaration for ChittyRouter |
| `/api/v1/gaps` | GET | Bearer | Reported capability gaps |
```

Update "IS Responsible For" to add:
- Browser-based scraping of utility portals (Peoples Gas, ComEd)
- Court name search across all Cook County divisions
- Declaring scraper capabilities for ChittyRouter discovery
- Tracking capability gaps for unknown portal requests

Update version to 1.1.0.

**Step 2: Update CLAUDE.md Scrapers table**

Add new entries to the Scrapers table:

```markdown
| `POST /api/scrape/peoples-gas` | Peoples Gas portal | `{ accountNumber }` |
| `POST /api/scrape/comed` | ComEd portal | `{ accountNumber }` |
| `POST /api/scrape/court-name-search` | Cook County courts (by name) | `{ name, divisions? }` |
| `POST /api/scrape/:portalId` | Generic catalog lookup | varies by scraper |
```

**Step 3: Commit**

```bash
git add CHARTER.md CLAUDE.md
git commit -m "docs: update charter and dev guide for v0.2.0 scrapers and capabilities"
```

---

## Task 10: Final verification and typecheck

**Step 1: Run full typecheck**

Run: `npm run typecheck`
Expected: No errors.

**Step 2: Run all tests**

Run: `npm test`
Expected: All tests pass.

**Step 3: Verify catalog completeness**

Mentally verify: index.ts registers all 6 scrapers (court-docket, cook-county-tax, mr-cooper, peoples-gas, comed, court-name-search). The capabilities endpoint returns all 6.

**Step 4: Final commit if any loose changes**

```bash
git status
# If clean, done. If not, commit remaining changes.
```

---

**Plan complete and saved to `docs/plans/2026-02-24-chittyscrape-enhancement-plan.md`.**
