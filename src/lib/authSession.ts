import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';

/** Owner-cabinet UI prefs that must not survive account switches. */
const OWNER_SESSION_STORAGE_KEYS = [
  'amadeus-finance-tab',
  'amadeus-meter-tab',
] as const;

/**
 * Clears owner-scoped sessionStorage prefs.
 * Does not touch Auth cookies — use {@link signOutFully} for that.
 */
export function clearOwnerUiStorage(): void {
  if (typeof window === 'undefined') return;
  try {
    for (const key of OWNER_SESSION_STORAGE_KEYS) {
      sessionStorage.removeItem(key);
    }
  } catch {
    // Private mode / blocked storage — ignore.
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error('auth signOut timeout')), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Ends the Supabase Auth session for this browser (cookie-backed SSR client)
 * and clears owner UI prefs.
 *
 * Clears the local session/cookies first so the UI can switch accounts even if
 * the Auth API is slow; then best-effort revokes the refresh token server-side.
 */
export async function signOutFully(
  supabase: SupabaseClient<Database>,
): Promise<void> {
  clearOwnerUiStorage();
  try {
    await withTimeout(supabase.auth.signOut({ scope: 'local' }), 5000);
  } catch {
    // Continue — React state clear + navigation still run in callers.
  }
  try {
    await withTimeout(supabase.auth.signOut({ scope: 'global' }), 5000);
  } catch {
    // Network / already signed out — local clear is enough for account switch.
  }
}
