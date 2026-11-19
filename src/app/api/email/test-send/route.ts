import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import { normalizeEmail } from '@/lib/email';
import {
  enqueueAllowlistedTestEmail,
  isEmailSendingEnvEnabled,
} from '@/lib/emailCore';
import { canWorkerSend, runOutboxWorker } from '@/lib/email/outboxWorker';
import {
  decryptProviderToken,
  isEmailSettingsEncryptionConfigured,
} from '@/lib/email/settingsCrypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Minimum gap between admin connection probes (rate limit). */
const PROBE_MIN_INTERVAL_MS = 60_000;

type Body = {
  to_email?: string;
  locale?: string | null;
};

/**
 * Admin-only Lettermint connection probe for an explicit recipient.
 *
 * Keeps: admin auth, host send gate, DB/provider readiness, rate limit.
 * Skips: recipient app registration, personal/complex notification categories.
 * Does NOT clear or mutate the ordinary outbox backlog.
 * Processes only the outbox row created by this request (claim-by-id).
 *
 * Ordinary transactional mail must not use this path to bypass registration.
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
        blocked_stage: 'host_sending_disabled',
      },
      { status: 409 }
    );
  }

  if (!isEmailSettingsEncryptionConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        error: 'encryption_key_not_configured',
        host_sending_enabled: true,
        blocked_stage: 'encryption_key_not_configured',
      },
      { status: 503 }
    );
  }

  const admin = createServiceRoleClient();

  // Pre-flight: DB context must be ready.
  const ctxRes = await admin.rpc('email_core_worker_get_context' as never);
  if (ctxRes.error) {
    return NextResponse.json(
      {
        ok: false,
        error: 'worker_context_failed',
        detail: 'db',
        blocked_stage: 'worker_context_failed',
      },
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
        blocked_stage: gate.reason ?? 'worker_gate',
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
        blocked_stage: 'db_not_ready',
      },
      { status: 409 }
    );
  }

  // Prove the stored Project token decrypts with this process key before enqueue.
  // Presence of ciphertext alone is not enough (key rotation orphans the blob).
  const envToken = (process.env.LETTERMINT_PROJECT_TOKEN ?? '').trim();
  if (!envToken) {
    const tokenRes = await admin.rpc(
      'email_core_worker_get_provider_token_ciphertext' as never
    );
    const cipher = tokenRes.data as unknown;
    if (tokenRes.error || typeof cipher !== 'string' || !cipher.trim()) {
      return NextResponse.json(
        {
          ok: false,
          error: 'provider_token_missing',
          blocked_stage: 'provider_token_missing',
        },
        { status: 409 }
      );
    }
    try {
      const plain = decryptProviderToken(cipher);
      if (!plain.trim()) {
        return NextResponse.json(
          {
            ok: false,
            error: 'token_decrypt_failed',
            blocked_stage: 'token_decrypt_failed',
          },
          { status: 409 }
        );
      }
    } catch {
      return NextResponse.json(
        {
          ok: false,
          error: 'token_decrypt_failed',
          blocked_stage: 'token_decrypt_failed',
          detail:
            'Stored Lettermint token ciphertext does not decrypt with EMAIL_SETTINGS_ENCRYPTION_KEY. Re-save the Project API token in Settings (do not rotate the encryption key).',
        },
        { status: 409 }
      );
    }
  }

  // Rate limit: one probe per window (accepted or still in-flight).
  const sinceIso = new Date(Date.now() - PROBE_MIN_INTERVAL_MS).toISOString();
  const { data: recentProbe, error: rateErr } = await admin
    .from('email_outbox')
    .select('id, status, created_at')
    .eq('module_key', 'email_test')
    .gte('created_at', sinceIso)
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (rateErr) {
    return NextResponse.json(
      { ok: false, error: 'rate_check_failed', blocked_stage: 'rate_check_failed' },
      { status: 500 }
    );
  }
  if (recentProbe && typeof recentProbe === 'object') {
    const st = String((recentProbe as { status?: string }).status ?? '');
    // Do not treat a stuck queued row (e.g. prior claim bug) as a rate hit.
    if (st === 'sending' || st === 'sent' || st === 'accepted') {
      return NextResponse.json(
        {
          ok: false,
          error: 'rate_limited',
          blocked_stage: 'rate_limited',
          recent_outbox_id: Number((recentProbe as { id?: number }).id ?? 0) || null,
        },
        { status: 429 }
      );
    }
  }

  const locale =
    body.locale === 'ru' || body.locale === 'en' || body.locale === 'bg' ? body.locale : 'bg';

  let enqueue;
  try {
    enqueue = await enqueueAllowlistedTestEmail(supabase, {
      toEmail,
      locale,
      note: 'admin_ui_connection_probe',
      skipPolicyCheck: true,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'enqueue_failed';
    return NextResponse.json(
      {
        ok: false,
        error: 'enqueue_failed',
        detail: message.slice(0, 120),
        blocked_stage: 'enqueue_failed',
      },
      { status: 400 }
    );
  }

  if (!enqueue.ok && !enqueue.queued) {
    return NextResponse.json(
      {
        ok: false,
        error: 'enqueue_blocked',
        honesty: enqueue.honesty,
        blocked_stage: 'enqueue_blocked',
        enqueue_fallback: enqueue.fallback_status,
      },
      { status: 409 }
    );
  }

  const outboxId = enqueue.outbox_id != null ? Number(enqueue.outbox_id) : null;
  if (outboxId == null || !Number.isFinite(outboxId)) {
    return NextResponse.json(
      {
        ok: false,
        error: 'enqueue_missing_outbox_id',
        honesty: enqueue.honesty,
        blocked_stage: 'enqueue_missing_outbox_id',
      },
      { status: 500 }
    );
  }

  // Process only this probe row — never claim arbitrary backlog with limit=1.
  const worker = await runOutboxWorker({
    supabase: admin,
    limit: 1,
    outboxIds: [outboxId],
  });

  const last = worker.last_send;
  const honesty =
    worker.sent > 0
      ? 'ACCEPTED'
      : worker.skipped
        ? 'PROVIDER_NOT_CONFIGURED'
        : enqueue.honesty === 'QUEUED' || worker.claimed > 0
          ? 'QUEUED'
          : enqueue.honesty;

  const blockedStage =
    worker.sent > 0
      ? null
      : last?.blocked_stage ??
        (worker.skipped ? worker.reason ?? 'worker_skipped' : worker.reason ?? 'not_accepted');

  console.info('[email/test-send]', {
    outbox_id: outboxId,
    claimed_ids: worker.claimed_ids ?? [],
    sent: worker.sent,
    claimed: worker.claimed,
    skipped: worker.skipped,
    reason: worker.reason ?? null,
    blocked_stage: blockedStage,
    http_status: last?.http_status ?? null,
    error_code: last?.error_code ?? null,
    has_message_id: Boolean(last?.provider_message_id),
    host_sending_enabled: isEmailSendingEnvEnabled(),
    mail_provider: String(ctx.mail_provider ?? ''),
  });

  return NextResponse.json({
    ok: worker.sent > 0,
    honesty,
    host_sending_enabled: true,
    path: 'admin_connection_probe',
    blocked_stage: blockedStage,
    enqueue: {
      queued: enqueue.queued,
      duplicate: enqueue.duplicate,
      outbox_id: outboxId,
    },
    worker: {
      skipped: worker.skipped,
      reason: worker.reason ?? null,
      claimed: worker.claimed,
      claimed_ids: worker.claimed_ids ?? [],
      sent: worker.sent,
      failed: worker.failed,
      cancelled: worker.cancelled ?? 0,
      retried: worker.retried,
    },
    provider: {
      name: last?.provider ?? String(ctx.mail_provider ?? 'lettermint'),
      http_status: last?.http_status ?? null,
      error_code: last?.error_code ?? null,
      // Accepted by provider API — not inbox delivery.
      message_id: last?.provider_message_id ?? null,
      called: last?.http_status != null || last?.provider_message_id != null,
    },
    connection_verified: worker.sent > 0,
  });
}
