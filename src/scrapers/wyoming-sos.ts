import puppeteer from '@cloudflare/puppeteer';
import { wrapResult, resolveSelector, type ScraperModule } from './base';

export interface WyomingEntityResult {
  entityName: string;
  filingId?: string;
  status: string;
  formationDate?: string;
  entityType?: string;
  registeredAgent?: string;
  annualReportDue?: string;
  annualReportFiled?: boolean;
  principalOffice?: string;
  alerts: string[];
}

/**
 * Scrape Wyoming Secretary of State business entity lookup.
 *
 * Public lookup — no login required.
 * URL: https://wyobiz.wyo.gov/Business/FilingSearch.aspx
 *
 * Searches by entity name and extracts status, formation date,
 * registered agent, and annual report compliance.
 */
async function scrapeWyomingSOS(
  browser: Fetcher,
  entityName: string,
): Promise<{ success: boolean; data?: WyomingEntityResult; error?: string }> {
  let browserInstance: any;
  let page: any;
  try {
    browserInstance = await puppeteer.launch(browser);
    page = await browserInstance.newPage();
    await page.setViewport({ width: 1280, height: 900 });

    // Navigate to WY SOS business search
    await page.goto('https://wyobiz.wyo.gov/Business/FilingSearch.aspx', {
      waitUntil: 'networkidle0',
      timeout: 25000,
    });

    // Enter entity name in search box
    const searchSelector = await resolveSelector(page, [
      '#MainContent_txtFilingName',
      'input[name*="FilingName"]',
      'input[name*="searchName"]',
      '#searchInput',
      'input[type="text"]',
    ]);
    if (!searchSelector) {
      return { success: false, error: 'Could not find entity name search input on WY SOS page' };
    }
    await page.type(searchSelector, entityName);

    // Click search button
    const searchBtn = await resolveSelector(page, [
      '#MainContent_cmdSearch',
      'input[name*="cmdSearch"]',
      'button[type="submit"]',
      'input[type="submit"]',
      '#btnSearch',
    ]);
    if (!searchBtn) {
      return { success: false, error: 'Could not find search button' };
    }
    await page.click(searchBtn);
    await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 20000 }).catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Look for search results and click the matching entity
    const clicked = await page.evaluate((name: string) => {
      const doc = (globalThis as any).document;
      if (!doc) return false;
      const links = doc.querySelectorAll('a');
      const nameLower = name.toLowerCase();
      for (const link of links) {
        const text = (link.textContent || '').trim().toLowerCase();
        if (text.includes(nameLower) || nameLower.includes(text)) {
          link.click();
          return true;
        }
      }
      // Try table rows
      const rows = doc.querySelectorAll('table tbody tr, .grid-row, .search-result');
      for (const row of rows) {
        const rowText = (row.textContent || '').trim().toLowerCase();
        if (rowText.includes(nameLower)) {
          const link = row.querySelector('a');
          if (link) { link.click(); return true; }
        }
      }
      return false;
    }, entityName);

    if (clicked) {
      await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 15000 }).catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    // Extract entity details from the detail page or search results
    const entityData = await page.evaluate((name: string) => {
      const doc = (globalThis as any).document;
      if (!doc) return null;
      const bodyText = doc.body?.innerText || '';
      const alerts: string[] = [];

      // Helper to extract labeled value
      const findValue = (...labels: string[]): string => {
        for (const label of labels) {
          const regex = new RegExp(label + '\\s*:?\\s*(.+)', 'i');
          const match = bodyText.match(regex);
          if (match) return match[1].split('\n')[0].trim();
        }
        return '';
      };

      const status = findValue('Status', 'Entity Status', 'Filing Status');
      const formationDate = findValue('Formation Date', 'Filed Date', 'Date of Formation', 'Date Filed');
      const entityType = findValue('Entity Type', 'Filing Type', 'Type');
      const registeredAgent = findValue('Registered Agent', 'Agent');
      const principalOffice = findValue('Principal Office', 'Principal Address', 'Mailing Address');
      const filingId = findValue('Filing ID', 'Filing Number', 'Entity ID');

      // Check for compliance issues
      if (status.toLowerCase().includes('inactive') || status.toLowerCase().includes('delinquent')) {
        alerts.push('ENTITY_NOT_ACTIVE');
      }
      if (bodyText.toLowerCase().includes('annual report') && bodyText.toLowerCase().includes('due')) {
        alerts.push('ANNUAL_REPORT_DUE');
      }
      if (status.toLowerCase().includes('dissolved') || status.toLowerCase().includes('revoked')) {
        alerts.push('ENTITY_DISSOLVED');
      }

      // Try to find annual report info
      let annualReportDue: string | undefined;
      const arMatch = bodyText.match(/annual report.*?(?:due|by)\s+(\d{1,2}\/\d{1,2}\/\d{4}|\w+\s+\d+,?\s+\d{4})/i);
      if (arMatch) annualReportDue = arMatch[1];

      return {
        entityName: name,
        filingId: filingId || undefined,
        status: status || 'unknown',
        formationDate: formationDate || undefined,
        entityType: entityType || undefined,
        registeredAgent: registeredAgent || undefined,
        annualReportDue,
        annualReportFiled: !alerts.includes('ANNUAL_REPORT_DUE'),
        principalOffice: principalOffice || undefined,
        alerts,
      };
    }, entityName);

    if (!entityData) {
      return { success: false, error: 'Could not extract entity data from WY SOS' };
    }

    return { success: true, data: entityData };
  } catch (err: any) {
    return { success: false, error: err.message };
  } finally {
    if (page) await page.close().catch(() => {});
    if (browserInstance) await browserInstance.close().catch(() => {});
  }
}

export const wyomingSOSScraper: ScraperModule<
  { entityName: string },
  WyomingEntityResult
> = {
  meta: {
    id: 'wyoming-sos',
    name: 'Wyoming Secretary of State — Entity Lookup',
    category: 'governance',
    version: '0.1.0',
    requiresAuth: false,
  },
  async execute(browser, _env, input) {
    if (!input?.entityName?.trim()) {
      return wrapResult('wyoming-sos', false, undefined, 'entityName is required');
    }
    const result = await scrapeWyomingSOS(browser, input.entityName.trim());
    return wrapResult('wyoming-sos', result.success, result.data, result.error);
  },
};
