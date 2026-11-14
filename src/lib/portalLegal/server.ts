export type LegalSnapshot = {
  revision_id: string;
  text_id: string;
  document_kind: string;
  revision_number: number;
  status: 'published' | 'superseded';
  test_edition: boolean;
  published_at: string | null;
  effective_on: string | null;
  locale: 'bg' | 'ru' | 'en';
  requested_locale: string;
  translation_missing: boolean;
  is_original: boolean;
  title: string;
  body: string;
  body_sha256: string;
};

export type LegalArchiveItem = {
  revision_id: string;
  document_kind: string;
  revision_number: number;
  status: 'published' | 'superseded';
  test_edition: boolean;
  published_at: string | null;
  effective_on: string | null;
};

function supabaseRest(): { url: string; key: string } | null {
  const url = (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '');
  const key = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '').trim();
  if (!url || !key) return null;
  return { url, key };
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T | null> {
  const rest = supabaseRest();
  if (!rest) return null;
  const response = await fetch(`${rest.url}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: rest.key,
      Authorization: `Bearer ${rest.key}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(args),
    cache: 'no-store',
  });
  if (!response.ok) return null;
  const payload: unknown = await response.json();
  if (payload == null) return null;
  return payload as T;
}

export function loadCurrentLegal(kind: string, locale: string) {
  return rpc<LegalSnapshot>('public_portal_legal_current', { p_kind: kind, p_locale: locale });
}

export function loadLegalRevision(revisionId: string, locale: string) {
  return rpc<LegalSnapshot>('public_portal_legal_revision', {
    p_revision_id: revisionId,
    p_locale: locale,
  });
}

export async function loadLegalArchive(kind: string) {
  return (await rpc<LegalArchiveItem[]>('public_portal_legal_archive', { p_kind: kind })) ?? [];
}

export function loadPublicAttachment(attachmentId: string) {
  return rpc<{
    attachment_id: string;
    revision_id: string;
    file_name: string;
    content_type: string;
    public_access: true;
  }>('public_portal_legal_attachment', { p_attachment_id: attachmentId });
}
