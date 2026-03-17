import { describe, it, expect } from 'vitest';
import { appfolioHoaScraper } from '../src/scrapers/appfolio-hoa';

describe('appfolio-hoa scraper meta', () => {
  it('has correct metadata', () => {
    expect(appfolioHoaScraper.meta.id).toBe('appfolio-hoa');
    expect(appfolioHoaScraper.meta.category).toBe('hoa');
    expect(appfolioHoaScraper.meta.requiresAuth).toBe(true);
    expect(appfolioHoaScraper.meta.credentialKeys).toEqual([
      'appfolio-propertyhill:username', 'appfolio-propertyhill:password',
      'appfolio-chicagoland:username', 'appfolio-chicagoland:password',
    ]);
  });

  it('has version 0.2.0 for multi-portfolio support', () => {
    expect(appfolioHoaScraper.meta.version).toBe('0.2.0');
    expect(appfolioHoaScraper.meta.name).toBe('AppFolio HOA');
  });
});
