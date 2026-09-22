'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { useI18n } from '@/i18n/I18nProvider';
import { isMissingRelation } from '@/lib/polls';
import {
  balanceTone,
  emptyBalance,
  formatEur,
  formatM3,
  lastActiveReading,
  mapSubmitWaterError,
  todayIsoDate,
  type CapitalAssessment,
  type CapitalLedger,
  type UtilityBalance,
  type WaterLedger,
  type WaterMeter,
  type WaterReading,
  type WaterSubmitResult,
  type WaterTariff,
} from '@/lib/utilities';

type Variant = 'finance' | 'meters';
export type FinanceTab = 'support' | 'water' | 'capital';

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
              {new Date(row.created_at).toLocaleDateString(dateLocale)}
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
}: {
  supabase: SupabaseClient<Database>;
  propertyId: number;
  variant: Variant;
  currentTariff?: WaterTariff | null;
  financeTab?: FinanceTab;
  onSelectFinanceTab?: (tab: FinanceTab) => void;
  supportDebt?: number;
  supportOver?: number;
}) {
  const { t, dateLocale } = useI18n();
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
  const [capitalLedger, setCapitalLedger] = useState<CapitalLedger[]>([]);
  const [assessments, setAssessments] = useState<CapitalAssessment[]>([]);
  const [capitalBalance, setCapitalBalance] = useState<UtilityBalance>(emptyBalance());

  const [currentValue, setCurrentValue] = useState('');
  const [readingDate, setReadingDate] = useState(todayIsoDate());
  const idempotencyKeyRef = useRef<string | null>(null);

  const lastActive = useMemo(() => lastActiveReading(readings), [readings]);
  const previousDisplay = lastActive ? Number(lastActive.current_value) : Number(meter?.initial_reading ?? 0);
  const previousIsInitial = !lastActive && Boolean(meter);
  const today = todayIsoDate();

  const loadWater = useCallback(async () => {
    setWaterLoading(true);
    try {
      const [meterRes, tariffRes, readingsRes, ledgerRes, balRes] = await Promise.all([
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
        supabase.rpc('get_water_balance', { p_property_id: propertyId }),
      ]);

      if (meterRes.error && !isMissingRelation(meterRes.error, 'water_meters')) throw meterRes.error;
      setMeter((meterRes.data as WaterMeter | null) ?? null);

      if (tariffRes.error && !isMissingRelation(tariffRes.error, 'water_tariffs')) throw tariffRes.error;
      setTariff(((tariffRes.data as WaterTariff[] | null) ?? [])[0] ?? null);

      if (readingsRes.error && !isMissingRelation(readingsRes.error, 'water_readings')) throw readingsRes.error;
      setReadings((readingsRes.data as WaterReading[] | null) ?? []);

      if (ledgerRes.error && !isMissingRelation(ledgerRes.error, 'water_ledger')) throw ledgerRes.error;
      setWaterLedger((ledgerRes.data as WaterLedger[] | null) ?? []);

      if (balRes.error && !isMissingRelation(balRes.error, 'get_water_balance')) throw balRes.error;
      const row = ((balRes.data as UtilityBalance[] | null) ?? [])[0];
      setWaterBalance(row ? { ...emptyBalance(), ...row } : emptyBalance());
    } catch (err) {
      if (process.env.NODE_ENV !== 'production') console.error(err);
      setMeter(null);
      setReadings([]);
      setWaterLedger([]);
      setWaterBalance(emptyBalance());
    } finally {
      setWaterLoading(false);
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

  useEffect(() => {
    void loadWater();
    if (variant === 'finance') void loadCapital();
    setCurrentValue('');
    setReadingDate(todayIsoDate());
    setSubmitError(null);
    setSuccess(null);
    idempotencyKeyRef.current = null;
  }, [loadWater, loadCapital, variant, propertyId]);

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

    const parsed = Number(String(currentValue).replace(',', '.'));
    if (!Number.isFinite(parsed)) {
      setSubmitError(t('account.utilNeedNumber'));
      return;
    }
    const normalized = Number(parsed.toFixed(3));
    if (normalized < previousDisplay) {
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
            <p className="mt-1 text-sm text-secondary">
              {t('account.utilMeterNo')}: <span className="font-medium text-foreground">{meter.meter_number}</span>
            </p>
          ) : (
            <p className="mt-2 text-sm text-secondary">{t('account.utilNoMeter')}</p>
          )}
        </div>
        <BalanceBadge balance={Number(waterBalance.balance_eur)} loading={waterLoading} />
      </div>

      {meter && !waterLoading && (
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-xl bg-background px-3 py-3">
            <div className="text-[11px] text-muted">
              {previousIsInitial ? t('account.utilInitial') : t('account.utilLastReading')}
            </div>
            <div className="mt-1 text-lg font-semibold text-foreground">{formatM3(previousDisplay)} {t('account.m3')}</div>
            <div className="mt-0.5 text-[11px] text-muted">
              {lastActive
                ? new Date(lastActive.reading_date).toLocaleDateString(dateLocale)
                : t('account.utilInitialHint')}
            </div>
          </div>
          <div className="rounded-xl bg-background px-3 py-3">
            <div className="text-[11px] text-muted">{t('account.utilTariff')}</div>
            <div className="mt-1 text-lg font-semibold text-foreground">
              {tariff ? Number(tariff.price_eur_per_m3).toFixed(2) : '—'}
            </div>
            <div className="mt-0.5 text-[11px] text-muted">{t('account.perM3')}</div>
          </div>
          <div className="rounded-xl bg-background px-3 py-3">
            <div className="text-[11px] text-muted">{t('account.debt')}</div>
            <div className={`mt-1 text-lg font-semibold ${waterBalance.balance_eur > 0 ? 'text-danger' : 'text-muted'}`}>
              {formatEur(Math.max(0, Number(waterBalance.balance_eur)))}
            </div>
          </div>
          <div className="rounded-xl bg-background px-3 py-3">
            <div className="text-[11px] text-muted">{t('account.overpay')}</div>
            <div className={`mt-1 text-lg font-semibold ${waterBalance.balance_eur < 0 ? 'text-success' : 'text-muted'}`}>
              {formatEur(Math.max(0, -Number(waterBalance.balance_eur)))}
            </div>
          </div>
        </div>
      )}

      {meter && variant === 'meters' && (
        <form onSubmit={handleSubmit} className="mt-5 space-y-3">
          <p className="text-sm font-medium text-foreground">{t('account.utilSubmitTitle')}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm text-secondary">
              {t('account.utilCurrentM3')}
              <input
                type="number"
                inputMode="decimal"
                step="0.001"
                min={previousDisplay}
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
                  {t('account.consumption')} {formatM3(Number(success.consumption_m3))} {t('account.m3')}
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
                </tr>
              </thead>
              <tbody>
                {readings.map((row) => {
                  const reversed = row.status === 'reversed';
                  return (
                    <tr key={row.id} className={reversed ? 'text-muted' : 'text-secondary'}>
                      <td className="whitespace-nowrap px-2 py-1.5">
                        {new Date(row.reading_date).toLocaleDateString(dateLocale)}
                        {reversed ? ` · ${t('account.utilReversed')}` : ''}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5">{formatM3(Number(row.previous_value))}</td>
                      <td className="whitespace-nowrap px-2 py-1.5">{formatM3(Number(row.current_value))}</td>
                      <td className="whitespace-nowrap px-2 py-1.5">{formatM3(Number(row.consumption_m3))}</td>
                      <td className="whitespace-nowrap px-2 py-1.5">{Number(row.tariff_eur_per_m3).toFixed(4)}</td>
                      <td className="whitespace-nowrap px-2 py-1.5">{formatEur(Number(row.charge_amount_eur))}</td>
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
    return waterCard;
  }

  const cardBtn =
    'rounded-[14px] border bg-surface px-4 py-4 text-left shadow-card transition';
  const cardActive = 'border-accent/30 bg-accent-bg';
  const cardIdle = 'border-border hover:bg-hover';

  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-3">
        <button
          type="button"
          onClick={() => onSelectFinanceTab?.('support')}
          className={`${cardBtn} ${financeTab === 'support' ? cardActive : cardIdle}`}
        >
          <p className="text-[11px] uppercase tracking-wider text-muted">{t('account.financeTabSupport')}</p>
          <div className="mt-1 text-2xl font-semibold tracking-tight text-foreground">
            {formatEur(supportDebt > 0 ? supportDebt : supportOver)}
          </div>
          <p className="mt-1 text-xs text-secondary">
            {supportDebt > 0 ? t('account.hasDebt') : supportOver > 0 ? t('account.hasOver') : t('account.noDebt')}
          </p>
        </button>
        <button
          type="button"
          onClick={() => onSelectFinanceTab?.('water')}
          className={`${cardBtn} ${financeTab === 'water' ? cardActive : cardIdle}`}
        >
          <p className="text-[11px] uppercase tracking-wider text-muted">{t('account.financeTabWater')}</p>
          <BalanceBadge balance={Number(waterBalance.balance_eur)} loading={waterLoading} />
        </button>
        <button
          type="button"
          onClick={() => onSelectFinanceTab?.('capital')}
          className={`${cardBtn} ${financeTab === 'capital' ? cardActive : cardIdle}`}
        >
          <p className="text-[11px] uppercase tracking-wider text-muted">{t('account.financeTabCapital')}</p>
          <BalanceBadge balance={Number(capitalBalance.balance_eur)} loading={capitalLoading} />
        </button>
      </div>

      {financeTab === 'water' && (
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
              <div className="rounded-xl bg-background px-3 py-3">
                <div className="text-[11px] text-muted">{t('account.utilCharged')}</div>
                <div className="mt-1 text-lg font-semibold">{formatEur(Number(waterBalance.charged_eur))}</div>
              </div>
              <div className="rounded-xl bg-background px-3 py-3">
                <div className="text-[11px] text-muted">{t('account.utilPaid')}</div>
                <div className="mt-1 text-lg font-semibold">{formatEur(Number(waterBalance.paid_eur))}</div>
              </div>
              <div className="rounded-xl bg-background px-3 py-3">
                <div className="text-[11px] text-muted">{t('account.debt')}</div>
                <div className={`mt-1 text-lg font-semibold ${waterBalance.balance_eur > 0 ? 'text-danger' : 'text-muted'}`}>
                  {formatEur(Math.max(0, Number(waterBalance.balance_eur)))}
                </div>
              </div>
              <div className="rounded-xl bg-background px-3 py-3">
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
                          {new Date(row.reading_date).toLocaleDateString(dateLocale)}
                          {row.status === 'reversed' ? ` · ${t('account.utilReversed')}` : ''}
                        </td>
                        <td className="whitespace-nowrap px-2 py-1.5">{formatM3(Number(row.consumption_m3))} {t('account.m3')}</td>
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

      {financeTab === 'capital' && (
        <div className="rounded-[14px] border border-border bg-surface shadow-card p-5 md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">{t('account.financeTabCapital')}</p>
            <p className="mt-1 text-sm text-secondary">{t('account.utilCapitalHint')}</p>
          </div>
          <BalanceBadge balance={Number(capitalBalance.balance_eur)} loading={capitalLoading} />
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-xl bg-background px-3 py-3">
            <div className="text-[11px] text-muted">{t('account.utilCharged')}</div>
            <div className="mt-1 text-lg font-semibold">{formatEur(Number(capitalBalance.charged_eur))}</div>
          </div>
          <div className="rounded-xl bg-background px-3 py-3">
            <div className="text-[11px] text-muted">{t('account.utilPaid')}</div>
            <div className="mt-1 text-lg font-semibold">{formatEur(Number(capitalBalance.paid_eur))}</div>
          </div>
          <div className="rounded-xl bg-background px-3 py-3">
            <div className="text-[11px] text-muted">{t('account.debt')}</div>
            <div className={`mt-1 text-lg font-semibold ${capitalBalance.balance_eur > 0 ? 'text-danger' : 'text-muted'}`}>
              {formatEur(Math.max(0, Number(capitalBalance.balance_eur)))}
            </div>
          </div>
          <div className="rounded-xl bg-background px-3 py-3">
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
                        {a.decision_date ? `${t('account.utilDecision')}: ${new Date(a.decision_date).toLocaleDateString(dateLocale)}` : ''}
                        {a.due_date ? ` · ${t('account.utilDue')}: ${new Date(a.due_date).toLocaleDateString(dateLocale)}` : ''}
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
