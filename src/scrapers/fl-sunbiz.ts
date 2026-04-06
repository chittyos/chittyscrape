import puppeteer from '@cloudflare/puppeteer';
import { wrapResult, resolveSelector, type ScraperModule } from './base';

export interface FLSunbizResult {
  entityName: string;
  documentNumber?: string;
  feiNumber?: string;
  status: string;
  formationDate?: string;
  entityType?: string;
  registeredAgent?: string;
  annualReportFiled?: boolean;
  lastReportYear?: number;
  principalAddress?: string;
  goodStanding: boolean;
  alerts: string[];
}

/**
 * Scrape Florida Division of Corporations (Sunbiz) entity lookup.
 *
 * Public lookup — no login required.
 * URL: https://search.sunbiz.org/Inquiry/CorporationSearch/
 *
 * Searches by entity name and extracts status, formation date,
 * registered agent, annual report filing status, and good standing.
 */
async function scrapeFLSunbiz(
  browser: Fetcher,
  entityName: string,
): Promise<{ success: boolean; data?: FLSunbizResult; error?: string }> {
  let browserInstance: any;
  let page: any;
  try {
    browserInstance = await puppeteer.launch(browser);
    page = await browserInstance.newPage();
    await page.setViewport({ width: 1280, height: 900 });

    await page.goto('https://search.sunbiz.org/Inquiry/CorporationSearch/ByName', {
      waitUntil: 'networkidle0',
      timeout: 25000,
    });

    // Enter entity name
    const nameInput = await resolveSelector(page, [
      '#SearchTerm',
      'input[name="SearchTerm"]',
      'input[id="SearchTerm"]',
      'input[type="text"]',
    ]);
    if (!nameInput) {
      return { success: false, error: 'Could not find search input on Sunbiz page' };
    }
    await page.type(nameInput, entityName);

    // Submit search
    const searchBtn = await resolveSelector(page, [
      'input[type="submit"][value="Search Now"]',
      'input[value="Search Now"]',
      'input[type="submit"]',
      'button[type="submit"]',
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
      return false;
    }, entityName);

    if (clicked) {
      await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 15000 }).catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    // Extract entity details from detail page
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

      const status = findValue('Status', 'Entity Status');
      const documentNumber = findValue('Document Number', 'Filing Number');
      const feiNumber = findValue('FEI/EIN Number', 'FEI Number');
      const formationDate = findValue('Date Filed', 'Filing Date', 'Date of Formation');
      const entityType = findValue('Filing Type', 'Entity Type');
      const registeredAgent = findValue('Registered Agent Name', 'Agent Name');
      const principalAddress = findValue('Principal Address', 'Principal Office');

      const goodStanding = status.toLowerCase().includes('active')
        && !bodyText.toLowerCase().includes('admin dissolution')
        && !bodyText.toLowerCase().includes('involuntarily dissolved');

      if (!goodStanding) alerts.push('NOT_IN_GOOD_STANDING');
      if (status.toLowerCase().includes('admin')) alerts.push('ADMIN_DISSOLUTION');
      if (status.toLowerCase().includes('inactive')) alerts.push('ENTITY_INACTIVE');

      // Check annual report status
      let annualReportFiled: boolean | undefined;
      let lastReportYear: number | undefined;
      const reportMatch = bodyText.match(/(?:Annual Report|Report Year).*?(\d{4})/i);
      if (reportMatch) lastReportYear = parseInt(reportMatch[1], 10);

      const currentYear = new Date().getFullYear();
      if (lastReportYear && lastReportYear < currentYear) {
        annualReportFiled = false;
        alerts.push('ANNUAL_REPORT_NOT_CURRENT');
      } else if (lastReportYear && lastReportYear >= currentYear) {
        annualReportFiled = true;
      }

      return {
        entityName: name,
        documentNumber: documentNumber || undefined,
        feiNumber: feiNumber || undefined,
        status: status || 'unknown',
        formationDate: formationDate || undefined,
        entityType: entityType || undefined,
        registeredAgent: registeredAgent || undefined,
        annualReportFiled,
        lastReportYear,
        principalAddress: principalAddress || undefined,
        goodStanding,
        alerts,
      };
    }, entityName);

    if (!entityData) {
      return { success: false, error: 'Could not extract entity data from Sunbiz' };
    }

    return { success: true, data: entityData };
  } catch (err: any) {
    return { success: false, error: err.message };
  } finally {
    if (page) await page.close().catch(() => {});
    if (browserInstance) await browserInstance.close().catch(() => {});
  }
}

export const flSunbizScraper: ScraperModule<
  { entityName: string },
  FLSunbizResult
> = {
  meta: {
    id: 'fl-sunbiz',
    name: 'Florida Sunbiz — Division of Corporations Lookup',
    category: 'governance',
    version: '0.1.0',
    requiresAuth: false,
  },
  async execute(browser, _env, input) {
    if (!input?.entityName?.trim()) {
      return wrapResult<FLSunbizResult>('fl-sunbiz', false, undefined, 'entityName is required');
    }
    const result = await scrapeFLSunbiz(browser, input.entityName.trim());
    return wrapResult('fl-sunbiz', result.success, result.data, result.error);
  },
};
