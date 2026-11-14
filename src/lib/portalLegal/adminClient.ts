import type { SupabaseClient } from '@supabase/supabase-js';

export type LegalAdminResult =
  | { ok: true; data: unknown }
  | { ok: false; message: string };

export async function legalAdminCall(
  supabase: SupabaseClient,
  fn: string,
  args: Record<string, unknown>,
): Promise<LegalAdminResult> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '');
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
  if (!token || !url || !key) return { ok: false, message: 'portal_legal_forbidden' };
  const response = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(args),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    return { ok: false, message: body?.message ?? 'portal_legal_forbidden' };
  }
  return { ok: true, data: await response.json() };
}
