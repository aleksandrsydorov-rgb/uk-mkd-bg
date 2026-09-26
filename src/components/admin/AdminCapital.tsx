'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { useI18n } from '@/i18n/I18nProvider';
import { labelLedgerKind } from '@/i18n/labels';
import { formatOwnerDate } from '@/lib/ownerFormat';
import { isMissingRelation } from '@/lib/polls';
import { sofiaCurrentYear } from '@/lib/tariffs';
import {
  balanceTone,
  canSeeCapitalAdmin,
  emptyBalance,
  formatEur,
  mapAdminRpcError,
  type CapitalLedger,
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
import { readBulkAccrualSummary } from '@/lib/bulkAccrual';

type PropertyOption = {
  id: number;
  apartment_number: string | number | null;
  owner_name: string | null;
};

function aptNumber(value: string | number | null | undefined) {
  return String(value ?? '');
}

const fieldClass = adminFieldClass;
const cardClass = `${adminCardClass} p-4 md:p-5`;

function firstRow<T>(data: T[] | T | null | undefined): T | null {
  if (!data) return null;
  return Array.isArray(data) ? (data[0] ?? null) : data;
}

export function AdminCapital({
  supabase,
  properties,
  staffRole,
}: {
  supabase: SupabaseClient<Database>;
  properties: PropertyOption[];
  staffRole: string;
}) {
  const { t, locale } = useI18n();
  const canSee = canSeeCapitalAdmin(staffRole);

  const sorted = useMemo(
    () =>
      [...properties].sort((a, b) =>
        aptNumber(a.apartment_number).localeCompare(aptNumber(b.apartment_number), undefined, { numeric: true }),
      ),
    [properties],
  );

  const [propertyId, setPropertyId] = useState<number | ''>('');
  const [ledger, setLedger] = useState<CapitalLedger[]>([]);
  const [balance, setBalance] = useState<UtilityBalance>(emptyBalance());
  const [propLoading, setPropLoading] = useState(false);
  const [fundCharged, setFundCharged] = useState<number | null>(null);
  const [fundPaid, setFundPaid] = useState<number | null>(null);
  const [fundBalance, setFundBalance] = useState<number | null>(null);
  const [fundDebtApts, setFundDebtApts] = useState<number | null>(null);
  const [fundLoading, setFundLoading] = useState(false);
  const [payBusy, setPayBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payNote, setPayNote] = useState('');
  const [billingYear, setBillingYear] = useState(() => sofiaCurrentYear());
  const [tariffAmount, setTariffAmount] = useState<number | null>(null);
  const [tariffLoading, setTariffLoading] = useState(false);
  const [bulkExisting, setBulkExisting] = useState<number | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkResult, setBulkResult] = useState<string | null>(null);
  const payKeyRef = useRef(crypto.randomUUID());

  const loadFund = useCallback(async () => {
    if (!canSee) return;
    setFundLoading(true);
    const { data, error: rpcErr } = await supabase.rpc('get_capital_repair_fund_totals');
    setFundLoading(false);
    if (rpcErr) {
      if (!/could not find the function/i.test(rpcErr.message ?? '')) {
        setError(t(mapAdminRpcError(rpcErr.message)));
      }
      setFundCharged(null);
      setFundPaid(null);
      setFundBalance(null);
      setFundDebtApts(null);
      return;
    }
    const row = firstRow(
      data as
        | {
            charged_eur?: number;
            paid_eur?: number;
            balance_eur?: number;
            apartments_with_debt?: number;
          }[]
        | null,
    );
    setFundCharged(row?.charged_eur != null ? Number(row.charged_eur) : 0);
    setFundPaid(row?.paid_eur != null ? Number(row.paid_eur) : 0);
    setFundBalance(row?.balance_eur != null ? Number(row.balance_eur) : 0);
    setFundDebtApts(row?.apartments_with_debt != null ? Number(row.apartments_with_debt) : 0);
  }, [canSee, supabase, t]);

  const loadPropertyCapital = useCallback(async () => {
    if (!canSee || propertyId === '') {
      setLedger([]);
      setBalance(emptyBalance());
      return;
    }
    setPropLoading(true);
    const pid = Number(propertyId);
    const [ledgerRes, balanceRes] = await Promise.all([
      supabase
        .from('capital_repair_ledger')
        .select('*')
        .eq('property_id', pid)
        .order('created_at', { ascending: false })
        .limit(40),
      supabase.rpc('get_capital_repair_balance', { p_property_id: pid }),
    ]);
    setPropLoading(false);
    if (ledgerRes.error && !isMissingRelation(ledgerRes.error, 'capital_repair_ledger')) {
      setError(t(mapAdminRpcError(ledgerRes.error.message)));
      setLedger([]);
    } else {
      setLedger((ledgerRes.data ?? []) as CapitalLedger[]);
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
  }, [canSee, propertyId, supabase, t]);

  useEffect(() => {
    void loadFund();
  }, [loadFund, bulkBusy]);

  useEffect(() => {
    void loadPropertyCapital();
  }, [loadPropertyCapital]);

  useEffect(() => {
    if (!canSee) {
      setTariffAmount(null);
      return;
    }
    let cancelled = false;
    setTariffLoading(true);
    void supabase
      .rpc('get_applicable_capital_tariff', { p_billing_year: billingYear })
      .then(({ data, error: rpcErr }) => {
        if (cancelled) return;
        setTariffLoading(false);
        if (rpcErr) {
          setTariffAmount(null);
          return;
        }
        const row = firstRow(data as { amount_eur?: number }[] | null);
        const amount = row?.amount_eur != null ? Number(row.amount_eur) : NaN;
        setTariffAmount(Number.isFinite(amount) && amount > 0 ? amount : null);
      });
    return () => {
      cancelled = true;
    };
  }, [billingYear, canSee, supabase]);

  useEffect(() => {
    if (!canSee || tariffAmount == null) {
      setBulkExisting(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const title = `Капитальный ремонт ${billingYear}`;
      const { data: assessments } = await supabase
        .from('capital_repair_assessments')
        .select('id')
        .eq('status', 'active')
        .eq('title', title)
        .limit(1);
      const assessmentId = assessments?.[0]?.id;
      if (!assessmentId) {
        if (!cancelled) setBulkExisting(0);
        return;
      }
      const { count } = await supabase
        .from('capital_repair_ledger')
        .select('id', { count: 'exact', head: true })
        .eq('assessment_id', assessmentId)
        .eq('kind', 'charge');
      if (!cancelled) setBulkExisting(count ?? 0);
    })();
    return () => {
      cancelled = true;
    };
  }, [billingYear, bulkBusy, canSee, supabase, tariffAmount]);

  function rpcFail(message: string | undefined) {
    setSuccess(null);
    setError(t(mapAdminRpcError(message ?? '')));
  }

  async function handleBulkCharge() {
    if (!canSee) return;
    if (tariffAmount == null) {
      setError(t('admin.errCapitalTariff'));
      return;
    }
    const total = sorted.length;
    if (total === 0) return;
    const existing = bulkExisting ?? 0;
    const will = Math.max(0, total - existing);
    if (!confirm(t('confirm.bulkCapitalTariff', { year: billingYear, total, existing, will }))) return;
    setBulkBusy(true);
    setBulkResult(null);
    const { data, error: rpcErr } = await supabase.rpc('charge_capital_repair_year_bulk', {
      p_billing_year: billingYear,
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
    const summary = readBulkAccrualSummary(data);
    if (!summary) {
      setError(t('admin.errGeneric'));
      return;
    }
    setError(null);
    setBulkResult(t('admin.bulkResult', { created: summary.created, skipped: summary.skipped_existing }));
    setSuccess(null);
    await Promise.all([loadFund(), loadPropertyCapital()]);
  }

  async function handlePay(e: React.FormEvent) {
    e.preventDefault();
    if (!canSee || propertyId === '') return;
    const amount = Number(payAmount);
    if (!(amount > 0) || Number.isNaN(amount)) {
      setError(t('admin.errAmount'));
      return;
    }
    setPayBusy(true);
    const { error: rpcErr } = await supabase.rpc('record_capital_repair_payment', {
      p_property_id: Number(propertyId),
      p_amount_eur: amount,
      p_note: payNote.trim() || null,
      p_idempotency_key: payKeyRef.current,
    });
    setPayBusy(false);
    if (rpcErr) {
      rpcFail(rpcErr.message);
      return;
    }
    payKeyRef.current = crypto.randomUUID();
    setPayAmount('');
    setPayNote('');
    setError(null);
    setSuccess(t('admin.okCapitalPay'));
    await Promise.all([loadPropertyCapital(), loadFund()]);
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
  const total = sorted.length;
  const existing = bulkExisting ?? 0;
  const will = Math.max(0, total - existing);

  return (
    <div className="space-y-4">
      <AdminPageHeader title={t('admin.capital')} secondary={t('admin.capitalLead')} />

      {error ? <AdminInlineAlert tone="danger">{error}</AdminInlineAlert> : null}
      {success ? <AdminInlineAlert tone="success">{success}</AdminInlineAlert> : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <AdminMetricCard
          label={t('admin.charged')}
          value={fundLoading || fundCharged == null ? t('common.loading') : formatEur(fundCharged, locale)}
        />
        <AdminMetricCard
          label={t('admin.paid')}
          value={fundLoading || fundPaid == null ? t('common.loading') : formatEur(fundPaid, locale)}
        />
        <AdminMetricCard
          label={t('admin.capitalBalance')}
          value={
            fundLoading || fundBalance == null
              ? t('common.loading')
              : formatEur(Math.abs(fundBalance), locale)
          }
          secondary={
            fundTone === 'debt' ? t('admin.balDebt') : fundTone === 'over' ? t('admin.balOver') : t('admin.balSettled')
          }
          alert={fundTone === 'debt'}
        />
        <AdminMetricCard
          label={t('admin.capitalDebtApts')}
          value={fundLoading || fundDebtApts == null ? t('common.loading') : String(fundDebtApts)}
        />
      </div>

      <div className={cardClass}>
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
          {t('admin.capitalChargeAllTitle')}
        </p>
        <p className="mt-2 text-sm text-secondary">{t('admin.capitalChargeAllHint')}</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="grid gap-1 text-sm text-secondary">
            {t('admin.tcApplicationYear')}
            <input
              className={fieldClass}
              type="number"
              min={2000}
              max={2100}
              value={billingYear}
              onChange={(e) => {
                setBillingYear(Number(e.target.value) || sofiaCurrentYear());
                setBulkResult(null);
              }}
            />
          </label>
          <div>
            <p className="text-xs text-muted">{t('admin.capitalTariffAmount')}</p>
            <p className="mt-1 text-sm font-semibold tabular-nums text-foreground">
              {tariffLoading
                ? t('common.loading')
                : tariffAmount != null
                  ? formatEur(tariffAmount, locale)
                  : t('admin.capitalNoTariff')}
            </p>
            <p className="mt-1 text-xs text-muted">{t('admin.tcUnitAptYear')}</p>
          </div>
          <div>
            <p className="text-xs text-muted">{t('admin.bulkExisting')}</p>
            <p className="mt-1 text-sm font-medium tabular-nums">{bulkExisting == null ? '—' : existing}</p>
          </div>
          <div>
            <p className="text-xs text-muted">{t('admin.bulkWill')}</p>
            <p className="mt-1 text-sm font-medium tabular-nums">{bulkExisting == null ? '—' : will}</p>
          </div>
        </div>
        <AdminPrimaryButton
          type="button"
          className="mt-4"
          disabled={bulkBusy || tariffAmount == null || total === 0}
          onClick={() => void handleBulkCharge()}
        >
          {bulkBusy ? t('common.saving') : t('admin.capitalChargeAll')}
        </AdminPrimaryButton>
        {bulkResult ? <p className="mt-3 text-sm text-secondary">{bulkResult}</p> : null}
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
              label={t('admin.capitalBalance')}
              value={propLoading ? t('common.loading') : formatEur(Math.abs(balance.balance_eur), locale)}
              secondary={aptStatus}
              alert={aptTone === 'debt'}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className={cardClass}>
              <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
                {t('admin.capitalPayment')}
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
                {t('admin.capitalLedger')}
              </p>
              {ledger.length === 0 ? (
                <div className="mt-3">
                  <AdminEmptyState title={t('admin.noCapitalLedger')} />
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
