import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildinglinkScraper, WRITES } from '../src/targets/buildinglink';

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

// Gates 5-7 and the terminal branch are unreachable while every route ships
// verified:false. Flip one route inside the seam so the real execute() path is
// exercised, then restore it — the shipped default stays false.
describe('buildinglink write gates (verified-route seam)', () => {
  const RESV = { ...WRITES.create_reservation };
  const MSG = { ...WRITES.send_message };
  beforeEach(() => {
    WRITES.create_reservation.verified = true;
    WRITES.send_message.verified = true;
  });
  afterEach(() => {
    WRITES.create_reservation.verified = RESV.verified;
    WRITES.send_message.verified = MSG.verified;
  });

  const booking = { amenity: 'freight elevator', startsAt: '2026-11-03T09:00', endsAt: '2026-11-03T13:00' };

  it('ships both routes as verified:false', () => {
    expect(RESV.verified).toBe(false);
    expect(MSG.verified).toBe(false);
  });

  it('gate 5: defaults to dry_run and returns the intent without sending', async () => {
    const r = await run({ building: 'clarendon', action: 'create_reservation', payload: booking });
    expect(r.data?.state).toBe('dry_run');
    expect(r.data?.intent).toMatchObject({ action: 'create_reservation', fields: booking });
  });

  it('gate 6: execute without an idempotency_key is refused', async () => {
    const r = await run({ building: 'clarendon', action: 'create_reservation',
      mode: 'execute', payload: booking });
    expect(r.data?.state).toBe('refused_no_idempotency_key');
  });

  it('gate 7: an irreversible write without confirm is refused', async () => {
    const r = await run({ building: 'clarendon', action: 'send_message',
      mode: 'execute', idempotency_key: 'k1',
      payload: { recipient: 'Kenny Martin', body: 'hi' } });
    expect(r.data?.state).toBe('refused_unconfirmed_irreversible');
  });

  it('a reversible write needs no confirm and reaches the transport boundary', async () => {
    const r = await run({ building: 'clarendon', action: 'create_reservation',
      mode: 'execute', idempotency_key: 'k2', payload: booking });
    expect(r.data?.state).toBe('transport_not_implemented');
  });

  it('all gates passing still sends nothing — transport is unimplemented', async () => {
    const r = await run({ building: 'clarendon', action: 'send_message',
      mode: 'execute', idempotency_key: 'k3',
      payload: { recipient: 'Kenny Martin', body: 'hi', confirm: true } });
    expect(r.success).toBe(false);
    expect(r.data?.state).toBe('transport_not_implemented');
  });

  it('gate 2 still precedes the write gates when credentials are absent', async () => {
    const r = await run({ building: 'commodore', action: 'create_reservation',
      mode: 'execute', idempotency_key: 'k4', payload: booking }, KV({}));
    expect(r.data?.state).toBe('credentials_missing');
  });
});
