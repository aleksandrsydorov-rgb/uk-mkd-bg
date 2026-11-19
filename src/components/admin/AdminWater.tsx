'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { useI18n } from '@/i18n/I18nProvider';
import { labelLedgerKind } from '@/i18n/labels';
import { formatOwnerDate } from '@/lib/ownerFormat';
import { isMissingRelation } from '@/lib/polls';
import {
  balanceTone,
  canAssignWaterMeter,
  canCorrectWaterReading,
  canManageWaterFinance,
  canSeeWaterAdmin,
  canSubmitWaterStaff,
  currentWaterTariffViewFromCore,
  emptyBalance,
  estimateWaterCorrectionDeltaEur,
  formatEur,
  formatM3,
  lastActiveReading,
  mapAdminRpcError,
  todayIsoDate,
  parseWaterVolume,
  normalizeWaterVolume,
  waterReadingHasCharge,
  DEFAULT_WATER_MODE,
  type UtilityBalance,
  type WaterLedger,
  type WaterMeter,
  type WaterMode,
  type WaterReading,
  type CurrentWaterTariffView,
} from '@/lib/utilities';
import { buildWaterHistoryEntries, type WaterHistoryInput } from '@/lib/meterReadingHistory';
import { toUserFacingMessage } from '@/lib/userFacingError';
import { buildTariffsHref, parseRatesJson } from '@/lib/tariffs';
import {
  AdminCard,
  AdminMetricCard,
  AdminEmptyState,
  AdminPrimaryButton,
  AdminSecondaryButton,
  adminCardClass,
  adminFieldClass,
  AdminInlineAlert,
  parseAdminUtilityTab,
  type AdminUtilityTab,
} from '@/components/admin/AdminUi';
import { SectionPanelTabs } from '@/components/ui/SectionPanelTabs';
import { WorkplaceCardShell } from '@/components/ui/WorkplaceCardShell';
import { ApartmentCombobox } from '@/components/admin/ApartmentCombobox';
import { AdminMeterCorrectionPanel } from '@/components/admin/AdminMeterCorrectionPanel';
import { AdminUtilityFinanceWorkplace } from '@/components/admin/AdminUtilityFinanceWorkplace';
import { AdminWaterMetersRegister } from '@/components/admin/AdminWaterMetersRegister';
import { AdminWaterReadingsRegister } from '@/components/admin/AdminWaterReadingsRegister';
import { AdminWaterReadingSubmitForm } from '@/components/admin/AdminWaterReadingSubmitForm';
import {
  AdminWaterHistoryRegister,
  readWaterHistoryFiltersFromSearch,
} from '@/components/admin/AdminWaterHistoryRegister';
import { AdminWaterApartmentFinanceHistory } from '@/components/admin/AdminWaterApartmentFinanceHistory';
import { AdminModal } from '@/components/admin/AdminModal';
import type { UtilityModuleTotals } from '@/lib/utilityFinanceRegister';
import type { WaterMeterRegisterRow } from '@/lib/waterMetersRegister';
import type { WaterReadingRegisterRow } from '@/lib/waterReadingsRegister';
import type { WaterHistoryRegisterRow } from '@/lib/waterHistoryRegister';
import { presentMeterReadingStatus } from '@/lib/meterReadingHistory';
import { formatPropertyIdentity } from '@/lib/propertyIdentity';
import { MeterReadingHistory } from '@/components/meters/MeterReadingHistory';
import { useAppConfirm } from '@/components/ui/AppConfirmDialog';
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

export function AdminWater({
  supabase,
  properties,
  staffRole,
  staffActive = false,
  waterMode = DEFAULT_WATER_MODE,
  canChangeWaterMode = false,
  onSaveWaterMode,
  tab,
  onTabChange,
  focusPropertyId,
  onPropertyChange,
}: {
  supabase: SupabaseClient<Database>;
  properties: PropertyOption[];
  staffRole: string;
  staffActive?: boolean;
  waterMode?: WaterMode;
  canChangeWaterMode?: boolean;
  onSaveWaterMode?: (mode: WaterMode) => void;
  tab?: string | null;
  onTabChange?: (tab: AdminUtilityTab) => void;
  focusPropertyId?: number | '';
  onPropertyChange?: (id: number | '') => void;
}) {
  const { t, locale } = useI18n();
  const pathname = usePathname() || '/admin';
  const { confirm, dialog: confirmDialog } = useAppConfirm(t('common.close'));
  const [showDebtorsSignal, setShowDebtorsSignal] = useState(0);
  const canSee = canSeeWaterAdmin(staffRole);
  const canMeter = canAssignWaterMeter(staffRole);
  const canFinance = canManageWaterFinance(staffRole);
  const canSubmit = canSubmitWaterStaff(staffRole, staffActive);
  const waterTabs = useMemo(() => {
    const items: { id: AdminUtilityTab; label: string }[] = [
      { id: 'overview', label: t('admin.utilTabOverview') },
      { id: 'meter', label: t('admin.waterTabMeters') },
      { id: 'readings', label: t('admin.waterTabReadings') },
      { id: 'payments', label: t('admin.waterTabPayments') },
      { id: 'history', label: t('admin.waterTabHistory') },
    ];
    // finance stays URL-routable from Финансы nav; not shown in the five-tab chrome.
    if (canFinance) items.push({ id: 'finance', label: t('admin.utilTabFinance') });
    return items;
  }, [t, canFinance]);
  const allowedWaterTabs = useMemo(() => waterTabs.map((item) => item.id), [waterTabs]);
  const PANEL_TAB_IDS: readonly AdminUtilityTab[] = [
    'overview',
    'meter',
    'readings',
    'payments',
    'history',
  ];

  const sorted = useMemo(
    () =>
      [...properties].sort((a, b) =>
        aptNumber(a.apartment_number).localeCompare(aptNumber(b.apartment_number), undefined, { numeric: true }),
      ),
    [properties],
  );

  const [propertyId, setPropertyId] = useState<number | ''>(
    focusPropertyId != null && focusPropertyId !== '' ? focusPropertyId : '',
  );
  useEffect(() => {
    if (focusPropertyId == null || focusPropertyId === '') return;
    setPropertyId((current) => (current === focusPropertyId ? current : focusPropertyId));
  }, [focusPropertyId]);
  function selectProperty(id: number | '') {
    setPropertyId(id);
    onPropertyChange?.(id);
  }
  const [meters, setMeters] = useState<WaterMeter[]>([]);
  const [needsInitialOpening, setNeedsInitialOpening] = useState(false);
  const [tariff, setTariff] = useState<CurrentWaterTariffView | null>(null);
  const [readings, setReadings] = useState<WaterReading[]>([]);
  const [ledger, setLedger] = useState<WaterLedger[]>([]);
  const [balance, setBalance] = useState<UtilityBalance>(emptyBalance());
  const [meterLoading, setMeterLoading] = useState(false);
  const [tariffLoading, setTariffLoading] = useState(false);
  const [payBusy, setPayBusy] = useState(false);
  const [meterBusy, setMeterBusy] = useState(false);
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

  const [payAmount, setPayAmount] = useState('');
  const [payNote, setPayNote] = useState('');
  const [payReceiptFields, setPayReceiptFields] = useState<PaymentReceiptPayFieldValues>(emptyReceiptPayFields);
  const [lastPayReceipt, setLastPayReceipt] = useState<PaymentReceiptRow | null>(null);
  const [lastPayAmountLabel, setLastPayAmountLabel] = useState<string | null>(null);
  const [submitValue, setSubmitValue] = useState('');
  const [submitDate, setSubmitDate] = useState(todayIsoDate());
  const [submitBusy, setSubmitBusy] = useState(false);
  const [correctReadingId, setCorrectReadingId] = useState<string | null>(null);
  const [correctValue, setCorrectValue] = useState('');
  const [correctReason, setCorrectReason] = useState('');
  const [correctConfirm, setCorrectConfirm] = useState(false);
  const [correctBusy, setCorrectBusy] = useState(false);
  const [localTab, setLocalTab] = useState<AdminUtilityTab>('overview');
  const [moduleTotals, setModuleTotals] = useState<UtilityModuleTotals | null>(null);
  const [detailMeterId, setDetailMeterId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    const raw = new URLSearchParams(window.location.search).get('meter');
    return raw && raw.trim() ? raw.trim() : null;
  });
  /** Property id for meter-tab WorkplaceCardShell (allows open with no meter). */
  const [meterShellPropertyId, setMeterShellPropertyId] = useState<number | null>(() => {
    if (typeof window === 'undefined') return null;
    const params = new URLSearchParams(window.location.search);
    if ((params.get('tab') ?? '') !== 'meter') return null;
    const mid = (params.get('meter') ?? '').trim();
    const pidRaw = Number(params.get('property') ?? '');
    if (mid || (Number.isFinite(pidRaw) && pidRaw > 0)) {
      return Number.isFinite(pidRaw) && pidRaw > 0 ? pidRaw : null;
    }
    return null;
  });
  const [readingsShell, setReadingsShell] = useState<'none' | 'submit' | 'detail'>(() => {
    if (typeof window === 'undefined') return 'none';
    const params = new URLSearchParams(window.location.search);
    if (params.get('wrForm') === '1') return 'submit';
    if ((params.get('wrReading') ?? '').trim() || (params.get('wrMeter') ?? '').trim()) return 'detail';
    return 'none';
  });
  const [detailReadingId, setDetailReadingId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    const raw = new URLSearchParams(window.location.search).get('wrReading');
    return raw && raw.trim() ? raw.trim() : null;
  });
  const [detailReadingMeterId, setDetailReadingMeterId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    const raw = new URLSearchParams(window.location.search).get('wrMeter');
    return raw && raw.trim() ? raw.trim() : null;
  });
  const [submitMeterId, setSubmitMeterId] = useState('');
  const [rowSubmit, setRowSubmit] = useState<WaterReadingRegisterRow | null>(null);
  const [readingsRefreshSignal, setReadingsRefreshSignal] = useState(0);
  const [historyShellPropertyId, setHistoryShellPropertyId] = useState<number | null>(() => {
    if (typeof window === 'undefined') return null;
    const params = new URLSearchParams(window.location.search);
    if ((params.get('tab') ?? '') !== 'history') return null;
    const pidRaw = Number(params.get('property') ?? '');
    return Number.isFinite(pidRaw) && pidRaw > 0 ? pidRaw : null;
  });
  const [historyInnerTab, setHistoryInnerTab] = useState<'readings' | 'finance'>('readings');
  const [historyPeriodFrom, setHistoryPeriodFrom] = useState('');
  const [historyPeriodTo, setHistoryPeriodTo] = useState('');
  const metersListScrollRef = useRef<HTMLDivElement | null>(null);
  const metersListScrollTopRef = useRef(0);
  const meterReturnFocusRef = useRef<HTMLElement | null>(null);
  const readingsListScrollRef = useRef<HTMLDivElement | null>(null);
  const readingsListScrollTopRef = useRef(0);
  const readingsReturnFocusRef = useRef<HTMLElement | null>(null);
  const historyListScrollRef = useRef<HTMLDivElement | null>(null);
  const historyListScrollTopRef = useRef(0);
  const historyReturnFocusRef = useRef<HTMLElement | null>(null);
  const activeTab = onTabChange
    ? parseAdminUtilityTab(tab, allowedWaterTabs)
    : parseAdminUtilityTab(localTab, allowedWaterTabs);

  const panelTabs = useMemo(
    () =>
      waterTabs
        .filter((item) => (PANEL_TAB_IDS as readonly string[]).includes(item.id))
        .map((item) => {
          const params =
            typeof window !== 'undefined'
              ? new URLSearchParams(window.location.search)
              : new URLSearchParams();
          params.set('section', 'вода');
          params.set('tab', item.id);
          // Ordinary tab links = register screens. Keep filter keys; drop detail/action commands.
          params.delete('property');
          params.delete('meter');
          params.delete('wrForm');
          params.delete('wrReading');
          params.delete('wrMeter');
          return {
            id: item.id,
            label: item.label,
            href: `/admin?${params.toString()}`,
          };
        }),
    // Rebuild when tab/filters change so href keeps register filters, not open details.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- window.search captured per navigation
    [waterTabs, activeTab, focusPropertyId, propertyId],
  );

  // Complex card: outstanding debt only (overpayments are never netted into this figure).
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

  const payKeyRef = useRef(crypto.randomUUID());
  const submitKeyRef = useRef(crypto.randomUUID());
  const correctKeyRef = useRef(crypto.randomUUID());

  useEffect(() => {
    if (!staffRole) return;
    if (!onTabChange) {
      if (!allowedWaterTabs.includes(localTab)) setLocalTab('overview');
      return;
    }
    if (tab && !allowedWaterTabs.includes(tab as AdminUtilityTab)) onTabChange('overview');
  }, [onTabChange, tab, allowedWaterTabs, localTab, staffRole]);

  async function selectTab(next: AdminUtilityTab) {
    // Leaving a tab always returns to that tab's register list — close explicit details/actions.
    // Dirty forms still go through confirm (no force).
    if (detailMeterId || meterShellPropertyId != null) {
      closeMeterDetail({ keepScroll: false });
    }
    if (rowSubmit != null) {
      const ok = await closeRowSubmit();
      if (!ok) return;
    }
    if (readingsShell !== 'none') {
      const ok = await closeReadingsShell({ keepScroll: false });
      if (!ok) return;
    }
    if (historyShellPropertyId != null) {
      const ok = await closeHistoryShell({ keepScroll: false });
      if (!ok) return;
    }
    // Drop leftover apartment focus so overview/payments do not reopen a finance card.
    if (propertyId !== '') {
      selectProperty('');
    }
    if (onTabChange) onTabChange(next);
    else setLocalTab(next);
  }

  function writeMeterDetailToUrl(meterId: string | null, property: number | '') {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    params.set('section', 'вода');
    params.set('tab', 'meter');
    if (meterId) params.set('meter', meterId);
    else params.delete('meter');
    if (property === '' || property == null) params.delete('property');
    else params.set('property', String(property));
    const qs = params.toString();
    const url = qs ? `${pathname}?${qs}` : pathname;
    window.history.replaceState(window.history.state, '', url);
  }

  function openMeterDetail(row: WaterMeterRegisterRow, rowEl: HTMLElement | null) {
    metersListScrollTopRef.current = metersListScrollRef.current?.scrollTop ?? window.scrollY;
    meterReturnFocusRef.current = rowEl;
    setShowAssign(false);
    setShowReplace(false);
    setSuccess(null);
    setError(null);
    selectProperty(row.propertyId);
    setMeterShellPropertyId(row.propertyId);
    setDetailMeterId(row.meterId);
    writeMeterDetailToUrl(row.meterId, row.propertyId);
  }

  function closeMeterDetail(opts?: { keepScroll?: boolean }) {
    setDetailMeterId(null);
    setMeterShellPropertyId(null);
    setShowAssign(false);
    setShowReplace(false);
    writeMeterDetailToUrl(null, '');
    onPropertyChange?.('');
    setPropertyId('');
    const keepScroll = opts?.keepScroll !== false;
    if (keepScroll) {
      requestAnimationFrame(() => {
        if (metersListScrollRef.current) {
          metersListScrollRef.current.scrollTop = metersListScrollTopRef.current;
        } else {
          window.scrollTo({ top: metersListScrollTopRef.current });
        }
      });
    }
  }

  // Deep-link: ?tab=meter&meter=<id>&property=<pid> (property alone opens empty meter card)
  useEffect(() => {
    if (activeTab !== 'meter') return;
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const mid = (params.get('meter') ?? '').trim();
    const pidRaw = Number(params.get('property') ?? '');
    const pid = Number.isFinite(pidRaw) && pidRaw > 0 ? pidRaw : null;
    if (!mid && !pid) {
      if (detailMeterId) setDetailMeterId(null);
      if (meterShellPropertyId != null) setMeterShellPropertyId(null);
      return;
    }
    if (mid) {
      if (detailMeterId !== mid) setDetailMeterId(mid);
    } else if (detailMeterId) {
      setDetailMeterId(null);
    }
    if (pid != null) {
      if (meterShellPropertyId !== pid) setMeterShellPropertyId(pid);
      if (propertyId !== pid) selectProperty(pid);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- URL seed for meter detail
  }, [activeTab]);

  function writeReadingsShellToUrl(opts: {
    shell: 'none' | 'submit' | 'detail';
    readingId?: string | null;
    meterId?: string | null;
    property?: number | '';
  }) {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    params.set('section', 'вода');
    params.set('tab', 'readings');
    if (opts.shell === 'submit') params.set('wrForm', '1');
    else params.delete('wrForm');
    if (opts.shell === 'detail' && opts.readingId) params.set('wrReading', opts.readingId);
    else params.delete('wrReading');
    if (opts.shell === 'detail' && opts.meterId) params.set('wrMeter', opts.meterId);
    else params.delete('wrMeter');
    if (opts.property === '' || opts.property == null) params.delete('property');
    else params.set('property', String(opts.property));
    const qs = params.toString();
    const url = qs ? `${pathname}?${qs}` : pathname;
    window.history.replaceState(window.history.state, '', url);
  }

  function readingsFormDirty() {
    if (readingsShell === 'submit') {
      return (
        submitValue.trim() !== '' ||
        propertyId !== '' ||
        Boolean(submitMeterId) ||
        submitDate !== todayIsoDate()
      );
    }
    if (readingsShell === 'detail' && correctReadingId) {
      return correctReason.trim() !== '' || correctConfirm || correctValue.trim() !== '';
    }
    return false;
  }

  async function closeReadingsShell(opts?: { keepScroll?: boolean; force?: boolean }) {
    if (!opts?.force && readingsFormDirty()) {
      const ok = await confirm({
        title: t('common.discardChangesTitle'),
        description: t('common.discardChangesBody'),
        confirmLabel: t('common.leaveWithoutSaving'),
        cancelLabel: t('common.continueEditing'),
        tone: 'danger',
      });
      if (!ok) return false;
    }
    setReadingsShell('none');
    setDetailReadingId(null);
    setDetailReadingMeterId(null);
    setSubmitMeterId('');
    setRowSubmit(null);
    closeWaterCorrection();
    writeReadingsShellToUrl({ shell: 'none', property: '' });
    onPropertyChange?.('');
    setPropertyId('');
    const keepScroll = opts?.keepScroll !== false;
    if (keepScroll) {
      requestAnimationFrame(() => {
        if (readingsListScrollRef.current) {
          readingsListScrollRef.current.scrollTop = readingsListScrollTopRef.current;
        } else {
          window.scrollTo({ top: readingsListScrollTopRef.current });
        }
      });
    }
    return true;
  }

  function openReadingsSubmit() {
    readingsListScrollTopRef.current = readingsListScrollRef.current?.scrollTop ?? window.scrollY;
    readingsReturnFocusRef.current = null;
    closeWaterCorrection();
    setRowSubmit(null);
    setSubmitValue('');
    setSubmitDate(todayIsoDate());
    setSubmitMeterId('');
    setDetailReadingId(null);
    setDetailReadingMeterId(null);
    setSuccess(null);
    setError(null);
    selectProperty('');
    setReadingsShell('submit');
    writeReadingsShellToUrl({ shell: 'submit', property: '' });
  }

  function openReadingsSubmitFromRow(row: WaterReadingRegisterRow, rowEl: HTMLElement | null) {
    readingsListScrollTopRef.current = readingsListScrollRef.current?.scrollTop ?? window.scrollY;
    readingsReturnFocusRef.current = rowEl;
    closeWaterCorrection();
    setDetailReadingId(null);
    setDetailReadingMeterId(null);
    setReadingsShell('none');
    writeReadingsShellToUrl({ shell: 'none', property: row.propertyId });
    setSubmitValue('');
    setSubmitDate(todayIsoDate());
    setSubmitMeterId(row.meterId ?? '');
    setSuccess(null);
    setError(null);
    selectProperty(row.propertyId);
    setRowSubmit(row);
  }

  async function closeRowSubmit(opts?: { force?: boolean }) {
    if (
      !opts?.force &&
      (submitValue.trim() !== '' || submitDate !== todayIsoDate())
    ) {
      const ok = await confirm({
        title: t('common.discardChangesTitle'),
        description: t('common.discardChangesBody'),
        confirmLabel: t('common.leaveWithoutSaving'),
        cancelLabel: t('common.continueEditing'),
        tone: 'danger',
      });
      if (!ok) return false;
    }
    setRowSubmit(null);
    setSubmitValue('');
    setSubmitMeterId('');
    setSubmitDate(todayIsoDate());
    return true;
  }

  function openReadingDetail(row: WaterReadingRegisterRow, rowEl: HTMLElement | null) {
    readingsListScrollTopRef.current = readingsListScrollRef.current?.scrollTop ?? window.scrollY;
    readingsReturnFocusRef.current = rowEl;
    closeWaterCorrection();
    void closeRowSubmit({ force: true });
    setSuccess(null);
    setError(null);
    selectProperty(row.propertyId);
    setDetailReadingId(row.readingId);
    setDetailReadingMeterId(row.meterId);
    setReadingsShell('detail');
    writeReadingsShellToUrl({
      shell: 'detail',
      readingId: row.readingId,
      meterId: row.meterId,
      property: row.propertyId,
    });
  }

  function writeHistoryShellToUrl(property: number | '') {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    params.set('section', 'вода');
    params.set('tab', 'history');
    if (property === '' || property == null) params.delete('property');
    else params.set('property', String(property));
    const qs = params.toString();
    const url = qs ? `${pathname}?${qs}` : pathname;
    window.history.replaceState(window.history.state, '', url);
  }

  function openHistoryDetail(row: WaterHistoryRegisterRow, rowEl: HTMLElement | null) {
    historyListScrollTopRef.current = historyListScrollRef.current?.scrollTop ?? window.scrollY;
    historyReturnFocusRef.current = rowEl;
    closeWaterCorrection();
    setSuccess(null);
    setError(null);
    setHistoryInnerTab('readings');
    // Drop previous apartment payload immediately so the shell never flashes old rows.
    if (propertyId !== row.propertyId) {
      setMeters([]);
      setReadings([]);
      setLedger([]);
      setMeterLoading(true);
    }
    const live =
      typeof window !== 'undefined'
        ? readWaterHistoryFiltersFromSearch(window.location.search)
        : { periodFrom: '', periodTo: '' };
    setHistoryPeriodFrom(live.periodFrom);
    setHistoryPeriodTo(live.periodTo);
    selectProperty(row.propertyId);
    setHistoryShellPropertyId(row.propertyId);
    writeHistoryShellToUrl(row.propertyId);
  }

  async function switchHistoryInnerTab(next: 'readings' | 'finance') {
    if (next === historyInnerTab) return;
    if (next === 'finance' && correctReadingId) {
      const dirty =
        correctReason.trim() !== '' ||
        correctConfirm ||
        (correctTarget != null &&
          String(correctValue).trim() !== String(correctTarget.current_value));
      if (dirty) {
        const ok = await confirm({
          title: t('common.discardChangesTitle'),
          description: t('common.discardChangesBody'),
          confirmLabel: t('common.leaveWithoutSaving'),
          cancelLabel: t('common.continueEditing'),
          tone: 'danger',
        });
        if (!ok) return;
      }
      closeWaterCorrection();
    }
    setHistoryInnerTab(next);
  }

  async function closeHistoryShell(opts?: { keepScroll?: boolean; force?: boolean }) {
    if (!opts?.force && correctReadingId) {
      const dirty =
        correctReason.trim() !== '' ||
        correctConfirm ||
        (correctTarget != null &&
          String(correctValue).trim() !== String(correctTarget.current_value));
      if (dirty) {
        const ok = await confirm({
          title: t('common.discardChangesTitle'),
          description: t('common.discardChangesBody'),
          confirmLabel: t('common.leaveWithoutSaving'),
          cancelLabel: t('common.continueEditing'),
          tone: 'danger',
        });
        if (!ok) return false;
      }
    }
    closeWaterCorrection();
    setHistoryInnerTab('readings');
    setHistoryShellPropertyId(null);
    writeHistoryShellToUrl('');
    onPropertyChange?.('');
    setPropertyId('');
    const keepScroll = opts?.keepScroll !== false;
    if (keepScroll) {
      requestAnimationFrame(() => {
        if (historyListScrollRef.current) {
          historyListScrollRef.current.scrollTop = historyListScrollTopRef.current;
        } else {
          window.scrollTo({ top: historyListScrollTopRef.current });
        }
      });
    }
    return true;
  }

  // Deep-link: ?tab=history&property=<pid> opens journal shell (legacy apartment history links).
  useEffect(() => {
    if (activeTab !== 'history') return;
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const pidRaw = Number(params.get('property') ?? '');
    const pid = Number.isFinite(pidRaw) && pidRaw > 0 ? pidRaw : null;
    if (pid == null) {
      if (historyShellPropertyId != null) setHistoryShellPropertyId(null);
      return;
    }
    if (historyShellPropertyId !== pid) setHistoryShellPropertyId(pid);
    if (propertyId !== pid) selectProperty(pid);
    const live = readWaterHistoryFiltersFromSearch(window.location.search);
    setHistoryPeriodFrom(live.periodFrom);
    setHistoryPeriodTo(live.periodTo);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- URL seed for history shell
  }, [activeTab]);

  // Deep-link: ?tab=readings&wrForm=1 | wrReading= | wrMeter=
  useEffect(() => {
    if (activeTab !== 'readings') return;
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('wrForm') === '1') {
      if (readingsShell !== 'submit') setReadingsShell('submit');
      return;
    }
    const rid = (params.get('wrReading') ?? '').trim();
    const mid = (params.get('wrMeter') ?? '').trim();
    if (rid || mid) {
      if (readingsShell !== 'detail') setReadingsShell('detail');
      if (rid && detailReadingId !== rid) setDetailReadingId(rid);
      if (mid && detailReadingMeterId !== mid) setDetailReadingMeterId(mid);
      const pidRaw = Number(params.get('property') ?? '');
      if (Number.isFinite(pidRaw) && pidRaw > 0 && propertyId !== pidRaw) {
        selectProperty(pidRaw);
      }
      return;
    }
    if (readingsShell !== 'none') {
      setReadingsShell('none');
      setDetailReadingId(null);
      setDetailReadingMeterId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- URL seed for readings shells
  }, [activeTab]);

  const activeMeter = meters.find((m) => !m.retired_at) ?? null;
  const propertyActiveMeters = meters.filter((m) => !m.retired_at);
  const detailMeter = (() => {
    if (detailMeterId != null) {
      return meters.find((m) => m.id === detailMeterId) ?? null;
    }
    if (activeTab === 'meter' && meterShellPropertyId != null) {
      // Explicit apartment card without a selected meter — do not invent one.
      return null;
    }
    if (detailReadingMeterId != null) {
      return meters.find((m) => m.id === detailReadingMeterId) ?? activeMeter;
    }
    return activeMeter;
  })();
  const lastReading = lastActiveReading(
    detailMeter ? readings.filter((r) => r.meter_id === detailMeter.id) : readings,
  );
  const historyEntries = useMemo(() => {
    const meterNumbers = new Map(meters.map((m) => [m.id, m.meter_number]));
    const rows = readings as unknown as WaterHistoryInput[];
    // All meters for the apartment: replaced devices keep their own history rows.
    return buildWaterHistoryEntries(rows, meterNumbers);
  }, [readings, meters]);
  const correctTarget =
    correctReadingId != null ? readings.find((r) => r.id === correctReadingId) ?? null : null;
  const correctParsed = parseWaterVolume(String(correctValue));
  const correctHasCharge = waterReadingHasCharge(correctTarget);
  const correctDelta =
    correctTarget && Number.isFinite(correctParsed)
      ? estimateWaterCorrectionDeltaEur(correctTarget, normalizeWaterVolume(correctParsed))
      : null;

  const loadTariffs = useCallback(async () => {
    if (!canSee) return;
    setTariffLoading(true);
    const { data, error: qErr } = await supabase.rpc('get_applicable_utility_tariff', {
      p_tariff_key: 'water',
      p_on_date: todayIsoDate(),
    });
    setTariffLoading(false);
    if (qErr) {
      setError(toUserFacingMessage(qErr, t, { context: 'load', fallback: t('common.errLoad') }));
      setTariff(null);
      return;
    }
    const row = firstRow(data) as Record<string, unknown> | null;
    setTariff(
      currentWaterTariffViewFromCore(
        row
          ? {
              tariff_version_id: String(row.tariff_version_id ?? ''),
              valid_from: String(row.valid_from ?? ''),
              rates: parseRatesJson(row.rates),
            }
          : null,
      ),
    );
  }, [canSee, supabase, t]);

  const loadPropertyWater = useCallback(async () => {
    if (!canSee || propertyId === '') {
      setMeters([]);
      setReadings([]);
      setLedger([]);
      setBalance(emptyBalance());
      setNeedsInitialOpening(false);
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
    // History journal may need more rows (all meters incl. replaced). Other tabs keep a lighter window.
    const readingLimit = activeTab === 'history' ? 2000 : 200;
    const readingQ = supabase
      .from('water_readings')
      .select('*')
      .eq('property_id', pid)
      .order('reading_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(readingLimit);
    const pendingQ = supabase
      .from('utility_opening_pending' as never)
      .select('id, status')
      .eq('property_id', pid)
      .eq('utility', 'water')
      .eq('status', 'needs_initial')
      .limit(1);

    if (canFinance) {
      const [metersRes, readingsRes, ledgerRes, balanceRes, pendingRes] = await Promise.all([
        meterQ,
        readingQ,
        supabase
          .from('water_ledger')
          .select('*')
          .eq('property_id', pid)
          .order('created_at', { ascending: false })
          .limit(30),
        supabase.rpc('get_water_balance', { p_property_id: pid }),
        pendingQ,
      ]);
      setMeterLoading(false);
      if (metersRes.error && !isMissingRelation(metersRes.error, 'water_meters')) {
        setError(toUserFacingMessage(metersRes.error, t, { context: 'load', fallback: t('common.errLoad') }));
      }
      if (readingsRes.error && !isMissingRelation(readingsRes.error, 'water_readings')) {
        setError(toUserFacingMessage(readingsRes.error, t, { context: 'load', fallback: t('common.errLoad') }));
      }
      const meterRows = (metersRes.data ?? []) as Array<WaterMeter & { opening_confirmed_at?: string | null }>;
      setMeters(meterRows);
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
      const active = meterRows.find((m) => !m.retired_at) ?? null;
      const pendingRows = Array.isArray(pendingRes.data) ? pendingRes.data : [];
      setNeedsInitialOpening(
        pendingRows.length > 0 || (active != null && active.opening_confirmed_at == null),
      );
      return;
    }

    const [metersRes, readingsRes, pendingRes] = await Promise.all([meterQ, readingQ, pendingQ]);
    setMeterLoading(false);
    if (metersRes.error && !isMissingRelation(metersRes.error, 'water_meters')) {
      setError(toUserFacingMessage(metersRes.error, t, { context: 'load', fallback: t('common.errLoad') }));
    }
    if (readingsRes.error && !isMissingRelation(readingsRes.error, 'water_readings')) {
      setError(toUserFacingMessage(readingsRes.error, t, { context: 'load', fallback: t('common.errLoad') }));
    }
    const meterRows = (metersRes.data ?? []) as Array<WaterMeter & { opening_confirmed_at?: string | null }>;
    setMeters(meterRows);
    setReadings((readingsRes.data ?? []) as WaterReading[]);
    setLedger([]);
    setBalance(emptyBalance());
    const active = meterRows.find((m) => !m.retired_at) ?? null;
    const pendingRows = Array.isArray(pendingRes.data) ? pendingRes.data : [];
    setNeedsInitialOpening(
      pendingRows.length > 0 || (active != null && active.opening_confirmed_at == null) || (!active && pendingRows.length > 0),
    );
  }, [activeTab, canFinance, canSee, propertyId, supabase, t]);

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

  function rpcFail(message: string | undefined, opts?: { context?: 'finance' | 'generic' }) {
    setSuccess(null);
    setError(
      toUserFacingMessage(
        { message: message ?? '' },
        t,
        {
          context: opts?.context ?? 'generic',
          fallback: t(mapAdminRpcError(message ?? '')),
        },
      ),
    );
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
    // Confirm baseline via soft-opening RPC (no consumption charge on this reading).
    const { error: rpcErr } = await supabase.rpc('admin_confirm_water_opening' as never, {
      p_property_id: Number(propertyId),
      p_meter_number: number,
      p_initial_reading: initial,
      p_installed_at: installedAt,
    } as never);
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

  async function handlePay(e: React.FormEvent) {
    e.preventDefault();
    if (propertyId === '' || !canFinance || payBusy) return;
    const amount = Number(payAmount);
    if (!(amount > 0) || Number.isNaN(amount)) {
      setError(t('admin.errAmount'));
      return;
    }
    setPayBusy(true);
    setLastPayReceipt(null);
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
    const { data: payData, error: rpcErr } = await supabase.rpc('record_water_payment', {
      p_property_id: Number(propertyId),
      p_amount_eur: amount,
      p_note: payNote.trim() || null,
      p_idempotency_key: idem,
    });
    if (rpcErr) {
      setPayBusy(false);
      rpcFail(rpcErr.message, { context: 'finance' });
      return;
    }
    const ledgerId = ledgerIdFromPaymentRpc(payData);
    const amountLabel = formatEur(amount, locale);
    setLastPayAmountLabel(amountLabel);
    const finished = await finishReceiptForPayment(supabase, 'water', ledgerId);
    setLastPayReceipt(finished.receipt);
    payKeyRef.current = crypto.randomUUID();
    setPayAmount('');
    setPayNote('');
    setPayReceiptFields(emptyReceiptPayFields());
    setPayBusy(false);
    if (finished.pdfError && finished.receipt) {
      flash(t('receipt.paySavedPdfFailed'));
    } else {
      flash(t('receipt.payRegistered', { amount: amountLabel }));
    }
    void import('@/lib/email/eventProducers')
      .then(({ notifyPropertyOwnersEvent }) =>
        notifyPropertyOwnersEvent(supabase, {
          eventKey: 'meters_payment_recorded',
          propertyId: Number(propertyId),
          entityId: `water_pay:${propertyId}:${Date.now()}`,
          payload: { utility: 'water', amount_eur: amount },
        })
      )
      .catch(() => undefined);
    await loadPropertyWater();
  }

  function goFillUk() {
    window.location.assign('/admin?section=%D0%BD%D0%B0%D1%81%D1%82%D1%80%D0%BE%D0%B9%D0%BA%D0%B8');
  }

  async function handleSubmitReading(e: React.FormEvent) {
    e.preventDefault();
    if (propertyId === '' || !canSubmit || submitBusy || meterLoading) return;
    const activeCount = propertyActiveMeters.length;
    if (activeCount === 0) {
      setError(t('admin.waterReadingsNoMeterExplain'));
      return;
    }
    const resolvedMeterId =
      (submitMeterId || rowSubmit?.meterId || '').trim() ||
      (activeCount === 1 ? propertyActiveMeters[0]?.id ?? '' : '');
    if (activeCount > 1 && !resolvedMeterId) {
      setError(t('admin.waterReadingsNeedMeter'));
      return;
    }
    if (
      resolvedMeterId &&
      !propertyActiveMeters.some((m) => m.id === resolvedMeterId)
    ) {
      setError(t('admin.waterReadingsMeterNotOnProperty'));
      return;
    }
    const parsed = parseWaterVolume(String(submitValue));
    if (!Number.isFinite(parsed) || parsed < 0) {
      setError(t('account.utilNeedNumber'));
      return;
    }
    if (!submitDate) {
      setError(t('account.utilNeedDate'));
      return;
    }
    if (submitDate > todayIsoDate()) {
      setError(t('admin.errFutureDate'));
      return;
    }
    setSubmitBusy(true);
    const rpcArgs: {
      p_property_id: number;
      p_current_value: number;
      p_reading_date: string;
      p_idempotency_key: string;
      p_meter_id?: string;
    } = {
      p_property_id: Number(propertyId),
      p_current_value: normalizeWaterVolume(parsed),
      p_reading_date: submitDate,
      p_idempotency_key: submitKeyRef.current,
    };
    if (resolvedMeterId) {
      rpcArgs.p_meter_id = resolvedMeterId;
    }
    const { error: rpcErr } = await supabase.rpc('submit_water_reading', rpcArgs);
    setSubmitBusy(false);
    if (rpcErr) {
      rpcFail(rpcErr.message);
      return;
    }
    submitKeyRef.current = crypto.randomUUID();
    setSubmitValue('');
    setSubmitMeterId('');
    flash(t('account.utilSubmitOk'));
    void import('@/lib/email/eventProducers')
      .then(({ notifyPropertyOwnersEvent }) =>
        notifyPropertyOwnersEvent(supabase, {
          eventKey: 'meters_reading_accepted',
          propertyId: Number(propertyId),
          entityId: `water_read:${propertyId}:${resolvedMeterId || 'auto'}:${submitDate}`,
          payload: {
            utility: 'water',
            reading_date: submitDate,
            meter_id: resolvedMeterId || null,
          },
        })
      )
      .catch(() => undefined);
    await loadPropertyWater();
    setReadingsRefreshSignal((n) => n + 1);
    if (rowSubmit) {
      await closeRowSubmit({ force: true });
    } else if (readingsShell === 'submit') {
      await closeReadingsShell({ force: true, keepScroll: true });
    }
  }

  function goToMetersForSubmitProperty() {
    const pid = propertyId === '' ? rowSubmit?.propertyId : propertyId;
    const ctx = rowSubmit;
    void closeRowSubmit({ force: true });
    if (readingsShell === 'submit') void closeReadingsShell({ force: true, keepScroll: false });
    if (pid == null) {
      void selectTab('meter');
      return;
    }
    void selectTab('meter');
    openMeterDetail(
      {
        meterId: null,
        propertyId: Number(pid),
        apartmentNumber: ctx?.apartmentNumber ?? '',
        sectionCode: ctx?.sectionCode ?? '',
        blockCode: ctx?.blockCode ?? '',
        meterNumber: '',
        installedAt: null,
      },
      null,
    );
  }

  function openWaterCorrection(row: WaterReading) {
    const hasCharge = waterReadingHasCharge(row);
    if (!canCorrectWaterReading(staffRole, staffActive, hasCharge)) {
      setError(t('admin.errNoAccess'));
      return;
    }
    setCorrectReadingId(row.id);
    setCorrectValue(String(row.current_value));
    setCorrectReason('');
    setCorrectConfirm(false);
    correctKeyRef.current = crypto.randomUUID();
    setError(null);
    setSuccess(null);
  }

  function closeWaterCorrection() {
    setCorrectReadingId(null);
    setCorrectValue('');
    setCorrectReason('');
    setCorrectConfirm(false);
    setCorrectBusy(false);
  }

  async function handleCorrectReading() {
    if (!correctTarget) return;
    const hasCharge = waterReadingHasCharge(correctTarget);
    if (!canCorrectWaterReading(staffRole, staffActive, hasCharge)) {
      setError(t('admin.errNoAccess'));
      return;
    }
    if (!correctConfirm || !correctReason.trim()) {
      setError(t('admin.errCorrectionReason'));
      return;
    }
    const parsed = parseWaterVolume(String(correctValue));
    if (!Number.isFinite(parsed) || parsed < 0) {
      setError(t('account.utilNeedNumber'));
      return;
    }
    setCorrectBusy(true);
    const { error: rpcErr } = await supabase.rpc('correct_water_reading', {
      p_reading_id: correctTarget.id,
      p_corrected_value: normalizeWaterVolume(parsed),
      p_reason: correctReason.trim(),
      p_idempotency_key: correctKeyRef.current,
    });
    setCorrectBusy(false);
    if (rpcErr) {
      rpcFail(rpcErr.message);
      return;
    }
    correctKeyRef.current = crypto.randomUUID();
    closeWaterCorrection();
    flash(t('admin.meterCorrectionOk'));
    await loadPropertyWater();
    setReadingsRefreshSignal((n) => n + 1);
  }

  const waterModeLabel =
    waterMode === 'staff_only' ? t('admin.elModeStaffOnly') : t('admin.elModeOwnerAndStaff');
  const retiredMeters = meters.filter((m) => m.retired_at);
  const onOverview = activeTab === 'overview';
  const detailOpen = activeTab === 'meter' && meterShellPropertyId != null;
  const readingsSubmitOpen = activeTab === 'readings' && readingsShell === 'submit';
  const readingsDetailOpen = activeTab === 'readings' && readingsShell === 'detail';
  const historyDetailOpen = activeTab === 'history' && historyShellPropertyId != null;
  const historyDetailProperty =
    historyShellPropertyId != null
      ? sorted.find((p) => p.id === historyShellPropertyId) ?? null
      : null;
  const historyDetailTitle = historyDetailProperty
    ? formatPropertyIdentity(
        {
          apartment_number: historyDetailProperty.apartment_number,
          section_code: historyDetailProperty.section_code,
          block_code: historyDetailProperty.block_code,
        },
        t,
      )
    : t('admin.readingHistory');
  const detailProperty = sorted.find((p) => p.id === propertyId) ?? null;
  const detailTitle = detailMeter
    ? `${t('admin.meterNumber')}: ${detailMeter.meter_number?.trim() ? detailMeter.meter_number : '—'}`
    : t('admin.waterTabMeters');
  const detailTitleMeta = detailProperty
    ? formatPropertyIdentity(
        {
          apartment_number: detailProperty.apartment_number,
          section_code: detailProperty.section_code,
          block_code: detailProperty.block_code,
        },
        t,
      )
    : null;
  const detailReadingRow =
    detailReadingId != null ? readings.find((r) => r.id === detailReadingId) ?? null : null;
  const detailReadingStatus = detailReadingRow
    ? presentMeterReadingStatus({
        readingKind: (detailReadingRow as WaterReading & { reading_kind?: string | null }).reading_kind,
        rowStatus: detailReadingRow.status,
      })
    : null;
  function readingStatusLabel(code: ReturnType<typeof presentMeterReadingStatus> | null) {
    if (code === 'opening') return t('admin.meterHistStatusOpening');
    if (code === 'pending_review') return t('admin.meterHistStatusPending');
    if (code === 'accepted') return t('admin.meterHistStatusAccepted');
    if (code === 'rejected') return t('admin.meterHistStatusRejected');
    return '—';
  }
  const readingsDetailTitle = detailReadingRow
    ? `${t('admin.waterReadingsDetailTitle')} · ${
        detailMeter?.meter_number?.trim() || detailReadingMeterId || '—'
      }`
    : t('admin.waterReadingsDetailTitle');
  const detailReadingCorrectable =
    detailReadingRow != null &&
    lastReading?.id === detailReadingRow.id &&
    detailReadingRow.status === 'active' &&
    canCorrectWaterReading(
      staffRole,
      staffActive,
      waterReadingHasCharge(detailReadingRow),
    );

  function waterTariffHref() {
    // Normalize via URLSearchParams so Cyrillic section values are not double-encoded in `return`.
    const liveSearch =
      typeof window !== 'undefined' ? new URLSearchParams(window.location.search).toString() : '';
    return buildTariffsHref({
      tariffKey: 'water',
      tab: 'current',
      returnSearch: liveSearch,
      pathname,
    });
  }

  const tariffValueLabel = tariffLoading
    ? t('common.loading')
    : tariff
      ? `${formatEur(Number(tariff.price_eur_per_m3), locale)} / м³`
      : '—';

  function renderOverviewCards() {
    return (
      <div className="grid grid-cols-1 items-stretch gap-3 sm:grid-cols-3">
        <div className={`${adminCardClass} flex h-full min-h-[5.5rem] w-full flex-col px-3 py-2.5 text-left`}>
          <span className="text-xs text-muted">{t('admin.waterMode')}</span>
          <span className="mt-0.5 text-[11px] text-secondary">{t('admin.waterModeWho')}</span>
          {canChangeWaterMode ? (
            <select
              className={`mt-2 ${fieldClass}`}
              value={waterMode}
              aria-label={t('admin.waterMode')}
              onChange={(e) => onSaveWaterMode?.(e.target.value as WaterMode)}
            >
              <option value="owner_and_staff">{t('admin.elModeOwnerAndStaff')}</option>
              <option value="staff_only">{t('admin.elModeStaffOnly')}</option>
            </select>
          ) : (
            <span className="mt-2 text-base font-semibold leading-tight text-foreground">
              {waterModeLabel}
            </span>
          )}
        </div>
        <div className={`${adminCardClass} flex h-full min-h-[5.5rem] w-full flex-col px-3 py-2.5 text-left`}>
          <span className="text-xs text-muted">{t('admin.currentTariff')}</span>
          {tariff ? (
            <>
              <Link
                href={waterTariffHref()}
                className="mt-1 w-fit text-xl font-semibold tabular-nums leading-none text-accent underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                {tariffValueLabel}
              </Link>
              <Link
                href={waterTariffHref()}
                className="mt-1 w-fit text-xs font-medium text-accent underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                {t('admin.utilRegOpenTariff')}
              </Link>
            </>
          ) : (
            <>
              <span className="mt-1 text-xl font-semibold tabular-nums leading-none text-foreground">
                {tariffValueLabel}
              </span>
              <span className="mt-1 text-xs text-secondary">{t('admin.noTariff')}</span>
            </>
          )}
        </div>
        <div className="h-full min-h-[5.5rem]">
          <AdminMetricCard
            label={t('admin.waterBalance')}
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

  if (!canSee) {
    return (
      <AdminCard>
        <p className="text-sm text-secondary">{t('admin.waterNoAccess')}</p>
      </AdminCard>
    );
  }

  if (activeTab === 'finance') {
    // Финансы → Вода: same payments register as Коммунальные → Вода → Оплаты,
    // without the five-tab water chrome (independent nav + ff* filter URL ns).
    if (!canFinance) {
      return (
        <AdminCard>
          <p className="text-sm text-secondary">{t('admin.waterNoAccess')}</p>
        </AdminCard>
      );
    }
    return (
      <div className="space-y-3">
        <AdminUtilityFinanceWorkplace
          service="water"
          supabase={supabase}
          properties={sorted}
          canOperate={canFinance}
          focusPropertyId={focusPropertyId ?? ''}
          onPropertyChange={selectProperty}
          onModuleTotals={setModuleTotals}
          ledgerKinds={['payment', 'payment_reversal']}
          listPaymentAction
          urlFilterNs="ff"
        />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {confirmDialog}
      <SectionPanelTabs
        aria-label={t('admin.water')}
        value={activeTab}
        onChange={(id) => void selectTab(id as AdminUtilityTab)}
        items={panelTabs}
      />

      {error ? <AdminInlineAlert tone="danger">{error}</AdminInlineAlert> : null}
      {success ? <AdminInlineAlert tone="success">{success}</AdminInlineAlert> : null}

      {onOverview ? (
        <>
          {renderOverviewCards()}
          {canFinance ? (
            <AdminUtilityFinanceWorkplace
              service="water"
              supabase={supabase}
              properties={sorted}
              canOperate={canFinance}
              focusPropertyId={focusPropertyId ?? ''}
              onPropertyChange={selectProperty}
              onModuleTotals={setModuleTotals}
              showDebtorsSignal={showDebtorsSignal}
            />
          ) : (
            <AdminInlineAlert tone="warning">{t('admin.waterNoAccess')}</AdminInlineAlert>
          )}
        </>
      ) : null}

      {activeTab === 'meter' ? (
        <AdminWaterMetersRegister
          supabase={supabase}
          properties={sorted}
          canOperate={canSee}
          focusMeterId={detailMeterId}
          listScrollRef={metersListScrollRef}
          onOpenMeter={openMeterDetail}
        />
      ) : null}

      <WorkplaceCardShell
        open={detailOpen}
        entityKey={detailMeterId ?? `apt-${meterShellPropertyId ?? 'meter'}`}
        title={detailTitle}
        titleMeta={detailTitleMeta}
        closeLabel={t('admin.waterMetersDetailClose')}
        onClose={() => closeMeterDetail()}
        onRequestClose={() => closeMeterDetail()}
        returnFocusRef={meterReturnFocusRef}
      >
        <div className="space-y-4">
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
            {t('admin.waterStatus')}
          </p>
          {needsInitialOpening ? (
            <AdminInlineAlert tone="warning">
              {t('admin.openingStatus_needs_initial_readings')}
            </AdminInlineAlert>
          ) : null}
          {meterLoading || (detailMeterId != null && !detailMeter && propertyId !== '') ? (
            <p className="text-sm text-muted">{t('common.loading')}</p>
          ) : !detailMeter ? (
            <AdminEmptyState
              title={
                needsInitialOpening
                  ? t('admin.openingStatus_needs_initial_readings')
                  : t('admin.noWaterMeter')
              }
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <div className="text-[11px] text-muted">{t('admin.meterNumber')}</div>
                <div className="mt-0.5 font-semibold">
                  {detailMeter.meter_number?.trim() ? detailMeter.meter_number : '—'}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-muted">{t('admin.installedAt')}</div>
                <div className="mt-0.5 tabular-nums">
                  {detailMeter.installed_at ? formatOwnerDate(detailMeter.installed_at) : '—'}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-muted">{t('admin.initialReading')}</div>
                <div className="mt-0.5 tabular-nums">
                  {formatM3(Number(detailMeter.initial_reading), locale)}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-muted">{t('admin.lastReading')}</div>
                <div className="mt-0.5 tabular-nums">
                  {lastReading ? formatM3(Number(lastReading.current_value), locale) : '—'}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-muted">{t('admin.prev')}</div>
                <div className="mt-0.5 tabular-nums">
                  {lastReading
                    ? formatM3(Number(lastReading.previous_value), locale)
                    : formatM3(Number(detailMeter.initial_reading), locale)}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-muted">{t('admin.lastReadingDate')}</div>
                <div className="mt-0.5 tabular-nums">
                  {lastReading?.reading_date ? formatOwnerDate(lastReading.reading_date) : '—'}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-muted">{t('admin.currentTariff')}</div>
                <div className="mt-0.5 tabular-nums">
                  {tariff
                    ? `${formatEur(Number(tariff.price_eur_per_m3), locale)} / m³`
                    : t('admin.noTariff')}
                </div>
              </div>
            </div>
          )}

          {canMeter ? (
            <div className="flex flex-wrap gap-2">
              {!detailMeter ? (
                <button
                  type="button"
                  onClick={() => {
                    setShowAssign((v) => !v);
                    setShowReplace(false);
                  }}
                  className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover"
                >
                  {t('admin.assignMeter')}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setShowReplace((v) => !v);
                    setShowAssign(false);
                  }}
                  className="rounded-xl border border-border px-4 py-2 text-sm text-secondary hover:bg-hover"
                >
                  {t('admin.replaceMeter')}
                </button>
              )}
            </div>
          ) : null}

          {canMeter && showAssign ? (
            <form onSubmit={handleAssign} className="grid gap-3 sm:grid-cols-3">
              <input
                className={fieldClass}
                placeholder={t('admin.meterNumber')}
                value={meterNumber}
                onChange={(e) => setMeterNumber(e.target.value)}
                required
              />
              <input
                className={fieldClass}
                type="number"
                min="0"
                step="0.1"
                placeholder={t('admin.initialReading')}
                value={initialReading}
                onChange={(e) => setInitialReading(e.target.value)}
                required
              />
              <input
                className={fieldClass}
                type="date"
                max={todayIsoDate()}
                value={installedAt}
                onChange={(e) => setInstalledAt(e.target.value)}
                required
              />
              <div className="flex gap-2 sm:col-span-3">
                <button
                  type="submit"
                  disabled={meterBusy}
                  className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
                >
                  {meterBusy ? t('common.saving') : t('common.save')}
                </button>
                <button
                  type="button"
                  onClick={() => setShowAssign(false)}
                  className="rounded-lg border border-border px-4 py-2 text-sm text-secondary hover:bg-hover"
                >
                  {t('common.cancel')}
                </button>
              </div>
            </form>
          ) : null}

          {canMeter && showReplace && detailMeter ? (
            <form onSubmit={handleReplace} className="grid gap-3 sm:grid-cols-2">
              <input
                className={fieldClass}
                placeholder={t('admin.newMeterNumber')}
                value={replaceNumber}
                onChange={(e) => setReplaceNumber(e.target.value)}
                required
              />
              <input
                className={fieldClass}
                type="number"
                min="0"
                step="0.1"
                placeholder={t('admin.initialReading')}
                value={replaceInitial}
                onChange={(e) => setReplaceInitial(e.target.value)}
                required
              />
              <input
                className={fieldClass}
                type="date"
                max={todayIsoDate()}
                value={replaceDate}
                onChange={(e) => setReplaceDate(e.target.value)}
                required
              />
              <input
                className={fieldClass}
                placeholder={t('admin.replaceReason')}
                value={replaceReason}
                onChange={(e) => setReplaceReason(e.target.value)}
                required
              />
              <div className="flex gap-2 sm:col-span-2">
                <button
                  type="submit"
                  disabled={meterBusy}
                  className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
                >
                  {meterBusy ? t('common.saving') : t('common.save')}
                </button>
                <button
                  type="button"
                  onClick={() => setShowReplace(false)}
                  className="rounded-lg border border-border px-4 py-2 text-sm text-secondary hover:bg-hover"
                >
                  {t('common.cancel')}
                </button>
              </div>
            </form>
          ) : null}

          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
            {t('admin.utilMeterHistory')}
          </p>
          {retiredMeters.length === 0 ? (
            <AdminEmptyState title={t('admin.utilNoMeterHistory')} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[28rem] text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted">
                    <th className="py-2 pr-3">{t('admin.meterNumber')}</th>
                    <th className="py-2 pr-3">{t('admin.installedAt')}</th>
                    <th className="py-2 pr-3">{t('admin.initialReading')}</th>
                    <th className="py-2 pr-3">{t('admin.date')}</th>
                    <th className="py-2 pr-3">{t('admin.note')}</th>
                  </tr>
                </thead>
                <tbody>
                  {retiredMeters.map((row) => (
                    <tr key={row.id} className="border-t border-border">
                      <td className="py-2 pr-3">{row.meter_number?.trim() ? row.meter_number : '—'}</td>
                      <td className="py-2 pr-3 tabular-nums">
                        {row.installed_at ? formatOwnerDate(row.installed_at) : '—'}
                      </td>
                      <td className="py-2 pr-3 tabular-nums">
                        {formatM3(Number(row.initial_reading), locale)}
                      </td>
                      <td className="py-2 pr-3 tabular-nums">
                        {row.retired_at ? formatOwnerDate(row.retired_at) : '—'}
                      </td>
                      <td className="py-2 pr-3 text-secondary">{row.replacement_reason ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </WorkplaceCardShell>

      {activeTab === 'readings' ? (
        <AdminWaterReadingsRegister
          supabase={supabase}
          properties={sorted}
          canOperate={canSee}
          canSubmit={canSubmit}
          refreshSignal={readingsRefreshSignal}
          focusReadingId={detailReadingId}
          focusMeterId={detailReadingMeterId}
          listScrollRef={readingsListScrollRef}
          onOpenReading={openReadingDetail}
          onOpenSubmit={openReadingsSubmit}
          onSubmitReading={openReadingsSubmitFromRow}
        />
      ) : null}

      {activeTab === 'payments' ? (
        canFinance ? (
          <AdminUtilityFinanceWorkplace
            service="water"
            supabase={supabase}
            properties={sorted}
            canOperate={canFinance}
            focusPropertyId={focusPropertyId ?? ''}
            onPropertyChange={selectProperty}
            onModuleTotals={setModuleTotals}
            ledgerKinds={['payment', 'payment_reversal']}
            listPaymentAction
            urlFilterNs="uf"
          />
        ) : (
          <AdminInlineAlert tone="warning">{t('admin.waterNoAccess')}</AdminInlineAlert>
        )
      ) : null}

      <WorkplaceCardShell
        open={readingsSubmitOpen}
        entityKey="water-reading-submit"
        title={t('admin.waterReadingsFormTitle')}
        closeLabel={t('admin.waterMetersDetailClose')}
        onClose={() => void closeReadingsShell()}
        onRequestClose={() => void closeReadingsShell()}
        returnFocusRef={readingsReturnFocusRef}
      >
        {canSubmit ? (
          <AdminWaterReadingSubmitForm
            mode="picker"
            properties={sorted}
            propertyId={propertyId}
            onPropertyChange={(id) => {
              selectProperty(id);
              setSubmitMeterId('');
              setSuccess(null);
              setError(null);
            }}
            meters={propertyActiveMeters.map((m) => ({
              id: m.id,
              meter_number: m.meter_number,
            }))}
            selectedMeterId={submitMeterId}
            onMeterChange={setSubmitMeterId}
            lastKnownValue={(() => {
              const mid =
                submitMeterId ||
                (propertyActiveMeters.length === 1 ? propertyActiveMeters[0]?.id ?? '' : '');
              if (!mid) return null;
              const lr = lastActiveReading(readings.filter((r) => r.meter_id === mid));
              return lr != null && Number.isFinite(Number(lr.current_value))
                ? Number(lr.current_value)
                : null;
            })()}
            submitValue={submitValue}
            onSubmitValueChange={setSubmitValue}
            submitDate={submitDate}
            onSubmitDateChange={setSubmitDate}
            busy={submitBusy}
            metersLoading={propertyId !== '' && meterLoading}
            canSubmit={canSubmit}
            onSubmit={(e) => void handleSubmitReading(e)}
            onCancel={() => void closeReadingsShell()}
            onGoToMeters={goToMetersForSubmitProperty}
          />
        ) : (
          <AdminInlineAlert tone="warning">{t('admin.waterNoAccess')}</AdminInlineAlert>
        )}
      </WorkplaceCardShell>

      <AdminModal
        open={rowSubmit != null}
        size="lg"
        title={t('admin.waterReadingsFormTitle')}
        titleMeta={
          rowSubmit
            ? formatPropertyIdentity(
                {
                  apartment_number: rowSubmit.apartmentNumber || null,
                  section_code: rowSubmit.sectionCode || null,
                  block_code: rowSubmit.blockCode || null,
                },
                t,
              )
            : null
        }
        closeLabel={t('common.close')}
        onClose={() => void closeRowSubmit()}
        onRequestClose={() => void closeRowSubmit()}
        returnFocusRef={readingsReturnFocusRef}
        entityKey={rowSubmit ? `row-submit-${rowSubmit.propertyId}-${rowSubmit.meterId ?? 'none'}` : 'row-submit'}
      >
        {canSubmit && rowSubmit ? (
          <div className="space-y-3">
            {error ? <AdminInlineAlert tone="danger">{error}</AdminInlineAlert> : null}
            {success ? <AdminInlineAlert tone="success">{success}</AdminInlineAlert> : null}
            <AdminWaterReadingSubmitForm
              mode="locked"
              properties={sorted}
              propertyId={propertyId}
              onPropertyChange={() => undefined}
              meters={
                meterLoading && rowSubmit.meterId
                  ? [{ id: rowSubmit.meterId, meter_number: rowSubmit.meterNumber || null }]
                  : propertyActiveMeters.map((m) => ({
                      id: m.id,
                      meter_number: m.meter_number,
                    }))
              }
              selectedMeterId={submitMeterId || rowSubmit.meterId || ''}
              onMeterChange={setSubmitMeterId}
              lastKnownValue={rowSubmit.currentValue}
              submitValue={submitValue}
              onSubmitValueChange={setSubmitValue}
              submitDate={submitDate}
              onSubmitDateChange={setSubmitDate}
              busy={submitBusy}
              metersLoading={meterLoading}
              canSubmit={canSubmit}
              onSubmit={(e) => void handleSubmitReading(e)}
              onCancel={() => void closeRowSubmit()}
              onGoToMeters={goToMetersForSubmitProperty}
            />
          </div>
        ) : (
          <AdminInlineAlert tone="warning">{t('admin.waterNoAccess')}</AdminInlineAlert>
        )}
      </AdminModal>

      <WorkplaceCardShell
        open={readingsDetailOpen}
        entityKey={detailReadingId ?? detailReadingMeterId ?? 'reading'}
        title={readingsDetailTitle}
        titleMeta={detailTitleMeta}
        closeLabel={t('admin.waterMetersDetailClose')}
        onClose={() => void closeReadingsShell()}
        onRequestClose={() => void closeReadingsShell()}
        returnFocusRef={readingsReturnFocusRef}
      >
        <div className="space-y-4">
          {meterLoading ? (
            <p className="text-sm text-muted">{t('common.loading')}</p>
          ) : !detailReadingRow ? (
            <AdminEmptyState title={t('admin.waterReadingsNoReading')} />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <div className="text-[11px] text-muted">{t('admin.meterNumber')}</div>
                <div className="mt-0.5 font-semibold">
                  {detailMeter?.meter_number?.trim() ? detailMeter.meter_number : '—'}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-muted">{t('admin.prev')}</div>
                <div className="mt-0.5 tabular-nums">
                  {detailReadingRow.previous_value == null
                    ? '—'
                    : formatM3(Number(detailReadingRow.previous_value), locale)}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-muted">{t('admin.lastReading')}</div>
                <div className="mt-0.5 tabular-nums">
                  {detailReadingRow.current_value == null
                    ? '—'
                    : formatM3(Number(detailReadingRow.current_value), locale)}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-muted">{t('admin.waterReadingsColDate')}</div>
                <div className="mt-0.5 tabular-nums">
                  {detailReadingRow.reading_date
                    ? formatOwnerDate(detailReadingRow.reading_date)
                    : '—'}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-muted">{t('admin.waterReadingsColWho')}</div>
                <div className="mt-0.5">
                  {detailReadingRow.submitted_by_email?.trim()
                    ? detailReadingRow.submitted_by_email
                    : '—'}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-muted">{t('admin.waterReadingsColStatus')}</div>
                <div className="mt-0.5">{readingStatusLabel(detailReadingStatus)}</div>
              </div>
            </div>
          )}

          {detailReadingCorrectable && !correctTarget ? (
            <AdminSecondaryButton
              type="button"
              onClick={() => openWaterCorrection(detailReadingRow!)}
            >
              {t('admin.meterCorrectionAction')}
            </AdminSecondaryButton>
          ) : null}

          {correctTarget &&
            canCorrectWaterReading(staffRole, staffActive, correctHasCharge) && (
              <AdminMeterCorrectionPanel
                originalSummary={
                  <p>
                    {t('admin.meterCorrectionOriginal', {
                      current: `${formatM3(Number(correctTarget.current_value), locale)} ${t('account.m3')}`,
                      consumption: `${formatM3(Number(correctTarget.consumption_m3), locale)} ${t('account.m3')}`,
                    })}
                  </p>
                }
                valueFields={
                  <label className="block text-secondary">
                    {t('admin.meterCorrectionNewValue')}
                    <input
                      className={`mt-1 block w-full ${fieldClass}`}
                      type="number"
                      min="0"
                      step="0.001"
                      value={correctValue}
                      onChange={(e) => setCorrectValue(e.target.value)}
                      disabled={correctBusy}
                      required
                    />
                  </label>
                }
                reason={correctReason}
                onReasonChange={setCorrectReason}
                confirmed={correctConfirm}
                onConfirmedChange={setCorrectConfirm}
                hasCharge={correctHasCharge}
                estimatedDeltaEur={correctDelta}
                busy={correctBusy}
                onSubmit={() => void handleCorrectReading()}
                onCancel={closeWaterCorrection}
              />
            )}
        </div>
      </WorkplaceCardShell>

      {activeTab === 'history' ? (
        canSee ? (
          <AdminWaterHistoryRegister
            supabase={supabase}
            properties={sorted}
            canOperate={canSee}
            refreshSignal={readingsRefreshSignal}
            focusPropertyId={historyShellPropertyId ?? ''}
            listScrollRef={historyListScrollRef}
            onOpenHistory={openHistoryDetail}
          />
        ) : (
          <AdminInlineAlert tone="warning">{t('admin.waterNoAccess')}</AdminInlineAlert>
        )
      ) : null}

      <WorkplaceCardShell
        open={historyDetailOpen}
        entityKey={historyShellPropertyId != null ? `history-${historyShellPropertyId}` : 'history'}
        title={historyDetailTitle}
        closeLabel={t('admin.waterMetersDetailClose')}
        onClose={() => void closeHistoryShell()}
        onRequestClose={() => void closeHistoryShell()}
        returnFocusRef={historyReturnFocusRef}
        subheader={
          <SectionPanelTabs
            aria-label={t('admin.waterHistoryTitle')}
            value={historyInnerTab}
            onChange={(id) => void switchHistoryInnerTab(id as 'readings' | 'finance')}
            items={[
              { id: 'readings', label: t('admin.waterHistoryTabReadings') },
              { id: 'finance', label: t('admin.waterHistoryTabFinance') },
            ]}
          />
        }
      >
        <div className="space-y-4">
          {historyInnerTab === 'readings' ? (
            meterLoading ? (
              <p className="text-sm text-muted">{t('common.loading')}</p>
            ) : error && historyShellPropertyId != null && propertyId === historyShellPropertyId ? (
              <AdminInlineAlert tone="danger">{error}</AdminInlineAlert>
            ) : (
              <>
                {correctTarget &&
                  canCorrectWaterReading(staffRole, staffActive, correctHasCharge) && (
                    <AdminMeterCorrectionPanel
                      originalSummary={
                        <p>
                          {t('admin.meterCorrectionOriginal', {
                            current: `${formatM3(Number(correctTarget.current_value), locale)} ${t('account.m3')}`,
                            consumption: `${formatM3(Number(correctTarget.consumption_m3), locale)} ${t('account.m3')}`,
                          })}
                        </p>
                      }
                      valueFields={
                        <label className="block text-secondary">
                          {t('admin.meterCorrectionNewValue')}
                          <input
                            className={`mt-1 block w-full ${fieldClass}`}
                            type="number"
                            min="0"
                            step="0.001"
                            value={correctValue}
                            onChange={(e) => setCorrectValue(e.target.value)}
                            disabled={correctBusy}
                            required
                          />
                        </label>
                      }
                      reason={correctReason}
                      onReasonChange={setCorrectReason}
                      confirmed={correctConfirm}
                      onConfirmedChange={setCorrectConfirm}
                      hasCharge={correctHasCharge}
                      estimatedDeltaEur={correctDelta}
                      busy={correctBusy}
                      onSubmit={() => void handleCorrectReading()}
                      onCancel={closeWaterCorrection}
                    />
                  )}
                <MeterReadingHistory
                  utility="water"
                  entries={historyEntries}
                  title={t('admin.waterHistoryTabReadings')}
                  emptyTitle={t('admin.noReadings')}
                  periodFrom={historyPeriodFrom}
                  periodTo={historyPeriodTo}
                  rowActions={(entry) => {
                    const row = readings.find((r) => String(r.id) === entry.actionKey);
                    if (!row) return null;
                    const isLatestCorrectable =
                      lastReading?.id === row.id && row.status === 'active';
                    const rowHasCharge = waterReadingHasCharge(row);
                    const showCorrect =
                      isLatestCorrectable &&
                      canCorrectWaterReading(staffRole, staffActive, rowHasCharge);
                    if (!showCorrect) return null;
                    return (
                      <button
                        type="button"
                        className="text-sm text-accent hover:underline"
                        onClick={() => openWaterCorrection(row)}
                      >
                        {t('admin.meterCorrectionAction')}
                      </button>
                    );
                  }}
                />
              </>
            )
          ) : historyShellPropertyId != null ? (
            <AdminWaterApartmentFinanceHistory
              key={historyShellPropertyId}
              supabase={supabase}
              propertyId={historyShellPropertyId}
            />
          ) : null}
        </div>
      </WorkplaceCardShell>

    </div>
  );
}
