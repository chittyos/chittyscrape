import { describe, it, expect } from 'vitest';
import { wrapResult } from '../src/scrapers/base';

describe('wrapResult', () => {
  it('creates a success result with portal and timestamp', () => {
    const result = wrapResult('test-portal', true, { balance: 100 });
    expect(result.success).toBe(true);
    expect(result.portal).toBe('test-portal');
    expect(result.method).toBe('scrape');
    expect(result.data).toEqual({ balance: 100 });
    expect(result.scrapedAt).toBeDefined();
    expect(result.error).toBeUndefined();
  });

  it('creates a failure result with error', () => {
    const result = wrapResult('test-portal', false, undefined, 'something broke');
    expect(result.success).toBe(false);
    expect(result.error).toBe('something broke');
    expect(result.data).toBeUndefined();
  });
});
