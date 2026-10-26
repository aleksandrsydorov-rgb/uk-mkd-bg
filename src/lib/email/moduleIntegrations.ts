/**
 * EML-4 — Email Core module integration matrix (12 business modules + shared core).
 * Rental Management excluded. Do not invent legally significant or financial mass email.
 */

export type EmailIntegrationStatus =
  | 'PASS'
  | 'IN_APP_ONLY'
  | 'INFORMATIONAL'
  | 'NEEDS_DECISION'
  | 'EXCLUDED';

export type EmailModuleIntegration = {
  moduleKey: string;
  label: string;
  status: EmailIntegrationStatus;
  events: string[];
  templates: string[];
  notes: string;
};

/** Approved + informational meeting + undecided coverage for Distribution R1.0 (no Rental). */
export const EMAIL_MODULE_INTEGRATIONS: readonly EmailModuleIntegration[] = [
  {
    moduleKey: 'property_book',
    label: 'Property Book',
    status: 'PASS',
    events: ['pb1_invite_create', 'pb1_invite_resend', 'pb1_invite_revoke_cancel'],
    templates: ['pb1_property_invite'],
    notes: 'Preserve PB1; mass blast stays link-batch. Invites are security_mandatory.',
  },
  {
    moduleKey: 'meetings',
    label: 'Meetings',
    status: 'INFORMATIONAL',
    events: ['meeting_published', 'meeting_registration_open'],
    templates: ['meeting_published', 'meeting_registration_open'],
    notes:
      'RC8+: informational enqueue when general_meeting enabled. Not ZUES legal notice. Sending remains OFF by default.',
  },
  {
    moduleKey: 'meters',
    label: 'Meters',
    status: 'PASS',
    events: ['meters_reading_accepted', 'meters_payment_recorded'],
    templates: ['meters_reading_accepted', 'meters_payment_recorded'],
    notes:
      'Owner-scoped water/electricity reading+payment producers. Admins not fanned out. Not debt.',
  },
  {
    moduleKey: 'uk_budget_expenses',
    label: 'UK Budget and Expenses',
    status: 'PASS',
    events: ['uk_expense_approved'],
    templates: ['uk_expense_approved'],
    notes: 'Digest-eligible admin notice on expense approve. Not a debt reminder.',
  },
  {
    moduleKey: 'internet',
    label: 'Internet',
    status: 'PASS',
    events: ['internet_subscription_changed'],
    templates: ['internet_subscription_changed'],
    notes:
      'Owner-scoped after enable/disable WO complete. Debt disconnect stays out of scope.',
  },
  {
    moduleKey: 'tickets_chat',
    label: 'Tickets and Chat',
    status: 'PASS',
    events: ['ticket_status_decided', 'ticket_new_message'],
    templates: ['ticket_status_decided', 'ticket_new_message'],
    notes:
      'Terminal status + aggregated new-message notices. Sender excluded; no chat body in email.',
  },
  {
    moduleKey: 'ownership_transfer',
    label: 'Ownership Transfer',
    status: 'PASS',
    events: ['ownership_change_*'],
    templates: ['ownership_change_*'],
    notes: 'DB notify → enqueue; access_revoked/invite_available security_mandatory.',
  },
  {
    moduleKey: 'residence_status',
    label: 'Residence Status',
    status: 'PASS',
    events: ['residence_status_changed'],
    templates: ['residence_status_changed'],
    notes: 'Owner-scoped occupancy status change. Distinct from UA.',
  },
  {
    moduleKey: 'cleaning',
    label: 'Cleaning',
    status: 'PASS',
    events: ['cleaning_schedule_updated'],
    templates: ['cleaning_schedule_updated'],
    notes:
      'Assigned staff notified on schedule/assignee change via admin_update_cleaning_order_schedule + assign_work_order.',
  },
  {
    moduleKey: 'support_fee',
    label: 'Support Fee',
    status: 'PASS',
    events: ['support_fee_assessment_posted', 'support_fee_payment_recorded'],
    templates: ['support_fee_assessment_posted', 'support_fee_payment_recorded'],
    notes: 'Owner-scoped assessment+payment. Not debt collection.',
  },
  {
    moduleKey: 'capital_repair',
    label: 'Capital Repair',
    status: 'PASS',
    events: ['capital_repair_assessment_posted', 'capital_repair_payment_recorded'],
    templates: ['capital_repair_assessment_posted', 'capital_repair_payment_recorded'],
    notes: 'Owner-scoped bulk assessment fan-out + payment. Not debt collection.',
  },
  {
    moduleKey: 'inventory',
    label: 'Inventory',
    status: 'PASS',
    events: ['inventory_assignment_changed'],
    templates: ['inventory_assignment_changed'],
    notes: 'Assigned staff only — not every stock movement.',
  },
  {
    moduleKey: 'rental_management',
    label: 'Rental Management',
    status: 'EXCLUDED',
    events: [],
    templates: [],
    notes: 'PAUSE — out of Release 1.0 Email Core scope.',
  },
] as const;

export const EMAIL_CROSS_CUTTING_INTEGRATIONS: readonly EmailModuleIntegration[] = [
  {
    moduleKey: 'user_activation',
    label: 'User Activation',
    status: 'PASS',
    events: ['ua_reminder'],
    templates: ['ua_*'],
    notes: 'Approved activation reminders.',
  },
  {
    moduleKey: 'email_test',
    label: 'Admin email test',
    status: 'PASS',
    events: ['email_test'],
    templates: ['email_test'],
    notes: 'Admin allowlisted controlled test enqueue only.',
  },
] as const;

export function emailIntegrationsNeedingDecision(): EmailModuleIntegration[] {
  return EMAIL_MODULE_INTEGRATIONS.filter((m) => m.status === 'NEEDS_DECISION');
}

export function emailIntegrationsReady(): EmailModuleIntegration[] {
  return [
    ...EMAIL_MODULE_INTEGRATIONS.filter(
      (m) =>
        m.status === 'PASS' || m.status === 'IN_APP_ONLY' || m.status === 'INFORMATIONAL'
    ),
    ...EMAIL_CROSS_CUTTING_INTEGRATIONS.filter((m) => m.status === 'PASS'),
  ];
}
