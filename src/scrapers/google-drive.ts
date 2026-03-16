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
  source: 'google-drive';
  scrapedAt: string;
  fileCount: number;
  files: Array<{
    driveFileId: string;
    name: string;
    mimeType: string;
    size?: string;
    md5Checksum?: string;
    downloadUrl: string;
  }>;
}

const DRIVE_API = 'https://www.googleapis.com/drive/v3';

const FILE_FIELDS = 'id,name,mimeType,size,createdTime,modifiedTime,owners,webViewLink,parents,md5Checksum';

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

/**
 * Build a Google Drive search query string from structured input.
 */
function buildDriveQuery(input: DriveSearchInput): string {
  const parts: string[] = [];

  // Full-text search
  if (input.query) {
    parts.push(`fullText contains '${input.query.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`);
  }

  // MIME type filter
  if (input.mimeType) {
    parts.push(`mimeType = '${input.mimeType}'`);
  }

  // Folder scope
  if (input.folderId) {
    parts.push(`'${input.folderId}' in parents`);
  }

  // Exclude trashed files
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
      const maxResults = Math.min(input.maxResults || 50, 100);

      const searchUrl = `${DRIVE_API}/files?q=${encodeURIComponent(q)}&fields=files(${FILE_FIELDS}),nextPageToken&pageSize=${maxResults}&orderBy=modifiedTime desc`;

      const res = await fetch(searchUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!res.ok) {
        const errBody = await res.text();
        return wrapResult<DriveSearchData>('google-drive', false, undefined, `Drive API error: ${res.status} ${errBody}`);
      }

      const body = (await res.json()) as {
        files: Array<{
          id: string;
          name: string;
          mimeType: string;
          size?: string;
          createdTime?: string;
          modifiedTime?: string;
          owners?: Array<{ displayName: string; emailAddress: string }>;
          webViewLink?: string;
          parents?: string[];
          md5Checksum?: string;
        }>;
      };

      const files: DriveFile[] = (body.files || []).map((f) => ({
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
      if (flagged && files.length > 0) {
        data.ingestionManifest = {
          source: 'google-drive',
          scrapedAt: now,
          fileCount: files.length,
          files: files.map((f) => ({
            driveFileId: f.id,
            name: f.name,
            mimeType: f.mimeType,
            size: f.size,
            md5Checksum: f.md5Checksum,
            downloadUrl: `${DRIVE_API}/files/${f.id}?alt=media`,
          })),
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
