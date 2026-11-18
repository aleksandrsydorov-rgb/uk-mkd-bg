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
  type UtilityBalance,
} from '@/lib/utilities';
import { toUserFacingMessage } from '@/lib/userFacingError';
import {
  EMPTY_UTILITY_FINANCE_FILTERS,
  aggregateUtilityBalances,
  balanceRpcForService,
  buildUtilityFinanceRegisterRows,
  filterUtilityFinanceRegisterRows,
  ledgerTableForService,
  paymentRpcForService,
  receiptModuleForService,
  sortUtilityFinanceRegisterRows,
  utilityFinanceFiltersActive,
  type UtilityFinanceRegisterFilters,
  type UtilityFinanceRegisterRow,
  type UtilityFinanceService,
  type UtilityLedgerAggRow,
} from '@/lib/utilityFinanceRegister';
import {
  AdminEmptyState,
  AdminInlineAlert,
  AdminMetricCard,
  AdminPrimaryButton,
  AdminSecondaryButton,
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

function statusLabel(status: UtilityFinanceRegisterRow['status'], t: (k: string) => string) {
  if (status === 'debt') return t('admin.balDebt');
  if (status === 'credit') return t('admin.balOver');
  return t('admin.balSettled');
}

function statusTone(status: UtilityFinanceRegisterRow['status']): 'danger' | 'success' | 'neutral' {
  if (status === 'debt') return 'danger';
  if (status === 'credit') return 'success';
  return 'neutral';
}

function serviceTitleKey(service: UtilityFinanceService) {
  if (service === 'water') return 'admin.water';
  if (service === 'electricity') return 'admin.electricityFinance';
  return 'admin.internet';
}

export function AdminUtilityFinanceWorkplace({
  service,
  supabase,
  properties,
  canOperate,
  focusPropertyId,
  onPropertyChange,
  extraCardActions,
}: {
  service: UtilityFinanceService;
  supabase: SupabaseClient<Database>;
  properties: PropertyOption[];
  canOperate: boolean;
  focusPropertyId?: number | '';
  onPropertyChange?: (id: number | '') => void;
  /** Optional service-specific actions below the payment form (e.g. internet period charge). */
  extraCardActions?: React.ReactNode;
}) {
  const { t, locale } = useI18n();
  const [view, setView] = useState<'register' | 'card'>('register');
  const [propertyId, setPropertyId] = useState<number | ''>(
    focusPropertyId != null && focusPropertyId !== '' ? focusPropertyId : '',
  );
  const [filters, setFilters] = useState<UtilityFinanceRegisterFilters>(EMPTY_UTILITY_FINANCE_FILTERS);
  const [registerRows, setRegisterRows] = useState<UtilityFinanceRegisterRow[]>([]);
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
    const { data, error: qErr } = await supabase
      .from(table as 'water_ledger')
      .select('property_id, kind, amount_eur');
    setRegisterLoading(false);
    if (qErr && !isMissingRelation(qErr, table)) {
      setError(toUserFacingMessage(qErr, t, { context: 'load', fallback: t('common.errLoad') }));
      setRegisterRows(buildUtilityFinanceRegisterRows(properties, new Map()));
      return;
    }
    const balances = aggregateUtilityBalances((data ?? []) as UtilityLedgerAggRow[]);
    setRegisterRows(buildUtilityFinanceRegisterRows(properties, balances));
  }, [canOperate, properties, service, supabase, t]);

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
  }, [loadRegister]);

  useEffect(() => {
    if (view === 'card' && propertyId !== '') void loadCard();
  }, [view, propertyId, loadCard]);

  const visibleRows = useMemo(
    () => sortUtilityFinanceRegisterRows(filterUtilityFinanceRegisterRows(registerRows, filters)),
    [registerRows, filters],
  );
  const filtersActive = utilityFinanceFiltersActive(filters);

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
    return (
      <div className="space-y-4">
        <div className={cardClass}>
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
            {t('admin.utilFinRegisterTitle')}
          </p>
          <p className="mt-2 text-sm text-secondary">{t('admin.utilFinRegisterLead')}</p>
        </div>
        {error ? <AdminInlineAlert tone="danger">{error}</AdminInlineAlert> : null}
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
                setFilters((f) => ({
                  ...f,
                  status: e.target.value as UtilityFinanceRegisterFilters['status'],
                }))
              }
              className={`mt-1 block w-40 ${fieldClass}`}
            >
              <option value="all">{t('admin.sfFilterAll')}</option>
              <option value="debt">{t('admin.balDebt')}</option>
              <option value="credit">{t('admin.balOver')}</option>
              <option value="settled">{t('admin.balSettled')}</option>
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
            {t('admin.utilFinRegisterCount', { n: String(visibleRows.length) })}
          </p>
        </div>
        {registerLoading ? (
          <p className="text-sm text-muted">{t('common.loading')}</p>
        ) : properties.length === 0 ? (
          <AdminEmptyState title={t('admin.utilFinEmpty')} />
        ) : visibleRows.length === 0 ? (
          <AdminEmptyState title={t('admin.utilFinEmptyFilter')} />
        ) : (
          <AdminTableShell>
            <table className="w-full min-w-[40rem] text-sm">
              <thead>
                <tr className={adminTableHeadRowClass}>
                  <th className={adminTableCellClass}>{t('form.colApt')}</th>
                  <th className={adminTableCellClass}>{t('form.colOwner')}</th>
                  <th className={adminTableCellClass}>{t('admin.charged')}</th>
                  <th className={adminTableCellClass}>{t('admin.paid')}</th>
                  <th className={adminTableCellClass}>{t('admin.utilFinColBalance')}</th>
                  <th className={adminTableCellClass}>{t('admin.status')}</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => (
                  <tr
                    key={row.propertyId}
                    tabIndex={0}
                    role="button"
                    aria-label={t('admin.utilFinOpenCard')}
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
                          <PropertyIdentityLink
                            property={prop}
                            module={service === 'water' ? 'water' : service === 'electricity' ? 'electricity' : 'internet'}
                          />
                        ) : (
                          `№ ${row.apartmentNumber}`
                        );
                      })()}
                    </td>
                    <td className={adminTableCellClass}>{row.ownerName ?? '—'}</td>
                    <td className={`${adminTableCellClass} tabular-nums`}>
                      {formatEur(row.chargedEur, locale)}
                    </td>
                    <td className={`${adminTableCellClass} tabular-nums`}>
                      {formatEur(row.paidEur, locale)}
                    </td>
                    <td
                      className={`${adminTableCellClass} tabular-nums ${
                        row.status === 'debt'
                          ? 'text-danger'
                          : row.status === 'credit'
                            ? 'text-success'
                            : ''
                      }`}
                    >
                      {formatEur(Math.abs(row.balanceEur), locale)}
                    </td>
                    <td className={adminTableCellClass}>
                      <StatusBadge label={statusLabel(row.status, t)} tone={statusTone(row.status)} />
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
