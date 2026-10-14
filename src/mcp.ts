import type { ScraperCatalog } from './catalog';

export interface McpRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, any>;
}

export interface McpResponse {
  status: number;
  body: Record<string, any> | null;
}

const SERVER_INFO = {
  name: 'chittyscrape',
  version: '0.2.0',
};

const CAPABILITIES = {
  tools: {},
  resources: {},
  prompts: {},
};

export const MCP_TOOLS = [
  {
    name: 'list-scrapers',
    description: 'List ChittyScrape portal adapters and their authentication requirements. Read-only.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'rei-hub-snapshot',
    description: 'Read REI Hub Booked Transactions and optionally Chart of Accounts into a hashed comparison snapshot. Read-only; does not mutate REI Hub or ChittyFinance.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        maxPages: {
          type: 'integer',
          minimum: 1,
          maximum: 250,
          description: 'Maximum Booked Transactions pages to read.',
        },
        includeChartOfAccounts: {
          type: 'boolean',
          description: 'Also capture the REI Hub Chart of Accounts view.',
        },
      },
      additionalProperties: false,
    },
  },
];

function rpcOk(id: McpRequest['id'], result: unknown): Record<string, any> {
  return { jsonrpc: '2.0', id: id ?? null, result };
}

function rpcError(id: McpRequest['id'], code: number, message: string): Record<string, any> {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

function textContent(value: unknown) {
  return [{ type: 'text', text: JSON.stringify(value) }];
}

function validateToolArguments(name: string, value: unknown): string | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return 'Tool arguments must be a JSON object';
  }
  const args = value as Record<string, unknown>;
  const permitted = name === 'rei-hub-snapshot'
    ? ['maxPages', 'includeChartOfAccounts']
    : [];
  for (const key of Object.keys(args)) {
    if (!permitted.includes(key)) return `Unexpected tool argument: ${key}`;
  }
  if (name === 'rei-hub-snapshot') {
    if (args.maxPages !== undefined && (
      typeof args.maxPages !== 'number' ||
      !Number.isInteger(args.maxPages) ||
      args.maxPages < 1 || args.maxPages > 250
    )) return 'maxPages must be an integer between 1 and 250';
    if (args.includeChartOfAccounts !== undefined &&
      typeof args.includeChartOfAccounts !== 'boolean'
    ) return 'includeChartOfAccounts must be a boolean';
  }
  return null;
}

export async function handleMcpRequest(
  body: McpRequest,
  catalog: ScraperCatalog,
  browser: Fetcher,
  env: any,
): Promise<McpResponse> {
  // MCP notifications have no id and receive no response body.
  if (
    body.jsonrpc === '2.0' &&
    body.id === undefined &&
    (body.method === 'notifications/initialized' || body.method?.startsWith('notifications/'))
  ) {
    return { status: 204, body: null };
  }

  if (body.jsonrpc !== '2.0' || !body.method) {
    return { status: 400, body: rpcError(body.id ?? null, -32600, 'Invalid request') };
  }

  switch (body.method) {
    case 'initialize':
      return {
        status: 200,
        body: rpcOk(body.id, {
          protocolVersion: '2024-11-05',
          serverInfo: SERVER_INFO,
          capabilities: CAPABILITIES,
        }),
      };

    case 'ping':
      return { status: 200, body: rpcOk(body.id, {}) };

    case 'tools/list':
      return { status: 200, body: rpcOk(body.id, { tools: MCP_TOOLS }) };

    case 'resources/list':
      return { status: 200, body: rpcOk(body.id, { resources: [] }) };

    case 'resources/templates/list':
      return { status: 200, body: rpcOk(body.id, { resourceTemplates: [] }) };

    case 'prompts/list':
      return { status: 200, body: rpcOk(body.id, { prompts: [] }) };

    case 'tools/call': {
      const name = body.params?.name;
      const args = body.params?.arguments === undefined ? {} : body.params.arguments;
      if (!name) {
        return { status: 400, body: rpcError(body.id, -32602, 'Missing tool name') };
      }

      if (name === 'list-scrapers' || name === 'rei-hub-snapshot') {
        const validationError = validateToolArguments(name, args);
        if (validationError) {
          return { status: 400, body: rpcError(body.id, -32602, validationError) };
        }
      }

      if (name === 'list-scrapers') {
        return {
          status: 200,
          body: rpcOk(body.id, { content: textContent({ scrapers: catalog.list() }) }),
        };
      }

      if (name === 'rei-hub-snapshot') {
        const scraper = catalog.get('rei-hub');
        if (!scraper) {
          return {
            status: 500,
            body: rpcOk(body.id, {
              content: textContent({ error: 'rei_hub_scraper_not_registered' }),
              isError: true,
            }),
          };
        }

        try {
          const result = await scraper.execute(browser, env, {
            maxPages: args.maxPages,
            includeChartOfAccounts: args.includeChartOfAccounts,
          });
          return {
            status: 200,
            body: rpcOk(body.id, {
              content: textContent(result),
              isError: result.success === false,
            }),
          };
        } catch (err: any) {
          return {
            status: 200,
            body: rpcOk(body.id, {
              content: textContent({
                success: false,
                portal: 'rei-hub',
                error: err?.message || 'REI Hub scrape failed',
              }),
              isError: true,
            }),
          };
        }
      }

      return {
        status: 404,
        body: rpcError(body.id, -32601, `Unknown tool: ${name}`),
      };
    }

    default:
      return {
        status: 404,
        body: rpcError(body.id, -32601, `Method not found: ${body.method}`),
      };
  }
}
