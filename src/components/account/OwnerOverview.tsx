'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { useI18n } from '@/i18n/I18nProvider';
import { isMissingRelation, isPollAcceptingVotes, type Poll, type PollVote } from '@/lib/polls';
import { isUpcomingMeeting, type GeneralMeeting, type MeetingDecision } from '@/lib/buildingDocuments';
import { displayElectricityMeterNumber, type ElectricityMeter } from '@/lib/electricity';
import type { FinanceTab, MeterTab } from '@/components/account/OwnerUtilities';
import { ApartmentPicker } from '@/components/ApartmentPicker';
import type { SupportFeeAssessment } from '@/lib/supportFeeAnnual';
import { formatEurAmount } from '@/lib/supportFeeAnnual';
import { formatOwnerDate } from '@/lib/ownerFormat';
import {
  balanceTone,
  emptyBalance,
  formatEur,
  formatM3,
  lastActiveReading,
  formatKwh,
  type UtilityBalance,
  type WaterMeter,
  type WaterReading,
} from '@/lib/utilities';

type OccupancyStatus = 'owner' | 'standby' | 'rented';

function firstBalance(data: UtilityBalance[] | UtilityBalance | null | undefined): UtilityBalance {
  const row = !data ? null : Array.isArray(data) ? data[0] ?? null : data;
  return row ? { ...emptyBalance(), ...row } : emptyBalance();
}

function statusLabel(balance: number, t: (key: 'account.utilStatusDebt' | 'account.utilStatusOver' | 'account.utilStatusSettled') => string) {
  const tone = balanceTone(balance);
  if (tone === 'debt') return t('account.utilStatusDebt');
  if (tone === 'over') return t('account.utilStatusOver');
  return t('account.utilStatusSettled');
}

function amountClass(balance: number) {
  if (balance > 0) return 'text-danger';
  if (balance < 0) return 'text-success';
  return 'text-foreground';
}

export function OwnerOverview({
  supabase,
  property,
  properties,
  onSelectProperty,
  waterEnabled,
  electricityEnabled,
  supportDebt,
  supportOver,
  supportAssessment,
  occupancyStatus,
  polls,
  pollVotes,
  openRequestsCount,
  unreadChatCount,
  electricLastDay,
  electricLastNight,
  electricLastDate,
  electricMeter,
  onOpenFinance,
  onOpenMeters,
  onOpenApartment,
  onOpenPolls,
  onOpenRequests,
  onOpenChat,
  onOpenDocuments,
}: {
  supabase: SupabaseClient<Database>;
  property: {
    id: number;
    apartment_number: string | number | null;
    area_sqm?: number | null;
    floor?: number | null;
  };
  properties: Array<{ id: number; apartment_number: string | number; area_sqm: number | null }>;
  onSelectProperty: (id: number) => void;
  waterEnabled: boolean;
  electricityEnabled: boolean;
  supportDebt: number;
  supportOver: number;
  supportAssessment: SupportFeeAssessment | null;
  occupancyStatus: OccupancyStatus;
  polls: Poll[];
  pollVotes: PollVote[];
  openRequestsCount: number;
  unreadChatCount: number;
  electricLastDay: number | null;
  electricLastNight: number | null;
  electricLastDate: string | null;
  electricMeter: ElectricityMeter | null;
  onOpenFinance: (tab: FinanceTab) => void;
  onOpenMeters: (tab: MeterTab) => void;
  onOpenApartment: () => void;
  onOpenPolls: () => void;
  onOpenRequests: () => void;
  onOpenChat: () => void;
  onOpenDocuments: () => void;
}) {
  const { t, dateLocale, locale } = useI18n();
  const [extrasLoading, setExtrasLoading] = useState(true);
  const [waterBalance, setWaterBalance] = useState<UtilityBalance>(emptyBalance());
  const [electricityBalance, setElectricityBalance] = useState<UtilityBalance>(emptyBalance());
  const [capitalBalance, setCapitalBalance] = useState<UtilityBalance>(emptyBalance());
  const [waterMeter, setWaterMeter] = useState<WaterMeter | null>(null);
  const [lastWater, setLastWater] = useState<WaterReading | null>(null);
  const [upcomingMeeting, setUpcomingMeeting] = useState<GeneralMeeting | null>(null);
  const [latestDecision, setLatestDecision] = useState<MeetingDecision | null>(null);

  const loadExtras = useCallback(async () => {
    setExtrasLoading(true);
    try {
      const jobs: Promise<unknown>[] = [
        Promise.resolve(supabase.rpc('get_capital_repair_balance', { p_property_id: property.id })).then((capRes) => {
          if (!capRes.error) setCapitalBalance(firstBalance(capRes.data as UtilityBalance[] | null));
          else setCapitalBalance(emptyBalance());
        }),
        Promise.resolve(supabase.from('general_meetings').select('*').order('meeting_date', { ascending: true })).then((res) => {
          if (res.error) {
            if (!isMissingRelation(res.error, 'general_meetings')) return;
            setUpcomingMeeting(null);
            return;
          }
          const rows = (res.data as GeneralMeeting[]) ?? [];
          setUpcomingMeeting(rows.find((m) => isUpcomingMeeting(m)) ?? null);
        }),
        Promise.resolve(
          supabase.from('general_meeting_decisions').select('*').eq('protocol_result', 'adopted').order('created_at', { ascending: false }).limit(1),
        ).then((res) => {
          if (res.error) {
            if (!isMissingRelation(res.error, 'general_meeting_decisions')) return;
            setLatestDecision(null);
            return;
          }
          setLatestDecision(((res.data as MeetingDecision[]) ?? [])[0] ?? null);
        }),
      ];
      if (waterEnabled) {
        jobs.push(
          (async () => {
            const [meterRes, readingsRes, waterBalRes] = await Promise.all([
              supabase
                .from('water_meters')
                .select('*')
                .eq('property_id', property.id)
                .is('retired_at', null)
                .maybeSingle(),
              supabase
                .from('water_readings')
                .select('*')
                .eq('property_id', property.id)
                .order('reading_date', { ascending: false })
                .order('created_at', { ascending: false })
                .limit(8),
              supabase.rpc('get_water_balance', { p_property_id: property.id }),
            ]);
            if (!meterRes.error) setWaterMeter((meterRes.data as WaterMeter | null) ?? null);
            else if (!isMissingRelation(meterRes.error, 'water_meters')) setWaterMeter(null);
            const readings = (readingsRes.data as WaterReading[] | null) ?? [];
            const scoped = meterRes.data
              ? readings.filter((r) => r.meter_id === (meterRes.data as WaterMeter).id)
              : readings;
            setLastWater(lastActiveReading(scoped));
            if (!waterBalRes.error) setWaterBalance(firstBalance(waterBalRes.data as UtilityBalance[] | null));
            else setWaterBalance(emptyBalance());
          })(),
        );
      } else {
        setWaterBalance(emptyBalance());
        setWaterMeter(null);
        setLastWater(null);
      }
      if (electricityEnabled) {
        jobs.push(
          Promise.resolve(supabase.rpc('get_electricity_balance', { p_property_id: property.id })).then((elRes) => {
            if (!elRes.error) setElectricityBalance(firstBalance(elRes.data as UtilityBalance[] | null));
            else setElectricityBalance(emptyBalance());
          }),
        );
      } else {
        setElectricityBalance(emptyBalance());
      }
      await Promise.all(jobs);
    } catch {
      setWaterBalance(emptyBalance());
      setElectricityBalance(emptyBalance());
      setCapitalBalance(emptyBalance());
      setWaterMeter(null);
      setLastWater(null);
    } finally {
      setExtrasLoading(false);
    }
  }, [property.id, supabase, waterEnabled, electricityEnabled]);

  useEffect(() => {
    void loadExtras();
  }, [loadExtras]);

  const supportNet = supportDebt > 0 ? supportDebt : supportOver > 0 ? -supportOver : 0;
  const waterDebt = Number(waterBalance.balance_eur);
  const electricityDebt = Number(electricityBalance.balance_eur);
  const capitalDebt = Number(capitalBalance.balance_eur);

  const activePolls = useMemo(() => polls.filter((p) => isPollAcceptingVotes(p)), [polls]);
  const unvotedPolls = useMemo(
    () =>
      activePolls.filter(
        (p) => !pollVotes.some((v) => v.poll_id === p.id && v.property_id === property.id),
      ),
    [activePolls, pollVotes, property.id],
  );

  const occupancyLabel =
    occupancyStatus === 'standby'
      ? t('account.away')
      : occupancyStatus === 'rented'
        ? t('account.tenants')
        : t('account.elByOwner');

  const heroMeta = [
    property.area_sqm != null ? `${Number(property.area_sqm).toFixed(1)} ${t('common.sqm')}` : null,
    property.floor != null ? t('account.floorN', { n: property.floor }) : null,
    occupancyLabel,
  ].filter(Boolean).join(' · ');

  const attention: Array<{ key: string; title: string; detail: string; onClick: () => void }> = [];
  if (supportDebt > 0) {
    attention.push({
      key: 'support',
      title: t('account.financeTabSupport'),
      detail: t('account.overviewDebt', { n: supportDebt.toFixed(2) }),
      onClick: () => onOpenFinance('support'),
    });
  }
  if (waterEnabled && waterDebt > 0) {
    attention.push({
      key: 'water',
      title: t('account.financeTabWater'),
      detail: t('account.overviewDebt', { n: waterDebt.toFixed(2) }),
      onClick: () => onOpenFinance('water'),
    });
  }
  if (electricityEnabled && electricityDebt > 0) {
    attention.push({
      key: 'electricity',
      title: t('account.financeTabElectricity'),
      detail: t('account.overviewDebt', { n: electricityDebt.toFixed(2) }),
      onClick: () => onOpenFinance('electricity'),
    });
  }
  if (capitalDebt > 0) {
    attention.push({
      key: 'capital',
      title: t('account.financeTabCapital'),
      detail: t('account.overviewDebt', { n: capitalDebt.toFixed(2) }),
      onClick: () => onOpenFinance('capital'),
    });
  }
  if (waterEnabled && !extrasLoading && !waterMeter) {
    attention.push({
      key: 'no-water-meter',
      title: t('account.meterTabWater'),
      detail: t('account.utilNoMeter'),
      onClick: () => onOpenMeters('water'),
    });
  }
  if (electricityEnabled && !electricMeter) {
    attention.push({
      key: 'no-el-meter',
      title: t('account.meterTabElectricity'),
      detail: t('account.elNoMeter'),
      onClick: () => onOpenMeters('electricity'),
    });
  }
  for (const poll of unvotedPolls.slice(0, 3)) {
    attention.push({
      key: `poll-${poll.id}`,
      title: poll.title?.trim() || t('account.polls'),
      detail: t('account.pollNotVoted'),
      onClick: onOpenPolls,
    });
  }
  if (openRequestsCount > 0) {
    attention.push({
      key: 'requests',
      title: t('account.requests'),
      detail: t('account.openRequests') + `: ${openRequestsCount}`,
      onClick: onOpenRequests,
    });
  }
  if (unreadChatCount > 0) {
    attention.push({
      key: 'chat',
      title: t('account.chat'),
      detail: t('account.overviewUnreadChat', { n: String(unreadChatCount) }),
      onClick: onOpenChat,
    });
  }
  if (upcomingMeeting) {
    attention.push({
      key: 'meeting',
      title: t('docs.attentionMeeting'),
      detail: formatOwnerDate(upcomingMeeting.meeting_date, dateLocale),
      onClick: onOpenDocuments,
    });
  }

  const financeCount = 2 + (waterEnabled ? 1 : 0) + (electricityEnabled ? 1 : 0);
  const financeCols =
    financeCount >= 4 ? 'sm:grid-cols-2 lg:grid-cols-4' : financeCount === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2';
  const meterCount = (waterEnabled ? 1 : 0) + (electricityEnabled ? 1 : 0);
  const kpiGrid = 'grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4';
  const kpiBtn =
    'group flex w-full min-h-[6.5rem] flex-col items-center justify-center rounded-xl border border-border bg-surface px-3 py-3 text-center transition hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40';
  const secondaryBtn =
    'group flex w-full items-center gap-3 rounded-xl px-1 py-2 text-left transition hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40';

  return (
    <div className="space-y-3 md:space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted">{t('account.overview')}</p>
          <h2 className="mt-0.5 text-xl font-semibold tracking-tight text-foreground md:text-2xl">
            {t('account.overviewAptTitle', { n: String(property.apartment_number ?? '—') })}
          </h2>
          <p className="mt-0.5 text-sm text-secondary">{heroMeta}</p>
        </div>
        <button
          type="button"
          onClick={onOpenApartment}
          className="hidden shrink-0 items-center gap-1 rounded-full border border-border px-3 py-1.5 text-sm text-secondary transition hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 md:inline-flex"
        >
          {t('account.overviewOpenApt')}
          <span aria-hidden>→</span>
        </button>
      </header>

      {properties.length > 1 && (
        <div className="-mt-1">
          <ApartmentPicker
            properties={properties}
            selectedId={property.id}
            onSelect={onSelectProperty}
          />
        </div>
      )}

      {attention.length > 0 ? (
        <section className="overflow-hidden rounded-xl border border-border bg-background">
          <p className="px-3 pt-2 text-[10px] font-medium uppercase tracking-[0.16em] text-muted">
            {t('account.needsAttention')}
          </p>
          <div className="divide-y divide-border">
            {attention.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={item.onClick}
                className="flex w-full items-center gap-3 px-3 py-2 text-left transition hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40"
              >
                <span className="w-0.5 shrink-0 self-stretch rounded-full bg-warning" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-foreground">{item.title}</span>
                  <span className="block text-xs text-warning">{item.detail}</span>
                </span>
                <span className="shrink-0 text-muted" aria-hidden>→</span>
              </button>
            ))}
          </div>
        </section>
      ) : (
        <p className="text-xs text-secondary">✓ {t('account.overviewOk')}</p>
      )}

      {(upcomingMeeting || latestDecision) ? (
        <section className="overflow-hidden rounded-xl border border-border bg-background">
          <p className="px-3 pt-2 text-[10px] font-medium uppercase tracking-[0.16em] text-muted">
            {t('docs.overviewTitle')}
          </p>
          {upcomingMeeting ? (
            <button
              type="button"
              onClick={onOpenDocuments}
              className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-hover"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-foreground">{t('docs.overviewUpcoming')}</span>
                <span className="block text-xs text-secondary">
                  {formatOwnerDate(upcomingMeeting.meeting_date, dateLocale)}
                  {upcomingMeeting.meeting_time ? ` · ${upcomingMeeting.meeting_time.slice(0, 5)}` : ''}
                </span>
              </span>
              <span className="text-muted">→</span>
            </button>
          ) : null}
          {latestDecision ? (
            <button
              type="button"
              onClick={onOpenDocuments}
              className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-hover"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-foreground">{t('docs.overviewLastDecision')}</span>
                <span className="block text-xs text-secondary">{latestDecision.title}</span>
              </span>
              <span className="text-muted">→</span>
            </button>
          ) : null}
        </section>
      ) : null}

      <section>
        <p className="mb-1.5 text-[10px] font-medium uppercase tracking-[0.16em] text-muted">{t('account.finance')}</p>
        <div className={financeCount >= 4 ? kpiGrid : `grid gap-2 ${financeCols}`}>
          <button type="button" onClick={() => onOpenFinance('support')} className={kpiBtn}>
            <p className="text-[10px] uppercase tracking-wider text-muted">{t('account.financeTabSupport')}</p>
            <p className={`mt-0.5 text-xl font-semibold tabular-nums md:text-2xl ${amountClass(supportNet)}`}>
              {formatEur(Math.abs(supportNet))}
            </p>
            <p className="mt-0.5 text-xs text-secondary">{statusLabel(supportNet, t)}</p>
            {supportAssessment ? (
              <p className="mt-1 text-[11px] text-muted">
                {t('account.supportFee')} {supportAssessment.billing_year}
                {Number(supportAssessment.remaining_due) > 0
                  ? ` · ${t('account.sfDue')} ${formatEurAmount(supportAssessment.remaining_due)}`
                  : supportAssessment.pricing_rule === 'early_full_payment'
                    ? ` · ${t('account.paid')} · ${t('account.sfDiscountPct', { n: Number(supportAssessment.discount_percent) })}`
                    : ` · ${t('account.paid')}`}
                {' · '}
                {t('account.sfMore')}
              </p>
            ) : null}
          </button>
          {waterEnabled && (
            <button type="button" onClick={() => onOpenFinance('water')} className={kpiBtn}>
              <p className="text-[10px] uppercase tracking-wider text-muted">{t('account.financeTabWater')}</p>
              <p className={`mt-0.5 text-xl font-semibold tabular-nums md:text-2xl ${amountClass(waterDebt)}`}>
                {extrasLoading ? t('common.loading') : formatEur(Math.abs(waterDebt))}
              </p>
              <p className="mt-0.5 text-xs text-secondary">{extrasLoading ? '—' : statusLabel(waterDebt, t)}</p>
            </button>
          )}
          {electricityEnabled && (
            <button type="button" onClick={() => onOpenFinance('electricity')} className={kpiBtn}>
              <p className="text-[10px] uppercase tracking-wider text-muted">{t('account.financeTabElectricity')}</p>
              <p className={`mt-0.5 text-xl font-semibold tabular-nums md:text-2xl ${amountClass(electricityDebt)}`}>
                {extrasLoading ? t('common.loading') : formatEur(Math.abs(electricityDebt))}
              </p>
              <p className="mt-0.5 text-xs text-secondary">{extrasLoading ? '—' : statusLabel(electricityDebt, t)}</p>
            </button>
          )}
          <button type="button" onClick={() => onOpenFinance('capital')} className={kpiBtn}>
            <p className="text-[10px] uppercase tracking-wider text-muted">{t('account.financeTabCapital')}</p>
            <p className={`mt-0.5 text-xl font-semibold tabular-nums md:text-2xl ${amountClass(capitalDebt)}`}>
              {extrasLoading ? t('common.loading') : formatEur(Math.abs(capitalDebt))}
            </p>
            <p className="mt-0.5 text-xs text-secondary">{extrasLoading ? '—' : statusLabel(capitalDebt, t)}</p>
          </button>
        </div>
      </section>

      {meterCount > 0 && (
        <section>
          <p className="mb-1.5 text-[10px] font-medium uppercase tracking-[0.16em] text-muted">{t('account.meters')}</p>
          <div className={kpiGrid}>
            {waterEnabled && (
              <button type="button" onClick={() => onOpenMeters('water')} className={kpiBtn}>
                <p className="text-[10px] uppercase tracking-wider text-muted">{t('account.meterTabWater')}</p>
                {extrasLoading ? (
                  <p className="mt-0.5 text-sm text-muted">{t('common.loading')}</p>
                ) : !waterMeter ? (
                  <p className="mt-0.5 text-sm text-secondary">{t('account.meterUnassigned')}</p>
                ) : (
                  <>
                    <p className="mt-0.5 text-xl font-semibold tabular-nums text-foreground md:text-2xl">
                      {lastWater ? `${formatM3(Number(lastWater.current_value), locale)} ${t('account.m3')}` : '—'}
                    </p>
                    {lastWater ? (
                      <p className="mt-0.5 text-xs text-secondary">{formatOwnerDate(lastWater.reading_date, dateLocale)}</p>
                    ) : null}
                    <p className="mt-0.5 text-[11px] text-muted">{waterMeter.meter_number}</p>
                  </>
                )}
              </button>
            )}
            {electricityEnabled && (
              <button type="button" onClick={() => onOpenMeters('electricity')} className={kpiBtn}>
                <p className="text-[10px] uppercase tracking-wider text-muted">{t('account.meterTabElectricity')}</p>
                {!electricMeter ? (
                  <p className="mt-0.5 text-sm text-secondary">{t('account.meterUnassigned')}</p>
                ) : (
                  <>
                    <p className="mt-0.5 text-sm font-semibold tabular-nums leading-snug text-foreground">
                      <span className="block">
                        {t('account.elDayShort')}{' '}
                        {electricLastDay != null ? `${formatKwh(electricLastDay, locale)} ${t('account.kwh')}` : '—'}
                      </span>
                      <span className="block">
                        {t('account.elNightShort')}{' '}
                        {electricLastNight != null ? `${formatKwh(electricLastNight, locale)} ${t('account.kwh')}` : '—'}
                      </span>
                    </p>
                    {electricLastDate ? (
                      <p className="mt-0.5 text-xs text-secondary">{formatOwnerDate(electricLastDate, dateLocale)}</p>
                    ) : null}
                    <p className="mt-0.5 text-[11px] text-muted">{displayElectricityMeterNumber(electricMeter.meter_number)}</p>
                  </>
                )}
              </button>
            )}
          </div>
        </section>
      )}

      <section className="grid gap-1 border-t border-border pt-2 sm:grid-cols-2">
        <button type="button" onClick={onOpenPolls} className={secondaryBtn}>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-foreground">{t('account.overviewPolls')}</span>
            <span className="block text-xs text-secondary">
              {activePolls.length === 0
                ? t('account.noActivePolls')
                : `${t('account.pollsActive', { n: String(activePolls.length) })} · ${t('account.pollsNeedVote', { n: String(unvotedPolls.length) })}`}
            </span>
          </span>
          <span className="text-muted" aria-hidden>→</span>
        </button>
        <button type="button" onClick={onOpenApartment} className={`${secondaryBtn} md:hidden`}>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-foreground">{t('account.apt')}</span>
            <span className="block text-xs text-secondary">{t('account.aptDetailsHint')}</span>
          </span>
          <span className="text-muted" aria-hidden>→</span>
        </button>
      </section>
    </div>
  );
}
