'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { useI18n } from '@/i18n/I18nProvider';
import { formatOwnerDate, formatOwnerDateTime } from '@/lib/ownerFormat';
import { isMissingRelation } from '@/lib/polls';
import { sofiaCurrentYear } from '@/lib/tariffs';
import {
  aggregateCapitalRepairBalances,
  buildCapitalYearBreakdown,
  capitalChargeStateNoticeKey,
  capitalChargeYearChoices,
  capitalFundCashBalance,
  capitalHistoryFiltersActive,
  capitalJournalFiltersActive,
  capitalLedgerKindFilterActive,
  capitalOpsHistoryTitleKey,
  capitalStandingDebt,
  capitalStandingOverpay,
  defaultCapitalChargeYear,
  EMPTY_CAPITAL_HISTORY_FILTERS,
  EMPTY_CAPITAL_JOURNAL_FILTERS,
  filterCapitalHistoryRows,
  filterCapitalJournalRows,
  filterCapitalLedgerRows,
  isCapitalBulkChargeEnabled,
  parseCapitalAdminTab,
  resolveCapitalChargeState,
  sumCapitalCashReceipts,
  sumCapitalJournalRows,
  sumCapitalOpeningCredit,
  sumCapitalOperationalCharges,
  sumCapitalYearCharge,
  type CapitalAdminTab,
  type CapitalAssessmentYearRow,
  type CapitalHistoryFilters,
  type CapitalJournalFilters,
  type CapitalLedgerKindFilter,
} from '@/lib/capitalRepairUi';
import {
  parseCapitalRepairLaunchContext,
  parseCapitalRepairYearChargeContext,
  type CapitalRepairLaunchContext,
  type CapitalRepairYearChargeContext,
} from '@/lib/capitalRepairLaunch';
import {
  EMPTY_UTILITY_FINANCE_FILTERS,
  buildUtilityFinanceRegisterRows,
  filterUtilityFinanceRegisterRows,
  sortUtilityFinanceRegisterRows,
  utilityFinanceFiltersActive,
  type UtilityFinanceRegisterFilters,
  type UtilityFinanceStatusFilter,
} from '@/lib/utilityFinanceRegister';
import { compareApartmentNumbers } from '@/lib/supportFeeRegister';
import {
  balanceTone,
  canSeeCapitalAdmin,
  emptyBalance,
  formatEur,
  mapAdminRpcError,
  type CapitalLedger,
  type UtilityBalance,
} from '@/lib/utilities';
import { toUserFacingMessage } from '@/lib/userFacingError';
import { useAppConfirm } from '@/components/ui/AppConfirmDialog';
import {
  AdminPageHeader,
  AdminMetricCard,
  AdminTabBar,
  AdminTableShell,
  AdminEmptyState,
  AdminInlineAlert,
  AdminPrimaryButton,
  AdminSecondaryButton,
  StatusBadge,
  adminCardClass,
  adminFieldClass,
  adminTableCellClass,
  adminTableHeadRowClass,
  adminTableRowClass,
} from '@/components/admin/AdminUi';
import { readBulkAccrualSummary } from '@/lib/bulkAccrual';
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
  area_sqm?: number | null;
};

type ChargePreview = {
  area_sqm: number;
  rate_eur_per_sqm_year: number;
  amount_eur: number;
  subject_kind: string;
  apartment_number: string | null;
};

type LedgerAggRow = { property_id: number; kind: string; amount_eur: number };

const fieldClass = adminFieldClass;
const cardClass = `${adminCardClass} p-4 md:p-5`;
const labelClass = 'text-[11px] font-medium uppercase tracking-[0.18em] text-muted';
const JOURNAL_LIMIT = 1000;
const AGG_PAGE = 1000;

function firstRow<T>(data: T[] | T | null | undefined): T | null {
  if (!data) return null;
  return Array.isArray(data) ? (data[0] ?? null) : data;
}

function goFillUk() {
  window.location.assign('/admin?section=%D0%BD%D0%B0%D1%81%D1%82%D1%80%D0%BE%D0%B9%D0%BA%D0%B8');
}

/** PostgREST caps responses at max_rows (1000): page through the whole ledger. */
async function fetchLedgerAggregates(
  supabase: SupabaseClient<Database>,
): Promise<{ rows: LedgerAggRow[]; error: { message?: string } | null }> {
  const rows: LedgerAggRow[] = [];
  for (let from = 0; ; from += AGG_PAGE) {
    const { data, error } = await supabase
      .from('capital_repair_ledger')
      .select('property_id, kind, amount_eur')
      .order('id', { ascending: true })
      .range(from, from + AGG_PAGE - 1);
    if (error) return { rows, error };
    const page = (data ?? []) as LedgerAggRow[];
    rows.push(...page);
    if (page.length < AGG_PAGE) break;
  }
  return { rows, error: null };
}

export function AdminCapital({
  supabase,
  properties,
  staffRole,
  tab: tabRaw,
  onTabChange,
  focusPropertyId,
  onPropertyChange,
  onOpenTariffs,
}: {
  supabase: SupabaseClient<Database>;
  properties: PropertyOption[];
  staffRole: string;
  /** `tab` query value; unknown/missing → register. */
  tab?: string | null;
  onTabChange?: (tab: CapitalAdminTab) => void;
  /** `property` query value — opens the apartment card. */
  focusPropertyId?: number | '';
  onPropertyChange?: (id: number | '') => void;
  /** Opens «Финансы → Тарифы» (the capital-repair rate is edited there only). */
  onOpenTariffs?: () => void;
}) {
  const { t, locale } = useI18n();
  const { confirm, dialog } = useAppConfirm(t('common.close'));
  const canSee = canSeeCapitalAdmin(staffRole);
  const tab = parseCapitalAdminTab(tabRaw);

  const sorted = useMemo(
    () =>
      [...properties].sort((a, b) =>
        compareApartmentNumbers(a.apartment_number, b.apartment_number),
      ),
    [properties],
  );

  const [view, setView] = useState<'register' | 'card'>('register');
  const [propertyId, setPropertyId] = useState<number | ''>(
    focusPropertyId != null && focusPropertyId !== '' ? focusPropertyId : '',
  );
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Register
  const [filters, setFilters] = useState<UtilityFinanceRegisterFilters>(EMPTY_UTILITY_FINANCE_FILTERS);
  const [aggRows, setAggRows] = useState<LedgerAggRow[]>([]);
  const [registerLoading, setRegisterLoading] = useState(false);
  const [fundCash, setFundCash] = useState<number | null>(null);

  // Launch / charges
  const [launch, setLaunch] = useState<CapitalRepairLaunchContext | null>(null);
  const [chargeYear, setChargeYear] = useState(() => sofiaCurrentYear());
  const [chargeYearTouched, setChargeYearTouched] = useState(false);
  const [yearCtx, setYearCtx] = useState<CapitalRepairYearChargeContext | null>(null);
  const [yearCtxLoading, setYearCtxLoading] = useState(false);
  const [tariffAmount, setTariffAmount] = useState<number | null>(null);
  const [tariffRateNatural, setTariffRateNatural] = useState<number | null>(null);
  const [tariffRateLegal, setTariffRateLegal] = useState<number | null>(null);
  const [tariffValidFrom, setTariffValidFrom] = useState<string | null>(null);
  const [tariffLoading, setTariffLoading] = useState(true);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkResult, setBulkResult] = useState<string | null>(null);

  // Payments journal
  const [journal, setJournal] = useState<CapitalLedger[]>([]);
  const [journalLoading, setJournalLoading] = useState(false);
  const [journalFilters, setJournalFilters] = useState<CapitalJournalFilters>(EMPTY_CAPITAL_JOURNAL_FILTERS);

  // Complex operations history
  const [historyRowsRaw, setHistoryRowsRaw] = useState<CapitalLedger[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyFilters, setHistoryFilters] = useState<CapitalHistoryFilters>(EMPTY_CAPITAL_HISTORY_FILTERS);

  // Apartment card
  const [ledger, setLedger] = useState<CapitalLedger[]>([]);
  const [balance, setBalance] = useState<UtilityBalance>(emptyBalance());
  const [cardLoading, setCardLoading] = useState(false);
  const [openingPending, setOpeningPending] = useState(false);
  const [openingFormOpen, setOpeningFormOpen] = useState(false);
  const [openingConfirmBusy, setOpeningConfirmBusy] = useState(false);
  const [openingYear, setOpeningYear] = useState('');
  const [openingSignedAmount, setOpeningSignedAmount] = useState('');
  const openingIdemRef = useRef(crypto.randomUUID());
  const [aptCharges, setAptCharges] = useState<number | null>(null);
  const [aptReceipts, setAptReceipts] = useState<number | null>(null);
  const [cardYearRows, setCardYearRows] = useState<CapitalAssessmentYearRow[]>([]);
  const [ledgerKindFilter, setLedgerKindFilter] = useState<CapitalLedgerKindFilter>('all');
  const [payOpen, setPayOpen] = useState(false);
  const [payBusy, setPayBusy] = useState(false);
  const payBusyRef = useRef(false);
  const [payAmount, setPayAmount] = useState('');
  const [payNote, setPayNote] = useState('');
  const [payReceiptFields, setPayReceiptFields] = useState<PaymentReceiptPayFieldValues>(emptyReceiptPayFields);
  const [lastPayReceipt, setLastPayReceipt] = useState<PaymentReceiptRow | null>(null);
  const [lastPayAmountLabel, setLastPayAmountLabel] = useState<string | null>(null);
  const [chargePreview, setChargePreview] = useState<ChargePreview | null>(null);
  const [chargePreviewError, setChargePreviewError] = useState<string | null>(null);
  const [chargePreviewLoading, setChargePreviewLoading] = useState(false);
  const [chargeBusy, setChargeBusy] = useState(false);
  const payKeyRef = useRef(crypto.randomUUID());
  const chargeKeyRef = useRef(crypto.randomUUID());

  /**
   * After «К реестру», ignore focusPropertyId until the next explicit openCard or until
   * the external focus clears — avoids a late URL `property=` replace reopening a card.
   */
  const preferRegisterRef = useRef(false);

  useEffect(() => {
    if (focusPropertyId == null || focusPropertyId === '') {
      preferRegisterRef.current = false;
      return;
    }
    if (preferRegisterRef.current) return;
    setPropertyId((current) => (current === focusPropertyId ? current : focusPropertyId));
    setView('card');
  }, [focusPropertyId]);

  const selected = useMemo(
    () => (propertyId === '' ? null : sorted.find((p) => p.id === propertyId) ?? null),
    [sorted, propertyId],
  );

  // ---------- loaders ----------
  const loadLaunch = useCallback(async () => {
    if (!canSee) return;
    const { data, error: rpcErr } = await supabase.rpc('capital_repair_launch_context');
    if (rpcErr) return;
    setLaunch(parseCapitalRepairLaunchContext(data));
  }, [canSee, supabase]);

  const loadRegister = useCallback(async () => {
    if (!canSee) return;
    setRegisterLoading(true);
    const cashClient = supabase as unknown as {
      from: (table: 'capital_repair_fund_cash_opening') => {
        select: (columns: 'balance_eur, as_of_date') => {
          limit: (n: number) => PromiseLike<{
            data: { balance_eur: number | null }[] | null;
            error: { message?: string } | null;
          }>;
        };
      };
    };
    const [agg, cashRes] = await Promise.all([
      fetchLedgerAggregates(supabase),
      cashClient.from('capital_repair_fund_cash_opening').select('balance_eur, as_of_date').limit(1),
    ]);
    setRegisterLoading(false);
    if (agg.error && !isMissingRelation(agg.error, 'capital_repair_ledger')) {
      setError(toUserFacingMessage(agg.error, t, { context: 'load', fallback: t('common.errLoad') }));
      setAggRows([]);
    } else {
      setAggRows(agg.rows);
    }
    setFundCash(cashRes.error ? null : capitalFundCashBalance(cashRes.data?.[0]?.balance_eur));
  }, [canSee, supabase, t]);

  const loadYearCtx = useCallback(
    async (year: number) => {
      if (!canSee) return;
      setYearCtxLoading(true);
      const { data, error: rpcErr } = await supabase.rpc('capital_repair_year_charge_context', {
        p_billing_year: year,
      });
      setYearCtxLoading(false);
      if (rpcErr) {
        setYearCtx(null);
        if (!/could not find the function/i.test(rpcErr.message ?? '')) {
          setError(toUserFacingMessage(rpcErr, t, { context: 'load', fallback: t('common.errLoad') }));
        }
        return;
      }
      setYearCtx(parseCapitalRepairYearChargeContext(data));
    },
    [canSee, supabase, t],
  );

  const loadJournal = useCallback(async () => {
    if (!canSee) return;
    setJournalLoading(true);
    let q = supabase
      .from('capital_repair_ledger')
      .select('*')
      .eq('kind', 'payment')
      .order('created_at', { ascending: false })
      .limit(JOURNAL_LIMIT);
    if (journalFilters.propertyId !== '') q = q.eq('property_id', Number(journalFilters.propertyId));
    const { data, error: qErr } = await q;
    setJournalLoading(false);
    if (qErr && !isMissingRelation(qErr, 'capital_repair_ledger')) {
      setError(toUserFacingMessage(qErr, t, { context: 'load', fallback: t('common.errLoad') }));
      setJournal([]);
      return;
    }
    setJournal((data ?? []) as CapitalLedger[]);
  }, [canSee, journalFilters.propertyId, supabase, t]);

  const loadHistory = useCallback(async () => {
    if (!canSee) return;
    setHistoryLoading(true);
    let q = supabase
      .from('capital_repair_ledger')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(JOURNAL_LIMIT);
    if (historyFilters.propertyId !== '') q = q.eq('property_id', Number(historyFilters.propertyId));
    const { data, error: qErr } = await q;
    setHistoryLoading(false);
    if (qErr && !isMissingRelation(qErr, 'capital_repair_ledger')) {
      setError(toUserFacingMessage(qErr, t, { context: 'load', fallback: t('common.errLoad') }));
      setHistoryRowsRaw([]);
      return;
    }
    setHistoryRowsRaw((data ?? []) as CapitalLedger[]);
  }, [canSee, historyFilters.propertyId, supabase, t]);

  const loadCard = useCallback(async () => {
    if (!canSee || propertyId === '') {
      setLedger([]);
      setBalance(emptyBalance());
      setAptCharges(null);
      setAptReceipts(null);
      setCardYearRows([]);
      return;
    }
    setCardLoading(true);
    const pid = Number(propertyId);
    type LedgerWithAssessment = CapitalLedger & {
      assessment?: { title?: string | null; decision_date?: string | null } | null;
    };
    const [ledgerRes, balanceRes, opsRes, pendingRes] = await Promise.all([
      supabase
        .from('capital_repair_ledger')
        .select('*, assessment:capital_repair_assessments(title, decision_date)')
        .eq('property_id', pid)
        .order('created_at', { ascending: false })
        .limit(80),
      supabase.rpc('get_capital_repair_balance', { p_property_id: pid }),
      supabase
        .from('capital_repair_ledger')
        .select('kind, amount_eur')
        .eq('property_id', pid)
        .in('kind', ['charge', 'payment', 'opening_obligation', 'opening_credit', 'opening_historical_settlement'])
        .limit(5000),
      supabase
        .from('capital_repair_opening_pending' as never)
        .select('id, billing_year, payload, status')
        .eq('property_id', pid)
        .eq('status', 'needs_initial')
        .limit(1),
    ]);
    setCardLoading(false);
    const pendingRows = Array.isArray(pendingRes.data) ? pendingRes.data : [];
    const hasPending = pendingRows.length > 0 && !pendingRes.error;
    setOpeningPending(hasPending);
    if (hasPending) {
      const prow = pendingRows[0] as {
        billing_year?: number | null;
        payload?: Record<string, unknown> | null;
      };
      setOpeningYear((prev) => (prev ? prev : prow.billing_year != null ? String(prow.billing_year) : ''));
    } else {
      setOpeningFormOpen(false);
    }
    if (ledgerRes.error && !isMissingRelation(ledgerRes.error, 'capital_repair_ledger')) {
      setError(toUserFacingMessage(ledgerRes.error, t, { context: 'load', fallback: t('common.errLoad') }));
      setLedger([]);
      setCardYearRows([]);
    } else {
      const joined = (ledgerRes.data ?? []) as LedgerWithAssessment[];
      setLedger(joined as CapitalLedger[]);
      setCardYearRows(
        joined.map((row) => ({
          kind: row.kind,
          amount_eur: row.amount_eur,
          assessment_title: row.assessment?.title ?? null,
        })),
      );
    }
    const row = firstRow(balanceRes.data);
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
    if (opsRes.error) {
      setAptCharges(null);
      setAptReceipts(null);
    } else {
      const rows = opsRes.data ?? [];
      setAptCharges(sumCapitalOperationalCharges(rows));
      setAptReceipts(sumCapitalCashReceipts(rows));
    }
  }, [canSee, propertyId, supabase, t]);

  useEffect(() => {
    void loadLaunch();
    void loadRegister();
  }, [loadLaunch, loadRegister]);

  useEffect(() => {
    if (tab === 'charges') void loadYearCtx(chargeYear);
  }, [tab, chargeYear, loadYearCtx]);

  useEffect(() => {
    if (tab === 'payments') void loadJournal();
  }, [tab, loadJournal]);

  useEffect(() => {
    if (tab === 'history') void loadHistory();
  }, [tab, loadHistory]);

  useEffect(() => {
    if (tab === 'register' && view === 'card' && propertyId !== '') void loadCard();
  }, [tab, view, propertyId, loadCard]);

  // Default charge year: first allowed year (launch + 1), else the current Sofia year.
  useEffect(() => {
    if (chargeYearTouched || launch == null) return;
    setChargeYear(defaultCapitalChargeYear(launch.minChargeYear, sofiaCurrentYear()));
  }, [launch, chargeYearTouched]);

  // Read-only rate for the selected charge year (edited only in Финансы → Тарифы).
  useEffect(() => {
    if (!canSee) {
      setTariffAmount(null);
      setTariffRateNatural(null);
      setTariffRateLegal(null);
      setTariffValidFrom(null);
      return;
    }
    let cancelled = false;
    setTariffLoading(true);
    void supabase
      .rpc('get_applicable_capital_tariff', { p_billing_year: chargeYear })
      .then(({ data, error: rpcErr }) => {
        if (cancelled) return;
        setTariffLoading(false);
        if (rpcErr) {
          setTariffAmount(null);
          setTariffRateNatural(null);
          setTariffRateLegal(null);
          setTariffValidFrom(null);
          return;
        }
        const row = firstRow(
          data as {
            amount_eur?: number;
            rate_natural_eur?: number;
            rate_legal_eur?: number;
            valid_from?: string;
          }[] | null,
        );
        const natural =
          row?.rate_natural_eur != null
            ? Number(row.rate_natural_eur)
            : row?.amount_eur != null
              ? Number(row.amount_eur)
              : NaN;
        const legal = row?.rate_legal_eur != null ? Number(row.rate_legal_eur) : natural;
        const ok = Number.isFinite(natural) && natural > 0;
        setTariffAmount(ok ? natural : null);
        setTariffRateNatural(ok ? natural : null);
        setTariffRateLegal(ok && Number.isFinite(legal) && legal > 0 ? legal : ok ? natural : null);
        setTariffValidFrom(ok && row?.valid_from ? String(row.valid_from) : null);
      });
    return () => {
      cancelled = true;
    };
  }, [chargeYear, canSee, supabase]);

  // ---------- derived ----------
  const launchYear = launch?.launchYear ?? null;
  const minChargeYear = launch?.minChargeYear ?? null;
  const launchTokens = useMemo(
    () => ({
      launch: String(launchYear ?? ''),
      next: String(minChargeYear ?? (launchYear != null ? launchYear + 1 : '')),
    }),
    [launchYear, minChargeYear],
  );

  const ctxForYear = yearCtx && yearCtx.billingYear === chargeYear ? yearCtx : null;
  const chargeState = resolveCapitalChargeState({
    billingYear: chargeYear,
    launchYear,
    ctx: ctxForYear,
    rateOk: tariffLoading ? null : tariffAmount != null,
  });
  const canCharge = canSee;
  const bulkEnabled = isCapitalBulkChargeEnabled(chargeState, canCharge) && !bulkBusy;
  const launchBlockedSelected = chargeState === 'launch_blocked';

  const yearChoices = useMemo(
    () =>
      capitalChargeYearChoices({
        currentYear: sofiaCurrentYear(),
        selectedYear: chargeYear,
        launchYear,
        minChargeYear,
      }),
    [chargeYear, launchYear, minChargeYear],
  );

  const balances = useMemo(() => aggregateCapitalRepairBalances(aggRows), [aggRows]);
  const allRegisterRows = useMemo(
    () => buildUtilityFinanceRegisterRows(sorted, balances),
    [sorted, balances],
  );
  const registerRows = useMemo(
    () => sortUtilityFinanceRegisterRows(filterUtilityFinanceRegisterRows(allRegisterRows, filters)),
    [allRegisterRows, filters],
  );
  const filtersActive = utilityFinanceFiltersActive(filters);
  const fundCharges = useMemo(() => sumCapitalOperationalCharges(aggRows), [aggRows]);
  const fundReceipts = useMemo(() => sumCapitalCashReceipts(aggRows), [aggRows]);
  const debtApts = useMemo(
    () => allRegisterRows.filter((r) => r.status === 'debt').length,
    [allRegisterRows],
  );

  const journalRows = useMemo(
    () => filterCapitalJournalRows(journal, journalFilters),
    [journal, journalFilters],
  );
  const journalTotal = useMemo(() => sumCapitalJournalRows(journalRows), [journalRows]);
  const aptById = useMemo(() => new Map(sorted.map((p) => [p.id, p] as const)), [sorted]);

  const historyRows = useMemo(
    () => filterCapitalHistoryRows(historyRowsRaw, historyFilters),
    [historyRowsRaw, historyFilters],
  );
  const historyFiltersActive = capitalHistoryFiltersActive(historyFilters);

  const cardChargeRows = useMemo(
    () =>
      ledger.filter((r) => {
        const k = String(r.kind ?? '');
        return k === 'charge' || k === 'opening_obligation';
      }),
    [ledger],
  );
  const cardPaymentRows = useMemo(
    () => ledger.filter((r) => String(r.kind ?? '') === 'payment'),
    [ledger],
  );
  const cardOpeningSettlements = useMemo(
    () => ledger.filter((r) => String(r.kind ?? '') === 'opening_historical_settlement'),
    [ledger],
  );
  const cardYearBreakdown = useMemo(() => buildCapitalYearBreakdown(cardYearRows), [cardYearRows]);
  const cardYearCharge = useMemo(
    () => sumCapitalYearCharge(cardYearRows, chargeYear),
    [cardYearRows, chargeYear],
  );
  const cardCashReceipts = useMemo(() => sumCapitalCashReceipts(ledger), [ledger]);
  const cardOpeningCredit = useMemo(() => sumCapitalOpeningCredit(ledger), [ledger]);
  const cardOverpay = capitalStandingOverpay(balance.balance_eur);
  const cardDebt = capitalStandingDebt(balance.balance_eur);

  const filteredLedger = useMemo(
    () => filterCapitalLedgerRows(ledger, ledgerKindFilter),
    [ledger, ledgerKindFilter],
  );
  const ledgerFilterActive = capitalLedgerKindFilterActive(ledgerKindFilter);

  // Single-apartment charge preview (card). Skipped when the year is launch-blocked.
  useEffect(() => {
    if (
      !canSee ||
      view !== 'card' ||
      propertyId === '' ||
      tariffAmount == null ||
      launchBlockedSelected
    ) {
      setChargePreview(null);
      setChargePreviewError(null);
      setChargePreviewLoading(false);
      return;
    }
    let cancelled = false;
    setChargePreviewLoading(true);
    setChargePreview(null);
    setChargePreviewError(null);
    void supabase
      .rpc('capital_repair_charge_amount_for_year', {
        p_property_id: Number(propertyId),
        p_billing_year: chargeYear,
      })
      .then(({ data, error: rpcErr }) => {
        if (cancelled) return;
        setChargePreviewLoading(false);
        if (rpcErr) {
          const msg = rpcErr.message ?? '';
          const aptMatch = /apartment\s+([^\s]+)/i.exec(msg);
          setChargePreview(null);
          setChargePreviewError(
            /area_sqm|no valid area/i.test(msg)
              ? t('admin.errCapitalArea', { apt: aptMatch?.[1] ?? String(propertyId) })
              : toUserFacingMessage(
                  { message: msg },
                  t,
                  { context: 'finance', fallback: t(mapAdminRpcError(msg)) },
                ),
          );
          return;
        }
        const row = firstRow(data as ChargePreview[] | ChargePreview | null);
        if (!row || !(Number(row.amount_eur) > 0)) {
          setChargePreview(null);
          setChargePreviewError(t('admin.errCapitalTariff'));
          return;
        }
        setChargePreview({
          area_sqm: Number(row.area_sqm),
          rate_eur_per_sqm_year: Number(row.rate_eur_per_sqm_year),
          amount_eur: Number(row.amount_eur),
          subject_kind: String(row.subject_kind),
          apartment_number: row.apartment_number != null ? String(row.apartment_number) : null,
        });
        setChargePreviewError(null);
      });
    return () => {
      cancelled = true;
    };
  }, [
    canSee,
    view,
    propertyId,
    tariffAmount,
    launchBlockedSelected,
    chargeYear,
    supabase,
    t,
    chargeBusy,
    bulkBusy,
  ]);

  const reloadAll = useCallback(async () => {
    await Promise.all([
      loadRegister(),
      loadLaunch(),
      tab === 'charges' ? loadYearCtx(chargeYear) : Promise.resolve(),
      tab === 'payments' ? loadJournal() : Promise.resolve(),
      tab === 'history' ? loadHistory() : Promise.resolve(),
      tab === 'register' && view === 'card' && propertyId !== '' ? loadCard() : Promise.resolve(),
    ]);
  }, [
    chargeYear,
    loadCard,
    loadHistory,
    loadJournal,
    loadLaunch,
    loadRegister,
    loadYearCtx,
    propertyId,
    tab,
    view,
  ]);

  async function handleConfirmCapitalRepairOpening(e: FormEvent) {
    e.preventDefault();
    if (!canSee || propertyId === '' || openingConfirmBusy || !openingPending) return;
    const year = Number(openingYear) || (launchYear != null ? Number(launchYear) : NaN);
    const signed = Number(String(openingSignedAmount).replace(/\s/g, '').replace(',', '.'));
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      setError(t('admin.importIssue_billing_year_invalid'));
      return;
    }
    if (!Number.isFinite(signed)) {
      setError(t('admin.importIssue_opening_balance_eur_invalid'));
      return;
    }
    let assessed = 0;
    let paid = 0;
    let remaining = 0;
    let over = 0;
    if (signed > 0.0001) {
      assessed = Math.round(signed * 100) / 100;
      remaining = assessed;
    } else if (signed < -0.0001) {
      over = Math.round(Math.abs(signed) * 100) / 100;
    }
    setOpeningConfirmBusy(true);
    setError(null);
    setSuccess(null);
    const { data, error: rpcErr } = await supabase.rpc('admin_confirm_capital_repair_opening' as never, {
      p_property_id: Number(propertyId),
      p_billing_year: year,
      p_assessed_amount: assessed,
      p_historically_paid_amount: paid,
      p_remaining_debt: remaining,
      p_opening_overpayment: over,
      p_transition_date: null,
      p_source_reference: null,
      p_notes: null,
      p_idempotency_key: openingIdemRef.current,
    } as never);
    setOpeningConfirmBusy(false);
    if (rpcErr) {
      const msg = String(rpcErr.message ?? '');
      if (/conflict:existing_(opening|operational)/i.test(msg)) {
        setError(t('admin.feeOpeningConflictYear', { year: String(year) }));
      } else if (/already_confirmed|SKIPPED_EXISTING/i.test(msg)) {
        setSuccess(t('admin.feeOpeningAlreadyConfirmed'));
        setOpeningPending(false);
        setOpeningFormOpen(false);
      } else {
        setError(toUserFacingMessage(rpcErr, t, { context: 'finance', fallback: t('common.errFinance') }));
      }
      openingIdemRef.current = crypto.randomUUID();
      return;
    }
    const res = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
    if (res.idempotent === true || res.outcome === 'SKIPPED_EXISTING') {
      setSuccess(t('admin.feeOpeningAlreadyConfirmed'));
    } else {
      setSuccess(t('common.saved'));
    }
    setOpeningPending(false);
    setOpeningFormOpen(false);
    openingIdemRef.current = crypto.randomUUID();
    await reloadAll();
  }

  // ---------- navigation ----------
  function resetCardForm() {
    setLastPayReceipt(null);
    setLastPayAmountLabel(null);
    setPayOpen(false);
    setPayAmount('');
    setPayNote('');
    setPayReceiptFields(emptyReceiptPayFields());
    setLedgerKindFilter('all');
  }

  function openCard(id: number) {
    preferRegisterRef.current = false;
    setPropertyId(id);
    onPropertyChange?.(id);
    setView('card');
    setSuccess(null);
    setError(null);
    resetCardForm();
  }

  function backToRegister() {
    preferRegisterRef.current = true;
    setView('register');
    setPropertyId('');
    onPropertyChange?.('');
    setSuccess(null);
    setError(null);
    setPayOpen(false);
    void loadRegister();
  }

  function handleTab(id: string) {
    const next = parseCapitalAdminTab(id);
    if (view === 'card' || propertyId !== '') backToRegister();
    setError(null);
    setSuccess(null);
    onTabChange?.(next);
  }

  // ---------- actions ----------
  function rpcFail(message: string | undefined, opts?: { financeUncertain?: boolean }) {
    setSuccess(null);
    const msg = message ?? '';
    if (/launch_year_blocks_charge/i.test(msg)) {
      setError(t('admin.capitalLaunchBlocked', launchTokens));
      return;
    }
    if (/opening_import_blocks_charge/i.test(msg)) {
      setError(t('admin.capitalOpeningBlocked'));
      return;
    }
    setError(
      toUserFacingMessage(
        { message: msg },
        t,
        {
          context: 'finance',
          financeUncertain: opts?.financeUncertain,
          fallback: t(mapAdminRpcError(msg)),
        },
      ),
    );
  }

  async function handleSingleCharge() {
    if (!canSee || propertyId === '' || chargeBusy || launchBlockedSelected) return;
    if (tariffAmount == null) {
      setError(t('admin.errCapitalTariff'));
      return;
    }
    if (!chargePreview || !(chargePreview.amount_eur > 0)) {
      setError(chargePreviewError ?? t('admin.errCapitalTariff'));
      return;
    }
    setChargeBusy(true);
    setError(null);
    setSuccess(null);
    const { data: assessmentId, error: ensureErr } = await supabase.rpc(
      'ensure_capital_repair_year_assessment',
      { p_billing_year: chargeYear },
    );
    if (ensureErr || !assessmentId) {
      setChargeBusy(false);
      rpcFail(ensureErr?.message);
      return;
    }
    const key = chargeKeyRef.current;
    const { data, error: rpcErr } = await supabase.rpc('charge_capital_repair', {
      p_property_id: Number(propertyId),
      p_assessment_id: String(assessmentId),
      p_billing_year: chargeYear,
      p_note: null,
      p_idempotency_key: key,
    });
    setChargeBusy(false);
    if (rpcErr) {
      const msg = rpcErr.message ?? '';
      const aptMatch = /apartment\s+([^\s]+)/i.exec(msg);
      if (/area_sqm|no valid area/i.test(msg)) {
        setError(t('admin.errCapitalArea', { apt: aptMatch?.[1] ?? String(propertyId) }));
        return;
      }
      rpcFail(msg);
      return;
    }
    const row = firstRow(
      data as { amount_eur?: number }[] | { amount_eur?: number } | null,
    );
    const saved = row?.amount_eur != null ? Number(row.amount_eur) : null;
    if (saved != null && Math.abs(saved - chargePreview.amount_eur) > 0.001) {
      setError(t('admin.errGeneric'));
      return;
    }
    chargeKeyRef.current = crypto.randomUUID();
    setSuccess(
      `${t('admin.okCapitalCharge')} ${formatEur(saved ?? chargePreview.amount_eur, locale)}`,
    );
    await reloadAll();
  }

  async function handleBulkCharge() {
    if (!bulkEnabled || !ctxForYear) return;
    const existing = ctxForYear.apartmentsCharged + ctxForYear.apartmentsOpening;
    const ok = await confirm({
      title: t('common.confirmAction'),
      description: t('confirm.bulkCapitalTariff', {
        year: chargeYear,
        total: ctxForYear.apartmentsTotal,
        existing,
        will: ctxForYear.apartmentsRemaining,
      }),
      confirmLabel: t('common.yes'),
      cancelLabel: t('common.cancel'),
      tone: 'default',
    });
    if (!ok) return;
    setBulkBusy(true);
    setBulkResult(null);
    setError(null);
    const { data, error: rpcErr } = await supabase.rpc('charge_capital_repair_year_bulk', {
      p_billing_year: chargeYear,
      p_note: null,
    });
    setBulkBusy(false);
    if (rpcErr) {
      const msg = rpcErr.message ?? '';
      if (/could not find the function/i.test(msg)) {
        setError(t('admin.bulkUnavailable'));
        return;
      }
      rpcFail(msg);
      return;
    }
    const rawRow = (Array.isArray(data) ? data[0] : data) as { reason?: string } | null;
    if (rawRow?.reason === 'launch_year_blocks_charge') {
      setError(t('admin.capitalLaunchBlocked', launchTokens));
      await reloadAll();
      return;
    }
    const summary = readBulkAccrualSummary(data);
    if (!summary) {
      setError(t('admin.errGeneric'));
      return;
    }
    setBulkResult(t('admin.bulkResult', { created: summary.created, skipped: summary.skipped_existing }));
    setSuccess(null);
    if (summary.created > 0) {
      void import('@/lib/email/eventProducers')
        .then(async ({ notifyPropertyOwnersEvent }) => {
          for (const p of sorted) {
            await notifyPropertyOwnersEvent(supabase, {
              eventKey: 'capital_repair_assessment_posted',
              propertyId: Number(p.id),
              entityId: `cr_assess:${p.id}:${chargeYear}`,
              payload: { billing_year: chargeYear },
            });
          }
        })
        .catch(() => undefined);
    }
    await reloadAll();
  }

  async function handlePay(e: React.FormEvent) {
    e.preventDefault();
    if (!canSee || propertyId === '' || payBusy || payBusyRef.current) return;
    const amount = Number(String(payAmount).replace(',', '.'));
    if (!(amount > 0) || Number.isNaN(amount)) {
      setError(t('admin.errAmount'));
      return;
    }
    payBusyRef.current = true;
    setPayBusy(true);
    setLastPayReceipt(null);
    setError(null);
    const idem = payKeyRef.current;
    const intentErr = await prepareReceiptIntentFromFields(supabase, idem, payReceiptFields);
    if (intentErr) {
      payBusyRef.current = false;
      setPayBusy(false);
      setError(
        toUserFacingMessage(intentErr, t, {
          context: 'finance',
          fallback: t('admin.errReceiptPrepare'),
        }),
      );
      return;
    }
    const { data: payData, error: rpcErr } = await supabase.rpc('record_capital_repair_payment', {
      p_property_id: Number(propertyId),
      p_amount_eur: amount,
      p_note: payNote.trim() || null,
      p_idempotency_key: idem,
    });
    if (rpcErr) {
      payBusyRef.current = false;
      setPayBusy(false);
      rpcFail(rpcErr.message);
      return;
    }
    const ledgerId = ledgerIdFromPaymentRpc(payData);
    const amountLabel = formatEur(amount, locale);
    setLastPayAmountLabel(amountLabel);
    const finished = await finishReceiptForPayment(supabase, 'capital_repair', ledgerId);
    setLastPayReceipt(finished.receipt);
    payKeyRef.current = crypto.randomUUID();
    setPayAmount('');
    setPayNote('');
    setPayReceiptFields(emptyReceiptPayFields());
    payBusyRef.current = false;
    setPayBusy(false);
    setError(null);
    setSuccess(
      finished.pdfError && finished.receipt
        ? t('receipt.paySavedPdfFailed')
        : t('receipt.payRegistered', { amount: amountLabel }),
    );
    void import('@/lib/email/eventProducers')
      .then(({ notifyPropertyOwnersEvent }) =>
        notifyPropertyOwnersEvent(supabase, {
          eventKey: 'capital_repair_payment_recorded',
          propertyId: Number(propertyId),
          entityId: `cr_pay:${propertyId}:${amount}`,
          payload: { amount_eur: amount },
        })
      )
      .catch(() => undefined);
    await reloadAll();
  }

  if (!canSee) {
    return (
      <div className={cardClass}>
        <p className="text-sm text-secondary">{t('admin.capitalNoAccess')}</p>
      </div>
    );
  }

  // ---------- views ----------
  const tabBar = (
    <AdminTabBar
      tabs={[
        { id: 'register', label: t('admin.capitalTabRegister') },
        { id: 'charges', label: t('admin.capitalTabCharges') },
        { id: 'payments', label: t('admin.capitalTabPayments') },
        { id: 'history', label: t('admin.capitalTabHistory') },
      ]}
      active={tab}
      onChange={handleTab}
    />
  );

  const launchNotice =
    launch?.hasLaunchYear && launchYear != null ? (
      <AdminInlineAlert tone="info">{t('admin.capitalLaunchNotice', launchTokens)}</AdminInlineAlert>
    ) : null;

  const alerts = (
    <>
      {error ? (
        <AdminInlineAlert tone="danger" onDismiss={() => setError(null)}>
          {error}
        </AdminInlineAlert>
      ) : null}
      {success ? (
        <AdminInlineAlert tone="success" onDismiss={() => setSuccess(null)}>
          {success}
        </AdminInlineAlert>
      ) : null}
    </>
  );

  function statusBadge(status: 'debt' | 'credit' | 'settled') {
    if (status === 'debt') return <StatusBadge label={t('admin.balDebt')} tone="danger" />;
    if (status === 'credit') return <StatusBadge label={t('admin.balOver')} tone="success" />;
    return <StatusBadge label={t('admin.balSettled')} tone="neutral" />;
  }

  // ----- register -----
  function renderRegister() {
    const loadingAll = registerLoading && aggRows.length === 0;
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <AdminMetricCard
            label={t('admin.capitalCardCharges')}
            value={loadingAll ? t('common.loading') : formatEur(fundCharges, locale)}
            secondary={t('admin.capitalOperationalHint')}
            onClick={() => handleTab('charges')}
          />
          <AdminMetricCard
            label={t('admin.capitalCardReceipts')}
            value={loadingAll ? t('common.loading') : formatEur(fundReceipts, locale)}
            secondary={t('admin.capitalOperationalHint')}
            onClick={() => handleTab('payments')}
          />
          <AdminMetricCard
            label={t('admin.capitalFundCash')}
            value={registerLoading && fundCash == null ? t('common.loading') : fundCash == null ? '—' : formatEur(fundCash, locale)}
            secondary={t('admin.capitalFundCashHint')}
          />
          <AdminMetricCard
            label={t('admin.capitalDebtApts')}
            value={loadingAll ? t('common.loading') : String(debtApts)}
            alert={debtApts > 0}
          />
        </div>

        <div className="flex flex-wrap items-end gap-2 rounded-[14px] border border-border bg-surface px-3 py-2">
          <label className="text-xs text-secondary">
            {t('admin.sfFilterApt')}
            <input
              value={filters.query}
              onChange={(e) => setFilters((f) => ({ ...f, query: e.target.value }))}
              placeholder={t('admin.sfFilterAptPh')}
              className={`mt-1 block w-44 ${fieldClass}`}
            />
          </label>
          <label className="text-xs text-secondary">
            {t('admin.sfFilterStatus')}
            <select
              value={filters.status}
              onChange={(e) =>
                setFilters((f) => ({ ...f, status: e.target.value as UtilityFinanceStatusFilter }))
              }
              className={`mt-1 block w-40 ${fieldClass}`}
            >
              <option value="all">{t('admin.sfFilterAll')}</option>
              <option value="debt">{t('admin.sfFilterDebt')}</option>
              <option value="credit">{t('admin.balOver')}</option>
              <option value="settled">{t('admin.sfFilterSettled')}</option>
            </select>
          </label>
          <AdminSecondaryButton
            type="button"
            disabled={!filtersActive}
            onClick={() => setFilters(EMPTY_UTILITY_FINANCE_FILTERS)}
          >
            {t('admin.sfFilterReset')}
          </AdminSecondaryButton>
          <p className="ml-auto text-xs text-muted">
            {t('admin.sfRegisterCount', { n: String(registerRows.length) })}
          </p>
        </div>

        {loadingAll ? (
          <p className="text-sm text-muted">{t('common.loading')}</p>
        ) : sorted.length === 0 ? (
          <AdminEmptyState title={t('admin.capitalRegisterEmpty')} />
        ) : registerRows.length === 0 ? (
          <AdminEmptyState title={t('admin.sfRegisterEmptyFilter')} />
        ) : (
          <AdminTableShell>
            <table className="w-full min-w-[36rem] text-sm">
              <thead>
                <tr className={adminTableHeadRowClass}>
                  <th className={adminTableCellClass}>{t('form.colApt')}</th>
                  <th className={adminTableCellClass}>{t('form.colOwner')}</th>
                  <th className={adminTableCellClass}>{t('admin.utilFinColBalance')}</th>
                  <th className={adminTableCellClass}>{t('admin.status')}</th>
                </tr>
              </thead>
              <tbody>
                {registerRows.map((row) => (
                  <tr
                    key={row.propertyId}
                    tabIndex={0}
                    role="button"
                    aria-label={t('admin.utilFinOpenCard')}
                    data-capital-row={row.propertyId}
                    className={`${adminTableRowClass} cursor-pointer hover:bg-hover/70 focus-visible:bg-hover/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40`}
                    onClick={() => openCard(row.propertyId)}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter' && e.key !== ' ') return;
                      e.preventDefault();
                      openCard(row.propertyId);
                    }}
                  >
                    <td className={adminTableCellClass}>
                      {(() => {
                        const prop = properties.find((p) => p.id === row.propertyId);
                        return prop ? (
                          <PropertyIdentityLink property={prop} module="capital" />
                        ) : (
                          `№ ${row.apartmentNumber}`
                        );
                      })()}
                    </td>
                    <td className={adminTableCellClass}>{row.ownerName ?? '—'}</td>
                    <td
                      className={`${adminTableCellClass} tabular-nums ${row.status === 'debt' ? 'text-danger' : ''}`}
                    >
                      {formatEur(Math.abs(row.balanceEur), locale)}
                    </td>
                    <td className={adminTableCellClass}>{statusBadge(row.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </AdminTableShell>
        )}
      </div>
    );
  }

  // ----- charges -----
  function renderRateReadonly() {
    return (
      <div>
        <p className="text-xs text-muted">{t('admin.capitalRateReadonly')}</p>
        <p className="mt-1 text-sm font-semibold tabular-nums text-foreground">
          {tariffLoading
            ? t('common.loading')
            : tariffAmount != null
              ? tariffRateNatural != null &&
                tariffRateLegal != null &&
                Math.abs(tariffRateNatural - tariffRateLegal) > 0.0001
                ? `${t('admin.capitalTariffNatural')}: ${formatEur(tariffRateNatural, locale)} · ${t('admin.capitalTariffLegal')}: ${formatEur(tariffRateLegal, locale)}`
                : formatEur(tariffAmount, locale)
              : t('admin.capitalNoTariff')}
        </p>
        <p className="mt-1 text-xs text-muted">
          {t('admin.perSqmYear')}
          {tariffAmount != null && tariffValidFrom
            ? ` · ${t('admin.validFrom')} ${formatOwnerDate(tariffValidFrom, locale)} · ${t('admin.capitalTariffUntilChange')}`
            : null}
        </p>
      </div>
    );
  }

  function renderCharges() {
    const ctx = ctxForYear;
    const existing = ctx ? ctx.apartmentsCharged + ctx.apartmentsOpening : 0;
    const noticeKey = capitalChargeStateNoticeKey(chargeState);
    return (
      <div className="space-y-4">
        <div className={cardClass}>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <label className="text-sm text-secondary">
              {t('admin.sfYear')}
              <select
                value={chargeYear}
                onChange={(e) => {
                  setChargeYearTouched(true);
                  setChargeYear(Number(e.target.value));
                  setBulkResult(null);
                  setError(null);
                }}
                className={`mt-1 block w-32 ${fieldClass}`}
              >
                {yearChoices.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </label>
            {onOpenTariffs ? (
              <AdminSecondaryButton type="button" onClick={onOpenTariffs}>
                {t('admin.capitalEditInTariffs')}
              </AdminSecondaryButton>
            ) : null}
          </div>

          <p className="mt-3 text-sm text-secondary">{t('admin.capitalChargeAllHint')}</p>

          <div className="mt-4">{renderRateReadonly()}</div>

          {yearCtxLoading && !ctx && chargeState !== 'launch_blocked' ? (
            <p className="mt-4 text-sm text-muted">{t('common.loading')}</p>
          ) : (
            <>
              {ctx ? (
                <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
                  <div>
                    <dt className="text-xs text-muted">{t('admin.bulkTotal')}</dt>
                    <dd className="font-medium tabular-nums">{ctx.apartmentsTotal}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">
                      {t('admin.feeChargedYear', { year: String(chargeYear) })}
                    </dt>
                    <dd className="font-medium tabular-nums">{existing}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">{t('admin.bulkWill')}</dt>
                    <dd className="font-medium tabular-nums">{ctx.apartmentsRemaining}</dd>
                  </div>
                </dl>
              ) : null}

              {chargeState === 'launch_blocked' ? (
                <div className="mt-4" data-capital-charge-state="launch_blocked">
                  <AdminInlineAlert tone="warning">
                    {t('admin.capitalLaunchBlocked', launchTokens)}
                  </AdminInlineAlert>
                </div>
              ) : chargeState === 'calc_impossible' ? (
                <div className="mt-4" data-capital-charge-state="calc_impossible">
                  <AdminInlineAlert tone="warning">{t(noticeKey ?? 'admin.capitalChargeImpossible')}</AdminInlineAlert>
                </div>
              ) : chargeState === 'all_charged' ? (
                <div className="mt-4" data-capital-charge-state="all_charged">
                  <AdminInlineAlert tone="info">{t(noticeKey ?? 'admin.capitalChargeAllCharged')}</AdminInlineAlert>
                </div>
              ) : chargeState === 'remaining' && ctx ? (
                <p className="mt-4 text-sm text-secondary" data-capital-charge-state="remaining">
                  {t('admin.capitalChargeRemaining', {
                    n: String(ctx.apartmentsRemaining),
                    total: String(ctx.apartmentsTotal),
                  })}
                </p>
              ) : null}

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <AdminPrimaryButton
                  type="button"
                  disabled={!bulkEnabled}
                  onClick={() => void handleBulkCharge()}
                >
                  {bulkBusy ? t('common.saving') : t('admin.capitalChargeAll')}
                </AdminPrimaryButton>
              </div>
              {bulkResult ? <p className="mt-3 text-sm text-secondary">{bulkResult}</p> : null}
            </>
          )}
        </div>
      </div>
    );
  }

  // ----- payments journal -----
  function renderPayments() {
    return (
      <div className="space-y-4">
        <div className={cardClass}>
          <p className={labelClass}>{t('admin.capitalPaymentsJournal')}</p>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className="text-xs text-secondary">
              {t('admin.feeFilterDateFrom')}
              <input
                type="date"
                value={journalFilters.from}
                max={journalFilters.to || undefined}
                onChange={(e) => setJournalFilters((f) => ({ ...f, from: e.target.value }))}
                className={`mt-1 block w-40 ${fieldClass}`}
              />
            </label>
            <label className="text-xs text-secondary">
              {t('admin.feeFilterDateTo')}
              <input
                type="date"
                value={journalFilters.to}
                min={journalFilters.from || undefined}
                onChange={(e) => setJournalFilters((f) => ({ ...f, to: e.target.value }))}
                className={`mt-1 block w-40 ${fieldClass}`}
              />
            </label>
            <label className="text-xs text-secondary">
              {t('admin.aptLabel')}
              <select
                value={journalFilters.propertyId === '' ? '' : String(journalFilters.propertyId)}
                onChange={(e) =>
                  setJournalFilters((f) => ({
                    ...f,
                    propertyId: e.target.value === '' ? '' : Number(e.target.value),
                  }))
                }
                className={`mt-1 block w-44 ${fieldClass}`}
              >
                <option value="">{t('admin.sfFilterAll')}</option>
                {sorted.map((p) => (
                  <option key={p.id} value={p.id}>
                    {formatPropertyIdentity(p, t)}
                    {p.owner_name ? ` — ${p.owner_name}` : ''}
                  </option>
                ))}
              </select>
            </label>
            <AdminSecondaryButton
              type="button"
              disabled={!capitalJournalFiltersActive(journalFilters)}
              onClick={() => setJournalFilters(EMPTY_CAPITAL_JOURNAL_FILTERS)}
            >
              {t('admin.sfFilterReset')}
            </AdminSecondaryButton>
            <p className="ml-auto text-xs text-muted">
              {t('admin.kindPayment')}: {formatEur(journalTotal, locale)}
            </p>
          </div>
        </div>

        {journalLoading ? (
          <p className="text-sm text-muted">{t('common.loading')}</p>
        ) : journalRows.length === 0 ? (
          <AdminEmptyState title={t('admin.capitalJournalEmpty')} />
        ) : (
          <AdminTableShell>
            <table className="w-full min-w-[40rem] text-sm">
              <thead>
                <tr className={adminTableHeadRowClass}>
                  <th className={adminTableCellClass}>{t('admin.feePayDate')}</th>
                  <th className={adminTableCellClass}>{t('form.colApt')}</th>
                  <th className={adminTableCellClass}>{t('admin.amount')}</th>
                  <th className={adminTableCellClass}>{t('admin.note')}</th>
                  <th className={adminTableCellClass}>{t('receipt.open')}</th>
                </tr>
              </thead>
              <tbody>
                {journalRows.map((row) => {
                  const apt = aptById.get(row.property_id);
                  return (
                    <tr key={row.id} className={adminTableRowClass}>
                      <td className={`${adminTableCellClass} tabular-nums`}>
                        {formatOwnerDateTime(row.created_at, locale)}
                      </td>
                      <td className={adminTableCellClass}>
                        {apt ? (
                          <PropertyIdentityLink property={apt} module="capital" compact />
                        ) : (
                          `#${row.property_id}`
                        )}
                        {apt?.owner_name ? (
                          <div className="text-[10px] text-muted">{apt.owner_name}</div>
                        ) : null}
                      </td>
                      <td className={`${adminTableCellClass} tabular-nums`}>
                        {formatEur(Number(row.amount_eur), locale)}
                      </td>
                      <td className={`${adminTableCellClass} text-secondary`}>{row.note ?? '—'}</td>
                      <td className={`${adminTableCellClass} align-top`}>
                        <LedgerPaymentReceiptCell
                          supabase={supabase}
                          module="capital_repair"
                          ledgerId={String(row.id)}
                          kind={row.kind}
                          onFillUk={goFillUk}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </AdminTableShell>
        )}
        {journal.length >= JOURNAL_LIMIT ? (
          <p className="text-xs text-muted">{t('admin.sfRegisterCount', { n: String(JOURNAL_LIMIT) })}+</p>
        ) : null}
      </div>
    );
  }

  // ----- complex operations history -----
  function renderHistory() {
    return (
      <div className="space-y-4">
        <div className={cardClass}>
          <p className={labelClass}>{t('admin.capitalTabHistory')}</p>
          <p className="mt-1 text-xs text-muted">{t('admin.capitalHistoryHint')}</p>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className="text-xs text-secondary">
              {t('admin.aptLabel')}
              <select
                value={historyFilters.propertyId === '' ? '' : String(historyFilters.propertyId)}
                onChange={(e) =>
                  setHistoryFilters((f) => ({
                    ...f,
                    propertyId: e.target.value === '' ? '' : Number(e.target.value),
                  }))
                }
                className={`mt-1 block w-44 ${fieldClass}`}
              >
                <option value="">{t('admin.sfFilterAll')}</option>
                {sorted.map((p) => (
                  <option key={p.id} value={p.id}>
                    {formatPropertyIdentity(p, t)}
                    {p.owner_name ? ` — ${p.owner_name}` : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-secondary">
              {t('admin.feeFilterDateFrom')}
              <input
                type="date"
                value={historyFilters.from}
                max={historyFilters.to || undefined}
                onChange={(e) => setHistoryFilters((f) => ({ ...f, from: e.target.value }))}
                className={`mt-1 block w-40 ${fieldClass}`}
              />
            </label>
            <label className="text-xs text-secondary">
              {t('admin.feeFilterDateTo')}
              <input
                type="date"
                value={historyFilters.to}
                min={historyFilters.from || undefined}
                onChange={(e) => setHistoryFilters((f) => ({ ...f, to: e.target.value }))}
                className={`mt-1 block w-40 ${fieldClass}`}
              />
            </label>
            <label className="text-xs text-secondary">
              {t('admin.capitalLedgerFilter')}
              <select
                value={historyFilters.kind}
                onChange={(e) =>
                  setHistoryFilters((f) => ({
                    ...f,
                    kind: e.target.value as CapitalLedgerKindFilter,
                  }))
                }
                className={`mt-1 block w-40 ${fieldClass}`}
              >
                <option value="all">{t('admin.capitalFilterAll')}</option>
                <option value="charge">{t('admin.kindCharge')}</option>
                <option value="payment">{t('admin.kindPayment')}</option>
                <option value="adjustment">{t('admin.capitalFilterAdj')}</option>
              </select>
            </label>
            <AdminSecondaryButton
              type="button"
              disabled={!historyFiltersActive}
              onClick={() => setHistoryFilters(EMPTY_CAPITAL_HISTORY_FILTERS)}
            >
              {t('admin.sfFilterReset')}
            </AdminSecondaryButton>
            <p className="ml-auto text-xs text-muted">
              {t('admin.sfRegisterCount', { n: String(historyRows.length) })}
            </p>
          </div>
        </div>

        {historyLoading ? (
          <p className="text-sm text-muted">{t('common.loading')}</p>
        ) : historyRows.length === 0 ? (
          <AdminEmptyState title={t('admin.capitalHistoryEmpty')} />
        ) : (
          <AdminTableShell>
            <table className="w-full min-w-[44rem] text-sm">
              <thead>
                <tr className={adminTableHeadRowClass}>
                  <th className={adminTableCellClass}>{t('admin.date')}</th>
                  <th className={adminTableCellClass}>{t('form.colApt')}</th>
                  <th className={adminTableCellClass}>{t('admin.kind')}</th>
                  <th className={adminTableCellClass}>{t('admin.amount')}</th>
                  <th className={adminTableCellClass}>{t('admin.note')}</th>
                  <th className={adminTableCellClass}>{t('receipt.open')}</th>
                </tr>
              </thead>
              <tbody>
                {historyRows.map((row) => {
                  const apt = aptById.get(row.property_id);
                  return (
                    <tr
                      key={row.id}
                      className={`${adminTableRowClass} cursor-pointer hover:bg-hover/70`}
                      onClick={() => openCard(row.property_id)}
                    >
                      <td className={`${adminTableCellClass} tabular-nums`}>
                        {formatOwnerDateTime(row.created_at, locale)}
                      </td>
                      <td className={adminTableCellClass}>
                        {apt ? (
                          <PropertyIdentityLink property={apt} module="capital" compact />
                        ) : (
                          `#${row.property_id}`
                        )}
                      </td>
                      <td className={adminTableCellClass}>{t(capitalOpsHistoryTitleKey(row.kind))}</td>
                      <td className={`${adminTableCellClass} tabular-nums`}>
                        {formatEur(Number(row.amount_eur), locale)}
                      </td>
                      <td className={`${adminTableCellClass} text-secondary`}>{row.note ?? '—'}</td>
                      <td
                        className={`${adminTableCellClass} align-top`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <LedgerPaymentReceiptCell
                          supabase={supabase}
                          module="capital_repair"
                          ledgerId={String(row.id)}
                          kind={row.kind}
                          onFillUk={goFillUk}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </AdminTableShell>
        )}
        {historyRowsRaw.length >= JOURNAL_LIMIT ? (
          <p className="text-xs text-muted">{t('admin.sfRegisterCount', { n: String(JOURNAL_LIMIT) })}+</p>
        ) : null}
      </div>
    );
  }

  // ----- apartment card -----
  function renderCard() {
    const aptTone = balanceTone(balance.balance_eur);
    const aptStatus =
      aptTone === 'debt' ? t('admin.balDebt') : aptTone === 'over' ? t('admin.balOver') : t('admin.balSettled');
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <AdminSecondaryButton type="button" onClick={backToRegister}>
            {t('admin.capitalBackToRegister')}
          </AdminSecondaryButton>
          <p className="text-sm text-secondary">
            {selected ? (
              <PropertyIdentityLink property={selected} module="capital" showOpenAction />
            ) : (
              '—'
            )}
            {selected?.owner_name ? ` — ${selected.owner_name}` : ''}
          </p>
        </div>

        {alerts}

        {openingPending ? (
          <div className={cardClass} data-capital-repair-opening-pending="1">
            <AdminInlineAlert tone="warning">
              {t('admin.openingStatus_needs_initial_capital_repair')}
            </AdminInlineAlert>
            {!openingFormOpen ? (
              <div className="mt-3">
                <AdminPrimaryButton
                  type="button"
                  disabled={!canSee}
                  onClick={() => setOpeningFormOpen(true)}
                  data-testid="cr-enter-opening"
                >
                  {t('admin.capitalEnterOpeningBalance')}
                </AdminPrimaryButton>
              </div>
            ) : (
              <form
                className="mt-4 space-y-3"
                onSubmit={(e) => {
                  void handleConfirmCapitalRepairOpening(e);
                }}
              >
                <p className="text-sm font-medium text-foreground">{t('admin.feeOpeningConfirmTitle')}</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="block text-xs text-secondary">
                    {t('admin.firstRunCrAutoYearLabel')}
                    <p className="mt-1 text-sm font-medium text-foreground" data-testid="cr-opening-year">
                      {openingYear || (launchYear != null ? String(launchYear) : '—')}
                    </p>
                    <span className="mt-1 block text-[11px] text-muted">
                      {t('admin.firstRunCrAutoYearHint')}
                    </span>
                  </div>
                  <label className="block text-xs text-secondary sm:col-span-2">
                    {t('admin.firstRunSfColAmount')}
                    <input
                      className={`mt-1 ${fieldClass}`}
                      type="text"
                      inputMode="decimal"
                      value={openingSignedAmount}
                      onChange={(ev) => setOpeningSignedAmount(ev.target.value)}
                      placeholder="70,70 / -50,00 / 0"
                      required
                      data-testid="cr-opening-amount"
                    />
                    <span className="mt-1 block text-[11px] text-muted">
                      {t('admin.firstRunCrImportColumnsHint')}
                    </span>
                  </label>
                </div>
                <AdminPrimaryButton type="submit" disabled={openingConfirmBusy || !canSee}>
                  {openingConfirmBusy ? t('common.saving') : t('admin.feeOpeningConfirmSubmit')}
                </AdminPrimaryButton>
              </form>
            )}
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <AdminMetricCard
            label={t('admin.capitalYearCharge', { year: String(chargeYear) })}
            value={cardLoading ? t('common.loading') : formatEur(cardYearCharge, locale)}
            secondary={t('admin.capitalYearChargeHint')}
          />
          <AdminMetricCard
            label={t('admin.capitalTotalBalance')}
            value={cardLoading ? t('common.loading') : formatEur(cardDebt || cardOverpay, locale)}
            secondary={aptStatus}
            alert={aptTone === 'debt'}
          />
          <AdminMetricCard
            label={t('admin.capitalCashReceipts')}
            value={cardLoading || aptReceipts == null ? t('common.loading') : formatEur(cardCashReceipts, locale)}
            secondary={t('admin.capitalCashReceiptsHint')}
          />
        </div>

        {/* Outstanding breakdown: year lines vs total */}
        <div className={cardClass} data-capital-breakdown="1">
          <p className={labelClass}>{t('admin.capitalOutstandingBreakdown')}</p>
          <dl className="mt-3 grid gap-2 text-sm">
            {cardLoading && cardYearBreakdown.length === 0 ? (
              <p className="text-muted">{t('common.loading')}</p>
            ) : (
              <>
                {cardYearBreakdown.map((line) => (
                  <div key={`${line.kind}-${line.year}`} className="flex justify-between gap-3">
                    <dt
                      className={`text-secondary ${
                        line.kind === 'charge' && line.year === chargeYear ? 'font-medium text-foreground' : ''
                      }`}
                    >
                      {line.kind === 'opening'
                        ? t('admin.capitalOpeningDebtYear', { year: String(line.year) })
                        : t('admin.capitalYearCharge', { year: String(line.year) })}
                    </dt>
                    <dd
                      className="font-medium tabular-nums"
                      data-breakdown={line.kind === 'opening' ? 'opening' : `year-${line.year}`}
                    >
                      {formatEur(line.amountEur, locale)}
                    </dd>
                  </div>
                ))}
                <div className="flex justify-between gap-3 border-t border-border pt-2">
                  <dt className="font-semibold text-foreground">{t('admin.capitalTotalBalance')}</dt>
                  <dd
                    className={`text-base font-semibold tabular-nums ${cardDebt > 0 ? 'text-danger' : ''}`}
                    data-breakdown="total"
                  >
                    {formatEur(cardDebt || cardOverpay, locale)}
                  </dd>
                </div>
                <div className="flex justify-between gap-3 text-xs">
                  <dt className="text-muted">{t('admin.capitalCashReceipts')}</dt>
                  <dd className="tabular-nums" data-breakdown="cash">
                    {formatEur(cardCashReceipts, locale)}
                  </dd>
                </div>
                {cardOpeningCredit > 0 || cardOverpay > 0 ? (
                  <div className="flex justify-between gap-3 text-xs">
                    <dt className="text-muted">{t('admin.capitalOverpayCredit')}</dt>
                    <dd className="tabular-nums text-success" data-breakdown="overpay">
                      {formatEur(Math.max(cardOpeningCredit, cardOverpay), locale)}
                    </dd>
                  </div>
                ) : null}
              </>
            )}
          </dl>
          <div className="mt-4">
            <AdminPrimaryButton
              type="button"
              disabled={payBusy}
              onClick={() => {
                setPayOpen((open) => {
                  const next = !open;
                  if (next && !payAmount && balance.balance_eur > 0) {
                    setPayAmount(balance.balance_eur.toFixed(2));
                  }
                  return next;
                });
              }}
            >
              {t('admin.capitalRegisterPay')}
            </AdminPrimaryButton>
          </div>
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
          {payOpen ? (
            <form onSubmit={handlePay} className="mt-4 space-y-3 border-t border-border pt-4">
              <p className="text-sm text-secondary">{t('admin.capitalCardPayLead')}</p>
              <input
                className={fieldClass}
                type="number"
                min="0.01"
                step="0.01"
                placeholder={t('admin.amountEur')}
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
                required
                disabled={payBusy}
              />
              <input
                className={fieldClass}
                placeholder={t('admin.noteOptional')}
                value={payNote}
                onChange={(e) => setPayNote(e.target.value)}
                disabled={payBusy}
              />
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
          ) : null}
        </div>

        {/* Secondary: charge this apartment */}
        <div className={cardClass}>
          <p className={labelClass}>{t('admin.capitalChargeOneTitle')}</p>
          <p className="mt-2 text-sm text-secondary">{t('admin.capitalChargeOneHint')}</p>
          <label className="mt-3 grid gap-1 text-sm text-secondary">
            {t('admin.sfYear')}
            <select
              value={chargeYear}
              onChange={(e) => {
                setChargeYearTouched(true);
                setChargeYear(Number(e.target.value));
                setSuccess(null);
                setError(null);
              }}
              className={`block w-32 ${fieldClass}`}
            >
              {yearChoices.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
          <div className="mt-3 rounded-lg border border-border bg-surface-secondary/40 px-3 py-2">
            <p className="text-xs text-muted">{t('admin.capitalChargePreview')}</p>
            {launchBlockedSelected ? (
              <p className="mt-1 text-sm text-warning">{t('admin.capitalLaunchBlocked', launchTokens)}</p>
            ) : chargePreviewLoading || tariffLoading ? (
              <p className="mt-1 text-sm text-secondary">{t('common.loading')}</p>
            ) : chargePreview ? (
              <>
                <p className="mt-1 text-sm font-semibold tabular-nums text-foreground">
                  {t('admin.capitalChargePreviewLine', {
                    area: String(chargePreview.area_sqm),
                    rate: chargePreview.rate_eur_per_sqm_year.toFixed(2),
                    amount: formatEur(chargePreview.amount_eur, locale),
                  })}
                </p>
                <p className="mt-1 text-xs text-secondary">
                  {t('admin.capitalChargePreviewSubject', {
                    subject:
                      chargePreview.subject_kind === 'legal'
                        ? t('admin.capitalTariffLegal')
                        : t('admin.capitalTariffNatural'),
                  })}
                  {' · '}
                  {t('admin.perSqmYear')}
                </p>
              </>
            ) : (
              <p className="mt-1 text-sm text-danger">
                {chargePreviewError ?? t('admin.errCapitalTariff')}
              </p>
            )}
          </div>
          <AdminPrimaryButton
            type="button"
            className="mt-4"
            disabled={chargeBusy || launchBlockedSelected || !chargePreview || tariffAmount == null}
            onClick={() => void handleSingleCharge()}
          >
            {chargeBusy ? t('common.saving') : t('admin.capitalChargeOne')}
          </AdminPrimaryButton>

          <div className="mt-5 border-t border-border pt-4">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted">
              {t('admin.capitalCardCharges')}
            </p>
            {cardLoading && cardChargeRows.length === 0 ? (
              <p className="mt-3 text-sm text-muted">{t('common.loading')}</p>
            ) : cardChargeRows.length === 0 ? (
              <div className="mt-3">
                <AdminEmptyState title={t('admin.capitalCardNoCharges')} />
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
                      </tr>
                    </thead>
                    <tbody>
                      {cardChargeRows.map((row) => (
                        <tr key={row.id} className={adminTableRowClass}>
                          <td className={`${adminTableCellClass} tabular-nums`}>
                            {formatOwnerDate(row.created_at)}
                          </td>
                          <td className={adminTableCellClass}>{t(capitalOpsHistoryTitleKey(row.kind))}</td>
                          <td className={`${adminTableCellClass} tabular-nums`}>
                            {formatEur(Number(row.amount_eur), locale)}
                          </td>
                          <td className={`${adminTableCellClass} text-secondary`}>{row.note ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </AdminTableShell>
              </div>
            )}
          </div>
        </div>

        {/* Cash payments with receipts (opening settlements listed separately) */}
        <div className={cardClass}>
          <p className={labelClass}>{t('admin.capitalCashReceipts')}</p>
          <p className="mt-1 text-xs text-muted">{t('admin.capitalCashReceiptsHint')}</p>
          {cardLoading && cardPaymentRows.length === 0 ? (
            <p className="mt-3 text-sm text-muted">{t('common.loading')}</p>
          ) : cardPaymentRows.length === 0 ? (
            <div className="mt-3">
              <AdminEmptyState title={t('admin.capitalCardNoPayments')} />
            </div>
          ) : (
            <div className="mt-3">
              <AdminTableShell>
                <table className="w-full min-w-[32rem] text-sm">
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
                    {cardPaymentRows.map((row) => (
                      <tr key={row.id} className={adminTableRowClass}>
                        <td className={`${adminTableCellClass} tabular-nums`}>
                          {formatOwnerDate(row.created_at)}
                        </td>
                        <td className={adminTableCellClass}>{t(capitalOpsHistoryTitleKey(row.kind))}</td>
                        <td className={`${adminTableCellClass} tabular-nums`}>
                          {formatEur(Number(row.amount_eur), locale)}
                        </td>
                        <td className={`${adminTableCellClass} text-secondary`}>{row.note ?? '—'}</td>
                        <td className={`${adminTableCellClass} align-top`}>
                          <LedgerPaymentReceiptCell
                            supabase={supabase}
                            module="capital_repair"
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
          {cardOpeningSettlements.length > 0 ? (
            <div className="mt-4 border-t border-border pt-3">
              <p className="text-xs text-muted">{t('admin.capitalOpeningSettlementHint')}</p>
              <ul className="mt-2 space-y-1 text-sm">
                {cardOpeningSettlements.map((row) => (
                  <li key={row.id} className="flex justify-between gap-3">
                    <span className="text-secondary">
                      {formatOwnerDate(row.created_at)} · {t(capitalOpsHistoryTitleKey(row.kind))}
                    </span>
                    <span className="tabular-nums">{formatEur(Number(row.amount_eur), locale)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        {/* Full history */}
        <div className={cardClass}>
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <p className={labelClass}>{t('admin.capitalCardOpsHistory')}</p>
              <p className="mt-1 text-xs text-muted">{t('admin.capitalOpsHistoryHint')}</p>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-xs text-secondary">
                {t('admin.capitalLedgerFilter')}
                <select
                  className={`mt-1 block w-36 ${fieldClass}`}
                  value={ledgerKindFilter}
                  onChange={(e) => setLedgerKindFilter(e.target.value as CapitalLedgerKindFilter)}
                >
                  <option value="all">{t('admin.capitalFilterAll')}</option>
                  <option value="charge">{t('admin.kindCharge')}</option>
                  <option value="payment">{t('admin.kindPayment')}</option>
                  <option value="adjustment">{t('admin.capitalFilterAdj')}</option>
                </select>
              </label>
              <AdminSecondaryButton
                type="button"
                disabled={!ledgerFilterActive}
                onClick={() => setLedgerKindFilter('all')}
              >
                {t('admin.capitalFilterReset')}
              </AdminSecondaryButton>
            </div>
          </div>
          {ledger.length === 0 ? (
            <div className="mt-3">
              <AdminEmptyState title={t('admin.noCapitalLedger')} />
            </div>
          ) : filteredLedger.length === 0 ? (
            <div className="mt-3">
              <AdminEmptyState title={t('admin.capitalLedgerEmptyFilter')} />
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
                    {filteredLedger.map((row) => (
                      <tr key={row.id} className={adminTableRowClass}>
                        <td className={`${adminTableCellClass} tabular-nums`}>
                          {formatOwnerDate(row.created_at)}
                        </td>
                        <td className={adminTableCellClass}>{t(capitalOpsHistoryTitleKey(row.kind))}</td>
                        <td className={`${adminTableCellClass} tabular-nums`}>
                          {formatEur(Number(row.amount_eur), locale)}
                        </td>
                        <td className={`${adminTableCellClass} text-secondary`}>{row.note ?? '—'}</td>
                        <td className={`${adminTableCellClass} align-top`}>
                          <LedgerPaymentReceiptCell
                            supabase={supabase}
                            module="capital_repair"
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

  const showCard = tab === 'register' && view === 'card' && propertyId !== '';

  function renderActiveTab() {
    if (tab === 'register') return renderRegister();
    if (tab === 'charges') return renderCharges();
    if (tab === 'payments') return renderPayments();
    return renderHistory();
  }

  return (
    <div className="space-y-4">
      {dialog}
      <AdminPageHeader title={t('admin.capital')} secondary={t('admin.capitalLead')} />
      {tabBar}
      {launchNotice}
      {showCard ? (
        renderCard()
      ) : (
        <>
          {alerts}
          {renderActiveTab()}
        </>
      )}
    </div>
  );
}
