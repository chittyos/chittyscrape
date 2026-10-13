import type { Env } from './index';

type CredentialPayload = {
  success?: boolean;
  value?: string;
  error?: { code?: string; message?: string } | string;
};

const CANONICAL_VAULTS = new Set(['infrastructure', 'services', 'integrations']);

function getConnectConfig(env: Env) {
  const url = env.CHITTYCONNECT_URL || 'https://connect.chitty.cc';
  const token = env.CHITTYCONNECT_TOKEN || env.CHITTYCONNECT_API_KEY;
  return token ? { url, token } : null;
}

/**
 * Build the ChittyConnect credential URL.
 *
 * Canonical refs are three-part broker paths:
 *   integrations/reihub/username
 *
 * They map directly to ChittyConnect's current
 * /api/credentials/:vault/:item/:field contract rather than being encoded into
 * one opaque path segment. Non-canonical refs keep the legacy opaque-ref path.
 */
export function buildCredentialUrl(baseUrl: string, ref: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  const normalizedRef = ref.trim();
  const parts = normalizedRef.split('/');

  if (
    parts.length === 3 &&
    CANONICAL_VAULTS.has(parts[0]) &&
    parts.every(Boolean)
  ) {
    return `${base}/api/credentials/${parts.map(encodeURIComponent).join('/')}`;
  }

  return `${base}/api/credentials/${encodeURIComponent(normalizedRef)}`;
}

function credentialHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    'X-ChittyOS-Caller': 'chittyscrape',
  };
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
    buildCredentialUrl(config.url, normalizedRef),
    {
      method: 'GET',
      headers: credentialHeaders(config.token),
      signal: AbortSignal.timeout(8000),
    },
  );

  // Back-compat for old 1Password-style refs. New integrations must use a
  // canonical infrastructure|services|integrations broker path instead.
  if (res.status === 404 && normalizedRef.startsWith('op://')) {
    const opPath = normalizedRef.slice('op://'.length);
    const [vault, item, field, ...rest] = opPath.split('/');
    if (vault && item && field && rest.length === 0) {
      res = await fetch(
        `${config.url}/api/credentials/${encodeURIComponent(vault)}/${encodeURIComponent(item)}/${encodeURIComponent(field)}`,
        {
          method: 'GET',
          headers: credentialHeaders(config.token),
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
