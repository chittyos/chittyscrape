import puppeteer from '@cloudflare/puppeteer';
import { wrapResult, resolveSelector, type ScraperModule } from './base';

export interface NWDocument {
  title: string;
  date: string;
  entity: string;
  type: 'service-of-process' | 'mail' | 'annual-report' | 'other';
  downloadUrl?: string;
  pdfBase64?: string;
}

export interface NWAgentResult {
  entity: string;
  accountStatus: string;
  documents: NWDocument[];
  mailForwardingStatus?: string;
  paymentStatus?: string;
  alerts: string[];
}

/**
 * Scrape Northwest Registered Agent portal for documents and account status.
 *
 * Logs in, navigates to the document inbox, and extracts:
 * - Service of Process documents (legal notices)
 * - Mail forwarding items
 * - Account/payment status
 * - Annual report reminders
 *
 * Credentials stored in SCRAPE_KV as nwra:username and nwra:password.
 */
async function scrapeNWRegisteredAgent(
  browser: Fetcher,
  credentials: { username: string; password: string },
  options: { entity?: string; downloadPdfs?: boolean },
): Promise<{ success: boolean; data?: NWAgentResult; error?: string }> {
  let browserInstance: any;
  let page: any;
  try {
    browserInstance = await puppeteer.launch(browser);
    page = await browserInstance.newPage();
    await page.setViewport({ width: 1280, height: 900 });

    // Navigate to NW login
    await page.goto('https://www.northwestregisteredagent.com/login', {
      waitUntil: 'networkidle0',
      timeout: 25000,
    });

    // Enter email/username
    const emailSelector = await resolveSelector(page, [
      '#email',
      'input[name="email"]',
      'input[type="email"]',
      '#username',
      'input[name="username"]',
      'input[placeholder*="email" i]',
      'input[placeholder*="username" i]',
    ]);
    if (!emailSelector) {
      return { success: false, error: 'Could not find email/username input on NW login page' };
    }
    await page.type(emailSelector, credentials.username);

    // Enter password
    const passwordSelector = await resolveSelector(page, [
      '#password',
      'input[name="password"]',
      'input[type="password"]',
      'input[placeholder*="password" i]',
    ]);
    if (!passwordSelector) {
      return { success: false, error: 'Could not find password input on NW login page' };
    }
    await page.type(passwordSelector, credentials.password);

    // Submit login
    const submitSelector = await resolveSelector(page, [
      'button[type="submit"]',
      'input[type="submit"]',
      'button.btn-primary',
      'button:has-text("Log In")',
      'button:has-text("Sign In")',
      '.login-button',
      '#loginButton',
    ]);
    if (!submitSelector) {
      return { success: false, error: 'Could not find login button on NW page' };
    }
    await page.click(submitSelector);

    // Wait for navigation after login
    await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 25000 }).catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Check for login failure
    const loginFailed = await page.evaluate(() => {
      const doc = (globalThis as any).document;
      if (!doc) return false;
      const url = (globalThis as any).location?.href || '';
      if (url.includes('/login') || url.includes('/signin')) return true;
      const errorSels = ['.error-message', '.alert-danger', '.alert-error', '.login-error', '[role="alert"]'];
      for (const sel of errorSels) {
        const el = doc.querySelector(sel);
        if (el && (el.textContent || '').trim().length > 0) return true;
      }
      return false;
    });

    if (loginFailed) {
      return { success: false, error: 'NW login failed — credentials may be incorrect, CAPTCHA, or 2FA required' };
    }

    // Extract account overview data
    const accountData = await page.evaluate(() => {
      const doc = (globalThis as any).document;
      if (!doc) return null;

      const text = (...selectors: string[]): string => {
        for (const sel of selectors) {
          try {
            const el = doc.querySelector(sel);
            if (el) {
              const t = (el.textContent || '').trim();
              if (t.length > 0) return t;
            }
          } catch { /* skip invalid selectors */ }
        }
        return '';
      };

      // Try to find account status, alerts, entity names
      const bodyText = doc.body?.innerText || '';
      const alerts: string[] = [];

      // Look for alert banners
      const alertEls = doc.querySelectorAll('.alert, .notification, .banner-warning, [role="alert"]');
      if (alertEls) {
        for (const el of alertEls) {
          const t = (el.textContent || '').trim();
          if (t.length > 5 && t.length < 500) alerts.push(t);
        }
      }

      // Check for payment failure indicators
      const paymentFailed = bodyText.includes('payment') && (bodyText.includes('failed') || bodyText.includes('declined'));
      if (paymentFailed) alerts.push('PAYMENT_FAILED');

      return {
        url: (globalThis as any).location?.href || '',
        alerts,
        bodySnippet: bodyText.slice(0, 2000),
      };
    });

    // Navigate to documents/inbox section
    const docsLinkSelector = await resolveSelector(page, [
      'a[href*="document"]',
      'a[href*="inbox"]',
      'a[href*="mail"]',
      'a[href*="service-of-process"]',
      'a[href*="legal"]',
      '.nav-link[href*="document"]',
      'a:has-text("Documents")',
      'a:has-text("Inbox")',
      'a:has-text("Mail")',
      'a:has-text("Service of Process")',
    ]);

    let documents: NWDocument[] = [];

    if (docsLinkSelector) {
      await page.click(docsLinkSelector);
      await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 20000 }).catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Extract document list
      documents = await page.evaluate((entityFilter: string | undefined) => {
        const doc = (globalThis as any).document;
        if (!doc) return [];

        const docs: Array<{
          title: string;
          date: string;
          entity: string;
          type: 'service-of-process' | 'mail' | 'annual-report' | 'other';
          downloadUrl?: string;
        }> = [];

        // Try table rows
        const rows = doc.querySelectorAll('table tbody tr, .document-row, .mail-item, .inbox-item');
        if (rows) {
          for (const row of rows) {
            const cells = row.querySelectorAll('td');
            const rowText = (row.textContent || '').trim();

            // Skip if entity filter doesn't match
            if (entityFilter && !rowText.toLowerCase().includes(entityFilter.toLowerCase())) continue;

            let title = '';
            let date = '';
            let entity = '';

            if (cells.length >= 2) {
              title = (cells[0]?.textContent || '').trim();
              date = (cells[1]?.textContent || '').trim();
              if (cells.length >= 3) entity = (cells[2]?.textContent || '').trim();
            } else {
              title = rowText.slice(0, 200);
            }

            // Classify document type
            const lower = rowText.toLowerCase();
            let type: 'service-of-process' | 'mail' | 'annual-report' | 'other' = 'other';
            if (lower.includes('service of process') || lower.includes('legal notice') || lower.includes('lawsuit')) {
              type = 'service-of-process';
            } else if (lower.includes('annual report') || lower.includes('renewal')) {
              type = 'annual-report';
            } else if (lower.includes('mail') || lower.includes('forwarding')) {
              type = 'mail';
            }

            // Try to find download link
            const link = row.querySelector('a[href*="download"], a[href*="pdf"], a[href*="view"], a.btn');
            const downloadUrl = link?.href || undefined;

            if (title) {
              docs.push({ title, date, entity, type, downloadUrl });
            }
          }
        }

        // Fallback: try card-based layout
        if (docs.length === 0) {
          const cards = doc.querySelectorAll('.card, .document-card, .mail-card, [data-document-id]');
          if (cards) {
            for (const card of cards) {
              const titleEl = card.querySelector('h3, h4, h5, .title, .subject, .document-title');
              const dateEl = card.querySelector('.date, .received-date, time');
              const entityEl = card.querySelector('.entity, .company, .business-name');

              const title = (titleEl?.textContent || '').trim();
              const cardText = (card.textContent || '').toLowerCase();

              if (!title) continue;
              if (entityFilter && !cardText.includes(entityFilter.toLowerCase())) continue;

              let type: 'service-of-process' | 'mail' | 'annual-report' | 'other' = 'other';
              if (cardText.includes('service of process')) type = 'service-of-process';
              else if (cardText.includes('annual report')) type = 'annual-report';
              else if (cardText.includes('mail')) type = 'mail';

              const link = card.querySelector('a[href*="download"], a[href*="pdf"], a[href*="view"]');

              docs.push({
                title,
                date: (dateEl?.textContent || '').trim(),
                entity: (entityEl?.textContent || '').trim(),
                type,
                downloadUrl: link?.href || undefined,
              });
            }
          }
        }

        return docs;
      }, options.entity);
    }

    // If requested, download PDFs for service-of-process documents
    if (options.downloadPdfs) {
      for (const doc of documents) {
        if (doc.type === 'service-of-process' && doc.downloadUrl) {
          try {
            // Click through to the document and capture PDF
            await page.goto(doc.downloadUrl, { waitUntil: 'networkidle0', timeout: 15000 });
            await new Promise((resolve) => setTimeout(resolve, 2000));

            // Try to capture the page as PDF
            const pdfBuffer = await page.pdf({ format: 'letter', printBackground: true });
            if (pdfBuffer) {
              const base64 = Buffer.from(pdfBuffer).toString('base64');
              doc.pdfBase64 = base64;
            }
          } catch (err: any) {
            // PDF download is best-effort
            console.error(`Failed to download PDF for ${doc.title}: ${err.message}`);
          }
        }
      }
    }

    const alerts = accountData?.alerts || [];

    return {
      success: true,
      data: {
        entity: options.entity || 'all',
        accountStatus: alerts.includes('PAYMENT_FAILED') ? 'payment_failed' : 'active',
        documents,
        paymentStatus: alerts.includes('PAYMENT_FAILED') ? 'failed' : 'ok',
        alerts,
      },
    };
  } catch (err: any) {
    return { success: false, error: err.message };
  } finally {
    if (page) await page.close().catch(() => {});
    if (browserInstance) await browserInstance.close().catch(() => {});
  }
}

export const nwRegisteredAgentScraper: ScraperModule<
  { entity?: string; downloadPdfs?: boolean },
  NWAgentResult
> = {
  meta: {
    id: 'nw-registered-agent',
    name: 'Northwest Registered Agent',
    category: 'governance',
    version: '0.1.0',
    requiresAuth: true,
    credentialKeys: ['nwra:username', 'nwra:password'],
  },
  async execute(browser, env, input) {
    const username = await env.SCRAPE_KV.get('nwra:username');
    const password = await env.SCRAPE_KV.get('nwra:password');
    if (!username || !password) {
      return wrapResult('nw-registered-agent', false, undefined, 'NW Registered Agent credentials not configured in SCRAPE_KV (keys: nwra:username, nwra:password)');
    }
    const result = await scrapeNWRegisteredAgent(
      browser,
      { username, password },
      { entity: input?.entity, downloadPdfs: input?.downloadPdfs ?? true },
    );
    return wrapResult('nw-registered-agent', result.success, result.data, result.error);
  },
};
