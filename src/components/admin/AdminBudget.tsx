'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { useI18n } from '@/i18n/I18nProvider';
import { ownerVisibleError } from '@/lib/ownerError';
import { isMissingRelation } from '@/lib/polls';
import {
  budgetStatusTone,
  canSeeBudgetAdmin,
  categoryLabel,
  moneyEur,
  type BudgetAdjustment,
  type BudgetCategory,
  type BudgetExecutionRow,
  type BudgetLineRow,
  type BudgetYear,
} from '@/lib/budget';
import {
  AdminPageHeader,
  AdminEmptyState,
  AdminInlineAlert,
  AdminPrimaryButton,
  AdminSecondaryButton,
  AdminTableShell,
  adminCardClass,
  adminFieldClass,
  adminTableCellClass,
  adminTableHeadRowClass,
  adminTableRowClass,
} from '@/components/admin/AdminUi';
import { StatusBadge } from '@/components/account/ownerUi';

export function AdminBudget({
  supabase,
  staffRole,
}: {
  supabase: SupabaseClient<Database>;
  staffRole: string;
}) {
  const { t, locale } = useI18n();
  const canSee = canSeeBudgetAdmin(staffRole);

  const [years, setYears] = useState<BudgetYear[]>([]);
  const [categories, setCategories] = useState<BudgetCategory[]>([]);
  const [selectedYearId, setSelectedYearId] = useState<string>('');
  const [lines, setLines] = useState<BudgetLineRow[]>([]);
  const [execution, setExecution] = useState<BudgetExecutionRow[]>([]);
  const [adjustments, setAdjustments] = useState<BudgetAdjustment[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [newYear, setNewYear] = useState(String(new Date().getFullYear() + 1));
  const [decisionNote, setDecisionNote] = useState('');
  const [adjCategoryId, setAdjCategoryId] = useState('');
  const [adjAmount, setAdjAmount] = useState('');
  const [adjReason, setAdjReason] = useState('');

  const selectedYear = useMemo(
    () => years.find((y) => y.id === selectedYearId) ?? null,
    [years, selectedYearId],
  );

  const statusLabel = useCallback(
    (s: string) => {
      const key = `admin.budgetStatus_${s}` as const;
      const v = t(key);
      return v === key ? s : v;
    },
    [t],
  );

  const loadYears = useCallback(async () => {
    const { data, error: rpcErr } = await supabase.rpc('admin_list_budget_years');
    if (rpcErr) {
      if (isMissingRelation(rpcErr, 'admin_list_budget_years')) {
        setYears([]);
        setError(t('admin.budgetMigrationNeeded'));
        return;
      }
      throw rpcErr;
    }
    const list = ((data as BudgetYear[] | null) ?? []).map((y) => ({
      ...y,
      id: String(y.id),
      decision_id: y.decision_id != null ? String(y.decision_id) : null,
    }));
    setYears(list);
    if (!selectedYearId && list.length > 0) {
      setSelectedYearId(list[0].id);
    }
  }, [selectedYearId, supabase, t]);

  const loadDetail = useCallback(async (yearId: string) => {
    if (!yearId) {
      setLines([]);
      setExecution([]);
      setAdjustments([]);
      return;
    }
    const [linesRes, execRes, adjRes] = await Promise.all([
      supabase.rpc('admin_list_budget_lines', { p_year_id: yearId }),
      supabase.rpc('admin_budget_execution', { p_year_id: yearId }),
      supabase.rpc('admin_list_budget_adjustments', { p_year_id: yearId }),
    ]);
    if (linesRes.error) throw linesRes.error;
    if (execRes.error) throw execRes.error;
    if (adjRes.error && !isMissingRelation(adjRes.error, 'admin_list_budget_adjustments')) {
      throw adjRes.error;
    }
    setLines(
      ((linesRes.data as BudgetLineRow[] | null) ?? []).map((l) => ({
        ...l,
        id: String(l.id),
        year_id: String(l.year_id),
        category_id: String(l.category_id),
        planned_amount_eur: Number(l.planned_amount_eur),
      })),
    );
    setExecution(
      ((execRes.data as BudgetExecutionRow[] | null) ?? []).map((r) => ({
        ...r,
        category_id: String(r.category_id),
        planned_amount_eur: Number(r.planned_amount_eur),
        expenses_amount_eur: Number(r.expenses_amount_eur ?? 0),
        adjustments_amount_eur: Number(r.adjustments_amount_eur ?? 0),
        actual_amount_eur: Number(r.actual_amount_eur),
        remaining_amount_eur: Number(r.remaining_amount_eur),
      })),
    );
    setAdjustments(
      ((adjRes.data as BudgetAdjustment[] | null) ?? []).map((a) => ({
        ...a,
        id: String(a.id),
        year_id: String(a.year_id),
        category_id: String(a.category_id),
        amount_eur: Number(a.amount_eur),
      })),
    );
  }, [supabase]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const catRes = await supabase.rpc('admin_list_budget_categories');
      if (catRes.error) {
        if (isMissingRelation(catRes.error, 'admin_list_budget_categories')) {
          setError(t('admin.budgetMigrationNeeded'));
          setCategories([]);
          return;
        }
        throw catRes.error;
      }
      setCategories(
        ((catRes.data as BudgetCategory[] | null) ?? []).map((c) => ({
          ...c,
          id: String(c.id),
        })),
      );
      await loadYears();
    } catch (e: unknown) {
      setError(ownerVisibleError(e, t('admin.errGeneric')));
    } finally {
      setLoading(false);
    }
  }, [loadYears, supabase, t]);

  useEffect(() => {
    if (canSee) void load();
  }, [canSee, load]);

  useEffect(() => {
    if (!selectedYearId) return;
    void (async () => {
      try {
        await loadDetail(selectedYearId);
      } catch (e: unknown) {
        setError(ownerVisibleError(e, t('admin.errGeneric')));
      }
    })();
  }, [loadDetail, selectedYearId, t]);

  useEffect(() => {
    if (!adjCategoryId && categories.length > 0) {
      setAdjCategoryId(categories[0].id);
    }
  }, [adjCategoryId, categories]);

  const totals = useMemo(() => {
    const planned = execution.reduce((s, r) => s + Number(r.planned_amount_eur), 0);
    const actual = execution.reduce((s, r) => s + Number(r.actual_amount_eur), 0);
    return { planned, actual, remaining: planned - actual };
  }, [execution]);

  async function createYear() {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const y = Number(newYear);
      const { data, error: rpcErr } = await supabase.rpc('admin_create_budget_year', {
        p_calendar_year: y,
        p_title: null,
      });
      if (rpcErr) throw rpcErr;
      setSuccess(t('admin.budgetYearCreated'));
      const id = String((data as { id?: string })?.id ?? '');
      await loadYears();
      if (id) setSelectedYearId(id);
    } catch (e: unknown) {
      setError(ownerVisibleError(e, t('admin.errGeneric')));
    } finally {
      setBusy(false);
    }
  }

  async function saveLine(categoryId: string, amount: string, note: string | null) {
    if (!selectedYearId || selectedYear?.status !== 'draft') return;
    setBusy(true);
    setError(null);
    try {
      const { error: rpcErr } = await supabase.rpc('admin_upsert_budget_line', {
        p_year_id: selectedYearId,
        p_category_id: categoryId,
        p_planned_amount_eur: Number(amount) || 0,
        p_note: note,
      });
      if (rpcErr) throw rpcErr;
      await loadDetail(selectedYearId);
      setSuccess(t('admin.budgetLineSaved'));
    } catch (e: unknown) {
      setError(ownerVisibleError(e, t('admin.errGeneric')));
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(status: string) {
    if (!selectedYearId) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const { error: rpcErr } = await supabase.rpc('admin_set_budget_year_status', {
        p_year_id: selectedYearId,
        p_status: status,
        p_decision_note: status === 'adopted' ? decisionNote.trim() || null : null,
        p_decision_id: null,
      });
      if (rpcErr) throw rpcErr;
      setSuccess(t('admin.budgetStatusUpdated'));
      await loadYears();
      await loadDetail(selectedYearId);
    } catch (e: unknown) {
      setError(ownerVisibleError(e, t('admin.errGeneric')));
    } finally {
      setBusy(false);
    }
  }

  async function createAdjustment() {
    if (!selectedYearId || !adjCategoryId) return;
    setBusy(true);
    setError(null);
    try {
      const { error: rpcErr } = await supabase.rpc('admin_create_budget_adjustment', {
        p_year_id: selectedYearId,
        p_category_id: adjCategoryId,
        p_amount_eur: Number(adjAmount),
        p_reason: adjReason.trim(),
      });
      if (rpcErr) throw rpcErr;
      setAdjAmount('');
      setAdjReason('');
      setSuccess(t('admin.budgetAdjCreated'));
      await loadDetail(selectedYearId);
    } catch (e: unknown) {
      setError(ownerVisibleError(e, t('admin.errGeneric')));
    } finally {
      setBusy(false);
    }
  }

  if (!canSee) {
    return (
      <div className="space-y-4">
        <AdminPageHeader title={t('admin.budget')} secondary={t('admin.budgetLead')} />
        <AdminInlineAlert tone="warning">{t('admin.errNoAccess')}</AdminInlineAlert>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <AdminPageHeader title={t('admin.budget')} secondary={t('admin.budgetLead')} />
      {error ? <AdminInlineAlert tone="danger">{error}</AdminInlineAlert> : null}
      {success ? <AdminInlineAlert tone="success">{success}</AdminInlineAlert> : null}

      <section className={`${adminCardClass} space-y-3 p-4`}>
        <h3 className="text-sm font-semibold">{t('admin.budgetYears')}</h3>
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1 text-xs text-secondary">
            {t('admin.budgetNewYear')}
            <input
              className={adminFieldClass}
              type="number"
              value={newYear}
              onChange={(e) => setNewYear(e.target.value)}
            />
          </label>
          <AdminPrimaryButton type="button" disabled={busy} onClick={() => void createYear()}>
            {t('admin.budgetCreateYear')}
          </AdminPrimaryButton>
          <label className="grid gap-1 text-xs text-secondary">
            {t('admin.budgetSelectYear')}
            <select
              className={adminFieldClass}
              value={selectedYearId}
              onChange={(e) => setSelectedYearId(e.target.value)}
            >
              <option value="">{t('admin.budgetSelectYear')}</option>
              {years.map((y) => (
                <option key={y.id} value={y.id}>
                  {y.calendar_year} · {statusLabel(y.status)}
                </option>
              ))}
            </select>
          </label>
          <AdminSecondaryButton type="button" disabled={busy || loading} onClick={() => void load()}>
            {t('admin.secRefresh')}
          </AdminSecondaryButton>
        </div>
      </section>

      {loading ? (
        <p className="text-sm text-muted">{t('common.loading')}</p>
      ) : !selectedYear ? (
        <AdminEmptyState title={t('admin.budgetEmpty')} />
      ) : (
        <>
          <section className={`${adminCardClass} space-y-3 p-4`}>
            <div className="flex flex-wrap items-center gap-3">
              <h3 className="text-base font-semibold">
                {t('admin.budgetYearTitle', { y: String(selectedYear.calendar_year) })}
              </h3>
              <StatusBadge
                label={statusLabel(selectedYear.status)}
                tone={budgetStatusTone(selectedYear.status)}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              {selectedYear.status === 'draft' ? (
                <AdminPrimaryButton type="button" disabled={busy} onClick={() => void setStatus('published')}>
                  {t('admin.budgetPublish')}
                </AdminPrimaryButton>
              ) : null}
              {selectedYear.status === 'published' ? (
                <>
                  <AdminSecondaryButton type="button" disabled={busy} onClick={() => void setStatus('draft')}>
                    {t('admin.budgetReopen')}
                  </AdminSecondaryButton>
                  <label className="grid min-w-[12rem] flex-1 gap-1 text-xs text-secondary">
                    {t('admin.budgetDecisionNote')}
                    <input
                      className={adminFieldClass}
                      value={decisionNote}
                      onChange={(e) => setDecisionNote(e.target.value)}
                      placeholder={t('admin.budgetDecisionNotePh')}
                    />
                  </label>
                  <AdminPrimaryButton type="button" disabled={busy} onClick={() => void setStatus('adopted')}>
                    {t('admin.budgetAdopt')}
                  </AdminPrimaryButton>
                </>
              ) : null}
              {selectedYear.status === 'adopted' ? (
                <AdminSecondaryButton type="button" disabled={busy} onClick={() => void setStatus('closed')}>
                  {t('admin.budgetClose')}
                </AdminSecondaryButton>
              ) : null}
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold">{t('admin.budgetLines')}</h3>
            <AdminTableShell>
              <table className="w-full min-w-[40rem] text-sm">
                <thead>
                  <tr className={adminTableHeadRowClass}>
                    <th className={adminTableCellClass}>{t('admin.budgetCategory')}</th>
                    <th className={adminTableCellClass}>{t('admin.budgetPlanned')}</th>
                    <th className={adminTableCellClass} />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) => (
                    <BudgetLineEditor
                      key={line.id}
                      line={line}
                      editable={selectedYear.status === 'draft'}
                      busy={busy}
                      onSave={(amount, note) => void saveLine(line.category_id, amount, note)}
                      saveLabel={t('common.save')}
                    />
                  ))}
                </tbody>
              </table>
            </AdminTableShell>
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold">{t('admin.budgetExecution')}</h3>
            <p className="text-xs text-secondary">
              {t('admin.budgetTotals', {
                p: moneyEur(totals.planned),
                a: moneyEur(totals.actual),
                r: moneyEur(totals.remaining),
              })}
            </p>
            <AdminTableShell>
              <table className="w-full min-w-[48rem] text-sm">
                <thead>
                  <tr className={adminTableHeadRowClass}>
                    <th className={adminTableCellClass}>{t('admin.budgetCategory')}</th>
                    <th className={adminTableCellClass}>{t('admin.budgetPlanned')}</th>
                    <th className={adminTableCellClass}>{t('admin.budgetExpenses')}</th>
                    <th className={adminTableCellClass}>{t('admin.budgetAdjustments')}</th>
                    <th className={adminTableCellClass}>{t('admin.budgetActual')}</th>
                    <th className={adminTableCellClass}>{t('admin.budgetRemaining')}</th>
                  </tr>
                </thead>
                <tbody>
                  {execution.map((row) => (
                    <tr key={row.category_id} className={adminTableRowClass}>
                      <td className={adminTableCellClass}>{row.category_name_ru}</td>
                      <td className={adminTableCellClass}>{moneyEur(row.planned_amount_eur)}</td>
                      <td className={adminTableCellClass}>{moneyEur(row.expenses_amount_eur)}</td>
                      <td className={adminTableCellClass}>{moneyEur(row.adjustments_amount_eur)}</td>
                      <td className={adminTableCellClass}>{moneyEur(row.actual_amount_eur)}</td>
                      <td className={adminTableCellClass}>{moneyEur(row.remaining_amount_eur)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </AdminTableShell>
          </section>

          {(selectedYear.status === 'published' || selectedYear.status === 'adopted') && (
            <section className={`${adminCardClass} space-y-3 p-4`}>
              <h3 className="text-sm font-semibold">{t('admin.budgetAdjTitle')}</h3>
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="grid gap-1 text-xs text-secondary">
                  {t('admin.budgetCategory')}
                  <select
                    className={adminFieldClass}
                    value={adjCategoryId}
                    onChange={(e) => setAdjCategoryId(e.target.value)}
                  >
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {categoryLabel(c, locale)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1 text-xs text-secondary">
                  {t('admin.budgetAdjAmount')}
                  <input
                    className={adminFieldClass}
                    type="number"
                    step="0.01"
                    value={adjAmount}
                    onChange={(e) => setAdjAmount(e.target.value)}
                  />
                </label>
                <label className="grid gap-1 text-xs text-secondary">
                  {t('admin.budgetAdjReason')}
                  <input
                    className={adminFieldClass}
                    value={adjReason}
                    onChange={(e) => setAdjReason(e.target.value)}
                  />
                </label>
              </div>
              <AdminPrimaryButton
                type="button"
                disabled={busy || !adjReason.trim() || !adjAmount}
                onClick={() => void createAdjustment()}
              >
                {t('admin.budgetAdjCreate')}
              </AdminPrimaryButton>
              {adjustments.length > 0 ? (
                <ul className="space-y-1 text-xs text-secondary">
                  {adjustments.slice(0, 20).map((a) => (
                    <li key={a.id}>
                      {moneyEur(a.amount_eur)} · {a.reason}
                      {a.created_by_email ? ` · ${a.created_by_email}` : ''}
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          )}
        </>
      )}
    </div>
  );
}

function BudgetLineEditor({
  line,
  editable,
  busy,
  onSave,
  saveLabel,
}: {
  line: BudgetLineRow;
  editable: boolean;
  busy: boolean;
  onSave: (amount: string, note: string | null) => void;
  saveLabel: string;
}) {
  const [amount, setAmount] = useState(String(line.planned_amount_eur));
  const [note, setNote] = useState(line.note ?? '');

  useEffect(() => {
    setAmount(String(line.planned_amount_eur));
    setNote(line.note ?? '');
  }, [line.note, line.planned_amount_eur]);

  return (
    <tr className={adminTableRowClass}>
      <td className={adminTableCellClass}>{line.category_name_ru}</td>
      <td className={adminTableCellClass}>
        {editable ? (
          <input
            className={adminFieldClass}
            type="number"
            step="0.01"
            min="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        ) : (
          moneyEur(line.planned_amount_eur)
        )}
      </td>
      <td className={adminTableCellClass}>
        {editable ? (
          <div className="flex flex-wrap items-center gap-2">
            <input
              className={`${adminFieldClass} min-w-[8rem]`}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <button
              type="button"
              className="text-xs text-accent hover:underline"
              disabled={busy}
              onClick={() => onSave(amount, note.trim() || null)}
            >
              {saveLabel}
            </button>
          </div>
        ) : (
          line.note || '—'
        )}
      </td>
    </tr>
  );
}
