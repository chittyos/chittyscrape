import puppeteer from '@cloudflare/puppeteer';
import { wrapResult, resolveSelector, type ScraperModule } from './base';

export interface RecorderFiling {
  documentNumber: string;
  recordedDate: string;
  documentType: string;
  grantorGrantee?: string;
  pages?: number;
}

export interface RecorderResult {
  pin: string;
  filings: RecorderFiling[];
  totalFilings: number;
  alerts: string[];
}

/**
 * Scrape Cook County Recorder of Deeds for filings against a property PIN.
 *
 * Public lookup — no login required.
 * URL: https://www.cookcountyrecorder.com/
 *
 * Searches by PIN and extracts recent filings: liens, releases, deeds,
 * lis pendens, mortgages. Alerts on new filings that may need attention.
 */
async function scrapeCookCountyRecorder(
  browser: Fetcher,
  pin: string,
): Promise<{ success: boolean; data?: RecorderResult; error?: string }> {
  const cleanPin = pin.replace(/-/g, '');
  let browserInstance: any;
  let page: any;
  try {
    browserInstance = await puppeteer.launch(browser);
    page = await browserInstance.newPage();
    await page.setViewport({ width: 1280, height: 900 });

    await page.goto('https://www.cookcountyrecorder.com/', {
      waitUntil: 'networkidle0',
      timeout: 25000,
    });

    // Try to find PIN search tab or input
    const pinTab = await resolveSelector(page, [
      'a[href*="PIN"]',
      'a[href*="pin"]',
      '#tabPIN',
      'a:contains("PIN")',
      '[data-tab="pin"]',
    ]);
    if (pinTab) {
      await page.click(pinTab);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    const pinInput = await resolveSelector(page, [
      '#PINSearch',
      'input[name="PIN"]',
      'input[name="pin"]',
      'input[placeholder*="PIN" i]',
      'input[placeholder*="property" i]',
      '#txtPIN',
      'input[type="text"]',
    ]);
    if (!pinInput) {
      return { success: false, error: 'Could not find PIN search input on Recorder page' };
    }
    await page.type(pinInput, cleanPin);

    const searchBtn = await resolveSelector(page, [
      'input[type="submit"]',
      'button[type="submit"]',
      '#btnSearch',
      'button.search-btn',
    ]);
    if (!searchBtn) {
      return { success: false, error: 'Could not find search button' };
    }
    await page.click(searchBtn);
    await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 20000 }).catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Extract filings from results
    const result = await page.evaluate((pinStr: string) => {
      const doc = (globalThis as any).document;
      if (!doc) return null;
      const alerts: string[] = [];
      const filings: RecorderFiling[] = [];

      // Parse table rows
      const rows = doc.querySelectorAll('table tbody tr, .result-row, .filing-row');
      for (const row of rows) {
        const cells = row.querySelectorAll('td, .cell');
        if (cells.length < 3) continue;

        const filing: RecorderFiling = {
          documentNumber: (cells[0]?.textContent || '').trim(),
          recordedDate: (cells[1]?.textContent || '').trim(),
          documentType: (cells[2]?.textContent || '').trim(),
          grantorGrantee: cells[3] ? (cells[3].textContent || '').trim() : undefined,
          pages: cells[4] ? parseInt(cells[4].textContent || '0', 10) : undefined,
        };

        if (filing.documentNumber && filing.documentType) {
          filings.push(filing);
        }

        // Alert on concerning document types
        const dtype = filing.documentType.toLowerCase();
        if (dtype.includes('lis pendens') || dtype.includes('lien') || dtype.includes('judgment')) {
          alerts.push(`CONCERNING_FILING: ${filing.documentType} recorded ${filing.recordedDate}`);
        }
      }

      // If no table rows, try to parse from body text
      if (filings.length === 0) {
        const bodyText = doc.body?.innerText || '';
        if (bodyText.toLowerCase().includes('no results') || bodyText.toLowerCase().includes('no records')) {
          // No filings is fine
        } else if (bodyText.toLowerCase().includes('lis pendens') || bodyText.toLowerCase().includes('lien')) {
          alerts.push('POSSIBLE_LIEN_OR_LIS_PENDENS_DETECTED');
        }
      }

      return {
        pin: pinStr,
        filings,
        totalFilings: filings.length,
        alerts,
      };
    }, pin) as RecorderResult | null;

    if (!result) {
      return { success: false, error: 'Could not extract recorder data' };
    }

    return { success: true, data: result };
  } catch (err: any) {
    return { success: false, error: err.message };
  } finally {
    if (page) await page.close().catch(() => {});
    if (browserInstance) await browserInstance.close().catch(() => {});
  }
}

export const cookCountyRecorderScraper: ScraperModule<
  { pin: string },
  RecorderResult
> = {
  meta: {
    id: 'cook-county-recorder',
    name: 'Cook County Recorder of Deeds — PIN Filing Search',
    category: 'governance',
    version: '0.1.0',
    requiresAuth: false,
  },
  async execute(browser, _env, input) {
    if (!input?.pin?.trim()) {
      return wrapResult<RecorderResult>('cook-county-recorder', false, undefined, 'pin is required');
    }
    const result = await scrapeCookCountyRecorder(browser, input.pin.trim());
    return wrapResult('cook-county-recorder', result.success, result.data, result.error);
  },
};
