import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import { normalizeEmail } from '@/lib/email';
import {
  enqueueAllowlistedTestEmail,
  isEmailSendingEnvEnabled,
} from '@/lib/emailCore';
import { canWorkerSend, runOutboxWorker } from '@/lib/email/outboxWorker';
import { isEmailSettingsEncryptionConfigured } from '@/lib/email/settingsCrypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Body = {
  to_email?: string;
  locale?: string | null;
};

/**
 * Admin-only controlled Lettermint probe:
 * 1) cancel accumulated queued/held/sending rows (no mass activate of backlog)
 * 2) enqueue one email_test to the explicit recipient
 * 3) process at most one outbox row through the worker
 *
 * "queued" alone is not treated as a successful connection check.
 */
export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();
  if (authErr || !user) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const { data: isAdmin, error: roleErr } = await supabase.rpc('has_staff_role' as never, {
    p_role: 'администрация',
  } as never);
  if (roleErr || isAdmin !== true) {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
  }

  const toEmail = normalizeEmail(String(body.to_email ?? ''));
  if (!toEmail || !toEmail.includes('@')) {
    return NextResponse.json({ ok: false, error: 'invalid_recipient' }, { status: 400 });
  }

  if (!isEmailSendingEnvEnabled()) {
    return NextResponse.json(
      {
        ok: false,
        error: 'host_sending_disabled',
        host_sending_enabled: false,
        honesty: 'PROVIDER_NOT_CONFIGURED',
      },
      { status: 409 }
    );
  }

  if (!isEmailSettingsEncryptionConfigured()) {
    return NextResponse.json(
      { ok: false, error: 'encryption_key_not_configured', host_sending_enabled: true },
      { status: 503 }
    );
  }

  const admin = createServiceRoleClient();

  // Pre-flight: DB context must be ready; never flush old backlog into send.
  const ctxRes = await admin.rpc('email_core_worker_get_context' as never);
  if (ctxRes.error) {
    return NextResponse.json(
      { ok: false, error: 'worker_context_failed', detail: 'db' },
      { status: 503 }
    );
  }
  const ctx =
    ctxRes.data && typeof ctxRes.data === 'object'
      ? (ctxRes.data as Record<string, unknown>)
      : {};
  const gate = canWorkerSend(process.env as Record<string, string | undefined>, {
    dbProvider: String(ctx.mail_provider ?? ''),
    dbHasToken: ctx.has_provider_token === true,
  });
  if (!gate.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: 'worker_not_ready',
        reason: gate.reason ?? 'unknown',
        host_sending_enabled: true,
      },
      { status: 409 }
    );
  }
  if (ctx.email_enabled !== true || ctx.db_ready !== true) {
    return NextResponse.json(
      {
        ok: false,
        error: 'complex_sending_disabled',
        host_sending_enabled: true,
        email_enabled: ctx.email_enabled === true,
        db_ready: ctx.db_ready === true,
      },
      { status: 409 }
    );
  }

  // Cancel backlog so enabling the host gate cannot mass-send accumulated mail.
  const { data: clearedRows, error: clearErr } = await admin
    .from('email_outbox')
    .update({
      status: 'cancelled',
      last_error_code: 'cleared_before_controlled_test',
      next_attempt_at: null,
      updated_at: new Date().toISOString(),
    } as never)
    .in('status', ['queued', 'held', 'sending'] as never)
    .select('id');
  if (clearErr) {
    return NextResponse.json({ ok: false, error: 'clear_queue_failed' }, { status: 500 });
  }
  const cleared = Array.isArray(clearedRows) ? clearedRows.length : 0;

  const locale =
    body.locale === 'ru' || body.locale === 'en' || body.locale === 'bg' ? body.locale : 'bg';

  let enqueue;
  try {
    enqueue = await enqueueAllowlistedTestEmail(supabase, {
      toEmail,
      locale,
      note: 'admin_ui_explicit_recipient_test',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'enqueue_failed';
    return NextResponse.json(
      { ok: false, error: 'enqueue_failed', detail: message.slice(0, 120) },
      { status: 400 }
    );
  }

  if (!enqueue.ok && !enqueue.queued) {
    return NextResponse.json(
      {
        ok: false,
        error: 'enqueue_blocked',
        honesty: enqueue.honesty,
        cleared_backlog: cleared,
      },
      { status: 409 }
    );
  }

  const worker = await runOutboxWorker({ supabase: admin, limit: 1 });

  const honesty =
    worker.sent > 0
      ? 'ACCEPTED'
      : worker.skipped
        ? 'PROVIDER_NOT_CONFIGURED'
        : enqueue.honesty === 'QUEUED' || worker.claimed > 0
          ? 'QUEUED'
          : enqueue.honesty;

  return NextResponse.json({
    ok: worker.sent > 0,
    honesty,
    host_sending_enabled: true,
    cleared_backlog: cleared,
    enqueue: {
      queued: enqueue.queued,
      duplicate: enqueue.duplicate,
      outbox_id: enqueue.outbox_id ?? null,
    },
    worker: {
      skipped: worker.skipped,
      reason: worker.reason ?? null,
      claimed: worker.claimed,
      sent: worker.sent,
      failed: worker.failed,
      cancelled: worker.cancelled ?? 0,
    },
    // Explicit: awaiting alone is not a verified connection.
    connection_verified: worker.sent > 0,
  });
}
