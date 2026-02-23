import puppeteer from '@cloudflare/puppeteer';

interface DocketEntry {
  date: string;
  description: string;
  filedBy?: string;
}

interface DocketResult {
  success: boolean;
  data?: {
    caseNumber: string;
    parties?: string;
    judge?: string;
    status?: string;
    entries: DocketEntry[];
    nextHearing?: string;
  };
  error?: string;
}

export async function scrapeCookCountyDocket(browser: Fetcher, caseNumber: string): Promise<DocketResult> {
  let browserInstance: any;
  let page: any;
  try {
    browserInstance = await puppeteer.launch(browser);
    page = await browserInstance.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    // Cook County Circuit Clerk has a civil case search
    // Try the case search page
    await page.goto('https://casesearch.cookcountyclerkofcourt.org/CivilCaseSearchAPI/api/CivilCases', {
      waitUntil: 'networkidle0',
      timeout: 20000,
    });

    // Try direct case lookup
    await page.goto(`https://casesearch.cookcountyclerkofcourt.org/CivilCaseSearchAPI/api/CivilCases/${caseNumber}`, {
      waitUntil: 'networkidle0',
      timeout: 20000,
    });

    // Try to get page content as JSON (API endpoint may return JSON directly)
    // The callback runs in the browser context where `document` exists
    const bodyText = await page.evaluate(() => (globalThis as any).document?.body?.innerText || '');

    let caseData: any;
    try {
      caseData = JSON.parse(bodyText);
    } catch {
      caseData = null;
    }

    if (caseData) {
      const entries: DocketEntry[] = (caseData.activities || caseData.docketEntries || []).map((e: any) => ({
        date: e.activityDate || e.date || '',
        description: e.activityDescription || e.description || '',
        filedBy: e.filedBy || undefined,
      }));

      return {
        success: true,
        data: {
          caseNumber,
          parties: caseData.caseTitle || caseData.parties || undefined,
          judge: caseData.judgeName || caseData.judge || undefined,
          status: caseData.caseStatus || caseData.status || undefined,
          entries,
          nextHearing: caseData.nextCourtDate || caseData.nextHearing || undefined,
        },
      };
    }

    // Fallback -- if the page isn't JSON, try HTML scraping
    // This will need to be adapted after testing against the actual live site
    return {
      success: false,
      error: 'Could not parse case data -- site may require HTML scraping adaptation',
    };
  } catch (err: any) {
    return { success: false, error: err.message };
  } finally {
    if (page) await page.close().catch(() => {});
    if (browserInstance) await browserInstance.close().catch(() => {});
  }
}
