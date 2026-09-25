'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { useI18n } from '@/i18n/I18nProvider';
import type { Translate } from '@/i18n/translate';
import { isMissingRelation } from '@/lib/polls';
import { formatIdealPartsPercent } from '@/lib/propertyBook';
import { formatOwnerDate } from '@/lib/ownerFormat';
import { labelDocumentStatus } from '@/i18n/labels';
import {
  BUILDING_DOCUMENTS_BUCKET,
  MAX_BUILDING_DOCUMENT_BYTES,
  buildPrivateStoragePath,
  canManageBuildingGovernance,
  fileKindLabel,
  formatStoredFileSize,
  invitationTimingWarning,
  isPublishedUpcomingMeeting,
  isUpcomingMeeting,
  labelDocGroup,
  labelFileType,
  labelProtocolResult,
  minutesTimingWarning,
  successorMeeting,
  type BuildingDocument,
  type DocumentCategory,
  type GeneralMeeting,
  type MeetingAgendaItem,
  type MeetingDecision,
  type MeetingFileLink,
  type MeetingFileType,
  type MeetingParticipant,
  type MeetingVoteRecord,
} from '@/lib/buildingDocuments';
import { AdminMeetingConduct } from '@/components/admin/AdminMeetingConduct';
import {
  AdminCard,
  AdminEmptyState,
  AdminFilterBar,
  AdminInlineAlert,
  AdminPageHeader,
  AdminPrimaryButton,
  AdminSecondaryButton,
  AdminTabBar,
  AdminTableShell,
  StatusBadge,
  adminBtnDangerClass,
  adminBtnSecondaryClass,
  adminBtnTertiaryClass,
  adminFieldClass,
  adminModalHeaderClass,
  adminModalOverlayClass,
  adminModalPanelClass,
  adminTableCellClass,
  adminTableHeadRowClass,
  adminTableRowClass,
} from '@/components/admin/AdminUi';
import { ApartmentCombobox } from '@/components/admin/ApartmentCombobox';
import { MAJORITY_PRESETS, labelAttendanceStatus, labelMajorityRule, labelMeetingWorkflowStatus } from '@/lib/generalMeetingWorkflow';

type PropertyOption = { id: number; apartment_number: string | number | null; owner_name: string | null; ideal_parts_percent?: number | string | null };

function MeetingFileSlot({
  type: _type,
  label,
  links,
  docs,
  canWrite,
  busy,
  t,
  onUpload,
  onOpen,
  onDelete,
}: {
  type: MeetingFileType;
  label: string;
  links: MeetingFileLink[];
  docs: BuildingDocument[];
  canWrite: boolean;
  busy: boolean;
  t: Translate;
  onUpload: () => void;
  onOpen: (doc: BuildingDocument | undefined) => void;
  onDelete: (link: MeetingFileLink, doc: BuildingDocument | undefined) => void;
}) {
  return (
    <div className="rounded-[14px] border border-border bg-surface px-3 py-3">
      <p className="text-sm font-medium text-foreground">{label}</p>
      {links.length === 0 ? <p className="mt-1 text-xs text-muted">{t('docs.fileNotUploaded')}</p> : null}
      {links.map((link) => {
        const doc = docs.find((d) => d.id === link.document_id);
        const name = link.title || doc?.title || t('docs.fileOther');
        const size = formatStoredFileSize(doc?.file_size ?? null);
        const kind = fileKindLabel(doc?.mime_type || name, t);
        return (
          <div key={link.id} className="mt-2">
            <p className="text-sm text-foreground">{name}</p>
            <p className="text-xs text-muted">
              {kind}
              {size ? ` · ${size}` : ''}
            </p>
            <div className="mt-1 flex flex-wrap gap-3">
              <button type="button" className={adminBtnTertiaryClass} onClick={() => onOpen(doc)}>
                {t('docs.open')}
              </button>
              {canWrite && doc?.status === 'draft' ? (
                <button type="button" className="text-xs text-danger hover:underline" onClick={() => onDelete(link, doc)}>
                  {t('common.delete')}
                </button>
              ) : null}
            </div>
          </div>
        );
      })}
      {canWrite ? (
        <button
          type="button"
          disabled={busy}
          className={`${adminBtnSecondaryClass} mt-2 disabled:opacity-50`}
          onClick={onUpload}
        >
          {t('docs.uploadFile')}
        </button>
      ) : null}
    </div>
  );
}

export function AdminDocumentsDecisions({
  supabase,
  properties,
  staffRole,
  staffActive,
  meetingsEnabled = true,
  documentsEnabled = true,
}: {
  supabase: SupabaseClient<Database>;
  properties: PropertyOption[];
  staffRole: string;
  staffActive: boolean;
  meetingsEnabled?: boolean;
  documentsEnabled?: boolean;
}) {
  const { t, locale } = useI18n();
  const canWrite = canManageBuildingGovernance(staffRole, staffActive);
  const [detailTab, setDetailTab] = useState<'info' | 'agenda' | 'participants' | 'conduct' | 'documents'>('info');
  const [showCreate, setShowCreate] = useState(false);
  const [meetingSearch, setMeetingSearch] = useState('');
  const [docSearch, setDocSearch] = useState('');
  const [docDetailId, setDocDetailId] = useState<string | null>(null);
  const [meetings, setMeetings] = useState<GeneralMeeting[]>([]);
  const [agenda, setAgenda] = useState<MeetingAgendaItem[]>([]);
  const [decisions, setDecisions] = useState<MeetingDecision[]>([]);
  const [participants, setParticipants] = useState<MeetingParticipant[]>([]);
  const [votes, setVotes] = useState<MeetingVoteRecord[]>([]);
  const [files, setFiles] = useState<MeetingFileLink[]>([]);
  const [docs, setDocs] = useState<BuildingDocument[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const emptyForm = {
    title: t('docs.generalMeeting'),
    description: '',
    meeting_date: '',
    meeting_time: '18:30',
    location: '',
    meeting_mode: 'in_person',
    is_urgent: false,
    absentee_voting_enabled: false,
    online_meeting_url: '',
  };
  const [form, setForm] = useState(emptyForm);
  const [dialog, setDialog] = useState<null | 'reschedule' | 'cancel'>(null);
  const [rescheduleForm, setRescheduleForm] = useState({
    meeting_date: '',
    meeting_time: '18:30',
    location: '',
    meeting_mode: 'in_person',
    reason: '',
  });
  const [cancelReason, setCancelReason] = useState('');
  const [agendaTitle, setAgendaTitle] = useState('');
  const [majorityRule, setMajorityRule] = useState('more_than_50_represented_ideal_parts');
  const [decisionForm, setDecisionForm] = useState({ number: '', title: '', text: '', result: 'adopted' });
  const [partForm, setPartForm] = useState({ property_id: '', name: '', representation: 'self', representative: '', attendance: 'in_person' });
  const [docForm, setDocForm] = useState({ title: '', category: 'house_rules' as DocumentCategory, document_date: '' });
  const [extraFilesOpen, setExtraFilesOpen] = useState(false);
  const [pendingFileType, setPendingFileType] = useState<MeetingFileType | null>(null);
  const meetingFileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const [m, a, d, p, f, doc, v] = await Promise.all([
      supabase.from('general_meetings').select('*').order('meeting_date', { ascending: false }),
      supabase.from('general_meeting_agenda_items').select('*').order('position', { ascending: true }),
      supabase.from('general_meeting_decisions').select('*'),
      supabase.from('general_meeting_participants').select('*'),
      supabase.from('general_meeting_files').select('*'),
      supabase.from('building_documents').select('*').order('created_at', { ascending: false }),
      supabase.from('general_meeting_votes').select('*'),
    ]);
    if (m.error) {
      if (isMissingRelation(m.error, 'general_meetings')) {
        setMeetings([]);
        return;
      }
      setError(m.error.message);
      return;
    }
    setMeetings((m.data as GeneralMeeting[]) ?? []);
    if (!a.error) setAgenda((a.data as MeetingAgendaItem[]) ?? []);
    if (!d.error) setDecisions((d.data as MeetingDecision[]) ?? []);
    if (!p.error) setParticipants((p.data as MeetingParticipant[]) ?? []);
    if (!f.error) setFiles((f.data as MeetingFileLink[]) ?? []);
    if (!doc.error) setDocs((doc.data as BuildingDocument[]) ?? []);
    if (!v.error) setVotes((v.data as MeetingVoteRecord[]) ?? []);
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = meetings.find((m) => m.id === selectedId) ?? null;
  const successor = selected ? successorMeeting(meetings, selected.id) : null;

  useEffect(() => {
    if (!selected) return;
    setForm({
      title: selected.title,
      description: selected.description ?? '',
      meeting_date: selected.meeting_date.slice(0, 10),
      meeting_time: (selected.meeting_time ?? '18:30').slice(0, 5),
      location: selected.location ?? '',
      meeting_mode: selected.meeting_mode === 'hybrid' ? 'hybrid' : 'in_person',
      is_urgent: selected.is_urgent,
      absentee_voting_enabled: selected.absentee_voting_enabled,
      online_meeting_url: selected.online_meeting_url ?? '',
    });
  }, [selected?.id]);

  function startNewMeeting() {
    setSelectedId(null);
    setForm(emptyForm);
    setDialog(null);
  }

  async function createMeeting() {
    if (!canWrite || !form.meeting_date) return;
    setBusy(true);
    setError(null);
    const { data, error: insErr } = await supabase
      .from('general_meetings')
      .insert({
        title: form.title.trim() || t('docs.generalMeeting'),
        description: form.description.trim() || null,
        meeting_date: form.meeting_date,
        meeting_time: form.meeting_time || null,
        location: form.location.trim() || null,
        meeting_mode: form.meeting_mode,
        is_urgent: form.is_urgent,
        absentee_voting_enabled: form.absentee_voting_enabled,
        online_meeting_url: form.online_meeting_url.trim() || null,
      })
      .select('*')
      .single();
    setBusy(false);
    if (insErr) {
      setError(insErr.message);
      return;
    }
    setSelectedId((data as GeneralMeeting).id);
    if (form.meeting_mode === 'hybrid' && form.online_meeting_url.trim()) {
      await supabase.rpc('set_general_meeting_online_url', { p_meeting_id: (data as GeneralMeeting).id, p_url: form.online_meeting_url.trim() });
    }
    await load();
  }

  async function saveDraft() {
    if (!canWrite || !selected || selected.status !== 'draft' || !form.meeting_date) return;
    setBusy(true);
    setError(null);
    const { error: updErr } = await supabase
      .from('general_meetings')
      .update({
        title: form.title.trim() || t('docs.generalMeeting'),
        description: form.description.trim() || null,
        meeting_date: form.meeting_date,
        meeting_time: form.meeting_time || null,
        location: form.location.trim() || null,
        meeting_mode: form.meeting_mode,
        is_urgent: form.is_urgent,
        absentee_voting_enabled: form.absentee_voting_enabled,
        online_meeting_url: form.online_meeting_url.trim() || null,
      })
      .eq('id', selected.id)
      .eq('status', 'draft');
    if (!updErr && form.meeting_mode === 'hybrid') {
      await supabase.rpc('set_general_meeting_online_url', { p_meeting_id: selected.id, p_url: form.online_meeting_url.trim() });
    }
    setBusy(false);
    if (updErr) setError(updErr.message);
    else await load();
  }

  async function saveOperationalFields() {
    if (!canWrite || !selected || selected.status !== 'published') return;
    setBusy(true);
    setError(null);
    const { error: updErr } = await supabase
      .from('general_meetings')
      .update({
        description: form.description.trim() || null,
        online_meeting_url: form.online_meeting_url.trim() || null,
        absentee_voting_enabled: form.absentee_voting_enabled,
      })
      .eq('id', selected.id)
      .eq('status', 'published');
    setBusy(false);
    if (updErr) setError(updErr.message);
    else await load();
  }

  async function deleteDraft() {
    if (!canWrite || !selected || selected.status !== 'draft') return;
    setBusy(true);
    setError(null);
    const { error: delErr } = await supabase.from('general_meetings').delete().eq('id', selected.id).eq('status', 'draft');
    setBusy(false);
    if (delErr) setError(delErr.message);
    else {
      setSelectedId(null);
      await load();
    }
  }

  async function cancelSelected() {
    if (!canWrite || !selected || selected.status !== 'published') return;
    if (cancelReason.trim().length < 3) {
      setError(t('docs.reasonRequired'));
      return;
    }
    setBusy(true);
    setError(null);
    const { error: rpcErr } = await supabase.rpc('cancel_general_meeting', {
      p_meeting_id: selected.id,
      p_reason: cancelReason.trim(),
    });
    setBusy(false);
    if (rpcErr) setError(rpcErr.message);
    else {
      setDialog(null);
      setCancelReason('');
      await load();
    }
  }

  async function rescheduleSelected() {
    if (!canWrite || !selected || selected.status !== 'published') return;
    if (rescheduleForm.reason.trim().length < 3 || !rescheduleForm.meeting_date) {
      setError(t('docs.reasonRequired'));
      return;
    }
    setBusy(true);
    setError(null);
    const { data, error: rpcErr } = await supabase.rpc('reschedule_general_meeting', {
      p_meeting_id: selected.id,
      p_meeting_date: rescheduleForm.meeting_date,
      p_meeting_time: rescheduleForm.meeting_time || null,
      p_location: rescheduleForm.location.trim() || null,
      p_meeting_mode: rescheduleForm.meeting_mode,
      p_reason: rescheduleForm.reason.trim(),
    });
    setBusy(false);
    if (rpcErr) setError(rpcErr.message);
    else {
      setDialog(null);
      const created = data as GeneralMeeting | null;
      if (created?.id) setSelectedId(created.id);
      await load();
    }
  }

  async function addAgenda() {
    if (!canWrite || !selected || !agendaTitle.trim()) return;
    const pos = agenda.filter((a) => a.meeting_id === selected.id).length + 1;
    const { error: insErr } = await supabase.from('general_meeting_agenda_items').insert({
      meeting_id: selected.id,
      position: pos,
      title: agendaTitle.trim(),
      majority_rule: majorityRule,
    });
    if (insErr) setError(insErr.message);
    else {
      setAgendaTitle('');
      await load();
    }
  }

  async function addDecision() {
    if (!canWrite || !selected || selected.status !== 'held' || !decisionForm.title.trim() || !decisionForm.text.trim()) return;
    const { error: insErr } = await supabase.from('general_meeting_decisions').insert({
      meeting_id: selected.id,
      decision_number: decisionForm.number.trim() || String(decisions.filter((d) => d.meeting_id === selected.id).length + 1),
      title: decisionForm.title.trim(),
      decision_text: decisionForm.text.trim(),
      protocol_result: decisionForm.result,
    });
    if (insErr) setError(insErr.message);
    else {
      setDecisionForm({ number: '', title: '', text: '', result: 'adopted' });
      await load();
    }
  }

  async function addParticipant() {
    if (!canWrite || !selected || !['published', 'held'].includes(selected.status) || !partForm.property_id || !partForm.name.trim()) return;
    const { error: insErr } = await supabase.from('general_meeting_participants').insert({
      meeting_id: selected.id,
      property_id: Number(partForm.property_id),
      participant_name: partForm.name.trim(),
      representation_type: partForm.representation,
      representative_name: partForm.representative.trim() || null,
      attendance_mode: partForm.attendance,
    });
    if (insErr) setError(insErr.message);
    else {
      await supabase.rpc('refresh_meeting_represented_parts', { p_meeting_id: selected.id });
      setPartForm({ property_id: '', name: '', representation: 'self', representative: '', attendance: 'in_person' });
      await load();
    }
  }

  async function removeOrphanStorage(path: string) {
    await supabase.storage.from(BUILDING_DOCUMENTS_BUCKET).remove([path]);
  }

  async function uploadMeetingFile(file: File, fileType: MeetingFileType) {
    if (!canWrite || !selected) return;
    setBusy(true);
    setError(null);
    if (file.size > MAX_BUILDING_DOCUMENT_BYTES) {
      setBusy(false);
      setError(t('docs.fileTooLarge'));
      return;
    }
    const built = buildPrivateStoragePath({ scopeId: selected.id, file, folder: 'meetings' });
    if (!built.ok) {
      setBusy(false);
      setError(t(built.reason === 'unsupported_type' ? 'docs.invalidFileType' : 'docs.uploadFailed'));
      return;
    }
    const up = await supabase.storage
      .from(BUILDING_DOCUMENTS_BUCKET)
      .upload(built.storagePath, file, { upsert: false });
    if (up.error) {
      console.error('[docs upload]', up.error.message);
      setBusy(false);
      setError(t('docs.uploadFailed'));
      return;
    }
    const { data: doc, error: docErr } = await supabase
      .from('building_documents')
      .insert({
        id: built.objectId,
        category: 'meeting_related',
        title: built.originalName,
        storage_path: built.storagePath,
        mime_type: file.type || null,
        file_size: file.size,
        status: selected.status === 'draft' ? 'draft' : 'published',
        document_date: selected.meeting_date,
      })
      .select('*')
      .single();
    if (docErr) {
      console.error('[docs upload]', docErr.message);
      await removeOrphanStorage(built.storagePath);
      setBusy(false);
      setError(t('docs.uploadFailed'));
      return;
    }
    const { error: linkErr } = await supabase.from('general_meeting_files').insert({
      meeting_id: selected.id,
      document_id: (doc as BuildingDocument).id,
      file_type: fileType,
      title: built.originalName,
    });
    if (linkErr) {
      console.error('[docs upload]', linkErr.message);
      await supabase.from('building_documents').delete().eq('id', built.objectId).eq('status', 'draft');
      await removeOrphanStorage(built.storagePath);
      setBusy(false);
      setError(t('docs.uploadFailed'));
      return;
    }
    setBusy(false);
    await load();
  }

  async function uploadHouseDoc(file: File) {
    if (!canWrite || !docForm.title.trim()) return;
    setBusy(true);
    setError(null);
    if (file.size > MAX_BUILDING_DOCUMENT_BYTES) {
      setBusy(false);
      setError(t('docs.fileTooLarge'));
      return;
    }
    const scopeId = crypto.randomUUID();
    const built = buildPrivateStoragePath({ scopeId, file, folder: 'documents' });
    if (!built.ok) {
      setBusy(false);
      setError(t(built.reason === 'unsupported_type' ? 'docs.invalidFileType' : 'docs.uploadFailed'));
      return;
    }
    const up = await supabase.storage
      .from(BUILDING_DOCUMENTS_BUCKET)
      .upload(built.storagePath, file, { upsert: false });
    if (up.error) {
      console.error('[docs upload]', up.error.message);
      setBusy(false);
      setError(t('docs.uploadFailed'));
      return;
    }
    const { error: docErr } = await supabase.from('building_documents').insert({
      id: built.objectId,
      category: docForm.category,
      title: docForm.title.trim(),
      storage_path: built.storagePath,
      mime_type: file.type || null,
      file_size: file.size,
      status: 'draft',
      document_date: docForm.document_date || null,
    });
    if (docErr) {
      console.error('[docs upload]', docErr.message);
      await removeOrphanStorage(built.storagePath);
      setBusy(false);
      setError(t('docs.uploadFailed'));
      return;
    }
    setBusy(false);
    setDocForm({ title: '', category: 'house_rules', document_date: '' });
    await load();
  }

  async function openStoredDocument(doc: BuildingDocument | undefined) {
    if (!doc) {
      setError(t('docs.fileUnavailable'));
      return;
    }
    const { data, error: signErr } = await supabase.storage
      .from(BUILDING_DOCUMENTS_BUCKET)
      .createSignedUrl(doc.storage_path, 60);
    if (signErr || !data?.signedUrl) {
      setError(t('docs.fileUnavailable'));
      return;
    }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  }

  async function removeDraftMeetingFile(link: MeetingFileLink, doc: BuildingDocument | undefined) {
    if (!canWrite || !doc || doc.status !== 'draft') return;
    const { error: linkErr } = await supabase.from('general_meeting_files').delete().eq('id', link.id);
    if (linkErr) {
      setError(t('docs.uploadFailed'));
      return;
    }
    await supabase.from('building_documents').delete().eq('id', doc.id).eq('status', 'draft');
    await removeOrphanStorage(doc.storage_path);
    await load();
  }

  async function rpcMeeting(name: 'publish_general_meeting' | 'publish_general_meeting_minutes', id: string) {
    setBusy(true);
    const { error: rpcErr } = await supabase.rpc(name, { p_meeting_id: id });
    setBusy(false);
    if (rpcErr) setError(rpcErr.message);
    else await load();
  }

  async function markHeld() {
    if (!canWrite || !selected) return;
    const { error: rpcErr } = await supabase.rpc('mark_general_meeting_held', {
      p_meeting_id: selected.id,
    });
    if (rpcErr) setError(rpcErr.message);
    else await load();
  }

  const warn = selected ? invitationTimingWarning(selected) : null;
  const minutesWarn = selected ? minutesTimingWarning(selected) : false;
  const parts = selected ? formatIdealPartsPercent(selected.represented_ideal_parts_percent, locale) : null;
  const meetingQuery = meetingSearch.trim().toLowerCase();
  const visibleMeetings = meetingQuery
    ? meetings.filter((m) => {
        const status = labelMeetingWorkflowStatus(m, t, isUpcomingMeeting(m)).toLowerCase();
        return m.title.toLowerCase().includes(meetingQuery)
          || (m.location ?? '').toLowerCase().includes(meetingQuery)
          || status.includes(meetingQuery);
      })
    : meetings;
  const houseDocs = docs.filter((d) => d.category !== 'meeting_related');
  const docQuery = docSearch.trim().toLowerCase();
  const visibleDocs = docQuery
    ? houseDocs.filter((d) => d.title.toLowerCase().includes(docQuery) || labelDocGroup(d.category, t).toLowerCase().includes(docQuery))
    : houseDocs;
  const selectedDoc = houseDocs.find((d) => d.id === docDetailId) ?? null;

  function meetingTone(m: GeneralMeeting): 'neutral' | 'info' | 'success' | 'warning' | 'danger' {
    if (m.status === 'cancelled') return 'danger';
    if (m.status === 'rescheduled') return 'warning';
    if (m.status === 'held' || m.status === 'minutes_ready' || m.status === 'archived') return 'success';
    if (m.status === 'draft') return 'neutral';
    if (m.operational_phase === 'in_progress' || m.operational_phase === 'registration') return 'warning';
    return 'info';
  }

  function agendaVoteLabel(raw: string | null | undefined) {
    if (raw === 'open') return t('docs.gmVoteOpen');
    if (raw === 'closed') return t('docs.gmVoteClosed');
    if (!raw || raw === 'pending') return t('docs.gmVotePending');
    return t('admin.valueUnknown');
  }

  const detailTabs = [
    { id: 'info', label: t('docs.tabInfo') },
    { id: 'agenda', label: t('docs.agendaTitle') },
    { id: 'participants', label: t('docs.tabParticipants') },
    { id: 'conduct', label: t('docs.conductTitle') },
    { id: 'documents', label: t('docs.meetingFiles') },
  ];

  return (
    <div className="min-w-0 space-y-6">
      <AdminPageHeader
        title={selected ? selected.title : t('admin.docsMenu')}
        secondary={selected ? undefined : t('admin.docsLead')}
        action={selected ? (
          <AdminSecondaryButton type="button" onClick={() => { setSelectedId(null); setDetailTab('info'); setShowCreate(false); }}>
            {t('common.back')}
          </AdminSecondaryButton>
        ) : canWrite && meetingsEnabled ? (
          <AdminPrimaryButton type="button" onClick={() => { startNewMeeting(); setShowCreate(true); }}>
            {t('docs.newMeeting')}
          </AdminPrimaryButton>
        ) : undefined}
      />
      {!canWrite ? <AdminInlineAlert tone="warning">{t('docs.noWrite')}</AdminInlineAlert> : null}
      {error ? <AdminInlineAlert tone="danger">{error}</AdminInlineAlert> : null}

      {!selected ? (
        <>
          {meetingsEnabled ? (
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground">{t('docs.tabMeetings')}</h3>
            {showCreate && canWrite ? (
              <AdminCard pad>
                <div className="grid gap-2">
                  <input className={adminFieldClass} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
                  <textarea className={adminFieldClass} rows={2} placeholder={t('docs.internalNotes')} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
                  <input type="date" className={adminFieldClass} value={form.meeting_date} onChange={(e) => setForm({ ...form, meeting_date: e.target.value })} />
                  <input type="time" className={adminFieldClass} value={form.meeting_time} onChange={(e) => setForm({ ...form, meeting_time: e.target.value })} />
                  <input className={adminFieldClass} placeholder={t('docs.location')} value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
                  <select className={adminFieldClass} value={form.meeting_mode} onChange={(e) => setForm({ ...form, meeting_mode: e.target.value })}>
                    <option value="in_person">{t('docs.formatInPerson')}</option>
                    <option value="hybrid">{t('docs.formatHybrid')}</option>
                  </select>
                  <p className="text-xs text-muted">{form.meeting_mode === 'hybrid' ? t('docs.formatHybridHint') : t('docs.formatInPersonHint')}</p>
                  {form.meeting_mode === 'hybrid' ? (
                    <input className={adminFieldClass} placeholder={t('docs.hybridLink')} value={form.online_meeting_url} onChange={(e) => setForm({ ...form, online_meeting_url: e.target.value })} />
                  ) : null}
                  <label className="grid gap-1 text-sm text-foreground">
                    <span className="flex items-center gap-2">
                      <input type="checkbox" className="accent-accent" checked={form.is_urgent} onChange={(e) => setForm({ ...form, is_urgent: e.target.checked })} />
                      {t('docs.urgentMeeting')}
                    </span>
                    <span className="pl-6 text-xs text-muted">{t('docs.urgentMeetingHint')}</span>
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" disabled={busy} onClick={() => void createMeeting()} className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                      {t('docs.createMeeting')}
                    </button>
                    <AdminSecondaryButton type="button" onClick={() => setShowCreate(false)}>{t('common.cancel')}</AdminSecondaryButton>
                  </div>
                </div>
              </AdminCard>
            ) : null}
            <AdminFilterBar>
              <input className={adminFieldClass} placeholder={t('common.search')} value={meetingSearch} onChange={(e) => setMeetingSearch(e.target.value)} />
            </AdminFilterBar>
            {meetings.length === 0 ? (
              <AdminEmptyState title={t('docs.noMeetingsYet')} />
            ) : visibleMeetings.length === 0 ? (
              <AdminEmptyState title={t('admin.noAptsFilter')} />
            ) : (
              <>
                <div className="space-y-2 md:hidden">
                  {visibleMeetings.map((m) => {
                    const count = participants.filter((p) => p.meeting_id === m.id).length;
                    const ideal = formatIdealPartsPercent(m.represented_ideal_parts_percent, locale);
                    const when = `${formatOwnerDate(m.meeting_date, locale)}${m.meeting_time ? ` · ${m.meeting_time.slice(0, 5)}` : ''}`;
                    return (
                      <button key={m.id} type="button" onClick={() => { setSelectedId(m.id); setDetailTab('info'); setShowCreate(false); }} className="w-full rounded-[14px] border border-border bg-surface p-3 text-left shadow-card">
                        <div className="flex items-start justify-between gap-2">
                          <span className="text-xs text-muted">{when}</span>
                          <StatusBadge label={labelMeetingWorkflowStatus(m, t, isUpcomingMeeting(m))} tone={meetingTone(m)} />
                        </div>
                        <div className="mt-1 truncate text-sm font-medium text-foreground">{m.title}</div>
                        <div className="mt-1 text-xs text-secondary">{t('docs.gmParticipantsN', { n: count })}</div>
                        {ideal ? <div className="text-xs text-muted">{t('docs.representedRaw', { n: ideal })}</div> : null}
                      </button>
                    );
                  })}
                </div>
                <AdminTableShell className="hidden md:block">
                  <table className="w-full min-w-[720px] text-sm">
                    <thead>
                      <tr className={adminTableHeadRowClass}>
                        <th className={adminTableCellClass}>{t('docs.date')}</th>
                        <th className={adminTableCellClass}>{t('account.subject')}</th>
                        <th className={adminTableCellClass}>{t('admin.status')}</th>
                        <th className={adminTableCellClass}>{t('docs.tabParticipants')}</th>
                        <th className={adminTableCellClass}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleMeetings.map((m) => {
                        const count = participants.filter((p) => p.meeting_id === m.id).length;
                        const ideal = formatIdealPartsPercent(m.represented_ideal_parts_percent, locale);
                        return (
                          <tr key={m.id} className={adminTableRowClass}>
                            <td className={`${adminTableCellClass} whitespace-nowrap text-xs text-muted`}>
                              {formatOwnerDate(m.meeting_date, locale)}
                              {m.meeting_time ? ` · ${m.meeting_time.slice(0, 5)}` : ''}
                            </td>
                            <td className={adminTableCellClass}>
                              <div className="max-w-md truncate font-medium text-foreground">{m.title}</div>
                              {m.location ? <div className="max-w-md truncate text-xs text-muted">{m.location}</div> : null}
                            </td>
                            <td className={adminTableCellClass}>
                              <StatusBadge label={labelMeetingWorkflowStatus(m, t, isUpcomingMeeting(m))} tone={meetingTone(m)} />
                            </td>
                            <td className={`${adminTableCellClass} text-secondary`}>
                              <div>{t('docs.gmParticipantsN', { n: count })}</div>
                              {ideal ? <div className="text-xs text-muted">{t('docs.representedRaw', { n: ideal })}</div> : null}
                            </td>
                            <td className={adminTableCellClass}>
                              <button type="button" className={adminBtnTertiaryClass} onClick={() => { setSelectedId(m.id); setDetailTab('info'); setShowCreate(false); }}>
                                {t('docs.gmDetails')}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </AdminTableShell>
              </>
            )}
          </section>
          ) : null}

          {documentsEnabled ? (
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground">{t('docs.tabDocuments')}</h3>
            {canWrite ? (
              <AdminCard pad>
                <div className="grid gap-2 sm:grid-cols-2">
                  <input className={adminFieldClass} placeholder={t('docs.houseDocs')} value={docForm.title} onChange={(e) => setDocForm({ ...docForm, title: e.target.value })} />
                  <select className={adminFieldClass} value={docForm.category} onChange={(e) => setDocForm({ ...docForm, category: e.target.value as DocumentCategory })}>
                    <option value="house_rules">{t('docs.catHouseRules')}</option>
                    <option value="budget">{t('docs.catBudget')}</option>
                    <option value="management">{t('docs.catManagement')}</option>
                    <option value="technical">{t('docs.catTechnical')}</option>
                    <option value="other">{t('docs.catOther')}</option>
                  </select>
                  <input type="date" className={adminFieldClass} value={docForm.document_date} onChange={(e) => setDocForm({ ...docForm, document_date: e.target.value })} />
                  <input
                    type="file"
                    className="text-sm"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void uploadHouseDoc(file);
                    }}
                  />
                </div>
              </AdminCard>
            ) : null}
            <AdminFilterBar>
              <input className={adminFieldClass} placeholder={t('common.search')} value={docSearch} onChange={(e) => setDocSearch(e.target.value)} />
            </AdminFilterBar>
            {houseDocs.length === 0 ? (
              <AdminEmptyState title={t('docs.noHouseDocs')} />
            ) : visibleDocs.length === 0 ? (
              <AdminEmptyState title={t('admin.noAptsFilter')} />
            ) : (
              <>
                <div className="space-y-2 md:hidden">
                  {visibleDocs.map((d) => (
                    <button key={d.id} type="button" onClick={() => setDocDetailId(d.id)} className="w-full rounded-[14px] border border-border bg-surface p-3 text-left shadow-card">
                      <div className="flex items-start justify-between gap-2">
                        <span className="truncate text-sm font-medium text-foreground">{d.title}</span>
                        <StatusBadge label={labelDocumentStatus(d.status, t)} tone={d.status === 'published' ? 'success' : d.status === 'draft' ? 'warning' : 'neutral'} />
                      </div>
                      <div className="mt-1 text-xs text-muted">{labelDocGroup(d.category, t)} · {formatOwnerDate(d.document_date, locale)}</div>
                    </button>
                  ))}
                </div>
                <AdminTableShell className="hidden md:block">
                  <table className="w-full min-w-[640px] text-sm">
                    <thead>
                      <tr className={adminTableHeadRowClass}>
                        <th className={adminTableCellClass}>{t('admin.annTitlePh')}</th>
                        <th className={adminTableCellClass}>{t('admin.kind')}</th>
                        <th className={adminTableCellClass}>{t('docs.date')}</th>
                        <th className={adminTableCellClass}>{t('admin.status')}</th>
                        <th className={adminTableCellClass}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleDocs.map((d) => (
                        <tr key={d.id} className={adminTableRowClass}>
                          <td className={`${adminTableCellClass} font-medium text-foreground`}>{d.title}</td>
                          <td className={adminTableCellClass}>{labelDocGroup(d.category, t)}</td>
                          <td className={`${adminTableCellClass} whitespace-nowrap text-xs text-muted`}>{formatOwnerDate(d.document_date, locale)}</td>
                          <td className={adminTableCellClass}>
                            <StatusBadge label={labelDocumentStatus(d.status, t)} tone={d.status === 'published' ? 'success' : d.status === 'draft' ? 'warning' : 'neutral'} />
                          </td>
                          <td className={adminTableCellClass}>
                            <button type="button" className={adminBtnTertiaryClass} onClick={() => setDocDetailId(d.id)}>{t('docs.gmDetails')}</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </AdminTableShell>
              </>
            )}
            {selectedDoc ? (
              <AdminCard pad>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-base font-semibold text-foreground">{selectedDoc.title}</h3>
                    <p className="mt-1 text-xs text-muted">
                      {labelDocGroup(selectedDoc.category, t)} · {formatOwnerDate(selectedDoc.document_date, locale)} · v{selectedDoc.version}
                    </p>
                  </div>
                  <AdminSecondaryButton type="button" onClick={() => setDocDetailId(null)}>{t('common.close')}</AdminSecondaryButton>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <StatusBadge label={labelDocumentStatus(selectedDoc.status, t)} tone={selectedDoc.status === 'published' ? 'success' : selectedDoc.status === 'draft' ? 'warning' : 'neutral'} />
                  {selectedDoc.description ? <p className="text-sm text-secondary">{selectedDoc.description}</p> : null}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" className={adminBtnSecondaryClass} onClick={() => void openStoredDocument(selectedDoc)}>{t('docs.open')}</button>
                  {canWrite && selectedDoc.status === 'draft' ? (
                    <button
                      type="button"
                      className={adminBtnSecondaryClass}
                      onClick={async () => {
                        const { error: pubErr } = await supabase.rpc('publish_building_document', { p_document_id: selectedDoc.id });
                        if (pubErr) setError(pubErr.message);
                        else await load();
                      }}
                    >
                      {t('docs.publishDoc')}
                    </button>
                  ) : null}
                </div>
                {canWrite && selectedDoc.status === 'published' ? (
                  <div className="mt-3 border-t border-border pt-3">
                    <button
                      type="button"
                      className="text-sm text-danger hover:underline"
                      onClick={async () => {
                        const { error: archErr } = await supabase.rpc('archive_building_document', { p_document_id: selectedDoc.id });
                        if (archErr) setError(archErr.message);
                        else await load();
                      }}
                    >
                      {t('docs.archiveDoc')}
                    </button>
                  </div>
                ) : null}
              </AdminCard>
            ) : null}
          </section>
          ) : null}
        </>
      ) : meetingsEnabled ? (
        <div className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge label={labelMeetingWorkflowStatus(selected, t, isUpcomingMeeting(selected))} tone={meetingTone(selected)} />
          </div>
          <AdminTabBar tabs={detailTabs} active={detailTab} onChange={(id) => setDetailTab(id as typeof detailTab)} />

          {detailTab === 'info' ? (
            <AdminCard pad className="space-y-3">
              {selected.status !== 'draft' ? <AdminInlineAlert tone="warning">{t('docs.warnEditPublished')}</AdminInlineAlert> : null}
              {['rescheduled', 'cancelled'].includes(selected.status) ? <AdminInlineAlert tone="warning">{t('docs.notifyOwnersReminder')}</AdminInlineAlert> : null}
              {warn === 'ordinary_short' ? <AdminInlineAlert tone="warning">{t('docs.warnOrdinary')}</AdminInlineAlert> : null}
              {warn === 'urgent_short' ? <AdminInlineAlert tone="warning">{t('docs.warnUrgent')}</AdminInlineAlert> : null}
              {minutesWarn ? <AdminInlineAlert tone="warning">{t('docs.warnMinutes')}</AdminInlineAlert> : null}
              {selected.status === 'cancelled' && selected.cancellation_reason ? (
                <p className="text-sm text-secondary">{t('docs.cancelReason')}: {selected.cancellation_reason}</p>
              ) : null}
              {selected.status === 'rescheduled' && successor && successor.status !== 'draft' ? (
                <button type="button" className={adminBtnTertiaryClass} onClick={() => { setSelectedId(successor.id); setDetailTab('info'); }}>
                  {t('docs.reopenSuccessor')}
                </button>
              ) : null}

              {selected.status === 'draft' ? (
                <div className="grid gap-2">
                  <input className={adminFieldClass} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
                  <textarea className={adminFieldClass} rows={2} placeholder={t('docs.internalNotes')} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
                  <input type="date" className={adminFieldClass} value={form.meeting_date} onChange={(e) => setForm({ ...form, meeting_date: e.target.value })} />
                  <input type="time" className={adminFieldClass} value={form.meeting_time} onChange={(e) => setForm({ ...form, meeting_time: e.target.value })} />
                  <input className={adminFieldClass} placeholder={t('docs.location')} value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
                  <select className={adminFieldClass} value={form.meeting_mode} onChange={(e) => setForm({ ...form, meeting_mode: e.target.value })}>
                    <option value="in_person">{t('docs.formatInPerson')}</option>
                    <option value="hybrid">{t('docs.formatHybrid')}</option>
                  </select>
                  <p className="text-xs text-muted">{form.meeting_mode === 'hybrid' ? t('docs.formatHybridHint') : t('docs.formatInPersonHint')}</p>
                  {form.meeting_mode === 'hybrid' ? (
                    <input className={adminFieldClass} placeholder={t('docs.hybridLink')} value={form.online_meeting_url} onChange={(e) => setForm({ ...form, online_meeting_url: e.target.value })} />
                  ) : null}
                  <label className="grid gap-1 text-sm text-foreground">
                    <span className="flex items-center gap-2">
                      <input type="checkbox" className="accent-accent" checked={form.is_urgent} onChange={(e) => setForm({ ...form, is_urgent: e.target.checked })} />
                      {t('docs.urgentMeeting')}
                    </span>
                    <span className="pl-6 text-xs text-muted">{t('docs.urgentMeetingHint')}</span>
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" className="accent-accent" checked={form.absentee_voting_enabled} onChange={(e) => setForm({ ...form, absentee_voting_enabled: e.target.checked })} />
                    {t('docs.absentee')}
                  </label>
                </div>
              ) : (
                <div className="space-y-1 text-sm text-secondary">
                  <p className="font-medium text-foreground">{selected.title}</p>
                  <p>{formatOwnerDate(selected.meeting_date, locale)}{selected.meeting_time ? ` · ${selected.meeting_time.slice(0, 5)}` : ''}</p>
                  {selected.location ? <p>{selected.location}</p> : null}
                  <p>{selected.meeting_mode === 'hybrid' ? t('docs.formatHybrid') : t('docs.formatInPerson')}</p>
                  {selected.status === 'published' ? (
                    <>
                      <textarea className={`${adminFieldClass} mt-2`} rows={2} placeholder={t('docs.internalNotes')} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
                      <input className={`${adminFieldClass} mt-2`} placeholder={t('docs.hybridLink')} value={form.online_meeting_url} onChange={(e) => setForm({ ...form, online_meeting_url: e.target.value })} />
                    </>
                  ) : selected.description ? (
                    <p>{selected.description}</p>
                  ) : null}
                </div>
              )}

              {canWrite && selected.status === 'draft' ? (
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    <button type="button" disabled={busy} className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" onClick={() => void saveDraft()}>
                      {t('docs.saveChanges')}
                    </button>
                    <button type="button" disabled={busy} className={adminBtnSecondaryClass} onClick={() => void rpcMeeting('publish_general_meeting', selected.id)}>
                      {t('docs.publish')}
                    </button>
                  </div>
                  <div className="border-t border-border pt-3">
                    <button type="button" disabled={busy} className={adminBtnDangerClass} onClick={() => void deleteDraft()}>
                      {t('docs.deleteDraft')}
                    </button>
                  </div>
                </div>
              ) : null}
              {canWrite && selected.status === 'published' ? (
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    <button type="button" disabled={busy} className={adminBtnSecondaryClass} onClick={() => void saveOperationalFields()}>
                      {t('docs.saveChanges')}
                    </button>
                    {isPublishedUpcomingMeeting(selected) ? (
                      <button
                        type="button"
                        className={adminBtnSecondaryClass}
                        onClick={() => {
                          setRescheduleForm({
                            meeting_date: selected.meeting_date.slice(0, 10),
                            meeting_time: (selected.meeting_time ?? '18:30').slice(0, 5),
                            location: selected.location ?? '',
                            meeting_mode: selected.meeting_mode === 'hybrid' ? 'hybrid' : 'in_person',
                            reason: '',
                          });
                          setDialog('reschedule');
                        }}
                      >
                        {t('docs.reschedule')}
                      </button>
                    ) : null}
                    <button type="button" className={adminBtnSecondaryClass} onClick={() => void markHeld()}>
                      {t('docs.markHeld')}
                    </button>
                  </div>
                  {isPublishedUpcomingMeeting(selected) ? (
                    <div className="border-t border-border pt-3">
                      <button type="button" className={adminBtnDangerClass} onClick={() => { setCancelReason(''); setDialog('cancel'); }}>
                        {t('docs.cancelMeeting')}
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}
              {canWrite && selected.status === 'held' ? (
                <div className="flex flex-wrap gap-2">
                  <button type="button" disabled={busy} className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" onClick={() => void rpcMeeting('publish_general_meeting_minutes', selected.id)}>
                    {t('docs.publishMinutes')}
                  </button>
                </div>
              ) : null}
              {['minutes_ready', 'archived'].includes(selected.status) ? <p className="text-sm text-muted">{t('docs.lockedAfterClose')}</p> : null}
            </AdminCard>
          ) : null}

          {detailTab === 'agenda' ? (
            <AdminCard pad className="space-y-3">
              {agenda.filter((a) => a.meeting_id === selected.id).length === 0 ? (
                <AdminEmptyState title={t('docs.agendaTitle')} />
              ) : (
                <AdminTableShell>
                  <table className="w-full min-w-[640px] text-sm">
                    <thead>
                      <tr className={adminTableHeadRowClass}>
                        <th className={adminTableCellClass}>№</th>
                        <th className={adminTableCellClass}>{t('account.subject')}</th>
                        <th className={adminTableCellClass}>{t('docs.gmMajority')}</th>
                        <th className={adminTableCellClass}>{t('admin.status')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {agenda.filter((a) => a.meeting_id === selected.id).map((a) => {
                        const linked = decisions.find((d) => d.agenda_item_id === a.id);
                        const protocol = linked && (linked.protocol_result === 'adopted' || linked.protocol_result === 'rejected' || linked.protocol_result === 'information')
                          ? labelProtocolResult(linked.protocol_result, t)
                          : null;
                        return (
                          <tr key={a.id} className={adminTableRowClass}>
                            <td className={adminTableCellClass}>{a.position}</td>
                            <td className={adminTableCellClass}>
                              <div className="font-medium text-foreground">{a.title}</div>
                              {a.description ? <div className="max-w-md text-xs text-secondary">{a.description}</div> : null}
                            </td>
                            <td className={adminTableCellClass}>{labelMajorityRule(a.majority_rule ?? '', t)}</td>
                            <td className={adminTableCellClass}>
                              <div className="flex flex-wrap gap-1">
                                <StatusBadge label={agendaVoteLabel(a.voting_status)} tone={a.voting_status === 'open' ? 'info' : a.voting_status === 'closed' ? 'success' : 'neutral'} />
                                {protocol ? <StatusBadge label={protocol} tone={linked?.protocol_result === 'adopted' ? 'success' : linked?.protocol_result === 'rejected' ? 'danger' : 'neutral'} /> : null}
                              </div>
                              {a.voting_status === 'closed' ? (
                                <p className="mt-1 text-xs text-secondary">
                                  {t('docs.voteFor')}: {formatIdealPartsPercent(a.for_percent, locale) == null ? '—' : `${formatIdealPartsPercent(a.for_percent, locale)}%`} · {t('docs.voteAgainst')}: {formatIdealPartsPercent(a.against_percent, locale) == null ? '—' : `${formatIdealPartsPercent(a.against_percent, locale)}%`} · {t('docs.voteAbstain')}: {formatIdealPartsPercent(a.abstain_percent, locale) == null ? '—' : `${formatIdealPartsPercent(a.abstain_percent, locale)}%`}
                                </p>
                              ) : null}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </AdminTableShell>
              )}
              {canWrite && selected.status === 'draft' ? (
                <div className="grid gap-2">
                  <input className={adminFieldClass} value={agendaTitle} onChange={(e) => setAgendaTitle(e.target.value)} />
                  <select className={adminFieldClass} value={majorityRule} onChange={(e) => setMajorityRule(e.target.value)}>
                    {MAJORITY_PRESETS.map((p) => (
                      <option key={p.id} value={p.id}>{t(p.labelKey)}</option>
                    ))}
                  </select>
                  <button type="button" className={adminBtnSecondaryClass} onClick={() => void addAgenda()}>
                    {t('docs.addAgenda')}
                  </button>
                </div>
              ) : null}
            </AdminCard>
          ) : null}

          {detailTab === 'participants' ? (
            <AdminCard pad className="space-y-3">
              {parts ? <p className="text-sm text-secondary">{t('docs.representedRaw', { n: parts })}</p> : null}
              {participants.filter((p) => p.meeting_id === selected.id).length === 0 ? (
                <AdminEmptyState title={t('docs.tabParticipants')} />
              ) : (
                <>
                  <div className="space-y-2 md:hidden">
                    {participants.filter((p) => p.meeting_id === selected.id).map((p) => (
                      <div key={p.id} className="rounded-[14px] border border-border px-3 py-2 text-sm">
                        <div className="font-medium text-foreground">{p.property_number_snapshot || '—'} · {p.participant_name}</div>
                        <div className="mt-1 text-xs text-muted">
                          {labelAttendanceStatus(p.attendance_status ?? '', t)}
                          {p.representation_type === 'proxy' ? ` · ${t('docs.representation')}${p.representative_name ? `: ${p.representative_name}` : ''}` : ''}
                          {` · ${formatIdealPartsPercent(p.ideal_parts_percent_snapshot, locale) == null ? '—' : `${formatIdealPartsPercent(p.ideal_parts_percent_snapshot, locale)}%`}`}
                        </div>
                      </div>
                    ))}
                  </div>
                  <AdminTableShell className="hidden md:block">
                    <table className="w-full min-w-[640px] text-sm">
                      <thead>
                        <tr className={adminTableHeadRowClass}>
                          <th className={adminTableCellClass}>{t('admin.aptLabel')}</th>
                          <th className={adminTableCellClass}>{t('admin.status')}</th>
                          <th className={adminTableCellClass}>{t('docs.representation')}</th>
                          <th className={adminTableCellClass}>{t('docs.idealParts')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {participants.filter((p) => p.meeting_id === selected.id).map((p) => (
                          <tr key={p.id} className={adminTableRowClass}>
                            <td className={adminTableCellClass}>
                              <div className="font-medium text-foreground">{p.property_number_snapshot || '—'}</div>
                              <div className="text-xs text-muted">{p.participant_name}</div>
                            </td>
                            <td className={adminTableCellClass}>
                              <StatusBadge label={labelAttendanceStatus(p.attendance_status ?? '', t)} tone={p.attendance_status === 'confirmed' ? 'success' : p.attendance_status === 'rejected' ? 'danger' : 'warning'} />
                            </td>
                            <td className={adminTableCellClass}>
                              {p.representation_type === 'proxy'
                                ? `${t('docs.representation')}${p.representative_name ? `: ${p.representative_name}` : ''}`
                                : t('docs.self')}
                            </td>
                            <td className={adminTableCellClass}>{formatIdealPartsPercent(p.ideal_parts_percent_snapshot, locale) == null ? '—' : `${formatIdealPartsPercent(p.ideal_parts_percent_snapshot, locale)}%`}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </AdminTableShell>
                </>
              )}
              {canWrite && ['published', 'held'].includes(selected.status) ? (
                <div className="grid gap-2">
                  <ApartmentCombobox
                    properties={properties}
                    value={partForm.property_id ? Number(partForm.property_id) : ''}
                    onChange={(id) => setPartForm({ ...partForm, property_id: id === '' ? '' : String(id) })}
                  />
                  <input className={adminFieldClass} placeholder={t('docs.addParticipant')} value={partForm.name} onChange={(e) => setPartForm({ ...partForm, name: e.target.value })} />
                  <select className={adminFieldClass} value={partForm.representation} onChange={(e) => setPartForm({ ...partForm, representation: e.target.value })}>
                    <option value="self">{t('docs.self')}</option>
                    <option value="proxy">{t('docs.representation')}</option>
                  </select>
                  {partForm.representation === 'proxy' ? (
                    <input className={adminFieldClass} value={partForm.representative} onChange={(e) => setPartForm({ ...partForm, representative: e.target.value })} />
                  ) : null}
                  <button type="button" className={adminBtnSecondaryClass} onClick={() => void addParticipant()}>
                    {t('docs.addParticipant')}
                  </button>
                </div>
              ) : null}
            </AdminCard>
          ) : null}

          <div className={detailTab === 'conduct' ? 'block' : 'hidden'}>
            <AdminMeetingConduct
              supabase={supabase}
              meeting={selected}
              agenda={agenda}
              participants={participants}
              decisions={decisions}
              votes={votes}
              properties={properties}
              canWrite={canWrite}
              locale={locale}
              t={t}
              onReload={load}
              onError={setError}
            />
          </div>

          {detailTab === 'documents' ? (
            <AdminCard pad className="space-y-3">
              <input
                ref={meetingFileInputRef}
                type="file"
                accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  const type = pendingFileType;
                  e.target.value = '';
                  setPendingFileType(null);
                  if (file && type) void uploadMeetingFile(file, type);
                }}
              />
              {(['invitation', 'agenda', 'minutes'] as MeetingFileType[]).map((type) => (
                <MeetingFileSlot
                  key={type}
                  type={type}
                  label={labelFileType(type, t)}
                  links={files.filter((f) => f.meeting_id === selected.id && f.file_type === type)}
                  docs={docs}
                  canWrite={canWrite && !['minutes_ready', 'archived', 'rescheduled'].includes(selected.status)}
                  busy={busy}
                  t={t}
                  onUpload={() => {
                    setPendingFileType(type);
                    meetingFileInputRef.current?.click();
                  }}
                  onOpen={(doc) => void openStoredDocument(doc)}
                  onDelete={(link, doc) => void removeDraftMeetingFile(link, doc)}
                />
              ))}
              <button type="button" className={adminBtnTertiaryClass} onClick={() => setExtraFilesOpen((v) => !v)}>
                {t('docs.extraMeetingFiles')}
              </button>
              {extraFilesOpen
                ? (['appendix', 'proxy', 'absentee_declaration', 'cancellation_notice'] as MeetingFileType[]).map((type) => (
                    <MeetingFileSlot
                      key={type}
                      type={type}
                      label={labelFileType(type, t)}
                      links={files.filter((f) => f.meeting_id === selected.id && f.file_type === type)}
                      docs={docs}
                      canWrite={canWrite && !['minutes_ready', 'archived', 'rescheduled'].includes(selected.status)}
                      busy={busy}
                      t={t}
                      onUpload={() => {
                        setPendingFileType(type);
                        meetingFileInputRef.current?.click();
                      }}
                      onOpen={(doc) => void openStoredDocument(doc)}
                      onDelete={(link, doc) => void removeDraftMeetingFile(link, doc)}
                    />
                  ))
                : null}
              <div>
                <p className="text-sm font-semibold">{t('docs.tabDecisions')}</p>
                {decisions.filter((d) => d.meeting_id === selected.id).length === 0 ? (
                  <p className="mt-1 text-sm text-muted">{t('docs.tabDecisions')}</p>
                ) : decisions.filter((d) => d.meeting_id === selected.id).map((d) => (
                  <div key={d.id} className="mt-2 text-sm">
                    <p className="font-medium text-foreground">{d.decision_number}. {d.title}</p>
                    <p className="text-secondary">{d.decision_text}</p>
                    <StatusBadge
                      label={(d.protocol_result === 'adopted' || d.protocol_result === 'rejected' || d.protocol_result === 'information') ? labelProtocolResult(d.protocol_result, t) : t('admin.valueUnknown')}
                      tone={d.protocol_result === 'adopted' ? 'success' : d.protocol_result === 'rejected' ? 'danger' : 'neutral'}
                    />
                  </div>
                ))}
                {canWrite && selected.status === 'held' ? (
                  <div className="mt-2 grid gap-2">
                    <input className={adminFieldClass} placeholder="№" value={decisionForm.number} onChange={(e) => setDecisionForm({ ...decisionForm, number: e.target.value })} />
                    <input className={adminFieldClass} placeholder={t('docs.decision')} value={decisionForm.title} onChange={(e) => setDecisionForm({ ...decisionForm, title: e.target.value })} />
                    <textarea className={adminFieldClass} rows={3} value={decisionForm.text} onChange={(e) => setDecisionForm({ ...decisionForm, text: e.target.value })} />
                    <select className={adminFieldClass} value={decisionForm.result} onChange={(e) => setDecisionForm({ ...decisionForm, result: e.target.value })}>
                      <option value="adopted">{t('docs.adopted')}</option>
                      <option value="rejected">{t('docs.rejected')}</option>
                      <option value="information">{t('docs.information')}</option>
                    </select>
                    <button type="button" className={adminBtnSecondaryClass} onClick={() => void addDecision()}>
                      {t('docs.addDecision')}
                    </button>
                  </div>
                ) : null}
              </div>
            </AdminCard>
          ) : null}
        </div>
      ) : null}

      {dialog === 'reschedule' && selected ? (
        <div className={adminModalOverlayClass}>
          <div className={`${adminModalPanelClass} max-w-md`}>
            <div className={adminModalHeaderClass}>
              <p className="text-sm font-semibold">{t('docs.rescheduleTitle')}</p>
            </div>
            <div className="space-y-3 overflow-y-auto px-5 py-4">
              <AdminInlineAlert tone="warning">{t('docs.rescheduleWarning')}</AdminInlineAlert>
              <AdminInlineAlert tone="warning">{t('docs.notifyOwnersReminder')}</AdminInlineAlert>
              <label className="grid gap-1 text-sm">
                {t('docs.newDate')}
                <input type="date" className={adminFieldClass} value={rescheduleForm.meeting_date} onChange={(e) => setRescheduleForm({ ...rescheduleForm, meeting_date: e.target.value })} />
              </label>
              <label className="grid gap-1 text-sm">
                {t('docs.newTime')}
                <input type="time" className={adminFieldClass} value={rescheduleForm.meeting_time} onChange={(e) => setRescheduleForm({ ...rescheduleForm, meeting_time: e.target.value })} />
              </label>
              <label className="grid gap-1 text-sm">
                {t('docs.newLocation')}
                <input className={adminFieldClass} value={rescheduleForm.location} onChange={(e) => setRescheduleForm({ ...rescheduleForm, location: e.target.value })} />
              </label>
              <label className="grid gap-1 text-sm">
                {t('docs.meetingFormat')}
                <select className={adminFieldClass} value={rescheduleForm.meeting_mode} onChange={(e) => setRescheduleForm({ ...rescheduleForm, meeting_mode: e.target.value })}>
                  <option value="in_person">{t('docs.formatInPerson')}</option>
                  <option value="hybrid">{t('docs.formatHybrid')}</option>
                </select>
              </label>
              <label className="grid gap-1 text-sm">
                {t('docs.rescheduleReason')}
                <textarea className={adminFieldClass} rows={3} value={rescheduleForm.reason} onChange={(e) => setRescheduleForm({ ...rescheduleForm, reason: e.target.value })} />
              </label>
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={busy} className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" onClick={() => void rescheduleSelected()}>
                  {t('docs.confirmReschedule')}
                </button>
                <button type="button" className={adminBtnSecondaryClass} onClick={() => setDialog(null)}>
                  {t('common.close')}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {dialog === 'cancel' && selected ? (
        <div className={adminModalOverlayClass}>
          <div className={`${adminModalPanelClass} max-w-md`}>
            <div className={adminModalHeaderClass}>
              <p className="text-sm font-semibold">{t('docs.cancelMeetingTitle')}</p>
            </div>
            <div className="space-y-3 overflow-y-auto px-5 py-4">
              <AdminInlineAlert tone="warning">{t('docs.notifyOwnersReminder')}</AdminInlineAlert>
              <label className="grid gap-1 text-sm">
                {t('docs.cancelReason')} *
                <textarea className={adminFieldClass} rows={4} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
              </label>
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={busy} className={adminBtnDangerClass} onClick={() => void cancelSelected()}>
                  {t('docs.confirmCancel')}
                </button>
                <button type="button" className={adminBtnSecondaryClass} onClick={() => setDialog(null)}>
                  {t('common.close')}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
