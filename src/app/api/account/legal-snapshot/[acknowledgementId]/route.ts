import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: Promise<{ acknowledgementId: string }> }) {
  const { acknowledgementId } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(acknowledgementId)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  const supabase = await createClient();
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  const url = (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '');
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
  if (!token || !url || !key) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const response = await fetch(`${url}/rest/v1/rpc/portal_legal_my_snapshot`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ p_acknowledgement_id: acknowledgementId }),
    cache: 'no-store',
  });
  if (!response.ok) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const snapshot = (await response.json()) as {
    title?: string;
    body?: string;
    revision_id?: string;
    text_id?: string;
    body_sha256?: string;
    document_locale?: string;
  } | null;
  if (!snapshot?.body) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const fileName = `acknowledgement-${acknowledgementId}-${snapshot.document_locale ?? 'bg'}.txt`;
  return new NextResponse(
    [snapshot.title ?? '', `text_id: ${snapshot.text_id}`, `body_sha256: ${snapshot.body_sha256}`, '', snapshot.body].join('\n'),
    {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Cache-Control': 'private, no-store',
      },
    },
  );
}
