/**
 * EML-4 — Safe post-commit Email Core producers for approved catalog events.
 * Never creates financial charges/payments. Never debt collection.
 * Admin routine finance flood avoided: owners only for apartment-scoped finance.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { normalizeEmail } from '@/lib/email';
import {
  enqueueTransactionalEmail,
  resolveEmailLocale,
  type EmailTemplateLocale,
} from '@/lib/emailCore';
import { getEmailEvent } from '@/lib/email/eventCatalog';

type Sb = SupabaseClient<Database>;

export type ProducerResult = {
  attempted: number;
  queued: number;
  suppressed: number;
};

async function listActiveOwnerEmails(
  supabase: Sb,
  propertyId: number
): Promise<string[]> {
  const { data, error } = await supabase
    .from('property_registry_people')
    .select('email')
    .eq('property_id', propertyId)
    .eq('relation_type', 'owner')
    .is('deregistered_at', null);
  if (error || !data) return [];
  const emails = new Set<string>();
  for (const row of data) {
    const e = normalizeEmail(String((row as { email?: string | null }).email ?? ''));
    if (e) emails.add(e);
  }
  return [...emails];
}

async function listAllActiveOwnerEmails(supabase: Sb): Promise<
  Array<{ propertyId: number; email: string }>
> {
  const { data, error } = await supabase
    .from('property_registry_people')
    .select('property_id, email')
    .eq('relation_type', 'owner')
    .is('deregistered_at', null);
  if (error || !data) return [];
  const out: Array<{ propertyId: number; email: string }> = [];
  const seen = new Set<string>();
  for (const row of data) {
    const propertyId = Number((row as { property_id?: number }).property_id);
    const email = normalizeEmail(String((row as { email?: string | null }).email ?? ''));
    if (!propertyId || !email) continue;
    const key = `${propertyId}:${email}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ propertyId, email });
  }
  return out;
}

async function enqueueSystemEvent(
  supabase: Sb,
  args: {
    eventKey: string;
    toEmail: string;
    propertyId?: number | null;
    entityId: string;
    locale?: EmailTemplateLocale | string | null;
    payload?: Record<string, unknown>;
    userId?: string | null;
  }
): Promise<boolean> {
  const ev = getEmailEvent(args.eventKey);
  if (!ev || ev.producerStatus === 'needs_decision' || ev.producerStatus === 'excluded') {
    return false;
  }
  const to = normalizeEmail(args.toEmail);
  if (!to) return false;
  const locale = resolveEmailLocale(args.locale, null);
  try {
    const result = await enqueueTransactionalEmail(supabase, {
      consumer: 'system',
      toEmail: to,
      templateKey: ev.templateKey,
      eventKey: args.eventKey,
      userId: args.userId ?? null,
      locale,
      context: {
        eventKey: args.eventKey,
        entityId: args.entityId,
        emailHash: to,
        toEmail: to,
        version: 'v1',
      },
      payload: {
        ...(args.payload ?? {}),
        event_kind: args.eventKey,
        property_id: args.propertyId ?? null,
      },
    });
    return Boolean(result.queued || result.ok);
  } catch {
    return false;
  }
}

/** Owner-scoped: notify active Book owners of one property only. Never admins. */
export async function notifyPropertyOwnersEvent(
  supabase: Sb,
  args: {
    eventKey: string;
    propertyId: number;
    entityId: string;
    locale?: EmailTemplateLocale | string | null;
    payload?: Record<string, unknown>;
    /** When set, only this recipient (must be an owner email). */
    onlyEmail?: string | null;
  }
): Promise<ProducerResult> {
  const owners = await listActiveOwnerEmails(supabase, args.propertyId);
  const targets = args.onlyEmail
    ? owners.filter((e) => e === normalizeEmail(String(args.onlyEmail)))
    : owners;
  let queued = 0;
  let suppressed = 0;
  for (const email of targets) {
    const ok = await enqueueSystemEvent(supabase, {
      eventKey: args.eventKey,
      toEmail: email,
      propertyId: args.propertyId,
      entityId: `${args.entityId}:${email}`,
      locale: args.locale,
      payload: args.payload,
    });
    if (ok) queued += 1;
    else suppressed += 1;
  }
  return { attempted: targets.length, queued, suppressed };
}

/** Meeting informational fan-out to all active owners (not legal ZUES). */
export async function notifyMeetingInformational(
  supabase: Sb,
  args: {
    meetingId: string;
    kind: 'published' | 'registration_open';
    locale?: EmailTemplateLocale | string | null;
  }
): Promise<ProducerResult> {
  const { emailCoreNotifyMeeting } = await import('@/lib/emailCoreAdapters');
  const owners = await listAllActiveOwnerEmails(supabase);
  let queued = 0;
  let suppressed = 0;
  for (const o of owners) {
    try {
      const out = await emailCoreNotifyMeeting(supabase, {
        meetingId: args.meetingId,
        kind: args.kind,
        toEmail: o.email,
        locale: args.locale,
      });
      if (out.result?.queued || out.result?.ok) queued += 1;
      else suppressed += 1;
    } catch {
      suppressed += 1;
    }
  }
  return { attempted: owners.length, queued, suppressed };
}

/** Single staff assignee (inventory) — not every stock movement. */
export async function notifyStaffAssignee(
  supabase: Sb,
  args: {
    eventKey: string;
    staffEmail: string;
    entityId: string;
    locale?: EmailTemplateLocale | string | null;
    payload?: Record<string, unknown>;
  }
): Promise<ProducerResult> {
  const ok = await enqueueSystemEvent(supabase, {
    eventKey: args.eventKey,
    toEmail: args.staffEmail,
    entityId: args.entityId,
    locale: args.locale,
    payload: args.payload,
  });
  return { attempted: 1, queued: ok ? 1 : 0, suppressed: ok ? 0 : 1 };
}

/**
 * UK expense approved — one digest-eligible notice per admin email in staff table.
 * Avoids per-transaction owner blast; not a debt reminder.
 */
export async function notifyAdminsExpenseApproved(
  supabase: Sb,
  args: {
    expenseId: number;
    locale?: EmailTemplateLocale | string | null;
  }
): Promise<ProducerResult> {
  const { data, error } = await supabase
    .from('staff')
    .select('email, role')
    .eq('role', 'администрация');
  if (error || !data?.length) return { attempted: 0, queued: 0, suppressed: 0 };
  let queued = 0;
  let suppressed = 0;
  for (const row of data) {
    const email = normalizeEmail(String((row as { email?: string | null }).email ?? ''));
    if (!email) continue;
    const ok = await enqueueSystemEvent(supabase, {
      eventKey: 'uk_expense_approved',
      toEmail: email,
      entityId: `expense:${args.expenseId}:${email}`,
      locale: args.locale,
      payload: { expense_id: args.expenseId },
    });
    if (ok) queued += 1;
    else suppressed += 1;
  }
  return { attempted: data.length, queued, suppressed };
}

/** 15-minute aggregation bucket for ticket chat (one logical email per recipient/window). */
export function ticketChatAggregationBucket(nowMs: number = Date.now()): number {
  return Math.floor(nowMs / (15 * 60 * 1000));
}

/**
 * Cleaning schedule changed — notify current assignee only.
 * No-op when schedule unchanged or no assignee email.
 */
export async function notifyCleaningScheduleChanged(
  supabase: Sb,
  args: {
    orderId: string;
    assigneeEmail: string | null | undefined;
    preferredDate: string | null;
    timeSlot: string | null;
    workOrderId?: string | null;
    locale?: EmailTemplateLocale | string | null;
    /** Include schedule fingerprint in idempotency (suppress duplicate same schedule). */
    scheduleFingerprint: string;
  }
): Promise<ProducerResult> {
  const email = normalizeEmail(String(args.assigneeEmail ?? ''));
  if (!email) return { attempted: 0, queued: 0, suppressed: 0 };
  const ok = await enqueueSystemEvent(supabase, {
    eventKey: 'cleaning_schedule_updated',
    toEmail: email,
    entityId: `clean_sched:${args.orderId}:${args.scheduleFingerprint}:${email}`,
    locale: args.locale,
    payload: {
      order_id: args.orderId,
      work_order_id: args.workOrderId ?? null,
      preferred_date: args.preferredDate,
      time_slot: args.timeSlot,
      cabinet_path: '/admin',
    },
  });
  return { attempted: 1, queued: ok ? 1 : 0, suppressed: ok ? 0 : 1 };
}

/**
 * Cleaning reassignment — notify new and/or previous assignee when transition warrants.
 * Never notifies unrelated staff.
 */
export async function notifyCleaningAssignmentTransition(
  supabase: Sb,
  args: {
    workOrderId: string;
    newStaffEmail: string | null | undefined;
    previousStaffEmail: string | null | undefined;
    scheduledFor: string | null;
    locale?: EmailTemplateLocale | string | null;
  }
): Promise<ProducerResult> {
  const neu = normalizeEmail(String(args.newStaffEmail ?? ''));
  const prev = normalizeEmail(String(args.previousStaffEmail ?? ''));
  if (neu && neu === prev) {
    return { attempted: 0, queued: 0, suppressed: 0 };
  }
  let attempted = 0;
  let queued = 0;
  let suppressed = 0;
  const fingerprint = `${args.scheduledFor ?? 'none'}:${neu || 'none'}`;
  if (neu) {
    attempted += 1;
    const ok = await enqueueSystemEvent(supabase, {
      eventKey: 'cleaning_schedule_updated',
      toEmail: neu,
      entityId: `clean_assign:${args.workOrderId}:${fingerprint}:${neu}`,
      locale: args.locale,
      payload: {
        work_order_id: args.workOrderId,
        preferred_date: args.scheduledFor,
        time_slot: null,
        assignment: 'assigned',
        cabinet_path: '/admin',
      },
    });
    if (ok) queued += 1;
    else suppressed += 1;
  }
  if (prev && prev !== neu) {
    attempted += 1;
    const ok = await enqueueSystemEvent(supabase, {
      eventKey: 'cleaning_schedule_updated',
      toEmail: prev,
      entityId: `clean_unassign:${args.workOrderId}:${fingerprint}:${prev}`,
      locale: args.locale,
      payload: {
        work_order_id: args.workOrderId,
        preferred_date: args.scheduledFor,
        time_slot: null,
        assignment: 'unassigned',
        cabinet_path: '/admin',
      },
    });
    if (ok) queued += 1;
    else suppressed += 1;
  }
  return { attempted, queued, suppressed };
}

async function listStaffAdminEmails(supabase: Sb): Promise<string[]> {
  const { data, error } = await supabase
    .from('staff')
    .select('email, active')
    .eq('role', 'администрация');
  if (error || !data) return [];
  const out = new Set<string>();
  for (const row of data) {
    if ((row as { active?: boolean | null }).active === false) continue;
    const e = normalizeEmail(String((row as { email?: string | null }).email ?? ''));
    if (e) out.add(e);
  }
  return [...out];
}

/**
 * Ticket/property chat new message — authorized participants only.
 * Excludes sender. Aggregates rapid messages via 15-minute idempotency bucket.
 * Never includes message body (no content leak).
 */
export async function notifyTicketNewMessage(
  supabase: Sb,
  args: {
    propertyId: number;
    messageId: number | string;
    sender: 'uk' | 'owner' | 'guest' | string;
    senderEmail?: string | null;
    locale?: EmailTemplateLocale | string | null;
    nowMs?: number;
  }
): Promise<ProducerResult> {
  const senderNorm = normalizeEmail(String(args.senderEmail ?? ''));
  const bucket = ticketChatAggregationBucket(args.nowMs);
  const targets = new Set<string>();

  if (args.sender === 'uk') {
    for (const e of await listActiveOwnerEmails(supabase, args.propertyId)) {
      targets.add(e);
    }
  } else {
    // Owner/guest message → complex admins + co-owners (except sender).
    for (const e of await listStaffAdminEmails(supabase)) {
      targets.add(e);
    }
    for (const e of await listActiveOwnerEmails(supabase, args.propertyId)) {
      targets.add(e);
    }
  }

  if (senderNorm) targets.delete(senderNorm);

  let queued = 0;
  let suppressed = 0;
  for (const email of targets) {
    const ok = await enqueueSystemEvent(supabase, {
      eventKey: 'ticket_new_message',
      toEmail: email,
      propertyId: args.propertyId,
      entityId: `ticket_chat:${args.propertyId}:${email}:${bucket}`,
      locale: args.locale,
      payload: {
        property_id: args.propertyId,
        message_id: args.messageId,
        aggregation_bucket: bucket,
        // Intentionally omit message body / attachments.
        cabinet_path: args.sender === 'uk' ? '/account' : '/admin',
      },
    });
    if (ok) queued += 1;
    else suppressed += 1;
  }
  return { attempted: targets.size, queued, suppressed };
}

/** Ticket terminal status — notify request creator email only when present. */
export async function notifyTicketStatusDecided(
  supabase: Sb,
  args: {
    requestId: number;
    status: string;
    toEmail: string | null | undefined;
    propertyId?: number | null;
    locale?: EmailTemplateLocale | string | null;
  }
): Promise<ProducerResult> {
  const status = String(args.status ?? '').trim().toLowerCase();
  if (status !== 'выполнена' && status !== 'отклонена') {
    return { attempted: 0, queued: 0, suppressed: 0 };
  }
  const email = normalizeEmail(String(args.toEmail ?? ''));
  if (!email) return { attempted: 0, queued: 0, suppressed: 0 };
  const ok = await enqueueSystemEvent(supabase, {
    eventKey: 'ticket_status_decided',
    toEmail: email,
    propertyId: args.propertyId ?? null,
    entityId: `ticket:${args.requestId}:${status}`,
    locale: args.locale,
    payload: {
      request_id: args.requestId,
      status: args.status,
      property_id: args.propertyId ?? null,
    },
  });
  return { attempted: 1, queued: ok ? 1 : 0, suppressed: ok ? 0 : 1 };
}
