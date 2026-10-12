/**
 * Service-role Supabase client — server routes / workers only.
 * Never import from client components.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';

export function createServiceRoleClient(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>
): SupabaseClient<Database> {
  const url = (env.NEXT_PUBLIC_SUPABASE_URL ?? env.SUPABASE_URL ?? '').trim();
  const key = (env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
  if (!url || !key) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
