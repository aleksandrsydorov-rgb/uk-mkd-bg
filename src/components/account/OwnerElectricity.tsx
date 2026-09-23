'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { useI18n } from '@/i18n/I18nProvider';
import { isMissingRelation } from '@/lib/polls';
import { MeterFinanceStatus, meterKpiCardClass, meterKpiGridClass } from '@/components/account/MeterFinanceStatus';
import { emptyBalance, formatKwh, todayIsoDate, type UtilityBalance } from '@/lib/utilities';
import type { FinanceTab } from '@/components/account/OwnerUtilities';
import {
  activeElectricityMeter,
  electricityActiveMeterReadings,
  mapSubmitElectricityError,
  pairElectricityReadings,
  displayElectricityMeterNumber,
  type ElectricityMeter,
  type ElectricityMode,
  type ElectricitySubmitResult,
  type MeterReadingRow,
} from '@/lib/electricity';

export function OwnerElectricity({
  supabase,
  propertyId,
  mode,
  rows,
  meters,
  onSubmitted,
  onOpenFinance,
}: {
  supabase: SupabaseClient<Database>;
  propertyId: number;
  mode: ElectricityMode;
  rows: MeterReadingRow[];
  meters: ElectricityMeter[];
  onSubmitted: () => Promise<void> | void;
  onOpenFinance?: (tab: FinanceTab) => void;
}) {
  const { t, dateLocale, locale } = useI18n();
  const pairs = useMemo(() => pairElectricityReadings(rows, meters), [rows, meters]);
  const meter = useMemo(() => activeElectricityMeter(meters), [meters]);
  const shown = useMemo(() => electricityActiveMeterReadings(pairs, meter), [pairs, meter]);
  const prevDay = shown.previousDay;
  const prevNight = shown.previousNight;
  const submitFloorDay = shown.submitFloorDay;
  const submitFloorNight = shown.submitFloorNight;
  const [dayValue, setDayValue] = useState('');
  const [nightValue, setNightValue] = useState('');
  const [readingDate, setReadingDate] = useState(todayIsoDate());
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState<ElectricitySubmitResult | null>(null);
  const [balance, setBalance] = useState<UtilityBalance>(emptyBalance());
  const [balanceLoading, setBalanceLoading] = useState(true);
  const [balanceFailed, setBalanceFailed] = useState(false);
  const idempotencyKeyRef = useRef<string | null>(null);
  const canSubmit = mode === 'owner_and_staff' && Boolean(meter);
  const today = todayIsoDate();

  const loadBalance = useCallback(async () => {
    setBalanceLoading(true);
    setBalanceFailed(false);
    try {
      const { data, error } = await supabase.rpc('get_electricity_balance', { p_property_id: propertyId });
      if (error && !isMissingRelation(error, 'get_electricity_balance')) throw error;
      const row = ((data as UtilityBalance[] | null) ?? [])[0];
      setBalance(row ? { ...emptyBalance(), ...row } : emptyBalance());
      setBalanceFailed(false);
    } catch (err) {
      if (process.env.NODE_ENV !== 'production') console.error(err);
      setBalance(emptyBalance());
      setBalanceFailed(true);
    } finally {
      setBalanceLoading(false);
    }
  }, [propertyId, supabase]);

  useEffect(() => {
    void loadBalance();
  }, [loadBalance]);

  function onFormChange() {
    if (!submitting) idempotencyKeyRef.current = null;
  }

  function sourceLabel(source: 'owner' | 'staff' | null) {
    if (source === 'owner') return t('account.elByOwner');
    if (source === 'staff') return t('account.elByStaff');
    return '—';
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || submitting) return;
    setSubmitError(null);
    setSuccess(null);

    const day = Number(String(dayValue).replace(',', '.'));
    const night = Number(String(nightValue).replace(',', '.'));
    if (!Number.isFinite(day) || !Number.isFinite(night)) {
      setSubmitError(t('account.utilNeedNumber'));
      return;
    }
    if (!readingDate) {
      setSubmitError(t('account.utilNeedDate'));
      return;
    }
    if (readingDate > today) {
      setSubmitError(t('account.utilErrFuture'));
      return;
    }
    if (submitFloorDay != null && day < submitFloorDay) {
      setSubmitError(t('account.utilErrLower'));
      return;
    }
    if (submitFloorNight != null && night < submitFloorNight) {
      setSubmitError(t('account.utilErrLower'));
      return;
    }

    if (!idempotencyKeyRef.current) {
      idempotencyKeyRef.current = crypto.randomUUID();
    }

    setSubmitting(true);
    try {
      const { data, error } = await supabase.rpc('submit_electricity_reading', {
        p_property_id: propertyId,
        p_day_reading: Number(day.toFixed(3)),
        p_night_reading: Number(night.toFixed(3)),
        p_reading_date: readingDate,
        p_idempotency_key: idempotencyKeyRef.current,
      });
      if (error) {
        const key = mapSubmitElectricityError(error.message);
        const map = {
          lower: t('account.utilErrLower'),
          datePrev: t('account.utilErrDatePrev'),
          future: t('account.utilErrFuture'),
          conflict: t('account.utilErrConflict'),
          disabled: t('account.elErrDisabled'),
          staffOnly: t('account.elStaffOnly'),
          noMeter: t('account.elErrNoMeter'),
          generic: t('account.utilErrGeneric'),
        } as const;
        setSubmitError(map[key]);
        return;
      }
      const row = ((data as ElectricitySubmitResult[] | null) ?? [])[0] ?? null;
      setSuccess(row);
      setDayValue('');
      setNightValue('');
      idempotencyKeyRef.current = null;
      await onSubmitted();
      await loadBalance();
    } catch {
      setSubmitError(t('account.utilErrGeneric'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-[14px] border border-border bg-surface shadow-card p-5 md:p-6">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
          {t('account.meterTabElectricity')}
        </p>
        {meter ? (
          <div className="mt-3 rounded-xl border border-border bg-background px-3 py-3 text-sm text-secondary">
            <p className="font-medium text-foreground">{t('account.elMeter')}</p>
            <p className="mt-1">{t('account.elMeterShort', { n: displayElectricityMeterNumber(meter.meter_number) })}</p>
            <p className="mt-0.5">
              {t('account.elInstalledAt')}: {new Date(meter.installed_at).toLocaleDateString(dateLocale)}
            </p>
            <p className="mt-0.5">
              {t('account.elInitialDay')}: {formatKwh(Number(meter.initial_day_reading), locale)} {t('account.kwh')}
            </p>
            <p className="mt-0.5">
              {t('account.elInitialNight')}: {formatKwh(Number(meter.initial_night_reading), locale)} {t('account.kwh')}
            </p>
          </div>
        ) : (
          <p className="mt-3 text-sm text-secondary">{t('account.elNoMeter')}</p>
        )}
        <div className={meterKpiGridClass}>
          <div className={meterKpiCardClass}>
            <div className="text-[11px] text-muted">{t('account.elDayReading')}</div>
            <div className="mt-1 text-lg font-semibold text-foreground">
              {shown.currentDay != null ? `${formatKwh(shown.currentDay, locale)} ${t('account.kwh')}` : '—'}
            </div>
          </div>
          <div className={meterKpiCardClass}>
            <div className="text-[11px] text-muted">{t('account.elNightReading')}</div>
            <div className="mt-1 text-lg font-semibold text-foreground">
              {shown.currentNight != null ? `${formatKwh(shown.currentNight, locale)} ${t('account.kwh')}` : '—'}
            </div>
          </div>
          <div className={meterKpiCardClass}>
            <div className="text-[11px] text-muted">{t('account.previousReading')}</div>
            <div className="mt-1 text-sm font-semibold text-foreground">
              {prevDay != null || prevNight != null
                ? `${prevDay != null ? formatKwh(prevDay, locale) : '—'} / ${prevNight != null ? formatKwh(prevNight, locale) : '—'} ${t('account.kwh')}`
                : '—'}
            </div>
          </div>
          <div className={meterKpiCardClass}>
            <div className="text-[11px] text-muted">{t('account.utilLastReading')}</div>
            <div className="mt-1 text-sm font-semibold text-foreground">
              {shown.readingDate ? new Date(shown.readingDate).toLocaleDateString(dateLocale) : '—'}
            </div>
          </div>
          {onOpenFinance ? (
            <MeterFinanceStatus
              balance={Number(balance.balance_eur)}
              loading={balanceLoading}
              failed={balanceFailed}
              onOpenFinances={() => onOpenFinance('electricity')}
            />
          ) : null}
        </div>

        {mode === 'staff_only' && (
          <p className="mt-4 rounded-xl border border-border bg-background px-3 py-2 text-sm text-secondary">
            {t('account.elStaffOnly')}
          </p>
        )}

        {mode === 'owner_and_staff' && !meter && (
          <p className="mt-4 rounded-xl border border-border bg-background px-3 py-2 text-sm text-secondary">
            {t('account.elNoMeter')}
          </p>
        )}

        {canSubmit && (
          <form onSubmit={handleSubmit} className="mt-5 space-y-3">
            <p className="text-sm font-medium text-foreground">{t('account.utilSubmitTitle')}</p>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block text-sm text-secondary">
                {t('account.elDayReading')}
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.001"
                  min={submitFloorDay ?? 0}
                  required
                  value={dayValue}
                  onChange={(e) => {
                    onFormChange();
                    setDayValue(e.target.value);
                  }}
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                />
              </label>
              <label className="block text-sm text-secondary">
                {t('account.elNightReading')}
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.001"
                  min={submitFloorNight ?? 0}
                  required
                  value={nightValue}
                  onChange={(e) => {
                    onFormChange();
                    setNightValue(e.target.value);
                  }}
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                />
              </label>
              <label className="block text-sm text-secondary">
                {t('account.utilReadingDate')}
                <input
                  type="date"
                  required
                  max={today}
                  value={readingDate}
                  onChange={(e) => {
                    onFormChange();
                    setReadingDate(e.target.value);
                  }}
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                />
              </label>
            </div>
            {submitError && <p className="text-sm text-danger">{submitError}</p>}
            {success && (
              <div className="rounded-xl border border-accent/20 bg-accent-bg px-3 py-2 text-sm text-secondary">
                <p className="font-medium text-accent">{t('account.elSubmitOk')}</p>
                <p className="mt-1">
                  {t('account.consumption')} {t('account.elDayShort')}: {formatKwh(Number(success.consumption_day), locale)} {t('account.kwh')}
                  {' · '}
                  {t('account.elNightShort')}: {formatKwh(Number(success.consumption_night), locale)} {t('account.kwh')}
                </p>
              </div>
            )}
            <button
              type="submit"
              disabled={submitting}
              className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
            >
              {submitting ? t('account.utilSubmitting') : t('account.elSubmit')}
            </button>
          </form>
        )}
      </div>

      <div className="rounded-[14px] border border-border bg-surface shadow-card p-5 md:p-6">
        <p className="mb-2 text-[11px] uppercase tracking-wider text-muted">{t('account.utilHistory')}</p>
        {pairs.length === 0 ? (
          <p className="text-sm text-secondary">{t('account.utilNoReadings')}</p>
        ) : (
          <div className="-mx-1 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="text-[11px] uppercase tracking-wider text-muted">
                <tr>
                  <th className="px-2 py-1 font-medium">{t('account.utilColDate')}</th>
                  <th className="px-2 py-1 font-medium">{t('account.elMeter')}</th>
                  <th className="px-2 py-1 font-medium">{t('account.elDayShort')}</th>
                  <th className="px-2 py-1 font-medium">{t('account.elNightShort')}</th>
                  <th className="px-2 py-1 font-medium">{t('account.elUseDay')}</th>
                  <th className="px-2 py-1 font-medium">{t('account.elUseNight')}</th>
                  <th className="px-2 py-1 font-medium">{t('account.elSubmittedBy')}</th>
                </tr>
              </thead>
              <tbody>
                {pairs.map((row) => (
                  <tr key={row.key} className="text-secondary">
                    <td className="whitespace-nowrap px-2 py-1.5">
                      {row.reading_date ? new Date(row.reading_date).toLocaleDateString(dateLocale) : '—'}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5">
                      {row.meter_number ? t('account.elMeterShort', { n: displayElectricityMeterNumber(row.meter_number) }) : '—'}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5">{row.day != null ? formatKwh(row.day, locale) : '—'}</td>
                    <td className="whitespace-nowrap px-2 py-1.5">{row.night != null ? formatKwh(row.night, locale) : '—'}</td>
                    <td className="whitespace-nowrap px-2 py-1.5">{row.consumptionDay != null ? formatKwh(row.consumptionDay, locale) : '—'}</td>
                    <td className="whitespace-nowrap px-2 py-1.5">{row.consumptionNight != null ? formatKwh(row.consumptionNight, locale) : '—'}</td>
                    <td className="whitespace-nowrap px-2 py-1.5">{sourceLabel(row.source)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
