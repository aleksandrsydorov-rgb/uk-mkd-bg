'use client';

import { useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { ownerVisibleError } from '@/lib/ownerError';
import { formatIdealPartsPercent } from '@/lib/propertyBook';
import { useI18n } from '@/i18n/I18nProvider';
import {
  formatAgendaLine,
  hybridLinkVisible,
  type GeneralMeeting,
  type MeetingAgendaItem,
  type MeetingParticipant,
  type MeetingVoteRecord,
} from '@/lib/buildingDocuments';
import { labelAttendanceStatus, labelVoteChoice, openAgendaItem, VOTE_CHOICES } from '@/lib/generalMeetingWorkflow';

type Owned = { id: number; apartment_number: string | number | null; ideal_parts_percent?: number | string | null };

export function OwnerMeetingLive({
  supabase,
  meeting,
  agenda,
  participants,
  votes,
  owned,
  onReload,
}: {
  supabase: SupabaseClient<Database>;
  meeting: GeneralMeeting;
  agenda: MeetingAgendaItem[];
  participants: MeetingParticipant[];
  votes: MeetingVoteRecord[];
  owned: Owned[];
  onReload: () => Promise<void>;
}) {
  const { t, locale } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applyAll, setApplyAll] = useState(true);
  const mine = participants.filter((p) => owned.some((o) => o.id === p.property_id) && p.meeting_id === meeting.id);
  const confirmed = mine.filter((p) => p.attendance_status === 'confirmed' && !p.left_at);
  const openItem = openAgendaItem(agenda.filter((a) => a.meeting_id === meeting.id));
  const started = meeting.operational_phase === 'in_progress';
  const registration = meeting.operational_phase === 'registration' || started;

  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await onReload();
    } catch (e) {
      setError(ownerVisibleError(e, t('err.save')));
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

  async function vote(choice: 'for' | 'against' | 'abstain', propertyId?: number) {
    if (!openItem) return;
    const ids = propertyId ? [propertyId] : confirmed.map((p) => p.property_id);
    await act(async () => {
      for (const id of ids) {
        const { error: rpcErr } = await supabase.rpc('cast_general_meeting_vote', {
          p_agenda_item_id: openItem.id,
          p_property_id: id,
          p_vote: choice,
        });
        if (rpcErr) throw new Error(rpcErr.message);
      }
    });
  }

  if (['draft', 'cancelled', 'rescheduled'].includes(meeting.status)) return null;

  return (
    <div className="mt-3 space-y-2 border-t border-border pt-3">
      {error ? <p className="text-xs text-danger">{error}</p> : null}
      {registration && mine.length === 0 ? (
        <div className="space-y-2">
          <p className="text-sm font-medium">{t('docs.statusRegistration')}</p>
          <p className="text-xs text-secondary">{t('docs.youRepresent')}</p>
          {owned.map((o) => (
            <p key={o.id} className="text-xs text-muted">
              {t('picker.apt', { n: String(o.apartment_number) })} — {formatIdealPartsPercent(o.ideal_parts_percent, locale)}%
            </p>
          ))}
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy} className="rounded-xl border border-border px-3 py-2 text-sm" onClick={() => void declare('in_person')}>
              {t('docs.attendInPerson')}
            </button>
            {meeting.meeting_mode === 'hybrid' ? (
              <button type="button" disabled={busy} className="rounded-xl border border-border px-3 py-2 text-sm" onClick={() => void declare('online')}>
                {t('docs.attendOnline')}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      {mine.map((p) => (
        <p key={p.id} className="text-xs text-secondary">
          {t('picker.apt', { n: String(p.property_number_snapshot ?? p.property_id) })} · {labelAttendanceStatus(p.attendance_status ?? '', t)}
        </p>
      ))}
      {registration && !started && mine.length > 0 ? <p className="text-xs text-muted">{t('docs.waitingStart')}</p> : null}
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
      {started && !openItem ? <p className="text-xs text-muted">{t('docs.waitingQuestion')}</p> : null}
      {started && openItem && confirmed.length > 0 ? (
        <div className="space-y-2">
          <p className="text-sm font-medium">{formatAgendaLine(openItem.position, openItem.title)}</p>
          {openItem.proposed_decision_text ? <p className="text-xs text-secondary">{openItem.proposed_decision_text}</p> : null}
          {confirmed.length > 1 ? (
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={applyAll} onChange={(e) => setApplyAll(e.target.checked)} />
              {t('docs.applyAllProperties')}
            </label>
          ) : null}
          {confirmed.map((p) => {
            const mineVote = votes.find((v) => v.property_id === p.property_id);
            return (
              <div key={p.id} className="space-y-1">
                <p className="text-xs text-muted">
                  {t('picker.apt', { n: String(p.property_number_snapshot ?? p.property_id) })} · {formatIdealPartsPercent(p.ideal_parts_percent_snapshot, locale)}%
                  {mineVote ? ` · ${t('docs.yourVote')}: ${labelVoteChoice(mineVote.vote, t)}` : ''}
                </p>
                {(!applyAll || confirmed.length === 1) ? (
                  <div className="flex gap-2">
                    {VOTE_CHOICES.map((choice) => (
                      <button key={choice} type="button" disabled={busy} className="rounded-xl border border-border px-3 py-1.5 text-sm" onClick={() => void vote(choice, p.property_id)}>
                        {labelVoteChoice(choice, t)}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
          {applyAll && confirmed.length > 1 ? (
            <div className="flex gap-2">
              {VOTE_CHOICES.map((choice) => (
                <button key={choice} type="button" disabled={busy} className="rounded-xl border border-border px-3 py-1.5 text-sm" onClick={() => void vote(choice)}>
                  {labelVoteChoice(choice, t)}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
