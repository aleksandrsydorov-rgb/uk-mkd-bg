/**
 * Guards PKG-XFER mutating / DB-backed tests.
 * Never allows shared TEST (klowacuvufknbrkayjhz) or production hostnames.
 */

const FORBIDDEN_HOST_FRAGMENTS = [
  'klowacuvufknbrkayjhz',
  'amadeus11.online',
  'amadeus11.bg',
] as const;

export type IsolatedEnvStatus =
  | { ok: true; databaseUrl: string; source: 'PKG_XFER_ISOLATED_DATABASE_URL' }
  | { ok: false; reason: 'missing' | 'forbidden_target'; detail: string };

export function resolveIsolatedDatabaseUrl(
  env: NodeJS.ProcessEnv = process.env
): IsolatedEnvStatus {
  const raw = (env.PKG_XFER_ISOLATED_DATABASE_URL ?? '').trim();
  if (!raw) {
    return {
      ok: false,
      reason: 'missing',
      detail:
        'PKG_XFER_ISOLATED_DATABASE_URL unset. Mutating SQL/RPC/RLS tests are BLOCKED. Do not use shared Supabase.',
    };
  }

  const lower = raw.toLowerCase();
  for (const frag of FORBIDDEN_HOST_FRAGMENTS) {
    if (lower.includes(frag)) {
      return {
        ok: false,
        reason: 'forbidden_target',
        detail: `Refusing database URL that targets forbidden host fragment "${frag}".`,
      };
    }
  }

  // Also refuse if someone points "isolated" at the linked shared project via NEXT_PUBLIC URL.
  const publicUrl = (env.NEXT_PUBLIC_SUPABASE_URL ?? '').toLowerCase();
  if (publicUrl.includes('klowacuvufknbrkayjhz') && lower.includes('supabase.co')) {
    // Only block when isolated URL clearly equals the shared project ref.
    if (lower.includes('klowacuvufknbrkayjhz')) {
      return {
        ok: false,
        reason: 'forbidden_target',
        detail: 'Isolated URL matches shared project ref klowacuvufknbrkayjhz.',
      };
    }
  }

  return { ok: true, databaseUrl: raw, source: 'PKG_XFER_ISOLATED_DATABASE_URL' };
}

export function resolveE2eBaseUrl(env: NodeJS.ProcessEnv = process.env): IsolatedEnvStatus {
  const raw = (env.PKG_XFER_E2E_BASE_URL ?? '').trim();
  if (!raw) {
    return {
      ok: false,
      reason: 'missing',
      detail:
        'PKG_XFER_E2E_BASE_URL unset (and no isolated app). Browser E2E mutating against shared/prod is BLOCKED.',
    };
  }
  const lower = raw.toLowerCase();
  for (const frag of FORBIDDEN_HOST_FRAGMENTS) {
    if (lower.includes(frag)) {
      return {
        ok: false,
        reason: 'forbidden_target',
        detail: `Refusing E2E base URL targeting "${frag}".`,
      };
    }
  }
  if (env.PKG_XFER_E2E_ALLOW !== '1') {
    return {
      ok: false,
      reason: 'missing',
      detail: 'Set PKG_XFER_E2E_ALLOW=1 only for a disposable isolated app + DB.',
    };
  }
  return { ok: true, databaseUrl: raw, source: 'PKG_XFER_ISOLATED_DATABASE_URL' };
}

export const SQL_SMOKE_SCRIPTS = [
  'supabase/pkg_xfer_stage2_smoke.sql',
  'supabase/pkg_xfer_stage2_auth_role_security.sql',
  'supabase/pkg_xfer_stage3_smoke.sql',
  'supabase/pkg_xfer_stage4_smoke.sql',
  'supabase/pkg_xfer_stage5b_smoke.sql',
  'supabase/pkg_xfer_cross_stage_smoke.sql',
] as const;
