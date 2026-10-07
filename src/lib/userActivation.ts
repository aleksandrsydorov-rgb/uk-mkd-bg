/**
 * User Activation — platform-core adoption metrics.
 * Admin RPCs only for list/dashboard; owners call touch_activity (throttled).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@/lib/database.types';
import { isUkAdminRole } from '@/lib/finance';

export const USER_ACTIVATION_MODULE_KEY = 'user_activation' as const;
export const USER_ACTIVATION_MIGRATION = '20261008020000_user_activation_module';

/** Inactivity → DORMANT (days). */
export const USER_ACTIVATION_INACTIVE_DAYS = 30;
/** UI "recently active / online" window (minutes). Not exact session presence. */
export const USER_ACTIVATION_ONLINE_MINUTES = 5;
/** Invited but not registered → needs attention (days). */
export const USER_ACTIVATION_INVITE_STALE_DAYS = 3;
/** Client/server activity heartbeat throttle (minutes). */
export const USER_ACTIVATION_ACTIVITY_THROTTLE_MINUTES = 5;

export type UserActivationState =
  | 'NOT_INVITED'
  | 'INVITED'
  | 'REGISTERED'
  | 'FIRST_LOGIN_DONE'
  | 'ACTIVE'
  | 'DORMANT';

export type UserActivationFilter =
  | 'all'
  | 'not_invited'
  | 'invited'
  | 'registered'
  | 'first_login'
  | 'active'
  | 'dormant'
  | 'needs_attention'
  | 'never_logged_in';

export type UserActivationPropertyRef = {
  property_id: number;
  apartment_number: string | null;
  section: string | null;
  block: string | null;
};

export type UserActivationRow = {
  email: string;
  display_name: string;
  properties: UserActivationPropertyRef[];
  has_invite: boolean;
  has_pending_invite: boolean;
  last_invite_at: string | null;
  is_registered: boolean;
  registered_at: string | null;
  email_confirmed_at: string | null;
  first_login_at: string | null;
  last_login_at: string | null;
  last_activity_at: string | null;
  login_count: number;
  activation_state: UserActivationState;
  recently_active: boolean;
  needs_attention: boolean;
  last_reminder_at: string | null;
};

export type UserActivationDashboard = {
  total_owners: number;
  invited: number;
  registered: number;
  first_login_completed: number;
  active_last_30_days: number;
  never_logged_in: number;
  dormant: number;
  activation_percent: number;
  properties_total: number;
  properties_with_active_owner: number;
  inactive_days: number;
  online_minutes: number;
};

export type UserActivationReminderResult = {
  id: string;
  owner_email: string;
  property_id: number | null;
  reminder_type: string;
  channel: string;
  delivery_status: string;
  invite_token: string | null;
  invite_expires_at: string | null;
};

export function canSeeUserActivationAdmin(role?: string | null) {
  return isUkAdminRole(role);
}

export function activationStateTone(
  state: string,
): 'neutral' | 'info' | 'success' | 'warning' | 'danger' {
  if (state === 'ACTIVE' || state === 'FIRST_LOGIN_DONE') return 'success';
  if (state === 'REGISTERED' || state === 'INVITED') return 'warning';
  if (state === 'DORMANT') return 'danger';
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

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return fallback;
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function parseProperty(raw: unknown): UserActivationPropertyRef {
  const r = asRecord(raw);
  return {
    property_id: asNumber(r.property_id),
    apartment_number: asNullableString(r.apartment_number),
    section: asNullableString(r.section),
    block: asNullableString(r.block),
  };
}

export function parseUserActivationRow(raw: unknown): UserActivationRow {
  const r = asRecord(raw);
  const props = Array.isArray(r.properties) ? r.properties.map(parseProperty) : [];
  return {
    email: asString(r.email),
    display_name: asString(r.display_name, asString(r.email)),
    properties: props,
    has_invite: asBoolean(r.has_invite),
    has_pending_invite: asBoolean(r.has_pending_invite),
    last_invite_at: asNullableString(r.last_invite_at),
    is_registered: asBoolean(r.is_registered),
    registered_at: asNullableString(r.registered_at),
    email_confirmed_at: asNullableString(r.email_confirmed_at),
    first_login_at: asNullableString(r.first_login_at),
    last_login_at: asNullableString(r.last_login_at),
    last_activity_at: asNullableString(r.last_activity_at),
    login_count: asNumber(r.login_count),
    activation_state: asString(r.activation_state, 'NOT_INVITED') as UserActivationState,
    recently_active: asBoolean(r.recently_active),
    needs_attention: asBoolean(r.needs_attention),
    last_reminder_at: asNullableString(r.last_reminder_at),
  };
}

export function parseUserActivationDashboard(raw: unknown): UserActivationDashboard {
  const r = asRecord(raw);
  return {
    total_owners: asNumber(r.total_owners),
    invited: asNumber(r.invited),
    registered: asNumber(r.registered),
    first_login_completed: asNumber(r.first_login_completed),
    active_last_30_days: asNumber(r.active_last_30_days),
    never_logged_in: asNumber(r.never_logged_in),
    dormant: asNumber(r.dormant),
    activation_percent: asNumber(r.activation_percent),
    properties_total: asNumber(r.properties_total),
    properties_with_active_owner: asNumber(r.properties_with_active_owner),
    inactive_days: asNumber(r.inactive_days, USER_ACTIVATION_INACTIVE_DAYS),
    online_minutes: asNumber(r.online_minutes, USER_ACTIVATION_ONLINE_MINUTES),
  };
}

export async function fetchUserActivationDashboard(supabase: SupabaseClient<Database>) {
  const { data, error } = await supabase.rpc('admin_user_activation_dashboard');
  if (error) throw error;
  return parseUserActivationDashboard(data);
}

export async function fetchUserActivationList(
  supabase: SupabaseClient<Database>,
  filter: UserActivationFilter,
  search: string,
) {
  const { data, error } = await supabase.rpc('admin_user_activation_list', {
    p_filter: filter,
    p_search: search.trim() || null,
  });
  if (error) throw error;
  return Array.isArray(data) ? data.map(parseUserActivationRow) : [];
}

export async function createUserActivationReminder(
  supabase: SupabaseClient<Database>,
  args: {
    ownerEmail: string;
    reminderType?: string;
    propertyId?: number | null;
    note?: string | null;
    resendInvite?: boolean;
  },
): Promise<UserActivationReminderResult> {
  const { data, error } = await supabase.rpc('admin_user_activation_create_reminder', {
    p_owner_email: args.ownerEmail,
    p_reminder_type: args.reminderType ?? 'activation_nudge',
    p_property_id: args.propertyId ?? null,
    p_note: args.note ?? null,
    p_resend_invite: args.resendInvite ?? false,
  });
  if (error) throw error;
  const r = asRecord(data);
  return {
    id: asString(r.id),
    owner_email: asString(r.owner_email),
    property_id: r.property_id == null ? null : asNumber(r.property_id),
    reminder_type: asString(r.reminder_type),
    channel: asString(r.channel),
    delivery_status: asString(r.delivery_status),
    invite_token: asNullableString(r.invite_token),
    invite_expires_at: asNullableString(r.invite_expires_at),
  };
}

/** Throttled owner heartbeat — safe to call on account load / interval. */
export async function touchUserActivationActivity(supabase: SupabaseClient<Database>) {
  const { data, error } = await supabase.rpc('user_activation_touch_activity');
  if (error) throw error;
  return data as Json;
}

export function formatOwnerProperties(properties: UserActivationPropertyRef[]): string {
  if (!properties.length) return '—';
  return properties
    .map((p) => {
      const apt = p.apartment_number?.trim() || String(p.property_id);
      const parts = [apt];
      if (p.section) parts.push(`S${p.section}`);
      if (p.block) parts.push(`B${p.block}`);
      return parts.join(' · ');
    })
    .join(', ');
}
