'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import type { Translate } from '@/i18n/translate';
import { formatIdealPartsPercent } from '@/lib/propertyBook';
import {
  AdminCard,
  AdminEmptyState,
  AdminInlineAlert,
  AdminPrimaryButton,
  AdminSecondaryButton,
  AdminTableShell,
  StatusBadge,
  adminBtnSecondaryClass,
  adminFieldClass,
  adminTableCellClass,
  adminTableRowClass,
} from '@/components/admin/AdminUi';
import { ApartmentCombobox } from '@/components/admin/ApartmentCombobox';
import {
  formatAgendaLine,
  inPersonRegistrationOpen,
  meetingStartsAt,
  onlineConfirmOpen,
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

type PropertyOption = {
  id: number;
  apartment_number: string | number | null;
  owner_name: string | null;
  ideal_parts_percent?: number | string | null;
};

function idealPartsLabel(raw: number | string | null | undefined, locale: string) {
  const text = formatIdealPartsPercent(raw, locale);
  return text == null ? '—' : `${text}%`;
}

function labelQuorumStage(stage: string | null | undefined, t: Translate) {
  if (stage === 'after_one_hour') return t('docs.quorumStageHour');
  if (stage === 'next_day') return t('docs.quorumStageNextDay');
  return t('docs.quorumStageInitial');
}

function minutesUntil(target: Date, now: Date) {
  return Math.round((target.getTime() - now.getTime()) / 60000);
}

function formatCountdownMins(mins: number, t: Translate) {
  const m = Math.max(0, mins);
  const days = Math.floor(m / 1440);
  const hours = Math.floor((m % 1440) / 60);
  const rest = m % 60;
  if (days > 0) return t('docs.countdownDH', { d: String(days), h: String(hours) });
  if (hours > 0) return t('docs.countdownHM', { h: String(hours), m: String(rest) });
  return t('docs.countdownM', { m: String(rest) });
}

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
  const [now, setNow] = useState(() => new Date());

  const items = agenda.filter((a) => a.meeting_id === meeting.id).sort((a, b) => a.position - b.position);
  const parts = participants.filter((p) => p.meeting_id === meeting.id);
  const confirmed = parts.filter((p) => p.attendance_status === 'confirmed' && !p.left_at);
  const pending = parts.filter(
    (p) => p.attendance_status === 'declared' || p.attendance_status === 'requires_representation_confirmation',
  );
  const onlineConfirmed = confirmed.filter((p) => p.attendance_mode === 'online');
  const inPersonConfirmed = confirmed.filter((p) => p.attendance_mode !== 'online');
  const openItem = openAgendaItem(items);
  const nextItem = nextPendingAgendaItem(items);
  const published = meeting.status === 'published';
  const startAt = useMemo(() => meetingStartsAt(meeting), [meeting]);
  const regOpen = inPersonRegistrationOpen(meeting, now);
  const hourAfterStart = now.getTime() >= startAt.getTime() + 36e5;
  const stage = meeting.quorum_stage || calc?.quorum_stage || 'initial';
  const canAdvanceTo26 = stage === 'initial' && hourAfterStart;
  const canAdvanceToNextDay = stage === 'after_one_hour';

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

  const refreshQuorum = useCallback(async () => {
    if (!published && meeting.status !== 'held') return;
    const { data, error } = await supabase.rpc('calculate_general_meeting_quorum', {
      p_meeting_id: meeting.id,
    });
    if (!error && data) setCalc(data as QuorumCalc);
  }, [meeting.id, meeting.status, published, supabase]);

  // Clock tick for auto-open countdown
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30000);
    return () => window.clearInterval(id);
  }, []);

  // Auto-open registration at T−60 minutes
  useEffect(() => {
    if (!canWrite || !published) return;
    if (meeting.operational_phase !== 'idle') return;
    if (!regOpen) return;
    let cancelled = false;
    void (async () => {
      const { error } = await supabase.rpc('gm_ensure_registration_open', {
        p_meeting_id: meeting.id,
      });
      if (!cancelled && !error) await onReload();
    })();
    return () => {
      cancelled = true;
    };
  }, [canWrite, published, meeting.operational_phase, meeting.id, regOpen, supabase, onReload]);

  useEffect(() => {
    void refreshQuorum();
  }, [refreshQuorum, parts.length, confirmed.length, meeting.quorum_stage, meeting.represented_ideal_parts_percent]);

  if (!published && meeting.status !== 'held' && meeting.status !== 'minutes_ready') {
    const idleText =
      meeting.status === 'cancelled'
        ? t('docs.gmConductCancelled')
        : meeting.status === 'draft'
          ? t('docs.gmConductDraft')
          : t('docs.gmConductIdle');
    return <AdminEmptyState title={t('docs.conductTitle')} text={idleText} />;
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

  const minsToReg = minutesUntil(new Date(startAt.getTime() - 36e5), now);
  const minsToStart = minutesUntil(startAt, now);
  const phase = meeting.operational_phase ?? 'idle';
  const showOpenReg = published && phase === 'idle';
  const showStartMeeting = published && (phase === 'registration' || phase === 'idle');
  const canOpenReg = canWrite && showOpenReg && regOpen;
  const canStartMeeting = canWrite && phase === 'registration' && Boolean(meeting.meeting_can_proceed);

  return (
    <div className="min-w-0 space-y-4">
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted">{t('docs.conductTitle')}</p>
        <p className="mt-1 text-xs text-muted">{t('docs.conductFlowHint')}</p>
      </div>

      {published && canWrite ? (
        <AdminCard className="space-y-3">
          <p className="text-sm font-semibold">{t('docs.conductActions')}</p>
          <p className="text-xs text-secondary">{t('docs.conductActionsHint')}</p>
          <div className="flex flex-wrap gap-2">
            {showOpenReg ? (
              <AdminPrimaryButton
                type="button"
                disabled={busy || !canOpenReg}
                onClick={() => void run(async () => {
                  await rpcErr(supabase.rpc('gm_ensure_registration_open', { p_meeting_id: meeting.id }));
                })}
              >
                {t('docs.openRegistration')}
              </AdminPrimaryButton>
            ) : phase === 'registration' || phase === 'in_progress' ? (
              <StatusBadge label={t('docs.regOpenBadge')} tone="success" />
            ) : null}
            {showStartMeeting ? (
              <AdminPrimaryButton
                type="button"
                disabled={busy || !canStartMeeting}
                onClick={() => void run(async () => {
                  await rpcErr(supabase.rpc('start_general_meeting', { p_meeting_id: meeting.id }));
                })}
              >
                {t('docs.startMeeting')}
              </AdminPrimaryButton>
            ) : phase === 'in_progress' ? (
              <StatusBadge label={t('docs.statusInProgress')} tone="warning" />
            ) : null}
          </div>
          {showOpenReg && !regOpen ? (
            <p className="text-xs text-muted">
              {t('docs.openRegWait', { when: formatCountdownMins(minsToReg, t) })}
            </p>
          ) : null}
          {phase === 'registration' && !meeting.meeting_can_proceed ? (
            <p className="text-xs text-muted">{t('docs.startMeetingWaitQuorum')}</p>
          ) : null}
        </AdminCard>
      ) : null}

      {published ? (
        <AdminCard className="space-y-3">
          <p className="text-sm font-semibold">{t('docs.stepReg')}</p>
          <p className="text-xs text-secondary">{t('docs.regWindowsHint')}</p>

          <div className="flex flex-wrap gap-2">
            {phase === 'registration' || phase === 'in_progress' ? (
              <StatusBadge label={t('docs.regOpenBadge')} tone="success" />
            ) : regOpen ? (
              <StatusBadge label={t('docs.regOpening')} tone="info" />
            ) : (
              <StatusBadge
                label={t('docs.regOpensIn', { m: formatCountdownMins(minsToReg, t) })}
                tone="neutral"
              />
            )}
            {minsToStart > 0 ? (
              <StatusBadge label={t('docs.meetingStartsIn', { m: formatCountdownMins(minsToStart, t) })} tone="info" />
            ) : phase !== 'closed' ? (
              <StatusBadge label={t('docs.meetingTimeReached')} tone="warning" />
            ) : null}
          </div>

          {meeting.meeting_mode === 'hybrid' && !onlineConfirmOpen(meeting, now) ? (
            <AdminInlineAlert tone="info">{t('docs.onlineConfirmClosed')}</AdminInlineAlert>
          ) : null}

          <div className="grid gap-2 text-sm text-secondary sm:grid-cols-3">
            <p>{t('docs.confirmedCount', { n: confirmed.length })} · {idealPartsLabel(calc?.confirmed_percent ?? meeting.represented_ideal_parts_percent, locale)}</p>
            <p>{t('docs.onlineInQuorum', { n: onlineConfirmed.length })}</p>
            <p>{t('docs.inPersonConfirmed', { n: inPersonConfirmed.length })}</p>
          </div>

          {pending.length > 0 ? (
            <div className="space-y-2">
              <p className="text-sm font-medium text-foreground">{t('docs.awaitingConfirm')}</p>
              <p className="text-xs text-muted">{t('docs.awaitingConfirmHint')}</p>
              {pending.map((p) => (
                <div key={p.id} className="rounded-xl border border-border px-3 py-2 text-sm">
                  <p className="font-medium">
                    {t('picker.apt', { n: String(p.property_number_snapshot ?? p.property_id) })} · {p.participant_name}
                  </p>
                  <p className="text-xs text-muted">
                    {p.attendance_mode === 'online' ? t('docs.attendOnline') : t('docs.attendInPerson')}
                    {p.representation_type === 'proxy' ? ` · ${t('docs.representation')}${p.representative_name ? `: ${p.representative_name}` : ''}` : ` · ${t('docs.self')}`}
                    {' · '}
                    {idealPartsLabel(p.ideal_parts_percent_snapshot, locale)}
                    {' · '}
                    {labelAttendanceStatus(p.attendance_status ?? '', t)}
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
          ) : meeting.operational_phase === 'registration' ? (
            <p className="text-xs text-muted">{t('docs.noPendingConfirm')}</p>
          ) : null}

          {canWrite && (meeting.operational_phase === 'registration' || meeting.operational_phase === 'in_progress') ? (
            <div className="grid gap-2 border-t border-border pt-3">
              <p className="text-xs font-medium text-muted">{t('docs.addParticipantDesk')}</p>
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
              <AdminSecondaryButton
                type="button"
                disabled={busy || !reg.property_id}
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
              </AdminSecondaryButton>
            </div>
          ) : null}
        </AdminCard>
      ) : null}

      {published ? (
        <AdminCard className="space-y-3">
          <p className="text-sm font-semibold">{t('docs.stepQuorum')}</p>
          <p className="text-xs text-secondary">{t('docs.quorumBoardHint')}</p>

          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge label={labelQuorumStage(stage, t)} tone="info" />
            {calc ? (
              <StatusBadge
                label={t('docs.quorumLive', {
                  have: formatIdealPartsPercent(calc.confirmed_percent, locale) ?? '—',
                  need: formatIdealPartsPercent(calc.required_percent, locale) ?? (stage === 'next_day' ? '—' : '—'),
                })}
                tone={calc.calculation_status === 'met' || calc.calculation_status === 'allowed_by_stage' ? 'success' : calc.calculation_status === 'not_met' ? 'danger' : 'warning'}
              />
            ) : null}
            {calc ? <span className="text-sm text-secondary">{labelQuorumCalcStatus(calc.calculation_status, t)}</span> : null}
          </div>

          <div className="rounded-[14px] border border-border bg-background px-3 py-3 text-sm text-secondary">
            <p>{t('docs.quorumOnlineNote')}</p>
            <p className="mt-1">{t('docs.quorumStagesNote')}</p>
          </div>

          {canWrite ? (
            <div className="flex flex-wrap gap-2">
              <AdminSecondaryButton type="button" disabled={busy} onClick={() => void refreshQuorum()}>
                {t('docs.checkQuorum')}
              </AdminSecondaryButton>
              <AdminSecondaryButton
                type="button"
                disabled={busy}
                onClick={() => void run(async () => {
                  await rpcErr(supabase.rpc('record_general_meeting_quorum_check', { p_meeting_id: meeting.id, p_review_note: reviewNote || null }));
                  await refreshQuorum();
                })}
              >
                {t('docs.recordQuorum')}
              </AdminSecondaryButton>
              {canAdvanceTo26 ? (
                <AdminPrimaryButton
                  type="button"
                  disabled={busy}
                  onClick={() => void run(async () => {
                    await rpcErr(supabase.rpc('advance_general_meeting_quorum_stage', { p_meeting_id: meeting.id }));
                    await refreshQuorum();
                  })}
                >
                  {t('docs.advanceTo26')}
                </AdminPrimaryButton>
              ) : null}
              {canAdvanceToNextDay ? (
                <AdminSecondaryButton
                  type="button"
                  disabled={busy}
                  onClick={() => void run(async () => {
                    await rpcErr(supabase.rpc('advance_general_meeting_quorum_stage', { p_meeting_id: meeting.id }));
                    await refreshQuorum();
                  })}
                >
                  {t('docs.advanceToNextDay')}
                </AdminSecondaryButton>
              ) : null}
              {stage === 'initial' && !hourAfterStart ? (
                <p className="w-full text-xs text-muted">{t('docs.advanceTo26Wait')}</p>
              ) : null}
            </div>
          ) : null}
          <textarea className={adminFieldClass} rows={2} placeholder={t('docs.reviewNote')} value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} />
        </AdminCard>
      ) : null}

      {phase === 'in_progress' ? (
        <>
          <AdminCard className="space-y-2">
            <p className="text-sm font-semibold">{t('docs.gmCurrentItem')}</p>
            {openItem ? renderItem(openItem) : <AdminEmptyState title={t('docs.gmCurrentItem')} />}
          </AdminCard>
          <AdminCard className="space-y-2">
            <p className="text-sm font-semibold">{t('docs.stepVoting')}</p>
            {items.filter((item) => item.id !== openItem?.id && item.voting_status !== 'closed').map((item) => renderItem(item))}
            {canWrite && nextItem && !openItem ? (
              <AdminSecondaryButton type="button" onClick={() => void run(async () => { await rpcErr(supabase.rpc('open_general_meeting_vote', { p_agenda_item_id: nextItem.id })); })}>
                {t('docs.nextQuestion')}
              </AdminSecondaryButton>
            ) : null}
          </AdminCard>
          <AdminCard className="space-y-2">
            <p className="text-sm font-semibold">{t('docs.gmResults')}</p>
            {items.filter((item) => item.voting_status === 'closed').length === 0 ? (
              <AdminEmptyState title={t('docs.gmResults')} />
            ) : items.filter((item) => item.voting_status === 'closed').map((item) => renderItem(item))}
          </AdminCard>
          {canWrite ? (
            <AdminCard className="space-y-2">
              <p className="text-sm font-semibold">{t('docs.finishMeeting')}</p>
              <p className="text-xs text-muted">{t('docs.finishMeetingHint')}</p>
              <AdminPrimaryButton
                type="button"
                disabled={busy || Boolean(openItem)}
                onClick={() => void run(async () => { await rpcErr(supabase.rpc('finish_general_meeting', { p_meeting_id: meeting.id })); })}
              >
                {t('docs.finishMeeting')}
              </AdminPrimaryButton>
              {openItem ? <p className="text-xs text-warning">{t('docs.finishMeetingCloseVotes')}</p> : null}
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
