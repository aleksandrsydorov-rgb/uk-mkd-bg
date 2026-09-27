'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { useI18n } from '@/i18n/I18nProvider';
import { ownerVisibleError } from '@/lib/ownerError';
import { isMissingRelation } from '@/lib/polls';
import { formatOwnerDate, formatOwnerDateTime } from '@/lib/ownerFormat';
import {
  CLEANING_SERVICE_KINDS,
  CLEANING_TIME_SLOTS,
  canSeeCleaningAdmin,
  cleaningStatusTone,
  type CleaningOrderAdminRow,
  type CleaningServiceKind,
  type CleaningTimeSlot,
} from '@/lib/cleaning';
import {
  AdminPageHeader,
  AdminEmptyState,
  AdminInlineAlert,
  AdminPrimaryButton,
  AdminSecondaryButton,
  AdminTableShell,
  adminCardClass,
  adminFieldClass,
  adminTableCellClass,
  adminTableHeadRowClass,
  adminTableRowClass,
} from '@/components/admin/AdminUi';
import { StatusBadge } from '@/components/account/ownerUi';

type PropertyOption = {
  id: number;
  apartment_number: string | number | null;
};

export function AdminCleaning({
  supabase,
  properties,
  staffRole,
}: {
  supabase: SupabaseClient<Database>;
  properties: PropertyOption[];
  staffRole: string;
}) {
  const { t, locale } = useI18n();
  const canSee = canSeeCleaningAdmin(staffRole);

  const sorted = useMemo(
    () =>
      [...properties].sort(
        (a, b) => Number(a.apartment_number) - Number(b.apartment_number),
      ),
    [properties],
  );

  const [rows, setRows] = useState<CleaningOrderAdminRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [propertyId, setPropertyId] = useState<number | ''>('');
  const [serviceKind, setServiceKind] = useState<CleaningServiceKind>('standard');
  const [preferredDate, setPreferredDate] = useState('');
  const [timeSlot, setTimeSlot] = useState<CleaningTimeSlot>('any');
  const [note, setNote] = useState('');

  const kindLabel = useCallback(
    (k: string) => {
      const key = `admin.cleanKind_${k}` as const;
      const v = t(key);
      return v === key ? k : v;
    },
    [t],
  );

  const slotLabel = useCallback(
    (s: string) => {
      const key = `admin.cleanSlot_${s}` as const;
      const v = t(key);
      return v === key ? s : v;
    },
    [t],
  );

  const statusLabel = useCallback(
    (s: string) => {
      const key = `admin.cleanStatus_${s}` as const;
      const v = t(key);
      return v === key ? s : v;
    },
    [t],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcErr } = await supabase.rpc('admin_list_cleaning_orders', {
        p_limit: 100,
      });
      if (rpcErr) {
        if (isMissingRelation(rpcErr, 'admin_list_cleaning_orders')) {
          setRows([]);
          setError(t('admin.cleanMigrationNeeded'));
          return;
        }
        throw rpcErr;
      }
      setRows(
        ((data as CleaningOrderAdminRow[] | null) ?? []).map((r) => ({
          ...r,
          id: String(r.id),
          work_order_id: r.work_order_id != null ? String(r.work_order_id) : null,
        })),
      );
    } catch (e: unknown) {
      setError(ownerVisibleError(e, t('admin.errGeneric')));
    } finally {
      setLoading(false);
    }
  }, [supabase, t]);

  useEffect(() => {
    if (canSee) void load();
  }, [canSee, load]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!propertyId) {
      setError(t('admin.pickProperty'));
      return;
    }
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const { error: rpcErr } = await supabase.rpc('admin_create_cleaning_order', {
        p_property_id: propertyId,
        p_service_kind: serviceKind,
        p_preferred_date: preferredDate || null,
        p_time_slot: timeSlot,
        p_note: note.trim() || null,
      });
      if (rpcErr) throw rpcErr;
      setSuccess(t('admin.cleanCreated'));
      setNote('');
      setPreferredDate('');
      await load();
    } catch (err: unknown) {
      setError(ownerVisibleError(err, t('admin.errGeneric')));
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(
    id: string,
    status: 'confirmed' | 'done' | 'cancelled',
    createWo = false,
  ) {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const { error: rpcErr } = await supabase.rpc('admin_set_cleaning_order_status', {
        p_order_id: id,
        p_status: status,
        p_admin_note: null,
        p_create_work_order: createWo,
      });
      if (rpcErr) throw rpcErr;
      setSuccess(t('admin.cleanStatusUpdated'));
      await load();
    } catch (err: unknown) {
      setError(ownerVisibleError(err, t('admin.errGeneric')));
    } finally {
      setBusy(false);
    }
  }

  if (!canSee) {
    return (
      <div className="space-y-4">
        <AdminPageHeader title={t('admin.cleaning')} secondary={t('admin.cleaningLead')} />
        <AdminInlineAlert tone="warning">{t('admin.errNoAccess')}</AdminInlineAlert>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <AdminPageHeader title={t('admin.cleaning')} secondary={t('admin.cleaningLead')} />
      {error ? <AdminInlineAlert tone="danger">{error}</AdminInlineAlert> : null}
      {success ? <AdminInlineAlert tone="success">{success}</AdminInlineAlert> : null}

      <form onSubmit={(e) => void handleCreate(e)} className={`${adminCardClass} space-y-3 p-4`}>
        <h3 className="text-sm font-semibold text-foreground">{t('admin.cleanNewOrder')}</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="grid gap-1 text-xs text-secondary">
            {t('admin.pickProperty')}
            <select
              className={adminFieldClass}
              value={propertyId === '' ? '' : String(propertyId)}
              onChange={(e) =>
                setPropertyId(e.target.value ? Number(e.target.value) : '')
              }
              required
            >
              <option value="">{t('admin.pickProperty')}</option>
              {sorted.map((p) => (
                <option key={p.id} value={p.id}>
                  № {p.apartment_number}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs text-secondary">
            {t('admin.cleanServiceKind')}
            <select
              className={adminFieldClass}
              value={serviceKind}
              onChange={(e) => setServiceKind(e.target.value as CleaningServiceKind)}
            >
              {CLEANING_SERVICE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {kindLabel(k)}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs text-secondary">
            {t('admin.cleanPreferredDate')}
            <input
              className={adminFieldClass}
              type="date"
              value={preferredDate}
              onChange={(e) => setPreferredDate(e.target.value)}
            />
          </label>
          <label className="grid gap-1 text-xs text-secondary">
            {t('admin.cleanTimeSlot')}
            <select
              className={adminFieldClass}
              value={timeSlot}
              onChange={(e) => setTimeSlot(e.target.value as CleaningTimeSlot)}
            >
              {CLEANING_TIME_SLOTS.map((s) => (
                <option key={s} value={s}>
                  {slotLabel(s)}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs text-secondary sm:col-span-2">
            {t('admin.cleanNote')}
            <input
              className={adminFieldClass}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
        </div>
        <AdminPrimaryButton type="submit" disabled={busy}>
          {t('admin.cleanCreate')}
        </AdminPrimaryButton>
      </form>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-semibold text-foreground">{t('admin.cleanOrders')}</h3>
          <AdminSecondaryButton type="button" disabled={busy || loading} onClick={() => void load()}>
            {t('admin.secRefresh')}
          </AdminSecondaryButton>
        </div>
        {loading ? (
          <p className="text-sm text-muted">{t('common.loading')}</p>
        ) : rows.length === 0 ? (
          <AdminEmptyState title={t('admin.cleanEmpty')} />
        ) : (
          <AdminTableShell>
            <table className="w-full min-w-[48rem] text-sm">
              <thead>
                <tr className={adminTableHeadRowClass}>
                  <th className={adminTableCellClass}>{t('admin.apartments')}</th>
                  <th className={adminTableCellClass}>{t('admin.cleanServiceKind')}</th>
                  <th className={adminTableCellClass}>{t('admin.cleanPreferredDate')}</th>
                  <th className={adminTableCellClass}>{t('admin.status')}</th>
                  <th className={adminTableCellClass} />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className={adminTableRowClass}>
                    <td className={adminTableCellClass}>
                      № {row.apartment_number}
                      <div className="text-xs text-muted">
                        {formatOwnerDateTime(row.created_at, locale)}
                      </div>
                    </td>
                    <td className={adminTableCellClass}>
                      {kindLabel(row.service_kind)}
                      <div className="text-xs text-muted">{slotLabel(row.time_slot)}</div>
                    </td>
                    <td className={adminTableCellClass}>
                      {row.preferred_date
                        ? formatOwnerDate(row.preferred_date, locale)
                        : '—'}
                      {row.note ? (
                        <div className="text-xs text-muted">{row.note}</div>
                      ) : null}
                    </td>
                    <td className={adminTableCellClass}>
                      <StatusBadge
                        label={statusLabel(row.status)}
                        tone={cleaningStatusTone(row.status)}
                      />
                    </td>
                    <td className={adminTableCellClass}>
                      <div className="flex flex-wrap gap-2">
                        {row.status === 'pending' ? (
                          <>
                            <button
                              type="button"
                              className="text-xs text-accent hover:underline"
                              disabled={busy}
                              onClick={() => void setStatus(row.id, 'confirmed', true)}
                            >
                              {t('admin.cleanConfirmWo')}
                            </button>
                            <button
                              type="button"
                              className="text-xs text-accent hover:underline"
                              disabled={busy}
                              onClick={() => void setStatus(row.id, 'confirmed', false)}
                            >
                              {t('admin.cleanConfirm')}
                            </button>
                            <button
                              type="button"
                              className="text-xs text-danger hover:underline"
                              disabled={busy}
                              onClick={() => void setStatus(row.id, 'cancelled')}
                            >
                              {t('admin.cleanCancel')}
                            </button>
                          </>
                        ) : null}
                        {row.status === 'confirmed' ? (
                          <>
                            <button
                              type="button"
                              className="text-xs text-accent hover:underline"
                              disabled={busy}
                              onClick={() => void setStatus(row.id, 'done')}
                            >
                              {t('admin.cleanDone')}
                            </button>
                            <button
                              type="button"
                              className="text-xs text-danger hover:underline"
                              disabled={busy}
                              onClick={() => void setStatus(row.id, 'cancelled')}
                            >
                              {t('admin.cleanCancel')}
                            </button>
                          </>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </AdminTableShell>
        )}
      </section>
    </div>
  );
}
