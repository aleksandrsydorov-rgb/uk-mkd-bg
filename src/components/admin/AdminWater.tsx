'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { useI18n } from '@/i18n/I18nProvider';
import { isMissingRelation } from '@/lib/polls';
import {
  balanceTone,
  canAssignWaterMeter,
  canManageWaterFinance,
  canManageWaterTariff,
  canSeeWaterAdmin,
  currentWaterTariff,
  emptyBalance,
  formatEur,
  formatM3,
  lastActiveReading,
  mapAdminRpcError,
  todayIsoDate,
  type UtilityBalance,
  type WaterLedger,
  type WaterMeter,
  type WaterReading,
  type WaterTariff,
} from '@/lib/utilities';

type PropertyOption = {
  id: number;
  apartment_number: string | number | null;
  owner_name: string | null;
};

function aptNumber(value: string | number | null | undefined) {
  return String(value ?? '');
}

const fieldClass =
  'w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-placeholder';
const cardClass = 'rounded-[14px] border border-border bg-surface p-5 shadow-card';

function firstRow<T>(data: T[] | T | null | undefined): T | null {
  if (!data) return null;
  return Array.isArray(data) ? (data[0] ?? null) : data;
}

function ledgerKindLabel(kind: string, t: (path: string) => string) {
  if (kind === 'charge') return t('admin.kindCharge');
  if (kind === 'payment') return t('admin.kindPayment');
  if (kind === 'adjustment_debit') return t('admin.kindAdjDebit');
  if (kind === 'adjustment_credit') return t('admin.kindAdjCredit');
  return kind;
}

export function AdminWater({
  supabase,
  properties,
  staffRole,
}: {
  supabase: SupabaseClient<Database>;
  properties: PropertyOption[];
  staffRole: string;
}) {
  const { t, dateLocale } = useI18n();
  const canSee = canSeeWaterAdmin(staffRole);
  const canMeter = canAssignWaterMeter(staffRole);
  const canTariff = canManageWaterTariff(staffRole);
  const canFinance = canManageWaterFinance(staffRole);

  const sorted = useMemo(
    () =>
      [...properties].sort((a, b) =>
        aptNumber(a.apartment_number).localeCompare(aptNumber(b.apartment_number), undefined, { numeric: true }),
      ),
    [properties],
  );

  const [propertyId, setPropertyId] = useState<number | ''>(sorted[0]?.id ?? '');
  const [meters, setMeters] = useState<WaterMeter[]>([]);
  const [tariffs, setTariffs] = useState<WaterTariff[]>([]);
  const [readings, setReadings] = useState<WaterReading[]>([]);
  const [ledger, setLedger] = useState<WaterLedger[]>([]);
  const [balance, setBalance] = useState<UtilityBalance>(emptyBalance());
  const [meterLoading, setMeterLoading] = useState(false);
  const [tariffLoading, setTariffLoading] = useState(false);
  const [payBusy, setPayBusy] = useState(false);
  const [meterBusy, setMeterBusy] = useState(false);
  const [tariffBusy, setTariffBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [showAssign, setShowAssign] = useState(false);
  const [showReplace, setShowReplace] = useState(false);
  const [meterNumber, setMeterNumber] = useState('');
  const [initialReading, setInitialReading] = useState('0');
  const [installedAt, setInstalledAt] = useState(todayIsoDate());
  const [replaceNumber, setReplaceNumber] = useState('');
  const [replaceInitial, setReplaceInitial] = useState('0');
  const [replaceDate, setReplaceDate] = useState(todayIsoDate());
  const [replaceReason, setReplaceReason] = useState('');

  const [tariffPrice, setTariffPrice] = useState('');
  const [tariffFrom, setTariffFrom] = useState(todayIsoDate());
  const [tariffNote, setTariffNote] = useState('');

  const [payAmount, setPayAmount] = useState('');
  const [payNote, setPayNote] = useState('');

  const payKeyRef = useRef(crypto.randomUUID());

  useEffect(() => {
    if (propertyId === '' && sorted[0]) setPropertyId(sorted[0].id);
  }, [propertyId, sorted]);

  const activeMeter = meters.find((m) => !m.retired_at) ?? null;
  const meterById = useMemo(() => new Map(meters.map((m) => [m.id, m])), [meters]);
  const tariff = currentWaterTariff(tariffs);
  const lastReading = lastActiveReading(readings);

  const loadTariffs = useCallback(async () => {
    if (!canSee) return;
    setTariffLoading(true);
    const { data, error: qErr } = await supabase
      .from('water_tariffs')
      .select('*')
      .order('valid_from', { ascending: false })
      .limit(12);
    setTariffLoading(false);
    if (qErr) {
      if (!isMissingRelation(qErr, 'water_tariffs')) setError(t(mapAdminRpcError(qErr.message)));
      setTariffs([]);
      return;
    }
    setTariffs((data ?? []) as WaterTariff[]);
  }, [canSee, supabase, t]);

  const loadPropertyWater = useCallback(async () => {
    if (!canSee || propertyId === '') {
      setMeters([]);
      setReadings([]);
      setLedger([]);
      setBalance(emptyBalance());
      return;
    }
    setMeterLoading(true);
    setError(null);
    const pid = Number(propertyId);
    const meterQ = supabase
      .from('water_meters')
      .select('*')
      .eq('property_id', pid)
      .order('installed_at', { ascending: false });
    const readingQ = supabase
      .from('water_readings')
      .select('*')
      .eq('property_id', pid)
      .order('reading_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(30);

    if (canFinance) {
      const [metersRes, readingsRes, ledgerRes, balanceRes] = await Promise.all([
        meterQ,
        readingQ,
        supabase
          .from('water_ledger')
          .select('*')
          .eq('property_id', pid)
          .order('created_at', { ascending: false })
          .limit(30),
        supabase.rpc('get_water_balance', { p_property_id: pid }),
      ]);
      setMeterLoading(false);
      if (metersRes.error && !isMissingRelation(metersRes.error, 'water_meters')) setError(t(mapAdminRpcError(metersRes.error.message)));
      if (readingsRes.error && !isMissingRelation(readingsRes.error, 'water_readings')) setError(t(mapAdminRpcError(readingsRes.error.message)));
      setMeters((metersRes.data ?? []) as WaterMeter[]);
      setReadings((readingsRes.data ?? []) as WaterReading[]);
      if (!ledgerRes.error) setLedger((ledgerRes.data ?? []) as WaterLedger[]);
      else setLedger([]);
      const row = firstRow(balanceRes.data);
      setBalance(row ? {
        charged_eur: Number(row.charged_eur),
        paid_eur: Number(row.paid_eur),
        adjustments_debit_eur: Number(row.adjustments_debit_eur),
        adjustments_credit_eur: Number(row.adjustments_credit_eur),
        balance_eur: Number(row.balance_eur),
      } : emptyBalance());
      return;
    }

    const [metersRes, readingsRes] = await Promise.all([meterQ, readingQ]);
    setMeterLoading(false);
    if (metersRes.error && !isMissingRelation(metersRes.error, 'water_meters')) setError(t(mapAdminRpcError(metersRes.error.message)));
    if (readingsRes.error && !isMissingRelation(readingsRes.error, 'water_readings')) setError(t(mapAdminRpcError(readingsRes.error.message)));
    setMeters((metersRes.data ?? []) as WaterMeter[]);
    setReadings((readingsRes.data ?? []) as WaterReading[]);
    setLedger([]);
    setBalance(emptyBalance());
  }, [canFinance, canSee, propertyId, supabase, t]);

  useEffect(() => {
    void loadTariffs();
  }, [loadTariffs]);

  useEffect(() => {
    void loadPropertyWater();
  }, [loadPropertyWater]);

  function flash(message: string) {
    setSuccess(message);
    setError(null);
  }

  function rpcFail(message: string | undefined) {
    setSuccess(null);
    setError(t(mapAdminRpcError(message ?? '')));
  }

  async function handleAssign(e: React.FormEvent) {
    e.preventDefault();
    if (propertyId === '' || !canMeter) return;
    const number = meterNumber.trim();
    const initial = Number(initialReading);
    if (!number) {
      setError(t('admin.errMeterNumber'));
      return;
    }
    if (!(initial >= 0) || Number.isNaN(initial)) {
      setError(t('admin.errInitial'));
      return;
    }
    if (installedAt > todayIsoDate()) {
      setError(t('admin.errFutureDate'));
      return;
    }
    setMeterBusy(true);
    const { error: rpcErr } = await supabase.rpc('assign_water_meter', {
      p_property_id: Number(propertyId),
      p_meter_number: number,
      p_initial_reading: initial,
      p_installed_at: installedAt,
    });
    setMeterBusy(false);
    if (rpcErr) {
      rpcFail(rpcErr.message);
      return;
    }
    setShowAssign(false);
    setMeterNumber('');
    setInitialReading('0');
    setInstalledAt(todayIsoDate());
    flash(t('admin.okMeterAssigned'));
    await loadPropertyWater();
  }

  async function handleReplace(e: React.FormEvent) {
    e.preventDefault();
    if (propertyId === '' || !canMeter || !activeMeter) return;
    const number = replaceNumber.trim();
    const initial = Number(replaceInitial);
    const reason = replaceReason.trim();
    if (!number || !reason) {
      setError(t('admin.errReplaceFields'));
      return;
    }
    if (!(initial >= 0) || Number.isNaN(initial)) {
      setError(t('admin.errInitial'));
      return;
    }
    if (replaceDate > todayIsoDate()) {
      setError(t('admin.errFutureDate'));
      return;
    }
    setMeterBusy(true);
    const { error: rpcErr } = await supabase.rpc('replace_water_meter', {
      p_property_id: Number(propertyId),
      p_new_meter_number: number,
      p_new_initial_reading: initial,
      p_reason: reason,
      p_installed_at: replaceDate,
    });
    setMeterBusy(false);
    if (rpcErr) {
      rpcFail(rpcErr.message);
      return;
    }
    setShowReplace(false);
    setReplaceNumber('');
    setReplaceInitial('0');
    setReplaceReason('');
    setReplaceDate(todayIsoDate());
    flash(t('admin.okMeterReplaced'));
    await loadPropertyWater();
  }

  async function handleTariff(e: React.FormEvent) {
    e.preventDefault();
    if (!canTariff) return;
    const price = Number(tariffPrice);
    if (!(price > 0) || Number.isNaN(price)) {
      setError(t('admin.errTariffPrice'));
      return;
    }
    setTariffBusy(true);
    const { error: rpcErr } = await supabase.rpc('set_water_tariff', {
      p_price_eur_per_m3: price,
      p_valid_from: tariffFrom,
      p_note: tariffNote.trim() || null,
    });
    setTariffBusy(false);
    if (rpcErr) {
      rpcFail(rpcErr.message);
      return;
    }
    setTariffPrice('');
    setTariffNote('');
    flash(t('admin.okTariff'));
    await loadTariffs();
  }

  async function handlePay(e: React.FormEvent) {
    e.preventDefault();
    if (propertyId === '' || !canFinance) return;
    const amount = Number(payAmount);
    if (!(amount > 0) || Number.isNaN(amount)) {
      setError(t('admin.errAmount'));
      return;
    }
    setPayBusy(true);
    const { error: rpcErr } = await supabase.rpc('record_water_payment', {
      p_property_id: Number(propertyId),
      p_amount_eur: amount,
      p_note: payNote.trim() || null,
      p_idempotency_key: payKeyRef.current,
    });
    setPayBusy(false);
    if (rpcErr) {
      rpcFail(rpcErr.message);
      return;
    }
    payKeyRef.current = crypto.randomUUID();
    setPayAmount('');
    setPayNote('');
    flash(t('admin.okWaterPay'));
    await loadPropertyWater();
  }

  if (!canSee) {
    return (
      <div className={cardClass}>
        <p className="text-sm text-secondary">{t('admin.waterNoAccess')}</p>
      </div>
    );
  }

  const tone = balanceTone(balance.balance_eur);
  const statusLabel =
    tone === 'debt' ? t('admin.balDebt') : tone === 'over' ? t('admin.balOver') : t('admin.balSettled');

  return (
    <div className="space-y-4">
      <div className={cardClass}>
        <h2 className="text-lg font-semibold text-accent">{t('admin.water')}</h2>
        <p className="mt-1 text-sm text-secondary">{t('admin.waterLead')}</p>
        <label className="mt-4 block text-xs text-muted">{t('admin.pickProperty')}</label>
        <select
          className={`${fieldClass} mt-1 max-w-xl`}
          value={propertyId === '' ? '' : String(propertyId)}
          onChange={(e) => {
            setPropertyId(e.target.value ? Number(e.target.value) : '');
            setSuccess(null);
            setError(null);
          }}
        >
          {sorted.length === 0 && <option value="">{t('form.pickApt')}</option>}
          {sorted.map((p) => (
            <option key={p.id} value={p.id}>
              {t('form.aptOwner', { n: aptNumber(p.apartment_number), owner: p.owner_name ?? '—' })}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <div className="rounded-xl border border-danger/25 bg-danger-bg px-4 py-3 text-sm text-danger">{error}</div>
      )}
      {success && (
        <div className="rounded-xl border border-success/25 bg-success-bg px-4 py-3 text-sm text-success">{success}</div>
      )}

      <div className={cardClass}>
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">{t('admin.waterStatus')}</p>
        {meterLoading ? (
          <p className="mt-3 text-sm text-muted">{t('common.loading')}</p>
        ) : !activeMeter ? (
          <p className="mt-3 text-sm text-secondary">{t('admin.noWaterMeter')}</p>
        ) : (
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <div className="text-[11px] text-muted">{t('admin.meterNumber')}</div>
              <div className="mt-0.5 font-semibold tabular-nums">{activeMeter.meter_number}</div>
            </div>
            <div>
              <div className="text-[11px] text-muted">{t('admin.installedAt')}</div>
              <div className="mt-0.5 tabular-nums">{activeMeter.installed_at}</div>
            </div>
            <div>
              <div className="text-[11px] text-muted">{t('admin.initialReading')}</div>
              <div className="mt-0.5 tabular-nums">{formatM3(Number(activeMeter.initial_reading))}</div>
            </div>
            <div>
              <div className="text-[11px] text-muted">{t('admin.lastReading')}</div>
              <div className="mt-0.5 tabular-nums">
                {lastReading ? formatM3(Number(lastReading.current_value)) : '—'}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-muted">{t('admin.lastReadingDate')}</div>
              <div className="mt-0.5 tabular-nums">{lastReading?.reading_date ?? '—'}</div>
            </div>
            <div>
              <div className="text-[11px] text-muted">{t('admin.currentTariff')}</div>
              <div className="mt-0.5 tabular-nums">
                {tariff ? `${formatEur(Number(tariff.price_eur_per_m3))} / m³` : t('admin.noTariff')}
              </div>
            </div>
          </div>
        )}

        {canMeter && (
          <div className="mt-4 flex flex-wrap gap-2">
            {!activeMeter && (
              <button
                type="button"
                onClick={() => { setShowAssign((v) => !v); setShowReplace(false); }}
                className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover"
              >
                {t('admin.assignMeter')}
              </button>
            )}
            {activeMeter && (
              <button
                type="button"
                onClick={() => { setShowReplace((v) => !v); setShowAssign(false); }}
                className="rounded-xl border border-border px-4 py-2 text-sm text-secondary hover:bg-hover"
              >
                {t('admin.replaceMeter')}
              </button>
            )}
          </div>
        )}

        {canMeter && showAssign && (
          <form onSubmit={handleAssign} className="mt-4 grid gap-3 sm:grid-cols-3">
            <input className={fieldClass} placeholder={t('admin.meterNumber')} value={meterNumber} onChange={(e) => setMeterNumber(e.target.value)} required />
            <input className={fieldClass} type="number" min="0" step="0.001" placeholder={t('admin.initialReading')} value={initialReading} onChange={(e) => setInitialReading(e.target.value)} required />
            <input className={fieldClass} type="date" max={todayIsoDate()} value={installedAt} onChange={(e) => setInstalledAt(e.target.value)} required />
            <div className="flex gap-2 sm:col-span-3">
              <button type="submit" disabled={meterBusy} className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50">
                {meterBusy ? t('common.saving') : t('common.save')}
              </button>
              <button type="button" onClick={() => setShowAssign(false)} className="rounded-lg border border-border px-4 py-2 text-sm text-secondary hover:bg-hover">
                {t('common.cancel')}
              </button>
            </div>
          </form>
        )}

        {canMeter && showReplace && activeMeter && (
          <form onSubmit={handleReplace} className="mt-4 grid gap-3 sm:grid-cols-2">
            <input className={fieldClass} placeholder={t('admin.newMeterNumber')} value={replaceNumber} onChange={(e) => setReplaceNumber(e.target.value)} required />
            <input className={fieldClass} type="number" min="0" step="0.001" placeholder={t('admin.initialReading')} value={replaceInitial} onChange={(e) => setReplaceInitial(e.target.value)} required />
            <input className={fieldClass} type="date" max={todayIsoDate()} value={replaceDate} onChange={(e) => setReplaceDate(e.target.value)} required />
            <input className={fieldClass} placeholder={t('admin.replaceReason')} value={replaceReason} onChange={(e) => setReplaceReason(e.target.value)} required />
            <div className="flex gap-2 sm:col-span-2">
              <button type="submit" disabled={meterBusy} className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50">
                {meterBusy ? t('common.saving') : t('common.save')}
              </button>
              <button type="button" onClick={() => setShowReplace(false)} className="rounded-lg border border-border px-4 py-2 text-sm text-secondary hover:bg-hover">
                {t('common.cancel')}
              </button>
            </div>
          </form>
        )}
      </div>

      {canTariff && (
        <div className={cardClass}>
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">{t('admin.tariffTitle')}</p>
          {tariffLoading ? (
            <p className="mt-3 text-sm text-muted">{t('common.loading')}</p>
          ) : (
            <p className="mt-2 text-2xl font-semibold text-foreground">
              {tariff ? `${formatEur(Number(tariff.price_eur_per_m3))} / m³` : t('admin.noTariff')}
            </p>
          )}
          {tariff && (
            <p className="mt-1 text-sm text-muted">
              {t('admin.validFrom')}: {tariff.valid_from}
            </p>
          )}
          <form onSubmit={handleTariff} className="mt-4 grid gap-3 sm:grid-cols-3">
            <input className={fieldClass} type="number" min="0.01" step="0.01" placeholder={t('admin.tariffPrice')} value={tariffPrice} onChange={(e) => setTariffPrice(e.target.value)} required />
            <input className={fieldClass} type="date" value={tariffFrom} onChange={(e) => setTariffFrom(e.target.value)} required />
            <input className={fieldClass} placeholder={t('admin.noteOptional')} value={tariffNote} onChange={(e) => setTariffNote(e.target.value)} />
            <button type="submit" disabled={tariffBusy} className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50 sm:col-span-3 sm:w-fit">
              {tariffBusy ? t('common.saving') : t('admin.setTariff')}
            </button>
          </form>
          <p className="mt-2 text-xs text-muted">{t('admin.tariffImmutable')}</p>
          {tariffs.length === 0 ? (
            <p className="mt-3 text-sm text-secondary">{t('admin.noTariffHistory')}</p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[28rem] text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted">
                    <th className="py-2 pr-3">{t('admin.validFrom')}</th>
                    <th className="py-2 pr-3">{t('admin.tariffPrice')}</th>
                    <th className="py-2 pr-3">{t('admin.note')}</th>
                  </tr>
                </thead>
                <tbody>
                  {tariffs.map((row) => (
                    <tr key={row.id} className="border-t border-border">
                      <td className="py-2 pr-3 tabular-nums">{row.valid_from}</td>
                      <td className="py-2 pr-3 tabular-nums">{formatEur(Number(row.price_eur_per_m3))}</td>
                      <td className="py-2 pr-3 text-secondary">{row.note ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {canFinance && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className={cardClass}>
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">{t('admin.waterBalance')}</p>
            {meterLoading ? (
              <p className="mt-3 text-sm text-muted">{t('common.loading')}</p>
            ) : (
              <>
                <p className={`mt-2 text-2xl font-semibold ${tone === 'debt' ? 'text-danger' : tone === 'over' ? 'text-success' : 'text-foreground'}`}>
                  {formatEur(Math.abs(balance.balance_eur))}
                </p>
                <p className="text-sm text-secondary">{statusLabel}</p>
                <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  <dt className="text-muted">{t('admin.charged')}</dt>
                  <dd className="tabular-nums">{formatEur(balance.charged_eur)}</dd>
                  <dt className="text-muted">{t('admin.paid')}</dt>
                  <dd className="tabular-nums">{formatEur(balance.paid_eur)}</dd>
                  <dt className="text-muted">{t('admin.adjDebit')}</dt>
                  <dd className="tabular-nums">{formatEur(balance.adjustments_debit_eur)}</dd>
                  <dt className="text-muted">{t('admin.adjCredit')}</dt>
                  <dd className="tabular-nums">{formatEur(balance.adjustments_credit_eur)}</dd>
                </dl>
              </>
            )}
          </div>
          <div className={cardClass}>
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">{t('admin.waterPayment')}</p>
            <form onSubmit={handlePay} className="mt-4 space-y-3">
              <input className={fieldClass} type="number" min="0.01" step="0.01" placeholder={t('admin.amountEur')} value={payAmount} onChange={(e) => setPayAmount(e.target.value)} required />
              <input className={fieldClass} placeholder={t('admin.noteOptional')} value={payNote} onChange={(e) => setPayNote(e.target.value)} />
              <button type="submit" disabled={payBusy} className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50">
                {payBusy ? t('common.saving') : t('admin.recordPayment')}
              </button>
            </form>
          </div>
        </div>
      )}

      <div className={cardClass}>
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">{t('admin.readingHistory')}</p>
        {readings.length === 0 ? (
          <p className="mt-3 text-sm text-secondary">{t('admin.noReadings')}</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="py-2 pr-3">{t('admin.date')}</th>
                  <th className="py-2 pr-3">{t('admin.meterNumber')}</th>
                  <th className="py-2 pr-3">{t('admin.prev')}</th>
                  <th className="py-2 pr-3">{t('admin.current')}</th>
                  <th className="py-2 pr-3">{t('admin.consumption')}</th>
                  <th className="py-2 pr-3">{t('admin.tariff')}</th>
                  <th className="py-2 pr-3">{t('admin.charge')}</th>
                  <th className="py-2 pr-3">{t('admin.status')}</th>
                  <th className="py-2 pr-3">{t('admin.via')}</th>
                </tr>
              </thead>
              <tbody>
                {readings.map((row) => {
                  const reversed = row.status === 'reversed';
                  return (
                    <tr key={row.id} className={`border-t border-border ${reversed ? 'text-muted line-through' : ''}`}>
                      <td className="py-2 pr-3 tabular-nums">{row.reading_date}</td>
                      <td className="py-2 pr-3">{meterById.get(row.meter_id)?.meter_number ?? '—'}</td>
                      <td className="py-2 pr-3 tabular-nums">{formatM3(Number(row.previous_value))}</td>
                      <td className="py-2 pr-3 tabular-nums">{formatM3(Number(row.current_value))}</td>
                      <td className="py-2 pr-3 tabular-nums">{formatM3(Number(row.consumption_m3))}</td>
                      <td className="py-2 pr-3 tabular-nums">{formatEur(Number(row.tariff_eur_per_m3))}</td>
                      <td className="py-2 pr-3 tabular-nums">{formatEur(Number(row.charge_amount_eur))}</td>
                      <td className="py-2 pr-3">{row.status}</td>
                      <td className="py-2 pr-3">{row.submitted_via}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {canFinance && (
        <div className={cardClass}>
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">{t('admin.waterLedger')}</p>
          {ledger.length === 0 ? (
            <p className="mt-3 text-sm text-secondary">{t('admin.noWaterLedger')}</p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[28rem] text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted">
                    <th className="py-2 pr-3">{t('admin.date')}</th>
                    <th className="py-2 pr-3">{t('admin.kind')}</th>
                    <th className="py-2 pr-3">{t('admin.amount')}</th>
                    <th className="py-2 pr-3">{t('admin.note')}</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.map((row) => (
                    <tr key={row.id} className="border-t border-border">
                      <td className="py-2 pr-3 tabular-nums">{new Date(row.created_at).toLocaleDateString(dateLocale)}</td>
                      <td className="py-2 pr-3">{ledgerKindLabel(row.kind, t)}</td>
                      <td className="py-2 pr-3 tabular-nums">{formatEur(Number(row.amount_eur))}</td>
                      <td className="py-2 pr-3 text-secondary">{row.note ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
