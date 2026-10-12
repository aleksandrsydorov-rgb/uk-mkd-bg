import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import {
  assertWorkerAuthorized,
  runOutboxWorker,
} from '@/lib/email/outboxWorker';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Secure outbox worker. Requires EMAIL_WORKER_SECRET.
 * Never sends while EMAIL_SENDING_ENABLED is false.
 */
export async function POST(request: Request) {
  const auth = assertWorkerAuthorized(request);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  let limit: number | undefined;
  try {
    const body = (await request.json()) as { limit?: number };
    if (typeof body.limit === 'number') limit = body.limit;
  } catch {
    // empty body is fine
  }

  try {
    const supabase = createServiceRoleClient();
    const result = await runOutboxWorker({ supabase, limit });
    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'worker_failed';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json(
    { ok: false, error: 'method_not_allowed', hint: 'POST with worker secret' },
    { status: 405 }
  );
}
