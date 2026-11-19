'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import type { ReactNode } from 'react';
import { useI18n } from '@/i18n/I18nProvider';
import { buildTariffsHref, parseRatesJson } from '@/lib/tariffs';
import {
  currentElectricityTariffViewFromCore,
  formatElectricityTariff,
  type CurrentElectricityTariffView,
  type ElectricityMode,
} from '@/lib/electricity';
import { formatEur, todayIsoDate } from '@/lib/utilities';
import {
  AdminMetricCard,
  AdminInlineAlert,
  adminCardClass,
  adminFieldClass,
  parseAdminUtilityTab,
  type AdminUtilityTab,
} from '@/components/admin/AdminUi';
import { SectionPanelTabs } from '@/components/ui/SectionPanelTabs';
import { AdminUtilityFinanceWorkplace } from '@/components/admin/AdminUtilityFinanceWorkplace';
import type { UtilityModuleTotals } from '@/lib/utilityFinanceRegister';

type PropertyOption = {
  id: number;
  apartment_number: string | number | null;
  section_code?: string | null;
  block_code?: string | null;
  owner_name: string | null;
};

function aptNumber(value: string | number | null | undefined) {
  return String(value ?? '');
}

const fieldClass = adminFieldClass;

function firstRow<T>(data: T[] | T | null | undefined): T | null {
  if (!data) return null;
  return Array.isArray(data) ? (data[0] ?? null) : data;
}

export function AdminElectricity({
  supabase,
  properties,
  canFinance,
  electricityMode,
  canChangeElectricityMode = false,
  onSaveElectricityMode,
  tab,
  onTabChange,
  focusPropertyId,
  onPropertyChange,
  meterPanel,
  readingsPanel,
  historyPanel,
}: {
  supabase: SupabaseClient<Database>;
  properties: PropertyOption[];
  canFinance: boolean;
  electricityMode?: ElectricityMode;
  canChangeElectricityMode?: boolean;
  onSaveElectricityMode?: (mode: ElectricityMode) => void;
  tab?: string | null;
  onTabChange?: (tab: AdminUtilityTab) => void;
  focusPropertyId?: number | '';
  onPropertyChange?: (id: number | '') => void;
  meterPanel?: ReactNode;
  readingsPanel?: ReactNode;
  historyPanel?: ReactNode;
}) {
  const { t, locale } = useI18n();
  const pathname = usePathname() || '/admin';
  const [showDebtorsSignal, setShowDebtorsSignal] = useState(0);
  const [tariff, setTariff] = useState<CurrentElectricityTariffView | null>(null);
  const [tariffLoading, setTariffLoading] = useState(false);
  const [moduleTotals, setModuleTotals] = useState<UtilityModuleTotals | null>(null);
  const [localTab, setLocalTab] = useState<AdminUtilityTab>('overview');

  const sorted = useMemo(
    () =>
      [...properties].sort((a, b) =>
        aptNumber(a.apartment_number).localeCompare(aptNumber(b.apartment_number), undefined, { numeric: true }),
      ),
    [properties],
  );

  const elTabs = useMemo(() => {
    const items: { id: AdminUtilityTab; label: string }[] = [
      { id: 'overview', label: t('admin.utilTabOverview') },
      { id: 'meter', label: t('admin.waterTabMeters') },
      { id: 'readings', label: t('admin.waterTabReadings') },
      { id: 'payments', label: t('admin.waterTabPayments') },
      { id: 'history', label: t('admin.waterTabHistory') },
    ];
    if (canFinance) items.push({ id: 'finance', label: t('admin.utilTabFinance') });
    return items;
  }, [t, canFinance]);

  const allowedTabs = useMemo(() => elTabs.map((item) => item.id), [elTabs]);
  const PANEL_TAB_IDS: readonly AdminUtilityTab[] = ['overview', 'meter', 'readings', 'payments', 'history'];
  const activeTab = onTabChange
    ? parseAdminUtilityTab(tab, allowedTabs)
    : parseAdminUtilityTab(localTab, allowedTabs);

  const panelTabs = useMemo(
    () =>
      elTabs
        .filter((item) => (PANEL_TAB_IDS as readonly string[]).includes(item.id))
        .map((item) => {
          const params =
            typeof window !== 'undefined'
              ? new URLSearchParams(window.location.search)
              : new URLSearchParams();
          params.set('section', 'электроэнергия');
          params.set('tab', item.id);
          params.delete('property');
          return {
            id: item.id,
            label: item.label,
            href: `/admin?${params.toString()}`,
          };
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rebuild when tab changes
    [elTabs, activeTab],
  );

  const loadTariffs = useCallback(async () => {
    setTariffLoading(true);
    const { data, error: qErr } = await supabase.rpc('get_applicable_utility_tariff', {
      p_tariff_key: 'electricity',
      p_on_date: todayIsoDate(),
    });
    setTariffLoading(false);
    if (qErr) {
      setTariff(null);
      return;
    }
    const row = firstRow(data) as Record<string, unknown> | null;
    setTariff(
      currentElectricityTariffViewFromCore(
        row
          ? {
              tariff_version_id: String(row.tariff_version_id ?? ''),
              valid_from: String(row.valid_from ?? ''),
              rates: parseRatesJson(row.rates),
            }
          : null,
      ),
    );
  }, [supabase]);

  useEffect(() => {
    void loadTariffs();
  }, [loadTariffs]);

  useEffect(() => {
    if (!onTabChange) {
      if (!allowedTabs.includes(localTab)) setLocalTab('overview');
      return;
    }
    if (tab && !allowedTabs.includes(tab as AdminUtilityTab)) onTabChange('overview');
  }, [onTabChange, tab, allowedTabs, localTab]);

  function selectTab(next: AdminUtilityTab) {
    onPropertyChange?.('');
    if (onTabChange) onTabChange(next);
    else setLocalTab(next);
  }

  const moduleDebtEur = moduleTotals ? Math.max(0, Number(moduleTotals.balanceEur) || 0) : 0;
  const moduleHasDebt = moduleDebtEur > 0;
  const moduleBalanceCard = {
    value:
      canFinance && moduleTotals
        ? formatEur(moduleDebtEur, locale)
        : canFinance
          ? t('common.loading')
          : '—',
    secondary: canFinance
      ? moduleTotals
        ? `${moduleHasDebt ? t('admin.balDebt') : t('account.noDebt')} · ${t('admin.utilRegBalanceComplex')}`
        : t('admin.utilRegBalanceComplexLoading')
      : t('admin.waterNoAccess'),
    alert: Boolean(canFinance && moduleTotals && moduleHasDebt),
  };

  const elModeLabel =
    electricityMode === 'staff_only' ? t('admin.elModeStaffOnly') : t('admin.elModeOwnerAndStaff');

  function electricityTariffHref() {
    const liveSearch =
      typeof window !== 'undefined' ? new URLSearchParams(window.location.search).toString() : '';
    return buildTariffsHref({
      tariffKey: 'electricity',
      tab: 'current',
      returnSearch: liveSearch,
      pathname,
    });
  }

  const dayTariffLabel = tariffLoading
    ? t('common.loading')
    : tariff
      ? formatElectricityTariff(Number(tariff.day_price_eur_per_kwh), locale)
      : '—';
  const nightTariffLabel = tariffLoading
    ? t('common.loading')
    : tariff
      ? formatElectricityTariff(Number(tariff.night_price_eur_per_kwh), locale)
      : '—';

  function renderOverviewCards() {
    return (
      <div className="grid grid-cols-1 items-stretch gap-3 sm:grid-cols-3">
        <div className={`${adminCardClass} flex h-full min-h-[5.5rem] w-full flex-col px-3 py-2.5 text-left`}>
          <span className="text-xs text-muted">{t('admin.electricityMode')}</span>
          <span className="mt-0.5 text-[11px] text-secondary">{t('admin.waterModeWho')}</span>
          {canChangeElectricityMode ? (
            <select
              className={`mt-2 ${fieldClass}`}
              value={electricityMode ?? 'owner_and_staff'}
              aria-label={t('admin.electricityMode')}
              onChange={(e) => onSaveElectricityMode?.(e.target.value as ElectricityMode)}
            >
              <option value="owner_and_staff">{t('admin.elModeOwnerAndStaff')}</option>
              <option value="staff_only">{t('admin.elModeStaffOnly')}</option>
            </select>
          ) : (
            <span className="mt-2 text-base font-semibold leading-tight text-foreground">{elModeLabel}</span>
          )}
        </div>
        <div className={`${adminCardClass} flex h-full min-h-[5.5rem] w-full flex-col px-3 py-2.5 text-left`}>
          <span className="text-xs text-muted">{t('admin.utilRegTariffsDayNight')}</span>
          {tariff ? (
            <>
              <div className="mt-1 flex flex-col gap-1">
                <Link
                  href={electricityTariffHref()}
                  className="w-fit text-xl font-semibold tabular-nums leading-none text-accent underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  <span className="text-xs font-normal text-muted">{t('account.elDay')}: </span>
                  {dayTariffLabel}
                </Link>
                <Link
                  href={electricityTariffHref()}
                  className="w-fit text-xl font-semibold tabular-nums leading-none text-accent underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  <span className="text-xs font-normal text-muted">{t('account.elNight')}: </span>
                  {nightTariffLabel}
                </Link>
              </div>
              <Link
                href={electricityTariffHref()}
                className="mt-1 w-fit text-xs font-medium text-accent underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                {t('admin.utilRegOpenTariff')}
              </Link>
            </>
          ) : (
            <>
              <span className="mt-1 text-xl font-semibold tabular-nums leading-none text-foreground">—</span>
              <span className="mt-1 text-xs text-secondary">{t('admin.noTariff')}</span>
            </>
          )}
        </div>
        <div className="h-full min-h-[5.5rem]">
          <AdminMetricCard
            label={t('admin.electricityBalance')}
            value={moduleBalanceCard.value}
            secondary={moduleBalanceCard.secondary}
            alert={moduleBalanceCard.alert}
            aria-label={t('admin.utilRegShowDebtors')}
            onClick={() => setShowDebtorsSignal((n) => n + 1)}
          />
        </div>
      </div>
    );
  }

  if (activeTab === 'finance') {
    if (!canFinance) {
      return (
        <AdminInlineAlert tone="warning">{t('admin.waterNoAccess')}</AdminInlineAlert>
      );
    }
    return (
      <AdminUtilityFinanceWorkplace
        service="electricity"
        supabase={supabase}
        properties={sorted}
        canOperate={canFinance}
        focusPropertyId={focusPropertyId ?? ''}
        onPropertyChange={(id) => onPropertyChange?.(id)}
        onModuleTotals={setModuleTotals}
        ledgerKinds={['payment', 'payment_reversal']}
        listPaymentAction
        urlFilterNs="ff"
      />
    );
  }

  const onOverview = activeTab === 'overview';

  return (
    <div className="space-y-3">
      <SectionPanelTabs
        aria-label={t('admin.electricityFinance')}
        value={activeTab}
        onChange={(id) => selectTab(id as AdminUtilityTab)}
        items={panelTabs}
      />

      {onOverview ? (
        <>
          {renderOverviewCards()}
          {canFinance ? (
            <AdminUtilityFinanceWorkplace
              service="electricity"
              supabase={supabase}
              properties={sorted}
              canOperate={canFinance}
              focusPropertyId=""
              onPropertyChange={(id) => onPropertyChange?.(id)}
              onModuleTotals={setModuleTotals}
              showDebtorsSignal={showDebtorsSignal}
            />
          ) : (
            <AdminInlineAlert tone="warning">{t('admin.waterNoAccess')}</AdminInlineAlert>
          )}
        </>
      ) : null}

      {activeTab === 'meter' ? meterPanel : null}
      {activeTab === 'readings' ? readingsPanel : null}
      {activeTab === 'payments' ? (
        canFinance ? (
          <AdminUtilityFinanceWorkplace
            service="electricity"
            supabase={supabase}
            properties={sorted}
            canOperate={canFinance}
            focusPropertyId={focusPropertyId ?? ''}
            onPropertyChange={(id) => onPropertyChange?.(id)}
            onModuleTotals={setModuleTotals}
            ledgerKinds={['payment', 'payment_reversal']}
            listPaymentAction
            urlFilterNs="uf"
          />
        ) : (
          <AdminInlineAlert tone="warning">{t('admin.waterNoAccess')}</AdminInlineAlert>
        )
      ) : null}
      {activeTab === 'history' ? historyPanel : null}
    </div>
  );
}