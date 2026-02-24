import { describe, it, expect } from 'vitest';
import { peoplesGasScraper } from '../src/scrapers/peoples-gas';

describe('peoples-gas scraper meta', () => {
  it('has correct metadata', () => {
    expect(peoplesGasScraper.meta.id).toBe('peoples-gas');
    expect(peoplesGasScraper.meta.category).toBe('utility');
    expect(peoplesGasScraper.meta.requiresAuth).toBe(true);
    expect(peoplesGasScraper.meta.credentialKeys).toEqual([
      'peoplesgas:username',
      'peoplesgas:password',
    ]);
  });
});
