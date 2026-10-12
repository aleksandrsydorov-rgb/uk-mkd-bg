import { describe, expect, it } from 'vitest';
import {
  buildAuthCallbackUrl,
  buildInviteAcceptPath,
  isAlreadyRegisteredAuthError,
  isEmailNotConfirmedAuthError,
  isInvalidOtpAuthError,
  isSoftExistingSignupUser,
  safeNextPath,
} from '@/lib/auth/emailConfirmation';
import {
  buildInviteAbsoluteUrl,
  getPublicAppOrigin,
  isLocalhostOrigin,
  isNonPublicInviteUrl,
} from '@/lib/publicAppUrl';

describe('publicAppUrl · installation origin', () => {
  it('uses NEXT_PUBLIC_SITE_URL even when browser is localhost', () => {
    const origin = getPublicAppOrigin(
      { NEXT_PUBLIC_SITE_URL: 'https://amadeus11.online' },
      'http://localhost:3001'
    );
    expect(origin).toBe('https://amadeus11.online');
  });

  it('accepts NEXT_PUBLIC_APP_URL without protocol', () => {
    expect(
      getPublicAppOrigin({ NEXT_PUBLIC_APP_URL: 'complex.example.com' }, null)
    ).toBe('https://complex.example.com');
  });

  it('allows localhost browser origin when SITE_URL unset (local dev)', () => {
    expect(
      getPublicAppOrigin({ NODE_ENV: 'development' }, 'http://localhost:3001')
    ).toBe('http://localhost:3001');
  });

  it('throws on Vercel production when SITE_URL missing', () => {
    expect(() =>
      getPublicAppOrigin({ VERCEL_ENV: 'production' }, 'http://localhost:3001')
    ).toThrow(/NEXT_PUBLIC_SITE_URL/);
  });

  it('builds absolute invite URLs from SITE_URL', () => {
    const url = buildInviteAbsoluteUrl('tok123', {
      NEXT_PUBLIC_SITE_URL: 'https://amadeus11.online',
    });
    expect(url).toBe('https://amadeus11.online/auth/invite?token=tok123');
  });

  it('detects non-public invite URLs', () => {
    expect(isLocalhostOrigin('http://localhost:3001')).toBe(true);
    expect(
      isNonPublicInviteUrl(
        'http://localhost:3001/auth/invite?token=example_local_token_not_for_use'
      )
    ).toBe(true);
    expect(isNonPublicInviteUrl('https://amadeus11.online/auth/invite?token=x')).toBe(false);
  });
});

describe('invite Auth helpers', () => {
  it('builds callback with installation origin override', () => {
    const next = buildInviteAcceptPath('abc123');
    const url = buildAuthCallbackUrl({
      origin: 'https://amadeus11.online',
      nextPath: next,
    });
    expect(url).toContain('https://amadeus11.online/auth/callback?next=');
    expect(decodeURIComponent(url)).toContain('/auth/invite?token=abc123');
    expect(safeNextPath('https://evil.example')).toBe('/account');
  });

  it('classifies Auth errors without leaking account shape', () => {
    expect(isAlreadyRegisteredAuthError('User already registered')).toBe(true);
    expect(isEmailNotConfirmedAuthError('Email not confirmed')).toBe(true);
    expect(isInvalidOtpAuthError('Token has expired or is invalid')).toBe(true);
    expect(isSoftExistingSignupUser({ identities: [] })).toBe(true);
    expect(isSoftExistingSignupUser({ identities: [{ id: '1' }] })).toBe(false);
  });
});
