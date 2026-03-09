import puppeteer from '@cloudflare/puppeteer';
import { wrapResult, type ScraperModule } from './base';

export interface TaxInstallment {
  number: number;
  amount: number;
  dueDate: string;
  status: string; // 'paid', 'unpaid', 'partial'
}

export interface TaxResult {
  success: boolean;
  data?: {
    pin: string;
    address?: string;
    taxYear: number;
    installments: TaxInstallment[];
    totalTax: number;
    exemptions?: string[];
  };
  error?: string;
}

/**
 * Scrape Cook County Treasurer property tax data by PIN.
 *
 * Navigates to cookcountytreasurer.com, searches by PIN, and extracts
 * tax year, installment amounts/due dates/paid status, total tax, and exemptions.
 *
 * NOTE: CSS selectors are placeholders based on typical government tax portal
 * structure and will need verification/adaptation against the live site.
 */
export async function scrapeCookCountyTax(browser: Fetcher, pin: string): Promise<TaxResult> {
  // Strip dashes from PIN (e.g. "12-34-567-890-0000" -> "12345678900000")
  const cleanPin = pin.replace(/-/g, '');

  let browserInstance: any;
  let page: any;
  try {
    browserInstance = await puppeteer.launch(browser);
    page = await browserInstance.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    // Navigate to the Cook County Treasurer property tax search page
    await page.goto('https://www.cookcountytreasurer.com/setsearchparameters.aspx', {
      waitUntil: 'networkidle0',
      timeout: 30000,
    });

    // Enter the PIN into the search field
    // Selector: the PIN search input on the Treasurer site
    // NOTE: selector needs verification against live site
    const pinInputSelector = '#ContentPlaceHolder1_ASPxRoundPanel1_tbPin';
    await page.waitForSelector(pinInputSelector, { timeout: 10000 });
    await page.type(pinInputSelector, cleanPin);

    // Click search button
    // NOTE: selector needs verification against live site
    const searchButtonSelector = '#ContentPlaceHolder1_ASPxRoundPanel1_btSearch';
    await page.click(searchButtonSelector);

    // Wait for results to load
    await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 20000 }).catch(() => {
      // Some pages update via AJAX without full navigation
    });

    // Allow time for any dynamic content to render
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Extract tax data from the results page
    // NOTE: All selectors below are reasonable placeholders based on typical
    // Cook County Treasurer page structure. They MUST be verified against the
    // live site and updated accordingly.
    const taxData = await page.evaluate((inputPin: string) => {
      const doc = (globalThis as any).document;
      if (!doc) return null;

      // Helper to extract text content from a selector, trimmed
      const text = (sel: string): string => {
        const el = doc.querySelector(sel);
        return el ? (el.textContent || '').trim() : '';
      };

      // Helper to parse currency string to number
      const parseCurrency = (s: string): number => {
        const cleaned = s.replace(/[$,]/g, '');
        const val = parseFloat(cleaned);
        return isNaN(val) ? 0 : val;
      };

      // Try to get the property address
      // NOTE: selector needs verification
      const address = text('#ContentPlaceHolder1_lblPropertyAddress')
        || text('.property-address')
        || text('[data-field="address"]')
        || undefined;

      // Tax year -- try multiple possible selectors
      // NOTE: selectors need verification
      const taxYearText = text('#ContentPlaceHolder1_lblTaxYear')
        || text('.tax-year')
        || text('[data-field="taxyear"]')
        || '';
      const taxYear = parseInt(taxYearText, 10) || new Date().getFullYear() - 1;

      // Parse installments from the results table
      // The Treasurer site typically shows 1st and 2nd installment info
      // NOTE: table/row selectors need verification
      const installments: Array<{
        number: number;
        amount: number;
        dueDate: string;
        status: string;
      }> = [];

      // Try table-based layout first
      const rows = doc.querySelectorAll(
        '#ContentPlaceHolder1_GridView1 tr, .tax-detail-table tr, .installment-row'
      );

      if (rows && rows.length > 1) {
        // Skip header row (index 0)
        for (let i = 1; i < rows.length && i <= 2; i++) {
          const cells = rows[i].querySelectorAll('td');
          if (cells.length >= 3) {
            installments.push({
              number: i,
              amount: parseCurrency(cells[1]?.textContent || '0'),
              dueDate: (cells[2]?.textContent || '').trim(),
              status: determinePaidStatus(cells),
            });
          }
        }
      }

      // Fallback: try specific labeled elements for 1st and 2nd installment
      // NOTE: selectors need verification
      if (installments.length === 0) {
        const first = text('#ContentPlaceHolder1_lbl1stInstallment')
          || text('.first-installment-amount');
        const second = text('#ContentPlaceHolder1_lbl2ndInstallment')
          || text('.second-installment-amount');
        const firstDue = text('#ContentPlaceHolder1_lbl1stDueDate')
          || text('.first-installment-due');
        const secondDue = text('#ContentPlaceHolder1_lbl2ndDueDate')
          || text('.second-installment-due');
        const firstStatus = text('#ContentPlaceHolder1_lbl1stStatus')
          || text('.first-installment-status');
        const secondStatus = text('#ContentPlaceHolder1_lbl2ndStatus')
          || text('.second-installment-status');

        if (first) {
          installments.push({
            number: 1,
            amount: parseCurrency(first),
            dueDate: firstDue || 'March 1',
            status: normalizeStatus(firstStatus),
          });
        }
        if (second) {
          installments.push({
            number: 2,
            amount: parseCurrency(second),
            dueDate: secondDue || 'August 1',
            status: normalizeStatus(secondStatus),
          });
        }
      }

      // Total tax
      // NOTE: selector needs verification
      const totalTaxText = text('#ContentPlaceHolder1_lblTotalTax')
        || text('.total-tax-amount')
        || text('[data-field="totaltax"]')
        || '';
      let totalTax = parseCurrency(totalTaxText);
      // If we couldn't find a total, sum the installments
      if (totalTax === 0 && installments.length > 0) {
        totalTax = installments.reduce((sum, inst) => sum + inst.amount, 0);
      }

      // Exemptions
      // NOTE: selector needs verification
      const exemptions: string[] = [];
      const exemptionEls = doc.querySelectorAll(
        '#ContentPlaceHolder1_ExemptionGrid tr td:first-child, .exemption-item, .exemption-type'
      );
      if (exemptionEls) {
        for (const el of exemptionEls) {
          const val = (el.textContent || '').trim();
          if (val && val.toLowerCase() !== 'exemption type' && val.toLowerCase() !== 'type') {
            exemptions.push(val);
          }
        }
      }

      // Helper: determine paid status from table cells
      function determinePaidStatus(cells: any): string {
        for (const cell of cells) {
          const t = (cell.textContent || '').toLowerCase();
          if (t.includes('paid')) return 'paid';
          if (t.includes('partial')) return 'partial';
          if (t.includes('unpaid') || t.includes('due') || t.includes('outstanding')) return 'unpaid';
        }
        return 'unpaid';
      }

      // Helper: normalize a status string
      function normalizeStatus(raw: string): string {
        const lower = raw.toLowerCase();
        if (lower.includes('paid') && !lower.includes('unpaid')) return 'paid';
        if (lower.includes('partial')) return 'partial';
        return 'unpaid';
      }

      return {
        pin: inputPin,
        address: address || undefined,
        taxYear,
        installments,
        totalTax,
        exemptions: exemptions.length > 0 ? exemptions : undefined,
      };
    }, cleanPin);

    if (!taxData) {
      return {
        success: false,
        error: 'Could not extract tax data -- page structure may have changed',
      };
    }

    // Verify we got meaningful data
    if (taxData.installments.length === 0 && taxData.totalTax === 0) {
      return {
        success: false,
        error: 'No tax data found for the given PIN -- verify PIN is correct or selectors need updating',
      };
    }

    return {
      success: true,
      data: taxData,
    };
  } catch (err: any) {
    return { success: false, error: err.message };
  } finally {
    if (page) await page.close().catch(() => {});
    if (browserInstance) await browserInstance.close().catch(() => {});
  }
}

export const cookCountyTaxScraper: ScraperModule<{ pin: string }, TaxResult['data']> = {
  meta: {
    id: 'cook-county-tax',
    name: 'Cook County Property Tax',
    category: 'tax',
    version: '0.1.0',
    requiresAuth: false,
  },
  async execute(browser, env, input) {
    if (!input?.pin?.trim()) {
      return wrapResult('cook-county-tax', false, undefined, 'pin is required');
    }
    const result = await scrapeCookCountyTax(browser, input.pin);
    return wrapResult('cook-county-tax', result.success, result.data, result.error);
  },
};
