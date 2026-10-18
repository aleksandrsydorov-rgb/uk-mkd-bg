import { describe, expect, it } from 'vitest';
import {
  decodeJwtHeaderUnsafe,
  isJwtSignatureUnverifiableError,
  jwtKidInJwks,
  readAuthRedirectError,
} from '@/lib/auth/jwtAuthErrors';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('jwtAuthErrors — ES256 / JWKS failure classification', () => {
  it('detects the observed GoTrue keyfunc / kid error', () => {
    const msg =
      'invalid JWT: unable to parse or verify signature, token is unverifiable: error while executing keyfunc: unrecognized JWT kid for algorithm ES256';
    expect(isJwtSignatureUnverifiableError(msg)).toBe(true);
    expect(isJwtSignatureUnverifiableError('invalid claim: missing sub claim')).toBe(
      false,
    );
  });

  it('decodes JWT header without verifying signature', () => {
    // header {"alg":"ES256","kid":"abc","typ":"JWT"} — public test vector shape only
    const headerJson = Buffer.from(
      JSON.stringify({ alg: 'ES256', kid: 'abc', typ: 'JWT' }),
    ).toString('base64url');
    const fake = `${headerJson}.payload.sig`;
    const h = decodeJwtHeaderUnsafe(fake);
    expect(h?.alg).toBe('ES256');
    expect(h?.kid).toBe('abc');
    expect(jwtKidInJwks(h, ['abc', 'other'])).toBe(true);
    expect(jwtKidInJwks(h, ['other'])).toBe(false);
  });

  it('reads Auth redirect errors from query or hash', () => {
    const q = new URLSearchParams(
      'error_description=invalid+JWT%3A+unable+to+parse+or+verify+signature',
    );
    expect(readAuthRedirectError({ searchParams: q, hash: '' })).toMatch(/invalid JWT/i);

    const fromHash = readAuthRedirectError({
      searchParams: new URLSearchParams(),
      hash: '#error=access_denied&error_description=unrecognized+JWT+kid',
    });
    expect(fromHash).toMatch(/unrecognized JWT kid/i);
  });

  it('proxy falls back on unverifiable JWT (source contract)', () => {
    const proxy = readFileSync(resolve('src/lib/supabase/proxy.ts'), 'utf8');
    expect(proxy).toContain('getClaims');
    expect(proxy).toContain('getUser');
    expect(proxy).toContain('isJwtSignatureUnverifiableError');
    expect(proxy).toContain('signOut');
  });

  it('first-boot CLI delivers invite via Auth SMTP without secret URLs', () => {
    const cli = readFileSync(resolve('scripts/r1-first-boot.mjs'), 'utf8');
    expect(cli).toContain('inviteUserByEmail');
    expect(cli).toContain('redactInviteOperatorPayload');
    expect(cli).toContain('AUTH_SMTP_BLOCKER');
    expect(cli).not.toContain('buildAppTokenHashCallbackUrl');
    expect(cli).not.toContain('generateLink');
    expect(cli).not.toContain('r1_first_boot_app_callback.url.txt');
  });
});

