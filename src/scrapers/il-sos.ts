import puppeteer from '@cloudflare/puppeteer';
import { wrapResult, resolveSelector, type ScraperModule } from './base';

export interface ILEntityResult {
  entityName: string;
  fileNumber?: string;
  status: string;
  formationDate?: string;
  entityType?: string;
  registeredAgent?: string;
  annualReportDueDate?: string;
  annualReportFiled?: boolean;
  principalOffice?: string;
  goodStanding: boolean;
  alerts: string[];
}

/**
 * Scrape Illinois Secretary of State LLC/Corp lookup.
 *
 * Public lookup — no login required.
 * URL: https://www.ilsos.gov/corporatellc/CorporateLlcController
 *
 * Searches by entity name and extracts status, formation date,
 * registered agent, annual report status, and good standing.
 */
async function scrapeILSOS(
  browser: Fetcher,
  entityName: string,
): Promise<{ success: boolean; data?: ILEntityResult; error?: string }> {
  let browserInstance: any;
  let page: any;
  try {
    browserInstance = await puppeteer.launch(browser);
    page = await browserInstance.newPage();
    await page.setViewport({ width: 1280, height: 900 });

    await page.goto('https://www.ilsos.gov/corporatellc/CorporateLlcController', {
      waitUntil: 'networkidle0',
      timeout: 25000,
    });

    // Select "LLC Name" search type and enter name
    const nameInput = await resolveSelector(page, [
      '#LlcName',
      'input[name="llcName"]',
      'input[name="LlcName"]',
      'input[name="corporationName"]',
      '#corporationName',
      'input[type="text"]',
    ]);
    if (!nameInput) {
      return { success: false, error: 'Could not find entity name input on IL SOS page' };
    }
    await page.type(nameInput, entityName);

    // Submit search
    const searchBtn = await resolveSelector(page, [
      'input[type="submit"]',
      'button[type="submit"]',
      '#submit',
      'input[value="Search"]',
      'input[value="search"]',
    ]);
    if (!searchBtn) {
      return { success: false, error: 'Could not find search button' };
    }
    await page.click(searchBtn);
    await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 20000 }).catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Click matching entity in results
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
      const rows = doc.querySelectorAll('table tbody tr, .search-result');
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

    // Extract entity details
    const entityData = await page.evaluate((name: string) => {
      const doc = (globalThis as any).document;
      if (!doc) return null;
      const bodyText = doc.body?.innerText || '';
      const alerts: string[] = [];

      const findValue = (...labels: string[]): string => {
        for (const label of labels) {
          const regex = new RegExp(label + '\\s*:?\\s*(.+)', 'i');
          const match = bodyText.match(regex);
          if (match) return match[1].split('\n')[0].trim();
        }
        return '';
      };

      const status = findValue('Status', 'Entity Status', 'Filing Status');
      const formationDate = findValue('Organization Date', 'Date of Incorporation', 'Formation Date', 'Date Filed');
      const entityType = findValue('Entity Type', 'Filing Type', 'Type');
      const registeredAgent = findValue('Agent Name', 'Registered Agent');
      const principalOffice = findValue('Principal Office', 'Registered Office Address', 'Address');
      const fileNumber = findValue('File Number', 'File Nbr', 'Filing Number');

      const goodStanding = !bodyText.toLowerCase().includes('not in good standing')
        && !bodyText.toLowerCase().includes('involuntary dissolution')
        && !bodyText.toLowerCase().includes('revoked');

      if (!goodStanding) alerts.push('NOT_IN_GOOD_STANDING');
      if (status.toLowerCase().includes('involuntary')) alerts.push('INVOLUNTARY_DISSOLUTION');
      if (status.toLowerCase().includes('revoked')) alerts.push('ENTITY_REVOKED');

      // Check annual report status
      let annualReportDueDate: string | undefined;
      let annualReportFiled: boolean | undefined;
      const arMatch = bodyText.match(/annual report.*?(?:due|by)\s+(\d{1,2}\/\d{1,2}\/\d{4}|\w+\s+\d+,?\s+\d{4})/i);
      if (arMatch) annualReportDueDate = arMatch[1];
      if (bodyText.toLowerCase().includes('annual report') && bodyText.toLowerCase().includes('not filed')) {
        annualReportFiled = false;
        alerts.push('ANNUAL_REPORT_NOT_FILED');
      } else if (bodyText.toLowerCase().includes('annual report') && bodyText.toLowerCase().includes('filed')) {
        annualReportFiled = true;
      }

      return {
        entityName: name,
        fileNumber: fileNumber || undefined,
        status: status || 'unknown',
        formationDate: formationDate || undefined,
        entityType: entityType || undefined,
        registeredAgent: registeredAgent || undefined,
        annualReportDueDate,
        annualReportFiled,
        principalOffice: principalOffice || undefined,
        goodStanding,
        alerts,
      };
    }, entityName);

    if (!entityData) {
      return { success: false, error: 'Could not extract entity data from IL SOS' };
    }

    return { success: true, data: entityData };
  } catch (err: any) {
    return { success: false, error: err.message };
  } finally {
    if (page) await page.close().catch(() => {});
    if (browserInstance) await browserInstance.close().catch(() => {});
  }
}

export const ilSOSScraper: ScraperModule<
  { entityName: string },
  ILEntityResult
> = {
  meta: {
    id: 'il-sos',
    name: 'Illinois Secretary of State — LLC/Corp Lookup',
    category: 'governance',
    version: '0.1.0',
    requiresAuth: false,
  },
  async execute(browser, _env, input) {
    if (!input?.entityName?.trim()) {
      return wrapResult<ILEntityResult>('il-sos', false, undefined, 'entityName is required');
    }
    const result = await scrapeILSOS(browser, input.entityName.trim());
    return wrapResult('il-sos', result.success, result.data, result.error);
  },
};
