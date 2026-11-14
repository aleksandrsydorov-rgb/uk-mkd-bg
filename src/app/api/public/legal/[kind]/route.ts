import { NextResponse } from 'next/server';
import { isPortalLegalSlug, portalLegalKind } from '@/lib/portalLegal/kinds';
import { loadCurrentLegal } from '@/lib/portalLegal/server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ kind: string }> }) {
  const { kind } = await context.params;
  if (!isPortalLegalSlug(kind)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  const locale = new URL(request.url).searchParams.get('locale') ?? 'bg';
  const snapshot = await loadCurrentLegal(portalLegalKind(kind), locale);
  if (!snapshot) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json(snapshot);
}
