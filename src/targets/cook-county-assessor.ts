import puppeteer from '@cloudflare/puppeteer';
import { wrapResult, resolveSelector, type ScraperModule } from './base';

export interface AssessorResult {
  pin: string;
  address?: string;
  assessedValue?: number;
  marketValue?: number;
  taxYear?: number;
  township?: string;
  triennial?: string;
  appealWindowOpen?: boolean;
  appealDeadline?: string;
  exemptions?: string[];
  alerts: string[];
}

/**
 * Scrape Cook County Assessor for property assessment details and appeal windows.
 *
 * Public lookup — no login required.
 * URL: https://www.cookcountyassessor.com/
 *
 * Searches by PIN and extracts assessed value, market value, triennial
 * reassessment info, appeal window dates, and exemptions.
 */
async function scrapeCookCountyAssessor(
  browser: Fetcher,
  pin: string,
): Promise<{ success: boolean; data?: AssessorResult; error?: string }> {
  const cleanPin = pin.replace(/-/g, '');
  let browserInstance: any;
  let page: any;
  try {
    browserInstance = await puppeteer.launch(browser);
    page = await browserInstance.newPage();
    await page.setViewport({ width: 1280, height: 900 });

    // Go directly to PIN lookup
    await page.goto(`https://www.cookcountyassessor.com/pin/${cleanPin}`, {
      waitUntil: 'networkidle0',
      timeout: 25000,
    });
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Extract assessment data
    const result = await page.evaluate((pinStr: string) => {
      const doc = (globalThis as any).document;
      if (!doc) return null;
      const bodyText = doc.body?.innerText || '';
      const alerts: string[] = [];

      const findValue = (...labels: string[]): string => {
        for (const label of labels) {
          const regex = new RegExp(label + '\\s*:?\\s*([\\$\\d,.]+|\\S+)', 'i');
          const match = bodyText.match(regex);
          if (match) return match[1].trim();
        }
        return '';
      };

      const address = findValue('Property Address', 'Address', 'Location');
      const assessedStr = findValue('Assessed Value', 'Assessed Valuation');
      const marketStr = findValue('Market Value', 'Fair Market Value', 'Estimated Market Value');
      const taxYearStr = findValue('Tax Year', 'Assessment Year');
      const township = findValue('Township', 'Tax Township');
      const triennial = findValue('Triennial', 'Reassessment');

      const assessedValue = assessedStr ? parseFloat(assessedStr.replace(/[$,]/g, '')) : undefined;
      const marketValue = marketStr ? parseFloat(marketStr.replace(/[$,]/g, '')) : undefined;
      const taxYear = taxYearStr ? parseInt(taxYearStr, 10) : undefined;

      // Check appeal window
      let appealWindowOpen = false;
      let appealDeadline: string | undefined;
      const appealMatch = bodyText.match(/appeal.*?(?:deadline|by|before)\s+(\d{1,2}\/\d{1,2}\/\d{4}|\w+\s+\d+,?\s+\d{4})/i);
      if (appealMatch) {
        appealDeadline = appealMatch[1];
        appealWindowOpen = true;
        alerts.push('APPEAL_WINDOW_OPEN');
      }
      if (bodyText.toLowerCase().includes('appeal period') && bodyText.toLowerCase().includes('open')) {
        appealWindowOpen = true;
        if (!alerts.includes('APPEAL_WINDOW_OPEN')) alerts.push('APPEAL_WINDOW_OPEN');
      }

      // Extract exemptions
      const exemptions: string[] = [];
      const exemptionPatterns = ['Homeowner', 'Senior', 'Senior Freeze', 'Disabled', 'Veteran', 'Long-time Homeowner'];
      for (const ex of exemptionPatterns) {
        if (bodyText.toLowerCase().includes(ex.toLowerCase() + ' exemption')) {
          exemptions.push(ex);
        }
      }

      if (assessedValue && marketValue && assessedValue > marketValue * 0.1 * 1.15) {
        alerts.push('ASSESSMENT_MAY_BE_HIGH');
      }

      return {
        pin: pinStr,
        address: address || undefined,
        assessedValue: isNaN(assessedValue!) ? undefined : assessedValue,
        marketValue: isNaN(marketValue!) ? undefined : marketValue,
        taxYear: isNaN(taxYear!) ? undefined : taxYear,
        township: township || undefined,
        triennial: triennial || undefined,
        appealWindowOpen,
        appealDeadline,
        exemptions: exemptions.length > 0 ? exemptions : undefined,
        alerts,
      };
    }, pin) as AssessorResult | null;

    if (!result) {
      return { success: false, error: 'Could not extract assessor data' };
    }

    return { success: true, data: result };
  } catch (err: any) {
    return { success: false, error: err.message };
  } finally {
    if (page) await page.close().catch(() => {});
    if (browserInstance) await browserInstance.close().catch(() => {});
  }
}

export const cookCountyAssessorScraper: ScraperModule<
  { pin: string },
  AssessorResult
> = {
  meta: {
    id: 'cook-county-assessor',
    name: 'Cook County Assessor — Property Assessment & Appeal Window',
    category: 'tax',
    version: '0.1.0',
    requiresAuth: false,
  },
  async execute(browser, _env, input) {
    if (!input?.pin?.trim()) {
      return wrapResult<AssessorResult>('cook-county-assessor', false, undefined, 'pin is required');
    }
    const result = await scrapeCookCountyAssessor(browser, input.pin.trim());
    return wrapResult('cook-county-assessor', result.success, result.data, result.error);
  },
};
