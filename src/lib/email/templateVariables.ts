/**
 * Declared template variables for Email Core (admin editor + render).
 * Keys are technical; labels are i18n message keys under admin.tplVar.*.
 */

import { EMAIL_EVENT_CATALOG } from '@/lib/email/eventCatalog';

export type TemplateVarId =
  | 'complex'
  | 'recipient_name'
  | 'apartment'
  | 'section'
  | 'amount'
  | 'period'
  | 'invite_link'
  | 'link'
  | 'event_kind'
  | 'reminder_type'
  | 'preferred_date'
  | 'time_slot'
  | 'schedule_hint';

export type TemplateVarDef = {
  id: TemplateVarId;
  /** i18n key: admin.tplVar.<id> */
  labelKey: string;
  /** Must be non-empty after substitution when the template text references it. */
  requiredWhenUsed?: boolean;
};

const VAR: Record<TemplateVarId, TemplateVarDef> = {
  complex: { id: 'complex', labelKey: 'admin.tplVarComplex' },
  recipient_name: { id: 'recipient_name', labelKey: 'admin.tplVarRecipientName' },
  apartment: { id: 'apartment', labelKey: 'admin.tplVarApartment' },
  section: { id: 'section', labelKey: 'admin.tplVarSection' },
  amount: { id: 'amount', labelKey: 'admin.tplVarAmount' },
  period: { id: 'period', labelKey: 'admin.tplVarPeriod' },
  invite_link: {
    id: 'invite_link',
    labelKey: 'admin.tplVarInviteLink',
    requiredWhenUsed: true,
  },
  link: { id: 'link', labelKey: 'admin.tplVarLink', requiredWhenUsed: true },
  event_kind: { id: 'event_kind', labelKey: 'admin.tplVarEventKind' },
  reminder_type: { id: 'reminder_type', labelKey: 'admin.tplVarReminderType' },
  preferred_date: { id: 'preferred_date', labelKey: 'admin.tplVarPreferredDate' },
  time_slot: { id: 'time_slot', labelKey: 'admin.tplVarTimeSlot' },
  schedule_hint: { id: 'schedule_hint', labelKey: 'admin.tplVarScheduleHint' },
};

const BY_TEMPLATE: Record<string, TemplateVarId[]> = {
  pb1_property_invite: ['complex', 'apartment', 'invite_link', 'recipient_name'],
  ua_nudge: ['complex', 'reminder_type', 'invite_link', 'recipient_name'],
  ownership_change_submitted: ['complex', 'apartment', 'event_kind', 'link'],
  ownership_change_approved: ['complex', 'apartment', 'event_kind', 'link'],
  ownership_change_access_revoked: ['complex', 'apartment', 'event_kind', 'link'],
  ownership_change_invite_available: ['complex', 'apartment', 'invite_link', 'event_kind'],
  ownership_change_cancelled: ['complex', 'apartment', 'event_kind', 'link'],
  ownership_change_admin_pending: ['complex', 'apartment', 'event_kind', 'link'],
  meeting_published: ['complex', 'link'],
  meeting_registration_open: ['complex', 'link'],
  ticket_status_decided: ['complex', 'apartment', 'event_kind', 'link'],
  ticket_new_message: ['complex', 'apartment', 'link'],
  meters_reading_accepted: ['complex', 'apartment', 'period', 'link'],
  meters_payment_recorded: ['complex', 'apartment', 'amount', 'period', 'link'],
  uk_expense_approved: ['complex', 'link'],
  internet_subscription_changed: ['complex', 'apartment', 'link'],
  residence_status_changed: ['complex', 'apartment', 'link'],
  cleaning_schedule_updated: ['complex', 'preferred_date', 'time_slot', 'schedule_hint', 'link'],
  support_fee_assessment_posted: ['complex', 'apartment', 'amount', 'period', 'link'],
  support_fee_payment_recorded: ['complex', 'apartment', 'amount', 'period', 'link'],
  capital_repair_assessment_posted: ['complex', 'apartment', 'amount', 'period', 'link'],
  capital_repair_payment_recorded: ['complex', 'apartment', 'amount', 'period', 'link'],
  inventory_assignment_changed: ['complex', 'link'],
  email_test: ['complex'],
  email_digest_daily: ['complex', 'link'],
};

/** Templates editable in Notifications → Templates (app Email Core only). */
export function listEditableTemplateKeys(): string[] {
  const keys = new Set<string>();
  for (const ev of EMAIL_EVENT_CATALOG) {
    if (ev.moduleKey === 'rental' || ev.moduleKey === 'rental_management') continue;
    keys.add(ev.templateKey);
  }
  return [...keys].sort();
}

export function variablesForTemplate(templateKey: string): TemplateVarDef[] {
  const key = templateKey.trim().toLowerCase();
  const ids = BY_TEMPLATE[key];
  if (ids) return ids.map((id) => VAR[id]);
  // Family fallbacks for keys not listed explicitly
  if (key.startsWith('pb1_')) return BY_TEMPLATE.pb1_property_invite.map((id) => VAR[id]);
  if (key.startsWith('ua_')) return BY_TEMPLATE.ua_nudge.map((id) => VAR[id]);
  if (key.startsWith('ownership_')) {
    return ['complex', 'apartment', 'event_kind', 'link', 'invite_link'].map((id) => VAR[id as TemplateVarId]);
  }
  if (key.startsWith('meeting_')) return BY_TEMPLATE.meeting_published.map((id) => VAR[id]);
  if (key.startsWith('ticket_')) return BY_TEMPLATE.ticket_status_decided.map((id) => VAR[id]);
  if (key.startsWith('cleaning_')) return BY_TEMPLATE.cleaning_schedule_updated.map((id) => VAR[id]);
  if (
    key.startsWith('meters_') ||
    key.startsWith('support_fee_') ||
    key.startsWith('capital_repair_')
  ) {
    return ['complex', 'apartment', 'amount', 'period', 'link'].map((id) => VAR[id as TemplateVarId]);
  }
  return [VAR.complex, VAR.link];
}

export function demoPayloadForTemplate(templateKey: string): Record<string, string> {
  const vars = variablesForTemplate(templateKey);
  const out: Record<string, string> = {
    complex: 'AMADEUS XI (пример)',
    recipient_name: 'Иван Пример',
    apartment: '12',
    section: 'A',
    amount: '42.50 EUR',
    period: '2026-11',
    invite_link: 'https://example.invalid/invite/demo',
    link: 'https://example.invalid/cabinet',
    event_kind: 'demo_event',
    reminder_type: 'nudge',
    preferred_date: '2026-11-20',
    time_slot: '09:00–12:00',
    schedule_hint: '2026-11-20 · 09:00–12:00',
  };
  const allowed = new Set(vars.map((v) => v.id));
  for (const k of Object.keys(out)) {
    if (!allowed.has(k as TemplateVarId)) delete out[k];
  }
  // Always keep complex for footer context
  out.complex = out.complex || 'AMADEUS XI (пример)';
  return out;
}

export const TEMPLATE_VAR_PATTERN = /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g;

export function findTemplateVariables(text: string): string[] {
  const found = new Set<string>();
  const re = new RegExp(TEMPLATE_VAR_PATTERN.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    found.add(m[1]);
  }
  return [...found];
}

export function substituteTemplateVariables(
  text: string,
  values: Record<string, string>,
  opts?: { allowed?: ReadonlySet<string> }
): { text: string; unresolved: string[]; unknown: string[] } {
  const unresolved: string[] = [];
  const unknown: string[] = [];
  const allowed = opts?.allowed;
  const out = text.replace(TEMPLATE_VAR_PATTERN, (_full, name: string) => {
    if (allowed && !allowed.has(name)) {
      unknown.push(name);
      return `{{${name}}}`;
    }
    const v = values[name];
    if (v == null || String(v).trim() === '') {
      unresolved.push(name);
      return `{{${name}}}`;
    }
    return String(v);
  });
  return { text: out, unresolved: [...new Set(unresolved)], unknown: [...new Set(unknown)] };
}
