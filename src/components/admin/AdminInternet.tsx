'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { useI18n } from '@/i18n/I18nProvider';
import { labelLedgerKind } from '@/i18n/labels';
import { formatOwnerDate } from '@/lib/ownerFormat';
import { isMissingRelation } from '@/lib/polls';
import {
  INTERNET_BILLING_METHODS,
  canConfirmInternetPeriod,
  canSeeInternetAdmin,
  internetBillingMethodLabelKey,
  internetStatusMessageKey,
  type InternetBillingMethod,
  type InternetLedger,
  type InternetPeriodQuote,
  type InternetSubscription,
  type InternetWorkOrderRow,
} from '@/lib/internet';
import {
  balanceTone,
  emptyBalance,
  formatEur,
  type UtilityBalance,
} from '@/lib/utilities';
import { toUserFacingMessage } from '@/lib/userFacingError';
import { useAppConfirm } from '@/components/ui/AppConfirmDialog';
import {
  AdminPageHeader,
  AdminMetricCard,
  AdminTableShell,
  AdminEmptyState,
  AdminInlineAlert,
  AdminPrimaryButton,
  adminCardClass,
  adminFieldClass,
  adminTableCellClass,
  adminTableHeadRowClass,
  adminTableRowClass,
} from '@/components/admin/AdminUi';
import { ApartmentCombobox } from '@/components/admin/ApartmentCombobox';
import { PropertyIdentityLink } from '@/components/admin/PropertyIdentityLink';
import { AdminUtilityFinanceWorkplace } from '@/components/admin/AdminUtilityFinanceWorkplace';
import { StatusBadge } from '@/components/account/ownerUi';
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

function woStatusTone(status: string): 'warning' | 'info' | 'success' | 'danger' | 'neutral' {
  if (status === 'open') return 'warning';
  if (status === 'in_progress') return 'info';
  if (status === 'completed') return 'success';
  if (status === 'cancelled') return 'danger';
  return 'neutral';
}

const fieldClass = adminFieldClass;
const cardClass = `${adminCardClass} p-4 md:p-5`;

function firstRow<T>(data: T[] | T | null | undefined): T | null {
  if (!data) return null;
  return Array.isArray(data) ? (data[0] ?? null) : data;
}

export function AdminInternet({
  supabase,
  properties,
  staffRole,
  panel = 'all',
}: {
  supabase: SupabaseClient<Database>;
  properties: PropertyOption[];
  staffRole: string;
  /** finance = apartment register/card; operations = connections & moves; all = legacy single page */
  panel?: 'finance' | 'operations' | 'all';
}) {
  const { t, locale } = useI18n();
  const { confirm, dialog } = useAppConfirm(t('common.close'));
  const canSee = canSeeInternetAdmin(staffRole);

  const sorted = useMemo(
    () =>
      [...properties].sort((a, b) =>
        aptNumber(a.apartment_number).localeCompare(aptNumber(b.apartment_number), undefined, { numeric: true }),
      ),
    [properties],
  );

  const [propertyId, setPropertyId] = useState<number | ''>('');
  const [ledger, setLedger] = useState<InternetLedger[]>([]);
  const [balance, setBalance] = useState<UtilityBalance>(emptyBalance());
  const [subscription, setSubscription] = useState<InternetSubscription | null>(null);
  const [propLoading, setPropLoading] = useState(false);
  const [fundLoading, setFundLoading] = useState(false);
  const [activeCount, setActiveCount] = useState<number | null>(null);
  const [inactiveCount, setInactiveCount] = useState<number | null>(null);
  const [pendingEnable, setPendingEnable] = useState<number | null>(null);
  const [pendingDisable, setPendingDisable] = useState<number | null>(null);
  const [fundCharged, setFundCharged] = useState<number | null>(null);
  const [fundPaid, setFundPaid] = useState<number | null>(null);
  const [fundBalance, setFundBalance] = useState<number | null>(null);
  const [internetTariffLabel, setInternetTariffLabel] = useState<string | null>(null);
  const [moves, setMoves] = useState<InternetWorkOrderRow[]>([]);
  const [movesLoading, setMovesLoading] = useState(false);
  const [payBusy, setPayBusy] = useState(false);
  const [debtBusy, setDebtBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payReceiptFields, setPayReceiptFields] = useState<PaymentReceiptPayFieldValues>(emptyReceiptPayFields);
  const [lastPayReceipt, setLastPayReceipt] = useState<PaymentReceiptRow | null>(null);
  const [lastPayAmountLabel, setLastPayAmountLabel] = useState<string | null>(null);
  const [payNote, setPayNote] = useState('');
  const payKeyRef = useRef(crypto.randomUUID());
  const canConfirmPeriod = canConfirmInternetPeriod(staffRole, true);
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [periodMethod, setPeriodMethod] = useState<InternetBillingMethod>('package_plus_days');
  const [periodQuote, setPeriodQuote] = useState<InternetPeriodQuote | null>(null);
  const [periodQuoteBusy, setPeriodQuoteBusy] = useState(false);
  const [periodConfirmBusy, setPeriodConfirmBusy] = useState(false);
  const periodKeyRef = useRef(crypto.randomUUID());
  const [openingPending, setOpeningPending] = useState(false);
  const [openingState, setOpeningState] = useState<'active' | 'inactive'>('inactive');
  const [openingConnDate, setOpeningConnDate] = useState('');
  const [openingConfirmBusy, setOpeningConfirmBusy] = useState(false);

  const loadFund = useCallback(async () => {
    if (!canSee) return;
    setFundLoading(true);
    setMovesLoading(true);
    const [totalsRes, movesRes, tariffRes] = await Promise.all([
      supabase.rpc('get_internet_fund_totals'),
      supabase.rpc('list_internet_work_orders'),
      supabase.rpc('get_applicable_internet_tariff' as never),
    ]);
    setFundLoading(false);
    setMovesLoading(false);
    if (totalsRes.error) {
      if (!/could not find the function/i.test(totalsRes.error.message ?? '')) {
        setError(toUserFacingMessage(totalsRes.error, t, { context: 'load', fallback: t('common.errLoad') }));
      }
    } else {
      const row = firstRow(totalsRes.data);
      setActiveCount(row?.active_count != null ? Number(row.active_count) : 0);
      setInactiveCount(row?.inactive_count != null ? Number(row.inactive_count) : 0);
      setPendingEnable(row?.pending_enable_count != null ? Number(row.pending_enable_count) : 0);
      setPendingDisable(row?.pending_disable_count != null ? Number(row.pending_disable_count) : 0);
      setFundCharged(row?.charged_eur != null ? Number(row.charged_eur) : 0);
      setFundPaid(row?.paid_eur != null ? Number(row.paid_eur) : 0);
      setFundBalance(row?.balance_eur != null ? Number(row.balance_eur) : 0);
    }
    if (movesRes.error) {
      if (!/could not find the function/i.test(movesRes.error.message ?? '')) {
        setError(toUserFacingMessage(movesRes.error, t, { context: 'load', fallback: t('common.errLoad') }));
      }
      setMoves([]);
    } else {
      setMoves((movesRes.data as InternetWorkOrderRow[] | null) ?? []);
    }
    if (!tariffRes.error) {
      const tariffRow = firstRow(tariffRes.data as Record<string, unknown>[] | null);
      const ratesRaw = tariffRow?.rates;
      const rates =
        ratesRaw && typeof ratesRaw === 'object' && !Array.isArray(ratesRaw)
          ? (ratesRaw as Record<string, unknown>)
          : null;
      const price = rates?.package_30 ?? rates?.month ?? null;
      setInternetTariffLabel(
        price != null && Number.isFinite(Number(price)) ? formatEur(Number(price), locale) : null,
      );
    } else {
      setInternetTariffLabel(null);
    }
  }, [canSee, locale, supabase, t]);

  const loadProperty = useCallback(async () => {
    if (!canSee || propertyId === '') {
      setLedger([]);
      setBalance(emptyBalance());
      setSubscription(null);
      setOpeningPending(false);
      return;
    }
    setPropLoading(true);
    const pid = Number(propertyId);
    const [ledgerRes, balanceRes, subRes, pendingRes] = await Promise.all([
      supabase
        .from('internet_ledger')
        .select('*')
        .eq('property_id', pid)
        .order('created_at', { ascending: false })
        .limit(40),
      supabase.rpc('get_internet_balance', { p_property_id: pid }),
      supabase.from('internet_subscriptions').select('*').eq('property_id', pid).maybeSingle(),
      supabase
        .from('utility_opening_pending' as never)
        .select('id')
        .eq('property_id', pid)
        .eq('utility', 'internet')
        .eq('status', 'needs_initial')
        .limit(1),
    ]);
    setPropLoading(false);
    setOpeningPending(Array.isArray(pendingRes.data) && pendingRes.data.length > 0);
    if (ledgerRes.error && !isMissingRelation(ledgerRes.error, 'internet_ledger')) {
      setError(toUserFacingMessage(ledgerRes.error, t, { context: 'load', fallback: t('common.errLoad') }));
      setLedger([]);
    } else {
      setLedger((ledgerRes.data ?? []) as InternetLedger[]);
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
    if (subRes.error && !isMissingRelation(subRes.error, 'internet_subscriptions')) {
      setError(toUserFacingMessage(subRes.error, t, { context: 'load', fallback: t('common.errLoad') }));
      setSubscription(null);
    } else {
      setSubscription((subRes.data as InternetSubscription | null) ?? null);
    }
  }, [canSee, propertyId, supabase, t]);

  useEffect(() => {
    void loadFund();
  }, [loadFund]);

  useEffect(() => {
    void loadProperty();
  }, [loadProperty]);

  function goFillUk() {
    window.location.assign('/admin?section=%D0%BD%D0%B0%D1%81%D1%82%D1%80%D0%BE%D0%B9%D0%BA%D0%B8');
  }

  async function handlePay(e: React.FormEvent) {
    e.preventDefault();
    if (!canSee || propertyId === '' || payBusy) return;
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
    const { data: payData, error: rpcErr } = await supabase.rpc('record_internet_payment', {
      p_property_id: Number(propertyId),
      p_amount_eur: amount,
      p_note: payNote.trim() || null,
      p_idempotency_key: idem,
    });
    if (rpcErr) {
      setPayBusy(false);
      setSuccess(null);
      setError(toUserFacingMessage(rpcErr, t, { context: 'finance', fallback: t('common.errFinance') }));
      return;
    }
    const ledgerId = ledgerIdFromPaymentRpc(payData);
    const amountLabel = formatEur(amount, locale);
    setLastPayAmountLabel(amountLabel);
    const finished = await finishReceiptForPayment(supabase, 'internet', ledgerId);
    setLastPayReceipt(finished.receipt);
    payKeyRef.current = crypto.randomUUID();
    setPayAmount('');
    setPayNote('');
    setPayReceiptFields(emptyReceiptPayFields());
    setPayBusy(false);
    setError(null);
    setSuccess(
      finished.pdfError && finished.receipt
        ? t('receipt.paySavedPdfFailed')
        : t('receipt.payRegistered', { amount: amountLabel }),
    );
    await Promise.all([loadProperty(), loadFund()]);
  }

  async function handleConfirmInternetOpening(e: React.FormEvent) {
    e.preventDefault();
    if (!canSee || propertyId === '' || openingConfirmBusy) return;
    setOpeningConfirmBusy(true);
    setError(null);
    setSuccess(null);
    // Debt/credit come from deferred opening payload when null — never invent 0/0.
    const { error: rpcErr } = await supabase.rpc('admin_confirm_internet_opening' as never, {
      p_property_id: Number(propertyId),
      p_connection_state: openingState,
      p_connection_date: openingConnDate.trim() || null,
      p_transition_date: null,
      p_paid_through: null,
      p_opening_debt: null,
      p_opening_credit: null,
      p_source_reference: null,
      p_notes: null,
    } as never);
    setOpeningConfirmBusy(false);
    if (rpcErr) {
      setError(toUserFacingMessage(rpcErr, t, { fallback: t('admin.errGeneric') }));
      return;
    }
    setSuccess(t('common.saved'));
    setOpeningPending(false);
    await Promise.all([loadProperty(), loadFund()]);
  }

  async function handleDebtDisconnect() {
    if (!canSee || propertyId === '') return;
    const ok = await confirm({
      title: t('common.confirmAction'),
      description: t('admin.internetDebtDisconnectConfirm'),
      confirmLabel: t('common.yes'),
      cancelLabel: t('common.cancel'),
      tone: 'danger',
    });
    if (!ok) return;
    setDebtBusy(true);
    const { error: rpcErr } = await supabase.rpc('admin_internet_disconnect_debt', {
      p_property_id: Number(propertyId),
    });
    setDebtBusy(false);
    if (rpcErr) {
      setSuccess(null);
      setError(toUserFacingMessage(rpcErr, t, { context: 'finance', fallback: t('common.errFinance') }));
      return;
    }
    setError(null);
    setSuccess(t('admin.okInternetDebtOff'));
    await Promise.all([loadProperty(), loadFund()]);
  }

  async function handlePeriodQuote() {
    if (!canSee || propertyId === '' || !periodStart || !periodEnd || periodQuoteBusy) return;
    setPeriodQuoteBusy(true);
    setError(null);
    setPeriodQuote(null);
    const { data, error: rpcErr } = await supabase.rpc('compute_internet_period_quote', {
      p_period_start: periodStart,
      p_period_end: periodEnd,
      p_billing_method: periodMethod,
      p_on_date: periodStart,
    });
    setPeriodQuoteBusy(false);
    if (rpcErr) {
      setSuccess(null);
      setError(toUserFacingMessage(rpcErr, t, { fallback: t('admin.errGeneric') }));
      return;
    }
    const row = firstRow(data as InternetPeriodQuote[] | InternetPeriodQuote | null);
    setPeriodQuote(row);
  }

  async function handlePeriodConfirm(e: React.FormEvent) {
    e.preventDefault();
    if (!canConfirmPeriod || propertyId === '' || !periodStart || !periodEnd || periodConfirmBusy) return;
    setPeriodConfirmBusy(true);
    setError(null);
    setSuccess(null);
    const key = periodKeyRef.current;
    const { error: rpcErr } = await supabase.rpc('confirm_internet_paid_period', {
      p_property_id: Number(propertyId),
      p_period_start: periodStart,
      p_period_end: periodEnd,
      p_billing_method: periodMethod,
      p_idempotency_key: key,
    });
    setPeriodConfirmBusy(false);
    if (rpcErr) {
      setError(toUserFacingMessage(rpcErr, t, { context: 'finance', fallback: t('common.errFinance') }));
      return;
    }
    periodKeyRef.current = crypto.randomUUID();
    setPeriodQuote(null);
    setSuccess(t('admin.internetPeriodConfirmOk'));
    await Promise.all([loadProperty(), loadFund()]);
  }

  if (!canSee) {
    return (
      <div className={cardClass}>
        <p className="text-sm text-secondary">{t('admin.capitalNoAccess')}</p>
      </div>
    );
  }

  if (panel === 'finance') {
    const fundToneFinance = balanceTone(fundBalance ?? 0);
    const fundStatusFinance =
      fundToneFinance === 'debt'
        ? t('admin.balDebt')
        : fundToneFinance === 'over'
          ? t('admin.balOver')
          : t('admin.balSettled');
    return (
      <div className="space-y-4">
        {dialog}
        <AdminPageHeader title={t('admin.internet')} secondary={t('admin.internetLead')} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <AdminMetricCard
            label={t('admin.utilRegInternetTariff')}
            value={
              fundLoading
                ? t('common.loading')
                : internetTariffLabel ?? '—'
            }
            secondary={internetTariffLabel ? t('admin.tariffManageInCore') : t('admin.noTariff')}
          />
          <AdminMetricCard
            label={t('admin.utilRegInternetConnected')}
            value={
              fundLoading || activeCount == null ? t('common.loading') : String(activeCount)
            }
          />
          <AdminMetricCard
            label={t('admin.utilRegInternetBalance')}
            value={
              fundLoading || fundBalance == null
                ? t('common.loading')
                : formatEur(Math.abs(fundBalance), locale)
            }
            secondary={fundStatusFinance}
            alert={fundToneFinance === 'debt'}
          />
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <AdminMetricCard
            label={t('admin.internetActive')}
            value={fundLoading || activeCount == null ? t('common.loading') : String(activeCount)}
          />
          <AdminMetricCard
            label={t('admin.internetInactive')}
            value={
              fundLoading || inactiveCount == null ? t('common.loading') : String(inactiveCount)
            }
          />
          <AdminMetricCard
            label={t('admin.internetPendingEnable')}
            value={
              fundLoading || pendingEnable == null ? t('common.loading') : String(pendingEnable)
            }
          />
          <AdminMetricCard
            label={t('admin.internetPendingDisable')}
            value={
              fundLoading || pendingDisable == null ? t('common.loading') : String(pendingDisable)
            }
          />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="text-sm font-medium text-accent hover:underline"
            onClick={() => {
              const params = new URLSearchParams(window.location.search);
              params.set('section', 'интернет');
              params.set('tab', 'operations');
              window.location.assign(`/admin?${params.toString()}`);
            }}
          >
            {t('admin.internetMovesTitle')} →
          </button>
          <p className="text-sm text-secondary">{t('admin.utilFinInternetOpsHint')}</p>
        </div>
        <AdminUtilityFinanceWorkplace
          service="internet"
          supabase={supabase}
          properties={sorted}
          canOperate={canSee}
          focusPropertyId={propertyId}
          onPropertyChange={(id) => setPropertyId(id)}
        />
      </div>
    );
  }

  const aptTone = balanceTone(balance.balance_eur);
  const aptStatus =
    aptTone === 'debt' ? t('admin.balDebt') : aptTone === 'over' ? t('admin.balOver') : t('admin.balSettled');
  const fundTone = balanceTone(fundBalance ?? 0);

  return (
    <div className="space-y-4">
      {dialog}
      <AdminPageHeader
        title={t('admin.internet')}
        secondary={
          panel === 'operations' ? t('admin.utilFinInternetOpsLead') : t('admin.internetLead')
        }
      />

      {error ? <AdminInlineAlert tone="danger">{error}</AdminInlineAlert> : null}
      {success ? <AdminInlineAlert tone="success">{success}</AdminInlineAlert> : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <AdminMetricCard
          label={t('admin.internetActive')}
          value={fundLoading || activeCount == null ? t('common.loading') : String(activeCount)}
        />
        <AdminMetricCard
          label={t('admin.internetInactive')}
          value={fundLoading || inactiveCount == null ? t('common.loading') : String(inactiveCount)}
        />
        <AdminMetricCard
          label={t('admin.internetPendingEnable')}
          value={fundLoading || pendingEnable == null ? t('common.loading') : String(pendingEnable)}
        />
        <AdminMetricCard
          label={t('admin.internetPendingDisable')}
          value={fundLoading || pendingDisable == null ? t('common.loading') : String(pendingDisable)}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <AdminMetricCard
          label={t('admin.charged')}
          value={fundLoading || fundCharged == null ? t('common.loading') : formatEur(fundCharged, locale)}
        />
        <AdminMetricCard
          label={t('admin.paid')}
          value={fundLoading || fundPaid == null ? t('common.loading') : formatEur(fundPaid, locale)}
        />
        <AdminMetricCard
          label={t('admin.balDebt')}
          value={
            fundLoading || fundBalance == null ? t('common.loading') : formatEur(Math.abs(fundBalance), locale)
          }
          secondary={
            fundTone === 'debt' ? t('admin.balDebt') : fundTone === 'over' ? t('admin.balOver') : t('admin.balSettled')
          }
          alert={fundTone === 'debt'}
        />
      </div>

      <div className={cardClass}>
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
          {t('admin.internetMovesTitle')}
        </p>
        {movesLoading ? (
          <p className="mt-3 text-sm text-muted">{t('common.loading')}</p>
        ) : moves.length === 0 ? (
          <div className="mt-3">
            <AdminEmptyState title={t('admin.internetMovesEmpty')} />
          </div>
        ) : (
          <div className="mt-3">
            <AdminTableShell>
              <table className="w-full min-w-[36rem] text-sm">
                <thead>
                  <tr className={adminTableHeadRowClass}>
                    <th className={adminTableCellClass}>{t('admin.date')}</th>
                    <th className={adminTableCellClass}>{t('admin.pickProperty')}</th>
                    <th className={adminTableCellClass}>{t('admin.kind')}</th>
                    <th className={adminTableCellClass}>{t('admin.status')}</th>
                    <th className={adminTableCellClass}>{t('admin.woAssignee')}</th>
                    <th className={adminTableCellClass}>{t('admin.note')}</th>
                  </tr>
                </thead>
                <tbody>
                  {moves.map((row) => (
                    <tr key={row.id} className={adminTableRowClass}>
                      <td className={`${adminTableCellClass} tabular-nums`}>
                        {formatOwnerDate(row.created_at, locale)}
                      </td>
                      <td className={adminTableCellClass}>
                        {(() => {
                          const prop =
                            (row.property_id
                              ? properties.find((p) => p.id === row.property_id)
                              : null) ??
                            (row.apartment_number
                              ? {
                                  id: row.property_id ?? 0,
                                  apartment_number: row.apartment_number,
                                }
                              : null);
                          if (prop && prop.id) {
                            return <PropertyIdentityLink property={prop} module="internet" compact />;
                          }
                          return row.apartment_number ? `№${row.apartment_number}` : '—';
                        })()}
                      </td>
                      <td className={adminTableCellClass}>
                        {row.internet_action === 'enable'
                          ? t('admin.internetActionEnable')
                          : row.internet_action === 'disable'
                            ? t('admin.internetActionDisable')
                            : row.title}
                      </td>
                      <td className={adminTableCellClass}>
                        <StatusBadge
                          label={
                            row.status === 'open'
                              ? t('admin.woStatusOpen')
                              : row.status === 'in_progress'
                                ? t('admin.woStatusInProgress')
                                : row.status === 'completed'
                                  ? t('admin.woStatusCompleted')
                                  : row.status === 'cancelled'
                                    ? t('admin.woStatusCancelled')
                                    : row.status
                          }
                          tone={woStatusTone(row.status)}
                        />
                      </td>
                      <td className={adminTableCellClass}>{row.assignee_name ?? t('admin.woUnassigned')}</td>
                      <td className={`${adminTableCellClass} text-secondary`}>
                        {row.completion_note ?? row.instructions ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </AdminTableShell>
          </div>
        )}
      </div>

      <div className={cardClass}>
        <label className="block text-xs text-muted">{t('admin.pickProperty')}</label>
        <ApartmentCombobox
          className="mt-1 max-w-xl"
          properties={sorted}
          value={propertyId}
          onChange={(id) => {
            setPropertyId(id);
            setError(null);
            setSuccess(null);
          }}
        />
      </div>

      {propertyId !== '' ? (
        <>
          <div className={cardClass}>
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
              {t('admin.internet')}
            </p>
            {propLoading ? (
              <p className="mt-3 text-sm text-muted">{t('common.loading')}</p>
            ) : (
              <div className="mt-3 space-y-2 text-sm text-secondary">
                {(() => {
                  const confirmedAt = (subscription as { opening_confirmed_at?: string | null } | null)
                    ?.opening_confirmed_at;
                  const needsInitial =
                    openingPending || !subscription || confirmedAt == null;
                  return needsInitial ? (
                    <>
                      <AdminInlineAlert tone="warning">
                        {t('admin.openingStatus_needs_initial_internet')}
                      </AdminInlineAlert>
                      <form onSubmit={handleConfirmInternetOpening} className="mt-2 grid gap-3 sm:grid-cols-2">
                        <label className="grid gap-1">
                          <span>{t('admin.internet')}</span>
                          <select
                            className={fieldClass}
                            value={openingState}
                            onChange={(e) =>
                              setOpeningState(e.target.value === 'active' ? 'active' : 'inactive')
                            }
                            data-testid="internet-opening-state"
                          >
                            <option value="inactive">{t('admin.internetStatusInactive')}</option>
                            <option value="active">{t('admin.internetStatusActive')}</option>
                          </select>
                        </label>
                        <label className="grid gap-1">
                          <span>{t('account.internetConnectedSince')}</span>
                          <input
                            className={fieldClass}
                            type="date"
                            value={openingConnDate}
                            onChange={(e) => setOpeningConnDate(e.target.value)}
                            data-testid="internet-opening-conn-date"
                          />
                        </label>
                        <div className="sm:col-span-2">
                          <AdminPrimaryButton
                            type="submit"
                            disabled={openingConfirmBusy}
                            data-testid="internet-opening-confirm"
                          >
                            {openingConfirmBusy ? t('common.saving') : t('common.confirm')}
                          </AdminPrimaryButton>
                        </div>
                      </form>
                    </>
                  ) : null;
                })()}
                {subscription ? (
                  <>
                    <p className="font-semibold text-foreground">
                      {t(internetStatusMessageKey(subscription.status))}
                    </p>
                    {subscription.period_start ? (
                      <p>
                        {t('account.internetConnectedSince')}:{' '}
                        {formatOwnerDate(subscription.period_start, locale)}
                      </p>
                    ) : null}
                    {subscription.billing_day != null ? (
                      <p>
                        {t('account.internetBillingDay', { n: String(subscription.billing_day) })}
                        {subscription.next_charge_on
                          ? ` · ${t('account.internetNextCharge')}: ${formatOwnerDate(subscription.next_charge_on, locale)}`
                          : ''}
                      </p>
                    ) : null}
                    {subscription.status === 'active' ? (
                      <AdminPrimaryButton
                        type="button"
                        className="mt-3"
                        disabled={debtBusy}
                        onClick={() => void handleDebtDisconnect()}
                      >
                        {debtBusy ? t('common.saving') : t('admin.internetDebtDisconnect')}
                      </AdminPrimaryButton>
                    ) : null}
                  </>
                ) : (
                  <p className="text-muted">{t('admin.internetNoSub')}</p>
                )}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <AdminMetricCard
              label={t('admin.charged')}
              value={propLoading ? t('common.loading') : formatEur(balance.charged_eur, locale)}
            />
            <AdminMetricCard
              label={t('admin.paid')}
              value={propLoading ? t('common.loading') : formatEur(balance.paid_eur, locale)}
            />
            <AdminMetricCard
              label={t('admin.balDebt')}
              value={propLoading ? t('common.loading') : formatEur(Math.abs(balance.balance_eur), locale)}
              secondary={aptStatus}
              alert={aptTone === 'debt'}
            />
          </div>

          <div className={cardClass}>
              <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
                {t('admin.internetPeriodTitle')}
              </p>
              <p className="mt-1 text-xs text-muted">{t('admin.internetTariffCalendarHint')}</p>
              <form onSubmit={handlePeriodConfirm} className="mt-4 space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-1 text-sm text-secondary">
                    {t('account.internetPeriodFrom')}
                    <input
                      className={fieldClass}
                      type="date"
                      value={periodStart}
                      onChange={(e) => {
                        setPeriodStart(e.target.value);
                        setPeriodQuote(null);
                      }}
                      required
                    />
                  </label>
                  <label className="grid gap-1 text-sm text-secondary">
                    {t('account.internetPeriodTo')}
                    <input
                      className={fieldClass}
                      type="date"
                      value={periodEnd}
                      onChange={(e) => {
                        setPeriodEnd(e.target.value);
                        setPeriodQuote(null);
                      }}
                      required
                    />
                  </label>
                </div>
                <fieldset className="space-y-2">
                  <legend className="text-sm text-secondary">{t('admin.internetBillingMethod')}</legend>
                  {INTERNET_BILLING_METHODS.map((method) => (
                    <label key={method} className="flex items-center gap-2 text-sm text-secondary">
                      <input
                        type="radio"
                        name="internet-billing-method"
                        checked={periodMethod === method}
                        onChange={() => {
                          setPeriodMethod(method);
                          setPeriodQuote(null);
                        }}
                      />
                      {t(internetBillingMethodLabelKey(method))}
                    </label>
                  ))}
                </fieldset>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={periodQuoteBusy || !periodStart || !periodEnd}
                    onClick={() => void handlePeriodQuote()}
                    className="rounded-xl border border-border bg-surface px-4 py-2 text-sm font-semibold text-foreground hover:bg-surface-secondary disabled:opacity-50"
                  >
                    {periodQuoteBusy ? t('common.loading') : t('admin.internetPeriodQuote')}
                  </button>
                  {canConfirmPeriod ? (
                    <button
                      type="submit"
                      disabled={periodConfirmBusy || !periodQuote}
                      className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
                    >
                      {periodConfirmBusy ? t('common.saving') : t('admin.internetPeriodConfirm')}
                    </button>
                  ) : null}
                </div>
                {periodQuote ? (
                  <div className="rounded-xl border border-border bg-surface-secondary/40 px-3 py-3 text-sm text-secondary space-y-1">
                    <p>
                      {formatOwnerDate(periodStart, locale)} — {formatOwnerDate(periodEnd, locale)}
                      {' · '}
                      {t('admin.internetPeriodDays', { n: String(periodQuote.calendar_days) })}
                    </p>
                    <p>{t(internetBillingMethodLabelKey(periodMethod))}</p>
                    {periodMethod === 'package_plus_days' ? (
                      <p>
                        {t('admin.internetPeriodPackages', {
                          packages: String(periodQuote.package_count),
                          days: String(periodQuote.extra_days),
                        })}
                      </p>
                    ) : null}
                    <p>
                      {t('admin.internetTariffPackage30')}: {formatEur(Number(periodQuote.package_rate_eur), locale)}
                      {' · '}
                      {t('admin.internetTariffDay24')}: {formatEur(Number(periodQuote.day_rate_eur), locale)}
                    </p>
                    <p className="font-semibold text-foreground">
                      {t('admin.internetPeriodTotal')}: {formatEur(Number(periodQuote.amount_eur), locale)}
                    </p>
                  </div>
                ) : null}
              </form>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className={cardClass}>
              <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
                {t('admin.internetPayment')}
              </p>
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
                  defaultPayerHint={sorted.find((p) => p.id === propertyId)?.owner_name ?? undefined}
                />
                <button
                  type="submit"
                  disabled={payBusy}
                  className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
                >
                  {payBusy ? t('receipt.forming') : t('admin.recordPayment')}
                </button>
              </form>
            </div>
            <div className={cardClass}>
              <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
                {t('admin.internetLedger')}
              </p>
              {ledger.length === 0 ? (
                <div className="mt-3">
                  <AdminEmptyState title={t('admin.noInternetLedger')} />
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
                          <tr key={row.id} className={adminTableRowClass}>
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
                                module="internet"
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
        </>
      ) : null}
    </div>
  );
}
