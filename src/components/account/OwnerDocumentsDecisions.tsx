'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { useI18n } from '@/i18n/I18nProvider';
import { formatIdealPartsPercent } from '@/lib/propertyBook';
import { formatOwnerDate } from '@/lib/ownerFormat';
import { isMissingRelation } from '@/lib/polls';
import {
  BUILDING_DOCUMENTS_BUCKET,
  OWNER_DOC_GROUPS,
  currentPublishedDocuments,
  formatAgendaLine,
  isUpcomingMeeting,
  labelDocGroup,
  labelFileType,
  labelProtocolResult,
  successorMeeting,
  type BuildingDocument,
  type GeneralMeeting,
  type MeetingAgendaItem,
  type MeetingDecision,
  type MeetingFileLink,
} from '@/lib/buildingDocuments';
import { OwnerMeetingLive } from '@/components/account/OwnerMeetingLive';
import { EmptyState, PillTabs, SectionHeader } from '@/components/account/ownerUi';
import { OWNER_MEETING_COLUMNS, labelMeetingWorkflowStatus } from '@/lib/generalMeetingWorkflow';

type Tab = 'meetings' | 'decisions' | 'documents';

function fmtWhen(meeting: GeneralMeeting, locale: string) {
  const date = formatOwnerDate(meeting.meeting_date, locale);
  const time = meeting.meeting_time ? meeting.meeting_time.slice(0, 5) : null;
  return time ? `${date} · ${time}` : date;
}

export function OwnerDocumentsDecisions({
  supabase,
  meetingsEnabled = true,
  documentsEnabled = true,
}: {
  supabase: SupabaseClient<Database>;
  meetingsEnabled?: boolean;
  documentsEnabled?: boolean;
}) {
  const { t, dateLocale, locale } = useI18n();
  const [tab, setTab] = useState<Tab>(meetingsEnabled ? 'meetings' : documentsEnabled ? 'documents' : 'meetings');
  const [meetings, setMeetings] = useState<GeneralMeeting[]>([]);
  const [agenda, setAgenda] = useState<MeetingAgendaItem[]>([]);
  const [decisions, setDecisions] = useState<MeetingDecision[]>([]);
  const [files, setFiles] = useState<MeetingFileLink[]>([]);
  const [docs, setDocs] = useState<BuildingDocument[]>([]);
  const [participants, setParticipants] = useState<import('@/lib/buildingDocuments').MeetingParticipant[]>([]);
  const [votes, setVotes] = useState<import('@/lib/buildingDocuments').MeetingVoteRecord[]>([]);
  const [owned, setOwned] = useState<{ id: number; apartment_number: string | number | null; ideal_parts_percent?: number | string | null }[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [decisionId, setDecisionId] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'adopted' | 'rejected'>('all');
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const [mRes, aRes, dRes, fRes, docRes, pRes, vRes, propRes] = await Promise.all([
      supabase.from('general_meetings').select(OWNER_MEETING_COLUMNS).order('meeting_date', { ascending: false }),
      supabase.from('general_meeting_agenda_items').select('*').order('position', { ascending: true }),
      supabase.from('general_meeting_decisions').select('*').order('created_at', { ascending: false }),
      supabase.from('general_meeting_files').select('*'),
      supabase.from('building_documents').select('*').eq('status', 'published').order('document_date', { ascending: false }),
      supabase.from('general_meeting_participants').select('*'),
      supabase.from('general_meeting_votes').select('*'),
      supabase.from('properties').select('id,apartment_number,ideal_parts_percent'),
    ]);
    if (mRes.error) {
      if (isMissingRelation(mRes.error, 'general_meetings')) {
        setMeetings([]);
        setAgenda([]);
        setDecisions([]);
        setFiles([]);
        setDocs([]);
        return;
      }
      setError(mRes.error.message);
      return;
    }
    setMeetings((mRes.data as GeneralMeeting[]) ?? []);
    if (!aRes.error) setAgenda((aRes.data as MeetingAgendaItem[]) ?? []);
    if (!dRes.error) setDecisions((dRes.data as MeetingDecision[]) ?? []);
    if (!fRes.error) setFiles((fRes.data as MeetingFileLink[]) ?? []);
    if (!docRes.error) setDocs((docRes.data as BuildingDocument[]) ?? []);
    if (!pRes.error) setParticipants((pRes.data as import('@/lib/buildingDocuments').MeetingParticipant[]) ?? []);
    if (!vRes.error) setVotes((vRes.data as import('@/lib/buildingDocuments').MeetingVoteRecord[]) ?? []);
    if (!propRes.error) setOwned(propRes.data ?? []);
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  async function openDocument(doc: BuildingDocument | undefined) {
    if (!doc) {
      setFileError(t('docs.fileUnavailable'));
      return;
    }
    setFileError(null);
    const { data, error: signErr } = await supabase.storage
      .from(BUILDING_DOCUMENTS_BUCKET)
      .createSignedUrl(doc.storage_path, 60);
    if (signErr || !data?.signedUrl) {
      setFileError(t('docs.fileUnavailable'));
      return;
    }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  }

  function fileOf(meetingId: string, type: string) {
    const link = files.find((f) => f.meeting_id === meetingId && f.file_type === type);
    if (!link) return undefined;
    return docs.find((d) => d.id === link.document_id) ?? undefined;
  }

  const upcoming = meetings.filter((m) => isUpcomingMeeting(m));
  const past = meetings.filter((m) => !isUpcomingMeeting(m));
  const publishedDocs = currentPublishedDocuments(docs.filter((d) => d.category !== 'meeting_related'));

  const filteredDecisions = useMemo(() => {
    const q = query.trim().toLowerCase();
    return decisions.filter((d) => {
      if (filter === 'adopted' && d.protocol_result !== 'adopted') return false;
      if (filter === 'rejected' && d.protocol_result !== 'rejected') return false;
      if (!q) return true;
      return `${d.title} ${d.decision_text} ${d.decision_number}`.toLowerCase().includes(q);
    });
  }, [decisions, filter, query]);

  const tabs: { id: Tab; label: string }[] = [
    ...(meetingsEnabled
      ? [
          { id: 'meetings' as const, label: t('docs.tabMeetings') },
          { id: 'decisions' as const, label: t('docs.tabDecisions') },
        ]
      : []),
    ...(documentsEnabled ? [{ id: 'documents' as const, label: t('docs.tabDocuments') }] : []),
  ];

  useEffect(() => {
    const allowed: Tab[] = [];
    if (meetingsEnabled) {
      allowed.push('meetings', 'decisions');
    }
    if (documentsEnabled) allowed.push('documents');
    if (allowed.length > 0 && !allowed.includes(tab)) setTab(allowed[0]);
  }, [meetingsEnabled, documentsEnabled, tab]);

  function meetingCard(m: GeneralMeeting, upcomingCard: boolean) {
    const items = agenda.filter((a) => a.meeting_id === m.id);
    const adopted = decisions.filter((d) => d.meeting_id === m.id && d.protocol_result === 'adopted');
    const parts = formatIdealPartsPercent(m.represented_ideal_parts_percent, locale);
    const open = openId === m.id;
    const successor = successorMeeting(meetings, m.id);
    const invitation = fileOf(m.id, 'invitation');
    const cancellationNotice = fileOf(m.id, 'cancellation_notice');
    const agendaDocument = fileOf(m.id, 'agenda');
    const minutes = fileOf(m.id, 'minutes');
    const appendix = fileOf(m.id, 'appendix');
    return (
      <article key={m.id} className="rounded-xl border border-border bg-background px-3 py-3">
        <p className="text-sm font-medium text-foreground">{m.title || t('docs.generalMeeting')}</p>
        <p className="mt-0.5 text-sm text-secondary">{fmtWhen(m, dateLocale)}</p>
        {m.location ? <p className="text-xs text-muted">{m.location}</p> : null}
        <p className="mt-1 text-xs text-muted">{labelMeetingWorkflowStatus(m, t, upcomingCard)}</p>
        {m.status === 'cancelled' && m.cancellation_reason ? (
          <p className="mt-1 text-xs text-secondary">{t('docs.cancelReason')}: {m.cancellation_reason}</p>
        ) : null}
        {m.status === 'rescheduled' && successor && successor.status !== 'draft' ? (
          <div className="mt-1 text-xs text-secondary">
            <p>{t('docs.wasOn')}: {fmtWhen(m, dateLocale)}</p>
            <p>{t('docs.newDate')}: {fmtWhen(successor, dateLocale)}</p>
            <button type="button" className="mt-1 text-accent hover:underline" onClick={() => setOpenId(successor.id)}>
              {t('docs.reopenSuccessor')}
            </button>
          </div>
        ) : m.status === 'rescheduled' ? (
          <p className="mt-1 text-xs text-secondary">{t('docs.wasOn')}: {fmtWhen(m, dateLocale)}</p>
        ) : null}
        {upcomingCard && items.length > 0 ? (
          <p className="mt-1 text-xs text-secondary">{t('docs.agendaCount', { n: items.length })}</p>
        ) : null}
        {!upcomingCard && parts ? (
          <p className="mt-1 text-xs text-secondary">{t('docs.represented', { n: parts })}</p>
        ) : null}
        {!upcomingCard && adopted.length > 0 ? (
          <p className="mt-0.5 text-xs text-secondary">{t('docs.decisionsCount', { n: adopted.length })}</p>
        ) : null}
        <div className="mt-2 flex flex-wrap gap-2">
          {upcomingCard ? (
            <>
              {invitation ? (
                <button type="button" className="text-xs text-accent hover:underline" onClick={() => void openDocument(invitation)}>
                  {t('docs.invitation')}
                </button>
              ) : null}
              {agendaDocument ? (
                <button type="button" className="text-xs text-accent hover:underline" onClick={() => void openDocument(agendaDocument)}>
                  {t('docs.agendaTitle')}
                </button>
              ) : null}
            </>
          ) : m.status === 'cancelled' ? (
            invitation || cancellationNotice ? (
              <button type="button" className="text-xs text-accent hover:underline" onClick={() => void openDocument(invitation ?? cancellationNotice)}>
                {t('docs.invitation')}
              </button>
            ) : null
          ) : (
            <>
              {minutes ? (
                <button type="button" className="text-xs text-accent hover:underline" onClick={() => void openDocument(minutes)}>
                  {t('docs.minutes')}
                </button>
              ) : null}
              <button type="button" className="text-xs text-accent hover:underline" onClick={() => { setTab('decisions'); }}>
                {t('docs.tabDecisions')}
              </button>
              {appendix ? (
                <button type="button" className="text-xs text-accent hover:underline" onClick={() => void openDocument(appendix)}>
                  {t('docs.appendices')}
                </button>
              ) : null}
            </>
          )}
          <button type="button" className="text-xs text-accent hover:underline" onClick={() => setOpenId(open ? null : m.id)}>
            {t('docs.details')}
          </button>
        </div>
        {open ? (
          <div className="mt-3 space-y-2 border-t border-border pt-3 text-sm">
            {m.description ? <p className="text-secondary">{m.description}</p> : null}
            {items.length > 0 ? (
              <ol className="space-y-1 pl-0 text-secondary">
                {items.map((item) => (
                  <li key={item.id}>{formatAgendaLine(item.position, item.title)}</li>
                ))}
              </ol>
            ) : null}
            <OwnerMeetingLive
              supabase={supabase}
              meeting={m}
              agenda={agenda}
              participants={participants}
              votes={votes}
              owned={owned}
              onReload={load}
            />
            {files
              .filter((f) => f.meeting_id === m.id)
              .map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className="block text-xs text-accent hover:underline"
                  onClick={() => void openDocument(docs.find((d) => d.id === f.document_id))}
                >
                  {labelFileType(f.file_type, t)}
                  {f.title ? ` · ${f.title}` : ''}
                </button>
              ))}
          </div>
        ) : null}
      </article>
    );
  }

  return (
    <div className="space-y-4">
      <SectionHeader title={t('account.docsMenu')} />
      <PillTabs items={tabs} value={tab} onChange={setTab} />
      {error ? <p className="text-sm text-danger">{t('docs.loadFail')}</p> : null}
      {fileError ? <p className="text-sm text-danger">{fileError}</p> : null}

      {tab === 'meetings' ? (
        <div className="space-y-4">
          <section className="rounded-[14px] border border-border bg-surface shadow-card p-4 md:p-5">
            <h3 className="text-sm font-semibold text-foreground">{t('docs.upcoming')}</h3>
            <div className="mt-3 grid gap-2">
              {upcoming.length === 0 ? <EmptyState title={t('docs.emptyMeetings')} /> : upcoming.map((m) => meetingCard(m, true))}
            </div>
          </section>
          <section className="rounded-[14px] border border-border bg-surface shadow-card p-4 md:p-5">
            <h3 className="text-sm font-semibold text-foreground">{t('docs.past')}</h3>
            <div className="mt-3 grid gap-2">
              {past.length === 0 ? <EmptyState title={t('docs.emptyMeetings')} /> : past.map((m) => meetingCard(m, false))}
            </div>
          </section>
        </div>
      ) : null}

      {tab === 'decisions' ? (
        <section className="rounded-[14px] border border-border bg-surface shadow-card p-4 md:p-5">
          <PillTabs
            items={[
              { id: 'all', label: t('docs.filterAll') },
              { id: 'adopted', label: t('docs.filterAdopted') },
              { id: 'rejected', label: t('docs.filterRejected') },
            ]}
            value={filter}
            onChange={setFilter}
          />
          <input
            className="mt-3 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            placeholder={t('docs.search')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="mt-3 grid gap-2">
            {filteredDecisions.length === 0 ? <EmptyState title={t('docs.emptyDecisions')} /> : null}
            {filteredDecisions.map((d) => {
              const meeting = meetings.find((m) => m.id === d.meeting_id);
              const minutes = fileOf(d.meeting_id, 'minutes');
              const open = decisionId === d.id;
              return (
                <article key={d.id} className="rounded-xl border border-border bg-background px-3 py-3">
                  <p className="text-xs text-muted">
                    {t('docs.decisionN', { n: d.decision_number })}
                    {meeting ? ` · ${formatOwnerDate(meeting.meeting_date, dateLocale)}` : ''}
                  </p>
                  <p className="mt-0.5 text-sm font-medium text-foreground">{d.title}</p>
                  <p className="mt-0.5 text-xs text-muted">{labelProtocolResult(d.protocol_result, t)}</p>
                  <p className="mt-1 line-clamp-2 text-sm text-secondary">{d.decision_text}</p>
                  <button type="button" className="mt-2 text-xs text-accent hover:underline" onClick={() => setDecisionId(open ? null : d.id)}>
                    {t('docs.details')}
                  </button>
                  {open ? (
                    <div className="mt-3 space-y-1 border-t border-border pt-3 text-sm text-secondary">
                      <p className="whitespace-pre-wrap text-foreground">{d.decision_text}</p>
                      {meeting ? <p>{meeting.title}</p> : null}
                      {minutes ? (
                        <button
                          type="button"
                          className="text-xs text-accent hover:underline"
                          onClick={() => void openDocument(minutes)}
                        >
                          {t('docs.openMinutes')}
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      {tab === 'documents' ? (
        <section className="rounded-[14px] border border-border bg-surface shadow-card p-4 md:p-5">
          <h3 className="text-sm font-semibold text-foreground">{t('docs.houseDocs')}</h3>
          <div className="mt-3 space-y-4">
            {OWNER_DOC_GROUPS.map((group) => {
              const rows = publishedDocs.filter((d) => group.categories.includes(d.category as never));
              return (
                <div key={group.id}>
                  <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted">{labelDocGroup(group.id, t)}</p>
                  <div className="mt-2 grid gap-2">
                    {rows.length === 0 ? <EmptyState title={t('docs.emptyDocs')} /> : null}
                    {rows.map((d) => (
                      <article key={d.id} className="rounded-xl border border-border bg-background px-3 py-3">
                        <p className="text-sm font-medium text-foreground">{d.title}</p>
                        <p className="mt-0.5 text-xs text-muted">{t('docs.version', { n: d.version })}</p>
                        {d.document_date ? (
                          <p className="text-xs text-secondary">{formatOwnerDate(d.document_date, dateLocale)}</p>
                        ) : null}
                        <p className="text-xs text-muted">{d.mime_type?.includes('pdf') ? t('docs.pdf') : d.mime_type || t('docs.pdf')}</p>
                        <button type="button" className="mt-2 text-sm text-accent hover:underline" onClick={() => void openDocument(d)}>
                          {t('docs.open')}
                        </button>
                      </article>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}
