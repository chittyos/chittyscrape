import { describe, it, expect } from 'vitest';
import { courtNameSearchScraper } from '../src/scrapers/court-name-search';

describe('court-name-search scraper meta', () => {
  it('has correct metadata', () => {
    expect(courtNameSearchScraper.meta.id).toBe('court-name-search');
    expect(courtNameSearchScraper.meta.category).toBe('court');
    expect(courtNameSearchScraper.meta.requiresAuth).toBe(false);
  });
});
