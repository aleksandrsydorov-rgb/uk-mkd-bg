import { NextResponse } from 'next/server';
import { legalAdminServerCall } from '@/lib/portalLegal/adminServer';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: Promise<{ attachmentId: string }> }) {
  const { attachmentId } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(attachmentId)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  const result = await legalAdminServerCall('portal_legal_admin_attachment', {
    p_attachment_id: attachmentId,
  });
  if (!result.ok) return NextResponse.json({ error: 'forbidden' }, { status: result.status });
  const file = result.data as {
    file_name?: string;
    content_type?: string;
    content_base64?: string | null;
    content_sha256?: string | null;
  } | null;
  if (!file?.content_base64) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const bytes = Buffer.from(file.content_base64, 'base64');
  const name = (file.file_name ?? 'attachment').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80);
  return new NextResponse(bytes, {
    headers: {
      'Content-Type': file.content_type || 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${name || 'attachment'}"`,
      'X-Content-SHA256': file.content_sha256 ?? '',
      'Cache-Control': 'private, no-store',
    },
  });
}
