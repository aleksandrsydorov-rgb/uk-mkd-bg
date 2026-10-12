/**
 * Shared Email Core consumer adapters for PB1 / UA / PKG-XFER / Meeting.
 * Phase C: enqueue intent + honesty; worker sends only when host+DB gates allow.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import {
  EMAIL_CORE_CONSUMERS,
  enqueueTransactionalEmail,
  moduleFallbackStatus,
  type EmailEnqueueResult,
  type EmailTemplateLocale,
  type ModuleHonestyStatus,
} from '@/lib/emailCore';

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
    locale?: EmailTemplateLocale;
  }
) {
  const result = await safeEnqueue(supabase, {
    consumer: 'pb1',
    toEmail: input.toEmail,
    templateKey: 'pb1_property_invite',
    locale: input.locale,
    context: { inviteId: input.inviteId, version: 'v1' },
    payload: {
      invite_link: input.inviteLink,
      apartment: input.apartment ?? null,
    },
  });
  return {
    result,
    honesty: result?.honesty ?? EMAIL_CORE_CONSUMERS.pb1.honestyWhenNotReady,
  };
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
    locale?: EmailTemplateLocale;
  }
) {
  const result = await safeEnqueue(supabase, {
    consumer: 'userActivation',
    toEmail: input.ownerEmail,
    templateKey: `ua_${input.reminderType}`,
    locale: input.locale,
    context: {
      reminderType: input.reminderType,
      email: input.ownerEmail,
      propertyId: input.propertyId ?? 'none',
      reminderId: input.reminderId ?? null,
    },
    payload: {
      reminderType: input.reminderType,
      invite_link: input.inviteLink ?? null,
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
    locale?: EmailTemplateLocale;
  }
) {
  const result = await safeEnqueue(supabase, {
    consumer: 'pkgXfer',
    toEmail: input.toEmail,
    templateKey: `ownership_change_${input.eventKind}`,
    locale: input.locale,
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

/** Meeting notices — remain in_app_only until legal path enables them. */
export async function emailCoreNotifyMeeting(
  supabase: Sb,
  input: {
    meetingId: string;
    kind: string;
    toEmail: string;
    emailHash?: string;
    locale?: EmailTemplateLocale;
  }
) {
  const result = await safeEnqueue(supabase, {
    consumer: 'meeting',
    toEmail: input.toEmail,
    templateKey: `meeting_${input.kind}`,
    locale: input.locale,
    context: {
      meetingId: input.meetingId,
      kind: input.kind,
      emailHash: input.emailHash ?? input.toEmail,
    },
    payload: {
      event_kind: input.kind,
      meetingId: input.meetingId,
    },
  });
  return {
    result,
    honesty: result?.honesty ?? EMAIL_CORE_CONSUMERS.meeting.honestyWhenNotReady,
  };
}
