import { describe, expect, it } from 'vitest';
import {
  normalizeAuthOtpType,
  otpTypeForTokenHashVerify,
} from '@/lib/auth/emailConfirmation';
import {
  evaluateOtpTypePreflight,
  otpTypeFromGenerateLinkVerification,
  otpTypeFromStoredTokenKind,
  otpTypeMatchesStoredKind,
} from '@/lib/auth/otpTokenTypes';

describe('otpTypeForTokenHashVerify', () => {
  it('maps magiclink to recovery (GoTrue recovery_token storage)', () => {
    expect(otpTypeForTokenHashVerify('magiclink')).toBe('recovery');
    expect(otpTypeForTokenHashVerify('MAGICLINK')).toBe('recovery');
  });

  it('maps signup/confirmation to email', () => {
    expect(otpTypeForTokenHashVerify('signup')).toBe('email');
    expect(otpTypeForTokenHashVerify('confirmation')).toBe('email');
  });

  it('preserves invite/recovery/email_change/email', () => {
    expect(otpTypeForTokenHashVerify('invite')).toBe('invite');
    expect(otpTypeForTokenHashVerify('recovery')).toBe('recovery');
    expect(otpTypeForTokenHashVerify('email_change')).toBe('email_change');
    expect(otpTypeForTokenHashVerify('email')).toBe('email');
  });

  it('normalize still accepts magiclink as a raw type before remap', () => {
    expect(normalizeAuthOtpType('magiclink')).toBe('magiclink');
  });

  it('callback guards one-time token_hash verify (source contract)', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const page = readFileSync(resolve('src/app/auth/callback/page.tsx'), 'utf8');
    expect(page).toContain('consumedTokenHashRef');
    expect(page).toContain('otpTypeForTokenHashVerify');
    expect(page).toContain("searchParams.delete('token_hash')");
  });
});

describe('otpTypeFromGenerateLinkVerification', () => {
  it('maps invite to invite (genuine invitation tokens)', () => {
    expect(otpTypeFromGenerateLinkVerification('invite')).toBe('invite');
  });

  it('maps magiclink and recovery to recovery', () => {
    expect(otpTypeFromGenerateLinkVerification('magiclink')).toBe('recovery');
    expect(otpTypeFromGenerateLinkVerification('recovery')).toBe('recovery');
  });

  it('maps email/signup/confirmation to email', () => {
    expect(otpTypeFromGenerateLinkVerification('email')).toBe('email');
    expect(otpTypeFromGenerateLinkVerification('signup')).toBe('email');
    expect(otpTypeFromGenerateLinkVerification('confirmation')).toBe('email');
  });

  it('does not blindly map unrelated types to recovery', () => {
    expect(otpTypeFromGenerateLinkVerification('invite')).not.toBe('recovery');
    expect(otpTypeFromGenerateLinkVerification('email')).not.toBe('recovery');
    expect(otpTypeFromGenerateLinkVerification('email_change')).toBe('email_change');
  });
});

describe('otpTypeFromStoredTokenKind + preflight', () => {
  it('maps recovery_token → recovery and matches URL type=recovery', () => {
    expect(otpTypeFromStoredTokenKind('recovery_token')).toBe('recovery');
    expect(otpTypeMatchesStoredKind('recovery', 'recovery_token')).toBe(true);
    expect(otpTypeMatchesStoredKind('email', 'recovery_token')).toBe(false);
    expect(otpTypeMatchesStoredKind('magiclink', 'recovery_token')).toBe(true);
  });

  it('maps confirmation_token → email', () => {
    expect(otpTypeFromStoredTokenKind('confirmation_token')).toBe('email');
    expect(otpTypeMatchesStoredKind('email', 'confirmation_token')).toBe(true);
    expect(otpTypeMatchesStoredKind('recovery', 'confirmation_token')).toBe(false);
  });

  it('maps invite_token → invite', () => {
    expect(otpTypeFromStoredTokenKind('invite_token')).toBe('invite');
    expect(otpTypeMatchesStoredKind('invite', 'invite_token')).toBe(true);
    expect(otpTypeMatchesStoredKind('email', 'invite_token')).toBe(false);
  });

  it('rejects invalid URL/stored combinations', () => {
    expect(
      evaluateOtpTypePreflight({
        urlType: 'email',
        storedKind: 'recovery_token',
      }),
    ).toMatchObject({ ok: false, reason: 'url_type_mismatch_stored_kind' });

    expect(
      evaluateOtpTypePreflight({
        urlType: 'invite',
        storedKind: 'recovery_token',
      }),
    ).toMatchObject({ ok: false });

    expect(
      evaluateOtpTypePreflight({
        urlType: 'recovery',
        storedKind: 'confirmation_token',
      }),
    ).toMatchObject({ ok: false });

    expect(
      evaluateOtpTypePreflight({
        urlType: 'email',
        storedKind: 'invite_token',
      }),
    ).toMatchObject({ ok: false });
  });

  it('passes valid recovery/invite/email combinations', () => {
    expect(
      evaluateOtpTypePreflight({
        urlType: 'recovery',
        storedKind: 'recovery_token',
      }).ok,
    ).toBe(true);
    expect(
      evaluateOtpTypePreflight({
        urlType: 'invite',
        storedKind: 'invite',
      }).ok,
    ).toBe(true);
    expect(
      evaluateOtpTypePreflight({
        urlType: 'email',
        storedKind: 'confirmation_token',
      }).ok,
    ).toBe(true);
  });

  it('fails when stored kind missing or unknown', () => {
    expect(
      evaluateOtpTypePreflight({ urlType: 'recovery', storedKind: null }),
    ).toMatchObject({ ok: false, reason: 'stored_otp_kind_missing' });
    expect(
      evaluateOtpTypePreflight({
        urlType: 'recovery',
        storedKind: 'weird_future_token',
      }),
    ).toMatchObject({ ok: false, reason: 'stored_otp_kind_unknown' });
  });
});
