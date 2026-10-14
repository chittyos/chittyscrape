import { describe, expect, it, vi } from 'vitest';
import { ScraperCatalog } from '../src/catalog';
import { authorizeMcpBearer } from '../src/mcp-auth';
import { handleMcpRequest } from '../src/mcp';
import type { ScraperModule } from '../src/targets/base';

function fakeScraper(id: string, execute?: ScraperModule['execute']): ScraperModule {
  return {
    meta: {
      id,
      name: id,
      category: 'generic',
      version: '1.0.0',
      requiresAuth: id === 'rei-hub',
    },
    execute: execute ?? (async () => ({
      success: true,
      method: 'scrape' as const,
      portal: id,
      scrapedAt: '2026-10-13T00:00:00.000Z',
      data: { ok: true },
    })),
  };
}

describe('focused MCP bearer auth', () => {
  it('rejects unauthenticated requests without touching the broker', async () => {
    const resolver = vi.fn(async () => 'expected-token');

    await expect(authorizeMcpBearer(undefined, resolver)).resolves.toEqual({
      ok: false,
      status: 401,
      error: 'unauthorized',
    });
    expect(resolver).not.toHaveBeenCalled();
  });

  it('fails closed when ChittyConnect is unavailable', async () => {
    await expect(authorizeMcpBearer('Bearer token', async () => {
      throw new Error('unavailable');
    })).resolves.toEqual({
      ok: false,
      status: 503,
      error: 'auth_unavailable',
    });
  });

  it('fails closed when the broker has no ChittyMCP credential', async () => {
    await expect(authorizeMcpBearer('Bearer token', async () => null)).resolves.toEqual({
      ok: false,
      status: 503,
      error: 'auth_not_configured',
    });
  });

  it('rejects an incorrect bearer token', async () => {
    expect(await authorizeMcpBearer(
      'Bearer wrong-token',
      async () => 'expected-token',
    )).toMatchObject({
      ok: false,
      status: 401,
    });
  });

  it('accepts the matching ChittyMCP bearer returned by the broker', async () => {
    await expect(authorizeMcpBearer(
      'Bearer expected-token',
      async () => 'expected-token',
    )).resolves.toEqual({ ok: true });
  });
});

describe('focused ChittyScrape MCP protocol', () => {
  it('initializes and exposes only the focused read-only tools', async () => {
    const catalog = new ScraperCatalog();
    catalog.register(fakeScraper('rei-hub'));

    const init = await handleMcpRequest(
      { jsonrpc: '2.0', id: 1, method: 'initialize' },
      catalog,
      {} as Fetcher,
      {},
    );
    expect(init.status).toBe(200);
    expect(init.body?.result.serverInfo.name).toBe('chittyscrape');

    const tools = await handleMcpRequest(
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      catalog,
      {} as Fetcher,
      {},
    );
    expect(tools.body?.result.tools.map((tool: any) => tool.name)).toEqual([
      'list-scrapers',
      'rei-hub-snapshot',
    ]);
    expect(tools.body?.result.tools.every((tool: any) => /read-only/i.test(tool.description))).toBe(true);
  });

  it('accepts initialized notifications without manufacturing a response', async () => {
    const result = await handleMcpRequest(
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      new ScraperCatalog(),
      {} as Fetcher,
      {},
    );
    expect(result).toEqual({ status: 204, body: null });
  });

  it('returns empty resource and prompt surfaces', async () => {
    const catalog = new ScraperCatalog();

    const resources = await handleMcpRequest(
      { jsonrpc: '2.0', id: 1, method: 'resources/list' },
      catalog,
      {} as Fetcher,
      {},
    );
    const templates = await handleMcpRequest(
      { jsonrpc: '2.0', id: 2, method: 'resources/templates/list' },
      catalog,
      {} as Fetcher,
      {},
    );
    const prompts = await handleMcpRequest(
      { jsonrpc: '2.0', id: 3, method: 'prompts/list' },
      catalog,
      {} as Fetcher,
      {},
    );

    expect(resources.body?.result.resources).toEqual([]);
    expect(templates.body?.result.resourceTemplates).toEqual([]);
    expect(prompts.body?.result.prompts).toEqual([]);
  });

  it('lists registered scrapers through MCP', async () => {
    const catalog = new ScraperCatalog();
    catalog.register(fakeScraper('rei-hub'));
    catalog.register(fakeScraper('other'));

    const result = await handleMcpRequest(
      {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: { name: 'list-scrapers', arguments: {} },
      },
      catalog,
      {} as Fetcher,
      {},
    );

    const payload = JSON.parse(result.body?.result.content[0].text);
    expect(payload.scrapers.map((s: any) => s.id)).toEqual(['rei-hub', 'other']);
  });

  it('executes the REI Hub adapter read-only and returns its snapshot result', async () => {
    const execute = vi.fn(async (_browser: Fetcher, _env: any, input: any) => ({
      success: true,
      method: 'scrape' as const,
      portal: 'rei-hub',
      scrapedAt: '2026-10-13T00:00:00.000Z',
      data: {
        source: 'rei-hub',
        snapshotSha256: 'abc123',
        maxPagesSeen: input.maxPages,
        includedCoa: input.includeChartOfAccounts,
      },
    }));

    const catalog = new ScraperCatalog();
    catalog.register(fakeScraper('rei-hub', execute));

    const result = await handleMcpRequest(
      {
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: {
          name: 'rei-hub-snapshot',
          arguments: { maxPages: 7, includeChartOfAccounts: true },
        },
      },
      catalog,
      {} as Fetcher,
      { marker: 'env' },
    );

    expect(result.status).toBe(200);
    expect(execute).toHaveBeenCalledOnce();
    expect(execute.mock.calls[0][2]).toEqual({
      maxPages: 7,
      includeChartOfAccounts: true,
    });

    const payload = JSON.parse(result.body?.result.content[0].text);
    expect(payload.success).toBe(true);
    expect(payload.data.snapshotSha256).toBe('abc123');
    expect(result.body?.result.isError).toBe(false);
  });

  it('returns an MCP tool error without converting scraper failures into transport failures', async () => {
    const catalog = new ScraperCatalog();
    catalog.register(fakeScraper('rei-hub', async () => ({
      success: false,
      method: 'scrape',
      portal: 'rei-hub',
      scrapedAt: '2026-10-13T00:00:00.000Z',
      error: 'credentials unavailable',
    })));

    const result = await handleMcpRequest(
      {
        jsonrpc: '2.0',
        id: 6,
        method: 'tools/call',
        params: { name: 'rei-hub-snapshot', arguments: {} },
      },
      catalog,
      {} as Fetcher,
      {},
    );

    expect(result.status).toBe(200);
    expect(result.body?.result.isError).toBe(true);
    expect(result.body?.result.content[0].text).toContain('credentials unavailable');
  });
  it('rejects invalid tool arguments before executing the credentialed scraper', async () => {
    const execute = vi.fn(async () => ({
      success: true, method: 'scrape' as const, portal: 'rei-hub',
      scrapedAt: '2026-10-13T00:00:00.000Z',
    }));
    const catalog = new ScraperCatalog();
    catalog.register(fakeScraper('rei-hub', execute));
    const invalid = [
      null, [], 'bad', 7, true,
      { maxPages: 0 }, { maxPages: 251 }, { maxPages: -1 },
      { maxPages: 2.5 }, { maxPages: '2' }, { maxPages: null },
      { maxPages: true }, { includeChartOfAccounts: 'false' },
      { includeChartOfAccounts: 1 }, { includeChartOfAccounts: null },
      { unexpected: true }, { maxPages: 1, unexpected: true },
    ];
    for (const args of invalid) {
      const response = await handleMcpRequest({
        jsonrpc: '2.0', id: 123, method: 'tools/call',
        params: { name: 'rei-hub-snapshot', arguments: args },
      }, catalog, {} as Fetcher, {});
      expect(response.status).toBe(400);
      expect(response.body?.error.code).toBe(-32602);
    }
    expect(execute).not.toHaveBeenCalled();
  });

  it('accepts valid pagination boundaries and boolean values', async () => {
    const execute = vi.fn(async () => ({
      success: true, method: 'scrape' as const, portal: 'rei-hub',
      scrapedAt: '2026-10-13T00:00:00.000Z',
    }));
    const catalog = new ScraperCatalog();
    catalog.register(fakeScraper('rei-hub', execute));
    for (const args of [
      {}, { maxPages: 1, includeChartOfAccounts: false },
      { maxPages: 250, includeChartOfAccounts: true },
    ]) {
      const response = await handleMcpRequest({
        jsonrpc: '2.0', id: 124, method: 'tools/call',
        params: { name: 'rei-hub-snapshot', arguments: args },
      }, catalog, {} as Fetcher, {});
      expect(response.status).toBe(200);
      expect(response.body?.result.isError).toBe(false);
    }
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it('rejects unexpected list-scrapers arguments', async () => {
    const response = await handleMcpRequest({
      jsonrpc: '2.0', id: 125, method: 'tools/call',
      params: { name: 'list-scrapers', arguments: { extra: 1 } },
    }, new ScraperCatalog(), {} as Fetcher, {});
    expect(response.body?.error.code).toBe(-32602);
  });

});
