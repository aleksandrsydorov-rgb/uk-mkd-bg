'use client';

import { useCallback, useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { useI18n } from '@/i18n/I18nProvider';
import { labelCategory, labelPriority } from '@/i18n/labels';
import { formatOwnerDateTime } from '@/lib/ownerFormat';
import { isMissingRelation } from '@/lib/polls';
import { ownerVisibleError } from '@/lib/ownerError';
import {
  workOrderClaimErrorKey,
  type ClaimableRequestRow,
  type MyWorkOrderRow,
} from '@/lib/workOrders';
import {
  AdminPageHeader,
  AdminCard,
  AdminEmptyState,
  AdminInlineAlert,
  AdminPrimaryButton,
  AdminSecondaryButton,
  adminFieldClass,
  adminFormPanelClass,
} from '@/components/admin/AdminUi';
import { StatusBadge } from '@/components/account/ownerUi';

function statusTone(status: string): 'warning' | 'info' | 'success' | 'danger' | 'neutral' {
  if (status === 'open') return 'warning';
  if (status === 'in_progress') return 'info';
  if (status === 'completed') return 'success';
  if (status === 'cancelled') return 'danger';
  return 'neutral';
}

export function AdminMyTasks({
  supabase,
  locale,
}: {
  supabase: SupabaseClient<Database>;
  locale: string;
}) {
  const { t } = useI18n();
  const [rows, setRows] = useState<MyWorkOrderRow[]>([]);
  const [claimable, setClaimable] = useState<ClaimableRequestRow[]>([]);
  const [canSelfClaim, setCanSelfClaim] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [completeId, setCompleteId] = useState<string | null>(null);
  const [completionNote, setCompletionNote] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const profileRes = await supabase.rpc('get_my_work_claim_profile');
      let selfClaim = false;
      if (!profileRes.error && profileRes.data?.[0]) {
        selfClaim = profileRes.data[0].can_self_claim_requests === true;
        setCanSelfClaim(selfClaim);
      } else if (
        profileRes.error &&
        !isMissingRelation(profileRes.error, 'get_my_work_claim_profile')
      ) {
        // Profile RPC may be missing before migration; keep nav usable.
        setCanSelfClaim(false);
      }

      const tasksRes = await supabase.rpc('list_my_work_orders');
      if (tasksRes.error) {
        if (
          isMissingRelation(tasksRes.error, 'list_my_work_orders') ||
          isMissingRelation(tasksRes.error, 'work_orders')
        ) {
          setRows([]);
        } else {
          throw tasksRes.error;
        }
      } else {
        setRows((tasksRes.data as MyWorkOrderRow[] | null) ?? []);
      }

      if (selfClaim) {
        const claimRes = await supabase.rpc('list_claimable_requests');
        if (claimRes.error) {
          if (!isMissingRelation(claimRes.error, 'list_claimable_requests')) {
            throw claimRes.error;
          }
          setClaimable([]);
        } else {
          setClaimable((claimRes.data as ClaimableRequestRow[] | null) ?? []);
        }
      } else {
        setClaimable([]);
      }
    } catch (e: unknown) {
      setError(ownerVisibleError(e, t('admin.errGeneric')));
      setRows([]);
      setClaimable([]);
    } finally {
      setLoading(false);
    }
  }, [supabase, t]);

  useEffect(() => {
    void load();
  }, [load]);

  function statusLabel(status: string) {
    if (status === 'open') return t('admin.woStatusOpen');
    if (status === 'in_progress') return t('admin.woStatusInProgress');
    if (status === 'completed') return t('admin.woStatusCompleted');
    if (status === 'cancelled') return t('admin.woStatusCancelled');
    return status;
  }

  function priorityLabel(priority: string) {
    if (priority === 'low') return t('admin.woPriorityLow');
    if (priority === 'high') return t('admin.woPriorityHigh');
    return t('admin.woPriorityNormal');
  }

  async function handleClaim(requestId: number) {
    setError(null);
    setBusyId(`claim-${requestId}`);
    try {
      const { error: rpcErr } = await supabase.rpc('claim_request_as_work_order', {
        p_request_id: requestId,
      });
      if (rpcErr) {
        const key = workOrderClaimErrorKey(rpcErr.message ?? '');
        throw key ? new Error(t(key)) : rpcErr;
      }
      await load();
    } catch (e: unknown) {
      setError(ownerVisibleError(e, t('admin.errGeneric')));
    } finally {
      setBusyId(null);
    }
  }

  async function handleStart(id: string) {
    setError(null);
    setBusyId(id);
    try {
      const { error: rpcErr } = await supabase.rpc('start_work_order', { p_work_order_id: id });
      if (rpcErr) throw rpcErr;
      await load();
    } catch (e: unknown) {
      setError(ownerVisibleError(e, t('admin.errGeneric')));
    } finally {
      setBusyId(null);
    }
  }

  async function handleComplete(e: React.FormEvent) {
    e.preventDefault();
    if (!completeId) return;
    setError(null);
    setBusyId(completeId);
    try {
      const { error: rpcErr } = await supabase.rpc('complete_work_order', {
        p_work_order_id: completeId,
        p_completion_note: completionNote.trim() || null,
      });
      if (rpcErr) throw rpcErr;
      setCompleteId(null);
      setCompletionNote('');
      await load();
    } catch (err: unknown) {
      setError(ownerVisibleError(err, t('admin.errGeneric')));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="min-w-0 space-y-6">
      <AdminPageHeader title={t('admin.myTasks')} secondary={t('admin.myTasksLead')} />
      {error ? <AdminInlineAlert tone="danger">{error}</AdminInlineAlert> : null}

      {completeId ? (
        <AdminCard className={adminFormPanelClass}>
          <h3 className="text-sm font-semibold text-foreground">{t('admin.woCompleteTitle')}</h3>
          <form onSubmit={handleComplete} className="mt-3 space-y-3">
            <label className="grid gap-1 text-sm text-secondary">
              {t('admin.woCompletionNote')}
              <textarea
                className={adminFieldClass}
                rows={3}
                value={completionNote}
                onChange={(e) => setCompletionNote(e.target.value)}
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <AdminPrimaryButton type="submit" disabled={busyId === completeId}>
                {busyId === completeId ? t('common.saving') : t('admin.woComplete')}
              </AdminPrimaryButton>
              <AdminSecondaryButton
                type="button"
                onClick={() => {
                  setCompleteId(null);
                  setCompletionNote('');
                }}
              >
                {t('common.cancel')}
              </AdminSecondaryButton>
            </div>
          </form>
        </AdminCard>
      ) : null}

      {canSelfClaim ? (
        <section className="space-y-3">
          <div>
            <h2 className="text-base font-semibold text-foreground">{t('admin.availableRequests')}</h2>
            <p className="mt-1 text-sm text-muted">{t('admin.availableRequestsLead')}</p>
          </div>
          {loading ? (
            <p className="text-sm text-muted">{t('common.loading')}</p>
          ) : claimable.length === 0 ? (
            <AdminEmptyState title={t('admin.availableRequestsEmpty')} />
          ) : (
            <div className="space-y-3">
              {claimable.map((row) => (
                <AdminCard key={row.request_id} className="space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground">
                        #{row.request_id}
                        {row.subject ? ` · ${row.subject}` : ''}
                      </p>
                      <p className="mt-1 text-xs text-muted">
                        {row.category ? labelCategory(row.category, t) : '—'}
                        {row.priority ? ` · ${labelPriority(row.priority, t)}` : ''}
                        {row.apartment_number ? ` · № ${row.apartment_number}` : ''}
                      </p>
                    </div>
                    <p className="text-xs text-muted">{formatOwnerDateTime(row.created_at, locale)}</p>
                  </div>
                  {row.description ? (
                    <p className="whitespace-pre-wrap text-sm text-secondary">{row.description}</p>
                  ) : null}
                  <dl className="grid gap-1 text-sm text-secondary sm:grid-cols-2">
                    <div>
                      <dt className="text-xs text-muted">{t('admin.woRequester')}</dt>
                      <dd>{row.owner_name || '—'}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted">{t('admin.woPhone')}</dt>
                      <dd>{row.owner_phone || '—'}</dd>
                    </div>
                  </dl>
                  <AdminPrimaryButton
                    type="button"
                    disabled={busyId === `claim-${row.request_id}`}
                    onClick={() => void handleClaim(row.request_id)}
                  >
                    {busyId === `claim-${row.request_id}`
                      ? t('common.saving')
                      : t('admin.woTakeIntoWork')}
                  </AdminPrimaryButton>
                </AdminCard>
              ))}
            </div>
          )}
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-foreground">{t('admin.myTasks')}</h2>
        {loading ? (
          <p className="text-sm text-muted">{t('common.loading')}</p>
        ) : rows.length === 0 ? (
          <AdminEmptyState title={t('admin.woMyEmpty')} />
        ) : (
          <div className="space-y-3">
            {rows.map((row) => (
              <AdminCard key={row.id} className="space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground">{row.title}</p>
                    <p className="mt-1 text-xs text-muted">
                      {priorityLabel(row.priority)}
                      {row.apartment_number ? ` · № ${row.apartment_number}` : ''}
                      {row.location_description ? ` · ${row.location_description}` : ''}
                    </p>
                  </div>
                  <StatusBadge label={statusLabel(row.status)} tone={statusTone(row.status)} />
                </div>
                {row.instructions ? (
                  <p className="whitespace-pre-wrap text-sm text-secondary">{row.instructions}</p>
                ) : null}
                {row.request_id != null ? (
                  <div className="rounded-[12px] border border-border bg-surface-secondary/80 p-3 text-sm text-secondary">
                    <p className="font-semibold text-foreground">{t('admin.woSourceContext')}</p>
                    <dl className="mt-2 grid gap-1 sm:grid-cols-2">
                      <div>
                        <dt className="text-xs text-muted">{t('admin.woSourceRequestLabel')}</dt>
                        <dd>
                          #{row.request_id}
                          {row.request_subject ? ` · ${row.request_subject}` : ''}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted">{t('admin.woRequester')}</dt>
                        <dd>{row.requester_name || '—'}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted">{t('admin.woPhone')}</dt>
                        <dd>{row.requester_phone || '—'}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted">{t('admin.woLocation')}</dt>
                        <dd>{row.apartment_number ? `№ ${row.apartment_number}` : '—'}</dd>
                      </div>
                    </dl>
                  </div>
                ) : null}
                {row.scheduled_for ? (
                  <p className="text-xs text-muted">
                    {t('admin.woSchedule')}: {formatOwnerDateTime(row.scheduled_for, locale)}
                  </p>
                ) : null}
                {row.status === 'completed' && row.completion_note ? (
                  <p className="text-sm text-secondary">
                    {t('admin.woCompletionNote')}: {row.completion_note}
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  {row.status === 'open' ? (
                    <AdminPrimaryButton
                      type="button"
                      disabled={busyId === row.id}
                      onClick={() => void handleStart(row.id)}
                    >
                      {t('admin.woStart')}
                    </AdminPrimaryButton>
                  ) : null}
                  {row.status === 'in_progress' ? (
                    <AdminPrimaryButton
                      type="button"
                      disabled={busyId === row.id}
                      onClick={() => {
                        setCompleteId(row.id);
                        setCompletionNote('');
                      }}
                    >
                      {t('admin.woComplete')}
                    </AdminPrimaryButton>
                  ) : null}
                </div>
              </AdminCard>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
