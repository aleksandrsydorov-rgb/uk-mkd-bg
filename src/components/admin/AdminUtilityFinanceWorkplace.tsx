'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { useI18n } from '@/i18n/I18nProvider';
import { labelLedgerKind } from '@/i18n/labels';
import { formatOwnerDate } from '@/lib/ownerFormat';
import { isMissingRelation } from '@/lib/polls';
import {
  balanceTone,
  emptyBalance,
  formatEur,
  formatKwh,
  formatM3,
  type UtilityBalance,
} from '@/lib/utilities';
import { toUserFacingMessage } from '@/lib/userFacingError';
import {
  aggregateUtilityBalances,
  balanceRpcForService,
  buildUtilityFinanceRegisterRows,
  ledgerTableForService,
  paymentRpcForService,
  receiptModuleForService,
  sumModuleTotalsFromRegisterRows,
  type UtilityFinanceRegisterRow,
  type UtilityFinanceService,
  type UtilityLedgerAggRow,
  type UtilityModuleTotals,
} from '@/lib/utilityFinanceRegister';
import {
  EMPTY_UTILITY_MODULE_FILTERS,
  buildElectricityRegisterRows,
  buildInternetRegisterRows,
  buildWaterRegisterRows,
  filterUtilityModuleRows,
  formatSectionBlock,
  indexInternetSubs,
  listSectionsFromProperties,
  pickLatestElectricitySnaps,
  pickLatestWaterSnaps,
  sortUtilityModuleRows,
  utilityModuleFiltersActive,
  type ElectricityRegisterRow,
  type InternetRegisterRow,
  type UtilityModuleRegisterFilters,
  type WaterRegisterRow,
} from '@/lib/utilityModuleRegister';
import {
  AdminEmptyState,
  AdminInlineAlert,
  AdminMetricCard,
  AdminPrimaryButton,
  AdminSecondaryButton,
  AdminTableShell,
  adminCardClass,
  adminFieldClass,
  adminTableCellClass,
  adminTableHeadRowClass,
  adminTableRowClass,
} from '@/components/admin/AdminUi';
import {
  emptyReceiptPayFields,
  PaymentReceiptPayFields,
  type PaymentReceiptPayFieldValues,
} from '@/components/paymentReceipts/PaymentReceiptPayFields';
import { PaymentSuccessBanner } from '@/components/paymentReceipts/PaymentReceiptActions';
import { LedgerPaymentReceiptCell } from '@/components/paymentReceipts/LedgerPaymentReceiptCell';
import {
  finishReceiptForPayment,
  ledgerIdFromPaymentRpc,
  prepareReceiptIntentFromFields,
} from '@/lib/paymentReceipts/afterPayment';
import type { PaymentReceiptRow } from '@/lib/paymentReceipts/types';
import { PropertyIdentityLink } from '@/components/admin/PropertyIdentityLink';
import { formatPropertyIdentity } from '@/lib/propertyIdentity';

type PropertyOption = {
  id: number;
  apartment_number: string | number | null;
  section_code?: string | null;
  block_code?: string | null;
  owner_name: string | null;
};

type LedgerRow = {
  id: string | number;
  kind: string;
  amount_eur: number | string | null;
  note: string | null;
  created_at: string;
};

const fieldClass = adminFieldClass;
const cardClass = `${adminCardClass} p-4 md:p-5`;

function firstRow<T>(data: T[] | T | null | undefined): T | null {
  if (!data) return null;
  return Array.isArray(data) ? (data[0] ?? null) : data;
}

function serviceTitleKey(service: UtilityFinanceService) {
  if (service === 'water') return 'admin.water';
  if (service === 'electricity') return 'admin.electricityFinance';
  return 'admin.internet';
}

function registerTitleKey(service: UtilityFinanceService) {
  if (service === 'water') return 'admin.utilRegWaterTitle';
  if (service === 'electricity') return 'admin.utilRegElectricityTitle';
  return 'admin.utilRegInternetTitle';
}

function connectionStatusLabel(status: string, t: (k: string) => string) {
  const s = String(status ?? '').toLowerCase();
  if (s === 'active') return t('admin.internetStatusActive');
  if (s === 'inactive' || s === 'disabled' || s === 'disconnected') {
    return t('admin.internetStatusInactive');
  }
  if (s === 'pending_enable' || s === 'pending_on') return t('admin.internetPendingEnable');
  if (s === 'pending_disable' || s === 'pending_off') return t('admin.internetPendingDisable');
  if (s === 'none' || !s) return t('admin.internetStatusNone');
  return status;
}

export function AdminUtilityFinanceWorkplace({
  service,
  supabase,
  properties,
  canOperate,
  focusPropertyId,
  onPropertyChange,
  extraCardActions,
  onModuleTotals,
}: {
  service: UtilityFinanceService;
  supabase: SupabaseClient<Database>;
  properties: PropertyOption[];
  canOperate: boolean;
  focusPropertyId?: number | '';
  onPropertyChange?: (id: number | '') => void;
  /** Optional service-specific actions below the payment form (e.g. internet period charge). */
  extraCardActions?: React.ReactNode;
  /** Module-wide totals from the same ledger aggregate as the register (not one apartment). */
  onModuleTotals?: (totals: UtilityModuleTotals | null) => void;
}) {
  const { t, locale } = useI18n();
  const [view, setView] = useState<'register' | 'card'>('register');
  const [propertyId, setPropertyId] = useState<number | ''>(
    focusPropertyId != null && focusPropertyId !== '' ? focusPropertyId : '',
  );
  const [filters, setFilters] = useState<UtilityModuleRegisterFilters>(() => {
    if (typeof window === 'undefined') return EMPTY_UTILITY_MODULE_FILTERS;
    const params = new URLSearchParams(window.location.search);
    const query = (params.get('q') ?? '').trim();
    const statusRaw = params.get('ufStatus') ?? 'all';
    const status: UtilityModuleRegisterFilters['status'] =
      statusRaw === 'debt' || statusRaw === 'credit' || statusRaw === 'settled' ? statusRaw : 'all';
    const section = (params.get('ufSection') ?? '').trim();
    const periodYm = (params.get('ufPeriod') ?? '').trim();
    const connection = (params.get('ufConn') ?? '').trim();
    const sortRaw = params.get('ufSort') ?? 'apartment';
    const sort: UtilityModuleRegisterFilters['sort'] =
      sortRaw === 'balance_desc' ||
      sortRaw === 'balance_asc' ||
      sortRaw === 'section' ||
      sortRaw === 'apartment'
        ? sortRaw
        : 'apartment';
    return { query, status, section, periodYm, connection, sort };
  });
  /** Only push filter edits to the URL — never wipe return/deep-link q on remount. */
  const userFilterEditRef = useRef(false);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  function readUtilityFiltersFromLocation(): UtilityModuleRegisterFilters {
    const params = new URLSearchParams(window.location.search);
    const query = (params.get('q') ?? '').trim();
    const statusRaw = params.get('ufStatus') ?? 'all';
    const status: UtilityModuleRegisterFilters['status'] =
      statusRaw === 'debt' || statusRaw === 'credit' || statusRaw === 'settled' ? statusRaw : 'all';
    const section = (params.get('ufSection') ?? '').trim();
    const periodYm = (params.get('ufPeriod') ?? '').trim();
    const connection = (params.get('ufConn') ?? '').trim();
    const sortRaw = params.get('ufSort') ?? 'apartment';
    const sort: UtilityModuleRegisterFilters['sort'] =
      sortRaw === 'balance_desc' ||
      sortRaw === 'balance_asc' ||
      sortRaw === 'section' ||
      sortRaw === 'apartment'
        ? sortRaw
        : 'apartment';
    return { query, status, section, periodYm, connection, sort };
  }

  // Re-hydrate after apartment-card «return» / Back-Forward without wiping typed filters.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const syncFromUrl = () => {
      if (userFilterEditRef.current) return;
      const next = readUtilityFiltersFromLocation();
      setFilters((prev) =>
        prev.query === next.query &&
        prev.status === next.status &&
        prev.section === next.section &&
        prev.periodYm === next.periodYm &&
        prev.connection === next.connection &&
        prev.sort === next.sort
          ? prev
          : next,
      );
    };
    window.addEventListener('popstate', syncFromUrl);
    const poll = window.setInterval(() => {
      if (userFilterEditRef.current) return;
      const next = readUtilityFiltersFromLocation();
      const cur = filtersRef.current;
      if (
        cur.query === next.query &&
        cur.status === next.status &&
        cur.section === next.section &&
        cur.periodYm === next.periodYm &&
        cur.connection === next.connection &&
        cur.sort === next.sort
      ) {
        return;
      }
      if (
        !next.query &&
        next.status === 'all' &&
        !next.section &&
        !next.periodYm &&
        !next.connection &&
        next.sort === 'apartment'
      ) {
        return;
      }
      setFilters(next);
    }, 400);
    return () => {
      window.removeEventListener('popstate', syncFromUrl);
      window.clearInterval(poll);
    };
  }, []);

  useEffect(() => {
    if (!userFilterEditRef.current || typeof window === 'undefined') return;
    if (view !== 'register') return;
    const params = new URLSearchParams(window.location.search);
    const nextQ = filters.query.trim();
    const nextStatus = filters.status;
    if (nextQ) params.set('q', nextQ);
    else params.delete('q');
    if (nextStatus !== 'all') params.set('ufStatus', nextStatus);
    else params.delete('ufStatus');
    if (filters.section) params.set('ufSection', filters.section);
    else params.delete('ufSection');
    if (filters.periodYm) params.set('ufPeriod', filters.periodYm);
    else params.delete('ufPeriod');
    if (filters.connection) params.set('ufConn', filters.connection);
    else params.delete('ufConn');
    if (filters.sort !== 'apartment') params.set('ufSort', filters.sort);
    else params.delete('ufSort');
    const qs = params.toString();
    const currentQs = window.location.search.replace(/^\?/, '');
    if (qs === currentQs) {
      userFilterEditRef.current = false;
      return;
    }
    const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
    window.history.replaceState(window.history.state, '', url);
    userFilterEditRef.current = false;
  }, [
    filters.query,
    filters.status,
    filters.section,
    filters.periodYm,
    filters.connection,
    filters.sort,
    view,
  ]);
  const [registerRows, setRegisterRows] = useState<UtilityFinanceRegisterRow[]>([]);
  const [waterRows, setWaterRows] = useState<WaterRegisterRow[]>([]);
  const [electricityRows, setElectricityRows] = useState<ElectricityRegisterRow[]>([]);
  const [internetRows, setInternetRows] = useState<InternetRegisterRow[]>([]);
  const [internetTariffLabel, setInternetTariffLabel] = useState<string | null>(null);
  const [registerLoading, setRegisterLoading] = useState(false);
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [balance, setBalance] = useState<UtilityBalance>(emptyBalance());
  const [cardLoading, setCardLoading] = useState(false);
  const [payBusy, setPayBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payNote, setPayNote] = useState('');
  const [payReceiptFields, setPayReceiptFields] = useState<PaymentReceiptPayFieldValues>(emptyReceiptPayFields);
  const [lastPayReceipt, setLastPayReceipt] = useState<PaymentReceiptRow | null>(null);
  const [lastPayAmountLabel, setLastPayAmountLabel] = useState<string | null>(null);
  const payKeyRef = useRef(crypto.randomUUID());
  /**
   * After «К реестру», ignore focusPropertyId until the next explicit openCard or until
   * the external focus clears — avoids a late URL `property=` replace reopening a card.
   */
  const preferRegisterRef = useRef(false);

  const selected = useMemo(
    () => (propertyId === '' ? null : properties.find((p) => p.id === propertyId) ?? null),
    [properties, propertyId],
  );

  useEffect(() => {
    if (focusPropertyId == null || focusPropertyId === '') {
      preferRegisterRef.current = false;
      return;
    }
    if (preferRegisterRef.current) return;
    setPropertyId((current) => (current === focusPropertyId ? current : focusPropertyId));
    setView('card');
  }, [focusPropertyId]);

  const loadRegister = useCallback(async () => {
    if (!canOperate) return;
    setRegisterLoading(true);
    setError(null);
    const table = ledgerTableForService(service);
    const periodYm = filtersRef.current.periodYm;

    const ledgerPromise = supabase
      .from(table as 'water_ledger')
      .select('property_id, kind, amount_eur');

    const enrichPromise =
      service === 'water'
        ? supabase
            .from('water_readings')
            .select(
              'property_id, previous_value, current_value, consumption_m3, reading_date, reversed_at, status',
            )
            .order('reading_date', { ascending: false })
            .limit(5000)
        : service === 'electricity'
          ? supabase
              .from('electricity_charges')
              .select(
                'property_id, previous_day, current_day, consumption_day, previous_night, current_night, consumption_night, reading_date',
              )
              .order('reading_date', { ascending: false })
              .limit(5000)
          : Promise.all([
              supabase.from('internet_subscriptions').select('property_id, status'),
              supabase.rpc('get_applicable_internet_tariff' as never),
            ]);

    const [ledgerRes, enrichRes] = await Promise.all([ledgerPromise, enrichPromise]);
    setRegisterLoading(false);

    if (ledgerRes.error && !isMissingRelation(ledgerRes.error, table)) {
      setError(toUserFacingMessage(ledgerRes.error, t, { context: 'load', fallback: t('common.errLoad') }));
      setRegisterRows(buildUtilityFinanceRegisterRows(properties, new Map()));
      setWaterRows([]);
      setElectricityRows([]);
      setInternetRows([]);
      onModuleTotals?.(null);
      return;
    }
    const balances = aggregateUtilityBalances((ledgerRes.data ?? []) as UtilityLedgerAggRow[]);
    const base = buildUtilityFinanceRegisterRows(properties, balances);
    setRegisterRows(base);
    onModuleTotals?.(sumModuleTotalsFromRegisterRows(base));

    if (service === 'water') {
      const er = enrichRes as { data: unknown; error: { message?: string } | null };
      if (er.error && !isMissingRelation(er.error, 'water_readings')) {
        setError(toUserFacingMessage(er.error, t, { context: 'load', fallback: t('common.errLoad') }));
      }
      const snaps = pickLatestWaterSnaps(
        (Array.isArray(er.data) ? er.data : []) as Parameters<typeof pickLatestWaterSnaps>[0],
        periodYm,
      );
      setWaterRows(buildWaterRegisterRows(base, properties, snaps));
      setElectricityRows([]);
      setInternetRows([]);
      return;
    }

    if (service === 'electricity') {
      const er = enrichRes as { data: unknown; error: { message?: string } | null };
      if (er.error && !isMissingRelation(er.error, 'electricity_charges')) {
        setError(toUserFacingMessage(er.error, t, { context: 'load', fallback: t('common.errLoad') }));
      }
      const snaps = pickLatestElectricitySnaps(
        (Array.isArray(er.data) ? er.data : []) as Parameters<typeof pickLatestElectricitySnaps>[0],
        periodYm,
      );
      setElectricityRows(buildElectricityRegisterRows(base, properties, snaps));
      setWaterRows([]);
      setInternetRows([]);
      return;
    }

    const [subRes, tariffRes] = enrichRes as [
      { data: unknown; error: { message?: string } | null },
      { data: unknown; error: { message?: string } | null },
    ];
    if (subRes.error && !isMissingRelation(subRes.error, 'internet_subscriptions')) {
      setError(toUserFacingMessage(subRes.error, t, { context: 'load', fallback: t('common.errLoad') }));
    }
    const subs = indexInternetSubs(
      (Array.isArray(subRes.data) ? subRes.data : []) as Array<{ property_id: number; status: string }>,
    );
    let tariffLabel: string | null = null;
    const tariffRow = Array.isArray(tariffRes.data)
      ? (tariffRes.data[0] as Record<string, unknown> | undefined)
      : (tariffRes.data as Record<string, unknown> | null);
    if (tariffRow) {
      const ratesRaw = tariffRow.rates;
      const rates =
        ratesRaw && typeof ratesRaw === 'object' && !Array.isArray(ratesRaw)
          ? (ratesRaw as Record<string, unknown>)
          : null;
      const price =
        rates?.package_30 ??
        rates?.month ??
        tariffRow.price_eur_per_month ??
        tariffRow.price_eur ??
        tariffRow.monthly_price_eur ??
        null;
      if (price != null && Number.isFinite(Number(price))) {
        tariffLabel = formatEur(Number(price), locale);
      }
    }
    setInternetTariffLabel(tariffLabel);
    setInternetRows(buildInternetRegisterRows(base, properties, subs, tariffLabel));
    setWaterRows([]);
    setElectricityRows([]);
  }, [canOperate, locale, onModuleTotals, properties, service, supabase, t]);

  const loadCard = useCallback(async () => {
    if (!canOperate || propertyId === '') return;
    setCardLoading(true);
    setError(null);
    const table = ledgerTableForService(service);
    const balRpc = balanceRpcForService(service);
    const [ledgerRes, balRes] = await Promise.all([
      supabase
        .from(table as 'water_ledger')
        .select('id, kind, amount_eur, note, created_at')
        .eq('property_id', propertyId)
        .order('created_at', { ascending: false })
        .limit(80),
      supabase.rpc(balRpc as 'get_water_balance', { p_property_id: Number(propertyId) }),
    ]);
    setCardLoading(false);
    if (ledgerRes.error && !isMissingRelation(ledgerRes.error, table)) {
      setError(toUserFacingMessage(ledgerRes.error, t, { context: 'load', fallback: t('common.errLoad') }));
      setLedger([]);
    } else {
      setLedger((ledgerRes.data ?? []) as LedgerRow[]);
    }
    if (balRes.error && !isMissingRelation(balRes.error, balRpc)) {
      setError(toUserFacingMessage(balRes.error, t, { context: 'load', fallback: t('common.errLoad') }));
      setBalance(emptyBalance());
    } else {
      const row = firstRow(balRes.data);
      setBalance(
        row
          ? {
              charged_eur: Number(row.charged_eur),
              paid_eur: Number(row.paid_eur),
              adjustments_debit_eur: Number(row.adjustments_debit_eur),
              adjustments_credit_eur: Number(row.adjustments_credit_eur),
              balance_eur: Number(row.balance_eur),
            }
          : emptyBalance(),
      );
    }
  }, [canOperate, propertyId, service, supabase, t]);

  useEffect(() => {
    void loadRegister();
  }, [loadRegister, filters.periodYm]);

  useEffect(() => {
    if (view === 'card' && propertyId !== '') void loadCard();
  }, [view, propertyId, loadCard]);

  const sectionOptions = useMemo(() => listSectionsFromProperties(properties), [properties]);

  const visibleWater = useMemo(
    () => sortUtilityModuleRows(filterUtilityModuleRows(waterRows, filters), filters.sort),
    [waterRows, filters],
  );
  const visibleElectricity = useMemo(
    () => sortUtilityModuleRows(filterUtilityModuleRows(electricityRows, filters), filters.sort),
    [electricityRows, filters],
  );
  const visibleInternet = useMemo(() => {
    const base = filterUtilityModuleRows(internetRows, filters).filter((row) => {
      if (!filters.connection) return true;
      return String(row.connectionStatus).toLowerCase() === filters.connection.toLowerCase();
    });
    return sortUtilityModuleRows(base, filters.sort);
  }, [internetRows, filters]);
  const visibleCount =
    service === 'water'
      ? visibleWater.length
      : service === 'electricity'
        ? visibleElectricity.length
        : visibleInternet.length;
  const filtersActive = utilityModuleFiltersActive(filters);

  const tone = balanceTone(balance.balance_eur);
  const cardStatus =
    tone === 'debt' ? t('admin.balDebt') : tone === 'over' ? t('admin.balOver') : t('admin.balSettled');

  function openCard(id: number) {
    preferRegisterRef.current = false;
    setPropertyId(id);
    onPropertyChange?.(id);
    setView('card');
    setSuccess(null);
    setError(null);
    setLastPayReceipt(null);
    setLastPayAmountLabel(null);
  }

  function backToRegister() {
    preferRegisterRef.current = true;
    setView('register');
    setPropertyId('');
    onPropertyChange?.('');
    setSuccess(null);
    setError(null);
    void loadRegister();
  }

  function goFillUk() {
    window.location.assign('/admin?section=%D0%BD%D0%B0%D1%81%D1%82%D1%80%D0%BE%D0%B9%D0%BA%D0%B8');
  }

  async function handlePay(e: React.FormEvent) {
    e.preventDefault();
    if (!canOperate || propertyId === '' || payBusy) return;
    const amount = Number(payAmount);
    if (!(amount > 0) || Number.isNaN(amount)) {
      setError(t('admin.errAmount'));
      return;
    }
    setPayBusy(true);
    setLastPayReceipt(null);
    setError(null);
    const idem = payKeyRef.current;
    const intentErr = await prepareReceiptIntentFromFields(supabase, idem, payReceiptFields);
    if (intentErr) {
      setPayBusy(false);
      setError(
        toUserFacingMessage(intentErr, t, {
          context: 'finance',
          fallback: t('admin.errReceiptPrepare'),
        }),
      );
      return;
    }
    const payRpc = paymentRpcForService(service);
    const { data: payData, error: rpcErr } = await supabase.rpc(payRpc as 'record_water_payment', {
      p_property_id: Number(propertyId),
      p_amount_eur: amount,
      p_note: payNote.trim() || null,
      p_idempotency_key: idem,
    });
    if (rpcErr) {
      setPayBusy(false);
      setError(toUserFacingMessage(rpcErr, t, { context: 'finance', fallback: t('common.errFinance') }));
      return;
    }
    const ledgerId = ledgerIdFromPaymentRpc(payData);
    const amountLabel = formatEur(amount, locale);
    setLastPayAmountLabel(amountLabel);
    const finished = await finishReceiptForPayment(
      supabase,
      receiptModuleForService(service),
      ledgerId,
    );
    setLastPayReceipt(finished.receipt);
    payKeyRef.current = crypto.randomUUID();
    setPayAmount('');
    setPayNote('');
    setPayReceiptFields(emptyReceiptPayFields());
    setPayBusy(false);
    setSuccess(
      finished.pdfError && finished.receipt
        ? t('receipt.paySavedPdfFailed')
        : t('receipt.payRegistered', { amount: amountLabel }),
    );
    if (service === 'water' || service === 'electricity') {
      void import('@/lib/email/eventProducers')
        .then(({ notifyPropertyOwnersEvent }) =>
          notifyPropertyOwnersEvent(supabase, {
            eventKey: 'meters_payment_recorded',
            propertyId: Number(propertyId),
            entityId: `${service}_pay:${propertyId}:${Date.now()}`,
            payload: { utility: service, amount_eur: amount },
          }),
        )
        .catch(() => undefined);
    }
    await Promise.all([loadCard(), loadRegister()]);
  }

  if (!canOperate) {
    return <AdminInlineAlert tone="warning">{t('admin.waterNoAccess')}</AdminInlineAlert>;
  }

  if (view === 'register') {
    const rowClickProps = (propertyId: number) => ({
      tabIndex: 0 as const,
      role: 'button' as const,
      'aria-label': t('admin.utilFinOpenCard'),
      className: `${adminTableRowClass} cursor-pointer hover:bg-hover/70 focus-visible:bg-hover/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40`,
      onClick: () => openCard(propertyId),
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        openCard(propertyId);
      },
    });

    const balanceClass = (status: UtilityFinanceRegisterRow['status']) =>
      `${adminTableCellClass} tabular-nums ${
        status === 'debt' ? 'text-danger' : status === 'credit' ? 'text-success' : ''
      }`;

    const aptCell = (propertyId: number, apartmentNumber: string | number) => {
      const prop = properties.find((p) => p.id === propertyId);
      return prop ? (
        <PropertyIdentityLink
          property={prop}
          module={service === 'water' ? 'water' : service === 'electricity' ? 'electricity' : 'internet'}
        />
      ) : (
        `№ ${apartmentNumber}`
      );
    };

    const filterBar = (
      <div className="space-y-2 rounded-[14px] border border-border bg-surface-secondary/40 px-3 py-3">
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs font-medium text-secondary">
            {t('admin.utilRegFilterSearch')}
            <input
              value={filters.query}
              onChange={(e) => {
                userFilterEditRef.current = true;
                setFilters((f) => ({ ...f, query: e.target.value }));
              }}
              placeholder={t('admin.utilRegSearchAptPh')}
              className={`mt-1 block w-48 ${fieldClass}`}
            />
          </label>
          <label className="text-xs font-medium text-secondary">
            {t('admin.utilRegFilterSection')}
            <select
              value={filters.section}
              onChange={(e) => {
                userFilterEditRef.current = true;
                setFilters((f) => ({ ...f, section: e.target.value }));
              }}
              className={`mt-1 block w-36 ${fieldClass}`}
            >
              <option value="">{t('admin.sfFilterAll')}</option>
              {sectionOptions.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          {service === 'internet' ? (
            <label className="text-xs font-medium text-secondary">
              {t('admin.utilRegFilterConnection')}
              <select
                value={filters.connection}
                onChange={(e) => {
                  userFilterEditRef.current = true;
                  setFilters((f) => ({ ...f, connection: e.target.value }));
                }}
                className={`mt-1 block w-44 ${fieldClass}`}
              >
                <option value="">{t('admin.sfFilterAll')}</option>
                <option value="active">{t('admin.internetStatusActive')}</option>
                <option value="inactive">{t('admin.internetStatusInactive')}</option>
                <option value="pending_enable">{t('admin.internetPendingEnable')}</option>
                <option value="pending_disable">{t('admin.internetPendingDisable')}</option>
                <option value="none">{t('admin.internetStatusNone')}</option>
              </select>
            </label>
          ) : (
            <label className="text-xs font-medium text-secondary">
              {t('admin.utilRegFilterPeriodReadings')}
              <input
                type="month"
                value={filters.periodYm}
                onChange={(e) => {
                  userFilterEditRef.current = true;
                  setFilters((f) => ({ ...f, periodYm: e.target.value }));
                }}
                className={`mt-1 block w-40 ${fieldClass}`}
              />
            </label>
          )}
          <label className="text-xs font-medium text-secondary">
            {t('admin.utilRegFilterBalance')}
            <select
              value={filters.status}
              onChange={(e) => {
                userFilterEditRef.current = true;
                setFilters((f) => ({
                  ...f,
                  status: e.target.value as UtilityModuleRegisterFilters['status'],
                }));
              }}
              className={`mt-1 block w-40 ${fieldClass}`}
            >
              <option value="all">{t('admin.sfFilterAll')}</option>
              <option value="debt">{t('admin.balDebt')}</option>
              <option value="credit">{t('admin.balOver')}</option>
              <option value="settled">{t('admin.balSettled')}</option>
            </select>
          </label>
          <label className="text-xs font-medium text-secondary">
            {t('admin.utilRegFilterSort')}
            <select
              value={filters.sort}
              onChange={(e) => {
                userFilterEditRef.current = true;
                setFilters((f) => ({
                  ...f,
                  sort: e.target.value as UtilityModuleRegisterFilters['sort'],
                }));
              }}
              className={`mt-1 block w-44 ${fieldClass}`}
            >
              <option value="apartment">{t('admin.utilRegSortApt')}</option>
              <option value="section">{t('admin.utilRegSortSection')}</option>
              <option value="balance_desc">{t('admin.utilRegSortBalanceDesc')}</option>
              <option value="balance_asc">{t('admin.utilRegSortBalanceAsc')}</option>
            </select>
          </label>
          <AdminSecondaryButton
            type="button"
            disabled={!filtersActive}
            onClick={() => {
              userFilterEditRef.current = true;
              setFilters(EMPTY_UTILITY_MODULE_FILTERS);
            }}
          >
            {t('admin.sfFilterReset')}
          </AdminSecondaryButton>
        </div>
        {service !== 'internet' ? (
          <p className="text-[11px] text-muted">{t('admin.utilRegPeriodScopeHint')}</p>
        ) : null}
      </div>
    );

    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-2 border-b border-border pb-2">
          <div>
            <h2 className="text-base font-semibold tracking-tight text-foreground">
              {t(registerTitleKey(service))}
            </h2>
            <p className="mt-0.5 text-xs text-muted">{t('admin.utilRegRegisterHint')}</p>
          </div>
          <p className="text-xs tabular-nums text-muted">
            {t('admin.utilFinRegisterCount', { n: String(visibleCount) })}
          </p>
        </div>
        {error ? <AdminInlineAlert tone="danger">{error}</AdminInlineAlert> : null}
        {filterBar}
        {registerLoading ? (
          <p className="text-sm text-muted">{t('common.loading')}</p>
        ) : properties.length === 0 ? (
          <AdminEmptyState title={t('admin.utilFinEmpty')} />
        ) : visibleCount === 0 ? (
          <AdminEmptyState title={t('admin.utilFinEmptyFilter')} />
        ) : service === 'water' ? (
          <AdminTableShell>
            <table className="w-full min-w-[64rem] text-sm">
              <thead>
                <tr className={adminTableHeadRowClass}>
                  <th className={adminTableCellClass}>{t('admin.utilRegColSection')}</th>
                  <th className={adminTableCellClass}>{t('admin.utilRegColApt')}</th>
                  <th className={adminTableCellClass}>{t('form.colOwner')}</th>
                  <th className={adminTableCellClass}>{t('admin.utilRegColPrevM3')}</th>
                  <th className={adminTableCellClass}>{t('admin.utilRegColCurrM3')}</th>
                  <th className={adminTableCellClass}>{t('admin.utilRegColConsM3')}</th>
                  <th className={adminTableCellClass}>{t('admin.utilRegColCharged')}</th>
                  <th className={adminTableCellClass}>{t('admin.utilRegColPaid')}</th>
                  <th className={adminTableCellClass}>{t('admin.utilRegColBalanceEur')}</th>
                </tr>
              </thead>
              <tbody>
                {visibleWater.map((row) => (
                  <tr key={row.propertyId} {...rowClickProps(row.propertyId)}>
                    <td className={adminTableCellClass}>
                      {formatSectionBlock(row.sectionCode, row.blockCode)}
                    </td>
                    <td className={adminTableCellClass}>{aptCell(row.propertyId, row.apartmentNumber)}</td>
                    <td className={adminTableCellClass}>{row.ownerName ?? '—'}</td>
                    <td className={`${adminTableCellClass} tabular-nums`}>
                      {row.previousM3 == null ? '—' : formatM3(row.previousM3, locale)}
                    </td>
                    <td className={`${adminTableCellClass} tabular-nums`}>
                      {row.currentM3 == null ? '—' : formatM3(row.currentM3, locale)}
                    </td>
                    <td className={`${adminTableCellClass} tabular-nums`}>
                      {row.consumptionM3 == null ? '—' : formatM3(row.consumptionM3, locale)}
                    </td>
                    <td className={`${adminTableCellClass} tabular-nums`}>
                      {formatEur(row.chargedEur, locale)}
                    </td>
                    <td className={`${adminTableCellClass} tabular-nums`}>
                      {formatEur(row.paidEur, locale)}
                    </td>
                    <td className={balanceClass(row.status)}>
                      {formatEur(Math.abs(row.balanceEur), locale)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </AdminTableShell>
        ) : service === 'electricity' ? (
          <AdminTableShell>
            <table className="w-full min-w-[78rem] text-sm">
              <thead>
                <tr className={adminTableHeadRowClass}>
                  <th className={adminTableCellClass}>{t('admin.utilRegColSection')}</th>
                  <th className={adminTableCellClass}>{t('admin.utilRegColApt')}</th>
                  <th className={adminTableCellClass}>{t('form.colOwner')}</th>
                  <th className={adminTableCellClass}>{t('admin.utilRegColPrevDay')}</th>
                  <th className={adminTableCellClass}>{t('admin.utilRegColCurrDay')}</th>
                  <th className={adminTableCellClass}>{t('admin.utilRegColConsDay')}</th>
                  <th className={adminTableCellClass}>{t('admin.utilRegColPrevNight')}</th>
                  <th className={adminTableCellClass}>{t('admin.utilRegColCurrNight')}</th>
                  <th className={adminTableCellClass}>{t('admin.utilRegColConsNight')}</th>
                  <th className={adminTableCellClass}>{t('admin.utilRegColCharged')}</th>
                  <th className={adminTableCellClass}>{t('admin.utilRegColPaid')}</th>
                  <th className={adminTableCellClass}>{t('admin.utilRegColBalanceEur')}</th>
                </tr>
              </thead>
              <tbody>
                {visibleElectricity.map((row) => (
                  <tr key={row.propertyId} {...rowClickProps(row.propertyId)}>
                    <td className={adminTableCellClass}>
                      {formatSectionBlock(row.sectionCode, row.blockCode)}
                    </td>
                    <td className={adminTableCellClass}>{aptCell(row.propertyId, row.apartmentNumber)}</td>
                    <td className={adminTableCellClass}>{row.ownerName ?? '—'}</td>
                    <td className={`${adminTableCellClass} tabular-nums`}>
                      {row.previousDay == null ? '—' : formatKwh(row.previousDay, locale)}
                    </td>
                    <td className={`${adminTableCellClass} tabular-nums`}>
                      {row.currentDay == null ? '—' : formatKwh(row.currentDay, locale)}
                    </td>
                    <td className={`${adminTableCellClass} tabular-nums`}>
                      {row.consumptionDay == null ? '—' : formatKwh(row.consumptionDay, locale)}
                    </td>
                    <td className={`${adminTableCellClass} tabular-nums`}>
                      {row.previousNight == null ? '—' : formatKwh(row.previousNight, locale)}
                    </td>
                    <td className={`${adminTableCellClass} tabular-nums`}>
                      {row.currentNight == null ? '—' : formatKwh(row.currentNight, locale)}
                    </td>
                    <td className={`${adminTableCellClass} tabular-nums`}>
                      {row.consumptionNight == null ? '—' : formatKwh(row.consumptionNight, locale)}
                    </td>
                    <td className={`${adminTableCellClass} tabular-nums`}>
                      {formatEur(row.chargedEur, locale)}
                    </td>
                    <td className={`${adminTableCellClass} tabular-nums`}>
                      {formatEur(row.paidEur, locale)}
                    </td>
                    <td className={balanceClass(row.status)}>
                      {formatEur(Math.abs(row.balanceEur), locale)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </AdminTableShell>
        ) : (
          <AdminTableShell>
            <table className="w-full min-w-[56rem] text-sm">
              <thead>
                <tr className={adminTableHeadRowClass}>
                  <th className={adminTableCellClass}>{t('admin.utilRegColSection')}</th>
                  <th className={adminTableCellClass}>{t('admin.utilRegColApt')}</th>
                  <th className={adminTableCellClass}>{t('form.colOwner')}</th>
                  <th className={adminTableCellClass}>{t('admin.utilRegColConnection')}</th>
                  <th className={adminTableCellClass}>{t('admin.utilRegColTariff')}</th>
                  <th className={adminTableCellClass}>{t('admin.utilRegColCharged')}</th>
                  <th className={adminTableCellClass}>{t('admin.utilRegColPaid')}</th>
                  <th className={adminTableCellClass}>{t('admin.utilRegColBalanceEur')}</th>
                </tr>
              </thead>
              <tbody>
                {visibleInternet.map((row) => (
                  <tr key={row.propertyId} {...rowClickProps(row.propertyId)}>
                    <td className={adminTableCellClass}>
                      {formatSectionBlock(row.sectionCode, row.blockCode)}
                    </td>
                    <td className={adminTableCellClass}>{aptCell(row.propertyId, row.apartmentNumber)}</td>
                    <td className={adminTableCellClass}>{row.ownerName ?? '—'}</td>
                    <td className={adminTableCellClass}>
                      {connectionStatusLabel(row.connectionStatus, t)}
                    </td>
                    <td className={`${adminTableCellClass} tabular-nums`}>
                      {row.tariffLabel ?? internetTariffLabel ?? '—'}
                    </td>
                    <td className={`${adminTableCellClass} tabular-nums`}>
                      {formatEur(row.chargedEur, locale)}
                    </td>
                    <td className={`${adminTableCellClass} tabular-nums`}>
                      {formatEur(row.paidEur, locale)}
                    </td>
                    <td className={balanceClass(row.status)}>
                      {formatEur(Math.abs(row.balanceEur), locale)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </AdminTableShell>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <AdminSecondaryButton type="button" onClick={backToRegister}>
          {t('admin.utilFinBackToRegister')}
        </AdminSecondaryButton>
        <p className="text-sm text-secondary">
          {t('admin.utilFinCardHeading', {
            apt: selected ? formatPropertyIdentity(selected, t) : '—',
            service: t(serviceTitleKey(service)),
          })}
        </p>
        {selected ? (
          <PropertyIdentityLink
            property={selected}
            module={service === 'water' ? 'water' : service === 'electricity' ? 'electricity' : 'internet'}
            showOpenAction
          />
        ) : null}
      </div>
      {error ? <AdminInlineAlert tone="danger">{error}</AdminInlineAlert> : null}
      {success ? <AdminInlineAlert tone="success">{success}</AdminInlineAlert> : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <AdminMetricCard
          label={t('admin.charged')}
          value={cardLoading ? t('common.loading') : formatEur(balance.charged_eur, locale)}
        />
        <AdminMetricCard
          label={t('admin.paid')}
          value={cardLoading ? t('common.loading') : formatEur(balance.paid_eur, locale)}
        />
        <AdminMetricCard
          label={t('admin.utilFinColBalance')}
          value={cardLoading ? t('common.loading') : formatEur(Math.abs(balance.balance_eur), locale)}
          secondary={cardStatus}
          alert={tone === 'debt'}
        />
        <AdminMetricCard
          label={t('admin.adjDebit')}
          value={
            cardLoading
              ? t('common.loading')
              : formatEur(balance.adjustments_debit_eur - balance.adjustments_credit_eur, locale)
          }
          secondary={t('admin.adjCredit')}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className={cardClass}>
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
            {t('admin.recordPayment')}
          </p>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <dt className="text-muted">{t('admin.utilFinApartment')}</dt>
            <dd>
              {selected ? formatPropertyIdentity(selected, t) : '—'}
              {selected?.owner_name ? ` — ${selected.owner_name}` : ''}
            </dd>
            <dt className="text-muted">{t('admin.utilFinService')}</dt>
            <dd>{t(serviceTitleKey(service))}</dd>
          </dl>
          {lastPayAmountLabel ? (
            <div className="mt-3">
              <PaymentSuccessBanner
                amountLabel={lastPayAmountLabel}
                receipt={lastPayReceipt}
                supabase={supabase}
                onFillUk={goFillUk}
                onReceiptChange={setLastPayReceipt}
              />
            </div>
          ) : null}
          <form onSubmit={handlePay} className="mt-4 space-y-3">
            <label className="block text-xs text-secondary">
              {t('admin.amountEur')}
              <input
                className={`mt-1 ${fieldClass}`}
                type="number"
                min="0.01"
                step="0.01"
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
                required
                disabled={payBusy}
              />
              <span className="mt-1 block text-[11px] text-muted">{t('admin.utilFinAmountHint')}</span>
            </label>
            <label className="block text-xs text-secondary">
              {t('admin.noteOptional')}
              <input
                className={`mt-1 ${fieldClass}`}
                value={payNote}
                onChange={(e) => setPayNote(e.target.value)}
                disabled={payBusy}
              />
            </label>
            <PaymentReceiptPayFields
              values={payReceiptFields}
              onChange={setPayReceiptFields}
              fieldClass={fieldClass}
              defaultPayerHint={selected?.owner_name ?? undefined}
            />
            <AdminPrimaryButton type="submit" disabled={payBusy}>
              {payBusy ? t('receipt.forming') : t('admin.recordPayment')}
            </AdminPrimaryButton>
          </form>
        </div>
        <div className={cardClass}>
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
            {t('admin.utilFinCardOps')}
          </p>
          <p className="mt-2 text-sm text-secondary">{t('admin.utilFinCardOpsLead')}</p>
          {extraCardActions}
        </div>
      </div>

      <div className={cardClass}>
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
          {t('admin.utilFinOpsHistory')}
        </p>
        {cardLoading ? (
          <p className="mt-3 text-sm text-muted">{t('common.loading')}</p>
        ) : ledger.length === 0 ? (
          <div className="mt-3">
            <AdminEmptyState title={t('admin.utilFinNoLedger')} />
          </div>
        ) : (
          <div className="mt-3">
            <AdminTableShell>
              <table className="w-full min-w-[28rem] text-sm">
                <thead>
                  <tr className={adminTableHeadRowClass}>
                    <th className={adminTableCellClass}>{t('admin.date')}</th>
                    <th className={adminTableCellClass}>{t('admin.kind')}</th>
                    <th className={adminTableCellClass}>{t('admin.amount')}</th>
                    <th className={adminTableCellClass}>{t('admin.note')}</th>
                    <th className={adminTableCellClass}>{t('receipt.open')}</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.map((row) => (
                    <tr key={String(row.id)} className={adminTableRowClass}>
                      <td className={`${adminTableCellClass} tabular-nums`}>
                        {formatOwnerDate(row.created_at)}
                      </td>
                      <td className={adminTableCellClass}>{labelLedgerKind(row.kind, t)}</td>
                      <td className={`${adminTableCellClass} tabular-nums`}>
                        {formatEur(Number(row.amount_eur), locale)}
                      </td>
                      <td className={`${adminTableCellClass} text-secondary`}>{row.note ?? '—'}</td>
                      <td className={`${adminTableCellClass} align-top`}>
                        <LedgerPaymentReceiptCell
                          supabase={supabase}
                          module={receiptModuleForService(service)}
                          ledgerId={String(row.id)}
                          kind={row.kind}
                          onFillUk={goFillUk}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </AdminTableShell>
          </div>
        )}
      </div>
    </div>
  );
}
