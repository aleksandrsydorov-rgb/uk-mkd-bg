/**
 * Supabase Auth email confirmation helpers.
 *
 * Dual-path:
 * 1) OTP code → verifyOtp({ email, token, type: 'email' }) with signup fallback
 * 2) Magic / confirm link → /auth/callback (code exchange or token_hash)
 */

import {
  buildInviteAbsoluteUrl,
  getPublicAppOrigin,
} from '@/lib/publicAppUrl';

export type AuthEmailOtpType =
  | 'email'
  | 'signup'
  | 'invite'
  | 'magiclink'
  | 'recovery'
  | 'email_change';

const OTP_TYPES: AuthEmailOtpType[] = [
  'email',
  'signup',
  'invite',
  'magiclink',
  'recovery',
  'email_change',
];

export function normalizeAuthOtpType(raw: string | null | undefined): AuthEmailOtpType {
  const t = (raw ?? '').trim().toLowerCase();
  if ((OTP_TYPES as string[]).includes(t)) return t as AuthEmailOtpType;
  if (t === 'confirm' || t === 'confirmation') return 'email';
  return 'email';
}

/**
 * OTP type for verifyOtp({ token_hash }).
 * Canonical mapping lives in otpTokenTypes (magiclink → recovery;
 * signup → email; invite / recovery / email_change preserved).
 */
export { otpTypeForTokenHashVerify } from '@/lib/auth/otpTokenTypes';

/** Preferred verify order for a typed 6-digit signup confirmation code. */
export function signupOtpVerifyTypes(): AuthEmailOtpType[] {
  return ['email', 'signup'];
}

export function buildAuthCallbackUrl(opts: {
  nextPath: string;
  /** Override origin (tests). Default: installation public origin. */
  origin?: string;
  env?: Record<string, string | undefined>;
  browserOrigin?: string | null;
}): string {
  const origin = (
    opts.origin ?? getPublicAppOrigin(opts.env, opts.browserOrigin)
  ).replace(/\/$/, '');
  const next = opts.nextPath.startsWith('/') ? opts.nextPath : `/${opts.nextPath}`;
  const url = new URL('/auth/callback', origin);
  url.searchParams.set('next', next);
  return url.toString();
}

export function buildInviteAcceptPath(inviteToken: string): string {
  return `/auth/invite?token=${encodeURIComponent(inviteToken)}`;
}

export function buildInviteAcceptAbsoluteUrl(
  inviteToken: string,
  env?: Record<string, string | undefined>,
  browserOrigin?: string | null
): string {
  return buildInviteAbsoluteUrl(inviteToken, env, browserOrigin);
}

export function safeNextPath(raw: string | null | undefined, fallback = '/account'): string {
  const v = (raw ?? '').trim();
  if (!v.startsWith('/') || v.startsWith('//')) return fallback;
  return v;
}

export function isAlreadyRegisteredAuthError(message: string): boolean {
  return /already|registered|exists|user already/i.test(message);
}

export function isEmailNotConfirmedAuthError(message: string): boolean {
  return /not confirmed|email.*confirm|confirm.*email/i.test(message);
}

export function isInvalidOtpAuthError(message: string): boolean {
  return /otp|token|code|invalid|expired/i.test(message) &&
    /invalid|expired|otp|token|code/i.test(message);
}

/** Supabase may return 200 + empty identities when email already registered. */
export function isSoftExistingSignupUser(user: {
  identities?: Array<unknown> | null;
} | null | undefined): boolean {
  if (!user) return false;
  const identities = user.identities;
  return Array.isArray(identities) && identities.length === 0;
}
