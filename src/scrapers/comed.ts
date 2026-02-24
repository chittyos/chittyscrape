import puppeteer from '@cloudflare/puppeteer';
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
      return wrapResult<ComEdData>('comed', false, undefined, 'ComEd credentials not configured');
    }

    let browserInstance: any;
    let page: any;
    try {
      browserInstance = await puppeteer.launch(browser);
      page = await browserInstance.newPage();
      await page.setViewport({ width: 1280, height: 800 });

      // Navigate to ComEd bill activity (Azure B2C login)
      await page.goto('https://secure.comed.com/MyAccount/MyBillUsage/pages/secure/BillActivity.aspx', {
        waitUntil: 'networkidle0',
        timeout: 30000,
      });

      // Login flow -- ComEd uses Azure B2C
      const userSel = await resolveSelector(page, [
        '#signInName', '#username', 'input[name="username"]', 'input[name="email"]',
        'input[type="email"]', '#userId', 'input[data-testid="username"]',
      ]);
      if (!userSel) return wrapResult<ComEdData>('comed', false, undefined, 'Could not find username input');
      await page.type(userSel, username);

      const passSel = await resolveSelector(page, [
        '#password', 'input[name="password"]', 'input[type="password"]',
      ]);
      if (!passSel) return wrapResult<ComEdData>('comed', false, undefined, 'Could not find password input');
      await page.type(passSel, password);

      const submitSel = await resolveSelector(page, [
        'button[type="submit"]', '#loginButton', 'input[type="submit"]',
        'button.btn-primary', '.login-btn',
      ]);
      if (!submitSel) return wrapResult<ComEdData>('comed', false, undefined, 'Could not find submit button');
      await page.click(submitSel);

      await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 20000 }).catch(() => {});
      await new Promise((r) => setTimeout(r, 3000));

      // Check login failure -- B2C stays on B2C URL on failure
      const stillOnLogin = await page.evaluate(() => {
        const url = (globalThis as any).location?.href || '';
        return url.includes('/login') || url.includes('/signin') || url.includes('B2C');
      });
      if (stillOnLogin) {
        return wrapResult<ComEdData>('comed', false, undefined, 'Login failed -- check credentials or CAPTCHA');
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
        const billingHistory: Array<{ date: string; amount: number; kwhUsage?: number }> = [];
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
        return wrapResult<ComEdData>('comed', false, undefined, 'Could not extract account data');
      }

      return wrapResult('comed', true, data as ComEdData);
    } catch (err: any) {
      return wrapResult<ComEdData>('comed', false, undefined, err.message);
    } finally {
      if (page) await page.close().catch(() => {});
      if (browserInstance) await browserInstance.close().catch(() => {});
    }
  },
};
