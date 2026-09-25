'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { useI18n } from '@/i18n/I18nProvider';
import { MeterFinanceStatus, compactKpiAlignClass, meterKpiCardClass, meterKpiGridClass } from '@/components/account/MeterFinanceStatus';
import { formatOwnerDate } from '@/lib/ownerFormat';
import { isMissingRelation } from '@/lib/polls';
import {
  formatElectricityTariff,
  type ElectricityCharge,
  type ElectricityLedger,
} from '@/lib/electricity';
import {
  balanceTone,
  emptyBalance,
  formatEur,
  formatKwh,
  formatM3,
  lastActiveReading,
  mapSubmitWaterError,
  todayIsoDate,
  parseWaterVolume,
  normalizeWaterVolume,
  DEFAULT_WATER_MODE,
  type CapitalAssessment,
  type CapitalLedger,
  type UtilityBalance,
  type WaterMode,
  type WaterLedger,
  type WaterMeter,
  type WaterReading,
  type WaterSubmitResult,
  type WaterTariff,
} from '@/lib/utilities';

type Variant = 'finance' | 'meters';
export type FinanceTab = 'support' | 'water' | 'electricity' | 'capital';
export type MeterTab = 'water' | 'electricity';

function ledgerKindLabel(kind: string, t: (key: 'account.utilCharge' | 'account.utilPayment' | 'account.utilAdjDebit' | 'account.utilAdjCredit') => string) {
  if (kind === 'charge') return t('account.utilCharge');
  if (kind === 'payment') return t('account.utilPayment');
  if (kind === 'adjustment_debit') return t('account.utilAdjDebit');
  if (kind === 'adjustment_credit') return t('account.utilAdjCredit');
  return kind;
}

function BalanceBadge({ balance, loading }: { balance: number; loading: boolean }) {
  const { t } = useI18n();
  if (loading) {
    return <span className="text-sm text-muted">{t('common.loading')}</span>;
  }
  const tone = balanceTone(balance);
  const label =
    tone === 'debt' ? t('account.utilStatusDebt') : tone === 'over' ? t('account.utilStatusOver') : t('account.utilStatusSettled');
  const cls =
    tone === 'debt' ? 'text-danger' : tone === 'over' ? 'text-success' : 'text-muted';
  return (
    <div>
      <div className={`text-2xl font-semibold tracking-tight ${cls}`}>{formatEur(Math.abs(balance))}</div>
      <p className="mt-1 text-sm text-secondary">{label}</p>
    </div>
  );
}

function LedgerList({
  rows,
  titles,
  empty,
  dateLocale,
}: {
  rows: Array<{ id: string; created_at: string; kind: string; amount_eur: number; note: string | null; assessment_id?: string | null }>;
  titles?: Map<string, string>;
  empty: string;
  dateLocale: string;
}) {
  const { t } = useI18n();
  if (rows.length === 0) {
    return <p className="text-sm text-secondary">{empty}</p>;
  }
  return (
    <div className="space-y-2">
      {rows.map((row) => {
        const title = row.assessment_id ? titles?.get(row.assessment_id) : undefined;
        return (
          <div key={row.id} className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
            <span className="min-w-0 text-secondary">
              {formatOwnerDate(row.created_at, dateLocale)}
              {' · '}
              {ledgerKindLabel(row.kind, t)}
              {title ? ` · ${title}` : ''}
              {row.note ? ` · ${row.note}` : ''}
            </span>
            <span className={row.kind === 'payment' || row.kind === 'adjustment_credit' ? 'text-accent' : 'text-warning'}>
              {formatEur(Number(row.amount_eur))}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function OwnerUtilities({
  supabase,
  propertyId,
  variant,
  currentTariff,
  financeTab = 'support',
  onSelectFinanceTab,
  supportDebt = 0,
  supportOver = 0,
  meterTab = 'water',
  onSelectMeterTab,
  waterMode = DEFAULT_WATER_MODE,
  waterEnabled = true,
  electricityEnabled = true,
  capitalEnabled = true,
  electricLastDay = null,
  electricLastNight = null,
  electricLastDate = null,
  electricMeterNumber = null,
  onOpenFinance,
}: {
  supabase: SupabaseClient<Database>;
  propertyId: number;
  variant: Variant;
  currentTariff?: WaterTariff | null;
  financeTab?: FinanceTab;
  onSelectFinanceTab?: (tab: FinanceTab) => void;
  supportDebt?: number;
  supportOver?: number;
  meterTab?: MeterTab;
  onSelectMeterTab?: (tab: MeterTab) => void;
  waterMode?: WaterMode;
  waterEnabled?: boolean;
  electricityEnabled?: boolean;
  capitalEnabled?: boolean;
  electricLastDay?: number | null;
  electricLastNight?: number | null;
  electricLastDate?: string | null;
  electricMeterNumber?: string | null;
  onOpenFinance?: (tab: FinanceTab) => void;
}) {
  const { t, dateLocale, locale } = useI18n();
  const [waterLoading, setWaterLoading] = useState(true);
  const [capitalLoading, setCapitalLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState<WaterSubmitResult | null>(null);

  const [meter, setMeter] = useState<WaterMeter | null>(null);
  const [tariff, setTariff] = useState<WaterTariff | null>(null);
  const [readings, setReadings] = useState<WaterReading[]>([]);
  const [waterLedger, setWaterLedger] = useState<WaterLedger[]>([]);
  const [waterBalance, setWaterBalance] = useState<UtilityBalance>(emptyBalance());
  const [waterBalanceLoading, setWaterBalanceLoading] = useState(true);
  const [waterBalanceFailed, setWaterBalanceFailed] = useState(false);
  const [capitalLedger, setCapitalLedger] = useState<CapitalLedger[]>([]);
  const [assessments, setAssessments] = useState<CapitalAssessment[]>([]);
  const [capitalBalance, setCapitalBalance] = useState<UtilityBalance>(emptyBalance());
  const [electricityLoading, setElectricityLoading] = useState(true);
  const [electricityCharges, setElectricityCharges] = useState<ElectricityCharge[]>([]);
  const [electricityLedger, setElectricityLedger] = useState<ElectricityLedger[]>([]);
  const [electricityBalance, setElectricityBalance] = useState<UtilityBalance>(emptyBalance());

  const [currentValue, setCurrentValue] = useState('');
  const [readingDate, setReadingDate] = useState(todayIsoDate());
  const idempotencyKeyRef = useRef<string | null>(null);

  const lastActive = useMemo(() => {
    const scoped = meter ? readings.filter((r) => r.meter_id === meter.id) : readings;
    return lastActiveReading(scoped);
  }, [readings, meter]);
  const lastCurrent = lastActive ? Number(lastActive.current_value) : null;
  const previousDisplay = lastActive
    ? Number(lastActive.previous_value)
    : Number(meter?.initial_reading ?? 0);
  const submitMin = lastCurrent ?? Number(meter?.initial_reading ?? 0);
  const previousIsInitial = !lastActive && Boolean(meter);
  const today = todayIsoDate();

  const loadWater = useCallback(async () => {
    setWaterLoading(true);
    setWaterBalanceLoading(true);
    setWaterBalanceFailed(false);
    try {
      const [meterRes, tariffRes, readingsRes, ledgerRes] = await Promise.all([
        supabase
          .from('water_meters')
          .select('*')
          .eq('property_id', propertyId)
          .is('retired_at', null)
          .maybeSingle(),
        currentTariff !== undefined
          ? Promise.resolve({ data: currentTariff ? [currentTariff] : [], error: null })
          : supabase.from('water_tariffs').select('*').order('valid_from', { ascending: false }).limit(1),
        supabase
          .from('water_readings')
          .select('*')
          .eq('property_id', propertyId)
          .order('reading_date', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(12),
        supabase
          .from('water_ledger')
          .select('*')
          .eq('property_id', propertyId)
          .order('created_at', { ascending: false })
          .limit(12),
      ]);

      if (meterRes.error && !isMissingRelation(meterRes.error, 'water_meters')) throw meterRes.error;
      setMeter((meterRes.data as WaterMeter | null) ?? null);

      if (tariffRes.error && !isMissingRelation(tariffRes.error, 'water_tariffs')) throw tariffRes.error;
      setTariff(((tariffRes.data as WaterTariff[] | null) ?? [])[0] ?? null);

      if (readingsRes.error && !isMissingRelation(readingsRes.error, 'water_readings')) throw readingsRes.error;
      setReadings((readingsRes.data as WaterReading[] | null) ?? []);

      if (ledgerRes.error && !isMissingRelation(ledgerRes.error, 'water_ledger')) throw ledgerRes.error;
      setWaterLedger((ledgerRes.data as WaterLedger[] | null) ?? []);
    } catch (err) {
      if (process.env.NODE_ENV !== 'production') console.error(err);
      setMeter(null);
      setReadings([]);
      setWaterLedger([]);
    } finally {
      setWaterLoading(false);
    }

    try {
      const balRes = await supabase.rpc('get_water_balance', { p_property_id: propertyId });
      if (balRes.error && !isMissingRelation(balRes.error, 'get_water_balance')) throw balRes.error;
      const row = ((balRes.data as UtilityBalance[] | null) ?? [])[0];
      setWaterBalance(row ? { ...emptyBalance(), ...row } : emptyBalance());
      setWaterBalanceFailed(false);
    } catch (err) {
      if (process.env.NODE_ENV !== 'production') console.error(err);
      setWaterBalance(emptyBalance());
      setWaterBalanceFailed(true);
    } finally {
      setWaterBalanceLoading(false);
    }
  }, [propertyId, supabase, currentTariff]);

  const loadCapital = useCallback(async () => {
    setCapitalLoading(true);
    try {
      const [ledgerRes, assessRes, balRes] = await Promise.all([
        supabase
          .from('capital_repair_ledger')
          .select('*')
          .eq('property_id', propertyId)
          .order('created_at', { ascending: false })
          .limit(20),
        supabase.from('capital_repair_assessments').select('*').order('created_at', { ascending: false }),
        supabase.rpc('get_capital_repair_balance', { p_property_id: propertyId }),
      ]);

      if (ledgerRes.error && !isMissingRelation(ledgerRes.error, 'capital_repair_ledger')) throw ledgerRes.error;
      setCapitalLedger((ledgerRes.data as CapitalLedger[] | null) ?? []);

      if (assessRes.error && !isMissingRelation(assessRes.error, 'capital_repair_assessments')) throw assessRes.error;
      setAssessments((assessRes.data as CapitalAssessment[] | null) ?? []);

      if (balRes.error && !isMissingRelation(balRes.error, 'get_capital_repair_balance')) throw balRes.error;
      const row = ((balRes.data as UtilityBalance[] | null) ?? [])[0];
      setCapitalBalance(row ? { ...emptyBalance(), ...row } : emptyBalance());
    } catch (err) {
      if (process.env.NODE_ENV !== 'production') console.error(err);
      setCapitalLedger([]);
      setAssessments([]);
      setCapitalBalance(emptyBalance());
    } finally {
      setCapitalLoading(false);
    }
  }, [propertyId, supabase]);

  const loadElectricity = useCallback(async () => {
    setElectricityLoading(true);
    try {
      const [chargeRes, ledgerRes, balRes] = await Promise.all([
        supabase
          .from('electricity_charges')
          .select('*')
          .eq('property_id', propertyId)
          .order('reading_date', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(40),
        supabase
          .from('electricity_ledger')
          .select('*')
          .eq('property_id', propertyId)
          .order('created_at', { ascending: false })
          .limit(40),
        supabase.rpc('get_electricity_balance', { p_property_id: propertyId }),
      ]);
      if (chargeRes.error && !isMissingRelation(chargeRes.error, 'electricity_charges')) throw chargeRes.error;
      setElectricityCharges((chargeRes.data as ElectricityCharge[] | null) ?? []);
      if (ledgerRes.error && !isMissingRelation(ledgerRes.error, 'electricity_ledger')) throw ledgerRes.error;
      setElectricityLedger((ledgerRes.data as ElectricityLedger[] | null) ?? []);
      if (balRes.error && !isMissingRelation(balRes.error, 'get_electricity_balance')) throw balRes.error;
      const row = ((balRes.data as UtilityBalance[] | null) ?? [])[0];
      setElectricityBalance(row ? { ...emptyBalance(), ...row } : emptyBalance());
    } catch (err) {
      if (process.env.NODE_ENV !== 'production') console.error(err);
      setElectricityCharges([]);
      setElectricityLedger([]);
      setElectricityBalance(emptyBalance());
    } finally {
      setElectricityLoading(false);
    }
  }, [propertyId, supabase]);

  useEffect(() => {
    if (waterEnabled) {
      void loadWater();
    } else {
      setWaterLoading(false);
      setWaterBalanceLoading(false);
      setWaterBalanceFailed(false);
      setMeter(null);
      setReadings([]);
      setWaterLedger([]);
      setWaterBalance(emptyBalance());
    }
    if (variant === 'finance' && capitalEnabled) {
      void loadCapital();
    } else {
      setCapitalLoading(false);
      setCapitalLedger([]);
      setAssessments([]);
      setCapitalBalance(emptyBalance());
    }
    if (variant === 'finance' && electricityEnabled) {
      void loadElectricity();
    } else {
      setElectricityLoading(false);
      setElectricityCharges([]);
      setElectricityLedger([]);
      setElectricityBalance(emptyBalance());
    }
    setCurrentValue('');
    setReadingDate(todayIsoDate());
    setSubmitError(null);
    setSuccess(null);
    idempotencyKeyRef.current = null;
  }, [loadWater, loadCapital, loadElectricity, variant, propertyId, waterEnabled, electricityEnabled, capitalEnabled]);

  const assessmentTitles = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of assessments) map.set(a.id, a.title);
    return map;
  }, [assessments]);

  const chargesByAssessment = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of capitalLedger) {
      if (row.kind === 'charge' && row.assessment_id) {
        map.set(row.assessment_id, Number(row.amount_eur));
      }
    }
    return map;
  }, [capitalLedger]);

  function onFormChange() {
    if (!submitting) idempotencyKeyRef.current = null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!meter || submitting) return;
    setSubmitError(null);
    setSuccess(null);

    const parsed = parseWaterVolume(String(currentValue));
    if (!Number.isFinite(parsed)) {
      setSubmitError(t('account.utilNeedNumber'));
      return;
    }
    const normalized = normalizeWaterVolume(parsed);
    if (normalized < submitMin) {
      setSubmitError(t('account.utilErrLower'));
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

    if (!idempotencyKeyRef.current) {
      idempotencyKeyRef.current = crypto.randomUUID();
    }

    setSubmitting(true);
    try {
      const { data, error } = await supabase.rpc('submit_water_reading', {
        p_property_id: propertyId,
        p_current_value: normalized,
        p_reading_date: readingDate,
        p_idempotency_key: idempotencyKeyRef.current,
      });
      if (error) {
        const code = mapSubmitWaterError(error.message ?? '');
        const map: Record<ReturnType<typeof mapSubmitWaterError>, string> = {
          noMeter: t('account.utilErrNoMeter'),
          lower: t('account.utilErrLower'),
          datePrev: t('account.utilErrDatePrev'),
          future: t('account.utilErrFuture'),
          conflict: t('account.utilErrConflict'),
          disabled: t('account.utilErrDisabled'),
          staffOnly: t('account.waterStaffOnly'),
          generic: t('account.utilErrGeneric'),
        };
        setSubmitError(map[code]);
        if (process.env.NODE_ENV !== 'production') console.error(error);
        return;
      }
      const row = ((data as WaterSubmitResult[] | null) ?? [])[0] ?? null;
      setSuccess(row);
      idempotencyKeyRef.current = null;
      setCurrentValue('');
      await Promise.all([loadWater(), variant === 'finance' ? loadCapital() : Promise.resolve()]);
    } catch (err) {
      if (process.env.NODE_ENV !== 'production') console.error(err);
      setSubmitError(t('account.utilErrGeneric'));
    } finally {
      setSubmitting(false);
    }
  }

  const waterCard = (
    <div className="rounded-[14px] border border-border bg-surface shadow-card p-5 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">{t('account.utilWater')}</p>
          {waterLoading ? (
            <p className="mt-2 text-sm text-muted">{t('common.loading')}</p>
          ) : meter ? (
            <>
              <p className="mt-1 text-sm text-secondary">
                {t('account.utilMeterNo')}: <span className="font-medium text-foreground">{meter.meter_number}</span>
              </p>
              <p className="mt-0.5 text-sm text-secondary">
                {t('account.utilInstalled')}:{' '}
                <span className="font-medium text-foreground">
                  {formatOwnerDate(meter.installed_at, dateLocale)}
                </span>
              </p>
            </>
          ) : (
            <p className="mt-2 text-sm text-secondary">{t('account.utilNoMeter')}</p>
          )}
        </div>
        {variant === 'finance' ? (
          <BalanceBadge balance={Number(waterBalance.balance_eur)} loading={waterLoading} />
        ) : null}
      </div>

      {meter && !waterLoading && variant === 'finance' && (
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className={`${compactKpiAlignClass} rounded-xl bg-background px-3 py-3`}>
            <div className="text-[11px] text-muted">
              {previousIsInitial ? t('account.utilInitial') : t('account.utilLastReading')}
            </div>
            <div className="mt-1 text-lg font-semibold text-foreground">{formatM3(lastCurrent ?? previousDisplay, locale)} {t('account.m3')}</div>
            <div className="mt-0.5 text-[11px] text-muted">
              {lastActive
                ? formatOwnerDate(lastActive.reading_date, dateLocale)
                : t('account.utilInitialHint')}
            </div>
          </div>
          <div className={`${compactKpiAlignClass} rounded-xl bg-background px-3 py-3`}>
            <div className="text-[11px] text-muted">{t('account.utilTariff')}</div>
            <div className="mt-1 text-lg font-semibold text-foreground">
              {tariff ? Number(tariff.price_eur_per_m3).toFixed(2) : '—'}
            </div>
            <div className="mt-0.5 text-[11px] text-muted">{t('account.perM3')}</div>
          </div>
          <div className={`${compactKpiAlignClass} rounded-xl bg-background px-3 py-3`}>
            <div className="text-[11px] text-muted">{t('account.debt')}</div>
            <div className={`mt-1 text-lg font-semibold ${waterBalance.balance_eur > 0 ? 'text-danger' : 'text-muted'}`}>
              {formatEur(Math.max(0, Number(waterBalance.balance_eur)))}
            </div>
          </div>
          <div className={`${compactKpiAlignClass} rounded-xl bg-background px-3 py-3`}>
            <div className="text-[11px] text-muted">{t('account.overpay')}</div>
            <div className={`mt-1 text-lg font-semibold ${waterBalance.balance_eur < 0 ? 'text-success' : 'text-muted'}`}>
              {formatEur(Math.max(0, -Number(waterBalance.balance_eur)))}
            </div>
          </div>
        </div>
      )}

      {meter && !waterLoading && variant === 'meters' && (
        <div className={meterKpiGridClass}>
          <div className={meterKpiCardClass}>
            <div className="text-[11px] text-muted">{t('account.utilLastReading')}</div>
            <div className="mt-1 text-lg font-semibold text-foreground">
              {lastActive ? `${formatM3(Number(lastActive.current_value), locale)} ${t('account.m3')}` : '—'}
            </div>
            <div className="mt-0.5 text-[11px] text-muted">
              {lastActive
                ? formatOwnerDate(lastActive.reading_date, dateLocale)
                : t('account.utilNoReadings')}
            </div>
          </div>
          <div className={meterKpiCardClass}>
            <div className="text-[11px] text-muted">
              {previousIsInitial ? t('account.utilInitial') : t('account.previousReading')}
            </div>
            <div className="mt-1 text-lg font-semibold text-foreground">{formatM3(previousDisplay, locale)} {t('account.m3')}</div>
            <div className="mt-0.5 text-[11px] text-muted">
              {lastActive
                ? formatOwnerDate(lastActive.reading_date, dateLocale)
                : t('account.utilInitialHint')}
            </div>
          </div>
          <div className={meterKpiCardClass}>
            <div className="text-[11px] text-muted">{t('account.consumption')}</div>
            <div className="mt-1 text-lg font-semibold text-foreground">
              {lastActive ? `${formatM3(Number(lastActive.consumption_m3), locale)} ${t('account.m3')}` : '—'}
            </div>
          </div>
          <div className={meterKpiCardClass}>
            <div className="text-[11px] text-muted">{t('account.utilTariff')}</div>
            <div className="mt-1 text-lg font-semibold text-foreground">
              {tariff ? Number(tariff.price_eur_per_m3).toFixed(2) : '—'}
            </div>
            <div className="mt-0.5 text-[11px] text-muted">{t('account.perM3')}</div>
          </div>
          {onOpenFinance ? (
            <MeterFinanceStatus
              balance={Number(waterBalance.balance_eur)}
              loading={waterBalanceLoading}
              failed={waterBalanceFailed}
              onOpenFinances={() => onOpenFinance('water')}
            />
          ) : null}
        </div>
      )}

      {!meter && variant === 'meters' && onOpenFinance && (
        <div className={meterKpiGridClass}>
          <MeterFinanceStatus
            balance={Number(waterBalance.balance_eur)}
            loading={waterBalanceLoading}
            failed={waterBalanceFailed}
            onOpenFinances={() => onOpenFinance('water')}
          />
        </div>
      )}

      {meter && variant === 'meters' && waterMode === 'staff_only' && (
        <p className="mt-5 rounded-xl border border-border bg-background px-3 py-3 text-sm text-secondary">
          {t('account.waterStaffOnly')}
        </p>
      )}

      {meter && variant === 'meters' && waterMode === 'owner_and_staff' && (
        <form onSubmit={handleSubmit} className="mt-5 space-y-3">
          <p className="text-sm font-medium text-foreground">{t('account.utilSubmitTitle')}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm text-secondary">
              {t('account.utilCurrentM3')}
              <input
                type="number"
                inputMode="decimal"
                step="0.1"
                min={submitMin}
                required
                value={currentValue}
                onChange={(e) => {
                  onFormChange();
                  setCurrentValue(e.target.value);
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
              <p className="font-medium text-accent">{t('account.utilSubmitOk')}</p>
              {success.charge_created ? (
                <p className="mt-1">
                  {t('account.consumption')} {formatM3(Number(success.consumption_m3), locale)} {t('account.m3')}
                  {' · '}
                  {t('account.utilCharged')} {formatEur(Number(success.charge_amount_eur))}
                </p>
              ) : (
                <p className="mt-1">{t('account.utilZeroCharge')}</p>
              )}
            </div>
          )}
          <button
            type="submit"
            disabled={submitting}
            className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
          >
            {submitting ? t('account.utilSubmitting') : t('account.utilSubmit')}
          </button>
        </form>
      )}

      <div className="mt-6">
        <p className="mb-2 text-[11px] uppercase tracking-wider text-muted">{t('account.utilHistory')}</p>
        {waterLoading ? (
          <p className="text-sm text-muted">{t('common.loading')}</p>
        ) : readings.length === 0 ? (
          <p className="text-sm text-secondary">{t('account.utilNoReadings')}</p>
        ) : (
          <div className="-mx-1 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="text-[11px] uppercase tracking-wider text-muted">
                <tr>
                  <th className="px-2 py-1 font-medium">{t('account.utilColDate')}</th>
                  <th className="px-2 py-1 font-medium">{t('account.previousReading')}</th>
                  <th className="px-2 py-1 font-medium">{t('account.currentReading')}</th>
                  <th className="px-2 py-1 font-medium">{t('account.consumption')}</th>
                  <th className="px-2 py-1 font-medium">{t('account.utilTariff')}</th>
                  <th className="px-2 py-1 font-medium">{t('account.utilCharged')}</th>
                  {variant === 'meters' ? (
                    <th className="px-2 py-1 font-medium">{t('account.elSubmittedBy')}</th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {readings.map((row) => {
                  const reversed = row.status === 'reversed';
                  const via =
                    row.submitted_via === 'staff'
                      ? t('account.elByStaff')
                      : row.submitted_via === 'owner'
                        ? t('account.elByOwner')
                        : '—';
                  return (
                    <tr key={row.id} className={reversed ? 'text-muted' : 'text-secondary'}>
                      <td className="whitespace-nowrap px-2 py-1.5">
                        {formatOwnerDate(row.reading_date, dateLocale)}
                        {reversed ? ` · ${t('account.utilReversed')}` : ''}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5">{formatM3(Number(row.previous_value), locale)}</td>
                      <td className="whitespace-nowrap px-2 py-1.5">{formatM3(Number(row.current_value), locale)}</td>
                      <td className="whitespace-nowrap px-2 py-1.5">{formatM3(Number(row.consumption_m3), locale)}</td>
                      <td className="whitespace-nowrap px-2 py-1.5">{Number(row.tariff_eur_per_m3).toFixed(2)}</td>
                      <td className="whitespace-nowrap px-2 py-1.5">{formatEur(Number(row.charge_amount_eur))}</td>
                      {variant === 'meters' ? (
                        <td className="whitespace-nowrap px-2 py-1.5">{via}</td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );

  if (variant === 'meters') {
    return waterEnabled && meterTab === 'water' ? waterCard : null;
  }

  return (
    <div className="space-y-4">
      {waterEnabled && financeTab === 'water' && (
        <>
          <div className="rounded-[14px] border border-border bg-surface shadow-card p-5 md:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">{t('account.financeTabWater')}</p>
                <p className="mt-1 text-sm text-secondary">
                  {t('account.utilTariff')}: {tariff ? `${Number(tariff.price_eur_per_m3).toFixed(2)} ${t('account.perM3')}` : '—'}
                </p>
              </div>
              <BalanceBadge balance={Number(waterBalance.balance_eur)} loading={waterLoading} />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className={`${compactKpiAlignClass} rounded-xl bg-background px-3 py-3`}>
                <div className="text-[11px] text-muted">{t('account.utilCharged')}</div>
                <div className="mt-1 text-lg font-semibold">{formatEur(Number(waterBalance.charged_eur))}</div>
              </div>
              <div className={`${compactKpiAlignClass} rounded-xl bg-background px-3 py-3`}>
                <div className="text-[11px] text-muted">{t('account.utilPaid')}</div>
                <div className="mt-1 text-lg font-semibold">{formatEur(Number(waterBalance.paid_eur))}</div>
              </div>
              <div className={`${compactKpiAlignClass} rounded-xl bg-background px-3 py-3`}>
                <div className="text-[11px] text-muted">{t('account.debt')}</div>
                <div className={`mt-1 text-lg font-semibold ${waterBalance.balance_eur > 0 ? 'text-danger' : 'text-muted'}`}>
                  {formatEur(Math.max(0, Number(waterBalance.balance_eur)))}
                </div>
              </div>
              <div className={`${compactKpiAlignClass} rounded-xl bg-background px-3 py-3`}>
                <div className="text-[11px] text-muted">{t('account.overpay')}</div>
                <div className={`mt-1 text-lg font-semibold ${waterBalance.balance_eur < 0 ? 'text-success' : 'text-muted'}`}>
                  {formatEur(Math.max(0, -Number(waterBalance.balance_eur)))}
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-[14px] border border-border bg-surface shadow-card p-5 md:p-6">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">{t('account.utilWaterOps')}</p>
            <div className="mt-3">
              {waterLoading ? (
                <p className="text-sm text-muted">{t('common.loading')}</p>
              ) : (
                <LedgerList
                  rows={waterLedger}
                  empty={t('account.utilNoWaterLedger')}
                  dateLocale={dateLocale}
                />
              )}
            </div>
          </div>

          <div className="rounded-[14px] border border-border bg-surface shadow-card p-5 md:p-6">
            <p className="mb-2 text-[11px] uppercase tracking-wider text-muted">{t('account.utilHistory')}</p>
            {waterLoading ? (
              <p className="text-sm text-muted">{t('common.loading')}</p>
            ) : readings.length === 0 ? (
              <p className="text-sm text-secondary">{t('account.utilNoReadings')}</p>
            ) : (
              <div className="-mx-1 overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="text-[11px] uppercase tracking-wider text-muted">
                    <tr>
                      <th className="px-2 py-1 font-medium">{t('account.utilColDate')}</th>
                      <th className="px-2 py-1 font-medium">{t('account.consumption')}</th>
                      <th className="px-2 py-1 font-medium">{t('account.utilCharged')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {readings.map((row) => (
                      <tr key={row.id} className={row.status === 'reversed' ? 'text-muted' : 'text-secondary'}>
                        <td className="whitespace-nowrap px-2 py-1.5">
                          {formatOwnerDate(row.reading_date, dateLocale)}
                          {row.status === 'reversed' ? ` · ${t('account.utilReversed')}` : ''}
                        </td>
                        <td className="whitespace-nowrap px-2 py-1.5">{formatM3(Number(row.consumption_m3), locale)} {t('account.m3')}</td>
                        <td className="whitespace-nowrap px-2 py-1.5">{formatEur(Number(row.charge_amount_eur))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {electricityEnabled && financeTab === 'electricity' && (
        <>
          <div className="rounded-[14px] border border-border bg-surface shadow-card p-5 md:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">{t('account.financeTabElectricity')}</p>
              </div>
              <BalanceBadge balance={Number(electricityBalance.balance_eur)} loading={electricityLoading} />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className={`${compactKpiAlignClass} rounded-xl bg-background px-3 py-3`}>
                <div className="text-[11px] text-muted">{t('account.utilCharged')}</div>
                <div className="mt-1 text-lg font-semibold">{formatEur(Number(electricityBalance.charged_eur))}</div>
              </div>
              <div className={`${compactKpiAlignClass} rounded-xl bg-background px-3 py-3`}>
                <div className="text-[11px] text-muted">{t('account.utilPaid')}</div>
                <div className="mt-1 text-lg font-semibold">{formatEur(Number(electricityBalance.paid_eur))}</div>
              </div>
              <div className={`${compactKpiAlignClass} rounded-xl bg-background px-3 py-3`}>
                <div className="text-[11px] text-muted">{t('account.debt')}</div>
                <div className={`mt-1 text-lg font-semibold ${electricityBalance.balance_eur > 0 ? 'text-danger' : 'text-muted'}`}>
                  {formatEur(Math.max(0, Number(electricityBalance.balance_eur)))}
                </div>
              </div>
              <div className={`${compactKpiAlignClass} rounded-xl bg-background px-3 py-3`}>
                <div className="text-[11px] text-muted">{t('account.overpay')}</div>
                <div className={`mt-1 text-lg font-semibold ${electricityBalance.balance_eur < 0 ? 'text-success' : 'text-muted'}`}>
                  {formatEur(Math.max(0, -Number(electricityBalance.balance_eur)))}
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-[14px] border border-border bg-surface shadow-card p-5 md:p-6">
            <p className="mb-2 text-[11px] uppercase tracking-wider text-muted">{t('account.elChargeHistory')}</p>
            {electricityLoading ? (
              <p className="text-sm text-muted">{t('common.loading')}</p>
            ) : electricityCharges.length === 0 ? (
              <p className="text-sm text-secondary">{t('account.utilNoReadings')}</p>
            ) : (
              <div className="-mx-1 overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="text-[11px] uppercase tracking-wider text-muted">
                    <tr>
                      <th className="px-2 py-1 font-medium">{t('account.utilColDate')}</th>
                      <th className="px-2 py-1 font-medium">{t('account.elConsDay')}</th>
                      <th className="px-2 py-1 font-medium">{t('account.elConsNight')}</th>
                      <th className="px-2 py-1 font-medium">{t('account.elTariffDay')}</th>
                      <th className="px-2 py-1 font-medium">{t('account.elTariffNight')}</th>
                      <th className="px-2 py-1 font-medium">{t('account.utilCharged')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {electricityCharges.map((row) => (
                      <tr key={row.id} className="text-secondary">
                        <td className="whitespace-nowrap px-2 py-1.5">{formatOwnerDate(row.reading_date, dateLocale)}</td>
                        <td className="whitespace-nowrap px-2 py-1.5">{formatKwh(Number(row.consumption_day), locale)}</td>
                        <td className="whitespace-nowrap px-2 py-1.5">{formatKwh(Number(row.consumption_night), locale)}</td>
                        <td className="whitespace-nowrap px-2 py-1.5">{formatElectricityTariff(Number(row.day_tariff_eur_per_kwh), locale)}</td>
                        <td className="whitespace-nowrap px-2 py-1.5">{formatElectricityTariff(Number(row.night_tariff_eur_per_kwh), locale)}</td>
                        <td className="whitespace-nowrap px-2 py-1.5">{formatEur(Number(row.total_amount_eur))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="rounded-[14px] border border-border bg-surface shadow-card p-5 md:p-6">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">{t('account.elOpsHistory')}</p>
            <div className="mt-3">
              {electricityLoading ? (
                <p className="text-sm text-muted">{t('common.loading')}</p>
              ) : (
                <LedgerList
                  rows={electricityLedger}
                  empty={t('account.utilNoElLedger')}
                  dateLocale={dateLocale}
                />
              )}
            </div>
          </div>
        </>
      )}

      {capitalEnabled && financeTab === 'capital' && (
        <div className="rounded-[14px] border border-border bg-surface shadow-card p-5 md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">{t('account.financeTabCapital')}</p>
            <p className="mt-1 text-sm text-secondary">{t('account.utilCapitalHint')}</p>
          </div>
          <BalanceBadge balance={Number(capitalBalance.balance_eur)} loading={capitalLoading} />
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className={`${compactKpiAlignClass} rounded-xl bg-background px-3 py-3`}>
            <div className="text-[11px] text-muted">{t('account.utilCharged')}</div>
            <div className="mt-1 text-lg font-semibold">{formatEur(Number(capitalBalance.charged_eur))}</div>
          </div>
          <div className={`${compactKpiAlignClass} rounded-xl bg-background px-3 py-3`}>
            <div className="text-[11px] text-muted">{t('account.utilPaid')}</div>
            <div className="mt-1 text-lg font-semibold">{formatEur(Number(capitalBalance.paid_eur))}</div>
          </div>
          <div className={`${compactKpiAlignClass} rounded-xl bg-background px-3 py-3`}>
            <div className="text-[11px] text-muted">{t('account.debt')}</div>
            <div className={`mt-1 text-lg font-semibold ${capitalBalance.balance_eur > 0 ? 'text-danger' : 'text-muted'}`}>
              {formatEur(Math.max(0, Number(capitalBalance.balance_eur)))}
            </div>
          </div>
          <div className={`${compactKpiAlignClass} rounded-xl bg-background px-3 py-3`}>
            <div className="text-[11px] text-muted">{t('account.overpay')}</div>
            <div className={`mt-1 text-lg font-semibold ${capitalBalance.balance_eur < 0 ? 'text-success' : 'text-muted'}`}>
              {formatEur(Math.max(0, -Number(capitalBalance.balance_eur)))}
            </div>
          </div>
        </div>

        <div className="mt-5">
          <p className="mb-2 text-[11px] uppercase tracking-wider text-muted">{t('account.utilAssessments')}</p>
          {capitalLoading ? (
            <p className="text-sm text-muted">{t('common.loading')}</p>
          ) : assessments.length === 0 ? (
            <p className="text-sm text-secondary">{t('account.utilNoCapital')}</p>
          ) : (
            <div className="space-y-2">
              {assessments.map((a) => (
                <div key={a.id} className="rounded-xl border border-border bg-background px-3 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">{a.title}</p>
                      {a.description ? <p className="mt-0.5 text-xs text-secondary">{a.description}</p> : null}
                      <p className="mt-1 text-xs text-muted">
                        {a.decision_date ? `${t('account.utilDecision')}: ${formatOwnerDate(a.decision_date, dateLocale)}` : ''}
                        {a.due_date ? ` · ${t('account.utilDue')}: ${formatOwnerDate(a.due_date, dateLocale)}` : ''}
                        {` · ${a.status}`}
                      </p>
                    </div>
                    {chargesByAssessment.has(a.id) ? (
                      <p className="text-sm font-semibold text-foreground">{formatEur(chargesByAssessment.get(a.id) ?? 0)}</p>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mt-5">
          <p className="mb-2 text-[11px] uppercase tracking-wider text-muted">{t('account.utilCapitalOps')}</p>
          {capitalLoading ? (
            <p className="text-sm text-muted">{t('common.loading')}</p>
          ) : (
            <LedgerList
              rows={capitalLedger}
              titles={assessmentTitles}
              empty={t('account.utilNoCapital')}
              dateLocale={dateLocale}
            />
          )}
        </div>
      </div>
      )}
    </div>
  );
}
