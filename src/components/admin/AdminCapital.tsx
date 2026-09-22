'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { useI18n } from '@/i18n/I18nProvider';
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

type PropertyOption = {
  id: number;
  apartment_number: string | number | null;
  owner_name: string | null;
};

function aptNumber(value: string | number | null | undefined) {
  return String(value ?? '');
}

const fieldClass =
  'w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-placeholder';
const cardClass = 'rounded-[14px] border border-border bg-surface p-5 shadow-card';

function firstRow<T>(data: T[] | T | null | undefined): T | null {
  if (!data) return null;
  return Array.isArray(data) ? (data[0] ?? null) : data;
}

function ledgerKindLabel(kind: string, t: (path: string) => string) {
  if (kind === 'charge') return t('admin.kindCharge');
  if (kind === 'payment') return t('admin.kindPayment');
  if (kind === 'adjustment_debit') return t('admin.kindAdjDebit');
  if (kind === 'adjustment_credit') return t('admin.kindAdjCredit');
  return kind;
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
  const { t, dateLocale } = useI18n();
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

  const chargeKeyRef = useRef(crypto.randomUUID());
  const payKeyRef = useRef(crypto.randomUUID());

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
      <div className={cardClass}>
        <h2 className="text-lg font-semibold text-accent">{t('admin.capital')}</h2>
        <p className="mt-1 text-sm text-secondary">{t('admin.capitalLead')}</p>
        <label className="mt-4 block text-xs text-muted">{t('admin.pickProperty')}</label>
        <select
          className={`${fieldClass} mt-1 max-w-xl`}
          value={propertyId === '' ? '' : String(propertyId)}
          onChange={(e) => {
            setPropertyId(e.target.value ? Number(e.target.value) : '');
            setError(null);
            setSuccess(null);
          }}
        >
          {sorted.length === 0 && <option value="">{t('form.pickApt')}</option>}
          {sorted.map((p) => (
            <option key={p.id} value={p.id}>
              {t('form.aptOwner', { n: aptNumber(p.apartment_number), owner: p.owner_name ?? '—' })}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <div className="rounded-xl border border-danger/25 bg-danger-bg px-4 py-3 text-sm text-danger">{error}</div>
      )}
      {success && (
        <div className="rounded-xl border border-success/25 bg-success-bg px-4 py-3 text-sm text-success">{success}</div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className={cardClass}>
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">{t('admin.capitalBalance')}</p>
          {propLoading ? (
            <p className="mt-3 text-sm text-muted">{t('common.loading')}</p>
          ) : (
            <>
              <p className={`mt-2 text-2xl font-semibold ${tone === 'debt' ? 'text-danger' : tone === 'over' ? 'text-success' : 'text-foreground'}`}>
                {formatEur(Math.abs(balance.balance_eur))}
              </p>
              <p className="text-sm text-secondary">{statusLabel}</p>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                <dt className="text-muted">{t('admin.charged')}</dt>
                <dd className="tabular-nums">{formatEur(balance.charged_eur)}</dd>
                <dt className="text-muted">{t('admin.paid')}</dt>
                <dd className="tabular-nums">{formatEur(balance.paid_eur)}</dd>
                <dt className="text-muted">{t('admin.adjDebit')}</dt>
                <dd className="tabular-nums">{formatEur(balance.adjustments_debit_eur)}</dd>
                <dt className="text-muted">{t('admin.adjCredit')}</dt>
                <dd className="tabular-nums">{formatEur(balance.adjustments_credit_eur)}</dd>
              </dl>
            </>
          )}
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
          <p className="mt-3 text-sm text-secondary">{t('admin.noAssessments')}</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[36rem] text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="py-2 pr-3">{t('admin.assessmentTitle')}</th>
                  <th className="py-2 pr-3">{t('admin.assessmentDesc')}</th>
                  <th className="py-2 pr-3">{t('admin.decisionDate')}</th>
                  <th className="py-2 pr-3">{t('admin.dueDate')}</th>
                  <th className="py-2 pr-3">{t('admin.status')}</th>
                  <th className="py-2 pr-3">{t('admin.createdAt')}</th>
                </tr>
              </thead>
              <tbody>
                {assessments.map((row) => (
                  <tr
                    key={row.id}
                    className={`border-t border-border ${row.status === 'active' ? 'bg-accent-bg/40' : ''}`}
                  >
                    <td className="py-2 pr-3 font-medium">{row.title}</td>
                    <td className="py-2 pr-3 text-secondary">{row.description ?? '—'}</td>
                    <td className="py-2 pr-3 tabular-nums">{row.decision_date ?? '—'}</td>
                    <td className="py-2 pr-3 tabular-nums">{row.due_date ?? '—'}</td>
                    <td className="py-2 pr-3">{row.status}</td>
                    <td className="py-2 pr-3 tabular-nums">{new Date(row.created_at).toLocaleDateString(dateLocale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
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
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">{t('admin.capitalLedger')}</p>
        {ledger.length === 0 ? (
          <p className="mt-3 text-sm text-secondary">{t('admin.noCapitalLedger')}</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[32rem] text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="py-2 pr-3">{t('admin.date')}</th>
                  <th className="py-2 pr-3">{t('admin.kind')}</th>
                  <th className="py-2 pr-3">{t('admin.amount')}</th>
                  <th className="py-2 pr-3">{t('admin.note')}</th>
                  <th className="py-2 pr-3">{t('admin.assessmentTitle')}</th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((row) => (
                  <tr key={row.id} className="border-t border-border">
                    <td className="py-2 pr-3 tabular-nums">{new Date(row.created_at).toLocaleDateString(dateLocale)}</td>
                    <td className="py-2 pr-3">{ledgerKindLabel(row.kind, t)}</td>
                    <td className="py-2 pr-3 tabular-nums">{formatEur(Number(row.amount_eur))}</td>
                    <td className="py-2 pr-3 text-secondary">{row.note ?? '—'}</td>
                    <td className="py-2 pr-3">{row.assessment_id ? titles.get(row.assessment_id) ?? '—' : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
