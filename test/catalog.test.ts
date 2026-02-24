import { describe, it, expect, beforeEach } from 'vitest';
import { ScraperCatalog } from '../src/catalog';
import type { ScraperModule } from '../src/scrapers/base';

function makeFakeScraper(id: string, category: string = 'utility'): ScraperModule {
  return {
    meta: {
      id,
      name: id,
      category: category as any,
      version: '1.0.0',
      requiresAuth: false,
    },
    execute: async () => ({ success: true, method: 'scrape' as const, portal: id, scrapedAt: '' }),
  };
}

describe('ScraperCatalog', () => {
  let catalog: ScraperCatalog;

  beforeEach(() => {
    catalog = new ScraperCatalog();
  });

  it('registers and retrieves a scraper by id', () => {
    catalog.register(makeFakeScraper('test-portal'));
    expect(catalog.get('test-portal')).toBeDefined();
    expect(catalog.get('test-portal')!.meta.id).toBe('test-portal');
  });

  it('returns undefined for unknown id', () => {
    expect(catalog.get('nope')).toBeUndefined();
  });

  it('lists all registered scraper metadata', () => {
    catalog.register(makeFakeScraper('a'));
    catalog.register(makeFakeScraper('b'));
    const list = catalog.list();
    expect(list).toHaveLength(2);
    expect(list.map((m) => m.id)).toEqual(['a', 'b']);
  });

  it('filters by category', () => {
    catalog.register(makeFakeScraper('gas', 'utility'));
    catalog.register(makeFakeScraper('court', 'court'));
    const utils = catalog.listByCategory('utility');
    expect(utils).toHaveLength(1);
    expect(utils[0].id).toBe('gas');
  });
});
