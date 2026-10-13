import { describe, expect, it } from 'vitest';
import { buildCredentialUrl } from '../src/chittyconnect';

describe('ChittyConnect credential refs', () => {
  it('routes canonical three-part refs to vault/item/field', () => {
    expect(
      buildCredentialUrl('https://connect.chitty.cc', 'integrations/reihub/username'),
    ).toBe('https://connect.chitty.cc/api/credentials/integrations/reihub/username');
  });

  it('normalizes a trailing slash on the broker base URL', () => {
    expect(
      buildCredentialUrl('https://connect.chitty.cc/', 'services/chittyfinance/token'),
    ).toBe('https://connect.chitty.cc/api/credentials/services/chittyfinance/token');
  });

  it('keeps legacy opaque refs encoded as one segment', () => {
    expect(
      buildCredentialUrl('https://connect.chitty.cc', 'op://ChittyOS/legacy/password'),
    ).toBe('https://connect.chitty.cc/api/credentials/op%3A%2F%2FChittyOS%2Flegacy%2Fpassword');
  });
});
