import type { SupabaseClient } from '@supabase/supabase-js';

export type LegalOffer = {
  revision_id: string;
  text_id: string;
  document_kind: string;
  revision_number: number;
  effective_on: string | null;
  title: string;
  body: string;
  locale: 'bg' | 'ru' | 'en';
  translation_missing: boolean;
  test_edition: boolean;
  body_sha256: string;
};

export type AcceptanceStatus = {
  must_accept: boolean;
  is_update: boolean;
  role: 'owner' | 'staff' | 'admin' | 'unknown';
  complex_id: string | null;
  obligation_id: string | null;
  terms: LegalOffer | null;
  privacy: LegalOffer | null;
  house_rules: LegalOffer | null;
  statements: {
    accept_terms: string;
    ack_privacy: string;
    ack_house_rules: string;
  };
};

export type AcknowledgementItem = {
  acknowledgement_id: string;
  action: 'accept_terms' | 'ack_privacy' | 'ack_house_rules';
  revision_id: string;
  text_id: string;
  body_sha256: string;
  ui_locale: string;
  document_locale: string;
  statement_text: string;
  confirmed_at: string;
  revision_number: number;
  document_kind: string;
  test_edition: boolean;
  title: string;
};

type RpcResult = { ok: true; data: unknown } | { ok: false; missing: boolean };

async function userRpc(supabase: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<RpcResult> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '');
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
  if (!token || !url || !key) return { ok: false, missing: false };
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
  if (response.status === 404) return { ok: false, missing: true };
  if (!response.ok) return { ok: false, missing: false };
  return { ok: true, data: await response.json() };
}

export async function loadAcceptanceStatus(
  supabase: SupabaseClient,
  locale: string,
): Promise<AcceptanceStatus | null> {
  const result = await userRpc(supabase, 'portal_legal_acceptance_status', { p_locale: locale });
  if (!result.ok) return null;
  return result.data as AcceptanceStatus;
}

export async function recordAcknowledgements(
  supabase: SupabaseClient,
  locale: string,
  items: Array<{ action: string; revision_id: string; text_id: string }>,
): Promise<{ ok: boolean; stale: boolean; status: AcceptanceStatus | null }> {
  const result = await userRpc(supabase, 'portal_legal_record_acknowledgements', {
    p_locale: locale,
    p_items: items,
  });
  if (!result.ok) return { ok: false, stale: false, status: null };
  const payload = result.data as { ok?: boolean; stale?: boolean; status?: AcceptanceStatus };
  return {
    ok: Boolean(payload.ok),
    stale: Boolean(payload.stale),
    status: payload.status ?? null,
  };
}

export async function loadMyAcknowledgements(supabase: SupabaseClient): Promise<AcknowledgementItem[] | null> {
  const result = await userRpc(supabase, 'portal_legal_my_history', {});
  if (!result.ok) return null;
  return (result.data as AcknowledgementItem[] | null) ?? [];
}

export function acceptPath(next: string) {
  return `/account/accept?next=${encodeURIComponent(next || '/account')}`;
}
