import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@/lib/database.types';
import { assertSupabasePublicEnv } from '@/lib/supabase/env';

export function createClient(options?: { detectSessionInUrl?: boolean }) {
  const { url, anonKey } = assertSupabasePublicEnv();
  if (options?.detectSessionInUrl === undefined) {
    return createBrowserClient<Database>(url, anonKey);
  }
  return createBrowserClient<Database>(url, anonKey, {
    auth: { detectSessionInUrl: options.detectSessionInUrl },
  });
}
