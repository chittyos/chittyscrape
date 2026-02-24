import type { Env } from '../index';

export type ScraperCategory = 'utility' | 'court' | 'mortgage' | 'tax' | 'hoa' | 'governance' | 'generic';

export interface ScraperMeta {
  id: string;
  name: string;
  category: ScraperCategory;
  version: string;
  requiresAuth: boolean;
  credentialKeys?: string[];
}

export interface ScrapeResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  method: 'scrape';
  portal: string;
  scrapedAt: string;
}

export interface ScraperModule<TInput = unknown, TOutput = unknown> {
  meta: ScraperMeta;
  execute(browser: Fetcher, env: Env, input: TInput): Promise<ScrapeResult<TOutput>>;
}

export function wrapResult<T>(
  portal: string,
  success: boolean,
  data?: T,
  error?: string,
): ScrapeResult<T> {
  return {
    success,
    data,
    error,
    method: 'scrape',
    portal,
    scrapedAt: new Date().toISOString(),
  };
}

/**
 * Try multiple CSS selectors and return the first one that matches an element.
 * Returns null if none match. Shared across all scrapers that need resilient selectors.
 */
export async function resolveSelector(page: any, selectors: string[]): Promise<string | null> {
  for (const selector of selectors) {
    try {
      const el = await page.$(selector);
      if (el) return selector;
    } catch {
      // Some selectors (like :has-text) may not be valid CSS -- skip
    }
  }
  return null;
}
