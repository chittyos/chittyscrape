import type { Env } from '../index';
import type { ScraperModule, ScraperMeta, ScrapeResult } from './base';
import { wrapResult } from './base';

export interface FirecrawlInput {
  url: string;
  apiKey?: string;
  formats?: string[];
}

export interface FirecrawlOutput {
  url: string;
  markdown: string;
  title?: string;
  metadata?: Record<string, unknown>;
}

export class FirecrawlScraper implements ScraperModule<FirecrawlInput, FirecrawlOutput> {
  meta: ScraperMeta = {
    id: 'firecrawl',
    name: 'Firecrawl AI Scraper',
    category: 'generic',
    version: '1.0.0',
    requiresAuth: true,
    credentialKeys: ['FIRECRAWL_API_KEY'],
  };

  async execute(browser: Fetcher, env: Env, input: FirecrawlInput): Promise<ScrapeResult<FirecrawlOutput>> {
    try {
      const apiKey = input.apiKey || (env as any).FIRECRAWL_API_KEY || '';
      const endpoint = 'https://api.firecrawl.dev/v1/scrape';

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({
          url: input.url,
          formats: input.formats || ['markdown'],
        }),
        signal: AbortSignal.timeout(30000),
      });

      if (!res.ok) {
        const errText = await res.text();
        return wrapResult<FirecrawlOutput>('firecrawl', false, undefined, `Firecrawl API error (${res.status}): ${errText}`);
      }

      const json: any = await res.json();

      if (json.success === false || !json.data) {
        return wrapResult<FirecrawlOutput>('firecrawl', false, undefined, `Firecrawl scrape failure: ${json.error || 'No data returned'}`);
      }

      const markdown = json.data?.markdown || '';
      const title = json.data?.metadata?.title || '';

      return wrapResult<FirecrawlOutput>('firecrawl', true, {
        url: input.url,
        markdown,
        title,
        metadata: json.data?.metadata,
      });
    } catch (err: any) {
      return wrapResult<FirecrawlOutput>('firecrawl', false, undefined, `Firecrawl scraper failure: ${err.message}`);
    }
  }
}

export const firecrawlTarget = new FirecrawlScraper();
