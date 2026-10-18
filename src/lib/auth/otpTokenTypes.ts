/**
 * Map Supabase Auth generateLink / stored OTP kinds → verifyOtp({ token_hash }).type
 *
 * Evidence (R1 first-boot): generateLink({ type: 'magiclink' }) stores
 * auth.one_time_tokens.token_type = 'recovery_token'. Using type=email fails with
 * "Email link is invalid or has expired".
 */

import type { AuthEmailOtpType } from '@/lib/auth/emailConfirmation';

/** Values observed on auth.one_time_tokens.token_type (and close aliases). */
export type StoredOtpTokenKind =
  | 'recovery_token'
  | 'confirmation_token'
  | 'email_change_token_current'
  | 'email_change_token_new'
  | 'reauthentication_token'
  | string;

/**
 * generateLink `properties.verification_type` → verifyOtp type.
 * Explicit mapping — not "all magiclinks are recovery" without cause:
 * GoTrue persists magiclink OTPs as recovery_token for existing users.
 */
export function otpTypeFromGenerateLinkVerification(
  verificationType: string | null | undefined,
): AuthEmailOtpType {
  const v = String(verificationType ?? '')
    .trim()
    .toLowerCase();
  switch (v) {
    case 'invite':
      return 'invite';
    case 'recovery':
      return 'recovery';
    case 'magiclink':
      // Stored as recovery_token in Auth (confirmed on zcecvbjjmbhwfjtlyjkt).
      return 'recovery';
    case 'email_change':
      return 'email_change';
    case 'signup':
    case 'email':
    case 'confirmation':
      return 'email';
    default:
      return 'email';
  }
}

/** auth.one_time_tokens.token_type → verifyOtp type */
export function otpTypeFromStoredTokenKind(
  storedKind: StoredOtpTokenKind | null | undefined,
): AuthEmailOtpType | null {
  const k = String(storedKind ?? '')
    .trim()
    .toLowerCase();
  switch (k) {
    case 'recovery_token':
    case 'recovery':
      return 'recovery';
    case 'confirmation_token':
    case 'signup':
    case 'email':
      return 'email';
    case 'invite':
    case 'invite_token':
      return 'invite';
    case 'email_change_token_current':
    case 'email_change_token_new':
    case 'email_change':
      return 'email_change';
    case 'reauthentication_token':
    case 'reauthentication':
      return 'email';
    default:
      return null;
  }
}

/**
 * Normalize URL/query OTP type for verifyOtp({ token_hash }).
 * Remaps deprecated aliases; magiclink → recovery (storage contract).
 */
export function otpTypeForTokenHashVerify(
  raw: string | null | undefined,
): AuthEmailOtpType {
  const t = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (t === 'magiclink') return 'recovery';
  if (t === 'signup' || t === 'confirmation' || t === 'confirm') return 'email';
  if (t === 'invite') return 'invite';
  if (t === 'recovery') return 'recovery';
  if (t === 'email_change') return 'email_change';
  if (t === 'email') return 'email';
  return otpTypeFromGenerateLinkVerification(t);
}

export function otpTypeMatchesStoredKind(
  urlOrVerifyType: string | null | undefined,
  storedKind: StoredOtpTokenKind | null | undefined,
): boolean {
  const expected = otpTypeFromStoredTokenKind(storedKind);
  if (!expected) return false;
  return otpTypeForTokenHashVerify(urlOrVerifyType) === expected;
}

export type OtpTypePreflightResult = {
  ok: boolean;
  urlType: string;
  storedKind: string | null;
  expectedVerifyType: AuthEmailOtpType | null;
  reason: string;
};

export function evaluateOtpTypePreflight(opts: {
  urlType: string | null | undefined;
  storedKind: StoredOtpTokenKind | null | undefined;
}): OtpTypePreflightResult {
  const urlType = otpTypeForTokenHashVerify(opts.urlType);
  const expectedVerifyType = otpTypeFromStoredTokenKind(opts.storedKind);
  if (!opts.storedKind) {
    return {
      ok: false,
      urlType,
      storedKind: null,
      expectedVerifyType: null,
      reason: 'stored_otp_kind_missing',
    };
  }
  if (!expectedVerifyType) {
    return {
      ok: false,
      urlType,
      storedKind: String(opts.storedKind),
      expectedVerifyType: null,
      reason: 'stored_otp_kind_unknown',
    };
  }
  if (urlType !== expectedVerifyType) {
    return {
      ok: false,
      urlType,
      storedKind: String(opts.storedKind),
      expectedVerifyType,
      reason: 'url_type_mismatch_stored_kind',
    };
  }
  return {
    ok: true,
    urlType,
    storedKind: String(opts.storedKind),
    expectedVerifyType,
    reason: 'match',
  };
}
