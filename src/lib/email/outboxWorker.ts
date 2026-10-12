/**
 * Email Core outbox worker (Phase B).
 * Host gate EMAIL_SENDING_ENABLED must be true before any Resend call.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import {
  hasResendApiKeyPresent,
  isEmailSendingEnvEnabled,
} from '@/lib/emailCore';
import { createResendAdapter, type ResendAdapter } from '@/lib/email/resendAdapter';
import { renderTransactionalEmail } from '@/lib/email/templates';

export const EMAIL_WORKER_MAX_BATCH = 10;

export type WorkerRunResult = {
  ok: boolean;
  skipped: boolean;
  reason?: string;
  claimed: number;
  sent: number;
  failed: number;
  retried: number;
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

export function canWorkerSend(env: EnvProbe = process.env as EnvProbe): {
  ok: boolean;
  reason?: string;
} {
  if (!isEmailSendingEnvEnabled(env)) {
    return { ok: false, reason: 'EMAIL_SENDING_ENABLED=false' };
  }
  if (!hasResendApiKeyPresent(env)) {
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
  adapter?: ResendAdapter;
  limit?: number;
}): Promise<WorkerRunResult> {
  const env = opts.env ?? (process.env as EnvProbe);
  const gate = canWorkerSend(env);
  if (!gate.ok) {
    return {
      ok: true,
      skipped: true,
      reason: gate.reason,
      claimed: 0,
      sent: 0,
      failed: 0,
      retried: 0,
    };
  }

  const { data: ctxRaw, error: ctxErr } = await opts.supabase.rpc('email_core_worker_get_context');
  if (ctxErr) {
    return {
      ok: false,
      skipped: true,
      reason: ctxErr.message,
      claimed: 0,
      sent: 0,
      failed: 0,
      retried: 0,
    };
  }

  const ctx = asRecord(ctxRaw);
  if (ctx.email_enabled !== true || ctx.db_ready !== true) {
    return {
      ok: true,
      skipped: true,
      reason: 'db_not_ready',
      claimed: 0,
      sent: 0,
      failed: 0,
      retried: 0,
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
    };
  }

  const limit = Math.min(
    Math.max(opts.limit ?? EMAIL_WORKER_MAX_BATCH, 1),
    EMAIL_WORKER_MAX_BATCH
  );

  const { data: batchRaw, error: claimErr } = await opts.supabase.rpc(
    'email_core_claim_outbox_batch',
    { p_limit: limit }
  );
  if (claimErr) {
    return {
      ok: false,
      skipped: false,
      reason: claimErr.message,
      claimed: 0,
      sent: 0,
      failed: 0,
      retried: 0,
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
    };
  }

  const adapter =
    opts.adapter ??
    createResendAdapter({ apiKey: (env.RESEND_API_KEY ?? '').trim() });

  let sent = 0;
  let failed = 0;
  let retried = 0;

  for (const row of rows) {
    const rendered = renderTransactionalEmail({
      templateKey: row.template_key,
      locale: row.locale,
      subject: row.subject,
      payload: row.payload,
      complexName: senderName || null,
    });

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
      sent += 1;
    } else {
      const complete = await opts.supabase.rpc('email_core_complete_outbox_send', {
        p_outbox_id: row.id,
        p_ok: false,
        p_provider_message_id: null,
        p_error_code: result.errorCode,
        p_provider_response_class: result.responseClass,
      });
      const status =
        complete.data && typeof complete.data === 'object'
          ? String((complete.data as { status?: unknown }).status ?? '')
          : '';
      if (status === 'failed') failed += 1;
      else retried += 1;
    }
  }

  return {
    ok: true,
    skipped: false,
    claimed: rows.length,
    sent,
    failed,
    retried,
  };
}

/** Pure backoff helper for tests (mirrors SQL 30 * 2^attempt, cap 3600). */
export function computeBackoffSeconds(attempt: number): number {
  const a = Math.max(1, Math.min(attempt, 10));
  return Math.min(3600, 2 ** a * 30);
}
