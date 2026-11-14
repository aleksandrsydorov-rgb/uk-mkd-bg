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
  return NextResponse.json(snapshot);
}
