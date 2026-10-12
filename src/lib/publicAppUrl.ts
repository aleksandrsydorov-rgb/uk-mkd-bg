/**
 * Canonical public origin for this installation (one complex = one deploy).
 *
 * Configure per installation via NEXT_PUBLIC_SITE_URL (preferred) or
 * NEXT_PUBLIC_APP_URL. Example production: https://amadeus11.online
 *
 * IMPORTANT: Next.js only inlines *static* `process.env.NEXT_PUBLIC_*` access
 * into the client bundle. Never read these keys only via dynamic `env[name]`.
 */

type EnvProbe = Record<string, string | undefined>;

/** Inlined by Next at build time for client + server. */
const INLINE_SITE_URL = process.env.NEXT_PUBLIC_SITE_URL;
const INLINE_APP_URL = process.env.NEXT_PUBLIC_APP_URL;
const INLINE_VERCEL_ENV = process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.VERCEL_ENV;
const INLINE_VERCEL_URL = process.env.NEXT_PUBLIC_VERCEL_URL ?? process.env.VERCEL_URL;

export function isLocalhostOrigin(origin: string): boolean {
  try {
    const u = new URL(origin.includes('://') ? origin : `http://${origin}`);
    return (
      u.hostname === 'localhost' ||
      u.hostname === '127.0.0.1' ||
      u.hostname === '[::1]' ||
      u.hostname.endsWith('.localhost')
    );
  } catch {
    return false;
  }
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function parseSiteUrl(raw: string | undefined | null): string | null {
  const t = (raw ?? '').trim();
  if (!t) return null;
  try {
    const withProtocol = t.includes('://') ? t : `https://${t}`;
    const u = new URL(withProtocol);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return stripTrailingSlash(u.origin);
  } catch {
    return null;
  }
}

function resolveEnv(override?: EnvProbe): EnvProbe {
  return {
    NEXT_PUBLIC_SITE_URL: INLINE_SITE_URL,
    NEXT_PUBLIC_APP_URL: INLINE_APP_URL,
    NEXT_PUBLIC_VERCEL_ENV: INLINE_VERCEL_ENV,
    VERCEL_ENV: INLINE_VERCEL_ENV,
    NEXT_PUBLIC_VERCEL_URL: INLINE_VERCEL_URL,
    VERCEL_URL: INLINE_VERCEL_URL,
    ...(override ?? {}),
  };
}

function isProductionDeploy(env: EnvProbe): boolean {
  const v = (env.NEXT_PUBLIC_VERCEL_ENV ?? env.VERCEL_ENV ?? '').trim().toLowerCase();
  return v === 'production';
}

/**
 * Resolve the public app origin for invite links and Auth emailRedirectTo.
 *
 * Priority:
 * 1. NEXT_PUBLIC_SITE_URL / NEXT_PUBLIC_APP_URL (installation config)
 * 2. Local browser origin when it is localhost (dev without config)
 * 3. https://VERCEL_URL for preview deploys without SITE_URL
 */
export function getPublicAppOrigin(
  envOverride?: EnvProbe,
  browserOrigin?: string | null
): string {
  const env = resolveEnv(envOverride);
  const configured =
    parseSiteUrl(env.NEXT_PUBLIC_SITE_URL) ?? parseSiteUrl(env.NEXT_PUBLIC_APP_URL);
  if (configured) {
    return configured;
  }

  if (isProductionDeploy(env)) {
    throw new Error(
      'Missing NEXT_PUBLIC_SITE_URL for production invite/auth links'
    );
  }

  const browser = (browserOrigin ?? '').trim();
  if (browser && isLocalhostOrigin(browser)) {
    return stripTrailingSlash(browser);
  }

  const vercelHost = (env.NEXT_PUBLIC_VERCEL_URL ?? env.VERCEL_URL ?? '')
    .trim()
    .replace(/^https?:\/\//, '');
  if (vercelHost) {
    return `https://${vercelHost.split('/')[0]}`;
  }

  if (browser) {
    return stripTrailingSlash(browser);
  }

  return 'http://localhost:3000';
}

export function buildAbsoluteAppUrl(
  path: string,
  envOverride?: EnvProbe,
  browserOrigin?: string | null
): string {
  const origin = getPublicAppOrigin(envOverride, browserOrigin);
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${origin}${p}`;
}

export function buildInviteAbsoluteUrl(
  inviteToken: string,
  envOverride?: EnvProbe,
  browserOrigin?: string | null
): string {
  const token = encodeURIComponent(inviteToken);
  return buildAbsoluteAppUrl(`/auth/invite?token=${token}`, envOverride, browserOrigin);
}

/** True when an absolute URL is unsafe to send (localhost / private). */
export function isNonPublicInviteUrl(url: string): boolean {
  try {
    return isLocalhostOrigin(url);
  } catch {
    return true;
  }
}
