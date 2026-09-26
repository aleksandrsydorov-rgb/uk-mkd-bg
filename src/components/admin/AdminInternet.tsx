'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { useI18n } from '@/i18n/I18nProvider';
import { labelLedgerKind } from '@/i18n/labels';
import { formatOwnerDate } from '@/lib/ownerFormat';
import { isMissingRelation } from '@/lib/polls';
import {
  canSeeInternetAdmin,
  internetStatusMessageKey,
  type InternetLedger,
  type InternetSubscription,
  type InternetWorkOrderRow,
} from '@/lib/internet';
import {
  balanceTone,
  emptyBalance,
  formatEur,
  mapAdminRpcError,
  type UtilityBalance,
} from '@/lib/utilities';
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
import { StatusBadge } from '@/components/account/ownerUi';

type PropertyOption = {
  id: number;
  apartment_number: string | number | null;
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
}: {
  supabase: SupabaseClient<Database>;
  properties: PropertyOption[];
  staffRole: string;
}) {
  const { t, locale } = useI18n();
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
  const [moves, setMoves] = useState<InternetWorkOrderRow[]>([]);
  const [movesLoading, setMovesLoading] = useState(false);
  const [payBusy, setPayBusy] = useState(false);
  const [debtBusy, setDebtBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payNote, setPayNote] = useState('');
  const payKeyRef = useRef(crypto.randomUUID());

  const loadFund = useCallback(async () => {
    if (!canSee) return;
    setFundLoading(true);
    setMovesLoading(true);
    const [totalsRes, movesRes] = await Promise.all([
      supabase.rpc('get_internet_fund_totals'),
      supabase.rpc('list_internet_work_orders'),
    ]);
    setFundLoading(false);
    setMovesLoading(false);
    if (totalsRes.error) {
      if (!/could not find the function/i.test(totalsRes.error.message ?? '')) {
        setError(t(mapAdminRpcError(totalsRes.error.message)));
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
        setError(t(mapAdminRpcError(movesRes.error.message)));
      }
      setMoves([]);
    } else {
      setMoves((movesRes.data as InternetWorkOrderRow[] | null) ?? []);
    }
  }, [canSee, supabase, t]);

  const loadProperty = useCallback(async () => {
    if (!canSee || propertyId === '') {
      setLedger([]);
      setBalance(emptyBalance());
      setSubscription(null);
      return;
    }
    setPropLoading(true);
    const pid = Number(propertyId);
    const [ledgerRes, balanceRes, subRes] = await Promise.all([
      supabase
        .from('internet_ledger')
        .select('*')
        .eq('property_id', pid)
        .order('created_at', { ascending: false })
        .limit(40),
      supabase.rpc('get_internet_balance', { p_property_id: pid }),
      supabase.from('internet_subscriptions').select('*').eq('property_id', pid).maybeSingle(),
    ]);
    setPropLoading(false);
    if (ledgerRes.error && !isMissingRelation(ledgerRes.error, 'internet_ledger')) {
      setError(t(mapAdminRpcError(ledgerRes.error.message)));
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
      setError(t(mapAdminRpcError(subRes.error.message)));
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

  async function handlePay(e: React.FormEvent) {
    e.preventDefault();
    if (!canSee || propertyId === '') return;
    const amount = Number(payAmount);
    if (!(amount > 0) || Number.isNaN(amount)) {
      setError(t('admin.errAmount'));
      return;
    }
    setPayBusy(true);
    const { error: rpcErr } = await supabase.rpc('record_internet_payment', {
      p_property_id: Number(propertyId),
      p_amount_eur: amount,
      p_note: payNote.trim() || null,
      p_idempotency_key: payKeyRef.current,
    });
    setPayBusy(false);
    if (rpcErr) {
      setSuccess(null);
      setError(t(mapAdminRpcError(rpcErr.message)));
      return;
    }
    payKeyRef.current = crypto.randomUUID();
    setPayAmount('');
    setPayNote('');
    setError(null);
    setSuccess(t('admin.okInternetPay'));
    await Promise.all([loadProperty(), loadFund()]);
  }

  async function handleDebtDisconnect() {
    if (!canSee || propertyId === '') return;
    if (!confirm(t('admin.internetDebtDisconnectConfirm'))) return;
    setDebtBusy(true);
    const { error: rpcErr } = await supabase.rpc('admin_internet_disconnect_debt', {
      p_property_id: Number(propertyId),
    });
    setDebtBusy(false);
    if (rpcErr) {
      setSuccess(null);
      setError(t(mapAdminRpcError(rpcErr.message)));
      return;
    }
    setError(null);
    setSuccess(t('admin.okInternetDebtOff'));
    await Promise.all([loadProperty(), loadFund()]);
  }

  if (!canSee) {
    return (
      <div className={cardClass}>
        <p className="text-sm text-secondary">{t('admin.capitalNoAccess')}</p>
      </div>
    );
  }

  const aptTone = balanceTone(balance.balance_eur);
  const aptStatus =
    aptTone === 'debt' ? t('admin.balDebt') : aptTone === 'over' ? t('admin.balOver') : t('admin.balSettled');
  const fundTone = balanceTone(fundBalance ?? 0);

  return (
    <div className="space-y-4">
      <AdminPageHeader title={t('admin.internet')} secondary={t('admin.internetLead')} />

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
                        {row.apartment_number ? `№${row.apartment_number}` : '—'}
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
            ) : subscription ? (
              <div className="mt-3 space-y-1 text-sm text-secondary">
                <p className="font-semibold text-foreground">
                  {t(internetStatusMessageKey(subscription.status))}
                </p>
                {subscription.period_start ? (
                  <p>
                    {t('account.internetConnectedSince')}: {formatOwnerDate(subscription.period_start, locale)}
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
              </div>
            ) : (
              <p className="mt-3 text-sm text-muted">{t('admin.internetNoSub')}</p>
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

          <div className="grid gap-4 lg:grid-cols-2">
            <div className={cardClass}>
              <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
                {t('admin.internetPayment')}
              </p>
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
                />
                <input
                  className={fieldClass}
                  placeholder={t('admin.noteOptional')}
                  value={payNote}
                  onChange={(e) => setPayNote(e.target.value)}
                />
                <button
                  type="submit"
                  disabled={payBusy}
                  className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
                >
                  {payBusy ? t('common.saving') : t('admin.recordPayment')}
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
