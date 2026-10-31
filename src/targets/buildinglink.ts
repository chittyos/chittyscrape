import puppeteer from '@cloudflare/puppeteer';
import { wrapResult, resolveSelector, type ScraperModule } from './base';

/**
 * BuildingLink resident portal — read + write.
 *
 * Complements `appfolio-hoa`, which covers the HOA *accounting* portal (ledger,
 * balance, violations). BuildingLink is the separate resident-services portal:
 * announcements, document library, maintenance, deliveries, reservations,
 * guest authorization and the resident board.
 *
 * WRITE SAFETY. Writes mutate the building's system of record and are visible
 * to staff and other residents. Every gate must pass; any failure returns a
 * structured refusal and never navigates:
 *   1. building known            5. mode === 'execute'
 *   2. credentials present       6. idempotency_key present
 *   3. route verified            7. confirm:true when there is no portal undo
 *   4. required fields present
 */

export type BuildingLinkRead =
  | 'list_announcements' | 'list_documents' | 'list_maintenance_requests'
  | 'list_deliveries' | 'list_reservations' | 'list_authorized_guests'
  | 'list_events' | 'list_classifieds';

export type BuildingLinkWrite =
  | 'submit_maintenance_request' | 'cancel_maintenance_request'
  | 'create_reservation' | 'cancel_reservation'
  | 'authorize_guest' | 'revoke_guest'
  | 'post_classified' | 'send_message';

export type BuildingLinkAction = 'status' | BuildingLinkRead | BuildingLinkWrite;

export interface BuildingLinkInput {
  building: string;
  action: BuildingLinkAction;
  payload?: Record<string, any>;
  /** Writes only. Defaults to 'dry_run' — validates and sends nothing. */
  mode?: 'dry_run' | 'execute';
  /** Required when mode === 'execute'. */
  idempotency_key?: string;
}

export interface BuildingLinkData {
  building: string;
  action: BuildingLinkAction;
  state: string;
  items?: unknown[];
  intent?: Record<string, unknown>;
  modules?: Array<{ action: string; evidence: boolean; verified: boolean }>;
  writes?: Array<{ action: string; verified: boolean; irreversible: boolean }>;
  note?: string;
}

/**
 * Known buildings. Each maps to a BuildingLink subdomain and a KV credential
 * prefix. New building: add an entry and store `<prefix>:username` /
 * `<prefix>:password` in SCRAPE_KV.
 *
 * `subdomain` values are UNVERIFIED — confirm from a live session before use.
 */
const BUILDINGS: Record<string, { subdomain: string; credPrefix: string; label: string }> = {
  'clarendon': {
    subdomain: 'www',
    credPrefix: 'buildinglink-clarendon',
    label: '4343 N Clarendon Ave',
  },
  'commodore': {
    subdomain: 'www',
    credPrefix: 'buildinglink-commodore',
    label: '550 W Surf (Commodore)',
  },
};

/** Read modules. `verified` gates execution; `evidence` marks retention-worthy surfaces. */
const READS: Record<BuildingLinkRead, { path: string; verified: boolean; evidence: boolean }> = {
  list_announcements:        { path: '/V2/Tenant/Announcements/List.aspx',        verified: false, evidence: true  },
  list_documents:            { path: '/V2/Tenant/Library/Documents.aspx',         verified: false, evidence: true  },
  list_maintenance_requests: { path: '/V2/Tenant/MaintenanceRequests/List.aspx',  verified: false, evidence: true  },
  list_deliveries:           { path: '/V2/Tenant/Deliveries/List.aspx',           verified: false, evidence: false },
  list_reservations:         { path: '/V2/Tenant/Reservations/List.aspx',         verified: false, evidence: false },
  list_authorized_guests:    { path: '/V2/Tenant/Occupants/AuthorizedGuests.aspx', verified: false, evidence: false },
  list_events:               { path: '/V2/Tenant/Calendar/Events.aspx',           verified: false, evidence: false },
  list_classifieds:          { path: '/V2/Tenant/Classifieds/List.aspx',          verified: false, evidence: false },
};

/** Write modules. `reverses: null` means no portal-side undo — requires confirm:true. */
const WRITES: Record<BuildingLinkWrite, {
  path: string; verified: boolean; requires: string[]; snapshot: BuildingLinkRead | null; reverses: string | null;
}> = {
  submit_maintenance_request: { path: '/V2/Tenant/MaintenanceRequests/New.aspx', verified: false, requires: ['unit', 'category', 'summary'], snapshot: 'list_maintenance_requests', reverses: 'cancel_maintenance_request' },
  cancel_maintenance_request: { path: '/V2/Tenant/MaintenanceRequests/Cancel.aspx', verified: false, requires: ['request_id'], snapshot: 'list_maintenance_requests', reverses: null },
  create_reservation:         { path: '/V2/Tenant/Reservations/New.aspx', verified: false, requires: ['amenity', 'startsAt', 'endsAt'], snapshot: 'list_reservations', reverses: 'cancel_reservation' },
  cancel_reservation:         { path: '/V2/Tenant/Reservations/Cancel.aspx', verified: false, requires: ['reservation_id'], snapshot: 'list_reservations', reverses: null },
  authorize_guest:            { path: '/V2/Tenant/Occupants/AuthorizeGuest.aspx', verified: false, requires: ['name', 'validFrom', 'validTo'], snapshot: 'list_authorized_guests', reverses: 'revoke_guest' },
  revoke_guest:               { path: '/V2/Tenant/Occupants/RevokeGuest.aspx', verified: false, requires: ['guest_id'], snapshot: 'list_authorized_guests', reverses: null },
  post_classified:            { path: '/V2/Tenant/Classifieds/New.aspx', verified: false, requires: ['category', 'title', 'body'], snapshot: 'list_classifieds', reverses: null },
  send_message:               { path: '/V2/Tenant/Messages/Send.aspx', verified: false, requires: ['recipient', 'body'], snapshot: null, reverses: null },
};

const READ_ACTIONS = Object.keys(READS) as BuildingLinkRead[];
const WRITE_ACTIONS = Object.keys(WRITES) as BuildingLinkWrite[];

const PORTAL = 'buildinglink';

function isWrite(a: string): a is BuildingLinkWrite {
  return Object.prototype.hasOwnProperty.call(WRITES, a);
}
function isRead(a: string): a is BuildingLinkRead {
  return Object.prototype.hasOwnProperty.call(READS, a);
}

function refuse(building: string, action: BuildingLinkAction, state: string, note: string, intent?: Record<string, unknown>) {
  return wrapResult<BuildingLinkData>(PORTAL, false, { building, action, state, note, intent }, note);
}

export const buildinglinkScraper: ScraperModule<BuildingLinkInput, BuildingLinkData> = {
  meta: {
    id: 'buildinglink',
    name: 'BuildingLink Resident Portal',
    category: 'hoa',
    version: '0.1.0',
    requiresAuth: true,
    credentialKeys: [
      'buildinglink-clarendon:username', 'buildinglink-clarendon:password',
      'buildinglink-commodore:username', 'buildinglink-commodore:password',
    ],
  },

  async execute(browser, env, input) {
    const action = (input?.action || 'status') as BuildingLinkAction;
    const buildingKey = typeof input?.building === 'string' ? input.building.trim().toLowerCase() : '';
    const payload = input?.payload || {};
    const mode = input?.mode || 'dry_run';

    // --- Gate 1: known building ---
    // Own-property lookup: an inherited name ("constructor", "toString") must not
    // resolve to a truthy prototype member and slip past this gate.
    const building = Object.prototype.hasOwnProperty.call(BUILDINGS, buildingKey)
      ? BUILDINGS[buildingKey]
      : undefined;
    if (!building) {
      return refuse(buildingKey, action, 'unknown_building',
        `Unknown building "${buildingKey}". Available: ${Object.keys(BUILDINGS).join(', ')}`);
    }

    // --- status: inventory, no navigation ---
    if (action === 'status') {
      const username = await env.SCRAPE_KV.get(`${building.credPrefix}:username`);
      const password = await env.SCRAPE_KV.get(`${building.credPrefix}:password`);
      const credsReady = Boolean(username && password);
      return wrapResult<BuildingLinkData>(PORTAL, true, {
        building: buildingKey,
        action,
        state: credsReady ? 'ok' : 'credentials_missing',
        modules: READ_ACTIONS.map((a) => ({ action: a, evidence: READS[a].evidence, verified: READS[a].verified })),
        writes: WRITE_ACTIONS.map((a) => ({ action: a, verified: WRITES[a].verified, irreversible: WRITES[a].reverses === null })),
        note: credsReady
          ? `${building.label}: credentials present. Routes are UNVERIFIED until confirmed against a live session.`
          : `${building.label}: credentials not configured (${building.credPrefix}:username / :password).`,
      });
    }

    if (!isRead(action) && !isWrite(action)) {
      return refuse(buildingKey, action, 'unsupported_action',
        `Unsupported action "${action}". Reads: ${READ_ACTIONS.join(', ')}. Writes: ${WRITE_ACTIONS.join(', ')}.`);
    }

    // --- Gate 2: credentials ---
    const username = await env.SCRAPE_KV.get(`${building.credPrefix}:username`);
    const password = await env.SCRAPE_KV.get(`${building.credPrefix}:password`);
    if (!username || !password) {
      return refuse(buildingKey, action, 'credentials_missing',
        `Credentials not configured for ${building.label} (${building.credPrefix}:username / :password)`);
    }

    if (isWrite(action)) {
      const spec = WRITES[action];
      const irreversible = spec.reverses === null;
      const missing = spec.requires.filter((f) => payload[f] === undefined || payload[f] === null || payload[f] === '');
      const intent: Record<string, unknown> = {
        action,
        fields: Object.fromEntries(spec.requires.filter((f) => payload[f] !== undefined).map((f) => [f, payload[f]])),
        irreversible,
        reversed_by: spec.reverses,
        snapshot_action: spec.snapshot,
      };

      // --- Gate 4: required fields ---
      if (missing.length) {
        return refuse(buildingKey, action, 'refused_missing_fields',
          `Missing required field(s): ${missing.join(', ')}.`, intent);
      }
      // --- Gate 3: route verified ---
      if (!spec.verified) {
        return refuse(buildingKey, action, 'blocked_unverified_route',
          `Write route for "${action}" is UNVERIFIED and disabled. Confirm it from a live session, then set verified:true.`, intent);
      }
      // --- Gate 5: mode ---
      if (mode !== 'execute') {
        return wrapResult<BuildingLinkData>(PORTAL, true, {
          building: buildingKey, action, state: 'dry_run', intent,
          note: 'Validated. Nothing sent. Re-run with mode="execute" and an idempotency_key.',
        });
      }
      // --- Gate 6: idempotency ---
      if (!input?.idempotency_key) {
        return refuse(buildingKey, action, 'refused_no_idempotency_key',
          'mode=execute requires idempotency_key so a replay cannot duplicate the mutation.', intent);
      }
      // --- Gate 7: confirm irreversible ---
      if (irreversible && payload.confirm !== true) {
        return refuse(buildingKey, action, 'refused_unconfirmed_irreversible',
          `"${action}" cannot be undone from the portal. Set payload.confirm=true to proceed.`, intent);
      }
      return refuse(buildingKey, action, 'transport_not_implemented',
        `All gates passed for "${action}" but the portal transport is not implemented. Capture ${spec.snapshot ?? 'no snapshot'} before mutating.`, intent);
    }

    // --- Reads: Gate 3 ---
    const read = READS[action as BuildingLinkRead];
    if (!read.verified) {
      return refuse(buildingKey, action, 'blocked_unverified_route',
        `Route for "${action}" is UNVERIFIED and disabled. Confirm it from a live session, then set verified:true.`);
    }

    // --- Verified read path. Login + fetch lands here. ---
    let browserInstance: any;
    let page: any;
    try {
      browserInstance = await puppeteer.launch(browser);
      page = await browserInstance.newPage();
      await page.setViewport({ width: 1280, height: 800 });
      await page.goto(`https://${building.subdomain}.buildinglink.com/V2/Global/Login/Login.aspx`, {
        waitUntil: 'networkidle0', timeout: 30000,
      });

      const userSel = await resolveSelector(page, [
        '#LoginUserName', 'input[name="username"]', 'input[name="UserName"]', 'input[type="email"]',
      ]);
      if (!userSel) return refuse(buildingKey, action, 'login_failed', 'Could not find username input on login page');
      await page.type(userSel, username);

      const passSel = await resolveSelector(page, [
        '#LoginPassword', 'input[name="password"]', 'input[name="Password"]', 'input[type="password"]',
      ]);
      if (!passSel) return refuse(buildingKey, action, 'login_failed', 'Could not find password input on login page');
      await page.type(passSel, password);

      const submitSel = await resolveSelector(page, [
        '#LoginButton', 'button[type="submit"]', 'input[type="submit"]', '.btn-primary[type="submit"]',
      ]);
      if (!submitSel) return refuse(buildingKey, action, 'login_failed', 'Could not find login button');

      return refuse(buildingKey, action, 'transport_not_implemented',
        `Login flow is scaffolded but "${action}" extraction is not implemented.`);
    } catch (err: any) {
      const message = err?.message || String(err);
      console.error(`Scraper ${PORTAL} (${building.label}) failed: ${message}`, err?.stack);
      return wrapResult<BuildingLinkData>(PORTAL, false, undefined, message);
    } finally {
      if (page) await page.close().catch((e: any) => console.warn(`Failed to close page: ${e.message}`));
      if (browserInstance) await browserInstance.close().catch((e: any) => console.warn(`Failed to close browser: ${e.message}`));
    }
  },
};
