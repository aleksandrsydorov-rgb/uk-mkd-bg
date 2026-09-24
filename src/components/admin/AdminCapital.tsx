'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { useI18n } from '@/i18n/I18nProvider';
import { labelAssessmentStatus, labelLedgerKind } from '@/i18n/labels';
import { formatOwnerDate } from '@/lib/ownerFormat';
import { isMissingRelation } from '@/lib/polls';
import {
  balanceTone,
  canSeeCapitalAdmin,
  emptyBalance,
  formatEur,
  mapAdminRpcError,
  todayIsoDate,
  type CapitalAssessment,
  type CapitalLedger,
  type UtilityBalance,
} from '@/lib/utilities';
import {
  AdminPageHeader,
  AdminCard,
  AdminMetricCard,
  AdminTabBar,
  AdminTableShell,
  AdminEmptyState,
  AdminInlineAlert,
  adminCardClass,
  adminFieldClass,
  adminTableCellClass,
  adminTableHeadRowClass,
  adminTableRowClass,
} from '@/components/admin/AdminUi';
import { ApartmentCombobox } from '@/components/admin/ApartmentCombobox';
import { readBulkAccrualSummary } from '@/lib/bulkAccrual';
import { StatusBadge } from '@/components/account/ownerUi';

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

const CAPITAL_TABS = ['overview', 'charges', 'operations'] as const;
type CapitalTab = (typeof CAPITAL_TABS)[number];

export function AdminCapital({
  supabase,
  properties,
  staffRole,
  tab,
  onTabChange,
}: {
  supabase: SupabaseClient<Database>;
  properties: PropertyOption[];
  staffRole: string;
  tab?: string | null;
  onTabChange?: (tab: CapitalTab) => void;
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

  const [propertyId, setPropertyId] = useState<number | ''>(sorted[0]?.id ?? '');
  const [assessments, setAssessments] = useState<CapitalAssessment[]>([]);
  const [ledger, setLedger] = useState<CapitalLedger[]>([]);
  const [balance, setBalance] = useState<UtilityBalance>(emptyBalance());
  const [listLoading, setListLoading] = useState(false);
  const [propLoading, setPropLoading] = useState(false);
  const [assessmentBusy, setAssessmentBusy] = useState(false);
  const [chargeBusy, setChargeBusy] = useState(false);
  const [payBusy, setPayBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [decisionDate, setDecisionDate] = useState(todayIsoDate());
  const [dueDate, setDueDate] = useState('');
  const [assessmentId, setAssessmentId] = useState('');
  const [chargeAmount, setChargeAmount] = useState('');
  const [chargeNote, setChargeNote] = useState('');
  const [payAmount, setPayAmount] = useState('');
  const [payNote, setPayNote] = useState('');
  const [bulkAssessmentId, setBulkAssessmentId] = useState('');
  const [bulkAmount, setBulkAmount] = useState('');
  const [bulkNote, setBulkNote] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkExisting, setBulkExisting] = useState<number | null>(null);
  const [bulkResult, setBulkResult] = useState<string | null>(null);

  const chargeKeyRef = useRef(crypto.randomUUID());
  const payKeyRef = useRef(crypto.randomUUID());
  const [localTab, setLocalTab] = useState<CapitalTab>('overview');
  const capitalTabs = useMemo(
    () => [
      { id: 'overview' as const, label: t('admin.capTabOverview') },
      { id: 'charges' as const, label: t('admin.capTabCharges') },
      { id: 'operations' as const, label: t('admin.capTabOps') },
    ],
    [t],
  );
  const activeTab: CapitalTab =
    tab && (CAPITAL_TABS as readonly string[]).includes(tab) ? (tab as CapitalTab) : onTabChange ? 'overview' : localTab;

  function selectTab(next: CapitalTab) {
    if (onTabChange) onTabChange(next);
    else setLocalTab(next);
  }

  useEffect(() => {
    if (propertyId === '' && sorted[0]) setPropertyId(sorted[0].id);
  }, [propertyId, sorted]);

  const activeAssessments = assessments.filter((a) => a.status === 'active');
  const titles = useMemo(() => new Map(assessments.map((a) => [a.id, a.title])), [assessments]);

  const loadAssessments = useCallback(async () => {
    if (!canSee) return;
    setListLoading(true);
    const { data, error: qErr } = await supabase
      .from('capital_repair_assessments')
      .select('*')
      .order('created_at', { ascending: false });
    setListLoading(false);
    if (qErr) {
      if (!isMissingRelation(qErr, 'capital_repair_assessments')) setError(t(mapAdminRpcError(qErr.message)));
      setAssessments([]);
      return;
    }
    setAssessments((data ?? []) as CapitalAssessment[]);
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
        .limit(30),
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
    void loadAssessments();
  }, [loadAssessments]);

  useEffect(() => {
    void loadPropertyCapital();
  }, [loadPropertyCapital]);

  useEffect(() => {
    if (!canSee || !bulkAssessmentId) {
      setBulkExisting(null);
      return;
    }
    let cancelled = false;
    void supabase
      .from('capital_repair_ledger')
      .select('id', { count: 'exact', head: true })
      .eq('assessment_id', bulkAssessmentId)
      .eq('kind', 'charge')
      .then(({ count }) => {
        if (!cancelled) setBulkExisting(count ?? 0);
      });
    return () => {
      cancelled = true;
    };
  }, [bulkAssessmentId, bulkBusy, canSee, supabase]);

  function rpcFail(message: string | undefined) {
    setSuccess(null);
    setError(t(mapAdminRpcError(message ?? '')));
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!canSee) return;
    const trimmed = title.trim();
    if (!trimmed) {
      setError(t('admin.errTitle'));
      return;
    }
    if (decisionDate > todayIsoDate()) {
      setError(t('admin.errFutureDate'));
      return;
    }
    if (dueDate && dueDate < decisionDate) {
      setError(t('admin.errDueDate'));
      return;
    }
    setAssessmentBusy(true);
    const { error: rpcErr } = await supabase.rpc('create_capital_repair_assessment', {
      p_title: trimmed,
      p_description: description.trim() || null,
      p_decision_date: decisionDate,
      p_due_date: dueDate || null,
    });
    setAssessmentBusy(false);
    if (rpcErr) {
      rpcFail(rpcErr.message);
      return;
    }
    setTitle('');
    setDescription('');
    setDecisionDate(todayIsoDate());
    setDueDate('');
    setError(null);
    setSuccess(t('admin.okAssessment'));
    await loadAssessments();
  }

  async function handleCharge(e: React.FormEvent) {
    e.preventDefault();
    if (!canSee || propertyId === '') return;
    if (!assessmentId) {
      setError(t('admin.errPickAssessment'));
      return;
    }
    const amount = Number(chargeAmount);
    if (!(amount > 0) || Number.isNaN(amount)) {
      setError(t('admin.errAmount'));
      return;
    }
    const { data: existing } = await supabase
      .from('capital_repair_ledger')
      .select('id')
      .eq('property_id', Number(propertyId))
      .eq('assessment_id', assessmentId)
      .eq('kind', 'charge')
      .limit(1);
    if ((existing ?? []).length > 0) {
      setError(t('admin.errCapitalDup'));
      return;
    }
    setChargeBusy(true);
    const { error: rpcErr } = await supabase.rpc('charge_capital_repair', {
      p_property_id: Number(propertyId),
      p_assessment_id: assessmentId,
      p_amount_eur: amount,
      p_note: chargeNote.trim() || null,
      p_idempotency_key: chargeKeyRef.current,
    });
    setChargeBusy(false);
    if (rpcErr) {
      rpcFail(rpcErr.message);
      return;
    }
    chargeKeyRef.current = crypto.randomUUID();
    setChargeAmount('');
    setChargeNote('');
    setError(null);
    setSuccess(t('admin.okCapitalCharge'));
    await Promise.all([loadPropertyCapital(), loadAssessments()]);
  }

  async function handleBulkCharge() {
    if (!canSee || !bulkAssessmentId) {
      setError(t('admin.errPickAssessment'));
      return;
    }
    const amount = Number(bulkAmount);
    if (!(amount > 0) || Number.isNaN(amount)) {
      setError(t('admin.errAmount'));
      return;
    }
    const total = sorted.length;
    if (total === 0) return;
    const existing = bulkExisting ?? 0;
    const will = Math.max(0, total - existing);
    if (!confirm(t('confirm.bulkCapital', { total, existing, will }))) return;
    setBulkBusy(true);
    setBulkResult(null);
    const { data, error: rpcErr } = await supabase.rpc('charge_capital_repair_bulk', {
      p_assessment_id: bulkAssessmentId,
      p_amount_eur: amount,
      p_note: bulkNote.trim() || null,
    });
    setBulkBusy(false);
    if (rpcErr) {
      const msg = rpcErr.message ?? '';
      if (/could not find the function/i.test(msg)) {
        setSuccess(null);
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
    await Promise.all([loadPropertyCapital(), loadAssessments()]);
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
    await loadPropertyCapital();
  }

  if (!canSee) {
    return (
      <div className={cardClass}>
        <p className="text-sm text-secondary">{t('admin.capitalNoAccess')}</p>
      </div>
    );
  }

  const tone = balanceTone(balance.balance_eur);
  const statusLabel =
    tone === 'debt' ? t('admin.balDebt') : tone === 'over' ? t('admin.balOver') : t('admin.balSettled');

  return (
    <div className="space-y-4">
      <AdminPageHeader title={t('admin.capital')} secondary={t('admin.capitalLead')} />
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

      {error && <AdminInlineAlert tone="danger">{error}</AdminInlineAlert>}
      {success && <AdminInlineAlert tone="success">{success}</AdminInlineAlert>}

      <AdminTabBar tabs={capitalTabs} active={activeTab} onChange={(id) => selectTab(id as CapitalTab)} />

      {activeTab === 'overview' && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <AdminMetricCard
            label={t('admin.charged')}
            value={propLoading ? t('common.loading') : formatEur(balance.charged_eur, locale)}
            onClick={() => selectTab('charges')}
          />
          <AdminMetricCard
            label={t('admin.paid')}
            value={propLoading ? t('common.loading') : formatEur(balance.paid_eur, locale)}
            onClick={() => selectTab('operations')}
          />
          <AdminMetricCard
            label={t('admin.capitalBalance')}
            value={propLoading ? t('common.loading') : formatEur(Math.abs(balance.balance_eur), locale)}
            secondary={statusLabel}
            alert={tone === 'debt'}
            onClick={() => selectTab('operations')}
          />
        </div>
      )}

      {activeTab === 'operations' && (
      <div className="grid gap-4 lg:grid-cols-2">
        <div className={cardClass}>
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">{t('admin.capitalBalance')}</p>
          <p className={`mt-2 text-2xl font-semibold ${tone === 'debt' ? 'text-danger' : tone === 'over' ? 'text-success' : 'text-foreground'}`}>
            {formatEur(Math.abs(balance.balance_eur), locale)}
          </p>
          <p className="text-sm text-secondary">{statusLabel}</p>
        </div>
        <div className={cardClass}>
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">{t('admin.capitalPayment')}</p>
          <form onSubmit={handlePay} className="mt-4 space-y-3">
            <input className={fieldClass} type="number" min="0.01" step="0.01" placeholder={t('admin.amountEur')} value={payAmount} onChange={(e) => setPayAmount(e.target.value)} required />
            <input className={fieldClass} placeholder={t('admin.noteOptional')} value={payNote} onChange={(e) => setPayNote(e.target.value)} />
            <button type="submit" disabled={payBusy} className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50">
              {payBusy ? t('common.saving') : t('admin.recordPayment')}
            </button>
          </form>
        </div>
      </div>
      )}

      {activeTab === 'charges' && (
      <>
      <div className={cardClass}>
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">{t('admin.createAssessment')}</p>
        <form onSubmit={handleCreate} className="mt-4 grid gap-3 sm:grid-cols-2">
          <input className={`${fieldClass} sm:col-span-2`} placeholder={t('admin.assessmentTitle')} value={title} onChange={(e) => setTitle(e.target.value)} required />
          <textarea className={`${fieldClass} sm:col-span-2 min-h-[4.5rem]`} placeholder={t('admin.assessmentDesc')} value={description} onChange={(e) => setDescription(e.target.value)} />
          <div>
            <label className="mb-1 block text-xs text-muted">{t('admin.decisionDate')}</label>
            <input className={fieldClass} type="date" max={todayIsoDate()} value={decisionDate} onChange={(e) => setDecisionDate(e.target.value)} required />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted">{t('admin.dueDate')}</label>
            <input className={fieldClass} type="date" min={decisionDate} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
          <button type="submit" disabled={assessmentBusy} className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50 sm:w-fit">
            {assessmentBusy ? t('common.saving') : t('admin.createAssessment')}
          </button>
        </form>
      </div>

      <div className={cardClass}>
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">{t('admin.assessments')}</p>
        {listLoading ? (
          <p className="mt-3 text-sm text-muted">{t('common.loading')}</p>
        ) : assessments.length === 0 ? (
          <div className="mt-3"><AdminEmptyState title={t('admin.noAssessments')} /></div>
        ) : (
          <div className="mt-3">
            <AdminTableShell>
            <table className="w-full min-w-[36rem] text-sm">
              <thead>
                <tr className={adminTableHeadRowClass}>
                  <th className={adminTableCellClass}>{t('admin.assessmentTitle')}</th>
                  <th className={adminTableCellClass}>{t('admin.decisionDate')}</th>
                  <th className={adminTableCellClass}>{t('admin.dueDate')}</th>
                  <th className={adminTableCellClass}>{t('admin.status')}</th>
                  <th className={adminTableCellClass}>{t('admin.createdAt')}</th>
                </tr>
              </thead>
              <tbody>
                {assessments.map((row) => (
                  <tr key={row.id} className={adminTableRowClass}>
                    <td className={adminTableCellClass}>
                      <div className="font-medium">{row.title}</div>
                      {row.description ? <div className="text-xs text-muted">{row.description}</div> : null}
                    </td>
                    <td className={`${adminTableCellClass} tabular-nums`}>{formatOwnerDate(row.decision_date)}</td>
                    <td className={`${adminTableCellClass} tabular-nums`}>{formatOwnerDate(row.due_date)}</td>
                    <td className={adminTableCellClass}>
                      <StatusBadge
                        label={labelAssessmentStatus(row.status, t)}
                        tone={row.status === 'active' ? 'info' : 'neutral'}
                      />
                    </td>
                    <td className={`${adminTableCellClass} tabular-nums`}>{formatOwnerDate(row.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </AdminTableShell>
          </div>
        )}
      </div>

      <div className={cardClass}>
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">{t('admin.capitalCharge')}</p>
        {activeAssessments.length === 0 ? (
          <p className="mt-3 text-sm text-secondary">{t('admin.noActiveAssessments')}</p>
        ) : (
          <form onSubmit={handleCharge} className="mt-4 grid gap-3 sm:grid-cols-2">
            <select className={fieldClass} value={assessmentId} onChange={(e) => setAssessmentId(e.target.value)} required>
              <option value="">{t('admin.pickAssessment')}</option>
              {activeAssessments.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.title}
                </option>
              ))}
            </select>
            <input className={fieldClass} type="number" min="0.01" step="0.01" placeholder={t('admin.amountEur')} value={chargeAmount} onChange={(e) => setChargeAmount(e.target.value)} required />
            <input className={`${fieldClass} sm:col-span-2`} placeholder={t('admin.noteOptional')} value={chargeNote} onChange={(e) => setChargeNote(e.target.value)} />
            <button type="submit" disabled={chargeBusy} className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50 sm:w-fit">
              {chargeBusy ? t('common.saving') : t('admin.chargeCapital')}
            </button>
          </form>
        )}
      </div>

      <div className={cardClass}>
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">{t('admin.bulkTitle')}</p>
        <p className="mt-2 text-sm text-secondary">{t('admin.bulkCapitalHint')}</p>
        {activeAssessments.length === 0 ? (
          <p className="mt-3 text-sm text-secondary">{t('admin.noActiveAssessments')}</p>
        ) : (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <select
              className={fieldClass}
              value={bulkAssessmentId}
              onChange={(e) => {
                setBulkAssessmentId(e.target.value);
                setBulkResult(null);
              }}
            >
              <option value="">{t('admin.pickAssessment')}</option>
              {activeAssessments.map((a) => (
                <option key={a.id} value={a.id}>{a.title}</option>
              ))}
            </select>
            <input className={fieldClass} type="number" min="0.01" step="0.01" placeholder={t('admin.amountEur')} value={bulkAmount} onChange={(e) => setBulkAmount(e.target.value)} />
            <input className={`${fieldClass} sm:col-span-2`} placeholder={t('admin.noteOptional')} value={bulkNote} onChange={(e) => setBulkNote(e.target.value)} />
            <dl className="grid gap-2 text-sm sm:col-span-2 sm:grid-cols-3">
              <div>
                <dt className="text-xs text-muted">{t('admin.bulkTotal')}</dt>
                <dd className="font-medium tabular-nums">{sorted.length}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">{t('admin.bulkExisting')}</dt>
                <dd className="font-medium tabular-nums">{bulkAssessmentId && bulkExisting != null ? bulkExisting : '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">{t('admin.bulkWill')}</dt>
                <dd className="font-medium tabular-nums">
                  {bulkAssessmentId && bulkExisting != null ? Math.max(0, sorted.length - bulkExisting) : '—'}
                </dd>
              </div>
            </dl>
            <button
              type="button"
              disabled={bulkBusy || !bulkAssessmentId}
              onClick={() => void handleBulkCharge()}
              className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50 sm:w-fit"
            >
              {bulkBusy ? t('common.saving') : t('admin.bulkChargeAll')}
            </button>
            {bulkResult ? <p className="text-sm text-secondary sm:col-span-2">{bulkResult}</p> : null}
          </div>
        )}
      </div>
      </>
      )}

      {activeTab === 'operations' && (
      <div className={cardClass}>
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">{t('admin.capitalLedger')}</p>
        {ledger.length === 0 ? (
          <div className="mt-3"><AdminEmptyState title={t('admin.noCapitalLedger')} /></div>
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
                  <th className={adminTableCellClass}>{t('admin.assessmentTitle')}</th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((row) => (
                  <tr key={row.id} className={adminTableRowClass}>
                    <td className={`${adminTableCellClass} tabular-nums`}>{formatOwnerDate(row.created_at)}</td>
                    <td className="py-2 pr-3">{labelLedgerKind(row.kind, t)}</td>
                    <td className="py-2 pr-3 tabular-nums">{formatEur(Number(row.amount_eur), locale)}</td>
                    <td className="py-2 pr-3 text-secondary">{row.note ?? '—'}</td>
                    <td className={adminTableCellClass}>{row.assessment_id ? titles.get(row.assessment_id) ?? '—' : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </AdminTableShell>
          </div>
        )}
      </div>
      )}
    </div>
  );
}
