'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import {
  adminBtnPrimaryClass,
  adminBtnSecondaryClass,
  adminFieldClass,
} from '@/components/admin/AdminUi';
import {
  BUDGET_MODULE_KEY,
  budgetPlanRequiresZeroConfirmation,
  firstRunBudgetDraftPayload,
  parseFirstRunBudgetDraft,
  saveFirstRunProgress,
  type FirstRunBudgetDraft,
  type FirstRunState,
} from '@/lib/firstRun';
import {
  categoryLabel,
  moneyEur,
  type BudgetCategory,
  type BudgetLineRow,
  type BudgetYear,
} from '@/lib/budget';
import { ownerVisibleError } from '@/lib/ownerError';
import { useI18n } from '@/i18n/I18nProvider';

type UntypedRpc = {
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{
    data: unknown;
    error: { message: string } | null;
  }>;
};

function untyped(supabase: SupabaseClient<Database>): UntypedRpc {
  return supabase as unknown as UntypedRpc;
}

function isPublishedLike(status: string | null | undefined): boolean {
  return status === 'published' || status === 'adopted';
}

export function AdminFirstRunBudget({
  supabase,
  t,
  draft,
  busy,
  onBusy,
  onState,
  onContinue,
}: {
  supabase: SupabaseClient<Database>;
  t: (key: string) => string;
  draft: Record<string, unknown>;
  busy: boolean;
  onBusy: (v: boolean) => void;
  onState: (state: FirstRunState | null) => void;
  onContinue: (payload: FirstRunBudgetDraft) => Promise<void>;
}) {
  const { locale } = useI18n();
  const initial = useMemo(() => parseFirstRunBudgetDraft(draft), [draft]);
  const defaultYear = new Date().getFullYear();

  const [step, setStep] = useState<FirstRunBudgetDraft['step']>(initial.step);
  const [calendarYear, setCalendarYear] = useState(
    initial.calendarYear != null ? String(initial.calendarYear) : String(defaultYear),
  );
  const [yearId, setYearId] = useState<string | null>(initial.yearId);
  const [yearStatus, setYearStatus] = useState<string | null>(null);
  const [decisionNote, setDecisionNote] = useState(initial.decisionNote);
  const [zeroConfirmed, setZeroConfirmed] = useState(initial.zeroConfirmed);
  const [categories, setCategories] = useState<BudgetCategory[]>([]);
  const [lines, setLines] = useState<BudgetLineRow[]>([]);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [moduleReady, setModuleReady] = useState(false);

  const locked = isPublishedLike(yearStatus);

  const total = useMemo(() => {
    return Object.values(amounts).reduce((acc, raw) => {
      const n = Number(String(raw).replace(',', '.'));
      return acc + (Number.isFinite(n) ? n : 0);
    }, 0);
  }, [amounts]);

  const needsZeroConfirm = budgetPlanRequiresZeroConfirmation(total);

  const persistDraft = useCallback(
    async (next: FirstRunBudgetDraft) => {
      const state = await saveFirstRunProgress(supabase, {
        stage: 'budget',
        draft: firstRunBudgetDraftPayload(next),
      });
      onState(state);
      return state;
    },
    [onState, supabase],
  );

  const ensureModuleEnabled = useCallback(async () => {
    const { error } = await untyped(supabase).rpc('set_building_module_enabled', {
      p_module_key: BUDGET_MODULE_KEY,
      p_enabled: true,
    });
    if (error) throw error;
    setModuleReady(true);
  }, [supabase]);

  const loadCategories = useCallback(async () => {
    const { data, error } = await supabase.rpc('admin_list_budget_categories');
    if (error) throw error;
    const list = ((data as BudgetCategory[] | null) ?? [])
      .map((c) => ({ ...c, id: String(c.id) }))
      .filter((c) => c.active !== false);
    setCategories(list);
    return list;
  }, [supabase]);

  const loadYearByCalendar = useCallback(
    async (year: number): Promise<BudgetYear | null> => {
      const { data, error } = await supabase.rpc('admin_list_budget_years');
      if (error) throw error;
      const list = ((data as BudgetYear[] | null) ?? []).map((y) => ({
        ...y,
        id: String(y.id),
      }));
      return list.find((y) => Number(y.calendar_year) === year) ?? null;
    },
    [supabase],
  );

  const loadLines = useCallback(
    async (id: string, cats: BudgetCategory[]) => {
      const { data, error } = await supabase.rpc('admin_list_budget_lines', { p_year_id: id });
      if (error) throw error;
      const list = ((data as BudgetLineRow[] | null) ?? []).map((l) => ({
        ...l,
        id: String(l.id),
        year_id: String(l.year_id),
        category_id: String(l.category_id),
        planned_amount_eur: Number(l.planned_amount_eur),
      }));
      setLines(list);
      const map: Record<string, string> = {};
      for (const c of cats) {
        const row = list.find((l) => l.category_id === c.id);
        map[c.id] = row != null ? String(row.planned_amount_eur) : '0';
      }
      setAmounts(map);
      return list;
    },
    [supabase],
  );

  const bootstrap = useCallback(async () => {
    setLoadError(null);
    try {
      await ensureModuleEnabled();
      const cats = await loadCategories();
      if (initial.calendarYear != null) {
        const existing = await loadYearByCalendar(initial.calendarYear);
        if (existing) {
          setYearId(existing.id);
          setYearStatus(existing.status);
          if (existing.decision_note) setDecisionNote(existing.decision_note);
          await loadLines(existing.id, cats);
          if (isPublishedLike(existing.status)) {
            setStep('done');
          } else if (initial.step === 'year') {
            setStep('amounts');
          } else {
            setStep(initial.step);
          }
        }
      }
    } catch (e: unknown) {
      setLoadError(ownerVisibleError(e, t('admin.errGeneric')));
    }
  }, [
    ensureModuleEnabled,
    initial.calendarYear,
    initial.step,
    loadCategories,
    loadLines,
    loadYearByCalendar,
    t,
  ]);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  async function onSelectYear(e: React.FormEvent) {
    e.preventDefault();
    onBusy(true);
    setFormError(null);
    setNote(null);
    try {
      await ensureModuleEnabled();
      const year = Number(calendarYear);
      if (!Number.isInteger(year) || year < 2020 || year > 2100) {
        throw new Error(t('admin.firstRunBudgetYearInvalid'));
      }
      const cats = categories.length > 0 ? categories : await loadCategories();
      let existing = await loadYearByCalendar(year);
      if (existing?.status === 'closed') {
        throw new Error(t('admin.firstRunBudgetYearClosed'));
      }
      if (!existing) {
        const { data, error } = await supabase.rpc('admin_create_budget_year', {
          p_calendar_year: year,
          p_title: null,
        });
        if (error) {
          // Unique race / resume: reload list instead of duplicating.
          existing = await loadYearByCalendar(year);
          if (!existing) throw error;
        } else {
          existing = {
            ...(data as BudgetYear),
            id: String((data as BudgetYear).id),
          };
        }
      }
      if (existing.status === 'closed') {
        throw new Error(t('admin.firstRunBudgetYearClosed'));
      }
      setYearId(existing.id);
      setYearStatus(existing.status);
      if (existing.decision_note) setDecisionNote(String(existing.decision_note));
      await loadLines(existing.id, cats);
      const nextStep: FirstRunBudgetDraft['step'] = isPublishedLike(existing.status)
        ? 'done'
        : 'amounts';
      setStep(nextStep);
      await persistDraft({
        calendarYear: year,
        yearId: existing.id,
        decisionNote: decisionNote,
        zeroConfirmed: false,
        step: nextStep,
      });
      setZeroConfirmed(false);
      setNote(
        isPublishedLike(existing.status)
          ? t('admin.firstRunBudgetExistingPublished')
          : t('admin.firstRunBudgetYearReady'),
      );
    } catch (err: unknown) {
      setFormError(ownerVisibleError(err, t('admin.errGeneric')));
    } finally {
      onBusy(false);
    }
  }

  async function onSaveAmounts(e: React.FormEvent) {
    e.preventDefault();
    if (!yearId || locked) return;
    onBusy(true);
    setFormError(null);
    setNote(null);
    try {
      for (const cat of categories) {
        const raw = amounts[cat.id] ?? '0';
        const n = Number(String(raw).replace(',', '.'));
        if (!Number.isFinite(n) || n < 0) {
          throw new Error(t('admin.firstRunBudgetAmountInvalid'));
        }
        const { error } = await supabase.rpc('admin_upsert_budget_line', {
          p_year_id: yearId,
          p_category_id: cat.id,
          p_planned_amount_eur: n,
          p_note: null,
        });
        if (error) throw error;
      }
      await loadLines(yearId, categories);
      const next: FirstRunBudgetDraft = {
        calendarYear: Number(calendarYear),
        yearId,
        decisionNote,
        zeroConfirmed: false,
        step: 'review',
      };
      setZeroConfirmed(false);
      setStep('review');
      await persistDraft(next);
      setNote(t('admin.firstRunBudgetAmountsSaved'));
    } catch (err: unknown) {
      setFormError(ownerVisibleError(err, t('admin.errGeneric')));
    } finally {
      onBusy(false);
    }
  }

  async function onPublish() {
    if (!yearId) return;
    onBusy(true);
    setFormError(null);
    setNote(null);
    try {
      if (needsZeroConfirm && !zeroConfirmed) {
        throw new Error(t('admin.firstRunBudgetZeroRequired'));
      }
      const yearNum = Number(calendarYear);
      const draftPayload: FirstRunBudgetDraft = {
        calendarYear: yearNum,
        yearId,
        decisionNote,
        zeroConfirmed: needsZeroConfirm ? zeroConfirmed : false,
        step: 'review',
      };
      // Persist confirmation before publish so assert can read it.
      await persistDraft(draftPayload);

      if (!locked) {
        // First-run publishes the expense plan only. Adoption (GM decision) is a
        // separate admin action — never auto-adopt from the wizard note field.
        const { error: pubErr } = await supabase.rpc('admin_set_budget_year_status', {
          p_year_id: yearId,
          p_status: 'published',
          p_decision_note: null,
          p_decision_id: null,
        });
        if (pubErr) throw pubErr;
        setYearStatus('published');
      }

      const done: FirstRunBudgetDraft = {
        ...draftPayload,
        step: 'done',
        zeroConfirmed: needsZeroConfirm ? true : false,
      };
      setStep('done');
      await persistDraft(done);
      setNote(t('admin.firstRunBudgetPublished'));
    } catch (err: unknown) {
      setFormError(ownerVisibleError(err, t('admin.errGeneric')));
    } finally {
      onBusy(false);
    }
  }

  async function onFinishStage() {
    const yearNum = Number(calendarYear);
    await onContinue({
      calendarYear: yearNum,
      yearId,
      decisionNote,
      zeroConfirmed: needsZeroConfirm ? zeroConfirmed || locked : false,
      step: 'done',
    });
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-secondary">{t('admin.firstRunBudgetLead')}</p>
      <p className="text-xs text-muted">{t('admin.firstRunBudgetNoCharge')}</p>
      {moduleReady ? (
        <p className="text-xs text-secondary">{t('admin.firstRunBudgetModuleEnabled')}</p>
      ) : null}
      {loadError ? <p className="text-xs text-danger">{loadError}</p> : null}

      {step === 'year' ? (
        <form onSubmit={(e) => void onSelectYear(e)} className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-sm text-secondary">
            {t('admin.firstRunBudgetYear')}
            <input
              className={adminFieldClass}
              type="number"
              min={2020}
              max={2100}
              value={calendarYear}
              onChange={(e) => setCalendarYear(e.target.value)}
              required
            />
          </label>
          <div className="flex items-end">
            <button type="submit" className={adminBtnPrimaryClass} disabled={busy}>
              {busy ? t('admin.firstRunBusy') : t('admin.firstRunBudgetYearContinue')}
            </button>
          </div>
        </form>
      ) : null}

      {step === 'amounts' && !locked ? (
        <form onSubmit={(e) => void onSaveAmounts(e)} className="grid gap-3">
          <p className="text-sm font-semibold text-foreground">
            {t('admin.firstRunBudgetAmountsTitle').replace('{year}', calendarYear)}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {categories.map((cat) => (
              <label key={cat.id} className="grid gap-1 text-sm text-secondary">
                {categoryLabel(cat, locale)}
                <input
                  className={adminFieldClass}
                  type="number"
                  step="0.01"
                  min="0"
                  value={amounts[cat.id] ?? '0'}
                  onChange={(e) => setAmounts((m) => ({ ...m, [cat.id]: e.target.value }))}
                  required
                />
              </label>
            ))}
          </div>
          <label className="grid gap-1 text-sm text-secondary">
            {t('admin.firstRunBudgetBasisNote')}
            <input
              className={adminFieldClass}
              value={decisionNote}
              onChange={(e) => setDecisionNote(e.target.value)}
              placeholder={t('admin.firstRunBudgetBasisNotePh')}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="submit" className={adminBtnPrimaryClass} disabled={busy}>
              {busy ? t('admin.firstRunBusy') : t('admin.firstRunBudgetReviewContinue')}
            </button>
            <button
              type="button"
              className={adminBtnSecondaryClass}
              disabled={busy}
              onClick={() => setStep('year')}
            >
              {t('admin.firstRunBudgetBackYear')}
            </button>
          </div>
        </form>
      ) : null}

      {(step === 'review' || step === 'done' || locked) && yearId ? (
        <div className="space-y-3 border-t border-border pt-4">
          <p className="text-sm font-semibold text-foreground">
            {t('admin.firstRunBudgetReviewTitle').replace('{year}', calendarYear)}
          </p>
          <ul className="grid gap-1 text-sm text-secondary">
            {categories.map((cat) => (
              <li key={cat.id} className="flex justify-between gap-3">
                <span>{categoryLabel(cat, locale)}</span>
                <span>{moneyEur(Number(amounts[cat.id] ?? 0))}</span>
              </li>
            ))}
          </ul>
          <p className="text-sm font-medium text-foreground">
            {t('admin.firstRunBudgetTotal').replace('{total}', moneyEur(total))}
          </p>
          {decisionNote.trim() ? (
            <p className="text-xs text-secondary">
              {t('admin.firstRunBudgetBasisNote')}: {decisionNote.trim()}
            </p>
          ) : null}
          {yearStatus ? (
            <p className="text-xs text-secondary">
              {t('admin.firstRunBudgetStatus')}: {yearStatus}
            </p>
          ) : null}

          {needsZeroConfirm && !locked ? (
            <label className="flex items-start gap-2 text-sm text-secondary">
              <input
                type="checkbox"
                className="mt-1"
                checked={zeroConfirmed}
                onChange={(e) => setZeroConfirmed(e.target.checked)}
              />
              <span>{t('admin.firstRunBudgetZeroConfirm')}</span>
            </label>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {!locked ? (
              <>
                <button
                  type="button"
                  className={adminBtnPrimaryClass}
                  disabled={busy || (needsZeroConfirm && !zeroConfirmed)}
                  onClick={() => void onPublish()}
                >
                  {busy ? t('admin.firstRunBusy') : t('admin.firstRunBudgetPublish')}
                </button>
                <button
                  type="button"
                  className={adminBtnSecondaryClass}
                  disabled={busy}
                  onClick={() => setStep('amounts')}
                >
                  {t('admin.firstRunBudgetBackAmounts')}
                </button>
              </>
            ) : (
              <button
                type="button"
                className={adminBtnPrimaryClass}
                disabled={busy}
                onClick={() => void onFinishStage()}
              >
                {busy ? t('admin.firstRunBusy') : t('admin.firstRunBudgetContinue')}
              </button>
            )}
          </div>
          {locked && lines.length === 0 ? (
            <p className="text-xs text-muted">{t('admin.firstRunBudgetExistingPublished')}</p>
          ) : null}
        </div>
      ) : null}

      {formError ? <p className="text-xs text-danger">{formError}</p> : null}
      {note ? <p className="text-xs text-secondary">{note}</p> : null}
    </div>
  );
}
