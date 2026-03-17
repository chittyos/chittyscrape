import { describe, it, expect } from 'vitest';
import { googleDriveScraper } from '../src/scrapers/google-drive';

describe('google-drive scraper meta', () => {
  it('has correct metadata', () => {
    expect(googleDriveScraper.meta.id).toBe('google-drive');
    expect(googleDriveScraper.meta.category).toBe('generic');
    expect(googleDriveScraper.meta.requiresAuth).toBe(true);
    expect(googleDriveScraper.meta.credentialKeys).toEqual([
      'google-drive:service-account-key',
    ]);
  });
});
