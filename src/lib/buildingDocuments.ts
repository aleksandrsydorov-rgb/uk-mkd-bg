import { STAFF_ROLE_ADMIN } from '@/lib/utilities';
import type { Translate } from '@/i18n/translate';

/** Private legal archive. Separate from request, chat, expense, and poll files. */
export const BUILDING_DOCUMENTS_BUCKET = 'building-documents';

export type MeetingMode = 'in_person' | 'hybrid';
export type MeetingStatus =
  | 'draft'
  | 'published'
  | 'rescheduled'
  | 'held'
  | 'minutes_ready'
  | 'archived'
  | 'cancelled';
export type ProtocolResult = 'adopted' | 'rejected' | 'information';
export type ExecutionStatus = 'active' | 'executed' | 'cancelled';
export type RepresentationType = 'self' | 'proxy';
export type AttendanceMode = 'in_person' | 'online' | 'absentee';
export type ProtocolVote = 'for' | 'against' | 'abstain';
export type VoteMethod = 'in_person' | 'online' | 'absentee';
export type MeetingFileType =
  | 'invitation'
  | 'invitation_posting_protocol'
  | 'agenda'
  | 'minutes'
  | 'minutes_notice'
  | 'minutes_notice_posting_protocol'
  | 'proxy'
  | 'absentee_declaration'
  | 'appendix'
  | 'cancellation_notice'
  | 'other';
export type DocumentCategory =
  | 'house_rules'
  | 'budget'
  | 'annual_report'
  | 'management'
  | 'technical'
  | 'meeting_related'
  | 'other';
export type DocumentStatus = 'draft' | 'published' | 'archived';
export type QuorumStage = 'initial' | 'after_one_hour' | 'next_day';

export type GeneralMeeting = {
  id: string;
  title: string;
  description: string | null;
  meeting_date: string;
  meeting_time: string | null;
  location: string | null;
  meeting_mode: MeetingMode | string;
  is_urgent: boolean;
  status: MeetingStatus | string;
  convoked_by: string | null;
  invitation_posted_at: string | null;
  minutes_completed_at: string | null;
  minutes_notice_posted_at: string | null;
  absentee_voting_enabled: boolean;
  absentee_voting_deadline: string | null;
  online_meeting_url: string | null;
  represented_ideal_parts_percent: number | string | null;
  quorum_stage: QuorumStage | string | null;
  signed_document_uploaded: boolean;
  external_registry_ref: string | null;
  published_at: string | null;
  cancelled_at: string | null;
  cancelled_by_email: string | null;
  cancellation_reason: string | null;
  reschedule_reason: string | null;
  rescheduled_from_meeting_id: string | null;
  operational_phase?: string | null;
  registration_opened_at?: string | null;
  meeting_started_at?: string | null;
  meeting_ended_at?: string | null;
  meeting_can_proceed?: boolean;
  quorum_rule?: string | null;
};

export type MeetingAgendaItem = {
  id: string;
  meeting_id: string;
  position: number;
  title: string;
  description: string | null;
  proposed_decision_text: string | null;
  decision_category?: string | null;
  majority_rule?: string;
  threshold_comparator?: string;
  required_percent?: number | string | null;
  denominator_basis?: string;
  legal_basis?: string | null;
  voting_status?: string;
  voting_opened_at?: string | null;
  voting_closed_at?: string | null;
  for_percent?: number | string | null;
  against_percent?: number | string | null;
  abstain_percent?: number | string | null;
  computed_threshold_status?: string | null;
};

export type MeetingDecision = {
  id: string;
  meeting_id: string;
  agenda_item_id: string | null;
  decision_number: string;
  title: string;
  decision_text: string;
  protocol_result: ProtocolResult | string;
  execution_status: ExecutionStatus | string;
  created_at: string;
  computed_threshold_status?: string | null;
  result_override_reason?: string | null;
  for_percent?: number | string | null;
  against_percent?: number | string | null;
  abstain_percent?: number | string | null;
};

export type MeetingParticipant = {
  id: string;
  meeting_id: string;
  property_id: number;
  participant_name: string;
  representation_type: RepresentationType | string;
  representative_name: string | null;
  property_number_snapshot: string | null;
  ideal_parts_percent_snapshot: number | string | null;
  attendance_mode: AttendanceMode | string;
  proxy_document_id: string | null;
  attendance_source?: string;
  attendance_status?: string;
  declared_at?: string | null;
  declared_by_email?: string | null;
  confirmed_at?: string | null;
  confirmed_by_email?: string | null;
  left_at?: string | null;
};

export type MeetingVoteRecord = {
  id: string;
  meeting_id: string;
  decision_id: string;
  property_id: number;
  participant_id: string | null;
  vote: ProtocolVote | string;
  ideal_parts_percent_snapshot: number | string | null;
  vote_method: VoteMethod | string;
  recorded_at: string;
  vote_source?: string;
};

export type BuildingDocument = {
  id: string;
  category: DocumentCategory | string;
  title: string;
  description: string | null;
  document_date: string | null;
  storage_path: string;
  mime_type: string | null;
  file_size: number | null;
  status: DocumentStatus | string;
  version: number;
  supersedes_document_id: string | null;
  published_at: string | null;
};

export type MeetingFileLink = {
  id: string;
  meeting_id: string;
  document_id: string;
  file_type: MeetingFileType | string;
  title: string | null;
};

/**
 * Future general-meeting voting contract.
 * NOT used by polls / propertyVoteWeight / cast_poll_vote.
 * Snapshot must come from the meeting, never live properties.ideal_parts_percent.
 */
export type FutureGeneralMeetingVoteContract = {
  meetingId: string;
  decisionId: string;
  propertyId: number;
  idealPartsPercentSnapshot: string;
  vote: ProtocolVote;
};

export const OWNER_DOC_GROUPS: { id: string; categories: DocumentCategory[] }[] = [
  { id: 'house_rules', categories: ['house_rules'] },
  { id: 'budget', categories: ['budget', 'annual_report'] },
  { id: 'management', categories: ['management'] },
  { id: 'technical', categories: ['technical'] },
  { id: 'other', categories: ['other'] },
];

export function canManageBuildingGovernance(role?: string | null, active?: boolean | null) {
  return active === true && role === STAFF_ROLE_ADMIN;
}

export function meetingStartsAt(meeting: Pick<GeneralMeeting, 'meeting_date' | 'meeting_time'>): Date {
  const time = (meeting.meeting_time ?? '00:00:00').slice(0, 8);
  return new Date(`${meeting.meeting_date.slice(0, 10)}T${time.length === 5 ? `${time}:00` : time}`);
}

export function isUpcomingMeeting(meeting: GeneralMeeting, now = new Date()) {
  if (['held', 'minutes_ready', 'archived', 'cancelled', 'rescheduled', 'draft'].includes(meeting.status)) {
    return false;
  }
  return meetingStartsAt(meeting).getTime() >= now.getTime();
}

export function isPublishedUpcomingMeeting(meeting: GeneralMeeting, now = new Date()) {
  return meeting.status === 'published' && isUpcomingMeeting(meeting, now);
}

export function isMeetingLegalLocked(meeting: Pick<GeneralMeeting, 'status'>) {
  return meeting.status !== 'draft';
}

export function isMeetingResultsLocked(meeting: Pick<GeneralMeeting, 'status'>) {
  return ['minutes_ready', 'archived', 'cancelled', 'rescheduled'].includes(meeting.status);
}

export function canEnterMeetingResults(meeting: Pick<GeneralMeeting, 'status'>) {
  return meeting.status === 'held';
}

export function successorMeeting(meetings: GeneralMeeting[], fromId: string) {
  return meetings.find((m) => m.rescheduled_from_meeting_id === fromId) ?? null;
}

export function isPastMeeting(meeting: GeneralMeeting, now = new Date()) {
  return !isUpcomingMeeting(meeting, now);
}

export function invitationTimingWarning(
  meeting: Pick<GeneralMeeting, 'invitation_posted_at' | 'meeting_date' | 'meeting_time' | 'is_urgent'>,
  now = new Date(),
): 'ordinary_short' | 'urgent_short' | null {
  if (!meeting.invitation_posted_at) return null;
  const start = meetingStartsAt(meeting);
  const posted = new Date(meeting.invitation_posted_at);
  if (Number.isNaN(start.getTime()) || Number.isNaN(posted.getTime())) return null;
  const hours = (start.getTime() - posted.getTime()) / 36e5;
  if (meeting.is_urgent && hours < 24 && start >= now) return 'urgent_short';
  if (!meeting.is_urgent && hours < 7 * 24 && start >= now) return 'ordinary_short';
  return null;
}

export function minutesTimingWarning(
  meeting: Pick<GeneralMeeting, 'status' | 'meeting_date' | 'minutes_completed_at' | 'minutes_notice_posted_at'>,
): boolean {
  if (!['held', 'minutes_ready'].includes(meeting.status)) return false;
  if (!meeting.minutes_completed_at) return true;
  if (!meeting.minutes_notice_posted_at) return true;
  return false;
}

export function currentPublishedDocuments(docs: BuildingDocument[]) {
  const superseded = new Set(docs.map((d) => d.supersedes_document_id).filter(Boolean) as string[]);
  return docs.filter((d) => d.status === 'published' && !superseded.has(d.id));
}

export function labelProtocolResult(raw: string, t: Translate) {
  if (raw === 'adopted') return t('docs.adopted');
  if (raw === 'rejected') return t('docs.rejected');
  if (raw === 'information') return t('docs.information');
  return raw;
}

export function labelMeetingStatus(raw: string, t: Translate, upcoming: boolean) {
  if (raw === 'draft') return t('docs.draft');
  if (raw === 'cancelled') return t('docs.statusCancelled');
  if (raw === 'rescheduled') return t('docs.statusRescheduled');
  if (raw === 'minutes_ready') return t('docs.statusMinutes');
  if (raw === 'held' || raw === 'archived') return t('docs.statusHeld');
  if (upcoming) return t('docs.statusUpcoming');
  return t('docs.statusPublished');
}

export function labelDocGroup(id: string, t: Translate) {
  if (id === 'house_rules') return t('docs.catHouseRules');
  if (id === 'budget') return t('docs.catBudget');
  if (id === 'management') return t('docs.catManagement');
  if (id === 'technical') return t('docs.catTechnical');
  return t('docs.catOther');
}

export function labelFileType(raw: string, t: Translate) {
  if (raw === 'invitation') return t('docs.invitation');
  if (raw === 'invitation_posting_protocol') return t('docs.invitationPosting');
  if (raw === 'agenda') return t('docs.agendaShort');
  if (raw === 'minutes') return t('docs.minutes');
  if (raw === 'minutes_notice') return t('docs.minutesNotice');
  if (raw === 'minutes_notice_posting_protocol') return t('docs.minutesNoticePosting');
  if (raw === 'appendix') return t('docs.appendix');
  if (raw === 'proxy') return t('docs.proxy');
  if (raw === 'absentee_declaration') return t('docs.absentee');
  if (raw === 'cancellation_notice') return t('docs.cancellationNotice');
  if (raw === 'other') return t('docs.fileOther');
  return t('docs.fileOther');
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const MAX_BUILDING_DOCUMENT_BYTES = 20 * 1024 * 1024;

export const ALLOWED_DOCUMENT_EXTENSIONS = ['pdf', 'doc', 'docx', 'jpg', 'jpeg', 'png'] as const;
export type AllowedDocumentExtension = (typeof ALLOWED_DOCUMENT_EXTENSIONS)[number];

const MIME_EXTENSION: Record<string, AllowedDocumentExtension> = {
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
};

export function originalUploadFileName(fileName: string): string {
  const base = fileName.replace(/\\/g, '/').split('/').pop()?.trim();
  return base && base !== '.' && base !== '..' ? base : 'document';
}

function extensionFromName(fileName: string): AllowedDocumentExtension | null {
  const base = originalUploadFileName(fileName);
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return null;
  const ext = base.slice(dot + 1).toLowerCase();
  if (!/^[a-z0-9]{1,8}$/.test(ext)) return null;
  return ALLOWED_DOCUMENT_EXTENSIONS.includes(ext as AllowedDocumentExtension)
    ? (ext as AllowedDocumentExtension)
    : null;
}

function extensionFromMime(mime: string | undefined): AllowedDocumentExtension | null {
  if (!mime) return null;
  return MIME_EXTENSION[mime.toLowerCase().split(';')[0].trim()] ?? null;
}

export type PrivateStoragePathResult =
  | {
      ok: true;
      storagePath: string;
      originalName: string;
      extension: AllowedDocumentExtension;
      objectId: string;
    }
  | { ok: false; reason: 'invalid_scope' | 'unsupported_type' };

export function buildPrivateStoragePath(opts: {
  scopeId: string;
  file: { name: string; type?: string };
  folder?: 'meetings' | 'documents';
}): PrivateStoragePathResult {
  const folder = opts.folder ?? 'meetings';
  if (!UUID_RE.test(opts.scopeId)) {
    return { ok: false, reason: 'invalid_scope' };
  }
  const originalName = originalUploadFileName(opts.file.name);
  const fromName = extensionFromName(originalName);
  const fromMime = extensionFromMime(opts.file.type);
  const extension = fromName ?? fromMime;
  if (!extension) {
    return { ok: false, reason: 'unsupported_type' };
  }
  const objectId = crypto.randomUUID();
  const storagePath =
    folder === 'documents'
      ? `documents/${objectId}.${extension}`
      : `meetings/${opts.scopeId}/${objectId}.${extension}`;
  return { ok: true, storagePath, originalName, extension, objectId };
}

export function storagePathContainsOriginalName(storagePath: string, fileName: string): boolean {
  const original = originalUploadFileName(fileName).toLowerCase();
  return storagePath.toLowerCase().includes(original);
}

export function isAsciiSafeStoragePath(storagePath: string): boolean {
  return /^[a-z0-9/._-]+$/i.test(storagePath) && !storagePath.includes('..');
}

export function formatAgendaLine(position: number, title: string): string {
  const trimmed = title.trim();
  const stripped = trimmed.replace(new RegExp(`^${position}[.)]\\s+`), '');
  return `${position}. ${stripped}`;
}

export function formatStoredFileSize(bytes: number | null | undefined): string | null {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function fileKindLabel(mimeOrExt: string | null | undefined, t: Translate): string {
  const raw = (mimeOrExt ?? '').toLowerCase();
  if (raw.includes('pdf') || raw.endsWith('pdf')) return t('docs.pdf');
  if (raw.includes('word') || raw.endsWith('doc') || raw.endsWith('docx')) return t('docs.fileDoc');
  if (raw.includes('jpeg') || raw.includes('jpg') || raw.includes('png') || raw.endsWith('png')) {
    return t('docs.fileImage');
  }
  return t('docs.pdf');
}

export function hybridLinkVisible(meeting: GeneralMeeting, now = new Date()) {
  if (meeting.meeting_mode !== 'hybrid') return false;
  if (meeting.status === 'draft' || meeting.status === 'cancelled') return false;
  const phase = meeting.operational_phase;
  if (phase === 'registration' || phase === 'in_progress') return true;
  const start = meetingStartsAt(meeting);
  const end = new Date(start.getTime() + 8 * 36e5);
  return now.getTime() <= end.getTime();
}
