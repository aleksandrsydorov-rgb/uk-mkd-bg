/**
 * R1-FIRST-BOOT helpers — first-admin claim path + Initial Setup entry routing.
 * No service-role usage (browser-safe).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { canSeeSecurityAdmin } from '@/lib/security';
import type { AccessProfile } from '@/lib/access';

export const FIRST_ADMIN_PATH = '/auth/first-admin';
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
 * After admin login: empty property inventory ⇒ Initial Setup; else dashboard.
 * Guard / non-admin roles keep their normal homes.
 */
export async function resolveAdminEntryPath(
  access: AccessProfile,
  supabase: SupabaseClient<Database>,
): Promise<string> {
  if (!access.isStaff) return '/account';
  if (!canSeeSecurityAdmin(access.staff?.role)) {
    return access.staff?.role === 'охрана' ? '/guard' : '/admin';
  }

  try {
    const { count, error } = await supabase
      .from('properties')
      .select('id', { count: 'exact', head: true });
    if (error) return '/admin';
    if ((count ?? 0) === 0) return INITIAL_SETUP_ADMIN_PATH;
  } catch {
    return '/admin';
  }
  return '/admin';
}

export function isValidBootstrapToken(token: string | null | undefined): boolean {
  const t = (token ?? '').trim();
  return t.length >= 32;
}
