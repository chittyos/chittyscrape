import { wrapResult, type ScraperModule } from './base';
import { getChittyConnectCredential, getCredentialRef } from '../chittyconnect';

const BROWSE_AI_BASE = 'https://api.browse.ai/v2';

export interface BrowseAIRobot {
  id: string;
  name: string;
  createdAt: string;
  inputParameters: Record<string, unknown>[];
}

export interface BrowseAITaskResult {
  id: string;
  robotId: string;
  status: string;
  createdAt: string;
  finishedAt?: string;
  capturedLists?: Record<string, unknown[]>;
  capturedTexts?: Record<string, string>;
  inputParameters?: Record<string, string>;
}

export interface BrowseAIResult {
  action: 'list-robots' | 'get-robot' | 'run-robot' | 'get-task' | 'list-tasks';
  robots?: BrowseAIRobot[];
  robot?: BrowseAIRobot;
  task?: BrowseAITaskResult;
  tasks?: BrowseAITaskResult[];
}

async function browseAIRequest(
  apiKey: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<unknown> {
  const res = await fetch(`${BROWSE_AI_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Browse AI API ${res.status}: ${text.slice(0, 200)}`);
  }

  return res.json();
}

/**
 * Browse AI integration scraper.
 *
 * Browse AI provides no-code web scraping robots that can be:
 * - Listed (see all configured robots)
 * - Triggered (run a robot with input parameters)
 * - Polled (check task status and retrieve results)
 *
 * Existing robots:
 * - Cook County Domestic Relations Case Search (paused since Aug 2025)
 *
 * API docs: https://docs.browse.ai/reference/api
 * API key resolved via ChittyConnect: op://ChittyOS/Browse AI/api_key
 */
export const browseAIScraper: ScraperModule<
  {
    action: 'list-robots' | 'get-robot' | 'run-robot' | 'get-task' | 'list-tasks';
    robotId?: string;
    taskId?: string;
    inputParameters?: Record<string, string>;
  },
  BrowseAIResult
> = {
  meta: {
    id: 'browse-ai',
    name: 'Browse AI',
    category: 'generic',
    version: '0.1.0',
    requiresAuth: true,
    credentialKeys: ['BROWSE_AI_API_KEY_REF'],
  },
  async execute(_browser, env, input) {
    // Resolve API key via ChittyConnect
    const apiKeyRef = getCredentialRef(
      env,
      'BROWSE_AI_API_KEY_REF',
      'op://ChittyOS/Browse AI/api_key',
    );

    let apiKey: string | null;
    try {
      apiKey = await getChittyConnectCredential(env, apiKeyRef);
    } catch (err: any) {
      return wrapResult<BrowseAIResult>(
        'browse-ai', false, undefined,
        `Failed to retrieve Browse AI API key via ChittyConnect: ${err.message}`,
      );
    }

    if (!apiKey) {
      return wrapResult<BrowseAIResult>(
        'browse-ai', false, undefined,
        `Browse AI API key not found in 1Password (${apiKeyRef}). Add it to the ChittyOS vault as "Browse AI" with field "api_key".`,
      );
    }

    const action = input?.action || 'list-robots';

    try {
      switch (action) {
        case 'list-robots': {
          const data = await browseAIRequest(apiKey, 'GET', '/robots') as any;
          const robots: BrowseAIRobot[] = (data?.result?.robots || []).map((r: any) => ({
            id: r.id,
            name: r.name,
            createdAt: r.createdAt,
            inputParameters: r.inputParameters || [],
          }));
          return wrapResult('browse-ai', true, { action, robots });
        }

        case 'get-robot': {
          if (!input?.robotId) {
            return wrapResult<BrowseAIResult>('browse-ai', false, undefined, 'robotId is required for get-robot');
          }
          const data = await browseAIRequest(apiKey, 'GET', `/robots/${input.robotId}`) as any;
          return wrapResult('browse-ai', true, { action, robot: data?.result?.robot });
        }

        case 'run-robot': {
          if (!input?.robotId) {
            return wrapResult<BrowseAIResult>('browse-ai', false, undefined, 'robotId is required for run-robot');
          }
          const data = await browseAIRequest(apiKey, 'POST', `/robots/${input.robotId}/tasks`, {
            inputParameters: input.inputParameters || {},
          }) as any;
          return wrapResult('browse-ai', true, {
            action,
            task: data?.result?.task || data?.result,
          });
        }

        case 'get-task': {
          if (!input?.robotId || !input?.taskId) {
            return wrapResult<BrowseAIResult>('browse-ai', false, undefined, 'robotId and taskId required for get-task');
          }
          const data = await browseAIRequest(apiKey, 'GET', `/robots/${input.robotId}/tasks/${input.taskId}`) as any;
          return wrapResult('browse-ai', true, { action, task: data?.result?.task || data?.result });
        }

        case 'list-tasks': {
          if (!input?.robotId) {
            return wrapResult<BrowseAIResult>('browse-ai', false, undefined, 'robotId is required for list-tasks');
          }
          const data = await browseAIRequest(apiKey, 'GET', `/robots/${input.robotId}/tasks?page=1`) as any;
          const tasks: BrowseAITaskResult[] = (data?.result?.robotTasks?.items || []).map((t: any) => ({
            id: t.id,
            robotId: t.robotId,
            status: t.status,
            createdAt: t.createdAt,
            finishedAt: t.finishedAt,
            capturedLists: t.capturedLists,
            capturedTexts: t.capturedTexts,
            inputParameters: t.inputParameters,
          }));
          return wrapResult('browse-ai', true, { action, tasks });
        }

        default:
          return wrapResult<BrowseAIResult>('browse-ai', false, undefined, `Unknown action: ${action}. Use: list-robots, get-robot, run-robot, get-task, list-tasks`);
      }
    } catch (err: any) {
      return wrapResult<BrowseAIResult>('browse-ai', false, undefined, err.message);
    }
  },
};
