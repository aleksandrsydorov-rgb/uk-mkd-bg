/**
 * EML-3 — Client helpers for notification policy prefs (admin + personal).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@/lib/database.types';
import type { NotificationMode } from '@/lib/email/eventCatalog';
import type {
  ComplexNotificationState,
  PersonalNotificationState,
} from '@/lib/email/notificationPolicy';

type Sb = SupabaseClient<Database>;

function asBoolMap(v: unknown): Record<string, boolean> {
  if (!v || typeof v !== 'object') return {};
  const out: Record<string, boolean> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    out[k] = val === true;
  }
  return out;
}

export async function fetchAdminNotificationPolicy(supabase: Sb): Promise<ComplexNotificationState> {
  const { data, error } = await supabase.rpc('admin_list_notification_policy' as never);
  if (error) throw error;
  const row = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  return {
    modules: asBoolMap(row.modules),
    events: asBoolMap(row.events),
  };
}

export async function setAdminNotificationModule(
  supabase: Sb,
  moduleKey: string,
  enabled: boolean
): Promise<ComplexNotificationState> {
  const { data, error } = await supabase.rpc('admin_set_notification_module' as never, {
    p_module_key: moduleKey,
    p_enabled: enabled,
  } as never);
  if (error) throw error;
  const row = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  return {
    modules: asBoolMap(row.modules),
    events: asBoolMap(row.events),
  };
}

export async function setAdminNotificationEvent(
  supabase: Sb,
  eventKey: string,
  enabled: boolean
): Promise<ComplexNotificationState> {
  const { data, error } = await supabase.rpc('admin_set_notification_event' as never, {
    p_event_key: eventKey,
    p_enabled: enabled,
  } as never);
  if (error) throw error;
  const row = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  return {
    modules: asBoolMap(row.modules),
    events: asBoolMap(row.events),
  };
}

export type MyNotificationPrefsPayload = {
  personal: PersonalNotificationState;
  complex: ComplexNotificationState;
};

export async function fetchMyNotificationPrefs(supabase: Sb): Promise<MyNotificationPrefsPayload> {
  const { data, error } = await supabase.rpc('get_my_notification_prefs' as never);
  if (error) throw error;
  const row = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  const complexRaw =
    row.complex && typeof row.complex === 'object'
      ? (row.complex as Record<string, unknown>)
      : {};
  const mode = String(row.mode ?? 'ALL') as NotificationMode;
  return {
    personal: {
      mode: (
        ['ALL', 'IMPORTANT_ONLY', 'DAILY_DIGEST', 'CUSTOM', 'INFORMATIONAL_OFF'] as string[]
      ).includes(mode)
        ? mode
        : 'ALL',
      eventOverrides: asBoolMap(row.event_overrides),
      role: (row.role_hint as PersonalNotificationState['role']) ?? null,
    },
    complex: {
      modules: asBoolMap(complexRaw.modules),
      events: asBoolMap(complexRaw.events),
    },
  };
}

export async function saveMyNotificationPrefs(
  supabase: Sb,
  args: {
    mode: NotificationMode;
    roleHint?: 'admin' | 'staff' | 'owner' | null;
    eventOverrides?: Record<string, boolean>;
  }
): Promise<MyNotificationPrefsPayload> {
  const { data, error } = await supabase.rpc('set_my_notification_prefs' as never, {
    p_mode: args.mode,
    p_role_hint: args.roleHint ?? null,
    p_event_overrides: (args.eventOverrides ?? null) as Json | null,
  } as never);
  if (error) throw error;
  const row = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  const complexRaw =
    row.complex && typeof row.complex === 'object'
      ? (row.complex as Record<string, unknown>)
      : {};
  return {
    personal: {
      mode: String(row.mode ?? args.mode) as NotificationMode,
      eventOverrides: asBoolMap(row.event_overrides),
      role: (row.role_hint as PersonalNotificationState['role']) ?? null,
    },
    complex: {
      modules: asBoolMap(complexRaw.modules),
      events: asBoolMap(complexRaw.events),
    },
  };
}

export async function fetchPolicySnapshotForRecipient(
  supabase: Sb,
  opts?: { userId?: string | null; toEmail?: string | null }
): Promise<{
  complex: ComplexNotificationState;
  personal: PersonalNotificationState;
}> {
  const { data, error } = await supabase.rpc('email_core_notification_policy_snapshot' as never, {
    p_user_id: opts?.userId ?? null,
    p_to_email: opts?.toEmail ?? null,
  } as never);
  if (error) throw error;
  const row = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  const mode = String(row.personal_mode ?? 'ALL') as NotificationMode;
  return {
    complex: {
      modules: asBoolMap(row.modules),
      events: asBoolMap(row.events),
    },
    personal: {
      mode: (
        ['ALL', 'IMPORTANT_ONLY', 'DAILY_DIGEST', 'CUSTOM', 'INFORMATIONAL_OFF'] as string[]
      ).includes(mode)
        ? mode
        : 'ALL',
      eventOverrides: asBoolMap(row.personal_overrides),
      role: null,
    },
  };
}
