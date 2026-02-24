import type { ScraperModule, ScraperMeta, ScraperCategory } from './scrapers/base';

export class ScraperCatalog {
  private scrapers = new Map<string, ScraperModule>();

  register(scraper: ScraperModule): void {
    this.scrapers.set(scraper.meta.id, scraper);
  }

  get(portalId: string): ScraperModule | undefined {
    return this.scrapers.get(portalId);
  }

  list(): ScraperMeta[] {
    return Array.from(this.scrapers.values()).map((s) => s.meta);
  }

  listByCategory(category: ScraperCategory): ScraperMeta[] {
    return this.list().filter((m) => m.category === category);
  }
}
