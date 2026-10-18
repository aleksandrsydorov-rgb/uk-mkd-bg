/**
 * Email Core — Phase B foundation (worker/webhook exist; host send gate default off).
 * One installation = one complex = one email configuration.
 * Secrets stay in host env only (never client / never public tables).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@/lib/database.types';
import { normalizeEmail } from '@/lib/email';
import {
  getEmailEvent,
  resolveEventKeyFromEnqueue,
} from '@/lib/email/eventCatalog';
import { evaluateNotificationPolicy } from '@/lib/email/notificationPolicy';
import { fetchPolicySnapshotForRecipient } from '@/lib/email/notificationPrefsClient';

export const EMAIL_CORE_PHASE = 'D' as const;
/** Notification policy layer built on Phase D Email Core. */
export const EMAIL_CORE_NOTIFICATION_PHASE = 'EML-3' as const;

type EnvProbe = Record<string, string | undefined>;

/** Host kill-switch — Phase A default false. */
export function isEmailSendingEnvEnabled(
  env: EnvProbe = process.env as EnvProbe
): boolean {
  const raw = (env.EMAIL_SENDING_ENABLED ?? 'false').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

export function hasResendApiKeyPresent(
  env: EnvProbe = process.env as EnvProbe
): boolean {
  return Boolean((env.RESEND_API_KEY ?? '').trim());
}

/** Never expose key material — only presence for health UI. */
export function serverSecretPresent(env: EnvProbe = process.env as EnvProbe): boolean {
  return hasResendApiKeyPresent(env) && isEmailSendingEnvEnabled(env);
}

export type EmailModuleKey =
  | 'pb1_invite'
  | 'user_activation'
  | 'pkg_xfer'
  | 'meeting'
  | 'email_test'
  | 'system';

export type EmailDeliveryStatus =
  | 'not_configured'
  | 'domain_pending'
  | 'ready'
  | 'paused'
  | 'degraded'
  | 'disabled_by_platform';

export type EmailTemplateLocale = 'bg' | 'ru' | 'en';

export type ComplexEmailSettings = {
  mail_provider: 'resend';
  sender_name: string;
  sender_email: string | null;
  reply_to_email: string | null;
  verified_domain: string | null;
  provider_domain_id: string | null;
  domain_status: 'none' | 'pending' | 'verified' | 'failed';
  email_enabled: boolean;
  template_locale: EmailTemplateLocale;
  platform_disabled: boolean;
  delivery_status: EmailDeliveryStatus;
  sending_ready: boolean;
  phase: string;
  secrets_in_database: boolean;
  updated_at: string | null;
  updated_by_email: string | null;
  verified_senders: VerifiedSender[];
};

export type VerifiedSender = {
  id: number;
  email: string;
  domain: string;
  status: string;
  verified_at: string | null;
};

export type EmailEnqueueResult = {
  ok: boolean;
  duplicate: boolean;
  outbox_id: number | null;
  status: string;
  fallback_status: string;
  queued: boolean;
  sent: boolean;
};

export type ModuleHonestyStatus =
  | 'COPY_LINK'
  | 'LOCAL_ONLY'
  | 'PROVIDER_NOT_CONFIGURED'
  | 'QUEUED'
  | 'SENT'
  | 'FAILED'
  | 'in_app_only';

export type DeriveDeliveryStatusInput = {
  platformDisabled?: boolean;
  domainStatus: ComplexEmailSettings['domain_status'];
  verifiedDomain: string | null;
  senderEmail: string | null;
  hasVerifiedSender: boolean;
  emailEnabled: boolean;
  serverSecretPresent: boolean;
  recentFailureRate?: number;
};

export function deriveDeliveryStatus(input: DeriveDeliveryStatusInput): EmailDeliveryStatus {
  if (input.platformDisabled) return 'disabled_by_platform';
  if (input.domainStatus === 'pending') return 'domain_pending';
  if (
    input.verifiedDomain &&
    input.domainStatus !== 'verified' &&
    input.domainStatus !== 'none'
  ) {
    return 'domain_pending';
  }
  if (!input.hasVerifiedSender || !input.senderEmail || input.domainStatus !== 'verified') {
    return 'not_configured';
  }
  if ((input.recentFailureRate ?? 0) >= 0.5) return 'degraded';
  if (!input.emailEnabled || !input.serverSecretPresent) return 'paused';
  return 'ready';
}

/** Honesty status for modules when Email Core is not ready to send. */
export function moduleFallbackStatus(
  module: EmailModuleKey,
  sendingReady: boolean
): ModuleHonestyStatus {
  if (sendingReady) return 'QUEUED';
  if (module === 'meeting') return 'in_app_only';
  if (module === 'pb1_invite') return 'COPY_LINK';
  if (module === 'user_activation') return 'PROVIDER_NOT_CONFIGURED';
  if (module === 'pkg_xfer') return 'PROVIDER_NOT_CONFIGURED';
  return 'PROVIDER_NOT_CONFIGURED';
}

export function buildIdempotencyKey(parts: Array<string | number | null | undefined>): string {
  return parts
    .map((p) => String(p ?? '').trim())
    .filter(Boolean)
    .join(':');
}

/** Prefer recipient language; fall back to installation default (bg). */
export function resolveEmailLocale(
  preferred?: string | null,
  installationDefault?: string | null
): EmailTemplateLocale {
  const cand = String(preferred ?? '').trim().toLowerCase().slice(0, 2);
  if (cand === 'bg' || cand === 'ru' || cand === 'en') return cand;
  const def = String(installationDefault ?? '').trim().toLowerCase().slice(0, 2);
  if (def === 'bg' || def === 'ru' || def === 'en') return def;
  return 'bg';
}

/** Provider errors that must not be retried blindly. */
export function isPermanentProviderFailure(
  errorCode: string | null | undefined,
  responseClass?: string | null
): boolean {
  const code = String(errorCode ?? '')
    .trim()
    .toLowerCase();
  if (!code) return false;
  if (code.startsWith('permanent:')) return true;
  const permanentTokens = [
    'invalid_recipient',
    'invalid_invite_link',
    'bounced',
    'bounce',
    'complained',
    'complaint',
    'unsubscribed',
    'suppressed',
    'validation_error',
    'invalid_from_address',
    'domain_not_verified',
  ];
  if (permanentTokens.some((t) => code.includes(t))) return true;
  if (responseClass === 'rejected' && /invalid|forbidden|not allowed|blocked/.test(code)) {
    return true;
  }
  return false;
}

/** Outbox row is eligible for another worker claim. */
export function isOutboxRetryEligible(row: {
  status: string;
  attempts: number;
  last_error_code?: string | null;
}): boolean {
  if (row.status !== 'queued' && row.status !== 'held') return false;
  if (row.attempts >= 8) return false;
  if (isPermanentProviderFailure(row.last_error_code)) return false;
  return true;
}

/** Map outbox + optional webhook event to operator-facing honesty. */
export function honestyFromDeliveryState(opts: {
  status: string;
  latestEventType?: string | null;
}): ModuleHonestyStatus {
  const ev = String(opts.latestEventType ?? '')
    .trim()
    .toLowerCase();
  if (ev === 'delivered') return 'SENT';
  if (ev === 'bounced' || ev === 'bounce' || ev === 'complained' || ev === 'complaint' || ev === 'failed') {
    return 'FAILED';
  }
  if (opts.status === 'sent') return 'SENT';
  if (opts.status === 'queued' || opts.status === 'sending' || opts.status === 'held') return 'QUEUED';
  if (opts.status === 'failed' || opts.status === 'cancelled') return 'FAILED';
  return 'PROVIDER_NOT_CONFIGURED';
}

export function maskEmail(email: string | null | undefined): string | null {
  const v = normalizeEmail(email ?? '');
  if (!v) return null;
  const at = v.indexOf('@');
  if (at < 1) return '***';
  const local = v.slice(0, at);
  const domain = v.slice(at + 1);
  if (local.length <= 1) return `*@${domain}`;
  return `${local[0]}***@${domain}`;
}

export function assertNoClientSecrets(bundleProbe: Record<string, unknown>): void {
  const forbidden = [
    'RESEND_API_KEY',
    'RESEND_WEBHOOK_SECRET',
    'EMAIL_WORKER_SECRET',
    'SUPABASE_SERVICE_ROLE_KEY',
    'service_role_key',
  ];
  for (const key of forbidden) {
    if (key in bundleProbe && bundleProbe[key]) {
      throw new Error(`Email Core: forbidden secret exposed via client probe: ${key}`);
    }
  }
}

function asString(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v);
  return s.length ? s : null;
}

function asBool(v: unknown, fallback = false): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

export function parseEmailSettingsPayload(data: unknown): ComplexEmailSettings {
  const row = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  const sendersRaw = Array.isArray(row.verified_senders) ? row.verified_senders : [];
  const verified_senders: VerifiedSender[] = sendersRaw.map((s) => {
    const o = s && typeof s === 'object' ? (s as Record<string, unknown>) : {};
    return {
      id: Number(o.id ?? 0),
      email: String(o.email ?? ''),
      domain: String(o.domain ?? ''),
      status: String(o.status ?? ''),
      verified_at: asString(o.verified_at),
    };
  });

  const domain_status = (asString(row.domain_status) ?? 'none') as ComplexEmailSettings['domain_status'];
  const email_enabled = asBool(row.email_enabled, false);
  const sender_email = asString(row.sender_email);
  const hasVerifiedSender = verified_senders.some(
    (s) => s.status === 'verified' && normalizeEmail(s.email) === normalizeEmail(sender_email ?? '')
  );

  const configStatus = (asString(row.delivery_status) ?? 'not_configured') as EmailDeliveryStatus;
  const appStatus = deriveDeliveryStatus({
    platformDisabled: asBool(row.platform_disabled, false),
    domainStatus: domain_status,
    verifiedDomain: asString(row.verified_domain),
    senderEmail: sender_email,
    hasVerifiedSender,
    emailEnabled: email_enabled,
    serverSecretPresent: serverSecretPresent(),
  });

  const sending_ready = appStatus === 'ready';

  return {
    mail_provider: 'resend',
    sender_name: String(row.sender_name ?? ''),
    sender_email,
    reply_to_email: asString(row.reply_to_email),
    verified_domain: asString(row.verified_domain),
    provider_domain_id: asString(row.provider_domain_id),
    domain_status,
    email_enabled,
    template_locale: ((asString(row.template_locale) ?? 'bg') as EmailTemplateLocale),
    platform_disabled: asBool(row.platform_disabled, false),
    delivery_status: appStatus || configStatus,
    sending_ready,
    phase: asString(row.phase) ?? EMAIL_CORE_PHASE,
    secrets_in_database: asBool(row.secrets_in_database, false),
    updated_at: asString(row.updated_at),
    updated_by_email: asString(row.updated_by_email),
    verified_senders,
  };
}

/** @deprecated Phase A stub — prefer createResendAdapter from `@/lib/email/resendAdapter`. */
export type EmailProvider = {
  readonly name: 'resend';
  send(_input: {
    to: string;
    subject: string;
    html: string;
    fromName: string;
    fromEmail: string;
    replyTo?: string | null;
  }): Promise<{ ok: false; reason: 'phase_a_no_send' }>;
};

export const phaseAResendAdapter: EmailProvider = {
  name: 'resend',
  async send() {
    return { ok: false, reason: 'phase_a_no_send' };
  },
};

export type EmailCoreConsumer = {
  module: EmailModuleKey;
  buildIdempotencyKey: (ctx: Record<string, string | number | null | undefined>) => string;
  honestyWhenNotReady: ModuleHonestyStatus;
};

export const EMAIL_CORE_CONSUMERS: Record<
  'pb1' | 'userActivation' | 'pkgXfer' | 'meeting' | 'emailTest' | 'system',
  EmailCoreConsumer
> = {
  pb1: {
    module: 'pb1_invite',
    buildIdempotencyKey: (ctx) =>
      buildIdempotencyKey(['pb1_invite', ctx.inviteId, ctx.version ?? 'v1']),
    honestyWhenNotReady: 'COPY_LINK',
  },
  userActivation: {
    module: 'user_activation',
    buildIdempotencyKey: (ctx) =>
      buildIdempotencyKey(['ua', ctx.reminderType, ctx.email, ctx.propertyId ?? 'none']),
    honestyWhenNotReady: 'PROVIDER_NOT_CONFIGURED',
  },
  pkgXfer: {
    module: 'pkg_xfer',
    buildIdempotencyKey: (ctx) =>
      buildIdempotencyKey(['pkg_xfer', ctx.transferId, ctx.eventKind, ctx.emailHash]),
    honestyWhenNotReady: 'PROVIDER_NOT_CONFIGURED',
  },
  meeting: {
    module: 'meeting',
    buildIdempotencyKey: (ctx) =>
      buildIdempotencyKey(['meeting', ctx.meetingId, ctx.kind, ctx.emailHash]),
    honestyWhenNotReady: 'in_app_only',
  },
  emailTest: {
    module: 'email_test',
    buildIdempotencyKey: (ctx) =>
      buildIdempotencyKey(['email_test', ctx.toEmail, ctx.nonce ?? 'v1']),
    honestyWhenNotReady: 'PROVIDER_NOT_CONFIGURED',
  },
  system: {
    module: 'system',
    buildIdempotencyKey: (ctx) =>
      buildIdempotencyKey([
        'sys',
        ctx.eventKey,
        ctx.entityId ?? 'e',
        ctx.emailHash ?? ctx.toEmail,
        ctx.version ?? 'v1',
      ]),
    honestyWhenNotReady: 'PROVIDER_NOT_CONFIGURED',
  },
};

type Sb = SupabaseClient<Database>;

export async function fetchEmailSettings(supabase: Sb): Promise<ComplexEmailSettings> {
  const { data, error } = await supabase.rpc('admin_get_email_settings');
  if (error) throw error;
  return parseEmailSettingsPayload(data);
}

export async function updateEmailSettings(
  supabase: Sb,
  patch: {
    sender_name?: string;
    sender_email?: string | null;
    reply_to_email?: string | null;
    template_locale?: EmailTemplateLocale;
    /** Omit to leave DB value unchanged; pass true only under operator-controlled live test. */
    email_enabled?: boolean;
  }
): Promise<ComplexEmailSettings> {
  const { data, error } = await supabase.rpc('admin_update_email_settings', {
    p_sender_name: patch.sender_name ?? null,
    p_sender_email: patch.sender_email ?? null,
    p_reply_to_email: patch.reply_to_email ?? null,
    p_template_locale: patch.template_locale ?? null,
    p_email_enabled:
      patch.email_enabled === undefined ? null : patch.email_enabled === true,
  });
  if (error) throw error;
  return parseEmailSettingsPayload(data);
}

export type EmailDiagnosticRow = {
  id: number;
  module_key: string;
  template_key: string;
  locale: string;
  to_masked: string | null;
  status: string;
  attempts: number;
  last_error_code: string | null;
  next_attempt_at: string | null;
  provider_message_id_present: boolean;
  latest_event_type: string | null;
  retry_eligible: boolean;
  created_at: string;
  updated_at: string | null;
};

export type EmailQueueSummary = {
  queued: number;
  held: number;
  sending: number;
  sent: number;
  failed: number;
  cancelled: number;
  blocked_not_ready: number;
  claimable: number;
};

export async function listEmailDiagnostics(
  supabase: Sb,
  limit = 50
): Promise<EmailDiagnosticRow[]> {
  const { data, error } = await supabase.rpc('admin_list_email_diagnostics', {
    p_limit: limit,
  });
  if (error) throw error;
  const rows = Array.isArray(data) ? data : [];
  return rows.map((r) => {
    const o = r && typeof r === 'object' ? (r as Record<string, unknown>) : {};
    const status = String(o.status ?? '');
    const attempts = Number(o.attempts ?? 0);
    const last_error_code = asString(o.last_error_code);
    const retry_eligible =
      typeof o.retry_eligible === 'boolean'
        ? o.retry_eligible
        : isOutboxRetryEligible({ status, attempts, last_error_code });
    return {
      id: Number(o.id ?? 0),
      module_key: String(o.module_key ?? ''),
      template_key: String(o.template_key ?? ''),
      locale: String(o.locale ?? ''),
      to_masked: asString(o.to_masked),
      status,
      attempts,
      last_error_code,
      next_attempt_at: asString(o.next_attempt_at),
      provider_message_id_present: asBool(o.provider_message_id_present, false),
      latest_event_type: asString(o.latest_event_type),
      retry_eligible,
      created_at: String(o.created_at ?? ''),
      updated_at: asString(o.updated_at),
    };
  });
}

export async function fetchEmailQueueSummary(
  supabase: Sb
): Promise<EmailQueueSummary | null> {
  try {
    const { data, error } = await supabase.rpc('admin_email_queue_summary');
    if (error) return null;
    const o = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
    return {
      queued: Number(o.queued ?? 0),
      held: Number(o.held ?? 0),
      sending: Number(o.sending ?? 0),
      sent: Number(o.sent ?? 0),
      failed: Number(o.failed ?? 0),
      cancelled: Number(o.cancelled ?? 0),
      blocked_not_ready: Number(o.blocked_not_ready ?? 0),
      claimable: Number(o.claimable ?? 0),
    };
  } catch {
    return null;
  }
}

/** Shared enqueue for PB1 / UA / XFER / Meeting — worker may send later when gates allow. */
export async function enqueueTransactionalEmail(
  supabase: Sb,
  args: {
    consumer: keyof typeof EMAIL_CORE_CONSUMERS;
    toEmail: string;
    templateKey: string;
    context: Record<string, string | number | null | undefined>;
    locale?: EmailTemplateLocale | null;
    subject?: string | null;
    payload?: Record<string, unknown>;
    /** Explicit catalog event; otherwise inferred from module/template/payload. */
    eventKey?: string | null;
    userId?: string | null;
    skipPolicyCheck?: boolean;
  }
): Promise<EmailEnqueueResult & { honesty: ModuleHonestyStatus }> {
  const consumer = EMAIL_CORE_CONSUMERS[args.consumer];
  const key = consumer.buildIdempotencyKey(args.context);
  const toEmail = normalizeEmail(args.toEmail);
  const payload: Record<string, unknown> = { ...(args.payload ?? {}) };
  const eventKey =
    args.eventKey ??
    resolveEventKeyFromEnqueue({
      moduleKey: consumer.module,
      templateKey: args.templateKey,
      payload,
    });

  if (eventKey) {
    payload.event_key = eventKey;
  }

  const catalog = eventKey ? getEmailEvent(eventKey) : undefined;
  if (catalog?.producerStatus === 'needs_decision' && !args.skipPolicyCheck) {
    return {
      ok: false,
      duplicate: false,
      outbox_id: null,
      status: 'cancelled',
      fallback_status: 'PROVIDER_NOT_CONFIGURED',
      queued: false,
      sent: false,
      honesty: moduleFallbackStatus(consumer.module, false),
    };
  }

  if (eventKey && !args.skipPolicyCheck) {
    try {
      const snap = await fetchPolicySnapshotForRecipient(supabase, {
        userId: args.userId ?? null,
        toEmail,
      });
      let throttled = false;
      if (catalog?.highFrequency && catalog.importance === 'informational') {
        const { data: hit } = await supabase.rpc(
          'email_core_recipient_throttle_hit' as never,
          {
            p_to_email: toEmail,
            p_event_key: eventKey,
            p_limit: 5,
            p_window_minutes: 60,
          } as never
        );
        throttled = hit === true;
      }
      const decision = evaluateNotificationPolicy({
        eventKey,
        complex: snap.complex,
        personal: snap.personal,
        phase: 'enqueue',
        throttled,
        isAdminControlledTest: consumer.module === 'email_test',
      });
      if (!decision.allow) {
        return {
          ok: true,
          duplicate: false,
          outbox_id: null,
          status: 'cancelled',
          fallback_status: decision.reason,
          queued: false,
          sent: false,
          honesty: moduleFallbackStatus(consumer.module, false),
        };
      }
      if (decision.channel === 'digest') {
        const { data: dig, error: digErr } = await supabase.rpc(
          'email_core_digest_buffer_upsert' as never,
          {
            p_to_email: toEmail,
            p_user_id: args.userId ?? null,
            p_event_key: eventKey,
            p_module_key: consumer.module,
            p_template_key: args.templateKey,
            p_locale: args.locale ?? 'bg',
            p_payload: payload as Json,
            p_idempotency_key: key,
          } as never
        );
        if (digErr) throw digErr;
        const digRow =
          dig && typeof dig === 'object' ? (dig as Record<string, unknown>) : {};
        return {
          ok: asBool(digRow.ok, true),
          duplicate: asBool(digRow.duplicate, false),
          outbox_id: null,
          status: 'held',
          fallback_status: 'QUEUED',
          queued: true,
          sent: false,
          honesty: 'QUEUED',
        };
      }
    } catch {
      // Prefer fail-open to blocked_not_ready enqueue when prefs RPCs missing (pre-migration).
    }
  }

  const { data, error } = await supabase.rpc('email_core_enqueue', {
    p_idempotency_key: key,
    p_module_key: consumer.module,
    p_template_key: args.templateKey,
    p_to_email: toEmail,
    p_locale: args.locale ?? null,
    p_subject: args.subject ?? null,
    p_payload: payload as Json,
  });
  if (error) throw error;
  const row = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  const queued = asBool(row.queued, false);
  const sent = asBool(row.sent, false);
  const fallback = asString(row.fallback_status) ?? 'PROVIDER_NOT_CONFIGURED';
  const outboxId = row.outbox_id == null ? null : Number(row.outbox_id);
  if (outboxId != null && eventKey) {
    try {
      await supabase.rpc('email_core_set_outbox_event_meta' as never, {
        p_outbox_id: outboxId,
        p_event_key: eventKey,
        p_policy_decision: 'allowed',
      } as never);
    } catch {
      /* column/RPC may be absent until EML-3 migration applied */
    }
  }
  return {
    ok: asBool(row.ok, false),
    duplicate: asBool(row.duplicate, false),
    outbox_id: outboxId,
    status: String(row.status ?? 'blocked_not_ready'),
    fallback_status: fallback,
    queued,
    sent,
    honesty: honestyFromEnqueue(consumer.module, { queued, sent, fallback }),
  };
}

/**
 * Prefer live queue/send state; otherwise use module honesty (PB1=COPY_LINK),
 * not the generic SQL PROVIDER_NOT_CONFIGURED fallback for every module.
 */
export function honestyFromEnqueue(
  module: EmailModuleKey,
  opts: { queued: boolean; sent: boolean; fallback: string }
): ModuleHonestyStatus {
  if (opts.sent) return 'SENT';
  if (opts.queued) return 'QUEUED';
  if (module === 'pb1_invite') return 'COPY_LINK';
  if (module === 'meeting') return 'in_app_only';
  const known: ModuleHonestyStatus[] = [
    'COPY_LINK',
    'LOCAL_ONLY',
    'PROVIDER_NOT_CONFIGURED',
    'QUEUED',
    'SENT',
    'FAILED',
    'in_app_only',
  ];
  if ((known as string[]).includes(opts.fallback)) {
    return opts.fallback as ModuleHonestyStatus;
  }
  return moduleFallbackStatus(module, false);
}

/** Queue a single allowlisted test message (no send until host+DB gates allow). */
export async function enqueueAllowlistedTestEmail(
  supabase: Sb,
  args: { toEmail: string; locale?: EmailTemplateLocale | null; note?: string | null }
): Promise<EmailEnqueueResult & { honesty: ModuleHonestyStatus }> {
  const to = normalizeEmail(args.toEmail);
  const nonce = `${Date.now()}`;
  return enqueueTransactionalEmail(supabase, {
    consumer: 'emailTest',
    toEmail: to,
    templateKey: 'email_test',
    locale: args.locale,
    context: { toEmail: to, nonce },
    payload: {
      note: args.note ?? 'controlled_test',
      queued_at: new Date().toISOString(),
    },
  });
}
