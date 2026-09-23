'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { useI18n } from '@/i18n/I18nProvider';
import type { Translate } from '@/i18n/translate';
import { isMissingRelation } from '@/lib/polls';
import { formatIdealPartsPercent } from '@/lib/propertyBook';
import {
  BUILDING_DOCUMENTS_BUCKET,
  buildPrivateStoragePath,
  canManageBuildingGovernance,
  fileKindLabel,
  formatAgendaLine,
  formatStoredFileSize,
  invitationTimingWarning,
  isPublishedUpcomingMeeting,
  isUpcomingMeeting,
  labelFileType,
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
import { MAJORITY_PRESETS, labelMeetingWorkflowStatus } from '@/lib/generalMeetingWorkflow';

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
    <div className="rounded-xl border border-border bg-background px-3 py-3">
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
              <button type="button" className="text-xs text-accent hover:underline" onClick={() => onOpen(doc)}>
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
          className="mt-2 rounded-lg border border-border px-3 py-1.5 text-sm text-secondary disabled:opacity-50"
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
}: {
  supabase: SupabaseClient<Database>;
  properties: PropertyOption[];
  staffRole: string;
  staffActive: boolean;
}) {
  const { t, locale } = useI18n();
  const canWrite = canManageBuildingGovernance(staffRole, staffActive);
  const [tab, setTab] = useState<'meetings' | 'documents'>('meetings');
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
        status: 'draft',
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
    const { error: updErr } = await supabase.from('general_meetings').update({ status: 'held' }).eq('id', selected.id);
    if (updErr) setError(updErr.message);
    else await load();
  }

  const warn = selected ? invitationTimingWarning(selected) : null;
  const minutesWarn = selected ? minutesTimingWarning(selected) : false;
  const parts = selected ? formatIdealPartsPercent(selected.represented_ideal_parts_percent, locale) : null;

  return (
    <div className="space-y-4">
      <div className="flex gap-2 overflow-x-auto">
        <button type="button" className={`rounded-full border px-3 py-1.5 text-sm ${tab === 'meetings' ? 'border-accent bg-accent-bg' : 'border-border'}`} onClick={() => setTab('meetings')}>
          {t('docs.tabMeetings')}
        </button>
        <button type="button" className={`rounded-full border px-3 py-1.5 text-sm ${tab === 'documents' ? 'border-accent bg-accent-bg' : 'border-border'}`} onClick={() => setTab('documents')}>
          {t('docs.tabDocuments')}
        </button>
      </div>
      {!canWrite ? <p className="text-sm text-warning">{t('docs.noWrite')}</p> : null}
      {error ? <p className="text-sm text-danger">{error}</p> : null}

      {tab === 'meetings' ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,18rem)_1fr]">
          <section className="rounded-[14px] border border-border bg-surface p-4 shadow-card">
            {canWrite ? (
              <button type="button" className="mb-3 w-full rounded-xl border border-border px-3 py-2 text-sm" onClick={() => startNewMeeting()}>
                {t('docs.newMeeting')}
              </button>
            ) : null}
            <div className="grid gap-2">
              {meetings.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setSelectedId(m.id)}
                  className={`rounded-xl border px-3 py-2 text-left text-sm ${selectedId === m.id ? 'border-accent bg-accent-bg' : 'border-border'}`}
                >
                  <p className="font-medium">{m.title}</p>
                  <p className="text-xs text-muted">
                    {m.meeting_date} · {labelMeetingWorkflowStatus(m, t, isUpcomingMeeting(m))}
                  </p>
                </button>
              ))}
            </div>
          </section>

          <section className="space-y-3 rounded-[14px] border border-border bg-surface p-4 shadow-card">
            {!selected && canWrite ? (
              <div className="grid gap-2">
                <input className="rounded-lg border border-border px-3 py-2 text-sm" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
                <textarea className="rounded-lg border border-border px-3 py-2 text-sm" rows={2} placeholder={t('docs.internalNotes')} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
                <input type="date" className="rounded-lg border border-border px-3 py-2 text-sm" value={form.meeting_date} onChange={(e) => setForm({ ...form, meeting_date: e.target.value })} />
                <input type="time" className="rounded-lg border border-border px-3 py-2 text-sm" value={form.meeting_time} onChange={(e) => setForm({ ...form, meeting_time: e.target.value })} />
                <input className="rounded-lg border border-border px-3 py-2 text-sm" placeholder={t('docs.location')} value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
                <select className="rounded-lg border border-border px-3 py-2 text-sm" value={form.meeting_mode} onChange={(e) => setForm({ ...form, meeting_mode: e.target.value })}>
                  <option value="in_person">{t('docs.formatInPerson')}</option>
                  <option value="hybrid">{t('docs.formatHybrid')}</option>
                </select>
                <p className="text-xs text-muted">{form.meeting_mode === 'hybrid' ? t('docs.formatHybridHint') : t('docs.formatInPersonHint')}</p>
                {form.meeting_mode === 'hybrid' ? (
                  <input className="rounded-lg border border-border px-3 py-2 text-sm" placeholder={t('docs.hybridLink')} value={form.online_meeting_url} onChange={(e) => setForm({ ...form, online_meeting_url: e.target.value })} />
                ) : null}
                <label className="grid gap-1 text-sm text-foreground">
                  <span className="flex items-center gap-2">
                    <input type="checkbox" className="accent-accent" checked={form.is_urgent} onChange={(e) => setForm({ ...form, is_urgent: e.target.checked })} />
                    {t('docs.urgentMeeting')}
                  </span>
                  <span className="pl-6 text-xs text-muted">{t('docs.urgentMeetingHint')}</span>
                </label>
                <button type="button" disabled={busy} onClick={() => void createMeeting()} className="rounded-xl bg-accent px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
                  {t('docs.createMeeting')}
                </button>
              </div>
            ) : null}

            {selected ? (
              <>
              {selected.status !== 'draft' ? <p className="text-sm text-warning">{t('docs.warnEditPublished')}</p> : null}
              {['rescheduled', 'cancelled'].includes(selected.status) ? <p className="text-sm text-warning">{t('docs.notifyOwnersReminder')}</p> : null}
              {warn === 'ordinary_short' ? <p className="text-sm text-warning">{t('docs.warnOrdinary')}</p> : null}
              {warn === 'urgent_short' ? <p className="text-sm text-warning">{t('docs.warnUrgent')}</p> : null}
              {minutesWarn ? <p className="text-sm text-warning">{t('docs.warnMinutes')}</p> : null}
              {parts ? <p className="text-sm text-secondary">{t('docs.representedRaw', { n: parts })}</p> : null}
              <p className="text-sm font-medium">{labelMeetingWorkflowStatus(selected, t, isUpcomingMeeting(selected))}</p>
              {selected.status === 'cancelled' && selected.cancellation_reason ? (
                <p className="text-sm text-secondary">{t('docs.cancelReason')}: {selected.cancellation_reason}</p>
              ) : null}
              {selected.status === 'rescheduled' && successor && successor.status !== 'draft' ? (
                <button type="button" className="text-sm text-accent hover:underline" onClick={() => setSelectedId(successor.id)}>
                  {t('docs.reopenSuccessor')}
                </button>
              ) : null}

              {selected.status === 'draft' ? (
                <div className="grid gap-2">
                  <input className="rounded-lg border border-border px-3 py-2 text-sm" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
                  <textarea className="rounded-lg border border-border px-3 py-2 text-sm" rows={2} placeholder={t('docs.internalNotes')} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
                  <input type="date" className="rounded-lg border border-border px-3 py-2 text-sm" value={form.meeting_date} onChange={(e) => setForm({ ...form, meeting_date: e.target.value })} />
                  <input type="time" className="rounded-lg border border-border px-3 py-2 text-sm" value={form.meeting_time} onChange={(e) => setForm({ ...form, meeting_time: e.target.value })} />
                  <input className="rounded-lg border border-border px-3 py-2 text-sm" placeholder={t('docs.location')} value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
                  <select className="rounded-lg border border-border px-3 py-2 text-sm" value={form.meeting_mode} onChange={(e) => setForm({ ...form, meeting_mode: e.target.value })}>
                    <option value="in_person">{t('docs.formatInPerson')}</option>
                    <option value="hybrid">{t('docs.formatHybrid')}</option>
                  </select>
                  <p className="text-xs text-muted">{form.meeting_mode === 'hybrid' ? t('docs.formatHybridHint') : t('docs.formatInPersonHint')}</p>
                  {form.meeting_mode === 'hybrid' ? (
                    <input className="rounded-lg border border-border px-3 py-2 text-sm" placeholder={t('docs.hybridLink')} value={form.online_meeting_url} onChange={(e) => setForm({ ...form, online_meeting_url: e.target.value })} />
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
                  <p>{selected.title}</p>
                  <p>{selected.meeting_date}{selected.meeting_time ? ` · ${selected.meeting_time.slice(0, 5)}` : ''}</p>
                  {selected.location ? <p>{selected.location}</p> : null}
                  <p>{selected.meeting_mode === 'hybrid' ? t('docs.formatHybrid') : t('docs.formatInPerson')}</p>
                  {selected.status === 'published' ? (
                    <>
                      <textarea className="mt-2 w-full rounded-lg border border-border px-3 py-2 text-sm" rows={2} placeholder={t('docs.internalNotes')} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
                      <input className="mt-2 w-full rounded-lg border border-border px-3 py-2 text-sm" placeholder={t('docs.hybridLink')} value={form.online_meeting_url} onChange={(e) => setForm({ ...form, online_meeting_url: e.target.value })} />
                    </>
                  ) : selected.description ? (
                    <p>{selected.description}</p>
                  ) : null}
                </div>
              )}

              {canWrite && selected.status === 'draft' ? (
                <div className="flex flex-wrap gap-2">
                  <button type="button" disabled={busy} className="rounded-xl bg-accent px-3 py-2 text-sm text-white" onClick={() => void saveDraft()}>
                    {t('docs.saveChanges')}
                  </button>
                  <button type="button" disabled={busy} className="rounded-xl border border-border px-3 py-2 text-sm" onClick={() => void rpcMeeting('publish_general_meeting', selected.id)}>
                    {t('docs.publish')}
                  </button>
                  <button type="button" disabled={busy} className="rounded-xl border border-danger px-3 py-2 text-sm text-danger" onClick={() => void deleteDraft()}>
                    {t('docs.deleteDraft')}
                  </button>
                </div>
              ) : null}
              {canWrite && selected.status === 'published' ? (
                <div className="flex flex-wrap gap-2">
                  <button type="button" disabled={busy} className="rounded-xl border border-border px-3 py-2 text-sm" onClick={() => void saveOperationalFields()}>
                    {t('docs.saveChanges')}
                  </button>
                  {isPublishedUpcomingMeeting(selected) ? (
                    <>
                      <button
                        type="button"
                        className="rounded-xl border border-border px-3 py-2 text-sm"
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
                      <button type="button" className="rounded-xl border border-danger px-3 py-2 text-sm text-danger" onClick={() => { setCancelReason(''); setDialog('cancel'); }}>
                        {t('docs.cancelMeeting')}
                      </button>
                    </>
                  ) : null}
                  <button type="button" className="rounded-xl border border-border px-3 py-2 text-sm" onClick={() => void markHeld()}>
                    {t('docs.markHeld')}
                  </button>
                </div>
              ) : null}
              {canWrite && selected.status === 'held' ? (
                <div className="flex flex-wrap gap-2">
                  <button type="button" disabled={busy} className="rounded-xl bg-accent px-3 py-2 text-sm text-white" onClick={() => void rpcMeeting('publish_general_meeting_minutes', selected.id)}>
                    {t('docs.publishMinutes')}
                  </button>
                </div>
              ) : null}
              {['minutes_ready', 'archived'].includes(selected.status) ? <p className="text-sm text-muted">{t('docs.lockedAfterClose')}</p> : null}

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

              <div>
                <p className="text-sm font-semibold">{t('docs.agendaTitle')}</p>
                <ul className="mt-1 space-y-1 text-sm text-secondary">
                  {agenda.filter((a) => a.meeting_id === selected.id).map((a) => (
                    <li key={a.id}>{formatAgendaLine(a.position, a.title)}</li>
                  ))}
                </ul>
                {canWrite && selected.status === 'draft' ? (
                  <div className="mt-2 grid gap-2">
                    <input className="flex-1 rounded-lg border border-border px-3 py-2 text-sm" value={agendaTitle} onChange={(e) => setAgendaTitle(e.target.value)} />
                    <select className="rounded-lg border border-border px-3 py-2 text-sm" value={majorityRule} onChange={(e) => setMajorityRule(e.target.value)}>
                      {MAJORITY_PRESETS.map((p) => (
                        <option key={p.id} value={p.id}>{t(p.labelKey)}</option>
                      ))}
                    </select>
                    <button type="button" className="rounded-lg border border-border px-3 py-2 text-sm" onClick={() => void addAgenda()}>
                      {t('docs.addAgenda')}
                    </button>
                  </div>
                ) : null}
              </div>

              <div className="space-y-2">
                  <p className="text-sm font-semibold">{t('docs.meetingFiles')}</p>
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
                  <button type="button" className="text-xs text-accent hover:underline" onClick={() => setExtraFilesOpen((v) => !v)}>
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
                </div>

              <div>
                <p className="text-sm font-semibold">{t('docs.tabDecisions')}</p>
                {decisions.filter((d) => d.meeting_id === selected.id).map((d) => (
                  <p key={d.id} className="text-sm text-secondary">{d.decision_number}. {d.title}</p>
                ))}
                {canWrite && selected.status === 'held' ? (
                  <div className="mt-2 grid gap-2">
                    <input className="rounded-lg border border-border px-3 py-2 text-sm" placeholder="№" value={decisionForm.number} onChange={(e) => setDecisionForm({ ...decisionForm, number: e.target.value })} />
                    <input className="rounded-lg border border-border px-3 py-2 text-sm" placeholder={t('docs.decision')} value={decisionForm.title} onChange={(e) => setDecisionForm({ ...decisionForm, title: e.target.value })} />
                    <textarea className="rounded-lg border border-border px-3 py-2 text-sm" rows={3} value={decisionForm.text} onChange={(e) => setDecisionForm({ ...decisionForm, text: e.target.value })} />
                    <select className="rounded-lg border border-border px-3 py-2 text-sm" value={decisionForm.result} onChange={(e) => setDecisionForm({ ...decisionForm, result: e.target.value })}>
                      <option value="adopted">{t('docs.adopted')}</option>
                      <option value="rejected">{t('docs.rejected')}</option>
                      <option value="information">{t('docs.information')}</option>
                    </select>
                    <button type="button" className="rounded-lg border border-border px-3 py-2 text-sm" onClick={() => void addDecision()}>
                      {t('docs.addDecision')}
                    </button>
                  </div>
                ) : null}
              </div>

              <div>
                <p className="text-sm font-semibold">{t('docs.addParticipant')}</p>
                {participants.filter((p) => p.meeting_id === selected.id).map((p) => (
                  <p key={p.id} className="text-sm text-secondary">
                    {p.property_number_snapshot} · {p.participant_name}
                    {p.representation_type === 'proxy' ? ` · ${t('docs.representation')}` : ''}
                  </p>
                ))}
                {canWrite && ['published', 'held'].includes(selected.status) ? (
                  <div className="mt-2 grid gap-2">
                    <select className="rounded-lg border border-border px-3 py-2 text-sm" value={partForm.property_id} onChange={(e) => setPartForm({ ...partForm, property_id: e.target.value })}>
                      <option value="">—</option>
                      {properties.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.apartment_number} · {p.owner_name}
                        </option>
                      ))}
                    </select>
                    <input className="rounded-lg border border-border px-3 py-2 text-sm" placeholder={t('docs.addParticipant')} value={partForm.name} onChange={(e) => setPartForm({ ...partForm, name: e.target.value })} />
                    <select className="rounded-lg border border-border px-3 py-2 text-sm" value={partForm.representation} onChange={(e) => setPartForm({ ...partForm, representation: e.target.value })}>
                      <option value="self">{t('docs.self')}</option>
                      <option value="proxy">{t('docs.representation')}</option>
                    </select>
                    {partForm.representation === 'proxy' ? (
                      <input className="rounded-lg border border-border px-3 py-2 text-sm" value={partForm.representative} onChange={(e) => setPartForm({ ...partForm, representative: e.target.value })} />
                    ) : null}
                    <button type="button" className="rounded-lg border border-border px-3 py-2 text-sm" onClick={() => void addParticipant()}>
                      {t('docs.addParticipant')}
                    </button>
                  </div>
                ) : null}
              </div>
              </>
            ) : null}
          </section>

          {dialog === 'reschedule' && selected ? (
            <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
              <div className="w-full max-w-md space-y-3 rounded-[14px] border border-border bg-surface p-4 shadow-card">
                <p className="text-sm font-semibold">{t('docs.rescheduleTitle')}</p>
                <p className="text-sm text-warning">{t('docs.rescheduleWarning')}</p>
                <p className="text-sm text-warning">{t('docs.notifyOwnersReminder')}</p>
                <label className="grid gap-1 text-sm">
                  {t('docs.newDate')}
                  <input type="date" className="rounded-lg border border-border px-3 py-2" value={rescheduleForm.meeting_date} onChange={(e) => setRescheduleForm({ ...rescheduleForm, meeting_date: e.target.value })} />
                </label>
                <label className="grid gap-1 text-sm">
                  {t('docs.newTime')}
                  <input type="time" className="rounded-lg border border-border px-3 py-2" value={rescheduleForm.meeting_time} onChange={(e) => setRescheduleForm({ ...rescheduleForm, meeting_time: e.target.value })} />
                </label>
                <label className="grid gap-1 text-sm">
                  {t('docs.newLocation')}
                  <input className="rounded-lg border border-border px-3 py-2" value={rescheduleForm.location} onChange={(e) => setRescheduleForm({ ...rescheduleForm, location: e.target.value })} />
                </label>
                <label className="grid gap-1 text-sm">
                  {t('docs.meetingFormat')}
                  <select className="rounded-lg border border-border px-3 py-2" value={rescheduleForm.meeting_mode} onChange={(e) => setRescheduleForm({ ...rescheduleForm, meeting_mode: e.target.value })}>
                    <option value="in_person">{t('docs.formatInPerson')}</option>
                    <option value="hybrid">{t('docs.formatHybrid')}</option>
                  </select>
                </label>
                <label className="grid gap-1 text-sm">
                  {t('docs.rescheduleReason')}
                  <textarea className="rounded-lg border border-border px-3 py-2" rows={3} value={rescheduleForm.reason} onChange={(e) => setRescheduleForm({ ...rescheduleForm, reason: e.target.value })} />
                </label>
                <div className="flex gap-2">
                  <button type="button" disabled={busy} className="rounded-xl bg-accent px-3 py-2 text-sm text-white" onClick={() => void rescheduleSelected()}>
                    {t('docs.confirmReschedule')}
                  </button>
                  <button type="button" className="rounded-xl border border-border px-3 py-2 text-sm" onClick={() => setDialog(null)}>
                    {t('common.close')}
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {dialog === 'cancel' && selected ? (
            <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
              <div className="w-full max-w-md space-y-3 rounded-[14px] border border-border bg-surface p-4 shadow-card">
                <p className="text-sm font-semibold">{t('docs.cancelMeetingTitle')}</p>
                <p className="text-sm text-warning">{t('docs.notifyOwnersReminder')}</p>
                <label className="grid gap-1 text-sm">
                  {t('docs.cancelReason')} *
                  <textarea className="rounded-lg border border-border px-3 py-2" rows={4} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
                </label>
                <div className="flex gap-2">
                  <button type="button" disabled={busy} className="rounded-xl bg-danger px-3 py-2 text-sm text-white" onClick={() => void cancelSelected()}>
                    {t('docs.confirmCancel')}
                  </button>
                  <button type="button" className="rounded-xl border border-border px-3 py-2 text-sm" onClick={() => setDialog(null)}>
                    {t('common.close')}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <section className="rounded-[14px] border border-border bg-surface p-4 shadow-card">
          {canWrite ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <input className="rounded-lg border border-border px-3 py-2 text-sm" placeholder={t('docs.houseDocs')} value={docForm.title} onChange={(e) => setDocForm({ ...docForm, title: e.target.value })} />
              <select className="rounded-lg border border-border px-3 py-2 text-sm" value={docForm.category} onChange={(e) => setDocForm({ ...docForm, category: e.target.value as DocumentCategory })}>
                <option value="house_rules">{t('docs.catHouseRules')}</option>
                <option value="budget">{t('docs.catBudget')}</option>
                <option value="management">{t('docs.catManagement')}</option>
                <option value="technical">{t('docs.catTechnical')}</option>
                <option value="other">{t('docs.catOther')}</option>
              </select>
              <input type="date" className="rounded-lg border border-border px-3 py-2 text-sm" value={docForm.document_date} onChange={(e) => setDocForm({ ...docForm, document_date: e.target.value })} />
              <input
                type="file"
                className="text-sm"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void uploadHouseDoc(file);
                }}
              />
            </div>
          ) : null}
          <div className="mt-4 grid gap-2">
            {docs.filter((d) => d.category !== 'meeting_related').map((d) => (
              <article key={d.id} className="rounded-xl border border-border px-3 py-3 text-sm">
                <p className="font-medium">{d.title}</p>
                <p className="text-xs text-muted">{d.status} · v{d.version}</p>
                {canWrite && d.status === 'draft' ? (
                  <button
                    type="button"
                    className="mt-1 text-xs text-accent"
                    onClick={async () => {
                      const { error: pubErr } = await supabase.rpc('publish_building_document', { p_document_id: d.id });
                      if (pubErr) setError(pubErr.message);
                      else await load();
                    }}
                  >
                    {t('docs.publishDoc')}
                  </button>
                ) : null}
                {canWrite && d.status === 'published' ? (
                  <button
                    type="button"
                    className="mt-1 text-xs text-danger"
                    onClick={async () => {
                      const { error: archErr } = await supabase.rpc('archive_building_document', { p_document_id: d.id });
                      if (archErr) setError(archErr.message);
                      else await load();
                    }}
                  >
                    {t('docs.archiveDoc')}
                  </button>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
