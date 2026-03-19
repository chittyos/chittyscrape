import { describe, it, expect } from 'vitest';
import { renderDashboard } from '../src/frontend';

describe('Dashboard frontend', () => {
  it('renders HTML with correct title', async () => {
    const result = await renderDashboard();
    const body = typeof result === 'string' ? result : String(result);
    expect(body).toContain('ChittyScrape');
    expect(body).toContain('Mission Control');
  });

  it('includes API endpoint references', async () => {
    const result = await renderDashboard();
    const body = typeof result === 'string' ? result : String(result);
    expect(body).toContain('/api/v1/capabilities');
    expect(body).toContain('/health');
    expect(body).toContain('/api/scrape/');
  });

  it('includes command palette markup', async () => {
    const result = await renderDashboard();
    const body = typeof result === 'string' ? result : String(result);
    expect(body).toContain('cmd-overlay');
    expect(body).toContain('cmd-input');
  });

  it('includes topology visualization', async () => {
    const result = await renderDashboard();
    const body = typeof result === 'string' ? result : String(result);
    expect(body).toContain('topo-canvas');
    expect(body).toContain('Scraper Topology');
  });

  it('includes keyboard shortcut bindings', async () => {
    const result = await renderDashboard();
    const body = typeof result === 'string' ? result : String(result);
    expect(body).toContain('Ctrl+Enter');
    expect(body).toContain('keydown');
  });
});
