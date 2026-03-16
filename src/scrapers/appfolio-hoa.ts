import puppeteer from '@cloudflare/puppeteer';
import { wrapResult, resolveSelector, type ScraperModule } from './base';

export interface HoaBalanceEntry {
  date: string;
  description: string;
  amount: number;
}

export interface HoaViolation {
  date: string;
  type: string;
  status: string;
  description?: string;
}

export interface AppfolioHoaData {
  portfolio: string;
  propertyAddress?: string;
  currentBalance: number;
  dueDate?: string;
  autopay?: boolean;
  ledgerEntries: HoaBalanceEntry[];
  violations: HoaViolation[];
}

export interface AppfolioHoaInput {
  portfolio: string;
}

/**
 * Known AppFolio portfolios. Each maps to a subdomain and a KV credential prefix.
 * New portfolios: add an entry here and store `<prefix>:username` / `<prefix>:password` in SCRAPE_KV.
 */
const PORTFOLIOS: Record<string, { subdomain: string; credPrefix: string; label: string }> = {
  'propertyhill': {
    subdomain: 'propertyhill',
    credPrefix: 'appfolio-propertyhill',
    label: 'Property Hill (550 W Surf - Commodore)',
    // 1Password: op://ARIBIA LLC/Commodore Condo Association Portal
  },
  'chicagoland': {
    subdomain: 'chicagolandcommunitymanagement',
    credPrefix: 'appfolio-chicagoland',
    label: 'Chicagoland Community Mgmt (541 W Addison)',
  },
};

function portalBase(subdomain: string): string {
  return `https://${subdomain}.appfolio.com`;
}

async function scrapeAppfolioPortal(
  browser: Fetcher,
  env: { SCRAPE_KV: KVNamespace },
  portfolio: { subdomain: string; credPrefix: string; label: string },
): Promise<{ success: boolean; data?: AppfolioHoaData; error?: string }> {
  const username = await env.SCRAPE_KV.get(`${portfolio.credPrefix}:username`);
  const password = await env.SCRAPE_KV.get(`${portfolio.credPrefix}:password`);
  if (!username || !password) {
    return { success: false, error: `Credentials not configured for ${portfolio.label} (${portfolio.credPrefix}:username / :password)` };
  }

  const base = portalBase(portfolio.subdomain);
  let browserInstance: any;
  let page: any;

  try {
    browserInstance = await puppeteer.launch(browser);
    page = await browserInstance.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    // Navigate to the owner/tenant portal — AppFolio redirects to Keycloak OIDC login
    await page.goto(`${base}/connect/users/sign_in`, {
      waitUntil: 'networkidle0',
      timeout: 30000,
    });

    // Keycloak login form at account.appfolio.com
    const userSel = await resolveSelector(page, [
      '#username', 'input[name="username"]', 'input[name="email"]',
      'input[type="email"]', '#kc-form-login input[name="username"]',
    ]);
    if (!userSel) return { success: false, error: 'Could not find username input on login page' };
    await page.type(userSel, username);

    const passSel = await resolveSelector(page, [
      '#password', 'input[name="password"]', 'input[type="password"]',
      '#kc-form-login input[name="password"]',
    ]);
    if (!passSel) return { success: false, error: 'Could not find password input on login page' };
    await page.type(passSel, password);

    const submitSel = await resolveSelector(page, [
      '#kc-login', 'button[type="submit"]', 'input[type="submit"]',
      'button[name="login"]', '.btn-primary[type="submit"]',
    ]);
    if (!submitSel) return { success: false, error: 'Could not find login button' };
    await page.click(submitSel);

    // Wait for OIDC redirect back to the portfolio subdomain
    try {
      await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 25000 });
    } catch {
      // SPA may not trigger full navigation
    }
    await new Promise((r) => setTimeout(r, 3000));

    // Verify we left the login page
    const currentUrl: string = await page.evaluate(() => (globalThis as any).location?.href || '');
    const parsedHost = (() => { try { return new URL(currentUrl).hostname; } catch { return ''; } })();
    if (parsedHost === 'account.appfolio.com' || currentUrl.includes('/sign_in')) {
      return { success: false, error: 'Login failed -- check credentials or 2FA requirement' };
    }

    // Extract dashboard data
    const dashboard = await page.evaluate(() => {
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

      const propertyAddress = text(
        '.property-address', '.address', '[data-testid="property-address"]',
        '.unit-address', '.lease-address', 'h2.address', '.dashboard-address',
      ) || undefined;

      const currentBalance = parseCurrency(text(
        '.balance-amount', '.current-balance', '.amount-due',
        '[data-testid="balance"]', '.total-balance', '.outstanding-balance',
        '.tenant-balance', '.owner-balance', 'span.balance',
      ));

      const dueDate = text(
        '.due-date', '.payment-due-date', '[data-testid="due-date"]',
        '.next-due-date',
      ) || undefined;

      const autopayEl = doc.querySelector(
        '.autopay-status, .auto-pay, [data-testid="autopay"], .autopay-badge'
      );
      let autopay: boolean | undefined;
      if (autopayEl) {
        const t = (autopayEl.textContent || '').toLowerCase();
        autopay = t.includes('on') || t.includes('enabled') || t.includes('active');
      }

      return { propertyAddress, currentBalance, dueDate, autopay };
    });

    if (!dashboard) {
      return { success: false, error: 'Could not extract dashboard data' };
    }

    // Ledger / payment history (best-effort)
    let ledgerEntries: HoaBalanceEntry[] = [];
    try {
      const ledgerSel = await resolveSelector(page, [
        'a[href*="ledger"]', 'a[href*="payments"]', 'a[href*="transactions"]',
        'a[href*="balance"]', '[data-testid="ledger-link"]',
        'a:has-text("Ledger")', 'a:has-text("Payment History")',
        'a:has-text("Transactions")', '.nav-link[href*="ledger"]',
      ]);

      if (ledgerSel) {
        await page.click(ledgerSel);
        try { await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 15000 }); } catch { /* SPA */ }
        await new Promise((r) => setTimeout(r, 2000));

        ledgerEntries = await page.evaluate(() => {
          const doc = (globalThis as any).document;
          if (!doc) return [];

          const parseCurrency = (s: string): number => {
            const v = parseFloat(s.replace(/[$,\s]/g, ''));
            return isNaN(v) ? 0 : v;
          };

          const entries: Array<{ date: string; description: string; amount: number }> = [];
          const rows = doc.querySelectorAll(
            '.ledger-table tr, .transactions-table tbody tr, ' +
            '.payment-history tbody tr, [data-testid="ledger-row"], ' +
            'table.table tbody tr',
          );
          if (rows) {
            for (let i = 0; i < rows.length && i < 36; i++) {
              const cells = rows[i].querySelectorAll('td');
              if (cells.length >= 3) {
                const dateText = (cells[0]?.textContent || '').trim();
                if (!dateText || dateText.toLowerCase().includes('date')) continue;
                const description = (cells[1]?.textContent || '').trim();
                const amount = parseCurrency(cells[2]?.textContent || '');
                if (dateText) entries.push({ date: dateText, description, amount });
              }
            }
          }
          return entries;
        }) || [];
      }
    } catch {
      // best-effort
    }

    // Violations (best-effort)
    let violations: HoaViolation[] = [];
    try {
      if (ledgerEntries.length > 0) {
        await page.goto(`${base}/connect/dashboard`, {
          waitUntil: 'networkidle0',
          timeout: 15000,
        }).catch(() => {});
        await new Promise((r) => setTimeout(r, 2000));
      }

      const violationSel = await resolveSelector(page, [
        'a[href*="violation"]', 'a[href*="inspection"]', 'a[href*="compliance"]',
        '[data-testid="violations-link"]', 'a:has-text("Violations")',
        'a:has-text("Compliance")', '.nav-link[href*="violation"]',
      ]);

      if (violationSel) {
        await page.click(violationSel);
        try { await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 15000 }); } catch { /* SPA */ }
        await new Promise((r) => setTimeout(r, 2000));

        violations = await page.evaluate(() => {
          const doc = (globalThis as any).document;
          if (!doc) return [];

          const items: Array<{ date: string; type: string; status: string; description?: string }> = [];
          const rows = doc.querySelectorAll(
            '.violations-table tr, .compliance-table tbody tr, ' +
            '[data-testid="violation-row"], table.table tbody tr',
          );
          if (rows) {
            for (let i = 0; i < rows.length && i < 24; i++) {
              const cells = rows[i].querySelectorAll('td');
              if (cells.length >= 3) {
                const date = (cells[0]?.textContent || '').trim();
                if (!date || date.toLowerCase().includes('date')) continue;
                const type = (cells[1]?.textContent || '').trim();
                const status = (cells[2]?.textContent || '').trim();
                const description = cells.length >= 4
                  ? (cells[3]?.textContent || '').trim() || undefined
                  : undefined;
                items.push({ date, type, status, description });
              }
            }
          }
          return items;
        }) || [];
      }
    } catch {
      // best-effort
    }

    return {
      success: true,
      data: {
        portfolio: portfolio.label,
        ...dashboard,
        ledgerEntries,
        violations,
      },
    };
  } catch (err: any) {
    const message = err?.message || String(err);
    console.error(`Scraper appfolio-hoa (${portfolio.label}) failed: ${message}`, err?.stack);
    return { success: false, error: message };
  } finally {
    if (page) await page.close().catch((e: any) => console.warn(`Failed to close page: ${e.message}`));
    if (browserInstance) await browserInstance.close().catch((e: any) => console.warn(`Failed to close browser: ${e.message}`));
  }
}

export const appfolioHoaScraper: ScraperModule<AppfolioHoaInput, AppfolioHoaData> = {
  meta: {
    id: 'appfolio-hoa',
    name: 'AppFolio HOA',
    category: 'hoa',
    version: '0.2.0',
    requiresAuth: true,
    credentialKeys: [
      'appfolio-propertyhill:username', 'appfolio-propertyhill:password',
      'appfolio-chicagoland:username', 'appfolio-chicagoland:password',
    ],
  },

  async execute(browser, env, input) {
    const portfolioKey = input?.portfolio?.trim().toLowerCase();
    if (!portfolioKey) {
      return wrapResult<AppfolioHoaData>(
        'appfolio-hoa', false, undefined,
        `portfolio is required. Available: ${Object.keys(PORTFOLIOS).join(', ')}`,
      );
    }

    const portfolio = PORTFOLIOS[portfolioKey];
    if (!portfolio) {
      return wrapResult<AppfolioHoaData>(
        'appfolio-hoa', false, undefined,
        `Unknown portfolio "${portfolioKey}". Available: ${Object.keys(PORTFOLIOS).join(', ')}`,
      );
    }

    const result = await scrapeAppfolioPortal(browser, env, portfolio);
    return wrapResult('appfolio-hoa', result.success, result.data, result.error);
  },
};
