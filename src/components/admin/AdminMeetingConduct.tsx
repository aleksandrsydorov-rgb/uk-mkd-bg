'use client';

import { useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import type { Translate } from '@/i18n/translate';
import { formatIdealPartsPercent } from '@/lib/propertyBook';
import {
  AdminCard,
  AdminEmptyState,
  AdminTableShell,
  StatusBadge,
  adminBtnSecondaryClass,
  adminFieldClass,
  adminTableCellClass,
  adminTableRowClass,
} from '@/components/admin/AdminUi';
import { ApartmentCombobox } from '@/components/admin/ApartmentCombobox';

function idealPartsLabel(raw: number | string | null | undefined, locale: string) {
  const text = formatIdealPartsPercent(raw, locale);
  return text == null ? '—' : `${text}%`;
}
import {
  formatAgendaLine,
  type GeneralMeeting,
  type MeetingAgendaItem,
  type MeetingDecision,
  type MeetingParticipant,
  type MeetingVoteRecord,
} from '@/lib/buildingDocuments';
import {
  MAJORITY_PRESETS,
  labelAttendanceStatus,
  labelMajorityRule,
  labelQuorumCalcStatus,
  labelVoteChoice,
  nextPendingAgendaItem,
  openAgendaItem,
  type QuorumCalc,
} from '@/lib/generalMeetingWorkflow';

type PropertyOption = { id: number; apartment_number: string | number | null; owner_name: string | null; ideal_parts_percent?: number | string | null };

export function AdminMeetingConduct({
  supabase,
  meeting,
  agenda,
  participants,
  decisions,
  votes,
  properties,
  canWrite,
  locale,
  t,
  onReload,
  onError,
}: {
  supabase: SupabaseClient<Database>;
  meeting: GeneralMeeting;
  agenda: MeetingAgendaItem[];
  participants: MeetingParticipant[];
  decisions: MeetingDecision[];
  votes: MeetingVoteRecord[];
  properties: PropertyOption[];
  canWrite: boolean;
  locale: string;
  t: Translate;
  onReload: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [calc, setCalc] = useState<QuorumCalc | null>(null);
  const [reviewNote, setReviewNote] = useState('');
  const [reg, setReg] = useState({ property_id: '', mode: 'in_person', representation: 'self', representative: '' });
  const [overrideReason, setOverrideReason] = useState('');

  const items = agenda.filter((a) => a.meeting_id === meeting.id).sort((a, b) => a.position - b.position);
  const parts = participants.filter((p) => p.meeting_id === meeting.id);
  const confirmed = parts.filter((p) => p.attendance_status === 'confirmed' && !p.left_at);
  const pending = parts.filter((p) => p.attendance_status === 'declared' || p.attendance_status === 'requires_representation_confirmation');
  const openItem = openAgendaItem(items);
  const nextItem = nextPendingAgendaItem(items);
  const published = meeting.status === 'published';

  async function run(fn: () => Promise<void>) {
    if (!canWrite) return;
    setBusy(true);
    try {
      await fn();
      await onReload();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function rpcErr<T>(promise: PromiseLike<{ data: T; error: { message: string } | null }>) {
    const { data, error } = await promise;
    if (error) throw new Error(error.message);
    return data;
  }

  if (!published && meeting.status !== 'held' && meeting.status !== 'minutes_ready') {
    return <AdminEmptyState title={t('docs.conductTitle')} text={t('docs.gmConductIdle')} />;
  }

  function renderItem(item: MeetingAgendaItem) {
    const decision = decisions.find((d) => d.agenda_item_id === item.id);
    return (
      <div key={item.id} className="rounded-[14px] border border-border px-3 py-2">
        <p className="text-sm font-medium">{formatAgendaLine(item.position, item.title)}</p>
        <p className="text-xs text-muted">{labelMajorityRule(item.majority_rule ?? '', t)}</p>
        {item.voting_status === 'closed' ? (
          <p className="text-xs text-secondary">
            {t('docs.voteFor')}: {idealPartsLabel(item.for_percent, locale)} · {t('docs.voteAgainst')}: {idealPartsLabel(item.against_percent, locale)} · {t('docs.voteAbstain')}: {idealPartsLabel(item.abstain_percent, locale)}
          </p>
        ) : null}
        {item.computed_threshold_status ? <p className="text-xs">{labelQuorumCalcStatus(item.computed_threshold_status, t)}</p> : null}
        {decision && item.voting_status === 'closed' && decision.protocol_result === 'adopted' && decision.computed_threshold_status === 'not_met' ? (
          <p className="text-xs text-danger">{t('docs.protocolMismatch')}</p>
        ) : null}
        {canWrite && item.voting_status === 'pending' && !openItem ? (
          <button type="button" className="mt-1 text-xs text-accent" onClick={() => void run(async () => { await rpcErr(supabase.rpc('open_general_meeting_vote', { p_agenda_item_id: item.id })); })}>
            {t('docs.openQuestion')}
          </button>
        ) : null}
        {canWrite && item.voting_status === 'open' ? (
          <div className="mt-2 space-y-2">
            <p className="text-xs font-medium text-secondary">{t('docs.stepVoting')}</p>
            <AdminTableShell>
              <table className="w-full min-w-[520px] text-xs">
                <tbody>
                  {confirmed.map((p) => {
                    const existing = votes.find((v) => v.property_id === p.property_id && v.decision_id === decision?.id);
                    return (
                      <tr key={p.id} className={adminTableRowClass}>
                        <td className={adminTableCellClass}>{t('picker.apt', { n: String(p.property_number_snapshot ?? p.property_id) })} {existing ? `· ${labelVoteChoice(existing.vote, t)}` : ''}</td>
                        <td className={adminTableCellClass}>
                          <div className="flex flex-wrap gap-1">
                            {(['for', 'against', 'abstain'] as const).map((choice) => (
                              <button
                                key={choice}
                                type="button"
                                className="rounded border border-border px-2 py-1"
                                onClick={() => void run(async () => { await rpcErr(supabase.rpc('record_general_meeting_vote', { p_agenda_item_id: item.id, p_property_id: p.property_id, p_vote: choice })); })}
                              >
                                {labelVoteChoice(choice, t)}
                              </button>
                            ))}
                          </div>
                        </td>
                        <td className={adminTableCellClass}>
                          <button type="button" className="text-danger" onClick={() => void run(async () => { await rpcErr(supabase.rpc('mark_general_meeting_participant_left', { p_participant_id: p.id, p_reason: null })); })}>
                            {t('docs.markLeft')}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </AdminTableShell>
            <button type="button" className={adminBtnSecondaryClass} onClick={() => void run(async () => { await rpcErr(supabase.rpc('close_general_meeting_vote', { p_agenda_item_id: item.id })); })}>
              {t('docs.closeVote')}
            </button>
          </div>
        ) : null}
        {decision && item.voting_status === 'closed' && canWrite ? (
          <div className="mt-2 grid gap-1">
            <input className={adminFieldClass} placeholder={t('docs.overrideReason')} value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} />
            <button type="button" className="text-xs text-accent" onClick={() => void run(async () => { await rpcErr(supabase.rpc('set_general_meeting_protocol_result', { p_decision_id: decision.id, p_protocol_result: decision.protocol_result === 'adopted' ? 'rejected' : 'adopted', p_override_reason: overrideReason || null })); })}>
              {t('docs.setProtocolResult')}
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="min-w-0 space-y-4">
      <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted">{t('docs.conductTitle')}</p>

      {published ? (
        <AdminCard className="space-y-2">
          <p className="text-sm font-semibold">{t('docs.stepReg')}</p>
          {meeting.operational_phase === 'idle' && canWrite ? (
            <button
              type="button"
              disabled={busy}
              className="rounded-xl bg-accent px-3 py-2 text-sm text-white"
              onClick={() => void run(async () => { await rpcErr(supabase.rpc('open_general_meeting_registration', { p_meeting_id: meeting.id })); })}
            >
              {t('docs.openRegistration')}
            </button>
          ) : null}
          <p className="text-sm text-secondary">
            {t('docs.confirmedCount', { n: confirmed.length })} · {idealPartsLabel(calc?.confirmed_percent ?? meeting.represented_ideal_parts_percent, locale)}
          </p>
          {pending.length > 0 ? (
            <div className="space-y-2">
              <p className="text-sm font-medium">{t('docs.awaitingConfirm')}</p>
              {pending.map((p) => (
                <div key={p.id} className="rounded-xl border border-border px-3 py-2 text-sm">
                  <p>{t('picker.apt', { n: String(p.property_number_snapshot ?? p.property_id) })} · {p.participant_name}</p>
                  <p className="text-xs text-muted">
                    {p.attendance_mode === 'online' ? t('docs.attendOnline') : t('docs.attendInPerson')} · {idealPartsLabel(p.ideal_parts_percent_snapshot, locale)} · {labelAttendanceStatus(p.attendance_status ?? '', t)}
                  </p>
                  {canWrite ? (
                    <div className="mt-1 flex gap-2">
                      <button type="button" className="text-xs text-accent" onClick={() => void run(async () => { await rpcErr(supabase.rpc('confirm_general_meeting_attendance', { p_participant_id: p.id })); })}>
                        {t('docs.confirmAttendance')}
                      </button>
                      <button type="button" className="text-xs text-danger" onClick={() => void run(async () => { await rpcErr(supabase.rpc('reject_general_meeting_attendance', { p_participant_id: p.id, p_reason: 'rejected' })); })}>
                        {t('docs.rejectAttendance')}
                      </button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
          {canWrite && (meeting.operational_phase === 'registration' || meeting.operational_phase === 'in_progress') ? (
            <div className="grid gap-2">
              <ApartmentCombobox
                properties={properties}
                value={reg.property_id ? Number(reg.property_id) : ''}
                onChange={(id) => setReg({ ...reg, property_id: id === '' ? '' : String(id) })}
              />
              <select className={adminFieldClass} value={reg.mode} onChange={(e) => setReg({ ...reg, mode: e.target.value })}>
                <option value="in_person">{t('docs.attendInPerson')}</option>
                <option value="online">{t('docs.attendOnline')}</option>
              </select>
              <select className={adminFieldClass} value={reg.representation} onChange={(e) => setReg({ ...reg, representation: e.target.value })}>
                <option value="self">{t('docs.self')}</option>
                <option value="proxy">{t('docs.representation')}</option>
              </select>
              {reg.representation === 'proxy' ? (
                <input className={adminFieldClass} value={reg.representative} onChange={(e) => setReg({ ...reg, representative: e.target.value })} placeholder={t('docs.representation')} />
              ) : null}
              <button
                type="button"
                disabled={busy || !reg.property_id}
                className="rounded-lg border border-border px-3 py-2 text-sm"
                onClick={() => void run(async () => {
                  await rpcErr(supabase.rpc('register_general_meeting_participant', {
                    p_meeting_id: meeting.id,
                    p_property_id: Number(reg.property_id),
                    p_attendance_mode: reg.mode,
                    p_representation_type: reg.representation,
                    p_representative_name: reg.representative || null,
                    p_confirm: true,
                  }));
                })}
              >
                {t('docs.addParticipant')}
              </button>
            </div>
          ) : null}
        </AdminCard>
      ) : null}

      {published ? (
        <AdminCard className="space-y-2">
          <p className="text-sm font-semibold">{t('docs.stepQuorum')}</p>
          {calc ? (
            <div className="flex flex-wrap items-center gap-2 text-sm text-secondary">
              <StatusBadge
                label={t('docs.quorumLive', { have: formatIdealPartsPercent(calc.confirmed_percent, locale) ?? '—', need: formatIdealPartsPercent(calc.required_percent, locale) ?? '—' })}
                tone={calc.calculation_status === 'met' || calc.calculation_status === 'allowed_by_stage' ? 'success' : calc.calculation_status === 'not_met' ? 'danger' : 'warning'}
              />
              <span>{labelQuorumCalcStatus(calc.calculation_status, t)}</span>
              {Number(calc.missing_ideal_parts_count) > 0 ? <span className="text-warning">{t('docs.quorumIncomplete')}</span> : null}
            </div>
          ) : null}
          {canWrite ? (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                className="rounded-xl border border-border px-3 py-2 text-sm"
                onClick={() => void run(async () => {
                  const data = await rpcErr(supabase.rpc('calculate_general_meeting_quorum', { p_meeting_id: meeting.id }));
                  setCalc(data as QuorumCalc);
                })}
              >
                {t('docs.checkQuorum')}
              </button>
              <button
                type="button"
                disabled={busy}
                className="rounded-xl border border-border px-3 py-2 text-sm"
                onClick={() => void run(async () => {
                  await rpcErr(supabase.rpc('record_general_meeting_quorum_check', { p_meeting_id: meeting.id, p_review_note: reviewNote || null }));
                  const data = await rpcErr(supabase.rpc('calculate_general_meeting_quorum', { p_meeting_id: meeting.id }));
                  setCalc(data as QuorumCalc);
                })}
              >
                {t('docs.recordQuorum')}
              </button>
              <button type="button" disabled={busy} className="rounded-xl border border-border px-3 py-2 text-sm" onClick={() => void run(async () => { await rpcErr(supabase.rpc('advance_general_meeting_quorum_stage', { p_meeting_id: meeting.id })); })}>
                {t('docs.advanceStage')}
              </button>
            </div>
          ) : null}
          <textarea className={adminFieldClass} rows={2} placeholder={t('docs.reviewNote')} value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} />
          {meeting.meeting_can_proceed && meeting.operational_phase === 'registration' && canWrite ? (
            <div className="border-t border-border pt-3">
              <p className="mb-2 text-xs font-medium text-muted">{t('docs.gmActions')}</p>
              <button type="button" disabled={busy} className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" onClick={() => void run(async () => { await rpcErr(supabase.rpc('start_general_meeting', { p_meeting_id: meeting.id })); })}>
                {t('docs.startMeeting')}
              </button>
            </div>
          ) : null}
        </AdminCard>
      ) : null}

      {meeting.operational_phase === 'in_progress' ? (
        <>
          <AdminCard className="space-y-2">
            <p className="text-sm font-semibold">{t('docs.gmCurrentItem')}</p>
            {openItem ? renderItem(openItem) : <AdminEmptyState title={t('docs.gmCurrentItem')} />}
          </AdminCard>
          <AdminCard className="space-y-2">
            <p className="text-sm font-semibold">{t('docs.stepVoting')}</p>
            {items.filter((item) => item.id !== openItem?.id && item.voting_status !== 'closed').map((item) => renderItem(item))}
            {canWrite && nextItem && !openItem ? (
              <button type="button" className={adminBtnSecondaryClass} onClick={() => void run(async () => { await rpcErr(supabase.rpc('open_general_meeting_vote', { p_agenda_item_id: nextItem.id })); })}>
                {t('docs.nextQuestion')}
              </button>
            ) : null}
          </AdminCard>
          <AdminCard className="space-y-2">
            <p className="text-sm font-semibold">{t('docs.gmResults')}</p>
            {items.filter((item) => item.voting_status === 'closed').length === 0 ? (
              <AdminEmptyState title={t('docs.gmResults')} />
            ) : items.filter((item) => item.voting_status === 'closed').map((item) => renderItem(item))}
          </AdminCard>
          {canWrite && !openItem ? (
            <AdminCard>
              <p className="mb-2 text-xs font-medium text-muted">{t('docs.gmActions')}</p>
              <button type="button" className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white" onClick={() => void run(async () => { await rpcErr(supabase.rpc('finish_general_meeting', { p_meeting_id: meeting.id })); })}>
                {t('docs.finishMeeting')}
              </button>
            </AdminCard>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

export function majoritySelect(value: string, onChange: (v: string) => void, t: Translate) {
  return (
    <select className="rounded-lg border border-border px-3 py-2 text-sm" value={value} onChange={(e) => onChange(e.target.value)}>
      {MAJORITY_PRESETS.map((p) => (
        <option key={p.id} value={p.id}>{t(p.labelKey)}</option>
      ))}
    </select>
  );
}
