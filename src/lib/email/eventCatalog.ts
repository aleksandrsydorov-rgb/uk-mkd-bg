/**
 * EML-3 — Typed centralized email event catalog (12 modules + cross-cut).
 * Source of truth for classification; preferences/UI and policy engine consume this.
 * Rental Management excluded. NEEDS_DECISION events have no active producers.
 */

import type { EmailTemplateLocale } from '@/lib/emailCore';

export type NotificationImportance = 'security_mandatory' | 'important' | 'informational';

export type NotificationDeliveryHint =
  | 'immediate'
  | 'digest_eligible'
  | 'immediate_or_digest';

export type EventProducerStatus =
  | 'wired'
  | 'informational_meeting'
  | 'needs_decision'
  | 'excluded';

export type NotificationRecipientKind =
  | 'invitee_email'
  | 'owner_email'
  | 'affected_transfer_emails'
  | 'meeting_participants'
  | 'ticket_participants'
  | 'staff_admins'
  | 'self'
  | 'undecided';

export type EmailEventDefinition = {
  eventKey: string;
  moduleKey: string;
  /** Maps to Email Core module_key / consumer where applicable */
  emailModuleKey:
    | 'pb1_invite'
    | 'user_activation'
    | 'pkg_xfer'
    | 'meeting'
    | 'email_test'
    | 'system';
  templateKey: string;
  importance: NotificationImportance;
  delivery: NotificationDeliveryHint;
  recipientKind: NotificationRecipientKind;
  producerStatus: EventProducerStatus;
  /** When false, complex default toggle starts OFF (rare). Optional events default ON. */
  defaultEnabled: boolean;
  /** High-frequency optional — subject to recipient throttle when not mandatory. */
  highFrequency?: boolean;
  access: string;
  notes: string;
};

/** Suggested admin personal mode (UI default suggestion only — never auto-migrates live prefs). */
export const SUGGESTED_ADMIN_NOTIFICATION_MODE = 'IMPORTANT_ONLY' as const;

/** Default mode when user has no prefs row. */
export const DEFAULT_OWNER_STAFF_NOTIFICATION_MODE = 'ALL' as const;

export const NOTIFICATION_MODES = [
  'ALL',
  'IMPORTANT_ONLY',
  'DAILY_DIGEST',
  'CUSTOM',
  'INFORMATIONAL_OFF',
] as const;

export type NotificationMode = (typeof NOTIFICATION_MODES)[number];

export const EMAIL_EVENT_CATALOG: readonly EmailEventDefinition[] = [
  // ——— Property Book ———
  {
    eventKey: 'pb1_invite_create',
    moduleKey: 'property_book',
    emailModuleKey: 'pb1_invite',
    templateKey: 'pb1_property_invite',
    importance: 'security_mandatory',
    delivery: 'immediate',
    recipientKind: 'invitee_email',
    producerStatus: 'wired',
    defaultEnabled: true,
    access: 'book_admin',
    notes: 'Access invite — mandatory security; cannot be disabled in prefs.',
  },
  {
    eventKey: 'pb1_invite_resend',
    moduleKey: 'property_book',
    emailModuleKey: 'pb1_invite',
    templateKey: 'pb1_property_invite',
    importance: 'security_mandatory',
    delivery: 'immediate',
    recipientKind: 'invitee_email',
    producerStatus: 'wired',
    defaultEnabled: true,
    access: 'book_admin',
    notes: 'Access invite resend — mandatory security.',
  },

  // ——— User Activation (cross-cut) ———
  {
    eventKey: 'ua_reminder',
    moduleKey: 'user_activation',
    emailModuleKey: 'user_activation',
    templateKey: 'ua_nudge',
    importance: 'important',
    delivery: 'immediate_or_digest',
    recipientKind: 'owner_email',
    producerStatus: 'wired',
    defaultEnabled: true,
    access: 'book_admin_or_system',
    notes: 'Activation reminder — important, not security-mandatory.',
  },

  // ——— Ownership Transfer ———
  {
    eventKey: 'ownership_change_submitted',
    moduleKey: 'ownership_transfer',
    emailModuleKey: 'pkg_xfer',
    templateKey: 'ownership_change_submitted',
    importance: 'important',
    delivery: 'immediate',
    recipientKind: 'affected_transfer_emails',
    producerStatus: 'wired',
    defaultEnabled: true,
    access: 'transfer_participants_or_admin',
    notes: 'Material ownership workflow.',
  },
  {
    eventKey: 'ownership_change_approved',
    moduleKey: 'ownership_transfer',
    emailModuleKey: 'pkg_xfer',
    templateKey: 'ownership_change_approved',
    importance: 'important',
    delivery: 'immediate',
    recipientKind: 'affected_transfer_emails',
    producerStatus: 'wired',
    defaultEnabled: true,
    access: 'transfer_participants_or_admin',
    notes: 'Material ownership approval.',
  },
  {
    eventKey: 'ownership_change_access_revoked',
    moduleKey: 'ownership_transfer',
    emailModuleKey: 'pkg_xfer',
    templateKey: 'ownership_change_access_revoked',
    importance: 'security_mandatory',
    delivery: 'immediate',
    recipientKind: 'affected_transfer_emails',
    producerStatus: 'wired',
    defaultEnabled: true,
    access: 'transfer_participants_or_admin',
    notes: 'Access revocation — mandatory security.',
  },
  {
    eventKey: 'ownership_change_invite_available',
    moduleKey: 'ownership_transfer',
    emailModuleKey: 'pkg_xfer',
    templateKey: 'ownership_change_invite_available',
    importance: 'security_mandatory',
    delivery: 'immediate',
    recipientKind: 'affected_transfer_emails',
    producerStatus: 'wired',
    defaultEnabled: true,
    access: 'transfer_participants_or_admin',
    notes: 'New access invite after transfer — mandatory security.',
  },
  {
    eventKey: 'ownership_change_cancelled',
    moduleKey: 'ownership_transfer',
    emailModuleKey: 'pkg_xfer',
    templateKey: 'ownership_change_cancelled',
    importance: 'important',
    delivery: 'immediate_or_digest',
    recipientKind: 'affected_transfer_emails',
    producerStatus: 'wired',
    defaultEnabled: true,
    access: 'transfer_participants_or_admin',
    notes: 'Transfer cancelled.',
  },
  {
    eventKey: 'ownership_change_admin_pending',
    moduleKey: 'ownership_transfer',
    emailModuleKey: 'pkg_xfer',
    templateKey: 'ownership_change_admin_pending',
    importance: 'important',
    delivery: 'immediate',
    recipientKind: 'staff_admins',
    producerStatus: 'wired',
    defaultEnabled: true,
    access: 'book_admin',
    notes: 'Admin action required on transfer.',
  },

  // ——— Meetings (informational only — never replaces ZUES legal notice) ———
  {
    eventKey: 'meeting_published',
    moduleKey: 'meetings',
    emailModuleKey: 'meeting',
    templateKey: 'meeting_published',
    importance: 'informational',
    delivery: 'digest_eligible',
    recipientKind: 'owner_email',
    producerStatus: 'wired',
    defaultEnabled: true,
    access: 'active_owners',
    notes:
      'Informational notice when a meeting is published in-app. Not a ZUES legal summons.',
  },
  {
    eventKey: 'meeting_registration_open',
    moduleKey: 'meetings',
    emailModuleKey: 'meeting',
    templateKey: 'meeting_registration_open',
    importance: 'informational',
    delivery: 'digest_eligible',
    recipientKind: 'owner_email',
    producerStatus: 'wired',
    defaultEnabled: true,
    access: 'active_owners',
    notes: 'Informational registration window notice — not legal service.',
  },

  // ——— Tickets (confirmed lifecycle only where semantics clear) ———
  {
    eventKey: 'ticket_status_decided',
    moduleKey: 'tickets_chat',
    emailModuleKey: 'system',
    templateKey: 'ticket_status_decided',
    importance: 'important',
    delivery: 'immediate_or_digest',
    recipientKind: 'ticket_participants',
    producerStatus: 'wired',
    defaultEnabled: true,
    access: 'ticket_participants',
    notes: 'Terminal statuses выполненa/отклонена only — not chat noise.',
  },
  {
    eventKey: 'ticket_new_message',
    moduleKey: 'tickets_chat',
    emailModuleKey: 'system',
    templateKey: 'ticket_new_message',
    importance: 'informational',
    delivery: 'digest_eligible',
    recipientKind: 'ticket_participants',
    producerStatus: 'wired',
    defaultEnabled: true,
    highFrequency: true,
    access: 'ticket_participants',
    notes:
      'Property chat participants; sender excluded; 15-min aggregation + throttle. No message body in email.',
  },

  {
    eventKey: 'meters_reading_accepted',
    moduleKey: 'meters',
    emailModuleKey: 'system',
    templateKey: 'meters_reading_accepted',
    importance: 'informational',
    delivery: 'digest_eligible',
    recipientKind: 'owner_email',
    producerStatus: 'wired',
    defaultEnabled: true,
    highFrequency: true,
    access: 'property_owner',
    notes: 'Owner-scoped reading+charge ack. Admins not fanned out.',
  },
  {
    eventKey: 'meters_payment_recorded',
    moduleKey: 'meters',
    emailModuleKey: 'system',
    templateKey: 'meters_payment_recorded',
    importance: 'informational',
    delivery: 'digest_eligible',
    recipientKind: 'owner_email',
    producerStatus: 'wired',
    defaultEnabled: true,
    access: 'property_owner',
    notes: 'Owner-scoped payment receipt. Not debt collection.',
  },
  {
    eventKey: 'uk_expense_approved',
    moduleKey: 'uk_budget_expenses',
    emailModuleKey: 'system',
    templateKey: 'uk_expense_approved',
    importance: 'informational',
    delivery: 'digest_eligible',
    recipientKind: 'staff_admins',
    producerStatus: 'wired',
    defaultEnabled: true,
    access: 'finance_staff',
    notes: 'One digest-eligible notice per admin. Not a debt reminder.',
  },
  {
    eventKey: 'internet_subscription_changed',
    moduleKey: 'internet',
    emailModuleKey: 'system',
    templateKey: 'internet_subscription_changed',
    importance: 'informational',
    delivery: 'digest_eligible',
    recipientKind: 'owner_email',
    producerStatus: 'wired',
    defaultEnabled: true,
    access: 'property_owner',
    notes: 'Owner-scoped after connect/disconnect WO complete. Not debt disconnect.',
  },
  {
    eventKey: 'residence_status_changed',
    moduleKey: 'residence_status',
    emailModuleKey: 'system',
    templateKey: 'residence_status_changed',
    importance: 'important',
    delivery: 'immediate_or_digest',
    recipientKind: 'owner_email',
    producerStatus: 'wired',
    defaultEnabled: true,
    access: 'property_owner_or_admin',
    notes: 'Owner-scoped occupancy change. Distinct from UA.',
  },
  {
    eventKey: 'cleaning_schedule_updated',
    moduleKey: 'cleaning',
    emailModuleKey: 'system',
    templateKey: 'cleaning_schedule_updated',
    importance: 'informational',
    delivery: 'digest_eligible',
    recipientKind: 'staff_admins',
    producerStatus: 'wired',
    defaultEnabled: true,
    access: 'assigned_cleaning_staff',
    notes:
      'Assigned cleaner only when schedule/assignee changes. No-op updates suppressed.',
  },
  {
    eventKey: 'support_fee_assessment_posted',
    moduleKey: 'support_fee',
    emailModuleKey: 'system',
    templateKey: 'support_fee_assessment_posted',
    importance: 'informational',
    delivery: 'digest_eligible',
    recipientKind: 'owner_email',
    producerStatus: 'wired',
    defaultEnabled: true,
    access: 'property_owner',
    notes: 'Owner-scoped assessment notice. Not debt collection.',
  },
  {
    eventKey: 'support_fee_payment_recorded',
    moduleKey: 'support_fee',
    emailModuleKey: 'system',
    templateKey: 'support_fee_payment_recorded',
    importance: 'informational',
    delivery: 'digest_eligible',
    recipientKind: 'owner_email',
    producerStatus: 'wired',
    defaultEnabled: true,
    access: 'property_owner',
    notes: 'Owner-scoped payment receipt. Not debt reminder.',
  },
  {
    eventKey: 'capital_repair_assessment_posted',
    moduleKey: 'capital_repair',
    emailModuleKey: 'system',
    templateKey: 'capital_repair_assessment_posted',
    importance: 'informational',
    delivery: 'digest_eligible',
    recipientKind: 'owner_email',
    producerStatus: 'wired',
    defaultEnabled: true,
    access: 'property_owner',
    notes: 'Owner-scoped assessment/charge notice. Not debt collection.',
  },
  {
    eventKey: 'capital_repair_payment_recorded',
    moduleKey: 'capital_repair',
    emailModuleKey: 'system',
    templateKey: 'capital_repair_payment_recorded',
    importance: 'informational',
    delivery: 'digest_eligible',
    recipientKind: 'owner_email',
    producerStatus: 'wired',
    defaultEnabled: true,
    access: 'property_owner',
    notes: 'Owner-scoped payment receipt.',
  },
  {
    eventKey: 'inventory_assignment_changed',
    moduleKey: 'inventory',
    emailModuleKey: 'system',
    templateKey: 'inventory_assignment_changed',
    importance: 'informational',
    delivery: 'digest_eligible',
    recipientKind: 'staff_admins',
    producerStatus: 'wired',
    defaultEnabled: true,
    access: 'inventory_staff',
    notes: 'Assigned staff only — not every stock movement.',
  },

  // ——— Admin test ———
  {
    eventKey: 'email_test',
    moduleKey: 'email_test',
    emailModuleKey: 'email_test',
    templateKey: 'email_test',
    importance: 'informational',
    delivery: 'immediate',
    recipientKind: 'self',
    producerStatus: 'wired',
    defaultEnabled: true,
    access: 'book_admin',
    notes: 'Controlled admin test — not suppressible by personal INFORMATIONAL_OFF when admin enqueues.',
  },
] as const;

const BY_KEY = new Map(EMAIL_EVENT_CATALOG.map((e) => [e.eventKey, e]));

export function getEmailEvent(eventKey: string): EmailEventDefinition | undefined {
  return BY_KEY.get(eventKey);
}

export function listEventsForModule(moduleKey: string): EmailEventDefinition[] {
  return EMAIL_EVENT_CATALOG.filter((e) => e.moduleKey === moduleKey);
}

export function catalogModuleKeys(): string[] {
  // R1-MT-HIDE: Meetings not offered in notification preference / policy UI.
  return [
    ...new Set(
      EMAIL_EVENT_CATALOG.map((e) => e.moduleKey).filter(
        (k) => k !== 'meetings' && k !== 'meeting',
      ),
    ),
  ];
}

/** Map legacy template / ownership event_kind → catalog event key. */
export function resolveEventKeyFromEnqueue(opts: {
  moduleKey: string;
  templateKey: string;
  payload?: Record<string, unknown> | null;
}): string | null {
  const template = String(opts.templateKey ?? '').trim().toLowerCase();
  const kind = String(
    opts.payload?.event_kind ?? opts.payload?.eventKind ?? opts.payload?.reminderType ?? ''
  )
    .trim()
    .toLowerCase();

  if (opts.moduleKey === 'pb1_invite' || template.startsWith('pb1_')) {
    return kind === 'resend' ? 'pb1_invite_resend' : 'pb1_invite_create';
  }
  if (opts.moduleKey === 'user_activation' || template.startsWith('ua_')) {
    return 'ua_reminder';
  }
  if (opts.moduleKey === 'pkg_xfer' || template.includes('ownership') || template.includes('xfer')) {
    const mapped = `ownership_change_${kind || 'submitted'}`;
    if (BY_KEY.has(mapped)) return mapped;
    return 'ownership_change_submitted';
  }
  if (opts.moduleKey === 'meeting' || template.startsWith('meeting_')) {
    if (template.includes('registration')) return 'meeting_registration_open';
    return 'meeting_published';
  }
  if (opts.moduleKey === 'email_test' || template.startsWith('email_test')) {
    return 'email_test';
  }
  if (BY_KEY.has(template)) return template;
  return null;
}

export function isSecurityMandatory(eventKey: string): boolean {
  return getEmailEvent(eventKey)?.importance === 'security_mandatory';
}

export function eventLabelFallback(eventKey: string, locale: EmailTemplateLocale): string {
  const ev = getEmailEvent(eventKey);
  if (!ev) return eventKey;
  if (locale === 'bg') return ev.eventKey;
  return ev.eventKey;
}
