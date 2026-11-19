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
import { parseRatesJson } from '@/lib/tariffs';
import {
  AdminPageHeader,
  AdminCard,
  AdminMetricCard,
  AdminTabBar,
  AdminEmptyState,
  adminCardClass,
  adminFieldClass,
  AdminInlineAlert,
  parseAdminUtilityTab,
  type AdminUtilityTab,
} from '@/components/admin/AdminUi';
import { ApartmentCombobox } from '@/components/admin/ApartmentCombobox';
import { AdminMeterCorrectionPanel } from '@/components/admin/AdminMeterCorrectionPanel';
import { AdminUtilityFinanceWorkplace } from '@/components/admin/AdminUtilityFinanceWorkplace';
import type { UtilityModuleTotals } from '@/lib/utilityFinanceRegister';
import { MeterReadingHistory } from '@/components/meters/MeterReadingHistory';
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
  const canSee = canSeeWaterAdmin(staffRole);
  const canMeter = canAssignWaterMeter(staffRole);
  const canFinance = canManageWaterFinance(staffRole);
  const canSubmit = canSubmitWaterStaff(staffRole, staffActive);
  const waterTabs = useMemo(() => {
    const items: { id: AdminUtilityTab; label: string }[] = [
      { id: 'overview', label: t('admin.utilTabOverview') },
      { id: 'meter', label: t('admin.utilTabMeter') },
      { id: 'readings', label: t('admin.utilTabReadings') },
    ];
    // finance stays URL-routable from Финансы nav; not shown in metering chrome.
    if (canFinance) items.push({ id: 'finance', label: t('admin.utilTabFinance') });
    return items;
  }, [t, canFinance]);
  const allowedWaterTabs = useMemo(() => waterTabs.map((item) => item.id), [waterTabs]);

  const sorted = useMemo(
    () =>
      [...properties].sort((a, b) =>
        aptNumber(a.apartment_number).localeCompare(aptNumber(b.apartment_number), undefined, { numeric: true }),
      ),
    [properties],
  );

  const [propertyId, setPropertyId] = useState<number | ''>(
    focusPropertyId != null && focusPropertyId !== '' ? focusPropertyId : sorted[0]?.id ?? '',
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
  const activeTab = onTabChange
    ? parseAdminUtilityTab(tab, allowedWaterTabs)
    : parseAdminUtilityTab(localTab, allowedWaterTabs);

  const moduleBalanceTone = moduleTotals ? balanceTone(moduleTotals.balanceEur) : 'settled';
  const moduleBalanceStatus =
    moduleBalanceTone === 'debt'
      ? t('admin.balDebt')
      : moduleBalanceTone === 'over'
        ? t('admin.balOver')
        : t('admin.balSettled');
  const moduleBalanceCard = {
    value:
      canFinance && moduleTotals
        ? formatEur(Math.abs(moduleTotals.balanceEur), locale)
        : canFinance
          ? t('common.loading')
          : '—',
    secondary: canFinance
      ? moduleTotals
        ? `${moduleBalanceStatus} · ${t('admin.utilRegBalanceComplex')}`
        : t('admin.utilRegBalanceComplexLoading')
      : t('admin.waterNoAccess'),
    alert: Boolean(canFinance && moduleTotals && moduleBalanceTone === 'debt'),
  };

  const payKeyRef = useRef(crypto.randomUUID());
  const submitKeyRef = useRef(crypto.randomUUID());
  const correctKeyRef = useRef(crypto.randomUUID());

  useEffect(() => {
    // Finance register allows an empty selection; do not force apt #1 back into the URL.
    if (activeTab === 'finance') return;
    if (propertyId === '' && sorted[0]) selectProperty(sorted[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seed once when list arrives
  }, [propertyId, sorted, activeTab]);

  useEffect(() => {
    if (!staffRole) return;
    if (!onTabChange) {
      if (!allowedWaterTabs.includes(localTab)) setLocalTab('overview');
      return;
    }
    if (tab && !allowedWaterTabs.includes(tab as AdminUtilityTab)) onTabChange('overview');
  }, [onTabChange, tab, allowedWaterTabs, localTab, staffRole]);

  function selectTab(next: AdminUtilityTab) {
    if (onTabChange) onTabChange(next);
    else setLocalTab(next);
  }

  const activeMeter = meters.find((m) => !m.retired_at) ?? null;
  const lastReading = lastActiveReading(
    activeMeter ? readings.filter((r) => r.meter_id === activeMeter.id) : readings,
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
    const readingQ = supabase
      .from('water_readings')
      .select('*')
      .eq('property_id', pid)
      .order('reading_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(200);
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
    if (propertyId === '' || !canSubmit) return;
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
    const { error: rpcErr } = await supabase.rpc('submit_water_reading', {
      p_property_id: Number(propertyId),
      p_current_value: normalizeWaterVolume(parsed),
      p_reading_date: submitDate,
      p_idempotency_key: submitKeyRef.current,
    });
    setSubmitBusy(false);
    if (rpcErr) {
      rpcFail(rpcErr.message);
      return;
    }
    submitKeyRef.current = crypto.randomUUID();
    setSubmitValue('');
    flash(t('account.utilSubmitOk'));
    void import('@/lib/email/eventProducers')
      .then(({ notifyPropertyOwnersEvent }) =>
        notifyPropertyOwnersEvent(supabase, {
          eventKey: 'meters_reading_accepted',
          propertyId: Number(propertyId),
          entityId: `water_read:${propertyId}:${submitDate}`,
          payload: { utility: 'water', reading_date: submitDate },
        })
      )
      .catch(() => undefined);
    await loadPropertyWater();
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
  }

  if (!canSee) {
    return (
      <AdminCard>
        <p className="text-sm text-secondary">{t('admin.waterNoAccess')}</p>
      </AdminCard>
    );
  }

  if (activeTab === 'finance') {
    if (!canFinance) {
      return (
        <AdminCard>
          <p className="text-sm text-secondary">{t('admin.waterNoAccess')}</p>
        </AdminCard>
      );
    }
    const financeModeLabel =
      waterMode === 'staff_only' ? t('admin.elModeStaffOnly') : t('admin.elModeOwnerAndStaff');
    return (
      <div className="space-y-4">
        <AdminPageHeader title={t('admin.water')} secondary={t('admin.utilFinRegisterLead')} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <AdminMetricCard label={t('admin.waterMode')} value={financeModeLabel} />
          <AdminMetricCard
            label={t('admin.currentTariff')}
            value={tariff ? `${formatEur(Number(tariff.price_eur_per_m3), locale)} / м³` : '—'}
            secondary={tariff ? t('admin.tariffManageInCore') : t('admin.noTariff')}
          />
          <AdminMetricCard
            label={t('admin.waterBalance')}
            value={moduleBalanceCard.value}
            secondary={moduleBalanceCard.secondary}
            alert={moduleBalanceCard.alert}
          />
        </div>
        {canChangeWaterMode ? (
          <AdminCard>
            <p className="text-[11px] uppercase tracking-wider text-muted">{t('admin.waterMode')}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {([
                ['owner_and_staff', t('admin.elModeOwnerAndStaff')],
                ['staff_only', t('admin.elModeStaffOnly')],
              ] as const).map(([id, label]) => (
                <button
                  key={`fin-mode-${id}`}
                  type="button"
                  onClick={() => onSaveWaterMode?.(id)}
                  className={`rounded-full border px-3 py-1.5 text-sm ${
                    waterMode === id
                      ? 'border-accent/25 bg-accent-bg text-accent'
                      : 'border-border text-secondary hover:bg-hover'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </AdminCard>
        ) : null}
        <AdminUtilityFinanceWorkplace
          service="water"
          supabase={supabase}
          properties={sorted}
          canOperate={canFinance}
          focusPropertyId={focusPropertyId}
          onPropertyChange={selectProperty}
          onModuleTotals={setModuleTotals}
        />
      </div>
    );
  }

  const tone = balanceTone(balance.balance_eur);
  const statusLabel =
    tone === 'debt' ? t('admin.balDebt') : tone === 'over' ? t('admin.balOver') : t('admin.balSettled');
  const waterModeLabel =
    waterMode === 'staff_only' ? t('admin.elModeStaffOnly') : t('admin.elModeOwnerAndStaff');
  const retiredMeters = meters.filter((m) => m.retired_at);
  const meteringTabs = waterTabs.filter((item) => item.id !== 'finance');

  return (
    <div className="space-y-4">
      <AdminPageHeader title={t('admin.water')} secondary={t('admin.waterLead')} />
      <AdminCard>
        <p className="text-[11px] uppercase tracking-wider text-muted">{t('admin.waterMode')}</p>
        <p className="mt-1 text-sm font-medium text-foreground">{waterModeLabel}</p>
        {canChangeWaterMode && (
          <div className="mt-2 flex flex-wrap gap-2">
            {([
              ['owner_and_staff', t('admin.elModeOwnerAndStaff')],
              ['staff_only', t('admin.elModeStaffOnly')],
            ] as const).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => onSaveWaterMode?.(id)}
                className={`rounded-full border px-3 py-1.5 text-sm ${
                  waterMode === id
                    ? 'border-accent/25 bg-accent-bg text-accent'
                    : 'border-border text-secondary hover:bg-hover'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        <label className="mt-4 block text-xs text-muted">{t('admin.pickProperty')}</label>
        <ApartmentCombobox
          className="mt-1 max-w-xl"
          properties={sorted}
          value={propertyId}
          onChange={(id) => {
            selectProperty(id);
            setSuccess(null);
            setError(null);
            closeWaterCorrection();
          }}
        />
      </AdminCard>

      {error ? <AdminInlineAlert tone="danger">{error}</AdminInlineAlert> : null}
      {success ? <AdminInlineAlert tone="success">{success}</AdminInlineAlert> : null}

      <AdminTabBar tabs={meteringTabs} active={activeTab} onChange={(id) => selectTab(id as AdminUtilityTab)} />

      {activeTab === 'overview' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <AdminMetricCard
              label={t('admin.waterMode')}
              value={waterModeLabel}
              secondary={
                canChangeWaterMode ? t('admin.utilRegModeHint') : undefined
              }
            />
            <AdminMetricCard
              label={t('admin.currentTariff')}
              value={tariff ? `${formatEur(Number(tariff.price_eur_per_m3), locale)} / м³` : '—'}
              secondary={tariff ? t('admin.tariffManageInCore') : t('admin.noTariff')}
            />
            <AdminMetricCard
              label={t('admin.waterBalance')}
              value={moduleBalanceCard.value}
              secondary={moduleBalanceCard.secondary}
              alert={moduleBalanceCard.alert}
            />
          </div>
          {canFinance ? (
            <AdminUtilityFinanceWorkplace
              service="water"
              supabase={supabase}
              properties={sorted}
              canOperate={canFinance}
              focusPropertyId={focusPropertyId}
              onPropertyChange={selectProperty}
              onModuleTotals={setModuleTotals}
            />
          ) : null}
        </div>
      )}

      {activeTab === 'meter' && (
      <div className={adminCardClass + ' p-4 md:p-5'}>
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">{t('admin.waterStatus')}</p>
        {needsInitialOpening ? (
          <AdminInlineAlert tone="warning">
            {t('admin.openingStatus_needs_initial_readings')}
          </AdminInlineAlert>
        ) : null}
        {meterLoading ? (
          <p className="mt-3 text-sm text-muted">{t('common.loading')}</p>
        ) : !activeMeter ? (
          <div className="mt-3">
            <AdminEmptyState
              title={
                needsInitialOpening
                  ? t('admin.openingStatus_needs_initial_readings')
                  : t('admin.noWaterMeter')
              }
            />
          </div>
        ) : (
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <div className="text-[11px] text-muted">{t('admin.meterNumber')}</div>
              <div className="mt-0.5 font-semibold tabular-nums">{activeMeter.meter_number}</div>
            </div>
            <div>
              <div className="text-[11px] text-muted">{t('admin.installedAt')}</div>
              <div className="mt-0.5 tabular-nums">{formatOwnerDate(activeMeter.installed_at)}</div>
            </div>
            <div>
              <div className="text-[11px] text-muted">{t('admin.initialReading')}</div>
              <div className="mt-0.5 tabular-nums">{formatM3(Number(activeMeter.initial_reading), locale)}</div>
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
                  : formatM3(Number(activeMeter.initial_reading), locale)}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-muted">{t('admin.lastReadingDate')}</div>
              <div className="mt-0.5 tabular-nums">{formatOwnerDate(lastReading?.reading_date)}</div>
            </div>
            <div>
              <div className="text-[11px] text-muted">{t('admin.currentTariff')}</div>
              <div className="mt-0.5 tabular-nums">
                {tariff ? `${formatEur(Number(tariff.price_eur_per_m3), locale)} / m³` : t('admin.noTariff')}
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
            <input className={fieldClass} type="number" min="0" step="0.1" placeholder={t('admin.initialReading')} value={initialReading} onChange={(e) => setInitialReading(e.target.value)} required />
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
            <input className={fieldClass} type="number" min="0" step="0.1" placeholder={t('admin.initialReading')} value={replaceInitial} onChange={(e) => setReplaceInitial(e.target.value)} required />
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

        <p className="mt-5 text-[11px] font-medium uppercase tracking-[0.18em] text-muted">{t('admin.utilMeterHistory')}</p>
        {retiredMeters.length === 0 ? (
          <div className="mt-3">
            <AdminEmptyState title={t('admin.utilNoMeterHistory')} />
          </div>
        ) : (
          <div className="mt-3 overflow-x-auto">
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
                    <td className="py-2 pr-3 tabular-nums">{row.meter_number}</td>
                    <td className="py-2 pr-3 tabular-nums">{formatOwnerDate(row.installed_at)}</td>
                    <td className="py-2 pr-3 tabular-nums">{formatM3(Number(row.initial_reading), locale)}</td>
                    <td className="py-2 pr-3 tabular-nums">{formatOwnerDate(row.retired_at)}</td>
                    <td className="py-2 pr-3 text-secondary">{row.replacement_reason ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      )}

      {activeTab === 'readings' && canSubmit && (
        <div className={adminCardClass + ' p-4 md:p-5'}>
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">{t('account.utilSubmitTitle')}</p>
          <form onSubmit={handleSubmitReading} className="mt-4 grid gap-3 sm:grid-cols-3">
            <label className="block text-sm text-secondary sm:col-span-3">
              {t('admin.pickProperty')}
              <ApartmentCombobox
                className="mt-1"
                properties={sorted}
                value={propertyId}
                onChange={(id) => {
                  selectProperty(id);
                  setSuccess(null);
                  setError(null);
                }}
              />
            </label>
            <input
              className={fieldClass}
              type="number"
              min="0"
              step="0.1"
              placeholder={t('account.utilCurrentM3')}
              value={submitValue}
              onChange={(e) => setSubmitValue(e.target.value)}
              required
            />
            <input
              className={fieldClass}
              type="date"
              max={todayIsoDate()}
              value={submitDate}
              onChange={(e) => setSubmitDate(e.target.value)}
              required
            />
            <button
              type="submit"
              disabled={submitBusy || !activeMeter}
              className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
            >
              {submitBusy ? t('account.utilSubmitting') : t('account.utilSubmit')}
            </button>
          </form>
        </div>
      )}

      {activeTab === 'readings' && (
      <div className={adminCardClass + ' space-y-4 p-4 md:p-5'}>
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
          title={t('admin.readingHistory')}
          emptyTitle={t('admin.noReadings')}
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
      </div>
      )}

    </div>
  );
}
