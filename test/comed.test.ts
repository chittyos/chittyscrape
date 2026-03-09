import { describe, it, expect } from 'vitest';
import { comedScraper } from '../src/scrapers/comed';

describe('comed scraper meta', () => {
  it('has correct metadata', () => {
    expect(comedScraper.meta.id).toBe('comed');
    expect(comedScraper.meta.category).toBe('utility');
    expect(comedScraper.meta.requiresAuth).toBe(true);
    expect(comedScraper.meta.credentialKeys).toEqual([
      'comed:username',
      'comed:password',
    ]);
  });
});
