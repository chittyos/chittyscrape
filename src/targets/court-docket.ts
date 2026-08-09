import puppeteer from '@cloudflare/puppeteer';
import { wrapResult, type ScraperModule } from './base';

const CASE_SEARCH_URL = 'https://app.cookcountyclerkofcourt.org/case-search/';

export interface NormalizedCaseNumber {
  original: string;
  compact: string;
  candidates: string[];
}

interface DocketEntry {
  date: string;
  description: string;
  filedBy?: string;
}

interface DocketData {
  caseNumber: string;
  requestedCaseNumber: string;
  parties?: string;
  judge?: string;
  status?: string;
  entries: DocketEntry[];
  nextHearing?: string;
  sourceUrl: string;
  retrievalTimestamp: string;
}

interface DocketResult {
  success: boolean;
  data?: DocketData;
  error?: string;
}

export function normalizeCookCountyCaseNumber(value: string): NormalizedCaseNumber {
  const original = value.trim();
  const compact = original.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!compact) throw new Error('caseNumber is required');

  const candidates = new Set<string>([original, compact]);
  const numeric = compact.match(/^(\d{4})(\d{2})(\d{5})$/);
  if (numeric) {
    candidates.add(numeric[1] + '-' + numeric[2] + '-' + numeric[3]);
    candidates.add(numeric[1] + ' ' + numeric[2] + ' ' + numeric[3]);
  }
  const conventional = compact.match(/^(\d{4})([A-Z]{1,2}\d?)(\d{5,6})$/);
  if (conventional) {
    candidates.add(conventional[1] + ' ' + conventional[2] + ' ' + conventional[3]);
    candidates.add(conventional[1] + '-' + conventional[2] + '-' + conventional[3]);
  }
  return { original, compact, candidates: [...candidates] };
}

function stopReason(body: string): string | null {
  const text = body.toLowerCase();
  if (text.includes('captcha') || text.includes('verify you are human')) return 'CAPTCHA encountered';
  if (text.includes('sign in') || text.includes('log in')) return 'Login required';
  if (text.includes('no records') || text.includes('case not found')) return 'Case not found';
  return null;
}

async function enterCaseNumber(page: any, value: string): Promise<boolean> {
  const selector = await page.evaluate(() => {
    const doc = (globalThis as any).document;
    const inputs = Array.from(doc?.querySelectorAll('input') || []) as any[];
    const ranked = inputs.map((input) => {
      const label = input.id ? doc.querySelector('label[for="' + input.id + '"]')?.textContent || '' : '';
      const text = [input.name, input.id, input.placeholder, input.getAttribute('aria-label'), label]
        .filter(Boolean).join(' ').toLowerCase();
      return { input, score: (text.includes('case') ? 3 : 0) + (text.includes('number') ? 2 : 0) };
    }).sort((a, b) => b.score - a.score);
    const target = ranked[0];
    if (!target || target.score < 2) return null;
    if (!target.input.id) target.input.id = 'chitty-case-number';
    return '#' + target.input.id;
  });
  if (!selector) return false;
  await page.focus(selector);
  await page.evaluate((sel: string) => {
    const input = (globalThis as any).document.querySelector(sel);
    if (input) input.value = '';
  }, selector);
  await page.type(selector, value);
  return true;
}

async function submitSearch(page: any): Promise<boolean> {
  const clicked = await page.evaluate(() => {
    const doc = (globalThis as any).document;
    const controls = Array.from(doc?.querySelectorAll('button, input[type="submit"], input[type="button"]') || []) as any[];
    const button = controls.find((el) => {
      const text = [el.textContent, el.value, el.getAttribute('aria-label')].filter(Boolean).join(' ').toLowerCase();
      return text.includes('search') || text.includes('find') || text.includes('submit');
    });
    if (!button) return false;
    button.click();
    return true;
  });
  if (clicked) await new Promise((resolve) => setTimeout(resolve, 2500));
  return clicked;
}

async function extractDocket(page: any, requestedCaseNumber: string): Promise<DocketData | null> {
  return page.evaluate((requested: string, sourceUrl: string) => {
    const doc = (globalThis as any).document;
    const clean = (value: unknown) => String(value || '').replace(/\s+/g, ' ').trim();
    const body = clean(doc?.body?.innerText);
    const compactRequested = requested.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!body.toUpperCase().replace(/[^A-Z0-9]/g, '').includes(compactRequested)) return null;

    const entries: DocketEntry[] = [];
    const rows = Array.from(doc.querySelectorAll('table tr, [role="row"], .docket-row, .case-activity')) as any[];
    for (const row of rows) {
      const cells = Array.from(row.querySelectorAll('td, [role="cell"]')).map((cell: any) => clean(cell.textContent));
      const dateIndex = cells.findIndex((cell) => /\b\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}\b/.test(cell));
      if (dateIndex < 0 || cells.length < 2) continue;
      const description = cells.filter((_, index) => index !== dateIndex).join(' | ');
      if (description) entries.push({ date: cells[dateIndex], description });
    }

    const caseMatch = body.match(/\b20\d{2}[\s-]?(?:[A-Z]{1,2}\d?|\d{2})[\s-]?\d{5,6}\b/i);
    return {
      caseNumber: clean(caseMatch?.[0] || requested),
      requestedCaseNumber: requested,
      entries,
      sourceUrl,
      retrievalTimestamp: new Date().toISOString(),
    };
  }, requestedCaseNumber, page.url());
}

export async function scrapeCookCountyDocket(browser: Fetcher, caseNumber: string): Promise<DocketResult> {
  const normalized = normalizeCookCountyCaseNumber(caseNumber);
  let browserInstance: any;
  let page: any;
  const diagnostics: string[] = [];
  try {
    browserInstance = await puppeteer.launch(browser);
    page = await browserInstance.newPage();
    await page.setViewport({ width: 1440, height: 1000 });

    for (const candidate of normalized.candidates) {
      await page.goto(CASE_SEARCH_URL, { waitUntil: 'networkidle0', timeout: 45000 });
      const initial = await page.evaluate(() => (globalThis as any).document?.body?.innerText || '');
      const initialStop = stopReason(initial);
      if (initialStop === 'CAPTCHA encountered' || initialStop === 'Login required') return { success: false, error: initialStop };
      if (!(await enterCaseNumber(page, candidate))) return { success: false, error: 'Case-number input not found on current Clerk portal' };
      if (!(await submitSearch(page))) return { success: false, error: 'Search control not found on current Clerk portal' };

      const body = await page.evaluate(() => (globalThis as any).document?.body?.innerText || '');
      const stop = stopReason(body);
      if (stop === 'CAPTCHA encountered' || stop === 'Login required') return { success: false, error: stop };
      const data = await extractDocket(page, normalized.original);
      if (data) return { success: true, data };
      diagnostics.push(candidate + ': ' + (stop || 'unparseable result'));
    }
    return { success: false, error: 'Docket retrieval failed: ' + diagnostics.join('; ') };
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) };
  } finally {
    if (page) await page.close().catch(() => {});
    if (browserInstance) await browserInstance.close().catch(() => {});
  }
}

export const courtDocketScraper: ScraperModule<{ caseNumber?: string; case_number?: string }, DocketData> = {
  meta: { id: 'court-docket', name: 'Cook County Court Docket', category: 'court', version: '0.2.0', requiresAuth: false },
  async execute(browser, _env, input) {
    const caseNumber = input?.caseNumber?.trim() || input?.case_number?.trim();
    if (!caseNumber) return wrapResult('court-docket', false, undefined, 'caseNumber or case_number is required');
    const result = await scrapeCookCountyDocket(browser, caseNumber);
    return wrapResult('court-docket', result.success, result.data, result.error);
  },
};
