import { describe, expect, it } from 'vitest';
import { courtDocketScraper, normalizeCookCountyCaseNumber } from '../src/targets/court-docket';

describe('court-docket case-number normalization', () => {
  it('preserves and expands compact District 1 case numbers', () => { const result = normalizeCookCountyCaseNumber('20261701274'); expect(result.original).toBe('20261701274'); expect(result.compact).toBe('20261701274'); expect(result.candidates).toContain('2026-17-01274'); expect(result.candidates).toContain('2026 17 01274'); });
  it('normalizes conventional division numbers', () => { const result = normalizeCookCountyCaseNumber('2025 CH 10971'); expect(result.compact).toBe('2025CH10971'); expect(result.candidates).toContain('2025 CH 10971'); });
  it('declares the corrected metadata contract', () => { expect(courtDocketScraper.meta.id).toBe('court-docket'); expect(courtDocketScraper.meta.version).toBe('0.2.0'); });
});
