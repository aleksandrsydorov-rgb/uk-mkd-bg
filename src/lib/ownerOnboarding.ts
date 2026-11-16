import type { SupabaseClient } from '@supabase/supabase-js';
import { acceptPath, type AcceptanceStatus } from '@/lib/portalLegal/acceptance';

export type OwnerOnboardingProperty = {
  property_id: number;
  apartment_number: string | null;
  section_code: string | null;
  block_code: string | null;
  ownership_type: string | null;
  ideal_parts_percent: number | null;
  registry_people_id: number;
  entity_kind: string | null;
  first_name: string | null;
  middle_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  phone_secondary: string | null;
  ownership_share_percent: number | null;
  voting_eligible: boolean | null;
  access_ready: boolean;
  invite_accepted: boolean;
  clarification?: {
    missing_fields?: string[];
    owner_can_complete?: boolean;
    uk_only_fields?: string[];
    needs_clarification?: boolean;
  } | null;
};

export type OwnerFirstLoginStatus = {
  email: string;
  must_complete_profile: boolean;
  must_accept_terms: boolean;
  cabinet_ready: boolean;
  acceptance: AcceptanceStatus | null;
  properties: OwnerOnboardingProperty[];
};

async function userRpc(supabase: SupabaseClient, fn: string, args: Record<string, unknown>) {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '');
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
  if (!token || !url || !key) return { ok: false as const, data: null };
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
  if (!response.ok) return { ok: false as const, data: null };
  return { ok: true as const, data: await response.json() };
}

export async function loadOwnerFirstLoginStatus(
  supabase: SupabaseClient,
  locale: string,
): Promise<OwnerFirstLoginStatus | null> {
  const result = await userRpc(supabase, 'owner_first_login_status', { p_locale: locale });
  if (!result.ok || !result.data) return null;
  const raw = result.data as Record<string, unknown>;
  return {
    email: String(raw.email ?? ''),
    must_complete_profile: Boolean(raw.must_complete_profile),
    must_accept_terms: Boolean(raw.must_accept_terms),
    cabinet_ready: Boolean(raw.cabinet_ready),
    acceptance: (raw.acceptance as AcceptanceStatus | null) ?? null,
    properties: Array.isArray(raw.properties) ? (raw.properties as OwnerOnboardingProperty[]) : [],
  };
}

/** Route after auth: profile → terms → intended next. */
export function ownerEntryPath(status: OwnerFirstLoginStatus | null, next: string): string {
  const safeNext = next && next.startsWith('/') ? next : '/account';
  if (!status) return safeNext;
  if (status.must_complete_profile) {
    return `/account/onboarding?next=${encodeURIComponent(safeNext)}`;
  }
  if (status.must_accept_terms) {
    return acceptPath(safeNext);
  }
  return safeNext;
}

export function onboardingPath(next: string) {
  return `/account/onboarding?next=${encodeURIComponent(next || '/account')}`;
}
