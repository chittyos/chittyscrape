import { describe, it, expect } from 'vitest';
import { wrapResult, resolveSelector } from '../src/scrapers/base';

describe('resolveSelector', () => {
  it('returns first matching selector', async () => {
    const mockPage = { $: async (sel: string) => (sel === '#password' ? {} : null) };
    expect(await resolveSelector(mockPage, ['#missing', '#password'])).toBe('#password');
  });

  it('returns null when nothing matches', async () => {
    const mockPage = { $: async () => null };
    expect(await resolveSelector(mockPage, ['#a', '#b'])).toBeNull();
  });

  it('skips invalid CSS selectors but keeps trying', async () => {
    const mockPage = {
      $: async (sel: string) => {
        if (sel === '#bad') throw new Error('is not a valid selector');
        return sel === '#ok' ? {} : null;
      },
    };
    expect(await resolveSelector(mockPage, ['#bad', '#ok'])).toBe('#ok');
  });

  it('propagates infrastructure errors', async () => {
    const mockPage = {
      $: async () => { throw new Error('Target closed'); },
    };
    await expect(resolveSelector(mockPage, ['#any'])).rejects.toThrow('Target closed');
  });
});

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
