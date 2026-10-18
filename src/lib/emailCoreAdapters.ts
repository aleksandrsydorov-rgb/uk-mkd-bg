/**
 * Shared Email Core consumer adapters for PB1 / UA / PKG-XFER / Meeting.
 * Phase D: enqueue intent + honesty; worker/cron send only when host+DB gates allow.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import {
  EMAIL_CORE_CONSUMERS,
  enqueueTransactionalEmail,
  moduleFallbackStatus,
  resolveEmailLocale,
  type EmailEnqueueResult,
  type EmailTemplateLocale,
  type ModuleHonestyStatus,
} from '@/lib/emailCore';
import { isNonPublicInviteUrl } from '@/lib/publicAppUrl';

type Sb = SupabaseClient<Database>;

async function safeEnqueue(
  supabase: Sb,
  args: Parameters<typeof enqueueTransactionalEmail>[1]
): Promise<(EmailEnqueueResult & { honesty: ModuleHonestyStatus }) | null> {
  try {
    return await enqueueTransactionalEmail(supabase, args);
  } catch {
    return null;
  }
}

/** PB1 invitations — default honesty COPY_LINK when Email Core not ready. */
export async function emailCoreNotifyPb1Invite(
  supabase: Sb,
  input: {
    inviteId: string;
    toEmail: string;
    inviteLink: string;
    apartment?: string | null;
    locale?: EmailTemplateLocale | string | null;
    installationLocale?: EmailTemplateLocale | string | null;
  }
) {
  const inviteLink =
    input.inviteLink && !isNonPublicInviteUrl(input.inviteLink)
      ? input.inviteLink
      : null;
  const locale = resolveEmailLocale(input.locale, input.installationLocale);
  const result = await safeEnqueue(supabase, {
    consumer: 'pb1',
    toEmail: input.toEmail,
    templateKey: 'pb1_property_invite',
    locale,
    context: { inviteId: input.inviteId, version: 'v1' },
    payload: {
      invite_id: input.inviteId,
      invite_link: inviteLink,
      apartment: input.apartment ?? null,
    },
  });
  return {
    result,
    honesty: result?.honesty ?? EMAIL_CORE_CONSUMERS.pb1.honestyWhenNotReady,
  };
}

/** Cancel queued/blocked PB1 outbox rows after revoke (no-op if migration not applied). */
export async function emailCoreCancelPb1InviteOutbox(
  supabase: Sb,
  inviteId: string
): Promise<{ cancelled: number }> {
  const id = String(inviteId ?? '').trim();
  if (!id) return { cancelled: 0 };
  try {
    const { data, error } = await supabase.rpc('email_core_cancel_pb1_invite_outbox', {
      p_invite_id: id,
    });
    if (error) return { cancelled: 0 };
    if (data && typeof data === 'object' && 'cancelled' in data) {
      return { cancelled: Number((data as { cancelled?: unknown }).cancelled ?? 0) };
    }
    return { cancelled: Number(data ?? 0) || 0 };
  } catch {
    return { cancelled: 0 };
  }
}

/** User Activation reminders. */
export async function emailCoreNotifyUserActivation(
  supabase: Sb,
  input: {
    ownerEmail: string;
    reminderType: string;
    propertyId?: number | null;
    reminderId?: string | null;
    inviteLink?: string | null;
    locale?: EmailTemplateLocale | string | null;
    installationLocale?: EmailTemplateLocale | string | null;
  }
) {
  const inviteLink =
    input.inviteLink && !isNonPublicInviteUrl(input.inviteLink)
      ? input.inviteLink
      : null;
  const locale = resolveEmailLocale(input.locale, input.installationLocale);
  const result = await safeEnqueue(supabase, {
    consumer: 'userActivation',
    toEmail: input.ownerEmail,
    templateKey: `ua_${input.reminderType}`,
    locale,
    context: {
      reminderType: input.reminderType,
      email: input.ownerEmail,
      propertyId: input.propertyId ?? 'none',
      reminderId: input.reminderId ?? null,
    },
    payload: {
      reminderType: input.reminderType,
      invite_link: inviteLink,
      propertyId: input.propertyId ?? null,
    },
  });
  return {
    result,
    honesty: result?.honesty ?? moduleFallbackStatus('user_activation', false),
  };
}

/** PKG-XFER notifications (DB trigger also enqueues; this is the TS surface). */
export async function emailCoreNotifyPkgXfer(
  supabase: Sb,
  input: {
    transferId: number;
    eventKind: string;
    toEmail: string;
    emailHash?: string;
    locale?: EmailTemplateLocale | string | null;
    installationLocale?: EmailTemplateLocale | string | null;
  }
) {
  const locale = resolveEmailLocale(input.locale, input.installationLocale);
  const result = await safeEnqueue(supabase, {
    consumer: 'pkgXfer',
    toEmail: input.toEmail,
    templateKey: `ownership_change_${input.eventKind}`,
    locale,
    context: {
      transferId: input.transferId,
      eventKind: input.eventKind,
      emailHash: input.emailHash ?? input.toEmail,
    },
    payload: {
      event_kind: input.eventKind,
      transferId: input.transferId,
    },
  });
  return {
    result,
    honesty: result?.honesty ?? EMAIL_CORE_CONSUMERS.pkgXfer.honestyWhenNotReady,
  };
}

/**
 * Meeting notices.
 * - Legal / ZUES summons: never auto-email (require allowEmail=true).
 * - Informational lifecycle (`published`, `registration_open`): may enqueue;
 *   never replaces legally required procedures.
 */
export async function emailCoreNotifyMeeting(
  supabase: Sb,
  input: {
    meetingId: string;
    kind: string;
    toEmail: string;
    emailHash?: string;
    locale?: EmailTemplateLocale | string | null;
    installationLocale?: EmailTemplateLocale | string | null;
    /** Explicit opt-in for non-informational / legal-adjacent paths. */
    allowEmail?: boolean;
    userId?: string | null;
  }
) {
  const kind = String(input.kind ?? '')
    .trim()
    .toLowerCase();
  const informational = kind === 'published' || kind === 'registration_open';
  if (!informational && !input.allowEmail) {
    return {
      result: null,
      honesty: 'in_app_only' as ModuleHonestyStatus,
    };
  }
  const locale = resolveEmailLocale(input.locale, input.installationLocale);
  const eventKey =
    kind === 'registration_open' ? 'meeting_registration_open' : 'meeting_published';
  const result = await safeEnqueue(supabase, {
    consumer: 'meeting',
    toEmail: input.toEmail,
    templateKey: `meeting_${kind || 'published'}`,
    locale,
    eventKey,
    userId: input.userId ?? null,
    context: {
      meetingId: input.meetingId,
      kind: kind || 'published',
      emailHash: input.emailHash ?? input.toEmail,
    },
    payload: {
      event_kind: kind || 'published',
      meetingId: input.meetingId,
      informational: true,
      not_legal_notice: true,
    },
  });
  return {
    result,
    honesty: result?.honesty ?? EMAIL_CORE_CONSUMERS.meeting.honestyWhenNotReady,
  };
}
