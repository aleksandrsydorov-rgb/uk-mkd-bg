import { NextResponse } from 'next/server';
import { loadPublicAttachment } from '@/lib/portalLegal/server';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: Promise<{ attachmentId: string }> }) {
  const { attachmentId } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(attachmentId)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  const attachment = await loadPublicAttachment(attachmentId);
  if (!attachment) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json(attachment);
}
