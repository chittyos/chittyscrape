import puppeteer from '@cloudflare/puppeteer';
import { wrapResult, resolveSelector, type ScraperModule } from './base';

export interface PeoplesGasData {
  accountNumber: string;
  currentBalance: number;
  dueDate?: string;
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
    if (!input?.accountNumber?.trim()) {
      return wrapResult<PeoplesGasData>('peoples-gas', false, undefined, 'accountNumber is required');
    }

    const username = await env.SCRAPE_KV.get('peoplesgas:username');
    const password = await env.SCRAPE_KV.get('peoplesgas:password');
    if (!username || !password) {
      return wrapResult<PeoplesGasData>('peoples-gas', false, undefined, 'Peoples Gas credentials not configured');
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
      if (!userSel) return wrapResult<PeoplesGasData>('peoples-gas', false, undefined, 'Could not find username input');
      await page.type(userSel, username);

      const passSel = await resolveSelector(page, [
        '#password', 'input[name="password"]', 'input[type="password"]',
      ]);
      if (!passSel) return wrapResult<PeoplesGasData>('peoples-gas', false, undefined, 'Could not find password input');
      await page.type(passSel, password);

      const submitSel = await resolveSelector(page, [
        'button[type="submit"]', '#loginButton', 'input[type="submit"]',
        'button.btn-primary', '.login-btn',
      ]);
      if (!submitSel) return wrapResult<PeoplesGasData>('peoples-gas', false, undefined, 'Could not find submit button');
      await page.click(submitSel);

      try {
        await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 20000 });
      } catch (navErr: any) {
        if (!navErr.message?.includes('timeout')) {
          return wrapResult<PeoplesGasData>('peoples-gas', false, undefined, `Navigation failed after login: ${navErr.message}`);
        }
      }
      await new Promise((r) => setTimeout(r, 3000));

      // Check login failure
      const stillOnLogin = await page.evaluate(() => {
        const url = (globalThis as any).location?.href || '';
        return url.includes('/login') || url.includes('/signin');
      });
      if (stillOnLogin) {
        return wrapResult<PeoplesGasData>('peoples-gas', false, undefined, 'Login failed -- check credentials or CAPTCHA');
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
        return wrapResult<PeoplesGasData>('peoples-gas', false, undefined, 'Could not extract account data');
      }

      return wrapResult('peoples-gas', true, data as PeoplesGasData);
    } catch (err: any) {
      const message = err?.message || String(err);
      console.error(`Scraper peoples-gas failed: ${message}`, err?.stack);
      return wrapResult<PeoplesGasData>('peoples-gas', false, undefined, message);
    } finally {
      if (page) await page.close().catch((e: any) => console.warn(`Failed to close page: ${e.message}`));
      if (browserInstance) await browserInstance.close().catch((e: any) => console.warn(`Failed to close browser: ${e.message}`));
    }
  },
};
