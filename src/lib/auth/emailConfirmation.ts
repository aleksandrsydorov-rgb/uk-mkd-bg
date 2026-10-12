/**
 * Supabase Auth email confirmation helpers.
 *
 * Root cause of OTP mismatch: default Confirm signup templates use
 * {{ .ConfirmationURL }} (magic link). The invite UI expected a 6-digit OTP
 * via verifyOtp(type: 'signup'), which only works when the Auth template
 * includes {{ .Token }}. Current docs recommend verifyOtp type: 'email'.
 *
 * App strategy (dual-path):
 * 1) OTP code → verifyOtp({ email, token, type: 'email' }) with signup fallback
 * 2) Magic / confirm link → /auth/callback (code exchange or token_hash)
 */

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
  // Legacy Supabase redirects may still say type=signup
  if (t === 'confirm' || t === 'confirmation') return 'email';
  return 'email';
}

/** Preferred verify order for a typed 6-digit signup confirmation code. */
export function signupOtpVerifyTypes(): AuthEmailOtpType[] {
  return ['email', 'signup'];
}

export function buildAuthCallbackUrl(opts: {
  origin: string;
  nextPath: string;
}): string {
  const origin = opts.origin.replace(/\/$/, '');
  const next = opts.nextPath.startsWith('/') ? opts.nextPath : `/${opts.nextPath}`;
  const url = new URL('/auth/callback', origin);
  url.searchParams.set('next', next);
  return url.toString();
}

export function buildInviteAcceptPath(inviteToken: string): string {
  return `/auth/invite?token=${encodeURIComponent(inviteToken)}`;
}

export function safeNextPath(raw: string | null | undefined, fallback = '/account'): string {
  const v = (raw ?? '').trim();
  if (!v.startsWith('/') || v.startsWith('//')) return fallback;
  return v;
}
