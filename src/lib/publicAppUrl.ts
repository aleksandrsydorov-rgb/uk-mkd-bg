/**
 * Canonical public origin for this installation (one complex = one deploy).
 *
 * Configure per installation via NEXT_PUBLIC_SITE_URL (preferred) or
 * NEXT_PUBLIC_APP_URL. Example production: https://amadeus11.online
 *
 * Invite / Auth redirect links MUST use this helper — never raw
 * window.location.origin for production invite payloads (avoids localhost leaks
 * when an admin opens a local Next.js against the production database).
 */

type EnvProbe = Record<string, string | undefined>;

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

function configuredSiteUrl(env: EnvProbe): string | null {
  const raw = (env.NEXT_PUBLIC_SITE_URL ?? env.NEXT_PUBLIC_APP_URL ?? '').trim();
  if (!raw) return null;
  try {
    const withProtocol = raw.includes('://') ? raw : `https://${raw}`;
    const u = new URL(withProtocol);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return stripTrailingSlash(u.origin);
  } catch {
    return null;
  }
}

function isProductionDeploy(env: EnvProbe): boolean {
  // Prefer Vercel target — local `next build` sets NODE_ENV=production without being prod traffic.
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
 * 4. Safe fallback: localhost:3000 in non-production; throw-quality empty avoided
 */
export function getPublicAppOrigin(
  env: EnvProbe = process.env as EnvProbe,
  browserOrigin?: string | null
): string {
  const configured = configuredSiteUrl(env);
  if (configured) {
    // Always prefer installation URL — fixes local admin → production DB leak.
    return configured;
  }

  // Production without SITE_URL must never fall back to the browser tab origin
  // (admins often open localhost against the production database).
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
  env?: EnvProbe,
  browserOrigin?: string | null
): string {
  const origin = getPublicAppOrigin(env, browserOrigin);
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${origin}${p}`;
}

export function buildInviteAbsoluteUrl(
  inviteToken: string,
  env?: EnvProbe,
  browserOrigin?: string | null
): string {
  const token = encodeURIComponent(inviteToken);
  return buildAbsoluteAppUrl(`/auth/invite?token=${token}`, env, browserOrigin);
}

/** True when an absolute URL is unsafe to send (localhost / private). */
export function isNonPublicInviteUrl(url: string): boolean {
  try {
    return isLocalhostOrigin(url);
  } catch {
    return true;
  }
}
