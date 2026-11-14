import { NextResponse } from 'next/server';
import { loadLegalRevision } from '@/lib/portalLegal/server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ revisionId: string }> }) {
  const { revisionId } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(revisionId)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  const locale = new URL(request.url).searchParams.get('locale') ?? 'bg';
  const snapshot = await loadLegalRevision(revisionId, locale);
  if (!snapshot) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const fileName = `${snapshot.document_kind}-r${snapshot.revision_number}-${snapshot.locale}.txt`;
  const body = [
    snapshot.title,
    `revision_id: ${snapshot.revision_id}`,
    `text_id: ${snapshot.text_id}`,
    `body_sha256: ${snapshot.body_sha256}`,
    '',
    snapshot.body,
  ].join('\n');
  return new NextResponse(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
