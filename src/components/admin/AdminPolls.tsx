'use client';

import { useEffect, useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@/lib/database.types';
import { useI18n } from '@/i18n/I18nProvider';
import { toUserFacingMessage } from '@/lib/userFacingError';
import {
  MAX_POLL_ATTACHMENTS,
  POLL_ATTACHMENT_ACCEPT,
  pollAttachmentFromFile,
  pollDecisionLabel,
  pollLegacyPhotoUrl,
  tallyPoll,
  type Poll,
  type PollAttachment,
  type PollCategory,
  type PollOption,
  type PollVote,
  type PollVoteHistory,
} from '@/lib/polls';
import {
  pollAdminLifecycleLabelKey,
  pollAdminLifecycleTone,
  pollCardSummary,
  pollDecisionTone,
  validatePollCreateInput,
} from '@/lib/pollsUi';
import { PollDetails, PollOptionBars } from '@/components/PollPanel';
import { PollAttachmentsView, PollPendingAttachments } from '@/components/PollAttachments';
import { AppFilePicker, formatAcceptHint, formatFileSizeMb } from '@/components/ui/AppFilePicker';
import {
  labelPollCategory,
  labelPollDecision,
  labelPollStatus,
} from '@/i18n/labels';
import { formatOwnerDate, formatOwnerDateTime } from '@/lib/ownerFormat';
import { formatM3 } from '@/lib/utilities';
import {
  MAX_PRIVATE_UPLOAD_BYTES,
  messageForUploadError,
  POLL_IMAGES_BUCKET,
  pollImagePath,
  privateUploadRejectReason,
  uploadPrivateFile,
} from '@/lib/privateMedia';
import { useAppConfirm } from '@/components/ui/AppConfirmDialog';
import { AdminModal } from '@/components/admin/AdminModal';
import {
  AdminEmptyState,
  AdminPageHeader,
  AdminPrimaryButton,
  AdminSecondaryButton,
  AdminTableShell,
  StatusBadge,
  adminBtnDangerClass,
  adminBtnTertiaryClass,
  adminCardClass,
  adminFieldClass,
  adminFormPanelClass,
  adminTableCellClass,
  adminTableHeadRowClass,
  adminTableRowClass,
} from '@/components/admin/AdminUi';

type PropertyLite = {
  id: number;
  apartment_number: string;
  area_sqm?: number | null;
};

export function AdminPolls({
  supabase,
  polls,
  pollOptions,
  pollVotes,
  pollVoteHistory,
  properties,
  canManage,
  createNonce = 0,
  onChanged,
  onError,
}: {
  supabase: SupabaseClient<Database>;
  polls: Poll[];
  pollOptions: PollOption[];
  pollVotes: PollVote[];
  pollVoteHistory: PollVoteHistory[];
  properties: PropertyLite[];
  canManage: boolean;
  createNonce?: number;
  onChanged: () => Promise<void> | void;
  onError: (msg: string) => void;
}) {
  const { t, locale } = useI18n();
  const [detailId, setDetailId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const { confirm, dialog } = useAppConfirm(t('common.close'));
  const [showHistory, setShowHistory] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pollFiles, setPollFiles] = useState<File[]>([]);
  /** Resume attachment upload for a poll already inserted (no duplicate poll row). */
  const [resumePollId, setResumePollId] = useState<number | null>(null);
  const [savedAttachments, setSavedAttachments] = useState<PollAttachment[]>([]);
  const [pollForm, setPollForm] = useState({
    title: '',
    body: '',
    category: 'ремонт' as PollCategory,
    voting_starts: new Date().toISOString().slice(0, 10),
    deadline: '',
    budget_eur: '',
    created_by: 'УК',
    options: ['За', 'Против'],
  });

  const areaProps = useMemo(
    () => properties.map((p) => ({ id: p.id, area_sqm: p.area_sqm ?? null })),
    [properties],
  );
  const aptById = useMemo(
    () => new Map(properties.map((p) => [p.id, p.apartment_number])),
    [properties],
  );

  const selected = polls.find((p) => p.id === detailId) ?? null;
  const detailOptions = selected
    ? pollOptions.filter((o) => o.poll_id === selected.id).sort((a, b) => a.sort_order - b.sort_order)
    : [];
  const detailVotes = selected ? pollVotes.filter((v) => v.poll_id === selected.id) : [];
  const detailHistory = selected ? pollVoteHistory.filter((h) => h.poll_id === selected.id) : [];
  const detailDecision = selected
    ? pollDecisionLabel(selected, tallyPoll(detailOptions, detailVotes, areaProps).accepted)
    : 'идёт';

  function openCreate() {
    if (!canManage) {
      onError(t('admin.errNoAccess'));
      return;
    }
    setPollForm({
      title: '',
      body: '',
      category: 'ремонт',
      voting_starts: new Date().toISOString().slice(0, 10),
      deadline: '',
      budget_eur: '',
      created_by: 'УК',
      options: ['За', 'Против'],
    });
    setPollFiles([]);
    setResumePollId(null);
    setSavedAttachments([]);
    setDetailId(null);
    setShowForm(true);
  }

  function closeCreateForm() {
    // Cancel does not delete an already-created poll or its saved attachments.
    setShowForm(false);
    setPollFiles([]);
    setResumePollId(null);
    setSavedAttachments([]);
  }

  useEffect(() => {
    if (createNonce > 0 && canManage) openCreate();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open only on external quick-action bump
  }, [createNonce]);

  async function persistPollAttachments(
    pollId: number,
    prior: PollAttachment[],
    files: File[],
  ): Promise<{ saved: PollAttachment[]; failedNames: string[] }> {
    const saved = [...prior];
    const failedNames: string[] = [];
    for (const file of files) {
      const rejected = privateUploadRejectReason(POLL_IMAGES_BUCKET, file);
      if (rejected) {
        failedNames.push(file.name);
        continue;
      }
      if (saved.length >= MAX_POLL_ATTACHMENTS) {
        failedNames.push(file.name);
        continue;
      }
      try {
        const filePath = pollImagePath(pollId, file.name);
        const storedPath = await uploadPrivateFile(
          supabase,
          POLL_IMAGES_BUCKET,
          filePath,
          file,
        );
        saved.push(pollAttachmentFromFile(file, storedPath));
      } catch {
        failedNames.push(file.name);
      }
    }
    const { error: attErr } = await supabase
      .from('polls')
      .update({
        attachments: saved as unknown as Json,
        photo_url: pollLegacyPhotoUrl(saved),
      })
      .eq('id', pollId);
    if (attErr) throw attErr;
    return { saved, failedNames };
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage) {
      onError(t('admin.errNoAccess'));
      return;
    }
    const check = validatePollCreateInput(pollForm);
    if (!check.ok) {
      onError(t(check.errorKey));
      return;
    }
    if (savedAttachments.length + pollFiles.length > MAX_POLL_ATTACHMENTS) {
      onError(t('admin.pollAttachmentsTooMany', { n: String(MAX_POLL_ATTACHMENTS) }));
      return;
    }
    for (const file of pollFiles) {
      const rejected = privateUploadRejectReason(POLL_IMAGES_BUCKET, file);
      if (rejected === 'size') {
        onError(t('err.uploadSize'));
        return;
      }
      if (rejected === 'type') {
        onError(t('err.uploadType'));
        return;
      }
    }

    const title = pollForm.title.trim();
    const options = pollForm.options.map((o) => o.trim()).filter(Boolean);
    setBusy(true);
    try {
      let pollId = resumePollId;
      if (pollId == null) {
        const { data, error } = await supabase
          .from('polls')
          .insert({
            title,
            body: pollForm.body.trim() || null,
            category: pollForm.category,
            status: 'открыт',
            result: 'идёт',
            voting_starts: pollForm.voting_starts || null,
            deadline: pollForm.deadline || null,
            budget_eur: pollForm.budget_eur ? Number(pollForm.budget_eur) : null,
            created_by: pollForm.created_by.trim() || 'УК',
            attachments: [] as unknown as Json,
          })
          .select('id')
          .single();
        if (error) throw error;
        pollId = data.id as number;
        const { error: optErr } = await supabase.from('poll_options').insert(
          options.map((label, i) => ({ poll_id: pollId!, label, sort_order: i })),
        );
        if (optErr) throw optErr;
        setResumePollId(pollId);
      }

      const pending = [...pollFiles];
      const { saved, failedNames } = await persistPollAttachments(
        pollId,
        savedAttachments,
        pending,
      );
      setSavedAttachments(saved);
      setPollFiles([]);

      if (failedNames.length > 0) {
        setResumePollId(pollId);
        onError(
          t('admin.pollAttachmentsPartialFail', {
            ok: String(saved.length),
            fail: String(failedNames.length),
            names: failedNames.slice(0, 3).join(', '),
          }),
        );
        await onChanged();
        return;
      }

      setShowForm(false);
      setResumePollId(null);
      setSavedAttachments([]);
      setPollFiles([]);
      await onChanged();
    } catch (err: unknown) {
      onError(
        messageForUploadError(err, t('err.uploadType'), t('err.uploadSize')) ??
          toUserFacingMessage(err, t, { fallback: t('admin.pollSaveFailed') }),
      );
    } finally {
      setBusy(false);
    }
  }

  async function onToggle(poll: Poll) {
    if (!canManage) {
      onError(t('admin.errNoAccess'));
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.rpc('set_poll_lifecycle', {
        p_poll_id: poll.id,
        p_close: poll.status === 'открыт',
      });
      if (error) throw error;
      await onChanged();
    } catch (err: unknown) {
      onError(toUserFacingMessage(err, t, { fallback: t('admin.pollToggleFailed') }));
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(id: number) {
    if (!canManage) {
      onError(t('admin.errNoAccess'));
      return;
    }
    const ok = await confirm({
      title: t('confirm.deletePoll'),
      confirmLabel: t('common.delete'),
      cancelLabel: t('common.cancel'),
      tone: 'danger',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const { error } = await supabase.from('polls').delete().eq('id', id);
      if (error) throw error;
      setDetailId((cur) => (cur === id ? null : cur));
      await onChanged();
    } catch (err: unknown) {
      onError(toUserFacingMessage(err, t, { fallback: t('admin.pollDeleteFailed') }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {dialog}
      <AdminPageHeader
        title={t('admin.polls')}
        secondary={t('admin.pollsLeadAdmin')}
        action={
          canManage ? (
            <AdminPrimaryButton type="button" onClick={openCreate}>
              + {t('admin.pollFormTitle')}
            </AdminPrimaryButton>
          ) : undefined
        }
      />
      <p className="text-xs text-muted">{t('account.pollsNotMeeting')}</p>

      {showForm ? (
        <form onSubmit={(e) => void onSubmit(e)} className={adminFormPanelClass}>
          <h3 className="text-sm font-semibold text-foreground">{t('admin.pollFormTitle')}</h3>
          <select
            className={adminFieldClass}
            value={pollForm.category}
            onChange={(e) =>
              setPollForm({ ...pollForm, category: e.target.value as PollCategory })
            }
          >
            <option value="ремонт">{labelPollCategory('ремонт', t)}</option>
            <option value="покупка">{labelPollCategory('покупка', t)}</option>
            <option value="опрос">{labelPollCategory('опрос', t)}</option>
          </select>
          <input
            className={adminFieldClass}
            placeholder={t('admin.pollWhatPh')}
            value={pollForm.title}
            onChange={(e) => setPollForm({ ...pollForm, title: e.target.value })}
            required
          />
          <textarea
            className={adminFieldClass}
            placeholder={t('admin.pollBodyPh')}
            rows={3}
            value={pollForm.body}
            onChange={(e) => setPollForm({ ...pollForm, body: e.target.value })}
          />
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs text-secondary">{t('admin.pollStarts')}</label>
              <input
                type="date"
                className={adminFieldClass}
                value={pollForm.voting_starts}
                onChange={(e) => setPollForm({ ...pollForm, voting_starts: e.target.value })}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-secondary">{t('admin.pollEnds')}</label>
              <input
                type="date"
                className={adminFieldClass}
                value={pollForm.deadline}
                onChange={(e) => setPollForm({ ...pollForm, deadline: e.target.value })}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-secondary">{t('admin.pollBudget')}</label>
              <input
                type="number"
                step="0.01"
                min="0"
                className={adminFieldClass}
                placeholder="0.00"
                value={pollForm.budget_eur}
                onChange={(e) => setPollForm({ ...pollForm, budget_eur: e.target.value })}
              />
            </div>
          </div>
          <div className="space-y-2">
            <AppFilePicker
              label={t('admin.pollAttachments')}
              accept={POLL_ATTACHMENT_ACCEPT}
              multiple
              resetInputAfterChange
              disabled={busy || savedAttachments.length + pollFiles.length >= MAX_POLL_ATTACHMENTS}
              hint={t('admin.pollAttachmentsHint', {
                formats: formatAcceptHint(POLL_ATTACHMENT_ACCEPT),
                size: formatFileSizeMb(MAX_PRIVATE_UPLOAD_BYTES),
                n: String(MAX_POLL_ATTACHMENTS),
              })}
              onChange={(picked) => {
                const room = MAX_POLL_ATTACHMENTS - savedAttachments.length - pollFiles.length;
                if (room <= 0) return;
                const added = picked.slice(0, room);
                if (added.length) setPollFiles((prev) => [...prev, ...added]);
              }}
            />
            {savedAttachments.length > 0 ? (
              <div className="space-y-1">
                <p className="text-xs text-secondary">{t('admin.pollAttachmentsSaved')}</p>
                <PollAttachmentsView attachments={savedAttachments} />
              </div>
            ) : null}
            <PollPendingAttachments
              files={pollFiles}
              disabled={busy}
              onRemove={(index) =>
                setPollFiles((prev) => prev.filter((_, i) => i !== index))
              }
            />
          </div>
          <div className="space-y-2">
            <div className="text-xs text-secondary">{t('admin.pollOptions')}</div>
            {pollForm.options.map((opt, i) => (
              <div key={i} className="flex gap-2">
                <input
                  className={adminFieldClass}
                  value={opt}
                  onChange={(e) => {
                    const next = [...pollForm.options];
                    next[i] = e.target.value;
                    setPollForm({ ...pollForm, options: next });
                  }}
                  required
                />
                {pollForm.options.length > 2 ? (
                  <button
                    type="button"
                    onClick={() =>
                      setPollForm({
                        ...pollForm,
                        options: pollForm.options.filter((_, idx) => idx !== i),
                      })
                    }
                    className="rounded px-2 text-xs text-danger bg-danger-bg"
                  >
                    ✕
                  </button>
                ) : null}
              </div>
            ))}
            <button
              type="button"
              onClick={() => setPollForm({ ...pollForm, options: [...pollForm.options, ''] })}
              className={adminBtnTertiaryClass}
            >
              + {t('admin.pollAddOption')}
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            <AdminPrimaryButton type="submit" disabled={busy}>
              {busy
                ? t('common.saving')
                : resumePollId != null
                  ? t('admin.pollAttachmentsRetry')
                  : t('admin.pollPublish')}
            </AdminPrimaryButton>
            <AdminSecondaryButton
              type="button"
              disabled={busy}
              onClick={closeCreateForm}
            >
              {t('common.cancel')}
            </AdminSecondaryButton>
          </div>
        </form>
      ) : null}

      {polls.length === 0 && !showForm ? (
        <AdminEmptyState title={t('account.noPolls')} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {polls.map((poll) => {
            const summary = pollCardSummary(poll, pollOptions, pollVotes, areaProps);
            return (
              <button
                key={poll.id}
                type="button"
                onClick={() => {
                  setShowHistory(false);
                  setDetailId(poll.id);
                }}
                className={`${adminCardClass} flex w-full flex-col gap-2 p-3 text-left transition hover:bg-hover/40`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 truncate text-sm font-semibold text-foreground">
                    {poll.title}
                  </div>
                  <StatusBadge
                    label={t(pollAdminLifecycleLabelKey(summary.lifecycle))}
                    tone={pollAdminLifecycleTone(summary.lifecycle)}
                  />
                </div>
                <div className="text-xs text-muted">
                  {labelPollCategory(poll.category, t)} · {formatOwnerDate(poll.voting_starts, locale)} –{' '}
                  {formatOwnerDate(poll.deadline, locale)}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge
                    label={labelPollDecision(summary.decision, t)}
                    tone={pollDecisionTone(summary.decision)}
                  />
                  <span className="text-xs text-secondary">
                    {t('admin.pollVotesN', { n: summary.voteCount })}
                  </span>
                </div>
                {summary.leadingLabel ? (
                  <div className="text-xs text-secondary">
                    {t('admin.pollLeading', {
                      label: summary.leadingLabel,
                      pct: summary.leadingPct?.toFixed(1) ?? '0',
                    })}
                  </div>
                ) : (
                  <div className="text-xs text-muted">{t('admin.pollNoVotesYet')}</div>
                )}
              </button>
            );
          })}
        </div>
      )}

      <AdminModal
        open={Boolean(selected)}
        size="workplace"
        entityKey={selected?.id}
        title={selected?.title ?? t('admin.polls')}
        closeLabel={t('common.close')}
        onClose={() => setDetailId(null)}
        onRequestClose={() => setDetailId(null)}
        titleMeta={
          selected ? (
            <>
              <StatusBadge label={labelPollCategory(selected.category, t)} />
              <StatusBadge
                label={labelPollStatus(selected.status, t)}
                tone={selected.status === 'открыт' ? 'info' : 'neutral'}
              />
              <StatusBadge
                label={labelPollDecision(detailDecision, t)}
                tone={pollDecisionTone(detailDecision)}
              />
              <span>
                {formatOwnerDate(selected.voting_starts, locale)} –{' '}
                {formatOwnerDate(selected.deadline, locale)}
              </span>
            </>
          ) : null
        }
        footer={
          selected && canManage ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void onDelete(selected.id)}
              className={adminBtnDangerClass}
            >
              {t('common.delete')}
            </button>
          ) : null
        }
      >
        {selected ? (
          <div className="space-y-4">
            <PollDetails
              poll={selected}
              options={detailOptions}
              votes={detailVotes}
              properties={areaProps}
            />
            <PollOptionBars
              poll={selected}
              options={detailOptions}
              votes={detailVotes}
              properties={areaProps}
              alwaysShowStats
            />
            <div className="flex flex-wrap gap-2">
              {canManage ? (
                <AdminSecondaryButton
                  type="button"
                  disabled={busy}
                  onClick={() => void onToggle(selected)}
                >
                  {selected.status === 'открыт' ? t('admin.pollClose') : t('admin.pollReopen')}
                </AdminSecondaryButton>
              ) : null}
              <button
                type="button"
                onClick={() => setShowHistory((v) => !v)}
                className={adminBtnTertiaryClass}
              >
                {showHistory
                  ? t('admin.pollHideHistory')
                  : t('admin.pollHistory', { n: detailHistory.length })}
              </button>
            </div>
            {showHistory ? (
              detailHistory.length === 0 ? (
                <AdminEmptyState title={t('admin.pollNoHistory')} />
              ) : (
                <AdminTableShell>
                  <table className="w-full min-w-[520px] text-xs">
                    <thead>
                      <tr className={adminTableHeadRowClass}>
                        <th className={adminTableCellClass}>{t('admin.pollWhen')}</th>
                        <th className={adminTableCellClass}>{t('admin.aptLabel')}</th>
                        <th className={adminTableCellClass}>{t('admin.pollVote')}</th>
                        <th className={`${adminTableCellClass} text-right`}>
                          {t('admin.pollWeight')}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {detailHistory.map((h) => (
                        <tr key={h.id} className={adminTableRowClass}>
                          <td className={adminTableCellClass}>
                            {formatOwnerDateTime(h.created_at, locale)}
                          </td>
                          <td className={adminTableCellClass}>
                            {aptById.get(h.property_id) ?? h.property_id}
                          </td>
                          <td className={adminTableCellClass}>
                            {detailOptions.find((o) => o.id === h.option_id)?.label ?? h.option_id}
                          </td>
                          <td className={`${adminTableCellClass} text-right`}>
                            {formatM3(Number(h.weight ?? 0), locale)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </AdminTableShell>
              )
            ) : null}
          </div>
        ) : null}
      </AdminModal>
    </div>
  );
}
