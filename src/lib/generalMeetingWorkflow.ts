import type { Translate } from '@/i18n/translate';
import type { GeneralMeeting, MeetingAgendaItem, ProtocolVote } from '@/lib/buildingDocuments';

export type OperationalPhase = 'idle' | 'registration' | 'in_progress' | 'closed';
export type AttendanceStatus = 'declared' | 'confirmed' | 'rejected' | 'requires_representation_confirmation';
export type MajorityRule =
  | 'unanimous_all_ideal_parts'
  | 'at_least_75_all_ideal_parts'
  | 'at_least_75_eligible_ideal_parts'
  | 'at_least_51_all_ideal_parts'
  | 'more_than_50_all_ideal_parts'
  | 'more_than_50_represented_ideal_parts'
  | 'more_than_half_independent_units'
  | 'manual_rule';

export type QuorumCalc = {
  calculation_status: 'not_checked' | 'incomplete' | 'not_met' | 'met' | 'allowed_by_stage' | 'requires_review' | string;
  quorum_rule: string;
  quorum_stage: string;
  confirmed_percent: number | string | null;
  declared_percent: number | string | null;
  required_percent: number | string | null;
  all_ideal_parts_percent?: number | string | null;
  registered_property_count: number | null;
  missing_ideal_parts_count: number | null;
  threshold_met: boolean | null;
  meeting_can_proceed: boolean;
};

export const OWNER_MEETING_COLUMNS =
  'id,title,description,meeting_date,meeting_time,location,meeting_mode,is_urgent,status,operational_phase,registration_opened_at,meeting_started_at,meeting_ended_at,quorum_stage,quorum_rule,represented_ideal_parts_percent,absentee_voting_enabled,cancelled_at,cancellation_reason,rescheduled_from_meeting_id,published_at,meeting_can_proceed,invitation_posted_at,minutes_completed_at,minutes_notice_posted_at,signed_document_uploaded,external_registry_ref';

export const MAJORITY_PRESETS: { id: MajorityRule; labelKey: string }[] = [
  { id: 'unanimous_all_ideal_parts', labelKey: 'docs.ruleUnanimous' },
  { id: 'at_least_75_all_ideal_parts', labelKey: 'docs.rule75All' },
  { id: 'at_least_75_eligible_ideal_parts', labelKey: 'docs.rule75Eligible' },
  { id: 'at_least_51_all_ideal_parts', labelKey: 'docs.rule51All' },
  { id: 'more_than_50_all_ideal_parts', labelKey: 'docs.ruleGt50All' },
  { id: 'more_than_50_represented_ideal_parts', labelKey: 'docs.ruleGt50Repr' },
  { id: 'more_than_half_independent_units', labelKey: 'docs.ruleUnits' },
  { id: 'manual_rule', labelKey: 'docs.ruleManual' },
];

export function labelVoteChoice(raw: string, t: Translate) {
  if (raw === 'for') return t('docs.voteFor');
  if (raw === 'against') return t('docs.voteAgainst');
  if (raw === 'abstain') return t('docs.voteAbstain');
  return raw;
}

export function labelAttendanceStatus(raw: string, t: Translate) {
  if (raw === 'confirmed') return t('docs.attendanceConfirmed');
  if (raw === 'declared') return t('docs.attendanceDeclared');
  if (raw === 'rejected') return t('docs.attendanceRejected');
  if (raw === 'requires_representation_confirmation') return t('docs.attendanceNeedsRep');
  if (!raw) return '—';
  if (process.env.NODE_ENV !== 'production') console.warn('[label] unknown attendance:', raw);
  return t('admin.valueUnknown');
}

export function labelQuorumCalcStatus(raw: string, t: Translate) {
  if (raw === 'met') return t('docs.quorumMet');
  if (raw === 'not_met') return t('docs.quorumNotMet');
  if (raw === 'incomplete') return t('docs.quorumIncomplete');
  if (raw === 'allowed_by_stage') return t('docs.quorumAllowedByStage');
  if (raw === 'requires_review') return t('docs.quorumNeedsReview');
  return t('docs.quorumNotChecked');
}

export function labelMeetingWorkflowStatus(meeting: GeneralMeeting, t: Translate, upcoming: boolean) {
  const phase = meeting.operational_phase;
  if (meeting.status === 'draft') return t('docs.draft');
  if (meeting.status === 'cancelled') return t('docs.statusCancelled');
  if (meeting.status === 'rescheduled') return t('docs.statusRescheduled');
  if (meeting.status === 'minutes_ready') return t('docs.statusMinutes');
  if (meeting.status === 'held' || meeting.status === 'archived' || phase === 'closed') return t('docs.statusHeld');
  if (phase === 'in_progress') return t('docs.statusInProgress');
  if (phase === 'registration') return t('docs.statusRegistration');
  if (upcoming) return t('docs.statusUpcoming');
  return t('docs.statusPublished');
}

export function openAgendaItem(items: MeetingAgendaItem[]) {
  return items.find((i) => i.voting_status === 'open') ?? null;
}

export function nextPendingAgendaItem(items: MeetingAgendaItem[]) {
  return [...items].sort((a, b) => a.position - b.position).find((i) => i.voting_status === 'pending') ?? null;
}

export function labelMajorityRule(rule: string, t: Translate) {
  const preset = MAJORITY_PRESETS.find((p) => p.id === rule);
  if (preset) return t(preset.labelKey);
  if (!rule) return '—';
  if (process.env.NODE_ENV !== 'production') console.warn('[label] unknown majority:', rule);
  return t('admin.valueUnknown');
}

export const VOTE_CHOICES: ProtocolVote[] = ['for', 'against', 'abstain'];
