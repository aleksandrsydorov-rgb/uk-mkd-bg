'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { useI18n } from '@/i18n/I18nProvider';
import { presentLedgerOperationNote } from '@/lib/financeLedgerPresent';
import { formatOwnerDateTime } from '@/lib/ownerFormat';
import { toUserFacingMessage } from '@/lib/userFacingError';
import { readBulkAccrualSummary } from '@/lib/bulkAccrual';
import {
  annualSupportFee,
  canRecordSupportPayments,
  canReverseOrVoidSupportFees,
  supportPaymentIdempotencySignature,
  type SupportFeeEntry,
} from '@/lib/finance';
import {
  parseSupportFeeLaunchContext,
  parseSupportFeeYearChargeContext,
  supportFeeOpeningRemaining,
  supportFeeYearRemaining,
  isSupportFeeCreditOffsetKind,
  isSupportFeeLaunchYearBlocked,
  type SupportFeeLaunchContext,
  type SupportFeeYearChargeContext,
} from '@/lib/supportFeeLaunch';
import {
  canonicalSupportOutstanding,
  indexCanonicalSupportOutstanding,
  isActiveSupportAssessmentStatus,
} from '@/lib/supportFeeBalance';
import {
  formatEurAmount,
  formatSofiaDate,
  sofiaCalendarYear,
  type SupportFeeAssessment,
} from '@/lib/supportFeeAnnual';
import {
  meterKindFromSignedAmount,
  parseMeterOpeningAmount,
} from '@/lib/moduleCore/adapters/metersOpening';
import {
  assertSupportFeeRestoreTargetMatch,
  assertSupportFeeVoidTargetMatch,
  assessRestoreSupportAssessmentEligibility,
  assessVoidSupportAssessmentEligibility,
  buildSupportFeeRestoreTarget,
  buildSupportFeeVoidTarget,
  isSupportPaymentReversible,
  supportLedgerKindLabelKey,
  type SupportFeeRestoreTarget,
  type SupportFeeVoidTarget,
} from '@/lib/supportFeeReversal';
import {
  EMPTY_SUPPORT_FEE_REGISTER_FILTERS,
  buildSupportFeeHistoryRows,
  filterSupportFeeRegisterRows,
  sortSupportFeeRegisterRows,
  supportFeeHistoryKindLabelKey,
  supportFeeRegisterFiltersActive,
  type SupportFeeRegisterFilters,
  type SupportFeeRegisterRowInput,
} from '@/lib/supportFeeRegister';
import {
  previewSupportFeePaymentAllocation,
  supportFeePenaltyCancelLabelPct,
} from '@/lib/supportFeePaymentPreview';
import {
  assessWaiveLateIncreaseEligibility,
  validateWaiveLateIncreaseReason,
} from '@/lib/supportFeePenalty';
import {
  AdminEmptyState,
  AdminInlineAlert,
  AdminMetricCard,
  AdminPrimaryButton,
  AdminSecondaryButton,
  AdminTabBar,
  AdminTableShell,
  StatusBadge,
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
import { useAppConfirm } from '@/components/ui/AppConfirmDialog';
import { PropertyIdentityLink } from '@/components/admin/PropertyIdentityLink';
import { formatPropertyIdentity } from '@/lib/propertyIdentity';

export type SupportFeeWorkplaceTab = 'register' | 'charges' | 'payments';

export const SUPPORT_FEE_WORKPLACE_TABS: SupportFeeWorkplaceTab[] = ['register', 'charges', 'payments'];

export function parseSupportFeeWorkplaceTab(raw: string | null | undefined): SupportFeeWorkplaceTab {
  return SUPPORT_FEE_WORKPLACE_TABS.includes(raw as SupportFeeWorkplaceTab)
    ? (raw as SupportFeeWorkplaceTab)
    : 'register';
}

type PropertyOption = {
  id: number;
  apartment_number: string | number | null;
  section_code?: string | null;
  block_code?: string | null;
  owner_name: string | null;
  area_sqm?: number | null;
  overpayment?: number | null;
};

type AssessmentRow = SupportFeeAssessment & { opening_import?: boolean | null };

type PaymentAllocationRow = {
  assessment_id: string;
  ledger_entry_id: number | null;
  amount: number;
};

const fieldClass = adminFieldClass;
const cardClass = `${adminCardClass} p-4 md:p-5`;
const labelClass = 'text-[11px] font-medium uppercase tracking-[0.18em] text-muted';
const LEDGER_LIMIT = 1000;

const sofiaYmdFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Sofia',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function sofiaYmd(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return sofiaYmdFmt.format(d);
}

function goFillUk() {
  window.location.assign('/admin?section=%D0%BD%D0%B0%D1%81%D1%82%D1%80%D0%BE%D0%B9%D0%BA%D0%B8');
}

async function loadPaymentAllocations(
  supabase: SupabaseClient<Database>,
  ledgerIds: number[],
): Promise<Map<number, PaymentAllocationRow[]>> {
  const map = new Map<number, PaymentAllocationRow[]>();
  const chunkSize = 100;
  for (let i = 0; i < ledgerIds.length; i += chunkSize) {
    const chunk = ledgerIds.slice(i, i + chunkSize);
    const { data, error } = await supabase
      .from('support_fee_allocations')
      .select('assessment_id, ledger_entry_id, amount')
      .eq('allocation_type', 'payment')
      .in('ledger_entry_id', chunk);
    if (error) continue;
    for (const row of (data ?? []) as PaymentAllocationRow[]) {
      if (row.ledger_entry_id == null) continue;
      const list = map.get(row.ledger_entry_id) ?? [];
      list.push(row);
      map.set(row.ledger_entry_id, list);
    }
  }
  return map;
}

export function AdminSupportFeeWorkplace({
  supabase,
  properties,
  staffRole,
  supportFeeMissing = false,
  tab: tabRaw,
  onTabChange,
  focusPropertyId,
  onPropertyChange,
  onOpenTariffs,
  onReload,
}: {
  supabase: SupabaseClient<Database>;
  properties: PropertyOption[];
  staffRole: string;
  supportFeeMissing?: boolean;
  tab?: string | null;
  onTabChange: (tab: SupportFeeWorkplaceTab) => void;
  focusPropertyId?: number | '';
  onPropertyChange?: (id: number | '') => void;
  /** Opens «Финансы → Тарифы» — policy tab by default, optional year for annual policy. */
  onOpenTariffs: (opts?: { year?: number; focus?: 'policy' | 'rate' }) => void;
  /** Refresh page-level support-fee caches (debt, ledger) after a financial change. */
  onReload?: () => Promise<void> | void;
}) {
  const { t, locale } = useI18n();
  const { confirm, dialog } = useAppConfirm(t('common.close'));
  const tab = parseSupportFeeWorkplaceTab(tabRaw);
  const canPay = canRecordSupportPayments(staffRole);
  const canReverse = canReverseOrVoidSupportFees(staffRole);

  const [view, setView] = useState<'register' | 'card'>('register');
  const [propertyId, setPropertyId] = useState<number | ''>(
    focusPropertyId != null && focusPropertyId !== '' ? focusPropertyId : '',
  );
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [launch, setLaunch] = useState<SupportFeeLaunchContext | null>(null);
  const [assessments, setAssessments] = useState<AssessmentRow[]>([]);
  const [assessmentsLoading, setAssessmentsLoading] = useState(false);
  const [filters, setFilters] = useState<SupportFeeRegisterFilters>(() => {
    if (typeof window === 'undefined') return EMPTY_SUPPORT_FEE_REGISTER_FILTERS;
    const params = new URLSearchParams(window.location.search);
    const apartmentQuery = (params.get('q') ?? '').trim();
    const statusRaw = params.get('sfStatus') ?? 'all';
    const status: SupportFeeRegisterFilters['status'] =
      statusRaw === 'debt' || statusRaw === 'settled' || statusRaw === 'void' || statusRaw === 'waived'
        ? statusRaw
        : 'all';
    return { ...EMPTY_SUPPORT_FEE_REGISTER_FILTERS, apartmentQuery, status };
  });
  /** Only push filter edits to the URL — never wipe return/deep-link q on remount. */
  const userFilterEditRef = useRef(false);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  function readSupportFeeFiltersFromLocation(): SupportFeeRegisterFilters {
    const params = new URLSearchParams(window.location.search);
    const apartmentQuery = (params.get('q') ?? '').trim();
    const statusRaw = params.get('sfStatus') ?? 'all';
    const status: SupportFeeRegisterFilters['status'] =
      statusRaw === 'debt' || statusRaw === 'settled' || statusRaw === 'void' || statusRaw === 'waived'
        ? statusRaw
        : 'all';
    return { ...EMPTY_SUPPORT_FEE_REGISTER_FILTERS, apartmentQuery, status };
  }

  // Re-hydrate after apartment-card «return» / Back-Forward (replaceState + soft nav).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const syncFromUrl = () => {
      if (userFilterEditRef.current) return;
      const next = readSupportFeeFiltersFromLocation();
      setFilters((prev) =>
        prev.apartmentQuery === next.apartmentQuery && prev.status === next.status ? prev : next,
      );
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') syncFromUrl();
    };
    window.addEventListener('popstate', syncFromUrl);
    document.addEventListener('visibilitychange', onVisible);
    const poll = window.setInterval(() => {
      if (userFilterEditRef.current) return;
      const next = readSupportFeeFiltersFromLocation();
      const cur = filtersRef.current;
      if (cur.apartmentQuery === next.apartmentQuery && cur.status === next.status) return;
      // Only pull when the live URL has a q/status the local state lacks (return restore).
      if (!next.apartmentQuery && next.status === 'all') return;
      if (cur.apartmentQuery === next.apartmentQuery && cur.status === next.status) return;
      setFilters(next);
    }, 400);
    return () => {
      window.removeEventListener('popstate', syncFromUrl);
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(poll);
    };
  }, []);

  // Keep register search/status in the URL so apartment-card «return» restores them.
  useEffect(() => {
    if (!userFilterEditRef.current || typeof window === 'undefined') return;
    if (tab !== 'register' || view !== 'register') return;
    const params = new URLSearchParams(window.location.search);
    params.set('section', 'такса');
    params.set('tab', 'register');
    const nextQ = filters.apartmentQuery.trim();
    const nextStatus = filters.status;
    if (nextQ) params.set('q', nextQ);
    else params.delete('q');
    if (nextStatus !== 'all') params.set('sfStatus', nextStatus);
    else params.delete('sfStatus');
    const qs = params.toString();
    const currentQs = window.location.search.replace(/^\?/, '');
    if (qs === currentQs) {
      userFilterEditRef.current = false;
      return;
    }
    const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
    window.history.replaceState(window.history.state, '', url);
    userFilterEditRef.current = false;
  }, [filters.apartmentQuery, filters.status, tab, view]);

  // Charges tab
  const [chargeYear, setChargeYear] = useState<number>(sofiaCalendarYear() + 1);
  const [chargeYearTouched, setChargeYearTouched] = useState(false);
  const [yearCtx, setYearCtx] = useState<SupportFeeYearChargeContext | null>(null);
  const [yearCtxLoading, setYearCtxLoading] = useState(false);
  const [chargeBusy, setChargeBusy] = useState(false);
  const [bulkResult, setBulkResult] = useState<string | null>(null);

  // Payments journal tab
  const [journalLedger, setJournalLedger] = useState<SupportFeeEntry[]>([]);
  const [journalAlloc, setJournalAlloc] = useState<Map<number, PaymentAllocationRow[]>>(new Map());
  const [journalLoading, setJournalLoading] = useState(false);
  const [journalFrom, setJournalFrom] = useState('');
  const [journalTo, setJournalTo] = useState('');
  const [journalProperty, setJournalProperty] = useState<number | ''>('');

  // Apartment card
  const [cardLedger, setCardLedger] = useState<SupportFeeEntry[]>([]);
  const [cardAlloc, setCardAlloc] = useState<Map<number, PaymentAllocationRow[]>>(new Map());
  const [cardLoading, setCardLoading] = useState(false);
  const [openingPending, setOpeningPending] = useState(false);
  const [openingFormOpen, setOpeningFormOpen] = useState(false);
  const [openingConfirmBusy, setOpeningConfirmBusy] = useState(false);
  const [openingYear, setOpeningYear] = useState('');
  const [openingSignedAmount, setOpeningSignedAmount] = useState('');
  const openingIdemRef = useRef(crypto.randomUUID());
  const [payOpen, setPayOpen] = useState(false);
  const [payBusy, setPayBusy] = useState(false);
  const [payAmount, setPayAmount] = useState('');
  const [payNote, setPayNote] = useState('');
  const [payEffectiveDate, setPayEffectiveDate] = useState(() =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Sofia',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date()),
  );
  const [payWaiveAssessmentId, setPayWaiveAssessmentId] = useState<string>('');
  const [payWaiveReason, setPayWaiveReason] = useState('');
  const [payReceiptFields, setPayReceiptFields] = useState<PaymentReceiptPayFieldValues>(emptyReceiptPayFields);
  const [waiveBusyId, setWaiveBusyId] = useState<string | null>(null);
  const [lastPayReceipt, setLastPayReceipt] = useState<PaymentReceiptRow | null>(null);
  const [lastPayAmountLabel, setLastPayAmountLabel] = useState<string | null>(null);
  const payKeyRef = useRef<{ key: string; sig: string } | null>(null);
  const [expandedAssessmentId, setExpandedAssessmentId] = useState<string | null>(null);

  // Void / restore (frozen targets captured at click time)
  const [voidTarget, setVoidTarget] = useState<SupportFeeVoidTarget | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [voidAptConfirm, setVoidAptConfirm] = useState('');
  const [voidConfirm, setVoidConfirm] = useState(false);
  const [voidBusy, setVoidBusy] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<SupportFeeRestoreTarget | null>(null);
  const [restoreReason, setRestoreReason] = useState('');
  const [restoreAptConfirm, setRestoreAptConfirm] = useState('');
  const [restoreConfirm, setRestoreConfirm] = useState(false);
  const [restoreBusy, setRestoreBusy] = useState(false);

  // Reverse payment
  const [reverseLedgerId, setReverseLedgerId] = useState<number | null>(null);
  const [reverseReason, setReverseReason] = useState('');
  const [reverseConfirm, setReverseConfirm] = useState(false);
  const [reverseBusy, setReverseBusy] = useState(false);
  const reverseKeyRef = useRef<{ key: string; ledgerId: number } | null>(null);

  /**
   * After «К реестру», ignore focusPropertyId until the next explicit openCard or until
   * the external focus clears — avoids a late URL `property=` replace reopening a card.
   */
  const preferRegisterRef = useRef(false);

  const selected = useMemo(
    () => (propertyId === '' ? null : properties.find((p) => p.id === propertyId) ?? null),
    [properties, propertyId],
  );
  const aptLabelOf = useCallback(
    (p: PropertyOption | null | undefined) => String(p?.apartment_number ?? '—'),
    [],
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

  const clearVoidPanel = useCallback(() => {
    setVoidTarget(null);
    setVoidReason('');
    setVoidAptConfirm('');
    setVoidConfirm(false);
  }, []);
  const clearRestorePanel = useCallback(() => {
    setRestoreTarget(null);
    setRestoreReason('');
    setRestoreAptConfirm('');
    setRestoreConfirm(false);
  }, []);
  const clearReversePanel = useCallback(() => {
    setReverseLedgerId(null);
    setReverseReason('');
    setReverseConfirm(false);
  }, []);

  const financeError = useCallback(
    (e: unknown) =>
      toUserFacingMessage(e, t, { context: 'finance', fallback: t('common.errFinance') }),
    [t],
  );

  // ---------- loaders ----------
  const loadLaunch = useCallback(async () => {
    const { data, error: rpcErr } = await supabase.rpc('support_fee_launch_context');
    if (rpcErr) return;
    setLaunch(parseSupportFeeLaunchContext(data));
  }, [supabase]);

  const loadAssessments = useCallback(async () => {
    setAssessmentsLoading(true);
    const { data, error: qErr } = await supabase.from('support_fee_assessments').select('*');
    setAssessmentsLoading(false);
    if (qErr) {
      setError(toUserFacingMessage(qErr, t, { context: 'load', fallback: t('common.errLoad') }));
      return;
    }
    setAssessments((data as AssessmentRow[]) ?? []);
  }, [supabase, t]);

  const loadYearCtx = useCallback(
    async (year: number) => {
      setYearCtxLoading(true);
      const { data, error: rpcErr } = await supabase.rpc('support_fee_year_charge_context', {
        p_billing_year: year,
      });
      setYearCtxLoading(false);
      if (rpcErr) {
        setYearCtx(null);
        setError(toUserFacingMessage(rpcErr, t, { context: 'load', fallback: t('common.errLoad') }));
        return;
      }
      setYearCtx(parseSupportFeeYearChargeContext(data));
    },
    [supabase, t],
  );

  const loadJournal = useCallback(async () => {
    setJournalLoading(true);
    let q = supabase
      .from('support_fee_ledger')
      .select('*')
      .in('kind', ['payment', 'payment_reversal'])
      .order('created_at', { ascending: false })
      .limit(LEDGER_LIMIT);
    if (journalProperty !== '') q = q.eq('property_id', Number(journalProperty));
    const { data, error: qErr } = await q;
    if (qErr) {
      setJournalLoading(false);
      setError(toUserFacingMessage(qErr, t, { context: 'load', fallback: t('common.errLoad') }));
      setJournalLedger([]);
      return;
    }
    const rows = (data as SupportFeeEntry[]) ?? [];
    setJournalLedger(rows);
    setJournalAlloc(
      await loadPaymentAllocations(
        supabase,
        rows.filter((r) => r.kind === 'payment').map((r) => r.id),
      ),
    );
    setJournalLoading(false);
  }, [journalProperty, supabase, t]);

  const loadCard = useCallback(async () => {
    if (propertyId === '') return;
    setCardLoading(true);
    const pid = Number(propertyId);
    const [ledgerRes, pendingRes] = await Promise.all([
      supabase
        .from('support_fee_ledger')
        .select('*')
        .eq('property_id', pid)
        .order('created_at', { ascending: false })
        .limit(300),
      supabase
        .from('support_fee_opening_pending' as never)
        .select('id, billing_year, payload, status')
        .eq('property_id', pid)
        .eq('status', 'needs_initial')
        .limit(1),
    ]);
    if (ledgerRes.error) {
      setCardLoading(false);
      setError(toUserFacingMessage(ledgerRes.error, t, { context: 'load', fallback: t('common.errLoad') }));
      setCardLedger([]);
      setOpeningPending(false);
      return;
    }
    const rows = (ledgerRes.data as SupportFeeEntry[]) ?? [];
    setCardLedger(rows);
    setCardAlloc(
      await loadPaymentAllocations(
        supabase,
        rows.filter((r) => r.kind === 'payment').map((r) => r.id),
      ),
    );
    const pendingRows = Array.isArray(pendingRes.data) ? pendingRes.data : [];
    const hasPending = pendingRows.length > 0 && !pendingRes.error;
    setOpeningPending(hasPending);
    if (hasPending) {
      const prow = pendingRows[0] as {
        billing_year?: number | null;
        payload?: Record<string, unknown> | null;
      };
      setOpeningYear((prev) =>
        prev
          ? prev
          : prow.billing_year != null
            ? String(prow.billing_year)
            : launchYear != null
              ? String(launchYear)
              : '',
      );
      setOpeningSignedAmount('');
    } else {
      setOpeningFormOpen(false);
    }
    setCardLoading(false);
  }, [propertyId, supabase, t]);

  useEffect(() => {
    void loadLaunch();
    void loadAssessments();
  }, [loadLaunch, loadAssessments]);

  // Default charge year: first allowed year (launch + 1) or next calendar year.
  useEffect(() => {
    if (chargeYearTouched || launch == null) return;
    setChargeYear(launch.minChargeYear ?? sofiaCalendarYear() + 1);
  }, [launch, chargeYearTouched]);

  useEffect(() => {
    if (tab === 'charges') void loadYearCtx(chargeYear);
  }, [tab, chargeYear, loadYearCtx]);

  useEffect(() => {
    if (tab === 'payments') void loadJournal();
  }, [tab, loadJournal]);

  useEffect(() => {
    if (tab === 'register' && view === 'card' && propertyId !== '') void loadCard();
  }, [tab, view, propertyId, loadCard]);

  const reloadAll = useCallback(async () => {
    await Promise.all([
      loadAssessments(),
      loadLaunch(),
      tab === 'charges' ? loadYearCtx(chargeYear) : Promise.resolve(),
      tab === 'payments' ? loadJournal() : Promise.resolve(),
      tab === 'register' && view === 'card' && propertyId !== '' ? loadCard() : Promise.resolve(),
    ]);
    await onReload?.();
  }, [chargeYear, loadAssessments, loadCard, loadJournal, loadLaunch, loadYearCtx, onReload, propertyId, tab, view]);

  // ---------- derived ----------
  const outstandingByProperty = useMemo(() => indexCanonicalSupportOutstanding(assessments), [assessments]);
  const totalOutstanding = useMemo(() => {
    let sum = 0;
    for (const p of properties) sum += outstandingByProperty.get(p.id) ?? 0;
    return Math.round(sum * 100) / 100;
  }, [outstandingByProperty, properties]);

  const registerRows = useMemo(() => {
    const byId = new Map(properties.map((p) => [p.id, p] as const));
    const input: SupportFeeRegisterRowInput[] = properties.map((p) => {
      const due = outstandingByProperty.get(p.id) ?? 0;
      return {
        propertyId: p.id,
        apartmentNumber: p.apartment_number ?? '',
        ownerName: p.owner_name,
        overpayment: p.overpayment,
        // Synthetic status row so the shared status filter works on the apartment total.
        assessment: { status: due > 0 ? 'open' : 'paid', remaining_due: due },
      };
    });
    return sortSupportFeeRegisterRows(
      filterSupportFeeRegisterRows(input, { ...filters, pricing: 'all' }),
    ).map((row) => ({
      row,
      property: byId.get(row.propertyId) ?? null,
      outstanding: outstandingByProperty.get(row.propertyId) ?? 0,
    }));
  }, [properties, outstandingByProperty, filters]);
  const filtersActive = supportFeeRegisterFiltersActive(filters);

  const launchYear = launch?.launchYear ?? null;
  const minChargeYear = launch?.minChargeYear ?? null;

  const yearChoices = useMemo(() => {
    const set = new Set<number>([sofiaCalendarYear(), sofiaCalendarYear() + 1, chargeYear]);
    if (launchYear != null) set.add(launchYear);
    if (minChargeYear != null) {
      set.add(minChargeYear);
      set.add(minChargeYear + 1);
    }
    return [...set].filter((y) => y >= 2000 && y <= 2100).sort((a, b) => a - b);
  }, [chargeYear, launchYear, minChargeYear]);

  const chargeRemainingProps = useMemo(
    () =>
      properties.filter(
        (p) =>
          !assessments.some(
            (a) =>
              a.property_id === p.id &&
              Number(a.billing_year) === chargeYear &&
              isActiveSupportAssessmentStatus(a.status),
          ),
      ),
    [assessments, chargeYear, properties],
  );
  const launchYearBlocksSelected = isSupportFeeLaunchYearBlocked(chargeYear, launchYear);

  const chargePreviewSum = useMemo(() => {
    if (launchYearBlocksSelected || yearCtx?.blocked) return 0;
    const rate = yearCtx?.rateEurPerSqmYear ?? null;
    if (rate == null) return null;
    let sum = 0;
    for (const p of chargeRemainingProps) sum += annualSupportFee(p.area_sqm, rate) ?? 0;
    return Math.round(sum * 100) / 100;
  }, [chargeRemainingProps, launchYearBlocksSelected, yearCtx]);

  const launchTokens = useMemo(
    () => ({
      launch: String(launchYear ?? ''),
      next: String(minChargeYear ?? (launchYear != null ? launchYear + 1 : '')),
    }),
    [launchYear, minChargeYear],
  );

  // ---------- navigation ----------
  function openCard(id: number) {
    preferRegisterRef.current = false;
    setPropertyId(id);
    onPropertyChange?.(id);
    setView('card');
    setSuccess(null);
    setError(null);
    setLastPayReceipt(null);
    setLastPayAmountLabel(null);
    setPayOpen(false);
    setPayAmount('');
    setPayNote('');
    setExpandedAssessmentId(null);
    clearVoidPanel();
    clearRestorePanel();
    clearReversePanel();
    payKeyRef.current = null;
  }

  function backToRegister() {
    preferRegisterRef.current = true;
    setView('register');
    setPropertyId('');
    onPropertyChange?.('');
    setSuccess(null);
    setError(null);
    setPayOpen(false);
    clearVoidPanel();
    clearRestorePanel();
    clearReversePanel();
    void loadAssessments();
  }

  function handleTab(id: string) {
    const next = parseSupportFeeWorkplaceTab(id);
    if (view === 'card' || propertyId !== '') backToRegister();
    setError(null);
    setSuccess(null);
    onTabChange(next);
  }

  // ---------- bulk charge ----------
  const chargeBlockedReason = useMemo(() => {
    if (!canPay) return t('admin.feePayWho');
    if (supportFeeMissing) return t('admin.feeMissingTables');
    if (launchYearBlocksSelected || yearCtx?.blocked) {
      return t('admin.feeLaunchBlocked', launchTokens);
    }
    if (yearCtx == null) return null;
    if (yearCtx.rateEurPerSqmYear == null) return t('admin.feeTariffNotConfigured');
    if (yearCtx.apartmentsRemaining === 0) return t('admin.feeNothingToCharge');
    return null;
  }, [canPay, launchTokens, launchYearBlocksSelected, supportFeeMissing, t, yearCtx]);

  async function handleBulkCharge() {
    if (!yearCtx || chargeBlockedReason || chargeBusy) return;
    const existing = yearCtx.apartmentsCharged + yearCtx.apartmentsOpening;
    const ok = await confirm({
      title: t('common.confirmAction'),
      description: t('confirm.bulkSupport', {
        year: String(chargeYear),
        total: String(yearCtx.apartmentsTotal),
        existing: String(existing),
        will: String(yearCtx.apartmentsRemaining),
      }),
      confirmLabel: t('common.yes'),
      cancelLabel: t('common.cancel'),
      tone: 'default',
    });
    if (!ok) return;
    setChargeBusy(true);
    setError(null);
    setBulkResult(null);
    try {
      const { data, error: rpcErr } = await supabase.rpc('charge_support_fee_bulk', {
        p_period: String(chargeYear),
      });
      if (rpcErr) throw rpcErr;
      const raw = (Array.isArray(data) ? data[0] : data) as { reason?: string } | null;
      if (raw?.reason === 'launch_year_blocks_charge') {
        setError(t('admin.feeLaunchBlocked', launchTokens));
        return;
      }
      const summary = readBulkAccrualSummary(data);
      if (!summary) {
        setError(t('admin.errGeneric'));
        return;
      }
      const base = t('admin.bulkResult', { created: summary.created, skipped: summary.skipped_existing });
      const withReprice =
        summary.repriced > 0 ? `${base} ${t('admin.feeBulkRepriced', { n: summary.repriced })}` : base;
      setBulkResult(
        summary.not_applied > 0
          ? `${withReprice} ${t('admin.bulkNotApplied', { n: summary.not_applied })}`
          : withReprice,
      );
      await reloadAll();
    } catch (e: unknown) {
      const msg =
        e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message ?? '') : '';
      if (/could not find the function/i.test(msg)) setError(t('admin.bulkUnavailable'));
      else setError(msg ? financeError(e) : t('admin.errGeneric'));
    } finally {
      setChargeBusy(false);
    }
  }

  // ---------- payment ----------
  async function handleCancelPenalty(a: AssessmentRow) {
    if (!canReverse || waiveBusyId) return;
    const pct = supportFeePenaltyCancelLabelPct(a.increase_percent);
    const elig = assessWaiveLateIncreaseEligibility({
      status: a.status,
      pricingRule: a.pricing_rule,
      increasePercent: a.increase_percent,
      baseAmount: a.base_amount,
      lateAmount: a.late_amount,
      remainingDue: a.remaining_due,
      alreadyWaived: Boolean(a.penalty_waived_at),
    });
    if (!elig.ok) {
      setError(t('admin.sfErrWaiveNotEligible'));
      return;
    }
    const reason = window.prompt(
      t('admin.sfCancelPenaltyPrompt', {
        year: String(a.billing_year),
        amount: formatEurAmount(elig.waiveAmount, locale),
        remaining: formatEurAmount(Math.max(0, Number(a.remaining_due) - elig.waiveAmount), locale),
        pct: String(pct),
      }),
    );
    if (reason == null) return;
    if (!validateWaiveLateIncreaseReason(reason)) {
      setError(t('admin.errReverseReasonRequired'));
      return;
    }
    setWaiveBusyId(a.id);
    setError(null);
    try {
      const { error: rpcErr } = await supabase.rpc('waive_support_fee_late_increase', {
        p_assessment_id: a.id,
        p_reason: reason.trim(),
        p_idempotency_key: crypto.randomUUID(),
      });
      if (rpcErr) throw rpcErr;
      setSuccess(t('admin.sfCancelPenaltyOk', { pct: String(pct) }));
      await reloadAll();
    } catch (err: unknown) {
      setError(financeError(err));
    } finally {
      setWaiveBusyId(null);
    }
  }

  async function handleConfirmSupportFeeOpening(e: React.FormEvent) {
    e.preventDefault();
    if (!canPay || propertyId === '' || openingConfirmBusy || !openingPending) return;
    const year =
      Number(openingYear) ||
      (launchYear != null ? Number(launchYear) : NaN);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      setError(t('admin.importIssue_billing_year_invalid'));
      return;
    }
    const parsed = parseMeterOpeningAmount(openingSignedAmount);
    if (!parsed.ok) {
      setError(
        t(
          parsed.reason === 'hyphen'
            ? 'admin.importIssue_opening_balance_eur_hyphen'
            : 'admin.importIssue_opening_balance_eur_invalid',
        ),
      );
      return;
    }
    if (parsed.value == null) {
      setError(t('admin.importIssue_opening_balance_eur_required'));
      return;
    }
    const kind = meterKindFromSignedAmount(parsed.value);
    const abs = Math.abs(parsed.value);
    let assessed = 0;
    let paid = 0;
    let remaining = 0;
    let over = 0;
    if (kind === 'debt') {
      assessed = abs;
      remaining = abs;
    } else if (kind === 'overpayment') {
      over = abs;
    }
    setOpeningConfirmBusy(true);
    setError(null);
    setSuccess(null);
    const { data, error: rpcErr } = await supabase.rpc('admin_confirm_support_fee_opening' as never, {
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
      if (/conflict:existing_obligation|conflict:existing_charge|conflict:existing_opening/i.test(msg)) {
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

  async function handlePay(e: React.FormEvent) {
    e.preventDefault();
    if (!canPay || propertyId === '' || payBusy) return;
    const amount = Number(String(payAmount).replace(',', '.'));
    if (!(amount > 0) || Number.isNaN(amount)) {
      setError(t('admin.errAmount'));
      return;
    }
    const note = payNote.trim();
    const ymd = String(payEffectiveDate ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
      setError(t('admin.sfErrPayDate'));
      return;
    }
    const effectiveAt = `${ymd}T12:00:00+02:00`;
    const waiveId = payWaiveAssessmentId.trim();
    if (waiveId && !validateWaiveLateIncreaseReason(payWaiveReason)) {
      setError(t('admin.errReverseReasonRequired'));
      return;
    }
    const sig = supportPaymentIdempotencySignature({
      mode: 'regular',
      propertyId: Number(propertyId),
      amount,
      note: `${note}|${ymd}|${waiveId}`,
    });
    if (!payKeyRef.current || payKeyRef.current.sig !== sig) {
      payKeyRef.current = { key: crypto.randomUUID(), sig };
    }
    const idem = payKeyRef.current.key;
    setPayBusy(true);
    setLastPayReceipt(null);
    setError(null);
    try {
      const intentErr = await prepareReceiptIntentFromFields(supabase, idem, payReceiptFields);
      if (intentErr) throw new Error(intentErr);
      const { data: payData, error: rpcErr } = await supabase.rpc('record_support_payment', {
        p_property_id: Number(propertyId),
        p_amount: amount,
        p_note: note || null,
        p_idempotency_key: idem,
        p_effective_at: effectiveAt,
        p_waive_assessment_id: waiveId || null,
        p_waive_reason: waiveId ? payWaiveReason.trim() : null,
        p_waive_idempotency_key: waiveId ? crypto.randomUUID() : null,
      });
      if (rpcErr) throw rpcErr;
      const ledgerId = ledgerIdFromPaymentRpc(payData);
      const amountLabel = formatEurAmount(amount, locale);
      setLastPayAmountLabel(amountLabel);
      const finished = await finishReceiptForPayment(supabase, 'support_fee', ledgerId);
      setLastPayReceipt(finished.receipt);
      payKeyRef.current = null;
      setPayAmount('');
      setPayNote('');
      setPayWaiveAssessmentId('');
      setPayWaiveReason('');
      setPayReceiptFields(emptyReceiptPayFields());
      setPayOpen(false);
      setSuccess(
        finished.pdfError && finished.receipt
          ? t('receipt.paySavedPdfFailed')
          : t('receipt.payRegistered', { amount: amountLabel }),
      );
      void import('@/lib/email/eventProducers')
        .then(({ notifyPropertyOwnersEvent }) =>
          notifyPropertyOwnersEvent(supabase, {
            eventKey: 'support_fee_payment_recorded',
            propertyId: Number(propertyId),
            entityId: `sf_pay:${propertyId}:${amount}`,
            payload: { amount },
          }),
        )
        .catch(() => undefined);
      await reloadAll();
    } catch (err: unknown) {
      const msg =
        err && typeof err === 'object' && 'message' in err
          ? String((err as { message: unknown }).message ?? '')
          : '';
      if (msg.toLowerCase().includes('idempotency key conflict')) setError(t('admin.errIdempotency'));
      else if (
        /failed to fetch|networkerror|etimedout|abort/i.test(msg) ||
        (err instanceof TypeError && /fetch/i.test(err.message))
      ) {
        setError(toUserFacingMessage(err, t, { context: 'finance', financeUncertain: true }));
      } else setError(financeError(err));
    } finally {
      setPayBusy(false);
    }
  }

  async function handleReverse() {
    if (!canReverse || reverseLedgerId == null) return;
    if (!reverseConfirm || !reverseReason.trim()) {
      setError(t('admin.errReverseReasonRequired'));
      return;
    }
    if (!reverseKeyRef.current || reverseKeyRef.current.ledgerId !== reverseLedgerId) {
      reverseKeyRef.current = { key: crypto.randomUUID(), ledgerId: reverseLedgerId };
    }
    setReverseBusy(true);
    setError(null);
    try {
      const { error: rpcErr } = await supabase.rpc('reverse_support_payment', {
        p_ledger_id: reverseLedgerId,
        p_reason: reverseReason.trim(),
        p_idempotency_key: reverseKeyRef.current.key,
      });
      if (rpcErr) throw rpcErr;
      reverseKeyRef.current = null;
      clearReversePanel();
      await reloadAll();
    } catch (err: unknown) {
      setError(financeError(err));
    } finally {
      setReverseBusy(false);
    }
  }

  // ---------- void / restore ----------
  async function handleVoid() {
    const frozen = voidTarget;
    if (!frozen || !voidReason.trim() || !voidConfirm) return;
    const live = assessments.find((x) => x.id === frozen.assessmentId) ?? null;
    const match = assertSupportFeeVoidTargetMatch({
      target: frozen,
      assessment: live,
      expectedPropertyId: frozen.propertyId,
      confirmedApartmentNumber: voidAptConfirm,
    });
    if (!match.ok) {
      setError(t('admin.feeVoidTargetMismatch'));
      clearVoidPanel();
      return;
    }
    setVoidBusy(true);
    setError(null);
    try {
      const { error: rpcErr } = await supabase.rpc('void_support_fee_assessment', {
        p_assessment_id: frozen.assessmentId,
        p_reason: voidReason.trim(),
        p_idempotency_key: crypto.randomUUID(),
        p_expected_property_id: frozen.propertyId,
      });
      if (rpcErr) throw rpcErr;
      clearVoidPanel();
      await reloadAll();
    } catch (err: unknown) {
      setError(toUserFacingMessage(err, t, { context: 'finance', fallback: t('admin.sfSaveFailed') }));
    } finally {
      setVoidBusy(false);
    }
  }

  async function handleRestore() {
    const frozen = restoreTarget;
    if (!frozen || !restoreReason.trim() || !restoreConfirm) return;
    const live = assessments.find((x) => x.id === frozen.assessmentId) ?? null;
    const match = assertSupportFeeRestoreTargetMatch({
      target: frozen,
      assessment: live,
      expectedPropertyId: frozen.propertyId,
      confirmedApartmentNumber: restoreAptConfirm,
    });
    if (!match.ok) {
      setError(t('admin.feeRestoreTargetMismatch'));
      clearRestorePanel();
      return;
    }
    setRestoreBusy(true);
    setError(null);
    try {
      const { error: rpcErr } = await supabase.rpc('restore_support_fee_assessment', {
        p_assessment_id: frozen.assessmentId,
        p_reason: restoreReason.trim(),
        p_idempotency_key: crypto.randomUUID(),
        p_expected_property_id: frozen.propertyId,
      });
      if (rpcErr) throw rpcErr;
      clearRestorePanel();
      await reloadAll();
    } catch (err: unknown) {
      setError(toUserFacingMessage(err, t, { context: 'finance', fallback: t('admin.sfSaveFailed') }));
    } finally {
      setRestoreBusy(false);
    }
  }

  // ---------- shared render helpers ----------
  function yearsLabel(
    ledgerRow: SupportFeeEntry,
    alloc: Map<number, PaymentAllocationRow[]>,
  ): string {
    if (ledgerRow.kind !== 'payment') return '—';
    const years = new Set<number>();
    for (const a of alloc.get(ledgerRow.id) ?? []) {
      const assessment = assessments.find((x) => x.id === a.assessment_id);
      if (assessment) years.add(Number(assessment.billing_year));
    }
    if (years.size === 0 && ledgerRow.period && /^\d{4}$/.test(ledgerRow.period)) {
      years.add(Number(ledgerRow.period));
    }
    return years.size === 0 ? '—' : [...years].sort((a, b) => a - b).join(', ');
  }

  function reverseTargetRow(): SupportFeeEntry | null {
    if (reverseLedgerId == null) return null;
    return (
      journalLedger.find((r) => r.id === reverseLedgerId) ??
      cardLedger.find((r) => r.id === reverseLedgerId) ??
      null
    );
  }

  function renderReversePanel() {
    if (reverseLedgerId == null || !canReverse) return null;
    const row = reverseTargetRow();
    const apt =
      row != null
        ? properties.find((p) => p.id === row.property_id)
        : propertyId !== ''
          ? properties.find((p) => p.id === propertyId)
          : null;
    const aptLabel = apt
      ? `${formatPropertyIdentity(apt, t)}${apt.owner_name ? ` — ${apt.owner_name}` : ''}`
      : row
        ? `#${row.property_id}`
        : '—';
    const dateLabel = row?.created_at ? formatOwnerDateTime(row.created_at, locale) : '—';
    const amountLabel = row ? formatEurAmount(Number(row.amount), locale) : '—';
    return (
      <div className="mt-3 rounded-lg border border-border bg-background p-3 text-sm">
        <p className="font-medium text-foreground">{t('admin.feeReversePayment')}</p>
        <p className="mt-1 text-xs text-secondary">{t('admin.feeReverseConfirm')}</p>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-muted">{t('form.colApt')}</dt>
            <dd className="font-medium">{aptLabel}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">{t('admin.feePayDate')}</dt>
            <dd className="font-medium tabular-nums">{dateLabel}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">{t('admin.amount')}</dt>
            <dd className="font-medium tabular-nums">{amountLabel}</dd>
          </div>
        </dl>
        <label className="mt-3 block text-secondary">
          {t('admin.feeReverseReason')}
          <input
            value={reverseReason}
            onChange={(e) => setReverseReason(e.target.value)}
            className={`mt-1 ${fieldClass}`}
            required
          />
        </label>
        <label className="mt-2 flex items-center gap-2 text-secondary">
          <input
            type="checkbox"
            checked={reverseConfirm}
            onChange={(e) => setReverseConfirm(e.target.checked)}
          />
          {t('admin.feeActionConfirm')}
        </label>
        <div className="mt-3 flex flex-wrap gap-2">
          <AdminPrimaryButton
            type="button"
            disabled={reverseBusy || !reverseConfirm || !reverseReason.trim()}
            onClick={() => void handleReverse()}
          >
            {reverseBusy ? t('admin.feeReverseBusy') : t('admin.feeReversePayment')}
          </AdminPrimaryButton>
          <AdminSecondaryButton type="button" disabled={reverseBusy} onClick={clearReversePanel}>
            {t('admin.feeActionCancel')}
          </AdminSecondaryButton>
        </div>
      </div>
    );
  }

  function renderActionPanel(
    kind: 'void' | 'restore',
    target: { apartmentNumber: string; billingYear: number; finalAmount: number; assessmentId: string },
    amount: number,
  ) {
    const isVoid = kind === 'void';
    const aptConfirm = isVoid ? voidAptConfirm : restoreAptConfirm;
    const reason = isVoid ? voidReason : restoreReason;
    const confirmed = isVoid ? voidConfirm : restoreConfirm;
    const busy = isVoid ? voidBusy : restoreBusy;
    return (
      <div
        className={`${adminCardClass} mt-3 p-4 text-sm`}
        {...(isVoid ? { 'data-void-panel': '1' } : { 'data-restore-panel': '1' })}
      >
        <p className="font-medium">
          {isVoid ? t('admin.feeVoidAssessment') : t('admin.feeRestoreAssessment')}
        </p>
        <p className="mt-1 text-xs text-muted">
          {isVoid ? t('admin.feeVoidConfirm') : t('admin.feeRestoreConfirm')}
        </p>
        <dl className="mt-3 grid gap-1 rounded-lg border border-border bg-background px-3 py-2 text-xs">
          <div className="flex justify-between gap-2">
            <dt className="text-muted">{t('form.colApt')}</dt>
            <dd className="font-semibold tabular-nums">№ {target.apartmentNumber}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-muted">{t('admin.sfYear')}</dt>
            <dd className="font-semibold tabular-nums">{target.billingYear}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-muted">{t('account.sfFinal')}</dt>
            <dd className="font-semibold tabular-nums">{formatEurAmount(target.finalAmount, locale)}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-muted">{t('account.sfRemainingDue')}</dt>
            <dd className="font-semibold tabular-nums text-danger">{formatEurAmount(amount, locale)}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-muted">ID</dt>
            <dd className="font-mono text-[10px] text-secondary">{target.assessmentId}</dd>
          </div>
        </dl>
        <label className="mt-3 block text-secondary">
          {isVoid
            ? t('admin.feeVoidAptConfirm', { n: target.apartmentNumber })
            : t('admin.feeRestoreAptConfirm', { n: target.apartmentNumber })}
          <input
            value={aptConfirm}
            onChange={(e) => (isVoid ? setVoidAptConfirm(e.target.value) : setRestoreAptConfirm(e.target.value))}
            autoComplete="off"
            className={`mt-1 ${fieldClass}`}
            placeholder={target.apartmentNumber}
          />
        </label>
        <label className="mt-2 block text-secondary">
          {isVoid ? t('admin.feeVoidReason') : t('admin.feeRestoreReason')}
          <input
            value={reason}
            onChange={(e) => (isVoid ? setVoidReason(e.target.value) : setRestoreReason(e.target.value))}
            className={`mt-1 ${fieldClass}`}
          />
        </label>
        <label className="mt-2 flex items-center gap-2 text-secondary">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => (isVoid ? setVoidConfirm(e.target.checked) : setRestoreConfirm(e.target.checked))}
          />
          {t('admin.feeActionConfirm')}
        </label>
        <div className="mt-3 flex flex-wrap gap-2">
          <AdminPrimaryButton
            type="button"
            {...(isVoid ? { 'data-void-submit': '1' } : { 'data-restore-submit': '1' })}
            disabled={busy || !confirmed || !reason.trim() || aptConfirm.trim() !== target.apartmentNumber}
            onClick={() => void (isVoid ? handleVoid() : handleRestore())}
          >
            {isVoid
              ? busy
                ? t('admin.feeVoidBusy')
                : t('admin.feeVoidSubmit')
              : busy
                ? t('admin.feeRestoreBusy')
                : t('admin.feeRestoreSubmit')}
          </AdminPrimaryButton>
          <AdminSecondaryButton
            type="button"
            disabled={busy}
            onClick={() => (isVoid ? clearVoidPanel() : clearRestorePanel())}
          >
            {t('admin.feeActionCancel')}
          </AdminSecondaryButton>
        </div>
      </div>
    );
  }

  // ---------- views ----------
  const tabBar = (
    <AdminTabBar
      tabs={[
        { id: 'register', label: t('admin.feeTabRegister') },
        { id: 'charges', label: t('admin.feeTabCharges') },
        { id: 'payments', label: t('admin.feeTabPayments') },
      ]}
      active={tab}
      onChange={handleTab}
    />
  );

  const launchNotice =
    launch?.hasLaunchYear && launchYear != null ? (
      <AdminInlineAlert tone="info">{t('admin.feeLaunchNotice', launchTokens)}</AdminInlineAlert>
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

  // ----- register -----
  function renderRegister() {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <AdminMetricCard
            label={t('admin.feeTotalOutstanding')}
            value={assessmentsLoading ? t('common.loading') : formatEurAmount(totalOutstanding, locale)}
            alert={totalOutstanding > 0}
          />
        </div>
        <div className="flex flex-wrap items-end gap-2 rounded-[14px] border border-border bg-surface px-3 py-2">
          <label className="text-xs text-secondary">
            {t('admin.sfFilterApt')}
            <input
              value={filters.apartmentQuery}
              onChange={(e) => {
                userFilterEditRef.current = true;
                setFilters((f) => ({ ...f, apartmentQuery: e.target.value }));
              }}
              placeholder={t('admin.sfFilterAptPh')}
              className={`mt-1 block w-44 ${fieldClass}`}
            />
          </label>
          <label className="text-xs text-secondary">
            {t('admin.sfFilterStatus')}
            <select
              value={filters.status === 'debt' || filters.status === 'settled' ? filters.status : 'all'}
              onChange={(e) => {
                userFilterEditRef.current = true;
                setFilters((f) => ({
                  ...f,
                  status: e.target.value as SupportFeeRegisterFilters['status'],
                }));
              }}
              className={`mt-1 block w-40 ${fieldClass}`}
            >
              <option value="all">{t('admin.sfFilterAll')}</option>
              <option value="debt">{t('admin.sfFilterDebt')}</option>
              <option value="settled">{t('admin.sfFilterSettled')}</option>
            </select>
          </label>
          <AdminSecondaryButton
            type="button"
            disabled={!filtersActive}
            onClick={() => {
              userFilterEditRef.current = true;
              setFilters(EMPTY_SUPPORT_FEE_REGISTER_FILTERS);
            }}
          >
            {t('admin.sfFilterReset')}
          </AdminSecondaryButton>
          <p className="ml-auto text-xs text-muted">
            {t('admin.sfRegisterCount', { n: String(registerRows.length) })}
          </p>
        </div>
        {assessmentsLoading && assessments.length === 0 ? (
          <p className="text-sm text-muted">{t('common.loading')}</p>
        ) : properties.length === 0 ? (
          <AdminEmptyState title={t('admin.feeNoLedger')} />
        ) : registerRows.length === 0 ? (
          <AdminEmptyState title={t('admin.sfRegisterEmptyFilter')} />
        ) : (
          <AdminTableShell>
            <table className="w-full min-w-[36rem] text-sm">
              <thead>
                <tr className={adminTableHeadRowClass}>
                  <th className={adminTableCellClass}>{t('form.colApt')}</th>
                  <th className={adminTableCellClass}>{t('form.colOwner')}</th>
                  <th className={adminTableCellClass}>{t('admin.feeTotalOutstanding')}</th>
                  <th className={adminTableCellClass}>{t('admin.status')}</th>
                </tr>
              </thead>
              <tbody>
                {registerRows.map(({ row, property, outstanding }) => {
                  const over = Math.max(0, Number(property?.overpayment ?? 0));
                  return (
                    <tr
                      key={row.propertyId}
                      tabIndex={0}
                      role="button"
                      aria-label={t('admin.utilFinOpenCard')}
                      data-support-fee-row={row.propertyId}
                      className={`${adminTableRowClass} cursor-pointer hover:bg-hover/70 focus-visible:bg-hover/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40`}
                      onClick={() => openCard(row.propertyId)}
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter' && e.key !== ' ') return;
                        e.preventDefault();
                        openCard(row.propertyId);
                      }}
                    >
                      <td className={adminTableCellClass}>
                        {property ? (
                          <PropertyIdentityLink property={property} module="support" />
                        ) : (
                          `№ ${row.apartmentNumber}`
                        )}
                      </td>
                      <td className={adminTableCellClass}>{row.ownerName ?? '—'}</td>
                      <td
                        className={`${adminTableCellClass} tabular-nums ${outstanding > 0 ? 'text-danger' : ''}`}
                      >
                        {formatEurAmount(outstanding, locale)}
                      </td>
                      <td className={adminTableCellClass}>
                        {outstanding > 0 ? (
                          <StatusBadge label={t('admin.balDebt')} tone="danger" />
                        ) : over > 0 ? (
                          <StatusBadge
                            label={`${t('admin.balOver')} ${formatEurAmount(over, locale)}`}
                            tone="success"
                          />
                        ) : (
                          <StatusBadge label={t('admin.balSettled')} tone="neutral" />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </AdminTableShell>
        )}
      </div>
    );
  }

  // ----- charges -----
  function renderCharges() {
    const ctx = yearCtx;
    const policyLabel =
      ctx?.policyStatus === 'published' || ctx?.policyStatus === 'closed'
        ? t('admin.feePolicyPublished')
        : ctx?.policyStatus === 'draft'
          ? t('admin.feePolicyDraft')
          : t('admin.feePolicyNone');
    const existing = ctx ? ctx.apartmentsCharged + ctx.apartmentsOpening : 0;
    const yearAssessments = assessments.filter(
      (a) => Number(a.billing_year) === chargeYear && isActiveSupportAssessmentStatus(a.status),
    );
    const isLaunchState = launchYearBlocksSelected || Boolean(ctx?.blocked);
    const unavailableReason =
      !canPay
        ? t('admin.feePayWho')
        : supportFeeMissing
          ? t('admin.feeMissingTables')
          : ctx != null && ctx.rateEurPerSqmYear == null
            ? t('admin.feeTariffNotConfigured')
            : null;
    const isAllCharged =
      !isLaunchState && !unavailableReason && ctx != null && ctx.apartmentsRemaining === 0 && ctx.apartmentsTotal > 0;
    const isReadyToCharge =
      !isLaunchState && !unavailableReason && ctx != null && ctx.apartmentsRemaining > 0;

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
            <AdminSecondaryButton
              type="button"
              onClick={() => onOpenTariffs({ year: chargeYear, focus: 'policy' })}
            >
              {t('admin.feeOpenYearPolicy', { year: String(chargeYear) })}
            </AdminSecondaryButton>
          </div>

          {yearCtxLoading && !ctx ? (
            <p className="mt-4 text-sm text-muted">{t('common.loading')}</p>
          ) : isLaunchState ? (
            <div className="mt-4 space-y-3">
              <AdminInlineAlert tone="warning">{t('admin.feeLaunchBlocked', launchTokens)}</AdminInlineAlert>
              <p className="text-sm text-secondary">{t('admin.feeChargeStateLaunchHint', launchTokens)}</p>
              <p className="text-sm text-muted">
                {t('admin.feeChargeStateNextPickYear', { year: String(minChargeYear ?? chargeYear + 1) })}
              </p>
            </div>
          ) : unavailableReason ? (
            <div className="mt-4 space-y-3">
              <AdminInlineAlert tone="warning">{t('admin.feeChargeStateUnavailable')}</AdminInlineAlert>
              <p className="text-sm text-secondary">{unavailableReason}</p>
              <p className="text-sm text-muted">
                {ctx != null && ctx.rateEurPerSqmYear == null
                  ? t('admin.feeChargeStateNextTariff')
                  : t('admin.feeChargeStateNextAccess')}
              </p>
              {ctx != null && ctx.rateEurPerSqmYear == null ? (
                <AdminSecondaryButton
                  type="button"
                  onClick={() => onOpenTariffs({ year: chargeYear, focus: 'rate' })}
                >
                  {t('admin.feeEditRateInTariffs')}
                </AdminSecondaryButton>
              ) : null}
            </div>
          ) : isAllCharged && ctx ? (
            <div className="mt-4 space-y-3">
              <p className="text-sm font-medium text-foreground">
                {t('admin.feeChargeStateAllDone', {
                  charged: String(existing),
                  total: String(ctx.apartmentsTotal),
                  year: String(chargeYear),
                })}
              </p>
              <p className="text-sm text-secondary">
                {t('admin.feeChargeStateAllDoneHint', { year: String(chargeYear) })}
              </p>
              {yearAssessments.length > 0 ? (
                <details className="rounded-xl border border-border bg-surface-secondary px-3 py-2 text-sm">
                  <summary className="cursor-pointer font-medium text-accent">
                    {t('admin.feeChargeStateShowYearList', { year: String(chargeYear) })}
                  </summary>
                  <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto text-xs text-secondary">
                    {yearAssessments
                      .slice()
                      .sort((a, b) => a.property_id - b.property_id)
                      .map((a) => {
                        const apt = properties.find((p) => p.id === a.property_id);
                        return (
                          <li key={a.id} className="flex justify-between gap-2 tabular-nums">
                            <span>
                              {apt
                                ? `${formatPropertyIdentity(apt, t)}${apt.owner_name ? ` — ${apt.owner_name}` : ''}`
                                : `#${a.property_id}`}
                            </span>
                            <span>{formatEurAmount(Number(a.final_amount), locale)}</span>
                          </li>
                        );
                      })}
                  </ul>
                </details>
              ) : null}
            </div>
          ) : isReadyToCharge && ctx ? (
            <div className="mt-4 space-y-4">
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-muted">{t('admin.feeRateForYear', { year: String(chargeYear) })}</dt>
                  <dd className="font-medium tabular-nums">
                    {formatEurAmount(ctx.rateEurPerSqmYear ?? 0, locale)}{' '}
                    <span className="text-xs font-normal text-muted">{t('admin.feePerSqm')}</span>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">
                    {t('admin.feePolicyForYear', { year: String(chargeYear) })}
                  </dt>
                  <dd className="font-medium">
                    {policyLabel}
                    {ctx.pricingMode === 'policy' && ctx.earlyPaymentDeadline ? (
                      <span className="block text-xs font-normal text-muted">
                        {t('admin.sfDeadlineLabel')}: {formatSofiaDate(ctx.earlyPaymentDeadline)}
                        {' · −'}
                        {ctx.earlyDiscountPercent ?? 0}% / +{ctx.lateIncreasePercent ?? 0}%
                      </span>
                    ) : (
                      <span className="block text-xs font-normal text-muted">
                        {t('admin.feePolicyStandardRate')}
                      </span>
                    )}
                  </dd>
                </div>
              </dl>
              <p className="text-sm text-foreground">
                {t('admin.feeChargeStateRemaining', {
                  remaining: String(ctx.apartmentsRemaining),
                  total: String(ctx.apartmentsTotal),
                  year: String(chargeYear),
                })}
              </p>
              <div className="rounded-xl bg-surface-secondary px-3 py-2 text-sm">
                <p className="text-xs text-muted">{t('admin.feeChargePreviewSum')}</p>
                <p className="mt-1 font-semibold tabular-nums">
                  {chargePreviewSum == null ? '—' : formatEurAmount(chargePreviewSum, locale)}
                </p>
              </div>
              <AdminPrimaryButton
                type="button"
                disabled={chargeBusy}
                onClick={() => void handleBulkCharge()}
              >
                {chargeBusy ? t('admin.feeCharging') : t('admin.sfFinalizeYear')}
              </AdminPrimaryButton>
              {bulkResult ? <p className="text-sm text-secondary">{bulkResult}</p> : null}
            </div>
          ) : ctx ? (
            <p className="mt-4 text-sm text-muted">{chargeBlockedReason}</p>
          ) : null}
        </div>
      </div>
    );
  }

  // ----- payments journal -----
  function renderPayments() {
    const reversedIds = new Set(
      journalLedger
        .filter((r) => r.kind === 'payment_reversal' && r.reverses_ledger_id != null)
        .map((r) => Number(r.reverses_ledger_id)),
    );
    const aptById = new Map(properties.map((p) => [p.id, p] as const));
    const rows = journalLedger.filter((r) => {
      const ymd = sofiaYmd(r.created_at);
      if (journalFrom && ymd < journalFrom) return false;
      if (journalTo && ymd > journalTo) return false;
      return true;
    });
    const sortedProps = sortSupportFeeRegisterRows(
      properties.map((p) => ({ ...p, apartmentNumber: p.apartment_number ?? '' })),
    );
    const cashTotal = rows
      .filter((r) => r.kind === 'payment' && !reversedIds.has(r.id))
      .reduce((s, r) => s + Number(r.amount), 0);
    return (
      <div className="space-y-4">
        <div className={cardClass}>
          <p className={labelClass}>{t('admin.feePaymentsJournal')}</p>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className="text-xs text-secondary">
              {t('admin.feeFilterDateFrom')}
              <input
                type="date"
                value={journalFrom}
                max={journalTo || undefined}
                onChange={(e) => setJournalFrom(e.target.value)}
                className={`mt-1 block w-40 ${fieldClass}`}
              />
            </label>
            <label className="text-xs text-secondary">
              {t('admin.feeFilterDateTo')}
              <input
                type="date"
                value={journalTo}
                min={journalFrom || undefined}
                onChange={(e) => setJournalTo(e.target.value)}
                className={`mt-1 block w-40 ${fieldClass}`}
              />
            </label>
            <label className="text-xs text-secondary">
              {t('admin.aptLabel')}
              <select
                value={journalProperty === '' ? '' : String(journalProperty)}
                onChange={(e) => setJournalProperty(e.target.value === '' ? '' : Number(e.target.value))}
                className={`mt-1 block w-44 ${fieldClass}`}
              >
                <option value="">{t('admin.sfFilterAll')}</option>
                {sortedProps.map((p) => (
                  <option key={p.id} value={p.id}>
                    {formatPropertyIdentity(p, t)}
                    {p.owner_name ? ` — ${p.owner_name}` : ''}
                  </option>
                ))}
              </select>
            </label>
            <AdminSecondaryButton
              type="button"
              disabled={!journalFrom && !journalTo && journalProperty === ''}
              onClick={() => {
                setJournalFrom('');
                setJournalTo('');
                setJournalProperty('');
              }}
            >
              {t('admin.sfFilterReset')}
            </AdminSecondaryButton>
            <p className="ml-auto text-xs text-muted">
              {t('admin.kindPayment')}: {formatEurAmount(cashTotal, locale)}
            </p>
          </div>
        </div>
        {renderReversePanel()}
        {journalLoading ? (
          <p className="text-sm text-muted">{t('common.loading')}</p>
        ) : rows.length === 0 ? (
          <AdminEmptyState title={t('admin.feeNoLedger')} />
        ) : (
          <AdminTableShell>
            <table className="w-full min-w-[48rem] text-sm">
              <thead>
                <tr className={adminTableHeadRowClass}>
                  <th className={adminTableCellClass}>{t('admin.feePayDate')}</th>
                  <th className={adminTableCellClass}>{t('form.colApt')}</th>
                  <th className={adminTableCellClass}>{t('admin.kind')}</th>
                  <th className={adminTableCellClass}>{t('admin.amount')}</th>
                  <th className={adminTableCellClass}>{t('admin.feePayAppliedYears')}</th>
                  <th className={adminTableCellClass}>{t('admin.status')}</th>
                  <th className={adminTableCellClass}>{t('receipt.open')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const apt = aptById.get(row.property_id);
                  const reversed = reversedIds.has(row.id);
                  return (
                    <tr key={row.id} className={adminTableRowClass}>
                      <td className={`${adminTableCellClass} tabular-nums`}>
                        {formatOwnerDateTime(row.created_at, locale)}
                      </td>
                      <td className={adminTableCellClass}>
                        {apt ? (
                          <PropertyIdentityLink property={apt} module="support" compact />
                        ) : (
                          `#${row.property_id}`
                        )}
                      </td>
                      <td className={adminTableCellClass}>
                        <div>{t(supportLedgerKindLabelKey(row.kind))}</div>
                        {row.reverses_ledger_id ? (
                          <div className="text-[10px] text-muted">{t('admin.feeReverseLinked')}</div>
                        ) : null}
                        {row.reversal_reason || row.note ? (
                          <div className="text-[10px] text-muted">
                            {row.reversal_reason?.trim()
                              ? row.reversal_reason
                              : presentLedgerOperationNote({ kind: row.kind, note: row.note }, t)}
                          </div>
                        ) : null}
                      </td>
                      <td className={`${adminTableCellClass} tabular-nums`}>
                        {formatEurAmount(row.amount, locale)}
                      </td>
                      <td className={`${adminTableCellClass} tabular-nums`}>
                        {yearsLabel(row, journalAlloc)}
                      </td>
                      <td className={adminTableCellClass}>
                        {isSupportPaymentReversible(row.kind) && reversed ? (
                          <StatusBadge label={t('admin.feeReversedBadge')} tone="warning" />
                        ) : isSupportPaymentReversible(row.kind) && canReverse ? (
                          <AdminSecondaryButton
                            type="button"
                            onClick={() => {
                              setReverseLedgerId(row.id);
                              setReverseReason('');
                              setReverseConfirm(false);
                            }}
                          >
                            {t('admin.feeReversePayment')}
                          </AdminSecondaryButton>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td className={`${adminTableCellClass} align-top`}>
                        {row.kind === 'payment' ? (
                          <LedgerPaymentReceiptCell
                            supabase={supabase}
                            module="support_fee"
                            ledgerId={String(row.id)}
                            kind={row.kind}
                            onFillUk={goFillUk}
                          />
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </AdminTableShell>
        )}
        {journalLedger.length >= LEDGER_LIMIT ? (
          <p className="text-xs text-muted">{t('admin.sfRegisterCount', { n: String(LEDGER_LIMIT) })}+</p>
        ) : null}
      </div>
    );
  }

  // ----- apartment card -----
  function renderCard() {
    const pid = propertyId === '' ? null : Number(propertyId);
    const total = pid == null ? 0 : canonicalSupportOutstanding(assessments, pid);
    const openingDebt = pid == null ? 0 : supportFeeOpeningRemaining(assessments, pid);
    const over = Math.max(0, Number(selected?.overpayment ?? 0));

    const own = assessments
      .filter((a) => pid != null && a.property_id === pid)
      .sort((a, b) => Number(b.billing_year) - Number(a.billing_year) || String(b.created_at).localeCompare(String(a.created_at)));
    const yearRows = [
      ...new Set(
        own
          .filter((a) => !a.opening_import && isActiveSupportAssessmentStatus(a.status))
          .map((a) => Number(a.billing_year)),
      ),
    ]
      .sort((a, b) => a - b)
      .map((year) => ({ year, remaining: supportFeeYearRemaining(assessments, year, pid ?? undefined) }))
      .filter((r) => r.remaining > 0 || r.year === chargeYear);

    const cardPayments = cardLedger.filter(
      (r) => r.kind === 'payment' || r.kind === 'payment_reversal' || isSupportFeeCreditOffsetKind(r.kind),
    );
    const reversedIds = new Set(
      cardLedger
        .filter((r) => r.kind === 'payment_reversal' && r.reverses_ledger_id != null)
        .map((r) => Number(r.reverses_ledger_id)),
    );
    const historyRows = buildSupportFeeHistoryRows(
      cardLedger,
      new Map(properties.map((p) => [p.id, p.apartment_number ?? p.id] as const)),
    ).slice(0, 60);

    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <AdminSecondaryButton type="button" onClick={backToRegister}>
            {t('admin.feeBackToRegister')}
          </AdminSecondaryButton>
          <p className="text-sm text-secondary">
            {selected ? (
              <PropertyIdentityLink property={selected} module="support" showOpenAction />
            ) : (
              '—'
            )}
            {selected?.owner_name ? ` — ${selected.owner_name}` : ''}
          </p>
        </div>

        {alerts}

        {openingPending ? (
          <div className={cardClass} data-support-fee-opening-pending="1">
            <AdminInlineAlert tone="warning">
              {t('admin.openingStatus_needs_initial_support_fee')}
            </AdminInlineAlert>
            {!openingFormOpen ? (
              <div className="mt-3">
                <AdminPrimaryButton
                  type="button"
                  disabled={!canPay}
                  onClick={() => setOpeningFormOpen(true)}
                  data-testid="sf-enter-opening"
                >
                  {t('admin.feeEnterOpeningBalance')}
                </AdminPrimaryButton>
              </div>
            ) : (
              <form onSubmit={handleConfirmSupportFeeOpening} className="mt-4 space-y-3">
                <p className="text-sm font-medium text-foreground">{t('admin.feeOpeningConfirmTitle')}</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="block text-xs text-secondary">
                    {t('admin.firstRunSfAutoYearLabel')}
                    <p className="mt-1 text-sm font-medium text-foreground" data-testid="sf-opening-year">
                      {openingYear || (launchYear != null ? String(launchYear) : '—')}
                    </p>
                    <p className="mt-1 text-xs text-secondary">{t('admin.firstRunSfAutoYearHint')}</p>
                  </div>
                  <label className="block text-xs text-secondary sm:col-span-2">
                    {t('admin.feeOpeningSignedAmount')}
                    <input
                      className={`mt-1 ${fieldClass}`}
                      type="text"
                      inputMode="decimal"
                      value={openingSignedAmount}
                      onChange={(e) => setOpeningSignedAmount(e.target.value)}
                      required
                      placeholder="50 / +50 / -50 / 0"
                      data-testid="sf-opening-signed"
                    />
                    <span className="mt-1 block text-xs text-secondary">{t('admin.feeOpeningSignedAmountHint')}</span>
                  </label>
                </div>
                {(() => {
                  const parsed = parseMeterOpeningAmount(openingSignedAmount);
                  if (!parsed.ok || parsed.value == null) return null;
                  const kind = meterKindFromSignedAmount(parsed.value);
                  const abs = Math.abs(parsed.value);
                  const amount = formatEurAmount(abs, locale).replace(/\s*€$/, '').trim();
                  const preview =
                    kind === 'debt'
                      ? t('admin.feeOpeningPreviewDebt', { amount })
                      : kind === 'overpayment'
                        ? t('admin.feeOpeningPreviewCredit', { amount })
                        : t('admin.feeOpeningPreviewZero');
                  return <p className="text-sm font-medium text-foreground">{preview}</p>;
                })()}
                <div className="flex flex-wrap gap-2">
                  <AdminPrimaryButton
                    type="submit"
                    disabled={openingConfirmBusy || !canPay}
                    data-testid="sf-opening-confirm"
                  >
                    {openingConfirmBusy ? t('common.saving') : t('admin.feeOpeningConfirmSubmit')}
                  </AdminPrimaryButton>
                  <AdminSecondaryButton type="button" onClick={() => setOpeningFormOpen(false)}>
                    {t('common.cancel')}
                  </AdminSecondaryButton>
                </div>
              </form>
            )}
          </div>
        ) : null}

        {/* Outstanding breakdown */}
        <div className={cardClass} data-support-fee-breakdown="1">
          <p className={labelClass}>{t('admin.feeTotalOutstanding')}</p>
          <dl className="mt-3 grid gap-2 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-secondary">{t('admin.feeOpeningDebt')}</dt>
              <dd className="font-medium tabular-nums" data-breakdown="opening">
                {formatEurAmount(openingDebt, locale)}
              </dd>
            </div>
            {yearRows.map((r) => (
              <div key={r.year} className="flex justify-between gap-3">
                <dt className="text-secondary">{t('admin.feeYearRemaining', { year: String(r.year) })}</dt>
                <dd className="font-medium tabular-nums" data-breakdown={`year-${r.year}`}>
                  {formatEurAmount(r.remaining, locale)}
                </dd>
              </div>
            ))}
            <div className="flex justify-between gap-3 border-t border-border pt-2">
              <dt className="font-semibold text-foreground">{t('admin.feeTotalOutstanding')}</dt>
              <dd
                className={`text-base font-semibold tabular-nums ${total > 0 ? 'text-danger' : ''}`}
                data-breakdown="total"
              >
                {assessmentsLoading ? t('common.loading') : formatEurAmount(total, locale)}
              </dd>
            </div>
            <div className="flex justify-between gap-3 text-xs">
              <dt className="text-muted">{t('account.sfCreditOnBalance')}</dt>
              <dd className={`tabular-nums ${over > 0 ? 'text-success' : 'text-muted'}`}>
                {formatEurAmount(over, locale)}
              </dd>
            </div>
          </dl>
          <div className="mt-4">
            <AdminPrimaryButton
              type="button"
              disabled={!canPay || supportFeeMissing}
              onClick={() => {
                setPayOpen((open) => {
                  const next = !open;
                  if (next && !payAmount && total > 0) setPayAmount(total.toFixed(2));
                  return next;
                });
              }}
            >
              {t('admin.feeRegisterPay')}
            </AdminPrimaryButton>
            {!canPay ? <p className="mt-2 text-xs text-warning">{t('admin.feePayWho')}</p> : null}
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
          {payOpen && canPay ? (
            <form onSubmit={handlePay} className="mt-4 space-y-3 border-t border-border pt-4">
              <p className="text-sm text-secondary">{t('admin.feeWillRecord')}</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-xs text-secondary">
                  {t('admin.sfPayEffectiveDate')}
                  <input
                    className={`mt-1 ${fieldClass}`}
                    type="date"
                    value={payEffectiveDate}
                    onChange={(e) => setPayEffectiveDate(e.target.value)}
                    required
                    disabled={payBusy}
                  />
                  <span className="mt-1 block text-[10px] text-muted">{t('admin.sfPayEffectiveDateHint')}</span>
                </label>
                <label className="block text-xs text-secondary">
                  {t('admin.feeAmount')}
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
                </label>
                <label className="block text-xs text-secondary sm:col-span-2">
                  {t('admin.note')}
                  <input
                    className={`mt-1 ${fieldClass}`}
                    value={payNote}
                    onChange={(e) => setPayNote(e.target.value)}
                    placeholder={t('admin.feeNotePh')}
                    disabled={payBusy}
                  />
                </label>
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                <button
                  type="button"
                  className="rounded-full border border-border px-3 py-1 text-secondary"
                  onClick={() => setPayAmount(total > 0 ? total.toFixed(2) : '')}
                >
                  {t('admin.feeAllDebt')} ({formatEurAmount(total, locale)})
                </button>
              </div>
              {(() => {
                const preview = previewSupportFeePaymentAllocation({
                  amount: Number(String(payAmount).replace(',', '.')) || 0,
                  assessments: own,
                });
                if (!(Number(String(payAmount).replace(',', '.')) > 0)) return null;
                return (
                  <div className="rounded-lg border border-border/70 bg-surface-2/40 px-3 py-2 text-xs text-secondary">
                    <p className="font-medium text-foreground">{t('admin.sfPayPreviewTitle')}</p>
                    <ul className="mt-1 space-y-0.5">
                      {preview.lines.map((line) => (
                        <li key={line.assessmentId}>
                          {t('admin.sfPayPreviewLine', {
                            year: String(line.billingYear),
                            applied: formatEurAmount(line.applied, locale),
                            remaining: formatEurAmount(line.remainingAfter, locale),
                          })}
                          {line.isPenaltyYear
                            ? ` · ${t('admin.sfPayPreviewPenalty', { pct: String(line.increasePercent) })}`
                            : ''}
                        </li>
                      ))}
                    </ul>
                    <p className="mt-1">
                      {t('admin.sfPayPreviewExpected', {
                        outstanding: formatEurAmount(preview.expectedOutstanding, locale),
                        over: formatEurAmount(preview.overpaymentCreated, locale),
                      })}
                    </p>
                  </div>
                );
              })()}
              {own.some(
                (a) =>
                  assessWaiveLateIncreaseEligibility({
                    status: a.status,
                    pricingRule: a.pricing_rule,
                    increasePercent: a.increase_percent,
                    baseAmount: a.base_amount,
                    lateAmount: a.late_amount,
                    remainingDue: a.remaining_due,
                    alreadyWaived: Boolean(a.penalty_waived_at),
                  }).ok,
              ) ? (
                <div className="space-y-2 rounded-lg border border-border/70 px-3 py-2">
                  <label className="block text-xs text-secondary">
                    {t('admin.sfPayAlsoCancelPenalty')}
                    <select
                      className={`mt-1 ${fieldClass}`}
                      value={payWaiveAssessmentId}
                      onChange={(e) => setPayWaiveAssessmentId(e.target.value)}
                      disabled={payBusy}
                    >
                      <option value="">{t('admin.sfPayNoWaive')}</option>
                      {own
                        .filter(
                          (a) =>
                            assessWaiveLateIncreaseEligibility({
                              status: a.status,
                              pricingRule: a.pricing_rule,
                              increasePercent: a.increase_percent,
                              baseAmount: a.base_amount,
                              lateAmount: a.late_amount,
                              remainingDue: a.remaining_due,
                              alreadyWaived: Boolean(a.penalty_waived_at),
                            }).ok,
                        )
                        .map((a) => (
                          <option key={a.id} value={a.id}>
                            {t('admin.sfCancelPenaltyOption', {
                              year: String(a.billing_year),
                              pct: String(supportFeePenaltyCancelLabelPct(a.increase_percent)),
                              amount: formatEurAmount(
                                Math.min(
                                  Number(a.remaining_due),
                                  Math.max(0, Number(a.late_amount) - Number(a.base_amount)),
                                ),
                                locale,
                              ),
                            })}
                          </option>
                        ))}
                    </select>
                  </label>
                  {payWaiveAssessmentId ? (
                    <label className="block text-xs text-secondary">
                      {t('admin.sfCancelPenaltyReason')}
                      <input
                        className={`mt-1 ${fieldClass}`}
                        value={payWaiveReason}
                        onChange={(e) => setPayWaiveReason(e.target.value)}
                        required
                        disabled={payBusy}
                      />
                    </label>
                  ) : null}
                </div>
              ) : null}
              <PaymentReceiptPayFields
                values={payReceiptFields}
                onChange={setPayReceiptFields}
                fieldClass={fieldClass}
                defaultPayerHint={selected?.owner_name ?? undefined}
              />
              <div className="flex flex-wrap gap-2">
                <AdminPrimaryButton type="submit" disabled={payBusy || supportFeeMissing}>
                  {payBusy ? t('receipt.forming') : t('admin.feePaySubmit')}
                </AdminPrimaryButton>
                <AdminSecondaryButton type="button" disabled={payBusy} onClick={() => setPayOpen(false)}>
                  {t('common.cancel')}
                </AdminSecondaryButton>
              </div>
            </form>
          ) : null}
        </div>

        {/* Charges */}
        <div className={cardClass}>
          <p className={labelClass}>{t('admin.feeCardCharges')}</p>
          {assessmentsLoading && own.length === 0 ? (
            <p className="mt-3 text-sm text-muted">{t('common.loading')}</p>
          ) : own.length === 0 ? (
            <div className="mt-3">
              <AdminEmptyState title={t('admin.feeNoLedger')} />
            </div>
          ) : (
            <div className="mt-3">
              <AdminTableShell>
                <table className="w-full min-w-[40rem] text-sm">
                  <thead>
                    <tr className={adminTableHeadRowClass}>
                      <th className={adminTableCellClass}>{t('admin.sfYear')}</th>
                      <th className={adminTableCellClass}>{t('account.sfBase')}</th>
                      <th className={adminTableCellClass}>{t('account.sfFinal')}</th>
                      <th className={adminTableCellClass}>{t('account.sfRemainingDue')}</th>
                      <th className={adminTableCellClass}>{t('admin.status')}</th>
                      <th className={adminTableCellClass} />
                    </tr>
                  </thead>
                  <tbody>
                    {own.flatMap((a) => {
                      const expanded = expandedAssessmentId === a.id;
                      const isOpening = Boolean(a.opening_import);
                      const voidElig = assessVoidSupportAssessmentEligibility({
                        status: a.status,
                        remainingDue: a.remaining_due,
                        appliedPaymentAmount: a.applied_payment_amount,
                        appliedCreditAmount: a.applied_credit_amount,
                      });
                      const hasActiveSibling = assessments.some(
                        (x) =>
                          x.property_id === a.property_id &&
                          x.billing_year === a.billing_year &&
                          x.id !== a.id &&
                          isActiveSupportAssessmentStatus(x.status),
                      );
                      const restoreElig = assessRestoreSupportAssessmentEligibility({
                        status: a.status,
                        restoredAt: a.restored_at,
                        restoreLedgerId: a.restore_ledger_id,
                        appliedPaymentAmount: a.applied_payment_amount,
                        appliedCreditAmount: a.applied_credit_amount,
                        finalAmount: a.final_amount,
                        hasActiveSiblingForYear: hasActiveSibling,
                      });
                      const status = String(a.status ?? '').toLowerCase();
                      const rowEl = (
                        <tr key={a.id} className={`${adminTableRowClass} align-top`}>
                          <td className={`${adminTableCellClass} tabular-nums`}>
                            {a.billing_year}
                            {isOpening ? (
                              <div className="text-[10px] text-muted">{t('admin.feeOpeningDebt')}</div>
                            ) : null}
                          </td>
                          <td className={`${adminTableCellClass} tabular-nums`}>
                            {formatEurAmount(a.base_amount, locale)}
                          </td>
                          <td className={`${adminTableCellClass} tabular-nums`}>
                            {formatEurAmount(a.final_amount, locale)}
                          </td>
                          <td className={`${adminTableCellClass} tabular-nums`}>
                            {formatEurAmount(a.remaining_due, locale)}
                          </td>
                          <td className={adminTableCellClass}>
                            {status === 'void' ? (
                              <StatusBadge label={t('admin.feeVoidedBadge')} tone="warning" />
                            ) : status === 'corrected' ? (
                              <StatusBadge label={t('admin.sfHistCorrection')} tone="neutral" />
                            ) : Number(a.remaining_due) > 0 ? (
                              <StatusBadge label={t('admin.balDebt')} tone="danger" />
                            ) : a.restored_at ? (
                              <StatusBadge label={t('admin.feeRestoredBadge')} tone="info" />
                            ) : (
                              <StatusBadge label={t('admin.balSettled')} tone="neutral" />
                            )}
                            {a.penalty_waived_at ? (
                              <div className="mt-1">
                                <StatusBadge label={t('admin.sfWaivedBadge')} tone="info" />
                              </div>
                            ) : null}
                          </td>
                          <td className={`${adminTableCellClass} text-right`}>
                            <button
                              type="button"
                              aria-expanded={expanded}
                              className="text-xs text-accent hover:underline"
                              onClick={() => setExpandedAssessmentId(expanded ? null : a.id)}
                            >
                              {expanded ? '▲' : '▼'}
                            </button>
                          </td>
                        </tr>
                      );
                      if (!expanded) return [rowEl];
                      const aptNo = aptLabelOf(selected);
                      return [
                        rowEl,
                        <tr key={`${a.id}-details`} className="border-b border-border bg-surface-secondary/40">
                          <td colSpan={6} className="px-3 py-3">
                            <dl className="grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
                              <div>
                                <dt className="text-muted">{t('admin.feeYearRemaining', { year: String(a.billing_year) })}</dt>
                                <dd className="tabular-nums">{formatEurAmount(a.remaining_due, locale)}</dd>
                              </div>
                              <div>
                                <dt className="text-muted">{t('account.sfCashReceived')}</dt>
                                <dd className="tabular-nums">{formatEurAmount(a.applied_payment_amount, locale)}</dd>
                              </div>
                              <div>
                                <dt className="text-muted">{t('account.sfCreditApplied')}</dt>
                                <dd className="tabular-nums">{formatEurAmount(a.applied_credit_amount, locale)}</dd>
                              </div>
                              <div>
                                <dt className="text-muted">{t('admin.sfFilterPricing')}</dt>
                                <dd>
                                  {a.pricing_rule === 'early_full_payment'
                                    ? t('account.sfPaidEarly')
                                    : a.pricing_rule === 'late'
                                      ? t('account.sfPriceAfterYearStart')
                                      : t('account.sfStandardFee')}
                                </dd>
                              </div>
                            </dl>
                            {a.void_reason ? <p className="mt-2 text-[11px] text-muted">{a.void_reason}</p> : null}
                            {a.restore_reason ? (
                              <p className="mt-1 text-[11px] text-muted">{a.restore_reason}</p>
                            ) : null}
                            <div className="mt-3 flex flex-wrap items-center gap-2">
                              {canReverse &&
                              assessWaiveLateIncreaseEligibility({
                                status: a.status,
                                pricingRule: a.pricing_rule,
                                increasePercent: a.increase_percent,
                                baseAmount: a.base_amount,
                                lateAmount: a.late_amount,
                                remainingDue: a.remaining_due,
                                alreadyWaived: Boolean(a.penalty_waived_at),
                              }).ok ? (
                                <AdminSecondaryButton
                                  type="button"
                                  disabled={waiveBusyId === a.id}
                                  onClick={() => void handleCancelPenalty(a)}
                                >
                                  {t('admin.sfCancelPenaltyAction', {
                                    pct: String(supportFeePenaltyCancelLabelPct(a.increase_percent)),
                                  })}
                                </AdminSecondaryButton>
                              ) : null}
                              {isOpening ? null : canPay && status !== 'void' && voidElig.ok ? (
                                <AdminSecondaryButton
                                  type="button"
                                  data-void-assessment-id={a.id}
                                  data-void-property-id={String(a.property_id)}
                                  data-void-apartment={aptNo}
                                  onClick={() => {
                                    clearRestorePanel();
                                    setVoidTarget(
                                      buildSupportFeeVoidTarget({ assessment: a, apartmentNumber: aptNo }),
                                    );
                                    setVoidReason('');
                                    setVoidAptConfirm('');
                                    setVoidConfirm(false);
                                  }}
                                >
                                  {t('admin.feeVoidAssessment')}
                                </AdminSecondaryButton>
                              ) : canPay && status === 'void' && restoreElig.ok ? (
                                <AdminSecondaryButton
                                  type="button"
                                  data-restore-assessment-id={a.id}
                                  data-restore-property-id={String(a.property_id)}
                                  data-restore-apartment={aptNo}
                                  onClick={() => {
                                    clearVoidPanel();
                                    setRestoreTarget(
                                      buildSupportFeeRestoreTarget({
                                        assessment: a,
                                        apartmentNumber: aptNo,
                                        restoreAmount: restoreElig.restoreAmount,
                                      }),
                                    );
                                    setRestoreReason('');
                                    setRestoreAptConfirm('');
                                    setRestoreConfirm(false);
                                  }}
                                >
                                  {t('admin.feeRestoreAssessment')}
                                </AdminSecondaryButton>
                              ) : status === 'void' ? (
                                <span className="text-[11px] text-muted">
                                  {!restoreElig.ok ? t('admin.feeRestoreBlocked') : t('admin.feeVoidedBadge')}
                                </span>
                              ) : !voidElig.ok && status !== 'corrected' ? (
                                <span className="text-[11px] text-muted">{t('admin.feeVoidBlockedPaid')}</span>
                              ) : null}
                            </div>
                          </td>
                        </tr>,
                      ];
                    })}
                  </tbody>
                </table>
              </AdminTableShell>
            </div>
          )}
          {canPay && voidTarget && voidTarget.propertyId === pid
            ? renderActionPanel('void', voidTarget, voidTarget.remainingDue)
            : null}
          {canPay && restoreTarget && restoreTarget.propertyId === pid
            ? renderActionPanel('restore', restoreTarget, restoreTarget.restoreAmount)
            : null}
        </div>

        {/* Payments */}
        <div className={cardClass}>
          <p className={labelClass}>{t('admin.feeCardPayments')}</p>
          {renderReversePanel()}
          {cardLoading ? (
            <p className="mt-3 text-sm text-muted">{t('common.loading')}</p>
          ) : cardPayments.length === 0 ? (
            <div className="mt-3">
              <AdminEmptyState title={t('admin.feeNoLedger')} />
            </div>
          ) : (
            <div className="mt-3">
              <AdminTableShell>
                <table className="w-full min-w-[40rem] text-sm">
                  <thead>
                    <tr className={adminTableHeadRowClass}>
                      <th className={adminTableCellClass}>{t('admin.feePayDate')}</th>
                      <th className={adminTableCellClass}>{t('admin.kind')}</th>
                      <th className={adminTableCellClass}>{t('admin.amount')}</th>
                      <th className={adminTableCellClass}>{t('admin.feePayAppliedYears')}</th>
                      <th className={adminTableCellClass}>{t('admin.status')}</th>
                      <th className={adminTableCellClass}>{t('receipt.open')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cardPayments.map((row) => {
                      const reversed = reversedIds.has(row.id);
                      return (
                        <tr key={row.id} className={adminTableRowClass}>
                          <td className={`${adminTableCellClass} tabular-nums`}>
                            {formatOwnerDateTime(row.created_at, locale)}
                          </td>
                          <td className={adminTableCellClass}>{t(supportLedgerKindLabelKey(row.kind))}</td>
                          <td className={`${adminTableCellClass} tabular-nums`}>
                            {formatEurAmount(row.amount, locale)}
                          </td>
                          <td className={`${adminTableCellClass} tabular-nums`}>{yearsLabel(row, cardAlloc)}</td>
                          <td className={adminTableCellClass}>
                            {isSupportPaymentReversible(row.kind) && reversed ? (
                              <StatusBadge label={t('admin.feeReversedBadge')} tone="warning" />
                            ) : isSupportPaymentReversible(row.kind) && canReverse ? (
                              <AdminSecondaryButton
                                type="button"
                                onClick={() => {
                                  setReverseLedgerId(row.id);
                                  setReverseReason('');
                                  setReverseConfirm(false);
                                }}
                              >
                                {t('admin.feeReversePayment')}
                              </AdminSecondaryButton>
                            ) : (
                              <span className="text-muted">—</span>
                            )}
                          </td>
                          <td className={`${adminTableCellClass} align-top`}>
                            {row.kind === 'payment' ? (
                              <LedgerPaymentReceiptCell
                                supabase={supabase}
                                module="support_fee"
                                ledgerId={String(row.id)}
                                kind={row.kind}
                                onFillUk={goFillUk}
                              />
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </AdminTableShell>
            </div>
          )}
        </div>

        {/* History */}
        <div className={cardClass}>
          <p className={labelClass}>{t('admin.feeCardHistory')}</p>
          <p className="mt-1 text-xs text-muted">{t('admin.sfOpsHistoryHint')}</p>
          {cardLoading ? (
            <p className="mt-3 text-sm text-muted">{t('common.loading')}</p>
          ) : historyRows.length === 0 ? (
            <div className="mt-3">
              <AdminEmptyState title={t('admin.feeNoLedger')} />
            </div>
          ) : (
            <div className="mt-3">
              <AdminTableShell>
                <table className="w-full min-w-[36rem] text-sm">
                  <thead>
                    <tr className={adminTableHeadRowClass}>
                      <th className={adminTableCellClass}>{t('admin.date')}</th>
                      <th className={adminTableCellClass}>{t('admin.kind')}</th>
                      <th className={adminTableCellClass}>{t('admin.amount')}</th>
                      <th className={adminTableCellClass}>{t('admin.sfHistAuthor')}</th>
                      <th className={adminTableCellClass}>{t('admin.sfHistBasis')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historyRows.map((h) => (
                      <tr key={h.id} className={adminTableRowClass}>
                        <td className={adminTableCellClass}>{formatOwnerDateTime(h.createdAt, locale)}</td>
                        <td className={adminTableCellClass}>
                          <div>{t(supportFeeHistoryKindLabelKey(h.historyKind))}</div>
                          {h.period ? <div className="text-[10px] text-muted">{h.period}</div> : null}
                        </td>
                        <td className={`${adminTableCellClass} tabular-nums`}>
                          {formatEurAmount(h.amount, locale)}
                        </td>
                        <td className={`${adminTableCellClass} max-w-[10rem] truncate text-xs`}>
                          {h.author ?? '—'}
                        </td>
                        <td className={`${adminTableCellClass} max-w-[14rem] text-xs text-secondary`}>
                          {h.basis ? <span className="line-clamp-2">{h.basis}</span> : '—'}
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

  return (
    <div className="space-y-4">
      {dialog}
      {tabBar}
      {launchNotice}
      {showCard ? (
        renderCard()
      ) : (
        <>
          {alerts}
          {tab === 'register' ? renderRegister() : tab === 'charges' ? renderCharges() : renderPayments()}
        </>
      )}
    </div>
  );
}
