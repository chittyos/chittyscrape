import puppeteer from '@cloudflare/puppeteer';
import { wrapResult, resolveSelector, type ScraperModule } from './base';

export interface FLAgentDocument {
  title: string;
  date: string;
  entity: string;
  type: 'annual-report' | 'filing-confirmation' | 'dissolution-notice' | 'other';
}

export interface FLAgentResult {
  entity: string;
  accountStatus: string;
  annualReportDue?: string;
  annualReportFiled?: boolean;
  invoices: Array<{ date: string; amount: string; status: string }>;
  documents: FLAgentDocument[];
  alerts: string[];
}

/**
 * Scrape Florida Registered Agent LLC portal for JAV LLC compliance status.
 *
 * Logs in, checks annual report status, payment status, and any pending filings.
 * Portal: floridaregisteredagent.net (or similar)
 *
 * Credentials stored in SCRAPE_KV as flra:username and flra:password.
 */
async function scrapeFLRegisteredAgent(
  browser: Fetcher,
  credentials: { username: string; password: string },
  options: { entity?: string },
): Promise<{ success: boolean; data?: FLAgentResult; error?: string }> {
  let browserInstance: any;
  let page: any;
  try {
    browserInstance = await puppeteer.launch(browser);
    page = await browserInstance.newPage();
    await page.setViewport({ width: 1280, height: 900 });

    // Navigate to FL Registered Agent login
    await page.goto('https://www.floridaregisteredagent.net/login', {
      waitUntil: 'networkidle0',
      timeout: 25000,
    });

    // Enter email
    const emailSelector = await resolveSelector(page, [
      '#email', 'input[name="email"]', 'input[type="email"]',
      '#username', 'input[name="username"]',
      'input[placeholder*="email" i]',
    ]);
    if (!emailSelector) {
      return { success: false, error: 'Could not find email input on FL Registered Agent login page' };
    }
    await page.type(emailSelector, credentials.username);

    // Enter password
    const passwordSelector = await resolveSelector(page, [
      '#password', 'input[name="password"]', 'input[type="password"]',
    ]);
    if (!passwordSelector) {
      return { success: false, error: 'Could not find password input' };
    }
    await page.type(passwordSelector, credentials.password);

    // Submit
    const submitSelector = await resolveSelector(page, [
      'button[type="submit"]', 'input[type="submit"]',
      'button.btn-primary', '.login-button',
    ]);
    if (!submitSelector) {
      return { success: false, error: 'Could not find login button' };
    }
    await page.click(submitSelector);
    await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 25000 }).catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Check login success
    const loginFailed = await page.evaluate(() => {
      const doc = (globalThis as any).document;
      if (!doc) return false;
      const url = (globalThis as any).location?.href || '';
      if (url.includes('/login')) return true;
      const errSels = ['.error-message', '.alert-danger', '.alert-error', '[role="alert"]'];
      for (const sel of errSels) {
        const el = doc.querySelector(sel);
        if (el && (el.textContent || '').trim().length > 0) return true;
      }
      return false;
    });

    if (loginFailed) {
      return { success: false, error: 'FL Registered Agent login failed' };
    }

    // Extract account data
    const data = await page.evaluate((entityFilter: string | undefined) => {
      const doc = (globalThis as any).document;
      if (!doc) return null;
      const bodyText = doc.body?.innerText || '';
      const alerts: string[] = [];

      // Check for payment/renewal issues
      if (bodyText.includes('payment') && (bodyText.includes('failed') || bodyText.includes('declined'))) {
        alerts.push('PAYMENT_FAILED');
      }
      if (bodyText.includes('annual report') && bodyText.includes('due')) {
        alerts.push('ANNUAL_REPORT_DUE');
      }
      if (bodyText.includes('dissolv') || bodyText.includes('revok')) {
        alerts.push('DISSOLUTION_RISK');
      }

      // Try to find invoices
      const invoices: Array<{ date: string; amount: string; status: string }> = [];
      const invoiceRows = doc.querySelectorAll('table tbody tr, .invoice-row, .billing-item');
      if (invoiceRows) {
        for (const row of invoiceRows) {
          const cells = row.querySelectorAll('td');
          if (cells.length >= 3) {
            invoices.push({
              date: (cells[0]?.textContent || '').trim(),
              amount: (cells[1]?.textContent || '').trim(),
              status: (cells[2]?.textContent || '').trim(),
            });
          }
        }
      }

      // Try to find annual report status
      let annualReportDue: string | undefined;
      const dueMatch = bodyText.match(/(?:annual report|renewal).*?(?:due|by)\s+(\w+\s+\d+,?\s+\d{4})/i);
      if (dueMatch) annualReportDue = dueMatch[1];

      return {
        entity: entityFilter || 'unknown',
        accountStatus: alerts.includes('PAYMENT_FAILED') ? 'payment_failed' : 'active',
        annualReportDue,
        annualReportFiled: !alerts.includes('ANNUAL_REPORT_DUE'),
        invoices,
        documents: [] as Array<{ title: string; date: string; entity: string; type: string }>,
        alerts,
        bodySnippet: bodyText.slice(0, 2000),
      };
    }, options.entity);

    return { success: true, data: data as FLAgentResult };
  } catch (err: any) {
    return { success: false, error: err.message };
  } finally {
    if (page) await page.close().catch(() => {});
    if (browserInstance) await browserInstance.close().catch(() => {});
  }
}

export const flRegisteredAgentScraper: ScraperModule<
  { entity?: string },
  FLAgentResult
> = {
  meta: {
    id: 'fl-registered-agent',
    name: 'Florida Registered Agent LLC',
    category: 'governance',
    version: '0.1.0',
    requiresAuth: true,
    credentialKeys: ['flra:username', 'flra:password'],
  },
  async execute(browser, env, input) {
    const username = await env.SCRAPE_KV.get('flra:username');
    const password = await env.SCRAPE_KV.get('flra:password');
    if (!username || !password) {
      return wrapResult('fl-registered-agent', false, undefined, 'FL Registered Agent credentials not configured in SCRAPE_KV (keys: flra:username, flra:password)');
    }
    const result = await scrapeFLRegisteredAgent(browser, { username, password }, { entity: input?.entity });
    return wrapResult('fl-registered-agent', result.success, result.data, result.error);
  },
};
