'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { useI18n } from '@/i18n/I18nProvider';
import { labelCategory, labelStaffRole } from '@/i18n/labels';
import { formatOwnerDateTime } from '@/lib/ownerFormat';
import { isMissingRelation } from '@/lib/polls';
import { ownerVisibleError } from '@/lib/ownerError';
import {
  isAssignableWorkRole,
  isWorkOrderPriority,
  workOrderClaimErrorKey,
  type RequestWorkOrderContext,
  type WorkOrderAdminRow,
  type WorkOrderPriority,
} from '@/lib/workOrders';
import {
  AdminPageHeader,
  AdminCard,
  AdminEmptyState,
  AdminFilterBar,
  AdminInlineAlert,
  AdminPrimaryButton,
  AdminSecondaryButton,
  AdminTableShell,
  adminBtnTertiaryClass,
  adminFieldClass,
  adminFormPanelClass,
  adminTableCellClass,
  adminTableHeadRowClass,
  adminTableRowClass,
} from '@/components/admin/AdminUi';
import { ApartmentCombobox } from '@/components/admin/ApartmentCombobox';
import { StatusBadge } from '@/components/account/ownerUi';

type PropertyOption = {
  id: number;
  apartment_number: string | number | null;
};

type StaffOption = {
  id: number;
  name: string;
  role: string;
  active: boolean | null;
};

function statusTone(status: string): 'warning' | 'info' | 'success' | 'danger' | 'neutral' {
  if (status === 'open') return 'warning';
  if (status === 'in_progress') return 'info';
  if (status === 'completed') return 'success';
  if (status === 'cancelled') return 'danger';
  return 'neutral';
}

function SourceContextBlock({
  ctx,
  locale,
}: {
  ctx: {
    request_id: number;
    request_subject?: string | null;
    requester_name?: string | null;
    requester_phone?: string | null;
    apartment_number?: string | null;
    category?: string | null;
  };
  locale: string;
}) {
  const { t } = useI18n();
  void locale;
  return (
    <div className="rounded-[12px] border border-border bg-surface-secondary/80 p-3 text-sm text-secondary sm:col-span-2">
      <p className="font-semibold text-foreground">{t('admin.woSourceContext')}</p>
      <dl className="mt-2 grid gap-1 sm:grid-cols-2">
        <div>
          <dt className="text-xs text-muted">{t('admin.woSourceRequestLabel')}</dt>
          <dd>
            #{ctx.request_id}
            {ctx.request_subject ? ` · ${ctx.request_subject}` : ''}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted">{t('admin.woRequester')}</dt>
          <dd>{ctx.requester_name || '—'}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">{t('admin.woPhone')}</dt>
          <dd>{ctx.requester_phone || '—'}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">{t('admin.woLocation')}</dt>
          <dd>{ctx.apartment_number ? `№ ${ctx.apartment_number}` : '—'}</dd>
        </div>
        {ctx.category ? (
          <div>
            <dt className="text-xs text-muted">{t('admin.woRequestCategories')}</dt>
            <dd>{labelCategory(ctx.category, t)}</dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}

export function AdminWorkOrders({
  supabase,
  properties,
  staff,
  locale,
  fromRequestId = null,
  onClearFromRequest,
}: {
  supabase: SupabaseClient<Database>;
  properties: PropertyOption[];
  staff: StaffOption[];
  locale: string;
  fromRequestId?: number | null;
  onClearFromRequest?: () => void;
}) {
  const { t } = useI18n();
  const [rows, setRows] = useState<WorkOrderAdminRow[]>([]);
  const [assignees, setAssignees] = useState<StaffOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(Boolean(fromRequestId));
  const [statusFilter, setStatusFilter] = useState('');
  const [sourceCtx, setSourceCtx] = useState<RequestWorkOrderContext | null>(null);
  const [form, setForm] = useState({
    title: '',
    instructions: '',
    priority: 'normal' as WorkOrderPriority,
    assigned_staff_id: '' as number | '',
    scheduled_for: '',
    target_property_id: '' as number | '',
    location_description: '',
    request_id: fromRequestId,
  });

  const assignableStaff = useMemo(() => {
    if (assignees.length > 0) return assignees;
    return staff.filter((s) => s.active === true && isAssignableWorkRole(s.role));
  }, [assignees, staff]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [woRes, asRes] = await Promise.all([
        supabase.rpc('list_work_orders_admin'),
        supabase.rpc('list_work_order_assignees'),
      ]);
      if (woRes.error) {
        if (
          isMissingRelation(woRes.error, 'list_work_orders_admin') ||
          isMissingRelation(woRes.error, 'work_orders')
        ) {
          setRows([]);
          return;
        }
        throw woRes.error;
      }
      setRows((woRes.data as WorkOrderAdminRow[] | null) ?? []);
      if (!asRes.error && asRes.data) {
        setAssignees(
          (asRes.data as { id: number; name: string; role: string }[]).map((s) => ({
            ...s,
            active: true,
          })),
        );
      }
    } catch (e: unknown) {
      setError(ownerVisibleError(e, t('admin.errGeneric')));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [supabase, t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (fromRequestId == null) {
      setSourceCtx(null);
      return;
    }
    setShowForm(true);
    let cancelled = false;
    (async () => {
      try {
        const { data, error: rpcErr } = await supabase.rpc('get_request_work_order_context', {
          p_request_id: fromRequestId,
        });
        if (rpcErr) throw rpcErr;
        const row = ((data as RequestWorkOrderContext[] | null) ?? [])[0] ?? null;
        if (cancelled) return;
        setSourceCtx(row);
        const priority = isWorkOrderPriority(row?.work_priority) ? row!.work_priority : 'normal';
        setForm({
          title: row?.subject?.trim() || '',
          instructions: row?.description?.trim() || '',
          priority,
          assigned_staff_id: '',
          scheduled_for: '',
          target_property_id: row?.property_id ?? '',
          location_description: row?.apartment_number ? `№ ${row.apartment_number}` : '',
          request_id: fromRequestId,
        });
      } catch (e: unknown) {
        if (cancelled) return;
        setForm((prev) => ({ ...prev, request_id: fromRequestId }));
        setError(ownerVisibleError(e, t('admin.errGeneric')));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fromRequestId, supabase, t]);

  const visible = useMemo(() => {
    if (!statusFilter) return rows;
    return rows.filter((r) => r.status === statusFilter);
  }, [rows, statusFilter]);

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

  function sourceLabel(source: string) {
    return source === 'request' ? t('admin.woSourceRequest') : t('admin.woSourceAdmin');
  }

  function resetForm() {
    setForm({
      title: '',
      instructions: '',
      priority: 'normal',
      assigned_staff_id: '',
      scheduled_for: '',
      target_property_id: '',
      location_description: '',
      request_id: null,
    });
    setSourceCtx(null);
    setShowForm(false);
    onClearFromRequest?.();
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusyId('create');
    try {
      const priority = isWorkOrderPriority(form.priority) ? form.priority : 'normal';
      const scheduled = form.scheduled_for ? new Date(form.scheduled_for).toISOString() : null;
      const assigned = form.assigned_staff_id === '' ? null : Number(form.assigned_staff_id);
      if (form.request_id != null) {
        const { error: rpcErr } = await supabase.rpc('create_work_order_from_request', {
          p_request_id: form.request_id,
          p_title: form.title.trim() || null,
          p_instructions: form.instructions.trim() || null,
          p_priority: priority,
          p_assigned_staff_id: assigned,
          p_scheduled_for: scheduled,
          p_location_description: form.location_description.trim() || null,
          p_idempotency_key: crypto.randomUUID(),
        });
        if (rpcErr) {
          const key = workOrderClaimErrorKey(rpcErr.message ?? '');
          throw key ? new Error(t(key)) : rpcErr;
        }
      } else {
        if (!form.title.trim()) {
          setError(t('admin.woTitleRequired'));
          return;
        }
        const { error: rpcErr } = await supabase.rpc('create_work_order', {
          p_title: form.title.trim(),
          p_instructions: form.instructions.trim() || null,
          p_priority: priority,
          p_assigned_staff_id: assigned,
          p_scheduled_for: scheduled,
          p_target_property_id: form.target_property_id === '' ? null : Number(form.target_property_id),
          p_location_description: form.location_description.trim() || null,
          p_idempotency_key: crypto.randomUUID(),
        });
        if (rpcErr) throw rpcErr;
      }
      resetForm();
      await load();
    } catch (err: unknown) {
      setError(ownerVisibleError(err, t('admin.errGeneric')));
    } finally {
      setBusyId(null);
    }
  }

  async function handleAssign(id: string, staffId: number | '') {
    setError(null);
    setBusyId(id);
    try {
      const { error: rpcErr } = await supabase.rpc('assign_work_order', {
        p_work_order_id: id,
        p_assigned_staff_id: staffId === '' ? null : Number(staffId),
      });
      if (rpcErr) throw rpcErr;
      await load();
    } catch (err: unknown) {
      setError(ownerVisibleError(err, t('admin.errGeneric')));
    } finally {
      setBusyId(null);
    }
  }

  async function handleCancel(id: string) {
    if (!confirm(t('admin.woConfirmCancel'))) return;
    setError(null);
    setBusyId(id);
    try {
      const { error: rpcErr } = await supabase.rpc('cancel_work_order', { p_work_order_id: id });
      if (rpcErr) throw rpcErr;
      await load();
    } catch (err: unknown) {
      setError(ownerVisibleError(err, t('admin.errGeneric')));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="min-w-0 space-y-4">
      <AdminPageHeader
        title={t('admin.workOrders')}
        secondary={t('admin.workOrdersLead')}
        action={
          <AdminPrimaryButton
            type="button"
            onClick={() => {
              setSourceCtx(null);
              setShowForm(true);
              setForm((prev) => ({
                ...prev,
                request_id: null,
                title: '',
                instructions: '',
                target_property_id: '',
                location_description: '',
              }));
            }}
          >
            + {t('admin.woNew')}
          </AdminPrimaryButton>
        }
      />

      {error ? <AdminInlineAlert tone="danger">{error}</AdminInlineAlert> : null}

      {showForm ? (
        <AdminCard className={adminFormPanelClass}>
          <h3 className="text-sm font-semibold text-foreground">
            {form.request_id != null ? t('admin.woFromRequest', { n: String(form.request_id) }) : t('admin.woNew')}
          </h3>
          <form onSubmit={handleCreate} className="mt-3 grid gap-3 sm:grid-cols-2">
            {sourceCtx ? (
              <SourceContextBlock
                locale={locale}
                ctx={{
                  request_id: sourceCtx.request_id,
                  request_subject: sourceCtx.subject,
                  requester_name: sourceCtx.owner_name,
                  requester_phone: sourceCtx.owner_phone,
                  apartment_number: sourceCtx.apartment_number,
                  category: sourceCtx.category,
                }}
              />
            ) : null}
            <label className="grid gap-1 text-sm text-secondary sm:col-span-2">
              {t('admin.woTitle')}
              <input
                className={adminFieldClass}
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder={form.request_id != null ? t('admin.woTitleFromRequestHint') : undefined}
                required={form.request_id == null}
              />
            </label>
            <label className="grid gap-1 text-sm text-secondary sm:col-span-2">
              {t('admin.woInstructions')}
              <textarea
                className={adminFieldClass}
                rows={3}
                value={form.instructions}
                onChange={(e) => setForm({ ...form, instructions: e.target.value })}
              />
            </label>
            <label className="grid gap-1 text-sm text-secondary">
              {t('admin.woPriority')}
              <select
                className={adminFieldClass}
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: e.target.value as WorkOrderPriority })}
              >
                <option value="low">{t('admin.woPriorityLow')}</option>
                <option value="normal">{t('admin.woPriorityNormal')}</option>
                <option value="high">{t('admin.woPriorityHigh')}</option>
              </select>
            </label>
            <label className="grid gap-1 text-sm text-secondary">
              {t('admin.woAssignee')}
              <select
                className={adminFieldClass}
                value={form.assigned_staff_id === '' ? '' : String(form.assigned_staff_id)}
                onChange={(e) =>
                  setForm({
                    ...form,
                    assigned_staff_id: e.target.value ? Number(e.target.value) : '',
                  })
                }
              >
                <option value="">{t('admin.woUnassigned')}</option>
                {assignableStaff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} · {labelStaffRole(s.role, t)}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm text-secondary">
              {t('admin.woSchedule')}
              <input
                type="datetime-local"
                className={adminFieldClass}
                value={form.scheduled_for}
                onChange={(e) => setForm({ ...form, scheduled_for: e.target.value })}
              />
            </label>
            {form.request_id == null ? (
              <div className="grid gap-1 text-sm text-secondary">
                <span>{t('admin.aptLabel')}</span>
                <ApartmentCombobox
                  properties={properties}
                  value={form.target_property_id}
                  onChange={(id) => setForm({ ...form, target_property_id: id === '' ? '' : Number(id) })}
                />
              </div>
            ) : (
              <p className="self-end text-sm text-muted">{t('admin.woRequestKeepsOpen')}</p>
            )}
            <label className="grid gap-1 text-sm text-secondary sm:col-span-2">
              {t('admin.woLocation')}
              <input
                className={adminFieldClass}
                value={form.location_description}
                onChange={(e) => setForm({ ...form, location_description: e.target.value })}
              />
            </label>
            <div className="flex flex-wrap gap-2 sm:col-span-2">
              <AdminPrimaryButton type="submit" disabled={busyId === 'create'}>
                {busyId === 'create' ? t('common.saving') : t('admin.woCreate')}
              </AdminPrimaryButton>
              <AdminSecondaryButton type="button" onClick={resetForm}>
                {t('common.cancel')}
              </AdminSecondaryButton>
            </div>
          </form>
        </AdminCard>
      ) : null}

      <AdminFilterBar>
        <select className={adminFieldClass} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">{t('form.allStatuses')}</option>
          <option value="open">{t('admin.woStatusOpen')}</option>
          <option value="in_progress">{t('admin.woStatusInProgress')}</option>
          <option value="completed">{t('admin.woStatusCompleted')}</option>
          <option value="cancelled">{t('admin.woStatusCancelled')}</option>
        </select>
      </AdminFilterBar>

      {loading ? (
        <p className="text-sm text-muted">{t('common.loading')}</p>
      ) : visible.length === 0 ? (
        <AdminEmptyState title={t('admin.woEmpty')} />
      ) : (
        <>
          <div className="space-y-2 md:hidden">
            {visible.map((row) => (
              <div key={row.id} className="rounded-[14px] border border-border bg-surface p-3 shadow-card">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium text-foreground">{row.title}</p>
                  <StatusBadge label={statusLabel(row.status)} tone={statusTone(row.status)} />
                </div>
                <p className="mt-1 text-xs text-muted">
                  {priorityLabel(row.priority)} · {sourceLabel(row.source_type)}
                  {row.request_id != null ? ` #${row.request_id}` : ''}
                </p>
                {row.request_id != null ? (
                  <p className="mt-1 text-xs text-secondary">
                    {t('admin.woRequester')}: {row.requester_name || '—'}
                    {row.requester_phone ? ` · ${row.requester_phone}` : ''}
                    {row.request_subject ? ` · ${row.request_subject}` : ''}
                  </p>
                ) : null}
                <p className="mt-1 text-xs text-secondary">
                  {row.assignee_name ?? t('admin.woUnassigned')}
                  {row.apartment_number ? ` · № ${row.apartment_number}` : ''}
                  {row.location_description ? ` · ${row.location_description}` : ''}
                </p>
                {row.scheduled_for ? (
                  <p className="mt-1 text-xs text-muted">{formatOwnerDateTime(row.scheduled_for, locale)}</p>
                ) : null}
                {row.status === 'open' || row.status === 'in_progress' ? (
                  <div className="mt-3 grid gap-2">
                    <select
                      className={adminFieldClass}
                      value={row.assigned_staff_id ?? ''}
                      disabled={busyId === row.id}
                      onChange={(e) =>
                        void handleAssign(row.id, e.target.value ? Number(e.target.value) : '')
                      }
                    >
                      <option value="">{t('admin.woUnassigned')}</option>
                      {assignableStaff.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="text-sm text-danger hover:underline"
                      disabled={busyId === row.id}
                      onClick={() => void handleCancel(row.id)}
                    >
                      {t('admin.woCancel')}
                    </button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
          <AdminTableShell className="hidden md:block">
            <table className="w-full min-w-[880px] text-sm">
              <thead>
                <tr className={adminTableHeadRowClass}>
                  <th className={adminTableCellClass}>{t('admin.woTitle')}</th>
                  <th className={adminTableCellClass}>{t('admin.status')}</th>
                  <th className={adminTableCellClass}>{t('admin.woAssignee')}</th>
                  <th className={adminTableCellClass}>{t('admin.woPriority')}</th>
                  <th className={adminTableCellClass}>{t('admin.woSchedule')}</th>
                  <th className={adminTableCellClass}>{t('admin.woLocation')}</th>
                  <th className={adminTableCellClass}>{t('admin.woSource')}</th>
                  <th className={adminTableCellClass} />
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => (
                  <tr key={row.id} className={adminTableRowClass}>
                    <td className={adminTableCellClass}>
                      <div className="max-w-xs truncate font-medium text-foreground">{row.title}</div>
                      {row.instructions ? (
                        <div className="max-w-xs truncate text-xs text-secondary">{row.instructions}</div>
                      ) : null}
                      {row.request_id != null ? (
                        <div className="max-w-xs truncate text-xs text-muted">
                          {t('admin.woRequester')}: {row.requester_name || '—'}
                          {row.requester_phone ? ` · ${row.requester_phone}` : ''}
                        </div>
                      ) : null}
                    </td>
                    <td className={adminTableCellClass}>
                      <StatusBadge label={statusLabel(row.status)} tone={statusTone(row.status)} />
                    </td>
                    <td className={adminTableCellClass}>
                      {row.status === 'open' || row.status === 'in_progress' ? (
                        <select
                          className={adminFieldClass}
                          value={row.assigned_staff_id ?? ''}
                          disabled={busyId === row.id}
                          onChange={(e) =>
                            void handleAssign(row.id, e.target.value ? Number(e.target.value) : '')
                          }
                        >
                          <option value="">{t('admin.woUnassigned')}</option>
                          {assignableStaff.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        row.assignee_name ?? t('admin.woUnassigned')
                      )}
                    </td>
                    <td className={adminTableCellClass}>{priorityLabel(row.priority)}</td>
                    <td className={`${adminTableCellClass} whitespace-nowrap text-xs text-muted`}>
                      {row.scheduled_for ? formatOwnerDateTime(row.scheduled_for, locale) : '—'}
                    </td>
                    <td className={adminTableCellClass}>
                      {row.apartment_number ? `№ ${row.apartment_number}` : '—'}
                      {row.location_description ? (
                        <div className="text-xs text-secondary">{row.location_description}</div>
                      ) : null}
                    </td>
                    <td className={adminTableCellClass}>
                      {sourceLabel(row.source_type)}
                      {row.request_id != null ? ` #${row.request_id}` : ''}
                      {row.request_subject ? (
                        <div className="text-xs text-secondary">{row.request_subject}</div>
                      ) : null}
                    </td>
                    <td className={adminTableCellClass}>
                      {row.status === 'open' || row.status === 'in_progress' ? (
                        <button
                          type="button"
                          className={adminBtnTertiaryClass}
                          disabled={busyId === row.id}
                          onClick={() => void handleCancel(row.id)}
                        >
                          {t('admin.woCancel')}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </AdminTableShell>
        </>
      )}
    </div>
  );
}
