/** Meeting Core helpers (UX). Legal writes stay in RPCs. */

import type { Translate } from '@/i18n/translate';

export const MEETING_LEGAL_STATES = [
  'DRAFT',
  'PRECHECK',
  'SCHEDULED',
  'AGENDA_READY',
  'INVITATION_READY',
  'INVITATION_LOCKED',
  'INVITATION_POSTED',
  'NOTIFICATION_RUNNING',
  'WAITING_FOR_MEETING',
  'CHECK_IN_OPEN',
  'VOTING_SNAPSHOT_LOCKED',
  'QUORUM_CHECK',
  'MEETING_IN_PROGRESS',
  'ADJOURNED_1_HOUR',
  'ADJOURNED_NEXT_SESSION',
  'MEETING_FINISHED',
  'ABSENTEE_VOTING',
  'PROTOCOL_DRAFT',
  'PROTOCOL_SIGNING',
  'PROTOCOL_SIGNED',
  'PROTOCOL_NOTICE_POSTED',
  'CHALLENGE_WINDOW',
  'POST_ELECTION_GOVERNANCE',
  'MUNICIPALITY_FILING',
  'GOVERNANCE_HANDOVER',
  'CLOSED',
  'CANCELLED',
  'DISPUTED',
  'LEGAL_HOLD',
] as const;

export type MeetingLegalState = (typeof MEETING_LEGAL_STATES)[number];

export const MEETING_TYPES = [
  'REPORTING',
  'REPORTING_ELECTION',
  'EXTRAORDINARY',
  'URGENT',
] as const;

export type MeetingType = (typeof MEETING_TYPES)[number];

export const DEFAULT_RULESET_CODE = 'BG_ZUES_2026_09';

/** Mandatory agenda rows that should appear in every / reporting meetings. */
export type MandatoryAgendaTemplate = {
  key: string;
  title: string;
  description?: string;
  decision_category: string;
  majority_rule: string;
  forTypes: ReadonlyArray<MeetingType | '*'>;
};

export const MANDATORY_AGENDA_TEMPLATES: MandatoryAgendaTemplate[] = [
  {
    key: 'chair',
    title: 'Потвърждаване на председателстващия',
    description: 'Задължителна процедурна точка: кой ръководи общото събрание.',
    decision_category: 'procedural',
    majority_rule: 'more_than_50_represented_ideal_parts',
    forTypes: ['*'],
  },
  {
    key: 'secretary',
    title: 'Избор на протоколчик',
    description: 'Задължителна процедурна точка: лице, което води протокола.',
    decision_category: 'procedural',
    majority_rule: 'more_than_50_represented_ideal_parts',
    forTypes: ['*'],
  },
  {
    key: 'management_report',
    title: 'Отчет на управлението',
    decision_category: 'report',
    majority_rule: 'more_than_50_represented_ideal_parts',
    forTypes: ['REPORTING', 'REPORTING_ELECTION'],
  },
  {
    key: 'budget_report',
    title: 'Отчет за изпълнение на бюджета',
    decision_category: 'budget_report',
    majority_rule: 'more_than_50_represented_ideal_parts',
    forTypes: ['REPORTING', 'REPORTING_ELECTION'],
  },
  {
    key: 'control_report',
    title: 'Отчет на контролния орган',
    decision_category: 'control_report',
    majority_rule: 'more_than_50_represented_ideal_parts',
    forTypes: ['REPORTING', 'REPORTING_ELECTION'],
  },
  {
    key: 'work_plan',
    title: 'План за работа',
    decision_category: 'work_plan',
    majority_rule: 'more_than_50_represented_ideal_parts',
    forTypes: ['REPORTING', 'REPORTING_ELECTION'],
  },
  {
    key: 'budget_approval',
    title: 'Приемане на бюджет',
    decision_category: 'budget_approval',
    majority_rule: 'more_than_50_all_ideal_parts',
    forTypes: ['REPORTING', 'REPORTING_ELECTION'],
  },
  {
    key: 'mgmt_model',
    title: 'Модел на управление',
    decision_category: 'election_management',
    majority_rule: 'more_than_50_all_ideal_parts',
    forTypes: ['REPORTING_ELECTION'],
  },
  {
    key: 'mgmt_election',
    title: 'Избор на управител / УС',
    decision_category: 'election_management',
    majority_rule: 'more_than_50_all_ideal_parts',
    forTypes: ['REPORTING_ELECTION'],
  },
  {
    key: 'control_model',
    title: 'Модел на контрол',
    decision_category: 'election_control',
    majority_rule: 'more_than_50_all_ideal_parts',
    forTypes: ['REPORTING_ELECTION'],
  },
  {
    key: 'control_election',
    title: 'Избор на контролен орган',
    decision_category: 'election_control',
    majority_rule: 'more_than_50_all_ideal_parts',
    forTypes: ['REPORTING_ELECTION'],
  },
];

export function mandatoryAgendaForType(meetingType: string | null | undefined): MandatoryAgendaTemplate[] {
  const type = (meetingType ?? 'EXTRAORDINARY').toUpperCase() as MeetingType | string;
  return MANDATORY_AGENDA_TEMPLATES.filter(
    (row) => row.forTypes.includes('*') || row.forTypes.includes(type as MeetingType),
  );
}

export function isMandatoryAgendaCategory(category: string | null | undefined) {
  if (!category) return false;
  return MANDATORY_AGENDA_TEMPLATES.some((row) => row.decision_category === category)
    || category === 'procedural';
}

/** Election slot kinds used for invitation candidates (owners only). */
export const MEETING_ELECTION_TYPES = [
  'meeting_chair',
  'meeting_secretary',
  'controller',
  'management_board',
  'control_board',
  'manager',
] as const;

export type MeetingElectionType = (typeof MEETING_ELECTION_TYPES)[number];

export type ElectionSlotKind = 'fixed3' | 'board';

export type ElectionSlotDef = {
  electionType: MeetingElectionType;
  templateKey: string;
  kind: ElectionSlotKind;
  /** Agenda title matched in DB (Bulgarian canon). */
  agendaTitle: string;
};

/** Map mandatory agenda template keys → election_type / slot model. */
export const ELECTION_SLOTS_BY_TEMPLATE: Record<string, ElectionSlotDef> = {
  chair: {
    electionType: 'meeting_chair',
    templateKey: 'chair',
    kind: 'fixed3',
    agendaTitle: 'Потвърждаване на председателстващия',
  },
  secretary: {
    electionType: 'meeting_secretary',
    templateKey: 'secretary',
    kind: 'fixed3',
    agendaTitle: 'Избор на протоколчик',
  },
  control_election: {
    electionType: 'controller',
    templateKey: 'control_election',
    kind: 'fixed3',
    agendaTitle: 'Избор на контролен орган',
  },
  mgmt_election: {
    electionType: 'management_board',
    templateKey: 'mgmt_election',
    kind: 'board',
    agendaTitle: 'Избор на управител / УС',
  },
};

export function electionTypeForTemplateKey(key: string): MeetingElectionType | null {
  return ELECTION_SLOTS_BY_TEMPLATE[key]?.electionType ?? null;
}

export function templateKeyForElectionType(electionType: string): string | null {
  const hit = Object.values(ELECTION_SLOTS_BY_TEMPLATE).find((s) => s.electionType === electionType);
  return hit?.templateKey ?? null;
}

/** Slots that need candidates given the current agenda titles. */
export function electionSlotsPresentOnAgenda(
  agenda: ReadonlyArray<{ title?: string | null }>,
): ElectionSlotDef[] {
  const titles = new Set(
    agenda.map((a) => (a.title ?? '').trim().toLowerCase()).filter(Boolean),
  );
  return Object.values(ELECTION_SLOTS_BY_TEMPLATE).filter((slot) =>
    titles.has(slot.agendaTitle.trim().toLowerCase()),
  );
}

export type MeetingElectionReady = {
  ready: boolean;
  missing: string[];
};

export function parseMeetingElectionReady(raw: unknown): MeetingElectionReady {
  if (!raw || typeof raw !== 'object') return { ready: false, missing: ['unknown'] };
  const obj = raw as { ready?: unknown; missing?: unknown };
  const missing = Array.isArray(obj.missing)
    ? obj.missing.map((x) => String(x))
    : [];
  return { ready: obj.ready === true, missing };
}

export function matchesMandatoryTemplate(
  item: { title?: string | null; decision_category?: string | null },
  template: MandatoryAgendaTemplate,
) {
  const title = (item.title ?? '').trim().toLowerCase();
  if (title && title === template.title.trim().toLowerCase()) return true;
  // Shared categories (e.g. procedural) are not unique — title match only.
  if (template.decision_category === 'procedural') return false;
  return Boolean(item.decision_category) && item.decision_category === template.decision_category;
}

export function isMandatoryAgendaItem(
  item: { title?: string | null; decision_category?: string | null },
  meetingType?: string | null,
) {
  return mandatoryAgendaForType(meetingType).some((template) => matchesMandatoryTemplate(item, template));
}

/** UI label for a template key; falls back to Bulgarian canon title stored in DB. */
export function labelMandatoryAgendaTemplate(
  key: string,
  t: (key: string, params?: Record<string, string>) => string,
): string {
  const i18nKey = `docs.agendaTpl_${key}`;
  const labeled = t(i18nKey);
  if (labeled && labeled !== i18nKey) return labeled;
  return MANDATORY_AGENDA_TEMPLATES.find((row) => row.key === key)?.title ?? key;
}

export type MeetingCoreFlags = {
  legal_state?: string | null;
  meeting_type?: string | null;
  ownership_drift_alert?: boolean | null;
  check_in_blocked_reason?: string | null;
  invitation_locked_at?: string | null;
  ruleset_id?: string | null;
  show_live_results?: boolean | null;
  hybrid_house_rules_ok?: boolean | null;
  filing_regime?: string | null;
  filing_status?: string | null;
};

export function isCheckInBlocked(m: MeetingCoreFlags) {
  return Boolean(m.check_in_blocked_reason) || m.ownership_drift_alert === true;
}

export function labelLegalState(state: string | null | undefined, t?: Translate) {
  if (!state) return '—';
  const key = `docs.mcState_${state}` as const;
  if (t) {
    const translated = t(key);
    if (translated !== key) return translated;
  }
  return state.replaceAll('_', ' ');
}

export function labelMeetingType(type: string | null | undefined, t?: Translate) {
  if (!type) return '—';
  const key = `docs.mcType_${type}` as const;
  if (t) {
    const translated = t(key);
    if (translated !== key) return translated;
  }
  return type.replaceAll('_', ' ');
}

export type InvitationAgendaItem = {
  position: number;
  title: string;
  description?: string | null;
  proposed_decision_text?: string | null;
};

export type InvitationDraftInput = {
  title: string;
  meeting_date: string;
  meeting_time?: string | null;
  location?: string | null;
  meeting_mode?: string | null;
  is_urgent?: boolean | null;
  meeting_type?: string | null;
  online_meeting_url?: string | null;
  agenda: InvitationAgendaItem[];
};

function indentBlock(text: string, prefix = '   '): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line, idx, arr) => !(line.trim() === '' && (idx === 0 || idx === arr.length - 1)))
    .map((line) => `${prefix}${line}`);
}

/** BG master invitation text assembled from meeting fields + agenda. */
export function buildInvitationDraft(input: InvitationDraftInput): { title: string; body: string; missing: string[] } {
  const title = (input.title || 'Общо събрание').trim();
  const missing: string[] = [];
  if (!input.meeting_date) missing.push('date');
  if (!input.location?.trim()) missing.push('place');
  if (input.agenda.length === 0) missing.push('agenda');

  const time = input.meeting_time?.slice(0, 5) || '—';
  const place = input.location?.trim() || '—';
  const mode =
    input.meeting_mode === 'hybrid'
      ? 'Хибридно (присъствено + онлайн)'
      : 'Присъствено';
  const typeLabel =
    input.meeting_type === 'REPORTING_ELECTION'
      ? 'Отчетно-изборно'
      : input.meeting_type === 'REPORTING'
        ? 'Отчетно'
        : input.meeting_type === 'URGENT'
          ? 'Спешно'
          : 'Извънредно';

  const lines: string[] = [
    'ПОКАНА',
    `за ${input.is_urgent ? 'спешно ' : ''}общо събрание на собствениците`,
    '',
    `Относно: ${title}`,
    `Вид: ${typeLabel}`,
    `Дата: ${input.meeting_date || '—'}`,
    `Час: ${time}`,
    `Място: ${place}`,
    `Формат: ${mode}`,
  ];

  if (input.meeting_mode === 'hybrid' && input.online_meeting_url?.trim()) {
    lines.push(`Онлайн връзка: ${input.online_meeting_url.trim()}`);
  }

  lines.push('', 'Дневен ред:');
  if (input.agenda.length === 0) {
    lines.push('— (добавете точки от раздела „Повестка“)');
  } else {
    const sorted = [...input.agenda].sort((a, b) => a.position - b.position);
    for (const item of sorted) {
      const clean = item.title.trim().replace(new RegExp(`^${item.position}[.)]\\s+`), '');
      lines.push(`${item.position}. ${clean}`);
      if (item.description?.trim()) {
        lines.push(...indentBlock(item.description.trim()));
      }
      if (item.proposed_decision_text?.trim()) {
        lines.push(`${' '.repeat(3)}Предложение за решение:`);
        lines.push(...indentBlock(item.proposed_decision_text.trim(), '      '));
      }
      lines.push('');
    }
    if (lines[lines.length - 1] === '') lines.pop();
  }

  lines.push(
    '',
    'Важни бележки (задължителни по поканата):',
    '1. Собствениците могат да участват лично или чрез пълномощник съгласно ЗУЕС (макс. 3 упълномощителя на един представител).',
    '2. При липса на кворум събранието може да продължи по правилата за следващ час / следващ ден според приетия процедурен ред.',
    '3. Решенията се вземат с мнозинствата, посочени към всеки пункт от дневния ред.',
    '',
    'Моля, присъствайте лично или упълномощете представител съгласно ЗУЕС.',
    'Тази покана е изготвена автоматично от данните на събранието и дневния ред.',
  );

  return { title, body: lines.join('\n'), missing };
}

/** Printable posting protocol: admin prints, 3 owners sign, then upload scan + photo. */
export function buildInvitationPostingProtocolHtml(input: {
  title: string;
  meeting_date?: string | null;
  meeting_time?: string | null;
  location?: string | null;
  posted_place?: string | null;
  is_urgent?: boolean | null;
}): string {
  const title = (input.title || 'Общо събрание').trim();
  const date = input.meeting_date || '______________';
  const time = input.meeting_time?.slice(0, 5) || '____';
  const location = input.location?.trim() || '______________';
  const board = input.posted_place?.trim() || '______________________________';
  const noticeDays = input.is_urgent ? '24 часа' : '7 дни';
  const escape = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><style>
    body{font-family:Georgia,'Times New Roman',serif;color:#1a1a1a;padding:36px 48px;line-height:1.45;font-size:14px}
    h1{font-size:18px;text-align:center;margin:0 0 8px;letter-spacing:.04em;text-transform:uppercase}
    h2{font-size:15px;text-align:center;margin:0 0 24px;font-weight:normal}
    p{margin:0 0 12px}
    .meta{margin:16px 0 20px}
    .meta div{margin:4px 0}
    .box{border:1px solid #333;padding:14px 16px;margin:18px 0}
    .sigs{margin-top:28px}
    .sig{margin:22px 0;display:flex;justify-content:space-between;gap:24px}
    .sig span{border-top:1px solid #333;padding-top:4px;min-width:42%;font-size:12px}
    .foot{margin-top:32px;font-size:12px;color:#444}
  </style></head><body>
    <h1>Протокол</h1>
    <h2>за поставяне на поканата за общо събрание</h2>
    <div class="meta">
      <div><strong>Събрание:</strong> ${escape(title)}</div>
      <div><strong>Дата / час:</strong> ${escape(date)} · ${escape(time)}</div>
      <div><strong>Място на събранието:</strong> ${escape(location)}</div>
    </div>
    <p>Долуподписаните собственици удостоверяваме, че поканата за горепосоченото общо събрание е поставена на видно място в комплекса:</p>
    <div class="box"><strong>Място на поставяне:</strong> ${escape(board)}</div>
    <p>Поставянето е извършено в съответствие с изискванията на ЗУЕС (срок преди събранието: най-малко ${escape(noticeDays)}).</p>
    <p>Настоящият протокол се подписва от трима собственици и се прилага към документацията на събранието заедно с фотодоказателство за поставянето.</p>
    <div class="sigs">
      <div class="sig"><span>1. Име, ап. № / подпис</span><span>Дата</span></div>
      <div class="sig"><span>2. Име, ап. № / подпис</span><span>Дата</span></div>
      <div class="sig"><span>3. Име, ап. № / подпис</span><span>Дата</span></div>
    </div>
    <p class="foot">Документът е формиран автоматично от системата за управление на сградата. След подписване качете сканирания PDF и фотоотчет в раздела „Покана“.</p>
  </body></html>`;
}

export type InvitationDispatchReady = {
  ok: boolean;
  locked: boolean;
  posted: boolean;
  has_protocol: boolean;
  has_photo: boolean;
  posting_complete: boolean;
  can_dispatch: boolean;
  invitation_sent_count: number;
  legal_state: string;
};

export function parseInvitationDispatchReady(raw: unknown): InvitationDispatchReady {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    ok: o.ok === true,
    locked: o.locked === true,
    posted: o.posted === true,
    has_protocol: o.has_protocol === true,
    has_photo: o.has_photo === true,
    posting_complete: o.posting_complete === true,
    can_dispatch: o.can_dispatch === true,
    invitation_sent_count: Number(o.invitation_sent_count ?? 0) || 0,
    legal_state: String(o.legal_state ?? ''),
  };
}

export function meetingCoreBlockers(m: MeetingCoreFlags): string[] {
  const out: string[] = [];
  if (m.ownership_drift_alert) out.push('OWNERSHIP_CHANGED_AFTER_INVITATION');
  if (m.check_in_blocked_reason && !out.includes(m.check_in_blocked_reason)) {
    out.push(m.check_in_blocked_reason);
  }
  return out;
}

export function nextSuggestedStates(from: string | null | undefined): MeetingLegalState[] {
  const f = (from ?? 'DRAFT').toUpperCase();
  const map: Record<string, MeetingLegalState[]> = {
    DRAFT: ['PRECHECK', 'WAITING_FOR_MEETING', 'CANCELLED'],
    PRECHECK: ['SCHEDULED', 'CANCELLED'],
    SCHEDULED: ['AGENDA_READY', 'CANCELLED'],
    AGENDA_READY: ['INVITATION_READY', 'CANCELLED'],
    INVITATION_READY: ['INVITATION_LOCKED', 'CANCELLED'],
    INVITATION_LOCKED: ['INVITATION_POSTED', 'CANCELLED'],
    INVITATION_POSTED: ['NOTIFICATION_RUNNING', 'CANCELLED'],
    NOTIFICATION_RUNNING: ['WAITING_FOR_MEETING', 'CANCELLED'],
    WAITING_FOR_MEETING: ['CHECK_IN_OPEN', 'MEETING_IN_PROGRESS', 'CANCELLED'],
    CHECK_IN_OPEN: ['VOTING_SNAPSHOT_LOCKED'],
    VOTING_SNAPSHOT_LOCKED: ['QUORUM_CHECK'],
    QUORUM_CHECK: ['MEETING_IN_PROGRESS', 'ADJOURNED_1_HOUR'],
    ADJOURNED_1_HOUR: ['QUORUM_CHECK', 'ADJOURNED_NEXT_SESSION'],
    ADJOURNED_NEXT_SESSION: ['QUORUM_CHECK'],
    MEETING_IN_PROGRESS: ['MEETING_FINISHED'],
    MEETING_FINISHED: ['ABSENTEE_VOTING', 'PROTOCOL_DRAFT'],
    ABSENTEE_VOTING: ['PROTOCOL_DRAFT'],
    PROTOCOL_DRAFT: ['PROTOCOL_SIGNING', 'PROTOCOL_SIGNED'],
    PROTOCOL_SIGNING: ['PROTOCOL_SIGNED'],
    PROTOCOL_SIGNED: ['PROTOCOL_NOTICE_POSTED'],
    PROTOCOL_NOTICE_POSTED: ['CHALLENGE_WINDOW'],
    CHALLENGE_WINDOW: ['CLOSED', 'DISPUTED'],
    DISPUTED: ['LEGAL_HOLD'],
    LEGAL_HOLD: ['CLOSED'],
  };
  return map[f] ?? [];
}
