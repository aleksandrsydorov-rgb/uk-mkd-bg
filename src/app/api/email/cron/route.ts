import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import { assertCronAuthorized } from '@/lib/email/cronAuth';
import {
  EMAIL_WORKER_MAX_BATCH,
  reclaimStaleSendingClaims,
  runOutboxWorker,
} from '@/lib/email/outboxWorker';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Allow a full bounded batch under Hobby/Pro function limits. */
export const maxDuration = 60;

/**
 * Scheduled Email Core processor (Vercel Cron).
 * Auth: CRON_SECRET (preferred) or EMAIL_WORKER_SECRET.
 * Both host EMAIL_SENDING_ENABLED and DB email_enabled gates remain effective.
 */
export async function GET(request: Request) {
  return handleCron(request);
}

export async function POST(request: Request) {
  return handleCron(request);
}

async function handleCron(request: Request) {
  const auth = assertCronAuthorized(request);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  try {
    const supabase = createServiceRoleClient();
    const reclaimed = await reclaimStaleSendingClaims(supabase, { olderThanMinutes: 15 });
    const result = await runOutboxWorker({
      supabase,
      limit: EMAIL_WORKER_MAX_BATCH,
    });
    return NextResponse.json({
      ...result,
      via: auth.via,
      reclaimed,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'cron_failed';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
