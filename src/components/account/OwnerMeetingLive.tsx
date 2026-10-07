'use client';

import { useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { ownerVisibleError } from '@/lib/ownerError';
import { formatIdealPartsPercent } from '@/lib/propertyBook';
import { useI18n } from '@/i18n/I18nProvider';
import {
  formatAgendaLine,
  hybridLinkVisible,
  inPersonRegistrationOpen,
  onlineConfirmOpen,
  type GeneralMeeting,
  type MeetingAgendaItem,
  type MeetingDecision,
  type MeetingParticipant,
  type MeetingVoteRecord,
} from '@/lib/buildingDocuments';
import { labelAttendanceStatus, labelVoteChoice, openAgendaItem, VOTE_CHOICES } from '@/lib/generalMeetingWorkflow';

type Owned = { id: number; apartment_number: string | number | null; ideal_parts_percent?: number | string | null };
type LocalVote = { property_id: number; agenda_item_id: string; vote: string };

export function OwnerMeetingLive({
  supabase,
  meeting,
  agenda,
  participants,
  votes,
  decisions,
  owned,
  onReload,
}: {
  supabase: SupabaseClient<Database>;
  meeting: GeneralMeeting;
  agenda: MeetingAgendaItem[];
  participants: MeetingParticipant[];
  votes: MeetingVoteRecord[];
  decisions: MeetingDecision[];
  owned: Owned[];
  onReload: () => Promise<void>;
}) {
  const { t, locale } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applyAll, setApplyAll] = useState(true);
  const [localVotes, setLocalVotes] = useState<LocalVote[]>([]);
  const mine = participants.filter((p) => owned.some((o) => o.id === p.property_id) && p.meeting_id === meeting.id);
  const confirmed = mine.filter((p) => p.attendance_status === 'confirmed' && !p.left_at);
  const onlineConfirmed = confirmed.filter((p) => p.attendance_mode === 'online');
  const meetingAgenda = agenda.filter((a) => a.meeting_id === meeting.id).sort((a, b) => a.position - b.position);
  const openItem = openAgendaItem(meetingAgenda);
  const earlyVoteItems = meetingAgenda.filter((a) => a.voting_status === 'pending' || a.voting_status === 'open');
  const started = meeting.operational_phase === 'in_progress';
  const canOnlineConfirm = onlineConfirmOpen(meeting) && mine.length === 0;
  const canInPerson =
    meeting.status === 'published'
    && mine.length === 0
    && (onlineConfirmOpen(meeting) || inPersonRegistrationOpen(meeting));
  const canSwitchToOnline =
    onlineConfirmOpen(meeting)
    && mine.some((p) => p.attendance_mode === 'in_person' && !p.left_at);
  const showOnlineVoting = onlineConfirmed.length > 0 && earlyVoteItems.length > 0 && (!started || onlineConfirmed.length === confirmed.length);
  const showLiveVoting = started && openItem && confirmed.length > 0;

  const decisionByAgenda = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of decisions) {
      if (d.meeting_id === meeting.id && d.agenda_item_id) map.set(d.agenda_item_id, d.id);
    }
    return map;
  }, [decisions, meeting.id]);

  function voteFor(propertyId: number, agendaItemId: string) {
    const local = localVotes.find((v) => v.property_id === propertyId && v.agenda_item_id === agendaItemId);
    if (local) return { vote: local.vote };
    const decisionId = decisionByAgenda.get(agendaItemId);
    if (!decisionId) return undefined;
    return votes.find((v) => v.property_id === propertyId && v.decision_id === decisionId && v.meeting_id === meeting.id);
  }

  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await onReload();
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      if (/vote already cast/i.test(raw)) setError(t('docs.voteAlreadyCast'));
      else setError(ownerVisibleError(e, t('err.save')));
      await onReload();
    } finally {
      setBusy(false);
    }
  }

  async function declare(mode: 'in_person' | 'online') {
    await act(async () => {
      for (const property of owned) {
        const { error: rpcErr } = await supabase.rpc('declare_general_meeting_attendance', {
          p_meeting_id: meeting.id,
          p_property_id: property.id,
          p_attendance_mode: mode,
        });
        if (rpcErr) throw new Error(rpcErr.message);
      }
    });
  }

  async function vote(choice: 'for' | 'against' | 'abstain', agendaItemId: string, propertyId?: number) {
    const ids = propertyId ? [propertyId] : confirmed.map((p) => p.property_id);
    await act(async () => {
      for (const id of ids) {
        if (voteFor(id, agendaItemId)) continue;
        const { error: rpcErr } = await supabase.rpc('cast_general_meeting_vote', {
          p_agenda_item_id: agendaItemId,
          p_property_id: id,
          p_vote: choice,
        });
        if (rpcErr) {
          if (/vote already cast/i.test(rpcErr.message)) {
            setLocalVotes((prev) => {
              if (prev.some((v) => v.property_id === id && v.agenda_item_id === agendaItemId)) return prev;
              return [...prev, { property_id: id, agenda_item_id: agendaItemId, vote: choice }];
            });
            continue;
          }
          throw new Error(rpcErr.message);
        }
        setLocalVotes((prev) => {
          const without = prev.filter((v) => !(v.property_id === id && v.agenda_item_id === agendaItemId));
          return [...without, { property_id: id, agenda_item_id: agendaItemId, vote: choice }];
        });
      }
    });
  }

  function renderVoteBlock(item: MeetingAgendaItem) {
    const allVoted = confirmed.every((p) => Boolean(voteFor(p.property_id, item.id)));
    return (
      <div key={item.id} className="space-y-1 rounded-xl border border-border px-3 py-2">
        <p className="text-sm font-medium">{formatAgendaLine(item.position, item.title)}</p>
        {item.proposed_decision_text ? <p className="text-xs text-secondary">{item.proposed_decision_text}</p> : null}
        {confirmed.length > 1 ? (
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={applyAll} onChange={(e) => setApplyAll(e.target.checked)} />
            {t('docs.applyAllProperties')}
          </label>
        ) : null}
        {confirmed.map((p) => {
          const mineVote = voteFor(p.property_id, item.id);
          return (
            <div key={`${item.id}-${p.id}`} className="space-y-1">
              <p className="text-xs text-muted">
                {t('picker.apt', { n: String(p.property_number_snapshot ?? p.property_id) })} · {formatIdealPartsPercent(p.ideal_parts_percent_snapshot, locale)}%
                {mineVote ? ` · ${t('docs.yourVote')}: ${labelVoteChoice(mineVote.vote, t)}` : ''}
              </p>
              {!mineVote && (!applyAll || confirmed.length === 1) ? (
                <div className="flex gap-2">
                  {VOTE_CHOICES.map((choice) => (
                    <button key={choice} type="button" disabled={busy} className="rounded-xl border border-border px-3 py-1.5 text-sm" onClick={() => void vote(choice, item.id, p.property_id)}>
                      {labelVoteChoice(choice, t)}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
        {applyAll && confirmed.length > 1 && !allVoted ? (
          <div className="flex gap-2">
            {VOTE_CHOICES.map((choice) => (
              <button key={choice} type="button" disabled={busy} className="rounded-xl border border-border px-3 py-1.5 text-sm" onClick={() => void vote(choice, item.id)}>
                {labelVoteChoice(choice, t)}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  if (['draft', 'cancelled', 'rescheduled'].includes(meeting.status)) return null;

  return (
    <div className="mt-3 space-y-2 border-t border-border pt-3">
      {error ? <p className="text-xs text-danger">{error}</p> : null}

      {(canOnlineConfirm || canInPerson) ? (
        <div className="space-y-2">
          <p className="text-sm font-medium">{t('docs.statusRegistration')}</p>
          <p className="text-xs text-secondary">{t('docs.youRepresent')}</p>
          {owned.map((o) => (
            <p key={o.id} className="text-xs text-muted">
              {t('picker.apt', { n: String(o.apartment_number) })} — {formatIdealPartsPercent(o.ideal_parts_percent, locale)}%
            </p>
          ))}
          <div className="flex flex-wrap gap-2">
            {canInPerson ? (
              <button type="button" disabled={busy} className="rounded-xl border border-border px-3 py-2 text-sm" onClick={() => void declare('in_person')}>
                {t('docs.attendInPerson')}
              </button>
            ) : null}
            {canOnlineConfirm ? (
              <button type="button" disabled={busy} className="rounded-xl border border-border px-3 py-2 text-sm" onClick={() => void declare('online')}>
                {t('docs.attendOnline')}
              </button>
            ) : null}
          </div>
          {canOnlineConfirm ? <p className="text-xs text-muted">{t('docs.onlineConfirmHint')}</p> : null}
          {canInPerson ? <p className="text-xs text-muted">{t('docs.inPersonRegHint')}</p> : null}
        </div>
      ) : null}

      {meeting.status === 'published' && meeting.meeting_mode === 'hybrid' && mine.length === 0 && !canOnlineConfirm ? (
        <p className="text-xs text-muted">{t('docs.onlineConfirmClosed')}</p>
      ) : null}
      {meeting.status === 'published' && mine.length === 0 && !canInPerson && !inPersonRegistrationOpen(meeting) ? (
        <p className="text-xs text-muted">{t('docs.inPersonRegClosed')}</p>
      ) : null}

      {mine.map((p) => (
        <p key={p.id} className="text-xs text-secondary">
          {t('picker.apt', { n: String(p.property_number_snapshot ?? p.property_id) })} · {labelAttendanceStatus(p.attendance_status ?? '', t)}
          {p.attendance_mode === 'online' ? ` · ${t('docs.modeOnline')}` : ` · ${t('docs.modeInPerson')}`}
        </p>
      ))}

      {canSwitchToOnline ? (
        <div className="space-y-1">
          <button type="button" disabled={busy} className="rounded-xl border border-border px-3 py-2 text-sm" onClick={() => void declare('online')}>
            {t('docs.switchToOnline')}
          </button>
          <p className="text-xs text-muted">{t('docs.switchToOnlineHint')}</p>
        </div>
      ) : null}
      {mine.some((p) => p.attendance_mode === 'online') ? (
        <p className="text-xs text-muted">{t('docs.onlineLockedHint')}</p>
      ) : null}

      {onlineConfirmed.length > 0 && !started ? (
        <p className="text-xs text-muted">{t('docs.onlineConfirmedCanVote')}</p>
      ) : null}
      {confirmed.some((p) => p.attendance_mode === 'in_person') && !started ? (
        <p className="text-xs text-muted">{t('docs.waitingStart')}</p>
      ) : null}
      {started ? <p className="text-sm font-medium">{t('docs.statusInProgress')}</p> : null}

      {hybridLinkVisible(meeting) && mine.some((p) => p.attendance_mode === 'online') ? (
        <button
          type="button"
          className="text-xs text-accent hover:underline"
          onClick={() => void act(async () => {
            const { data, error: rpcErr } = await supabase.rpc('get_general_meeting_online_join_url', { p_meeting_id: meeting.id });
            if (rpcErr) throw new Error(rpcErr.message);
            if (data) window.open(String(data), '_blank', 'noopener,noreferrer');
          })}
        >
          {t('docs.joinOnline')}
        </button>
      ) : null}

      {showOnlineVoting && !started ? (
        <div className="space-y-3">{earlyVoteItems.map((item) => renderVoteBlock(item))}</div>
      ) : null}

      {started && !openItem ? <p className="text-xs text-muted">{t('docs.waitingQuestion')}</p> : null}
      {showLiveVoting && openItem ? renderVoteBlock(openItem) : null}
    </div>
  );
}
