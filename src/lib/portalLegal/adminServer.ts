import { createClient } from '@/lib/supabase/server';

export async function legalAdminServerCall(fn: string, args: Record<string, unknown>) {
  const supabase = await createClient();
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  const url = (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '');
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
  if (!token || !url || !key) return { ok: false as const, status: 401 };
  const response = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(args),
    cache: 'no-store',
  });
  if (!response.ok) return { ok: false as const, status: response.status === 401 ? 401 : 403 };
  return { ok: true as const, data: await response.json() };
}
