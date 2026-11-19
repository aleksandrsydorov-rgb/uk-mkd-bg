/**
 * Email Core outbox worker (Phase B/D).
 * Host gate EMAIL_SENDING_ENABLED must be true before any provider call.
 * The selected adapter does not fall back to another provider.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import {
  hasActiveMailCredential,
  hasLettermintProjectToken,
  isEmailSendingEnvEnabled,
  isPermanentProviderFailure,
  outboxAttemptNeedsOperatorReview,
  resolveEmailMailProvider,
} from '@/lib/emailCore';
import { createMailAdapterForWorker } from '@/lib/email/mailAdapter';
import type { MailAdapter } from '@/lib/email/mailSend';
import {
  renderTransactionalEmail,
  validateRenderedTemplate,
  type EmailTemplateOverride,
} from '@/lib/email/templates';
import { isNonPublicInviteUrl } from '@/lib/publicAppUrl';
import {
  getEmailEvent,
  resolveEventKeyFromEnqueue,
} from '@/lib/email/eventCatalog';
import { evaluateNotificationPolicy } from '@/lib/email/notificationPolicy';
import { fetchPolicySnapshotForRecipient } from '@/lib/email/notificationPrefsClient';

export const EMAIL_WORKER_MAX_BATCH = 10;

export type WorkerRunResult = {
  ok: boolean;
  skipped: boolean;
  reason?: string;
  claimed: number;
  sent: number;
  failed: number;
  retried: number;
  cancelled?: number;
  reviewed?: number;
  /** Outbox ids this run claimed (safe diagnostics). */
  claimed_ids?: number[];
  /** Last provider attempt diagnostics (no tokens/bodies). */
  last_send?: {
    outbox_id: number;
    module_key: string;
    blocked_stage?: string;
    provider?: string;
    http_status?: number | null;
    error_code?: string | null;
    provider_message_id?: string | null;
    ok?: boolean;
  };
};

type EnvProbe = Record<string, string | undefined>;

type OutboxRow = {
  id: number;
  idempotency_key: string;
  module_key: string;
  template_key: string;
  locale: string;
  to_email: string;
  subject: string | null;
  payload: Record<string, unknown> | null;
  attempts: number;
  event_key?: string | null;
  /** Source business-event time; prefer over created_at for pre-registration stale cancel. */
  event_occurred_at?: string | null;
  created_at?: string | null;
  first_attempt_at?: string | null;
  uncertain_attempt?: boolean;
  provider_message_id?: string | null;
};

export function assertWorkerAuthorized(
  request: Request,
  env: EnvProbe = process.env as EnvProbe
): { ok: true } | { ok: false; status: number; error: string } {
  const expected = (env.EMAIL_WORKER_SECRET ?? '').trim();
  if (!expected) {
    return { ok: false, status: 503, error: 'worker_secret_not_configured' };
  }
  const auth = request.headers.get('authorization') ?? '';
  const bearer = auth.toLowerCase().startsWith('bearer ')
    ? auth.slice(7).trim()
    : '';
  const headerSecret = (request.headers.get('x-email-worker-secret') ?? '').trim();
  const provided = bearer || headerSecret;
  if (!provided || provided !== expected) {
    return { ok: false, status: 401, error: 'unauthorized' };
  }
  return { ok: true };
}

export function canWorkerSend(
  env: EnvProbe = process.env as EnvProbe,
  opts?: { dbProvider?: string | null; dbHasToken?: boolean }
): {
  ok: boolean;
  reason?: string;
} {
  if (!isEmailSendingEnvEnabled(env)) {
    return { ok: false, reason: 'EMAIL_SENDING_ENABLED=false' };
  }
  const dbProvider = String(opts?.dbProvider ?? '')
    .trim()
    .toLowerCase();
  const provider =
    dbProvider === 'lettermint' || dbProvider === 'resend'
      ? (dbProvider as 'lettermint' | 'resend')
      : resolveEmailMailProvider(env);
  if (!provider) {
    return { ok: false, reason: 'EMAIL_MAIL_PROVIDER_invalid' };
  }
  if (provider === 'lettermint') {
    if (opts?.dbHasToken === true) return { ok: true };
    if (hasLettermintProjectToken(env)) return { ok: true };
    return { ok: false, reason: 'LETTERMINT_PROJECT_TOKEN_missing' };
  }
  if (!hasActiveMailCredential({ ...env, EMAIL_MAIL_PROVIDER: 'resend' })) {
    return { ok: false, reason: 'RESEND_API_KEY_missing' };
  }
  return { ok: true };
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}

export async function runOutboxWorker(opts: {
  supabase: SupabaseClient<Database>;
  env?: EnvProbe;
  adapter?: MailAdapter;
  http?: { fetch: typeof fetch };
  limit?: number;
  /** When set, claim only these outbox ids (admin connection probe). Skips digest flush. */
  outboxIds?: number[];
}): Promise<WorkerRunResult> {
  const env = opts.env ?? (process.env as EnvProbe);
  const targetedIds = (opts.outboxIds ?? [])
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id) && id > 0);

  // Fast host kill-switch before any RPC.
  if (!isEmailSendingEnvEnabled(env)) {
    return {
      ok: true,
      skipped: true,
      reason: 'EMAIL_SENDING_ENABLED=false',
      claimed: 0,
      sent: 0,
      failed: 0,
      retried: 0,
      last_send: {
        outbox_id: targetedIds[0] ?? 0,
        module_key: 'email_test',
        blocked_stage: 'host_sending_disabled',
      },
    };
  }

  const ctxResult = await opts.supabase.rpc('email_core_worker_get_context');
  const ctxRaw = ctxResult?.data;
  const ctxErr = ctxResult?.error;
  if (ctxErr) {
    return {
      ok: false,
      skipped: true,
      reason: ctxErr.message,
      claimed: 0,
      sent: 0,
      failed: 0,
      retried: 0,
      last_send: {
        outbox_id: targetedIds[0] ?? 0,
        module_key: 'email_test',
        blocked_stage: 'worker_context_failed',
      },
    };
  }

  const ctx = asRecord(ctxRaw);
  const gate = canWorkerSend(env, {
    dbProvider: String(ctx.mail_provider ?? ''),
    dbHasToken: ctx.has_provider_token === true,
  });
  if (!gate.ok) {
    return {
      ok: true,
      skipped: true,
      reason: gate.reason,
      claimed: 0,
      sent: 0,
      failed: 0,
      retried: 0,
      last_send: {
        outbox_id: targetedIds[0] ?? 0,
        module_key: 'email_test',
        blocked_stage: gate.reason ?? 'worker_gate',
      },
    };
  }

  if (ctx.email_enabled !== true || ctx.db_ready !== true) {
    return {
      ok: true,
      skipped: true,
      reason: 'db_not_ready',
      claimed: 0,
      sent: 0,
      failed: 0,
      retried: 0,
      last_send: {
        outbox_id: targetedIds[0] ?? 0,
        module_key: 'email_test',
        blocked_stage: 'db_not_ready',
      },
    };
  }

  const senderEmail = String(ctx.sender_email ?? '').trim();
  const senderName = String(ctx.sender_name ?? '').trim();
  if (!senderEmail) {
    return {
      ok: true,
      skipped: true,
      reason: 'sender_missing',
      claimed: 0,
      sent: 0,
      failed: 0,
      retried: 0,
      last_send: {
        outbox_id: targetedIds[0] ?? 0,
        module_key: 'email_test',
        blocked_stage: 'sender_missing',
      },
    };
  }

  // Flush prior-day digests into outbox (canonical worker — no separate scheduler).
  // Targeted admin probes must not flush digests into the same run.
  if (targetedIds.length === 0) {
    try {
      await opts.supabase.rpc('email_core_digest_flush_ready' as never, {
        p_before_day: null,
      } as never);
    } catch {
      /* migration may be absent */
    }
  }

  const limit = Math.min(
    Math.max(opts.limit ?? EMAIL_WORKER_MAX_BATCH, 1),
    EMAIL_WORKER_MAX_BATCH
  );

  let batchRaw: unknown;
  let claimErr: { message: string } | null = null;
  if (targetedIds.length > 0) {
    const claimed = await opts.supabase.rpc('email_core_claim_outbox_ids' as never, {
      p_ids: targetedIds,
    } as never);
    batchRaw = claimed.data;
    claimErr = claimed.error;
  } else {
    const claimed = await opts.supabase.rpc('email_core_claim_outbox_batch', {
      p_limit: limit,
    });
    batchRaw = claimed.data;
    claimErr = claimed.error;
  }
  if (claimErr) {
    return {
      ok: false,
      skipped: false,
      reason: claimErr.message,
      claimed: 0,
      sent: 0,
      failed: 0,
      retried: 0,
      last_send: {
        outbox_id: targetedIds[0] ?? 0,
        module_key: 'email_test',
        blocked_stage: 'claim_failed',
        error_code: claimErr.message.slice(0, 160),
      },
    };
  }

  const rows = (Array.isArray(batchRaw) ? batchRaw : []) as OutboxRow[];
  if (rows.length === 0) {
    return {
      ok: true,
      skipped: false,
      reason: 'empty_batch',
      claimed: 0,
      sent: 0,
      failed: 0,
      retried: 0,
      claimed_ids: [],
      last_send: {
        outbox_id: targetedIds[0] ?? 0,
        module_key: 'email_test',
        blocked_stage:
          targetedIds.length > 0 ? 'claim_missed_target' : 'empty_batch',
      },
    };
  }

  const adapter =
    opts.adapter ??
    (await createMailAdapterForWorker({
      supabase: opts.supabase,
      env,
      http: opts.http,
      mailProvider: String(ctx.mail_provider ?? ''),
    }));

  let sent = 0;
  let failed = 0;
  let retried = 0;
  let cancelled = 0;
  let reviewed = 0;
  let lastSend: WorkerRunResult['last_send'];

  for (const row of rows) {
    const payload = asRecord(row.payload);
    const inviteLink = String(payload.invite_link ?? payload.inviteLink ?? '').trim();
    if (
      (row.module_key === 'pb1_invite' || row.module_key === 'user_activation') &&
      inviteLink &&
      isNonPublicInviteUrl(inviteLink)
    ) {
      await opts.supabase.rpc('email_core_complete_outbox_send', {
        p_outbox_id: row.id,
        p_ok: false,
        p_provider_message_id: null,
        p_error_code: 'invalid_invite_link',
        p_provider_response_class: 'rejected',
      });
      // Force terminal via permanent code (migration) or local cancel fallback.
      cancelled += 1;
      failed += 1;
      lastSend = {
        outbox_id: row.id,
        module_key: row.module_key,
        blocked_stage: 'invalid_invite_link',
        error_code: 'invalid_invite_link',
        ok: false,
      };
      continue;
    }

    // Send-time preference recheck (optional events may have been disabled after queue).
    const eventKey =
      String(row.event_key ?? payload.event_key ?? '').trim() ||
      resolveEventKeyFromEnqueue({
        moduleKey: row.module_key,
        templateKey: row.template_key,
        payload,
      });
    // Admin connection probe (email_test): explicit recipient, no registration /
    // personal category barrier. Ordinary modules still fail closed.
    const isAdminConnectionProbe = row.module_key === 'email_test';
    const allowBeforeRegistration =
      isAdminConnectionProbe ||
      row.module_key === 'pb1_invite' ||
      row.module_key === 'user_activation' ||
      row.module_key === 'auth' ||
      getEmailEvent(eventKey)?.importance === 'security_mandatory';

    if (!allowBeforeRegistration) {
      try {
        const { data: ready } = await opts.supabase.rpc(
          'email_core_recipient_registration_ready' as never,
          { p_to_email: row.to_email } as never,
        );
        if (ready !== true) {
          await opts.supabase.rpc('email_core_cancel_outbox_policy' as never, {
            p_outbox_id: row.id,
            p_reason: 'blocked_not_registered',
          } as never);
          cancelled += 1;
          lastSend = {
            outbox_id: row.id,
            module_key: row.module_key,
            blocked_stage: 'blocked_not_registered',
            error_code: 'blocked_not_registered',
            ok: false,
          };
          continue;
        }
        // Do not send events that originated before registration completed.
        // Prefer source event time over queue created_at (re-queue after registration).
        const { data: profileRows } = await opts.supabase
          .from('user_activation_profiles' as never)
          .select('app_registration_completed_at')
          .eq('email', String(row.to_email).trim().toLowerCase())
          .maybeSingle();
        const completedAt = (profileRows as { app_registration_completed_at?: string | null } | null)
          ?.app_registration_completed_at;
        // Prefer immutable column; then payload. Do NOT invent "now" from a fresh
        // re-queue — missing time fails closed for ordinary mail.
        const eventOccurredRaw =
          (row as { event_occurred_at?: string | null }).event_occurred_at ??
          payload.event_occurred_at ??
          payload.occurred_at ??
          payload.event_at ??
          payload.event_time ??
          payload.source_event_at ??
          null;
        const eventOccurredMs = eventOccurredRaw ? new Date(String(eventOccurredRaw)).getTime() : NaN;
        if (!Number.isFinite(eventOccurredMs)) {
          await opts.supabase.rpc('email_core_cancel_outbox_policy' as never, {
            p_outbox_id: row.id,
            p_reason: 'blocked_unknown_event_time',
          } as never);
          cancelled += 1;
          lastSend = {
            outbox_id: row.id,
            module_key: row.module_key,
            blocked_stage: 'blocked_unknown_event_time',
            error_code: 'blocked_unknown_event_time',
            ok: false,
          };
          continue;
        }
        if (completedAt && eventOccurredMs < new Date(completedAt).getTime()) {
          await opts.supabase.rpc('email_core_cancel_outbox_policy' as never, {
            p_outbox_id: row.id,
            p_reason: 'blocked_pre_registration_event',
          } as never);
          cancelled += 1;
          lastSend = {
            outbox_id: row.id,
            module_key: row.module_key,
            blocked_stage: 'blocked_pre_registration_event',
            error_code: 'blocked_pre_registration_event',
            ok: false,
          };
          continue;
        }
      } catch {
        /* missing RPC/migration — fail closed for ordinary mail */
        await opts.supabase.rpc('email_core_cancel_outbox_policy' as never, {
          p_outbox_id: row.id,
          p_reason: 'blocked_not_registered',
        } as never);
        cancelled += 1;
        lastSend = {
          outbox_id: row.id,
          module_key: row.module_key,
          blocked_stage: 'blocked_not_registered',
          error_code: 'blocked_not_registered',
          ok: false,
        };
        continue;
      }
    }

    // Admin connection probe skips personal/complex notification categories.
    if (
      !isAdminConnectionProbe &&
      eventKey &&
      getEmailEvent(eventKey)?.importance !== 'security_mandatory'
    ) {
      try {
        const snap = await fetchPolicySnapshotForRecipient(opts.supabase, {
          toEmail: row.to_email,
        });
        const decision = evaluateNotificationPolicy({
          eventKey,
          complex: snap.complex,
          personal: snap.personal,
          phase: 'dispatch',
          isAdminControlledTest: false,
        });
        if (!decision.allow) {
          await opts.supabase.rpc('email_core_cancel_outbox_policy' as never, {
            p_outbox_id: row.id,
            p_reason: decision.reason,
          } as never);
          cancelled += 1;
          lastSend = {
            outbox_id: row.id,
            module_key: row.module_key,
            blocked_stage: decision.reason,
            error_code: decision.reason,
            ok: false,
          };
          continue;
        }
        if (decision.channel === 'digest') {
          await opts.supabase.rpc('email_core_digest_buffer_upsert' as never, {
            p_to_email: row.to_email,
            p_user_id: null,
            p_event_key: eventKey,
            p_module_key: row.module_key,
            p_template_key: row.template_key,
            p_locale: row.locale,
            p_payload: payload,
            p_idempotency_key: `digest-move:${row.idempotency_key}`,
          } as never);
          await opts.supabase.rpc('email_core_cancel_outbox_policy' as never, {
            p_outbox_id: row.id,
            p_reason: 'moved_to_digest',
          } as never);
          cancelled += 1;
          lastSend = {
            outbox_id: row.id,
            module_key: row.module_key,
            blocked_stage: 'moved_to_digest',
            error_code: 'moved_to_digest',
            ok: false,
          };
          continue;
        }
      } catch {
        /* prefs missing — proceed under dual gates only */
      }
    }

    if (
      outboxAttemptNeedsOperatorReview({
        nowMs: Date.now(),
        attemptCount: Number(row.attempts ?? 0),
        firstAttemptAt: row.first_attempt_at ?? null,
        uncertainAttempt: row.uncertain_attempt === true,
        providerMessageId: row.provider_message_id ?? null,
      })
    ) {
      try {
        await opts.supabase.rpc('email_core_hold_idempotency_review' as never, {
          p_outbox_id: row.id,
        } as never);
      } catch {
        /* The claim row stays sending until reclaim applies the same hold. */
      }
      reviewed += 1;
      lastSend = {
        outbox_id: row.id,
        module_key: row.module_key,
        blocked_stage: 'idempotency_window_review',
        ok: false,
      };
      continue;
    }

    // Template applied at send time (current builtin + complex override).
    // Saving a template does not rewrite already-queued outbox rows.
    let override: EmailTemplateOverride | null = null;
    try {
      const ovRes = await opts.supabase.rpc('email_core_get_template_override' as never, {
        p_template_key: row.template_key,
        p_locale: ['bg', 'ru', 'en'].includes(row.locale) ? row.locale : 'bg',
      } as never);
      if (ovRes.data && typeof ovRes.data === 'object') {
        override = ovRes.data as EmailTemplateOverride;
      }
    } catch {
      override = null;
    }

    const rendered = renderTransactionalEmail({
      templateKey: row.template_key,
      locale: row.locale,
      // Prefer live template subject when an override exists; else keep enqueue subject.
      subject: override?.subject ? null : row.subject,
      payload: row.payload,
      complexName: senderName || null,
      override,
    });
    const renderCheck = validateRenderedTemplate(rendered);
    if (!renderCheck.ok) {
      await opts.supabase.rpc('email_core_complete_outbox_send', {
        p_outbox_id: row.id,
        p_ok: false,
        p_provider_message_id: null,
        p_error_code: `permanent:${renderCheck.reason ?? 'template_render_invalid'}`,
        p_provider_response_class: 'rejected',
      });
      failed += 1;
      lastSend = {
        outbox_id: row.id,
        module_key: row.module_key,
        blocked_stage: renderCheck.reason ?? 'template_render_invalid',
        error_code: renderCheck.reason ?? 'template_render_invalid',
        ok: false,
      };
      continue;
    }

    const result = await adapter.send({
      to: row.to_email,
      subject: rendered.subject,
      html: rendered.html,
      fromName: senderName || senderEmail,
      fromEmail: senderEmail,
      replyTo: (ctx.reply_to_email as string | null) ?? null,
      idempotencyKey: row.idempotency_key,
    });

    if (result.ok) {
      await opts.supabase.rpc('email_core_complete_outbox_send', {
        p_outbox_id: row.id,
        p_ok: true,
        p_provider_message_id: result.providerMessageId,
        p_error_code: null,
        p_provider_response_class: 'accepted',
      });
      if (row.module_key === 'email_test') {
        try {
          await opts.supabase.rpc('email_core_service_mark_send_probe_accepted' as never);
        } catch {
          /* optional status upgrade */
        }
      }
      sent += 1;
      lastSend = {
        outbox_id: row.id,
        module_key: row.module_key,
        provider: adapter.name,
        http_status: result.status ?? null,
        provider_message_id: result.providerMessageId,
        ok: true,
      };
    } else {
      const permanent = isPermanentProviderFailure(result.errorCode, result.responseClass);
      const errorCode = permanent
        ? result.errorCode.startsWith('permanent:')
          ? result.errorCode
          : `permanent:${result.errorCode}`
        : result.errorCode;
      const complete = await opts.supabase.rpc('email_core_complete_outbox_send', {
        p_outbox_id: row.id,
        p_ok: false,
        p_provider_message_id: null,
        p_error_code: errorCode,
        p_provider_response_class: result.responseClass,
      });
      const status =
        complete.data && typeof complete.data === 'object'
          ? String((complete.data as { status?: unknown }).status ?? '')
          : '';
      if (status === 'failed' || permanent) failed += 1;
      else retried += 1;
      lastSend = {
        outbox_id: row.id,
        module_key: row.module_key,
        provider: adapter.name,
        http_status: result.status ?? null,
        error_code: errorCode,
        ok: false,
        blocked_stage: 'provider_rejected',
      };
    }
  }

  return {
    ok: true,
    skipped: false,
    claimed: rows.length,
    sent,
    failed,
    retried,
    cancelled,
    reviewed,
    claimed_ids: rows.map((r) => Number(r.id)),
    last_send: lastSend,
  };
}

/** Pure backoff helper for tests (mirrors SQL 30 * 2^attempt, cap 3600). */
export function computeBackoffSeconds(attempt: number): number {
  const a = Math.max(1, Math.min(attempt, 10));
  return Math.min(3600, 2 ** a * 30);
}

/** Lettermint dedupes the same Idempotency-Key and body for 24 hours. */
export const PROVIDER_IDEMPOTENCY_WINDOW_SECONDS = 24 * 60 * 60;

/**
 * Wait scheduled after failed attempts 1–7. Attempt 8 is terminal and adds no further delay.
 * About 7380 seconds, inside the 24-hour provider window when the worker runs on time.
 */
export function outboxScheduledRetrySpanSeconds(): number {
  let sum = 0;
  for (let attempt = 1; attempt <= 7; attempt += 1) {
    sum += computeBackoffSeconds(attempt);
  }
  return sum;
}

/**
 * Scheduled retries stay inside the provider window.
 * A duplicate is still possible when the API already accepted the message and a later
 * retry of the same key happens after 24 hours, for example while the worker is stopped
 * or EMAIL_SENDING_ENABLED is off and the acceptance was not stored.
 */
export const PROVIDER_IDEMPOTENCY_DUPLICATE_RISK =
  'A second copy is possible if the same Idempotency-Key is sent after the 24-hour provider window. The worker does not send that retry: the row waits for operator review when an earlier attempt may already have been accepted.';

export function idempotencyWindowDuplicateRisk(elapsedSinceAcceptSeconds: number): boolean {
  return elapsedSinceAcceptSeconds > PROVIDER_IDEMPOTENCY_WINDOW_SECONDS;
}

/** Recover rows stuck in `sending` after worker crash / timeout. */
export async function reclaimStaleSendingClaims(
  supabase: SupabaseClient<Database>,
  opts?: { olderThanMinutes?: number }
): Promise<number> {
  const minutes = Math.max(1, Math.min(opts?.olderThanMinutes ?? 15, 120));
  try {
    const { data, error } = await supabase.rpc('email_core_reclaim_stale_sending', {
      p_older_than_minutes: minutes,
    });
    if (error) return 0;
    if (typeof data === 'number') return data;
    if (data && typeof data === 'object' && 'reclaimed' in data) {
      return Number((data as { reclaimed?: unknown }).reclaimed ?? 0);
    }
    return Number(data ?? 0) || 0;
  } catch {
    return 0;
  }
}
