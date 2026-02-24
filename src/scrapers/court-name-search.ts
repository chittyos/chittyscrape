import puppeteer from '@cloudflare/puppeteer';
import { wrapResult, type ScraperModule } from './base';

export interface CaseMatch {
  caseNumber: string;
  parties?: string;
  court?: string;
  division?: string;
  status?: string;
  filingDate?: string;
  judge?: string;
}

export interface CourtNameSearchData {
  searchName: string;
  totalResults: number;
  cases: CaseMatch[];
}

export const courtNameSearchScraper: ScraperModule<
  { name: string; divisions?: string[] },
  CourtNameSearchData
> = {
  meta: {
    id: 'court-name-search',
    name: 'Cook County Court Name Search',
    category: 'court',
    version: '0.1.0',
    requiresAuth: false,
  },

  async execute(browser, env, input) {
    const searchName = input.name?.trim();
    if (!searchName) {
      return wrapResult<CourtNameSearchData>('court-name-search', false, undefined, 'name is required');
    }

    let browserInstance: any;
    let page: any;
    try {
      browserInstance = await puppeteer.launch(browser);
      page = await browserInstance.newPage();
      await page.setViewport({ width: 1280, height: 800 });

      const allCases: CaseMatch[] = [];

      // Cook County Circuit Clerk case search -- try API first
      const apiUrl = `https://casesearch.cookcountyclerkofcourt.org/CivilCaseSearchAPI/api/CivilCases?LastName=${encodeURIComponent(searchName)}`;

      await page.goto(apiUrl, {
        waitUntil: 'networkidle0',
        timeout: 30000,
      });

      const bodyText = await page.evaluate(() =>
        (globalThis as any).document?.body?.innerText || '',
      );

      let apiData: any;
      try {
        apiData = JSON.parse(bodyText);
      } catch {
        apiData = null;
      }

      if (apiData && Array.isArray(apiData)) {
        for (const item of apiData) {
          allCases.push({
            caseNumber: item.caseNumber || item.caseId || '',
            parties: item.caseTitle || item.parties || undefined,
            court: 'Cook County Circuit Court',
            division: item.division || item.caseType || undefined,
            status: item.caseStatus || item.status || undefined,
            filingDate: item.filingDate || item.fileDate || undefined,
            judge: item.judgeName || item.judge || undefined,
          });
        }
      }

      // If API didn't return results, try the HTML search page
      if (allCases.length === 0) {
        await page.goto('https://casesearch.cookcountyclerkofcourt.org/CivilCaseSearchAPI.html', {
          waitUntil: 'networkidle0',
          timeout: 20000,
        });

        const nameInput = await page.$('input[name="lastName"], #lastName, input[placeholder*="name" i]');
        if (nameInput) {
          await page.type('input[name="lastName"], #lastName, input[placeholder*="name" i]', searchName);

          const searchBtn = await page.$('button[type="submit"], #searchButton, .search-btn, input[type="submit"]');
          if (searchBtn) {
            await searchBtn.click();
            await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 15000 }).catch(() => {});
            await new Promise((r) => setTimeout(r, 2000));

            const htmlCases = await page.evaluate(() => {
              const doc = (globalThis as any).document;
              if (!doc) return [];
              const results: Array<{
                caseNumber: string;
                parties?: string;
                division?: string;
                status?: string;
                filingDate?: string;
              }> = [];
              const rows = doc.querySelectorAll('table tr, .search-result, .case-row, [data-testid="case-row"]');
              if (rows) {
                for (let i = 0; i < rows.length && i < 100; i++) {
                  const cells = rows[i].querySelectorAll('td');
                  if (cells.length >= 2) {
                    const caseNum = (cells[0]?.textContent || '').trim();
                    if (!caseNum || caseNum.toLowerCase().includes('case')) continue;
                    results.push({
                      caseNumber: caseNum,
                      parties: cells.length >= 2 ? (cells[1]?.textContent || '').trim() : undefined,
                      division: cells.length >= 3 ? (cells[2]?.textContent || '').trim() : undefined,
                      status: cells.length >= 4 ? (cells[3]?.textContent || '').trim() : undefined,
                      filingDate: cells.length >= 5 ? (cells[4]?.textContent || '').trim() : undefined,
                    });
                  }
                }
              }
              return results;
            });

            for (const c of htmlCases) {
              allCases.push({
                ...c,
                court: 'Cook County Circuit Court',
              });
            }
          }
        }
      }

      return wrapResult('court-name-search', true, {
        searchName,
        totalResults: allCases.length,
        cases: allCases,
      });
    } catch (err: any) {
      return wrapResult<CourtNameSearchData>('court-name-search', false, undefined, err.message);
    } finally {
      if (page) await page.close().catch(() => {});
      if (browserInstance) await browserInstance.close().catch(() => {});
    }
  },
};
