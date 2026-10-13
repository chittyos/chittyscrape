function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const encoder = new TextEncoder();
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  return crypto.subtle.timingSafeEqual(left, right);
}

export type McpAuthResult =
  | { ok: true }
  | { ok: false; status: 401 | 503; error: 'unauthorized' | 'auth_not_configured' | 'auth_unavailable' };

export async function authorizeMcpBearer(
  authorization: string | undefined,
  resolveExpectedToken: () => Promise<string | null>,
): Promise<McpAuthResult> {
  // Reject unauthenticated requests before touching the broker. This avoids
  // turning arbitrary Internet traffic into credential-broker fan-out.
  if (!authorization?.startsWith('Bearer ')) {
    return { ok: false, status: 401, error: 'unauthorized' };
  }

  const supplied = authorization.slice('Bearer '.length);
  if (!supplied) {
    return { ok: false, status: 401, error: 'unauthorized' };
  }

  let expected: string | null;
  try {
    expected = await resolveExpectedToken();
  } catch {
    return { ok: false, status: 503, error: 'auth_unavailable' };
  }

  if (!expected) {
    return { ok: false, status: 503, error: 'auth_not_configured' };
  }

  if (!timingSafeEqual(supplied, expected)) {
    return { ok: false, status: 401, error: 'unauthorized' };
  }

  return { ok: true };
}
