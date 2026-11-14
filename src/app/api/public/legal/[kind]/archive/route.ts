import { NextResponse } from 'next/server';
import { isPortalLegalSlug, portalLegalKind } from '@/lib/portalLegal/kinds';
import { loadLegalArchive } from '@/lib/portalLegal/server';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: Promise<{ kind: string }> }) {
  const { kind } = await context.params;
  if (!isPortalLegalSlug(kind)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  return NextResponse.json(await loadLegalArchive(portalLegalKind(kind)));
}
