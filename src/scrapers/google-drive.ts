import { wrapResult, type ScraperModule } from './base';

export interface DriveSearchInput {
  query: string;
  mimeType?: string;
  folderId?: string;
  maxResults?: number;
  flagForIngestion?: boolean;
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  createdTime?: string;
  modifiedTime?: string;
  owners?: string[];
  webViewLink?: string;
  parents?: string[];
  md5Checksum?: string;
}

export interface DriveSearchData {
  files: DriveFile[];
  totalResults: number;
  query: string;
  flaggedForIngestion: boolean;
  ingestionManifest?: IngestionManifest;
}

export interface IngestionManifest {
  source: 'gdrive_sync';
  scrapedAt: string;
  fileCount: number;
  files: Array<{
    sourceRef: string;
    driveFileId: string;
    name: string;
    mimeType: string;
    fileSize?: number;
    downloadUrl: string;
    sourceMetadata: {
      drive_md5?: string;
      drive_created_time?: string;
      drive_modified_time?: string;
      drive_owners?: string[];
      drive_parents?: string[];
      drive_web_view_link?: string;
    };
  }>;
}

const DRIVE_API = 'https://www.googleapis.com/drive/v3';

const FILE_FIELDS = 'id,name,mimeType,size,createdTime,modifiedTime,owners,webViewLink,parents,md5Checksum';

/** Default export MIME types for Google Workspace native files. */
const WORKSPACE_EXPORT_TYPES: Record<string, string> = {
  'application/vnd.google-apps.document': 'application/pdf',
  'application/vnd.google-apps.spreadsheet': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.google-apps.presentation': 'application/pdf',
  'application/vnd.google-apps.drawing': 'application/pdf',
};

const MAX_PAGES = 5;

/**
 * Exchange a Google service account key for an access token.
 * Builds a self-signed JWT and exchanges it for an OAuth2 token.
 */
async function getAccessToken(serviceAccountKey: string): Promise<string> {
  const key = JSON.parse(serviceAccountKey);

  const header = { alg: 'RS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: key.client_email,
    scope: 'https://www.googleapis.com/auth/drive.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };

  const enc = (obj: unknown) =>
    btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  const unsignedToken = `${enc(header)}.${enc(claims)}`;

  // Import the RSA private key
  const pemBody = key.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\n/g, '');
  const binaryKey = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    binaryKey,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    new TextEncoder().encode(unsignedToken),
  );

  const sig = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const jwt = `${unsignedToken}.${sig}`;

  // Exchange JWT for access token
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    throw new Error(`Google OAuth token exchange failed: ${tokenRes.status} ${err}`);
  }

  const tokenData = (await tokenRes.json()) as { access_token: string };
  return tokenData.access_token;
}

/** Escape a string for use inside a Drive API single-quoted literal. */
function escapeDriveLiteral(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * Build a Google Drive search query string from structured input.
 */
function buildDriveQuery(input: DriveSearchInput): string {
  const parts: string[] = [];

  if (input.query) {
    parts.push(`fullText contains '${escapeDriveLiteral(input.query)}'`);
  }

  if (input.mimeType) {
    parts.push(`mimeType = '${escapeDriveLiteral(input.mimeType)}'`);
  }

  if (input.folderId) {
    parts.push(`'${escapeDriveLiteral(input.folderId)}' in parents`);
  }

  parts.push('trashed = false');

  return parts.join(' and ');
}

export const googleDriveScraper: ScraperModule<DriveSearchInput, DriveSearchData> = {
  meta: {
    id: 'google-drive',
    name: 'Google Drive Search',
    category: 'generic',
    version: '0.1.0',
    requiresAuth: true,
    credentialKeys: ['google-drive:service-account-key'],
  },

  // API-only scraper — no browser lifecycle needed (exempt from puppeteer.launch guideline)
  async execute(_browser, env, input) {
    if (!input?.query?.trim()) {
      return wrapResult<DriveSearchData>('google-drive', false, undefined, 'query is required');
    }

    const serviceAccountKey = await env.SCRAPE_KV.get('google-drive:service-account-key');
    if (!serviceAccountKey) {
      return wrapResult<DriveSearchData>('google-drive', false, undefined, 'Google Drive service account key not configured');
    }

    try {
      const accessToken = await getAccessToken(serviceAccountKey);
      const q = buildDriveQuery(input);
      const pageSize = Math.min(input.maxResults || 50, 100);
      const authHeaders = { Authorization: `Bearer ${accessToken}` };

      // Paginate through all results (capped at MAX_PAGES to bound execution time)
      type RawFile = {
        id: string; name: string; mimeType: string; size?: string;
        createdTime?: string; modifiedTime?: string;
        owners?: Array<{ displayName: string; emailAddress: string }>;
        webViewLink?: string; parents?: string[]; md5Checksum?: string;
      };
      const allRawFiles: RawFile[] = [];
      let pageToken: string | undefined;

      for (let page = 0; page < MAX_PAGES; page++) {
        let url = `${DRIVE_API}/files?q=${encodeURIComponent(q)}&fields=files(${FILE_FIELDS}),nextPageToken&pageSize=${pageSize}&orderBy=modifiedTime desc`;
        if (pageToken) url += `&pageToken=${encodeURIComponent(pageToken)}`;

        const res = await fetch(url, { headers: authHeaders });
        if (!res.ok) {
          const errBody = await res.text();
          return wrapResult<DriveSearchData>('google-drive', false, undefined, `Drive API error: ${res.status} ${errBody}`);
        }

        const body = (await res.json()) as { files: RawFile[]; nextPageToken?: string };
        allRawFiles.push(...(body.files || []));
        pageToken = body.nextPageToken;
        if (!pageToken) break;
      }

      const files: DriveFile[] = allRawFiles.map((f) => ({
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        size: f.size,
        createdTime: f.createdTime,
        modifiedTime: f.modifiedTime,
        owners: f.owners?.map((o) => o.emailAddress),
        webViewLink: f.webViewLink,
        parents: f.parents,
        md5Checksum: f.md5Checksum,
      }));

      const flagged = input.flagForIngestion === true;
      const now = new Date().toISOString();

      const data: DriveSearchData = {
        files,
        totalResults: files.length,
        query: input.query,
        flaggedForIngestion: flagged,
      };

      // Build ingestion manifest for ChittyEvidence pipeline
      // Uses gdrive_sync source type and gdrive:// source_ref format per ChittyEvidence schema
      // MD5 stored in sourceMetadata (not source_hash) — IntakeWorker computes SHA-256 from content
      if (flagged && files.length > 0) {
        data.ingestionManifest = {
          source: 'gdrive_sync',
          scrapedAt: now,
          fileCount: files.length,
          files: files.map((f) => {
            // Workspace files (Docs/Sheets/Slides) require export, not alt=media
            const exportMime = WORKSPACE_EXPORT_TYPES[f.mimeType];
            const downloadUrl = exportMime
              ? `${DRIVE_API}/files/${f.id}/export?mimeType=${encodeURIComponent(exportMime)}`
              : `${DRIVE_API}/files/${f.id}?alt=media`;

            return {
              sourceRef: `gdrive://${f.id}`,
              driveFileId: f.id,
              name: f.name,
              mimeType: f.mimeType,
              fileSize: f.size ? parseInt(f.size, 10) : undefined,
              downloadUrl,
              sourceMetadata: {
                drive_md5: f.md5Checksum,
                drive_created_time: f.createdTime,
                drive_modified_time: f.modifiedTime,
                drive_owners: f.owners,
                drive_parents: f.parents,
                drive_web_view_link: f.webViewLink,
              },
            };
          }),
        };
      }

      return wrapResult('google-drive', true, data);
    } catch (err: any) {
      const message = err?.message || String(err);
      console.error(`Scraper google-drive failed: ${message}`, err?.stack);
      return wrapResult<DriveSearchData>('google-drive', false, undefined, message);
    }
  },
};
