import type { Env } from './index';

type CredentialPayload = {
  success?: boolean;
  value?: string;
  error?: { code?: string; message?: string } | string;
};

function getConnectConfig(env: Env) {
  const url = env.CHITTYCONNECT_URL || 'https://connect.chitty.cc';
  const token = env.CHITTYCONNECT_TOKEN || env.CHITTYCONNECT_API_KEY;
  return token ? { url, token } : null;
}

export async function getChittyConnectCredential(
  env: Env,
  ref: string,
): Promise<string | null> {
  const config = getConnectConfig(env);
  if (!config) {
    throw new Error('ChittyConnect is not configured (set CHITTYCONNECT_TOKEN or CHITTYCONNECT_API_KEY)');
  }

  const normalizedRef = ref.trim();
  if (!normalizedRef) {
    throw new Error('Missing ChittyConnect credential ref');
  }

  let res = await fetch(
    `${config.url}/api/credentials/${encodeURIComponent(normalizedRef)}`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${config.token}`,
        'X-ChittyOS-Caller': 'chittyscrape',
      },
      signal: AbortSignal.timeout(8000),
    },
  );

  // Back-compat for the older /api/credentials/:vault/:item/:field route.
  if (res.status === 404 && normalizedRef.startsWith('op://')) {
    const opPath = normalizedRef.slice('op://'.length);
    const [vault, item, field, ...rest] = opPath.split('/');
    if (vault && item && field && rest.length === 0) {
      res = await fetch(
        `${config.url}/api/credentials/${encodeURIComponent(vault)}/${encodeURIComponent(item)}/${encodeURIComponent(field)}`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${config.token}`,
            'X-ChittyOS-Caller': 'chittyscrape',
          },
          signal: AbortSignal.timeout(8000),
        },
      );
    }
  }

  if (res.status === 404) return null;

  let payload: CredentialPayload | null = null;
  try {
    payload = await res.json() as CredentialPayload;
  } catch {
    payload = null;
  }

  if (!res.ok) {
    const message = typeof payload?.error === 'string'
      ? payload.error
      : payload?.error?.message || `HTTP ${res.status}`;
    throw new Error(`ChittyConnect credential fetch failed for ${normalizedRef}: ${message}`);
  }

  if (!payload?.success || !payload.value) {
    return null;
  }

  return payload.value;
}

export function getCredentialRef(env: Env, envVarName: keyof Env, defaultRef: string): string {
  const configured = env[envVarName];
  return typeof configured === 'string' && configured.trim() ? configured : defaultRef;
}
