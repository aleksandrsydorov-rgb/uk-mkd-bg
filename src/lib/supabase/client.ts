import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@/lib/database.types';
import { assertSupabasePublicEnv } from '@/lib/supabase/env';

export function createClient() {
  const { url, anonKey } = assertSupabasePublicEnv();
  return createBrowserClient<Database>(url, anonKey);
}
