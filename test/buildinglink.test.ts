import { describe, it, expect } from 'vitest';
import { buildinglinkScraper } from '../src/targets/buildinglink';

const KV = (creds: Record<string, string>) => ({
  SCRAPE_KV: { get: async (k: string) => creds[k] ?? null },
}) as any;

const FULL = KV({
  'buildinglink-clarendon:username': 'u',
  'buildinglink-clarendon:password': 'p',
});

const run = (input: any, env: any = FULL) =>
  buildinglinkScraper.execute({} as any, env, input);

describe('buildinglink scraper meta', () => {
  it('has correct metadata', () => {
    expect(buildinglinkScraper.meta.id).toBe('buildinglink');
    expect(buildinglinkScraper.meta.category).toBe('hoa');
    expect(buildinglinkScraper.meta.requiresAuth).toBe(true);
    expect(buildinglinkScraper.meta.credentialKeys).toEqual([
      'buildinglink-clarendon:username', 'buildinglink-clarendon:password',
      'buildinglink-commodore:username', 'buildinglink-commodore:password',
    ]);
  });
});

describe('buildinglink gates', () => {
  it('gate 1: rejects an unknown building', async () => {
    const r = await run({ building: 'nope', action: 'status' });
    expect(r.success).toBe(false);
    expect(r.data?.state).toBe('unknown_building');
  });

  it('status reports credential readiness without navigating', async () => {
    const r = await run({ building: 'clarendon', action: 'status' });
    expect(r.success).toBe(true);
    expect(r.data?.state).toBe('ok');
    expect(r.data?.modules).toHaveLength(8);
    expect(r.data?.writes).toHaveLength(8);
  });

  it('status flags missing credentials', async () => {
    const r = await run({ building: 'commodore', action: 'status' }, KV({}));
    expect(r.data?.state).toBe('credentials_missing');
  });

  it('rejects an unsupported action', async () => {
    const r = await run({ building: 'clarendon', action: 'drop_tables' });
    expect(r.data?.state).toBe('unsupported_action');
  });

  it('gate 2: refuses a write without credentials', async () => {
    const r = await run(
      { building: 'commodore', action: 'create_reservation',
        payload: { amenity: 'freight elevator', startsAt: 'a', endsAt: 'b' } },
      KV({}),
    );
    expect(r.data?.state).toBe('credentials_missing');
  });

  it('gate 4: refuses a write missing required fields', async () => {
    const r = await run({ building: 'clarendon', action: 'create_reservation',
      payload: { amenity: 'freight elevator' } });
    expect(r.data?.state).toBe('refused_missing_fields');
    expect(r.error).toContain('startsAt');
  });

  it('gate 3: blocks an unverified write route and returns the intent', async () => {
    const r = await run({ building: 'clarendon', action: 'create_reservation',
      payload: { amenity: 'freight elevator', startsAt: 'a', endsAt: 'b' } });
    expect(r.data?.state).toBe('blocked_unverified_route');
    expect(r.data?.intent).toMatchObject({ action: 'create_reservation', irreversible: false });
  });

  it('gate 3: blocks an unverified read route', async () => {
    const r = await run({ building: 'clarendon', action: 'list_announcements' });
    expect(r.data?.state).toBe('blocked_unverified_route');
  });

  it('marks send_message and post_classified as irreversible', async () => {
    const r = await run({ building: 'clarendon', action: 'status' });
    const byAction = Object.fromEntries((r.data?.writes || []).map((w: any) => [w.action, w.irreversible]));
    expect(byAction.send_message).toBe(true);
    expect(byAction.post_classified).toBe(true);
    expect(byAction.create_reservation).toBe(false);
  });

  it('defaults writes to dry_run rather than executing', async () => {
    const r = await run({ building: 'clarendon', action: 'send_message',
      payload: { recipient: 'Kenny Martin', body: 'hi' } });
    expect(r.data?.state).not.toBe('transport_not_implemented');
    expect(['blocked_unverified_route', 'dry_run']).toContain(r.data?.state);
  });

  // Regression: CodeRabbit findings on chittyos/chittyscrape#33
  it('gate 1: a non-string building refuses instead of throwing', async () => {
    for (const bad of [42, null, {}, [], true]) {
      const r = await run({ building: bad, action: 'status' });
      expect(r.success).toBe(false);
      expect(r.data?.state).toBe('unknown_building');
    }
  });

  it('gate 1: an inherited key does not resolve to a prototype member', async () => {
    for (const key of ['constructor', 'toString', 'hasOwnProperty', '__proto__', 'valueOf']) {
      const r = await run({ building: key, action: 'status' });
      expect(r.success).toBe(false);
      expect(r.data?.state).toBe('unknown_building');
    }
  });

  it('gate 1: an inherited key reads no credentials from KV', async () => {
    const seen: string[] = [];
    const spy = { SCRAPE_KV: { get: async (k: string) => { seen.push(k); return null; } } } as any;
    await run({ building: 'constructor', action: 'status' }, spy);
    await run({ building: 'constructor', action: 'send_message',
      mode: 'execute', idempotency_key: 'k',
      payload: { recipient: 'x', body: 'y', confirm: true } }, spy);
    expect(seen).toEqual([]);
  });

  it('flags the evidence-bearing read modules', async () => {
    const r = await run({ building: 'clarendon', action: 'status' });
    const evidence = (r.data?.modules || []).filter((m: any) => m.evidence).map((m: any) => m.action);
    expect(evidence).toEqual([
      'list_announcements', 'list_documents', 'list_maintenance_requests',
    ]);
  });
});
