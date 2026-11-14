import { NextResponse } from 'next/server';
import { legalAdminServerCall } from '@/lib/portalLegal/adminServer';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: Promise<{ acknowledgementId: string }> }) {
  const { acknowledgementId } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(acknowledgementId)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  const result = await legalAdminServerCall('portal_legal_admin_snapshot', {
    p_acknowledgement_id: acknowledgementId,
  });
  if (!result.ok) return NextResponse.json({ error: 'forbidden' }, { status: result.status });
  const snapshot = result.data as {
    title?: string;
    body?: string;
    document_locale?: string;
    ui_locale?: string;
    statement_text?: string;
    body_sha256?: string;
    text_id?: string;
    confirmed_at?: string;
    owner_email?: string;
  } | null;
  if (!snapshot?.body) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const text = [
    snapshot.title ?? '',
    `owner: ${snapshot.owner_email ?? ''}`,
    `text_id: ${snapshot.text_id ?? ''}`,
    `document_locale: ${snapshot.document_locale ?? ''}`,
    `ui_locale: ${snapshot.ui_locale ?? ''}`,
    `confirmed_at: ${snapshot.confirmed_at ?? ''}`,
    `statement: ${snapshot.statement_text ?? ''}`,
    `body_sha256: ${snapshot.body_sha256 ?? ''}`,
    '',
    snapshot.body,
  ].join('\n');
  return new NextResponse(text, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="acknowledgement-${acknowledgementId}.txt"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
