'use client';

import { useCallback, useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { useI18n } from '@/i18n/I18nProvider';
import { formatOwnerDate, formatOwnerDateTime } from '@/lib/ownerFormat';
import { ownerVisibleError } from '@/lib/ownerError';
import { isMissingRelation } from '@/lib/polls';
import {
  CLEANING_SERVICE_KINDS,
  CLEANING_TIME_SLOTS,
  cleaningStatusTone,
  type CleaningOrder,
  type CleaningServiceKind,
  type CleaningTimeSlot,
} from '@/lib/cleaning';
import { StatusBadge } from '@/components/account/ownerUi';

export function OwnerCleaning({
  supabase,
  propertyId,
  serviceLocked = false,
}: {
  supabase: SupabaseClient<Database>;
  propertyId: number;
  serviceLocked?: boolean;
}) {
  const { t, locale } = useI18n();
  const [rows, setRows] = useState<CleaningOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const [serviceKind, setServiceKind] = useState<CleaningServiceKind>('standard');
  const [preferredDate, setPreferredDate] = useState('');
  const [timeSlot, setTimeSlot] = useState<CleaningTimeSlot>('any');
  const [note, setNote] = useState('');

  const fieldClass =
    'w-full min-h-10 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent/30';

  const kindLabel = useCallback(
    (k: string) => {
      const key = `account.cleanKind_${k}` as const;
      const v = t(key);
      return v === key ? k : v;
    },
    [t],
  );

  const slotLabel = useCallback(
    (s: string) => {
      const key = `account.cleanSlot_${s}` as const;
      const v = t(key);
      return v === key ? s : v;
    },
    [t],
  );

  const statusLabel = useCallback(
    (s: string) => {
      const key = `account.cleanStatus_${s}` as const;
      const v = t(key);
      return v === key ? s : v;
    },
    [t],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcErr } = await supabase.rpc('owner_list_my_cleaning_orders', {
        p_property_id: propertyId,
      });
      if (rpcErr && !isMissingRelation(rpcErr, 'owner_list_my_cleaning_orders')) {
        throw rpcErr;
      }
      setRows(
        ((data as CleaningOrder[] | null) ?? []).map((r) => ({
          ...r,
          id: String(r.id),
          work_order_id: r.work_order_id != null ? String(r.work_order_id) : null,
        })),
      );
    } catch (e: unknown) {
      setError(ownerVisibleError(e, t('err.loadApt')));
    } finally {
      setLoading(false);
    }
  }, [propertyId, supabase, t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (serviceLocked) {
      setError(t('account.serviceLockBanner'));
      return;
    }
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const { error: rpcErr } = await supabase.rpc('owner_create_cleaning_order', {
        p_property_id: propertyId,
        p_service_kind: serviceKind,
        p_preferred_date: preferredDate || null,
        p_time_slot: timeSlot,
        p_note: note.trim() || null,
      });
      if (rpcErr) throw rpcErr;
      setOk(t('account.cleanCreated'));
      setNote('');
      setPreferredDate('');
      await load();
    } catch (err: unknown) {
      setError(ownerVisibleError(err, t('err.loadApt')));
    } finally {
      setBusy(false);
    }
  }

  async function handleCancel(id: string) {
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const { error: rpcErr } = await supabase.rpc('owner_cancel_cleaning_order', {
        p_order_id: id,
      });
      if (rpcErr) throw rpcErr;
      setOk(t('account.cleanCancelled'));
      await load();
    } catch (err: unknown) {
      setError(ownerVisibleError(err, t('err.loadApt')));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-foreground">{t('account.cleaning')}</h2>
        <p className="mt-1 text-sm text-secondary">{t('account.cleaningLead')}</p>
      </div>

      {serviceLocked ? (
        <p className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-foreground">
          {t('account.serviceLockBanner')}
        </p>
      ) : null}
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {ok ? <p className="text-sm text-success">{ok}</p> : null}

      <form onSubmit={(e) => void handleCreate(e)} className="space-y-3 rounded-xl border border-border bg-surface p-4">
        <h3 className="text-sm font-semibold text-foreground">{t('account.cleanNewOrder')}</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-xs text-secondary">
            {t('account.cleanServiceKind')}
            <select
              className={fieldClass}
              value={serviceKind}
              onChange={(e) => setServiceKind(e.target.value as CleaningServiceKind)}
              disabled={serviceLocked || busy}
            >
              {CLEANING_SERVICE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {kindLabel(k)}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs text-secondary">
            {t('account.cleanPreferredDate')}
            <input
              className={fieldClass}
              type="date"
              value={preferredDate}
              onChange={(e) => setPreferredDate(e.target.value)}
              disabled={serviceLocked || busy}
            />
          </label>
          <label className="grid gap-1 text-xs text-secondary">
            {t('account.cleanTimeSlot')}
            <select
              className={fieldClass}
              value={timeSlot}
              onChange={(e) => setTimeSlot(e.target.value as CleaningTimeSlot)}
              disabled={serviceLocked || busy}
            >
              {CLEANING_TIME_SLOTS.map((s) => (
                <option key={s} value={s}>
                  {slotLabel(s)}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs text-secondary sm:col-span-2">
            {t('account.cleanNote')}
            <input
              className={fieldClass}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={serviceLocked || busy}
            />
          </label>
        </div>
        <button
          type="submit"
          disabled={busy || serviceLocked}
          className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
        >
          {t('account.cleanCreate')}
        </button>
      </form>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-foreground">{t('account.cleanOrders')}</h3>
        {loading ? (
          <p className="text-sm text-muted">{t('common.loading')}</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted">{t('account.cleanEmpty')}</p>
        ) : (
          <ul className="space-y-2">
            {rows.map((row) => (
              <li
                key={row.id}
                className="rounded-xl border border-border bg-surface px-3 py-3 text-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="font-medium text-foreground">
                      {kindLabel(row.service_kind)} · {slotLabel(row.time_slot)}
                    </div>
                    <div className="text-xs text-muted">
                      {row.preferred_date
                        ? formatOwnerDate(row.preferred_date, locale)
                        : t('account.cleanNoDate')}
                      {' · '}
                      {formatOwnerDateTime(row.created_at, locale)}
                    </div>
                    {row.note ? <p className="mt-1 text-secondary">{row.note}</p> : null}
                  </div>
                  <StatusBadge
                    label={statusLabel(row.status)}
                    tone={cleaningStatusTone(row.status)}
                  />
                </div>
                {row.status === 'pending' ? (
                  <button
                    type="button"
                    className="mt-2 text-xs text-danger hover:underline"
                    disabled={busy}
                    onClick={() => void handleCancel(row.id)}
                  >
                    {t('account.cleanCancel')}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
