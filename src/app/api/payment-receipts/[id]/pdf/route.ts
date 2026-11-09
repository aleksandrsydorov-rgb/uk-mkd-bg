import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { PAYMENT_RECEIPTS_BUCKET } from '@/lib/paymentReceipts/types';

export const runtime = 'nodejs';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ReceiptRow = {
  id: string;
  series: string;
  number: number;
  status: string;
  storage_path: string | null;
};

/**
 * Authenticated PDF delivery for an existing payment receipt.
 * Uses the caller's session + RLS/RPC — never accepts an arbitrary URL,
 * never exposes the service-role key, never regenerates the document.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id: rawId } = await context.params;
  const id = String(rawId ?? '').trim();
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'invalid_id' }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();
  if (authErr || !user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // RPC is newer than generated Database types — call via untyped client surface.
  const { data, error } = await (
    supabase as unknown as {
      rpc: (
        fn: string,
        args: Record<string, unknown>,
      ) => Promise<{ data: unknown; error: { message: string } | null }>;
    }
  ).rpc('get_payment_receipt', { p_receipt_id: id });
  if (error) {
    const msg = error.message || '';
    // Treat missing and unauthorized alike — do not leak receipt existence.
    if (/not found|not authorized|permission|denied/i.test(msg)) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
    return NextResponse.json({ error: 'lookup_failed' }, { status: 400 });
  }

  const receipt = (data && typeof data === 'object' ? data : null) as ReceiptRow | null;
  if (!receipt?.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  if (receipt.status === 'pending_details' || receipt.status === 'pending_pdf') {
    return NextResponse.json({ error: 'forming' }, { status: 409 });
  }

  const path = String(receipt.storage_path ?? '').trim();
  if (!path) {
    return NextResponse.json({ error: 'file_missing' }, { status: 404 });
  }
  // Path must stay inside this receipt's private prefix — never accept client paths.
  const expectedPrefix = `payment-receipts/`;
  if (!path.startsWith(expectedPrefix) || path.includes('..')) {
    return NextResponse.json({ error: 'file_missing' }, { status: 404 });
  }

  const { data: file, error: dlErr } = await supabase.storage
    .from(PAYMENT_RECEIPTS_BUCKET)
    .download(path);
  if (dlErr || !file) {
    const notFound = /not found|404|object.*exist/i.test(dlErr?.message ?? '');
    return NextResponse.json(
      { error: notFound ? 'file_missing' : 'storage_unavailable' },
      { status: notFound ? 404 : 503 },
    );
  }

  const bytes = await file.arrayBuffer();
  const n = Number(receipt.number);
  const fileName = `${receipt.series || 'KP'}-${
    Number.isFinite(n) && n > 0 ? String(Math.trunc(n)).padStart(6, '0') : 'receipt'
  }.pdf`;

  return new NextResponse(bytes, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${fileName}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
