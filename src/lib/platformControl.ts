/**
 * Platform Control service boundary (client installation).
 * UI depends only on this interface. Local Supabase adapter is the current
 * implementation; later replace with Master Control API adapter.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@/lib/database.types';
import { isUkAdminRole } from '@/lib/finance';

export const PLATFORM_SUPPORT_MODULE_KEY = 'platform_support' as const;
export const APP_VERSION = '0.1.0';
export const PLATFORM_SUPPORT_MIGRATION = '20261008010000_platform_support_module';

/** Pre-Master = local persistence only; Live = Master Control API delivers/replies. */
export type PlatformSupportDeliveryMode = 'awaiting_master' | 'live';
export type PlatformBillingSyncMode = 'awaiting_master' | 'live';

export type PlatformAccountStatus =
  | 'ACTIVE'
  | 'PAYMENT_DUE'
  | 'WARNING'
  | 'SUSPENDED_NONPAYMENT';

export type PlatformInvoiceStatus = 'ISSUED' | 'PAID' | 'OVERDUE' | 'CANCELLED';

export type PlatformSupportSenderRole = 'complex_admin' | 'platform_operator';

export type PlatformTechContext = {
  installation_id?: string;
  complex_name?: string;
  app_version?: string;
  schema_migration?: string;
  active_modules?: string[];
  page_path?: string;
  environment?: string;
  deployment_id?: string;
  client_timestamp?: string;
};

export type PlatformAccount = {
  installation_id: string;
  complex_name: string;
  deployment_id: string | null;
  status: PlatformAccountStatus;
  fixed_service_price: number | null;
  currency: string;
  next_payment_date: string | null;
  amount_due: number | null;
  debt_amount: number | null;
  updated_at: string | null;
};

export type PlatformInvoice = {
  id: string;
  invoice_number: string;
  billing_period_start: string | null;
  billing_period_end: string | null;
  issue_date: string;
  due_date: string | null;
  amount: number;
  currency: string;
  status: PlatformInvoiceStatus;
  paid_at: string | null;
  payment_reference: string | null;
  document_url: string | null;
};

export type PlatformPayment = {
  id: string;
  invoice_id: string | null;
  paid_at: string;
  amount: number;
  currency: string;
  reference: string | null;
};

export type PlatformSupportMessage = {
  id: string;
  thread_id: string;
  sender_role: PlatformSupportSenderRole;
  body: string;
  tech_context: PlatformTechContext;
  attachment_url: string | null;
  attachment_name: string | null;
  read_by_complex_admin: boolean;
  read_by_platform_operator: boolean;
  created_by_email: string | null;
  created_at: string;
};

export type PlatformSupportConversation = {
  thread_id: string;
  installation_id: string;
  subject: string;
  unread_count: number;
  messages: PlatformSupportMessage[];
};

export interface PlatformControlService {
  /** Honest channel mode — UI must not pretend live ALSYD delivery when awaiting_master. */
  getSupportDeliveryMode(): PlatformSupportDeliveryMode;
  getBillingSyncMode(): PlatformBillingSyncMode;
  getPlatformAccount(): Promise<PlatformAccount>;
  getInvoices(): Promise<PlatformInvoice[]>;
  getPayments(): Promise<PlatformPayment[]>;
  getSupportConversation(): Promise<PlatformSupportConversation>;
  sendSupportMessage(body: string, techContext?: PlatformTechContext): Promise<PlatformSupportMessage>;
  markSupportMessagesRead(): Promise<number>;
  getUnreadSupportCount(): Promise<number>;
}

/** Platform-core surface: role-gated only (not an optional business-module toggle). */
export function canSeePlatformSupportAdmin(role?: string | null) {
  return isUkAdminRole(role);
}

/**
 * Account suspension must not hide billing/support from complex admin.
 * Future Master may lock other product surfaces; this module stays reachable.
 */
export function platformSupportVisibleDuringSuspension(
  _status: PlatformAccountStatus | string | null | undefined,
): boolean {
  return true;
}

export function resolveComplexDisplayName(): string {
  const fromEnv = process.env.NEXT_PUBLIC_COMPLEX_DISPLAY_NAME?.trim();
  return fromEnv || '';
}

export function resolveDeploymentId(): string | null {
  const v =
    process.env.NEXT_PUBLIC_VERCEL_DEPLOYMENT_ID?.trim() ||
    process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA?.trim() ||
    process.env.NEXT_PUBLIC_DEPLOYMENT_ID?.trim() ||
    '';
  return v || null;
}

export function resolveEnvironmentLabel(): string {
  return (
    process.env.NEXT_PUBLIC_VERCEL_ENV?.trim() ||
    process.env.NODE_ENV ||
    'unknown'
  );
}

export function buildClientTechContext(input?: {
  activeModules?: string[];
  pagePath?: string;
  installationId?: string;
  complexName?: string;
}): PlatformTechContext {
  return {
    installation_id: input?.installationId,
    complex_name: input?.complexName || resolveComplexDisplayName() || undefined,
    app_version: APP_VERSION,
    schema_migration: PLATFORM_SUPPORT_MIGRATION,
    active_modules: input?.activeModules?.slice(0, 40),
    page_path: input?.pagePath?.slice(0, 200),
    environment: resolveEnvironmentLabel(),
    deployment_id: resolveDeploymentId() ?? undefined,
    client_timestamp: new Date().toISOString(),
  };
}

export function platformAccountStatusTone(
  status: string,
): 'success' | 'warning' | 'danger' | 'info' | 'neutral' {
  if (status === 'ACTIVE') return 'success';
  if (status === 'PAYMENT_DUE') return 'warning';
  if (status === 'WARNING') return 'warning';
  if (status === 'SUSPENDED_NONPAYMENT') return 'danger';
  return 'neutral';
}

export function platformInvoiceStatusTone(
  status: string,
): 'success' | 'warning' | 'danger' | 'info' | 'neutral' {
  if (status === 'PAID') return 'success';
  if (status === 'ISSUED') return 'info';
  if (status === 'OVERDUE') return 'danger';
  if (status === 'CANCELLED') return 'neutral';
  return 'neutral';
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asNumberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function parseAccount(raw: unknown): PlatformAccount {
  const r = asRecord(raw);
  const status = asString(r.status, 'ACTIVE') as PlatformAccountStatus;
  return {
    installation_id: asString(r.installation_id),
    complex_name: asString(r.complex_name),
    deployment_id: asNullableString(r.deployment_id),
    status,
    fixed_service_price: asNumberOrNull(r.fixed_service_price),
    currency: asString(r.currency, 'EUR'),
    next_payment_date: asNullableString(r.next_payment_date),
    amount_due: asNumberOrNull(r.amount_due),
    debt_amount: asNumberOrNull(r.debt_amount),
    updated_at: asNullableString(r.updated_at),
  };
}

function parseInvoice(raw: unknown): PlatformInvoice {
  const r = asRecord(raw);
  return {
    id: asString(r.id),
    invoice_number: asString(r.invoice_number),
    billing_period_start: asNullableString(r.billing_period_start),
    billing_period_end: asNullableString(r.billing_period_end),
    issue_date: asString(r.issue_date),
    due_date: asNullableString(r.due_date),
    amount: asNumberOrNull(r.amount) ?? 0,
    currency: asString(r.currency, 'EUR'),
    status: asString(r.status, 'ISSUED') as PlatformInvoiceStatus,
    paid_at: asNullableString(r.paid_at),
    payment_reference: asNullableString(r.payment_reference),
    document_url: asNullableString(r.document_url),
  };
}

function parseMessage(raw: unknown): PlatformSupportMessage {
  const r = asRecord(raw);
  const ctx = asRecord(r.tech_context);
  return {
    id: asString(r.id),
    thread_id: asString(r.thread_id),
    sender_role: asString(r.sender_role, 'complex_admin') as PlatformSupportSenderRole,
    body: asString(r.body),
    tech_context: ctx as PlatformTechContext,
    attachment_url: asNullableString(r.attachment_url),
    attachment_name: asNullableString(r.attachment_name),
    read_by_complex_admin: asBoolean(r.read_by_complex_admin),
    read_by_platform_operator: asBoolean(r.read_by_platform_operator),
    created_by_email: asNullableString(r.created_by_email),
    created_at: asString(r.created_at),
  };
}

function parseConversation(raw: unknown): PlatformSupportConversation {
  const r = asRecord(raw);
  const messages = Array.isArray(r.messages) ? r.messages.map(parseMessage) : [];
  return {
    thread_id: asString(r.thread_id),
    installation_id: asString(r.installation_id),
    subject: asString(r.subject, 'Platform support'),
    unread_count: asNumberOrNull(r.unread_count) ?? 0,
    messages,
  };
}

function toJson(ctx: PlatformTechContext | undefined): Json {
  if (!ctx) return {};
  const out: Record<string, Json> = {};
  for (const [key, value] of Object.entries(ctx)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      out[key] = value.map(String);
    } else if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      out[key] = value;
    } else if (value === null) {
      out[key] = null;
    }
  }
  return out;
}

/**
 * Local / pre-Master adapter.
 * Persists domain data in this installation DB only.
 * Does NOT deliver to ALSYD/platform_operator and does NOT sync invoices.
 * Replace with Master Control API adapter for live delivery + billing.
 */
export function createLocalPlatformControlAdapter(
  supabase: SupabaseClient<Database>,
): PlatformControlService {
  const identityArgs = () => ({
    p_complex_name: resolveComplexDisplayName() || null,
    p_deployment_id: resolveDeploymentId(),
  });

  return {
    getSupportDeliveryMode() {
      return 'awaiting_master';
    },

    getBillingSyncMode() {
      return 'awaiting_master';
    },

    async getPlatformAccount() {
      const { data, error } = await supabase.rpc('platform_support_get_account', identityArgs());
      if (error) throw error;
      return parseAccount(data);
    },

    async getInvoices() {
      const { data, error } = await supabase.rpc('platform_support_list_invoices', identityArgs());
      if (error) throw error;
      return Array.isArray(data) ? data.map(parseInvoice) : [];
    },

    async getPayments() {
      const invoices = await this.getInvoices();
      return invoices
        .filter((inv) => inv.status === 'PAID' && inv.paid_at)
        .map((inv) => ({
          id: inv.id,
          invoice_id: inv.id,
          paid_at: inv.paid_at as string,
          amount: inv.amount,
          currency: inv.currency,
          reference: inv.payment_reference,
        }));
    },

    async getSupportConversation() {
      const { data, error } = await supabase.rpc('platform_support_get_conversation', identityArgs());
      if (error) throw error;
      return parseConversation(data);
    },

    async sendSupportMessage(body: string, techContext?: PlatformTechContext) {
      const { data, error } = await supabase.rpc('platform_support_send_message', {
        p_body: body,
        p_tech_context: toJson(techContext),
        ...identityArgs(),
      });
      if (error) throw error;
      return parseMessage(data);
    },

    async markSupportMessagesRead() {
      const { data, error } = await supabase.rpc('platform_support_mark_read', identityArgs());
      if (error) throw error;
      return typeof data === 'number' ? data : 0;
    },

    async getUnreadSupportCount() {
      const { data, error } = await supabase.rpc('platform_support_unread_count', identityArgs());
      if (error) throw error;
      return typeof data === 'number' ? data : 0;
    },
  };
}
