/**
 * Email Core — Phase B foundation (worker/webhook exist; host send gate default off).
 * One installation = one complex = one email configuration.
 * Secrets stay in host env only (never client / never public tables).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@/lib/database.types';
import { normalizeEmail } from '@/lib/email';

export const EMAIL_CORE_PHASE = 'C' as const;

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
  'pb1' | 'userActivation' | 'pkgXfer' | 'meeting' | 'emailTest',
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

export async function listEmailDiagnostics(
  supabase: Sb,
  limit = 50
): Promise<
  Array<{
    id: number;
    module_key: string;
    template_key: string;
    locale: string;
    to_masked: string | null;
    status: string;
    attempts: number;
    last_error_code: string | null;
    created_at: string;
  }>
> {
  const { data, error } = await supabase.rpc('admin_list_email_diagnostics', {
    p_limit: limit,
  });
  if (error) throw error;
  const rows = Array.isArray(data) ? data : [];
  return rows.map((r) => {
    const o = r && typeof r === 'object' ? (r as Record<string, unknown>) : {};
    return {
      id: Number(o.id ?? 0),
      module_key: String(o.module_key ?? ''),
      template_key: String(o.template_key ?? ''),
      locale: String(o.locale ?? ''),
      to_masked: asString(o.to_masked),
      status: String(o.status ?? ''),
      attempts: Number(o.attempts ?? 0),
      last_error_code: asString(o.last_error_code),
      created_at: String(o.created_at ?? ''),
    };
  });
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
  }
): Promise<EmailEnqueueResult & { honesty: ModuleHonestyStatus }> {
  const consumer = EMAIL_CORE_CONSUMERS[args.consumer];
  const key = consumer.buildIdempotencyKey(args.context);
  const { data, error } = await supabase.rpc('email_core_enqueue', {
    p_idempotency_key: key,
    p_module_key: consumer.module,
    p_template_key: args.templateKey,
    p_to_email: normalizeEmail(args.toEmail),
    p_locale: args.locale ?? null,
    p_subject: args.subject ?? null,
    p_payload: (args.payload ?? {}) as Json,
  });
  if (error) throw error;
  const row = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  const queued = asBool(row.queued, false);
  const sent = asBool(row.sent, false);
  const fallback = asString(row.fallback_status) ?? 'PROVIDER_NOT_CONFIGURED';
  return {
    ok: asBool(row.ok, false),
    duplicate: asBool(row.duplicate, false),
    outbox_id: row.outbox_id == null ? null : Number(row.outbox_id),
    status: String(row.status ?? 'blocked_not_ready'),
    fallback_status: fallback,
    queued,
    sent,
    honesty: honestyFromEnqueue(consumer.module, { queued, sent, fallback }),
  };
}

function honestyFromEnqueue(
  module: EmailModuleKey,
  opts: { queued: boolean; sent: boolean; fallback: string }
): ModuleHonestyStatus {
  if (opts.sent) return 'SENT';
  if (opts.queued) return 'QUEUED';
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
