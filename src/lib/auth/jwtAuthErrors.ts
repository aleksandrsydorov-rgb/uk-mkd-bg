/**
 * Helpers for Auth JWT verification failures (asymmetric ES256 / JWKS).
 * Never log token material — only classify safe error messages.
 */

export function isJwtSignatureUnverifiableError(message: unknown): boolean {
  const m = String(message ?? '');
  return (
    /invalid JWT/i.test(m) &&
    (/unable to parse or verify signature/i.test(m) ||
      /unrecognized JWT kid/i.test(m) ||
      /error while executing keyfunc/i.test(m) ||
      /bad_jwt/i.test(m))
  );
}

export type JwtHeaderProbe = {
  alg?: string;
  kid?: string;
  typ?: string;
};

/** Decode JWT header only (no signature verification). Returns null if not a JWT shape. */
export function decodeJwtHeaderUnsafe(token: string): JwtHeaderProbe | null {
  const parts = String(token ?? '').split('.');
  if (parts.length < 2 || !parts[0]) return null;
  try {
    const b64 = parts[0].replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const json =
      typeof atob === 'function'
        ? atob(pad)
        : Buffer.from(pad, 'base64').toString('utf8');
    const parsed = JSON.parse(json) as JwtHeaderProbe;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function jwtKidInJwks(
  header: JwtHeaderProbe | null,
  jwksKids: readonly string[],
): boolean {
  const kid = header?.kid;
  if (!kid) return false;
  return jwksKids.includes(kid);
}

export function readAuthRedirectError(opts: {
  searchParams: URLSearchParams;
  hash: string;
}): string | null {
  const fromQuery =
    opts.searchParams.get('error_description') ||
    opts.searchParams.get('error_code') ||
    opts.searchParams.get('error');
  if (fromQuery) {
    return decodeURIComponent(fromQuery.replace(/\+/g, ' '));
  }
  const hash = opts.hash.replace(/^#/, '');
  if (!hash) return null;
  const hashParams = new URLSearchParams(hash);
  const fromHash =
    hashParams.get('error_description') ||
    hashParams.get('error_code') ||
    hashParams.get('error');
  if (!fromHash) return null;
  return decodeURIComponent(fromHash.replace(/\+/g, ' '));
}
