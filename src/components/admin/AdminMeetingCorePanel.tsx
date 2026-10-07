'use client';

import { useEffect, useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import type { Translate } from '@/i18n/translate';
import type { GeneralMeeting, MeetingAgendaItem } from '@/lib/buildingDocuments';
import {
  buildInvitationDraft,
  isCheckInBlocked,
  labelLegalState,
  labelMeetingType,
  meetingCoreBlockers,
  nextSuggestedStates,
  type MeetingLegalState,
} from '@/lib/meetingCore';
import {
  adminCardClass,
  adminFieldClass,
  AdminInlineAlert,
  AdminPrimaryButton,
  AdminSecondaryButton,
  StatusBadge,
} from '@/components/admin/AdminUi';
import { ownerVisibleError } from '@/lib/ownerError';

function actionLabel(state: MeetingLegalState, t: Translate): string {
  const key = `docs.mcGo_${state}` as const;
  const translated = t(key);
  return translated === key ? `→ ${labelLegalState(state, t)}` : translated;
}

export function AdminMeetingCorePanel({
  supabase,
  meeting,
  agenda = [],
  canWrite,
  t,
  onReload,
  onError,
}: {
  supabase: SupabaseClient<Database>;
  meeting: GeneralMeeting;
  agenda?: MeetingAgendaItem[];
  canWrite: boolean;
  t: Translate;
  onReload: () => Promise<void> | void;
  onError: (msg: string | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const meetingAgenda = useMemo(
    () => agenda.filter((a) => a.meeting_id === meeting.id).sort((a, b) => a.position - b.position),
    [agenda, meeting.id],
  );
  const draftSource = useMemo(
    () =>
      buildInvitationDraft({
        title: meeting.title,
        meeting_date: meeting.meeting_date,
        meeting_time: meeting.meeting_time,
        location: meeting.location,
        meeting_mode: meeting.meeting_mode,
        is_urgent: meeting.is_urgent,
        meeting_type: meeting.meeting_type,
        online_meeting_url: meeting.online_meeting_url,
        agenda: meetingAgenda.map((a) => ({
          position: a.position,
          title: a.title,
          description: a.description,
          proposed_decision_text: a.proposed_decision_text,
        })),
      }),
    [meeting, meetingAgenda],
  );
  const [inviteTitle, setInviteTitle] = useState(draftSource.title);
  const [inviteBody, setInviteBody] = useState(draftSource.body);
  const [bodyTouched, setBodyTouched] = useState(false);
  const [showPreview, setShowPreview] = useState(true);
  const [postPlace, setPostPlace] = useState('Табло на входа');
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (bodyTouched || meeting.invitation_locked_at) return;
    setInviteTitle(draftSource.title);
    setInviteBody(draftSource.body);
  }, [draftSource, bodyTouched, meeting.invitation_locked_at]);

  const blockers = meetingCoreBlockers(meeting);
  const nextStates = nextSuggestedStates(meeting.legal_state);
  /** Registration / start meeting belong on the Conduct tab. */
  const CONDUCT_ONLY = new Set([
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
  ]);
  const forwardStates = nextStates.filter((st) => st !== 'CANCELLED' && !CONDUCT_ONLY.has(st));
  const canCancel = nextStates.includes('CANCELLED');
  const legal = (meeting.legal_state ?? 'DRAFT').toUpperCase();
  const invitationLocked = Boolean(meeting.invitation_locked_at);
  const showVotingFreeze = ['WAITING_FOR_MEETING', 'CHECK_IN_OPEN', 'VOTING_SNAPSHOT_LOCKED'].includes(legal);

  const statusTone = useMemo((): 'neutral' | 'info' | 'success' | 'warning' | 'danger' => {
    if (legal === 'CANCELLED' || legal === 'DISPUTED' || legal === 'LEGAL_HOLD') return 'danger';
    if (legal === 'CLOSED' || legal === 'PROTOCOL_SIGNED' || legal === 'PROTOCOL_NOTICE_POSTED') return 'success';
    if (invitationLocked) return 'info';
    if (legal === 'DRAFT' || legal === 'PRECHECK') return 'neutral';
    return 'warning';
  }, [legal, invitationLocked]);

  async function run(okMsg: string, fn: () => Promise<unknown>) {
    if (!canWrite) return;
    setBusy(true);
    setMsg(null);
    onError(null);
    try {
      await fn();
      setMsg(okMsg);
      await onReload();
    } catch (e: unknown) {
      onError(ownerVisibleError(e, t('admin.errGeneric')));
    } finally {
      setBusy(false);
    }
  }

  function regenerateInvite() {
    const next = buildInvitationDraft({
      title: meeting.title,
      meeting_date: meeting.meeting_date,
      meeting_time: meeting.meeting_time,
      location: meeting.location,
      meeting_mode: meeting.meeting_mode,
      is_urgent: meeting.is_urgent,
      meeting_type: meeting.meeting_type,
      online_meeting_url: meeting.online_meeting_url,
      agenda: meetingAgenda.map((a) => ({
        position: a.position,
        title: a.title,
        description: a.description,
        proposed_decision_text: a.proposed_decision_text,
      })),
    });
    setInviteTitle(next.title);
    setInviteBody(next.body);
    setBodyTouched(false);
    setShowPreview(true);
  }

  return (
    <section className={`${adminCardClass} space-y-4 p-4`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{t('docs.mcTitle')}</h3>
          <p className="mt-0.5 text-xs text-secondary">{t('docs.mcLead')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge label={labelLegalState(meeting.legal_state, t)} tone={statusTone} />
          <StatusBadge label={labelMeetingType(meeting.meeting_type, t)} tone="neutral" />
        </div>
      </div>

      {blockers.length > 0 ? (
        <AdminInlineAlert tone="warning">{t('docs.mcBlockersHint')}</AdminInlineAlert>
      ) : null}
      {isCheckInBlocked(meeting) && meeting.check_in_blocked_reason ? (
        <AdminInlineAlert tone="danger">{meeting.check_in_blocked_reason}</AdminInlineAlert>
      ) : null}
      {msg ? <AdminInlineAlert tone="success">{msg}</AdminInlineAlert> : null}

      <div className="space-y-3 border-t border-border pt-3">
        <div>
          <p className="text-sm font-medium text-foreground">{t('docs.mcStepOwners')}</p>
          <p className="mt-0.5 text-xs text-secondary">{t('docs.mcStepOwnersHint')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <AdminSecondaryButton
            type="button"
            disabled={busy || !canWrite}
            onClick={() =>
              void run(t('docs.mcOkNoticeFreeze'), async () => {
                const { error } = await supabase.rpc('gm_freeze_notice_snapshot', {
                  p_meeting_id: meeting.id,
                });
                if (error) throw error;
              })
            }
          >
            {t('docs.mcFreezeNotice')}
          </AdminSecondaryButton>
          <AdminSecondaryButton
            type="button"
            disabled={busy || !canWrite}
            onClick={() =>
              void (async () => {
                if (!canWrite) return;
                setBusy(true);
                setMsg(null);
                onError(null);
                try {
                  const { data, error } = await supabase.rpc('gm_detect_ownership_drift', {
                    p_meeting_id: meeting.id,
                  });
                  if (error) throw error;
                  const drifted = Array.isArray(data) ? data.length : data ? 1 : 0;
                  setMsg(t('docs.mcDriftResult', { n: String(drifted) }));
                  await onReload();
                } catch (e: unknown) {
                  onError(ownerVisibleError(e, t('admin.errGeneric')));
                } finally {
                  setBusy(false);
                }
              })()
            }
          >
            {t('docs.mcDetectDrift')}
          </AdminSecondaryButton>
        </div>
      </div>

      <div className="space-y-3 border-t border-border pt-3">
        <div>
          <p className="text-sm font-medium text-foreground">{t('docs.mcStepInvite')}</p>
          <p className="mt-0.5 text-xs text-secondary">
            {invitationLocked ? t('docs.mcInviteLockedHint') : t('docs.mcStepInviteHint')}
          </p>
        </div>

        {!invitationLocked && draftSource.missing.length > 0 ? (
          <AdminInlineAlert tone="warning">
            {t('docs.mcInviteMissing', {
              items: draftSource.missing
                .map((m) =>
                  m === 'date'
                    ? t('docs.date')
                    : m === 'place'
                      ? t('docs.location')
                      : t('docs.agendaTitle'),
                )
                .join(', '),
            })}
          </AdminInlineAlert>
        ) : null}

        <div className="grid gap-2 sm:grid-cols-2">
          <label className="grid gap-1 text-xs text-secondary">
            {t('docs.mcInviteTitle')}
            <input
              className={adminFieldClass}
              value={inviteTitle}
              onChange={(e) => {
                setBodyTouched(true);
                setInviteTitle(e.target.value);
              }}
              disabled={!canWrite || invitationLocked}
            />
          </label>
          <label className="grid gap-1 text-xs text-secondary sm:col-span-2">
            {t('docs.mcInviteBody')}
            <textarea
              className={adminFieldClass}
              rows={10}
              value={inviteBody}
              onChange={(e) => {
                setBodyTouched(true);
                setInviteBody(e.target.value);
              }}
              disabled={!canWrite || invitationLocked}
            />
          </label>
        </div>

        <div className="flex flex-wrap gap-2">
          {!invitationLocked ? (
            <>
              <AdminSecondaryButton
                type="button"
                disabled={busy || !canWrite}
                onClick={() => regenerateInvite()}
              >
                {t('docs.mcInviteRegenerate')}
              </AdminSecondaryButton>
              <AdminSecondaryButton
                type="button"
                disabled={busy}
                onClick={() => setShowPreview((v) => !v)}
              >
                {showPreview ? t('docs.mcInviteHidePreview') : t('docs.mcInviteShowPreview')}
              </AdminSecondaryButton>
              <AdminPrimaryButton
                type="button"
                disabled={busy || !canWrite || !inviteTitle.trim() || !inviteBody.trim()}
                onClick={() =>
                  void run(t('docs.mcOkInviteLock'), async () => {
                    const { error } = await supabase.rpc('gm_lock_invitation_version', {
                      p_meeting_id: meeting.id,
                      p_title_bg: inviteTitle,
                      p_body_bg: inviteBody,
                      p_title_ru: null,
                      p_body_ru: null,
                      p_title_en: null,
                      p_body_en: null,
                    });
                    if (error) throw error;
                  })
                }
              >
                {t('docs.mcLockInvite')}
              </AdminPrimaryButton>
            </>
          ) : (
            <AdminSecondaryButton type="button" disabled={busy} onClick={() => setShowPreview((v) => !v)}>
              {showPreview ? t('docs.mcInviteHidePreview') : t('docs.mcInviteShowPreview')}
            </AdminSecondaryButton>
          )}
        </div>

        {showPreview ? (
          <div className="rounded-[14px] border border-border bg-background p-4 shadow-card">
            <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted">
              {t('docs.mcInvitePreview')}
            </p>
            <p className="mt-2 text-base font-semibold text-foreground">{inviteTitle}</p>
            <pre className="mt-3 whitespace-pre-wrap font-sans text-sm leading-relaxed text-secondary">
              {inviteBody}
            </pre>
          </div>
        ) : null}
      </div>

      <div className="space-y-3 border-t border-border pt-3">
        <div>
          <p className="text-sm font-medium text-foreground">{t('docs.mcStepPost')}</p>
          <p className="mt-0.5 text-xs text-secondary">{t('docs.mcStepPostHint')}</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid min-w-[12rem] flex-1 gap-1 text-xs text-secondary">
            {t('docs.mcPostPlace')}
            <input
              className={adminFieldClass}
              value={postPlace}
              onChange={(e) => setPostPlace(e.target.value)}
              disabled={!canWrite}
            />
          </label>
          <AdminSecondaryButton
            type="button"
            disabled={busy || !canWrite || !invitationLocked || !postPlace.trim()}
            onClick={() =>
              void run(t('docs.mcOkPost'), async () => {
                const { error } = await supabase.rpc('gm_record_invitation_posting', {
                  p_meeting_id: meeting.id,
                  p_posted_at: new Date().toISOString(),
                  p_posted_place: postPlace,
                  p_photo_url: null,
                });
                if (error) throw error;
              })
            }
          >
            {t('docs.mcRecordPost')}
          </AdminSecondaryButton>
        </div>
      </div>

      {showVotingFreeze ? (
        <div className="space-y-3 border-t border-border pt-3">
          <div>
            <p className="text-sm font-medium text-foreground">{t('docs.mcStepVoting')}</p>
            <p className="mt-0.5 text-xs text-secondary">{t('docs.mcStepVotingHint')}</p>
          </div>
          <AdminSecondaryButton
            type="button"
            disabled={busy || !canWrite || isCheckInBlocked(meeting)}
            onClick={() =>
              void run(t('docs.mcOkVotingFreeze'), async () => {
                const { error } = await supabase.rpc('gm_freeze_voting_snapshot', {
                  p_meeting_id: meeting.id,
                });
                if (error) throw error;
              })
            }
          >
            {t('docs.mcFreezeVoting')}
          </AdminSecondaryButton>
        </div>
      ) : null}

      {(forwardStates.length > 0 || canCancel) ? (
        <div className="space-y-3 border-t border-border pt-3">
          <div>
            <p className="text-sm font-medium text-foreground">{t('docs.mcStepNext')}</p>
            <p className="mt-0.5 text-xs text-secondary">{t('docs.mcStepNextHint')}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {forwardStates.map((st, idx) => {
              const Button = idx === 0 ? AdminPrimaryButton : AdminSecondaryButton;
              return (
                <Button
                  key={st}
                  type="button"
                  disabled={busy || !canWrite || (st === 'CHECK_IN_OPEN' && isCheckInBlocked(meeting))}
                  onClick={() =>
                    void run(t('docs.mcOkState', { state: labelLegalState(st, t) }), async () => {
                      const { error } = await supabase.rpc('gm_transition', {
                        p_meeting_id: meeting.id,
                        p_to_state: st,
                        p_note: null,
                      });
                      if (error) throw error;
                    })
                  }
                >
                  {actionLabel(st, t)}
                </Button>
              );
            })}
            {canCancel ? (
              <AdminSecondaryButton
                type="button"
                disabled={busy || !canWrite}
                onClick={() =>
                  void run(t('docs.mcOkState', { state: labelLegalState('CANCELLED', t) }), async () => {
                    const { error } = await supabase.rpc('gm_transition', {
                      p_meeting_id: meeting.id,
                      p_to_state: 'CANCELLED',
                      p_note: null,
                    });
                    if (error) throw error;
                  })
                }
              >
                {t('docs.mcCancelMeeting')}
              </AdminSecondaryButton>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
