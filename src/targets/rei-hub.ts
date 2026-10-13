import puppeteer from '@cloudflare/puppeteer';
import { wrapResult, type ScraperModule } from './base';
import { getChittyConnectCredential, getCredentialRef } from '../chittyconnect';

export interface ReiHubTableSnapshot {
  headers: string[];
  rows: string[][];
}

export interface ReiHubSnapshot {
  source: 'rei-hub';
  sourceView: 'booked-transactions';
  bookedTransactionsUrl: string;
  bookedTransactions: ReiHubTableSnapshot;
  chartOfAccounts?: ReiHubTableSnapshot;
  chartOfAccountsUrl?: string;
  scrapedAt: string;
  snapshotSha256: string;
}

export interface ReiHubInput {
  maxPages?: number;
  includeChartOfAccounts?: boolean;
}

async function clickByText(page: any, needles: string[]): Promise<boolean> {
  return page.evaluate((parts: string[]) => {
    const doc = (globalThis as any).document;
    if (!doc) return false;
    const candidates = Array.from(
      doc.querySelectorAll('a,button,[role="button"],[role="menuitem"],[role="link"]'),
    ) as any[];
    const normalized = parts.map((part) => part.toLowerCase());
    const match = candidates.find((el) => {
      const text = String(el.textContent || el.getAttribute?.('aria-label') || el.getAttribute?.('title') || '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
      return normalized.every((part) => text.includes(part));
    });
    if (!match) return false;
    match.click();
    return true;
  }, needles);
}

async function extractVisibleTable(page: any): Promise<ReiHubTableSnapshot> {
  return page.evaluate(() => {
    const doc = (globalThis as any).document;
    if (!doc) return { headers: [], rows: [] };

    const clean = (value: unknown) => String(value ?? '').replace(/\s+/g, ' ').trim();

    const tables = Array.from(doc.querySelectorAll('table')) as any[];
    let best: { headers: string[]; rows: string[][] } = { headers: [], rows: [] };

    for (const table of tables) {
      const headers = Array.from(table.querySelectorAll('thead th')).map((cell: any) => clean(cell.textContent));
      const rows = Array.from(table.querySelectorAll('tbody tr'))
        .map((row: any) => Array.from(row.querySelectorAll('td')).map((cell: any) => clean(cell.textContent)))
        .filter((row: string[]) => row.some(Boolean));
      if (rows.length > best.rows.length) best = { headers, rows };
    }

    if (best.rows.length > 0) return best;

    const roleRows = Array.from(doc.querySelectorAll('[role="row"]')) as any[];
    const parsed = roleRows
      .map((row: any) => Array.from(row.querySelectorAll('[role="columnheader"],[role="cell"],[role="gridcell"]'))
        .map((cell: any) => clean(cell.textContent)))
      .filter((row: string[]) => row.some(Boolean));

    if (parsed.length === 0) return best;

    const first = parsed[0];
    const headerLike = roleRows[0]?.querySelector?.('[role="columnheader"]');
    return headerLike
      ? { headers: first, rows: parsed.slice(1) }
      : { headers: [], rows: parsed };
  });
}

async function clickNextPage(page: any): Promise<boolean> {
  return page.evaluate(() => {
    const doc = (globalThis as any).document;
    if (!doc) return false;
    const candidates = Array.from(doc.querySelectorAll('button,a,[role="button"]')) as any[];
    const next = candidates.find((el) => {
      const label = String(el.textContent || el.getAttribute?.('aria-label') || el.getAttribute?.('title') || '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
      const disabled =
        el.disabled === true ||
        el.getAttribute?.('aria-disabled') === 'true' ||
        String(el.className || '').toLowerCase().includes('disabled');
      return !disabled && (label === 'next' || label.includes('next page') || label === '›' || label === '>');
    });
    if (!next) return false;
    next.click();
    return true;
  });
}

async function collectPaginatedTable(page: any, maxPages: number): Promise<ReiHubTableSnapshot> {
  const seen = new Set<string>();
  let headers: string[] = [];
  const rows: string[][] = [];

  for (let pageNumber = 0; pageNumber < maxPages; pageNumber++) {
    const snapshot = await extractVisibleTable(page);
    if (headers.length === 0 && snapshot.headers.length > 0) headers = snapshot.headers;

    for (const row of snapshot.rows) {
      const key = JSON.stringify(row);
      if (!seen.has(key)) {
        seen.add(key);
        rows.push(row);
      }
    }

    const moved = await clickNextPage(page);
    if (!moved) break;
    await page.waitForNetworkIdle({ idleTime: 500, timeout: 8000 }).catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return { headers, rows };
}

async function sha256(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function ensureLoggedIn(page: any, username: string, password: string): Promise<void> {
  await page.goto('https://app.reihub.net/reports', {
    waitUntil: 'networkidle0',
    timeout: 30000,
  });

  const needsLogin = await page.evaluate(() => {
    const doc = (globalThis as any).document;
    return Boolean(doc?.querySelector('input[type="password"]'));
  });
  if (!needsLogin) return;

  const usernameSelector = await page.evaluate(() => {
    const doc = (globalThis as any).document;
    for (const selector of [
      'input[type="email"]',
      'input[name="email"]',
      'input[name="username"]',
      'input[autocomplete="username"]',
      'input[type="text"]',
    ]) {
      if (doc?.querySelector(selector)) return selector;
    }
    return null;
  });
  const passwordSelector = await page.evaluate(() => {
    const doc = (globalThis as any).document;
    for (const selector of [
      'input[type="password"]',
      'input[name="password"]',
      'input[autocomplete="current-password"]',
    ]) {
      if (doc?.querySelector(selector)) return selector;
    }
    return null;
  });

  if (!usernameSelector || !passwordSelector) {
    throw new Error('REI Hub login form could not be identified');
  }

  await page.type(usernameSelector, username);
  await page.type(passwordSelector, password);

  const submitted = await clickByText(page, ['sign', 'in']) || await clickByText(page, ['log', 'in']);
  if (!submitted) {
    const submit = await page.$('button[type="submit"],input[type="submit"]');
    if (!submit) throw new Error('REI Hub login submit control could not be identified');
    await submit.click();
  }

  await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 25000 }).catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 1500));

  const loginFailed = await page.evaluate(() => {
    const doc = (globalThis as any).document;
    if (!doc) return true;
    const url = String((globalThis as any).location?.href || '').toLowerCase();
    const passwordInput = doc.querySelector('input[type="password"]');
    const body = String(doc.body?.innerText || '').toLowerCase();
    return Boolean(passwordInput) && (url.includes('login') || body.includes('invalid') || body.includes('incorrect'));
  });
  if (loginFailed) {
    throw new Error('REI Hub login failed or requires an interactive challenge/2FA');
  }
}

async function navigateToBookedTransactions(page: any): Promise<void> {
  await page.goto('https://app.reihub.net/reports', {
    waitUntil: 'networkidle0',
    timeout: 30000,
  }).catch(() => {});

  let clicked = await clickByText(page, ['booked', 'transactions']);
  if (!clicked) {
    await clickByText(page, ['transactions']);
    await new Promise((resolve) => setTimeout(resolve, 500));
    clicked = await clickByText(page, ['booked', 'transactions']);
  }
  if (!clicked) {
    throw new Error('Could not navigate to REI Hub Booked Transactions');
  }

  await page.waitForNetworkIdle({ idleTime: 500, timeout: 10000 }).catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 600));
}

async function navigateToChartOfAccounts(page: any): Promise<boolean> {
  if (await clickByText(page, ['chart', 'accounts'])) {
    await page.waitForNetworkIdle({ idleTime: 500, timeout: 10000 }).catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 500));
    return true;
  }

  await clickByText(page, ['menu']);
  await new Promise((resolve) => setTimeout(resolve, 300));
  if (!(await clickByText(page, ['chart', 'accounts']))) return false;
  await page.waitForNetworkIdle({ idleTime: 500, timeout: 10000 }).catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 500));
  return true;
}

async function scrapeReiHub(
  browser: Fetcher,
  credentials: { username: string; password: string },
  input: ReiHubInput,
): Promise<ReiHubSnapshot> {
  let browserInstance: any;
  let page: any;

  try {
    browserInstance = await puppeteer.launch(browser);
    page = await browserInstance.newPage();
    await page.setViewport({ width: 1440, height: 1000 });

    await ensureLoggedIn(page, credentials.username, credentials.password);
    await navigateToBookedTransactions(page);

    const maxPages = Math.max(1, Math.min(input.maxPages ?? 100, 250));
    const bookedTransactionsUrl = await page.evaluate(() => String((globalThis as any).location?.href || ''));
    const bookedTransactions = await collectPaginatedTable(page, maxPages);
    if (bookedTransactions.rows.length === 0) {
      throw new Error('REI Hub Booked Transactions loaded but no tabular rows were extracted');
    }

    let chartOfAccounts: ReiHubTableSnapshot | undefined;
    let chartOfAccountsUrl: string | undefined;
    if (input.includeChartOfAccounts ?? true) {
      if (await navigateToChartOfAccounts(page)) {
        chartOfAccountsUrl = await page.evaluate(() => String((globalThis as any).location?.href || ''));
        const chart = await collectPaginatedTable(page, 20);
        if (chart.rows.length > 0) chartOfAccounts = chart;
      }
    }

    const scrapedAt = new Date().toISOString();
    const hashMaterial = { bookedTransactions, chartOfAccounts };
    return {
      source: 'rei-hub',
      sourceView: 'booked-transactions',
      bookedTransactionsUrl,
      bookedTransactions,
      chartOfAccounts,
      chartOfAccountsUrl,
      scrapedAt,
      snapshotSha256: await sha256(hashMaterial),
    };
  } finally {
    if (page) await page.close().catch(() => {});
    if (browserInstance) await browserInstance.close().catch(() => {});
  }
}

export const reiHubScraper: ScraperModule<ReiHubInput, ReiHubSnapshot> = {
  meta: {
    id: 'rei-hub',
    name: 'REI Hub',
    category: 'generic',
    version: '0.1.0',
    requiresAuth: true,
    credentialKeys: ['REIHUB_USERNAME_REF', 'REIHUB_PASSWORD_REF'],
  },
  async execute(browser, env, input) {
    const usernameRef = getCredentialRef(
      env,
      'REIHUB_USERNAME_REF',
      'integrations/reihub/username',
    );
    const passwordRef = getCredentialRef(
      env,
      'REIHUB_PASSWORD_REF',
      'integrations/reihub/password',
    );

    const [username, password] = await Promise.all([
      getChittyConnectCredential(env, usernameRef),
      getChittyConnectCredential(env, passwordRef),
    ]);

    if (!username || !password) {
      return wrapResult<ReiHubSnapshot>(
        'rei-hub',
        false,
        undefined,
        'REI Hub credentials are unavailable through ChittyConnect',
      );
    }

    try {
      const data = await scrapeReiHub(browser, { username, password }, input || {});
      return wrapResult('rei-hub', true, data);
    } catch (err: any) {
      return wrapResult<ReiHubSnapshot>('rei-hub', false, undefined, err?.message || 'REI Hub scrape failed');
    }
  },
};
