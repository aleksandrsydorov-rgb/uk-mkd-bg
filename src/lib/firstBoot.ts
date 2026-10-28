/**
 * R1-FIRST-BOOT helpers — first-admin claim path + admin entry routing.
 * No service-role usage (browser-safe).
 *
 * Admin entry uses the server first-run gate (admin_get_first_run_state),
 * never a client-side properties count.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { canSeeSecurityAdmin } from '@/lib/security';
import type { AccessProfile } from '@/lib/access';
import {
  ADMIN_HOME_PATH,
  FIRST_RUN_WIZARD_PATH,
  fetchFirstRunState,
  isFirstRunGateRequired,
} from '@/lib/firstRun';

export const FIRST_ADMIN_PATH = '/auth/first-admin';
/** Legacy Initial Setup deep-link (Book/modules). Prefer FIRST_RUN_WIZARD_PATH when gate_required. */
export const INITIAL_SETUP_ADMIN_PATH = '/admin?section=%D0%BD%D0%B0%D1%87%D0%B0%D0%BB%D1%8C%D0%BD%D0%B0%D1%8F_%D0%BD%D0%B0%D1%81%D1%82%D1%80%D0%BE%D0%B9%D0%BA%D0%B0';

/** Build claim path with optional approval token (from installer invite redirect). */
export function buildFirstAdminPath(opts?: {
  token?: string | null;
  displayName?: string | null;
}): string {
  const url = new URL(FIRST_ADMIN_PATH, 'http://local.invalid');
  const token = (opts?.token ?? '').trim();
  if (token) url.searchParams.set('t', token);
  const name = (opts?.displayName ?? '').trim();
  if (name) url.searchParams.set('name', name);
  return `${url.pathname}${url.search}`;
}

/**
 * After admin login: route by server first-run gate.
 * Guard / non-admin roles keep their normal homes.
 * RPC failure ⇒ /admin (page shows retry; does not invent gate from properties).
 */
export async function resolveAdminEntryPath(
  access: AccessProfile,
  supabase: SupabaseClient<Database>,
): Promise<string> {
  if (!access.isStaff) return '/account';
  if (!canSeeSecurityAdmin(access.staff?.role)) {
    return access.staff?.role === 'охрана' ? '/guard' : '/admin';
  }

  const result = await fetchFirstRunState(supabase);
  if (!result.ok) {
    return ADMIN_HOME_PATH;
  }
  if (isFirstRunGateRequired(result.state)) {
    return FIRST_RUN_WIZARD_PATH;
  }
  return ADMIN_HOME_PATH;
}

export function isValidBootstrapToken(token: string | null | undefined): boolean {
  const t = (token ?? '').trim();
  return t.length >= 32;
}
