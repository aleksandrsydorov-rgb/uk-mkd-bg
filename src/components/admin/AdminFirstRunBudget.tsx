'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { Wallet } from 'lucide-react';
import { FirstRunStageActions } from '@/components/admin/FirstRunFrame';
import { FirstRunScreen } from '@/components/admin/FirstRunSteps';
import styles from './FirstRunFrame.module.css';
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
import { budgetYearStatusLabel } from '@/lib/firstRunUserMessage';
import { toUserFacingMessage } from '@/lib/userFacingError';
import { FirstRunErrorNote } from '@/components/admin/FirstRunFinance';
import { FirstRunStatusBanner, FirstRunStatusStack } from '@/components/admin/FirstRunStatusBanner';
import { AppFilePicker } from '@/components/ui/AppFilePicker';
import { useI18n } from '@/i18n/I18nProvider';
import { BUDGET_PLAN_IMPORT_SPEC, localizedTemplateFileName } from '@/lib/importTemplates';
import {
  buildBudgetPlanTemplateBuffer,
  enrichBudgetPreviewWithExisting,
  presentBudgetPreviewAction,
  readBudgetPlanWorkbook,
  type BudgetPlanIssue,
  type BudgetPlanParse,
} from '@/lib/budgetPlanImport';

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

export type FirstRunBudgetNavHandle = {
  /** true when Back stayed inside budget sub-steps. */
  handleBack: () => boolean;
  persistDraft: () => Promise<boolean>;
};

export function AdminFirstRunBudget({
  supabase,
  t,
  draft,
  busy,
  onBusy,
  onState,
  onContinue,
  onNavHandle,
}: {
  supabase: SupabaseClient<Database>;
  t: (key: string) => string;
  draft: Record<string, unknown>;
  busy: boolean;
  onBusy: (v: boolean) => void;
  onState: (state: FirstRunState | null) => void;
  onContinue: (payload: FirstRunBudgetDraft) => Promise<void>;
  onNavHandle?: (handle: FirstRunBudgetNavHandle | null) => void;
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
  const [planCategories, setPlanCategories] = useState<BudgetCategory[]>([]);
  const [importIssues, setImportIssues] = useState<BudgetPlanIssue[]>([]);
  const [importPreview, setImportPreview] = useState<BudgetPlanParse | null>(null);
  const [importNote, setImportNote] = useState<string | null>(null);
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

  const currentDraft = useCallback((): FirstRunBudgetDraft => {
    const yearNum = Number(calendarYear);
    return {
      step: locked ? 'done' : step,
      calendarYear: Number.isFinite(yearNum) ? yearNum : null,
      yearId,
      decisionNote,
      zeroConfirmed,
    };
  }, [calendarYear, decisionNote, locked, step, yearId, zeroConfirmed]);

  useEffect(() => {
    if (!onNavHandle) return;
    onNavHandle({
      handleBack: () => {
        if (locked || step === 'year' || step === 'done') return false;
        if (step === 'review') {
          setStep('amounts');
          return true;
        }
        if (step === 'amounts') {
          setStep('year');
          return true;
        }
        return false;
      },
      persistDraft: async () => {
        try {
          await persistDraft(currentDraft());
          return true;
        } catch {
          return false;
        }
      },
    });
    return () => onNavHandle(null);
  }, [currentDraft, locked, onNavHandle, persistDraft, step]);

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

  const seedAmountsForCategories = useCallback(
    (cats: BudgetCategory[], prior: Record<string, string> = {}) => {
      const map: Record<string, string> = {};
      for (const cat of cats) {
        map[cat.id] = prior[cat.id] ?? '0';
      }
      setPlanCategories(cats);
      setAmounts(map);
      return map;
    },
    [],
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
      const prior: Record<string, string> = {};
      for (const line of list) prior[line.category_id] = String(line.planned_amount_eur);
      // Always edit the full active catalogue so publish never hits "no lines"
      // when the operator only confirms a zero plan without prior import.
      const planned =
        cats.length > 0
          ? cats
          : list.map((line) => {
              const known = cats.find((cat) => cat.id === line.category_id);
              return (
                known ?? {
                  id: line.category_id,
                  code: line.category_code,
                  name_ru: line.category_name_ru,
                  name_en: line.category_name_ru,
                  name_bg: line.category_name_ru,
                }
              );
            });
      seedAmountsForCategories(planned, prior);
      return list;
    },
    [seedAmountsForCategories, supabase],
  );

  const commitPlanFromAmounts = useCallback(
    async (yearNum: number, cats: BudgetCategory[]) => {
      if (cats.length === 0) {
        throw new Error(t('admin.firstRunErrBudgetLines'));
      }
      const rows: Array<{ row: number; code: string; name: string; amount: string }> = [];
      for (let i = 0; i < cats.length; i += 1) {
        const cat = cats[i]!;
        const raw = amounts[cat.id] ?? '0';
        const n = Number(String(raw).replace(',', '.'));
        if (!Number.isFinite(n) || n < 0) {
          throw new Error(t('admin.firstRunBudgetAmountInvalid'));
        }
        rows.push({
          row: i + 1,
          code: cat.code,
          name: cat.name_ru || cat.name_en || cat.name_bg || cat.code,
          amount: n.toFixed(2),
        });
      }
      const { data, error } = await untyped(supabase).rpc('admin_commit_budget_plan', {
        p_calendar_year: yearNum,
        p_rows: rows,
      });
      if (error) throw error;
      return data;
    },
    [amounts, supabase, t],
  );

  const presentFormError = useCallback(
    (err: unknown) =>
      toUserFacingMessage(err, t, { context: 'first_run', fallback: t('admin.errGeneric') }),
    [t],
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
      setLoadError(presentFormError(e));
    }
  }, [
    ensureModuleEnabled,
    initial.calendarYear,
    initial.step,
    loadCategories,
    loadLines,
    loadYearByCalendar,
    presentFormError,
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
      const existing = await loadYearByCalendar(year);
      if (existing?.status === 'closed') {
        throw new Error(t('admin.firstRunBudgetYearClosed'));
      }
      setYearId(existing?.id ?? null);
      setYearStatus(existing?.status ?? 'draft');
      if (existing?.decision_note) setDecisionNote(String(existing.decision_note));
      if (existing) await loadLines(existing.id, cats);
      else {
        setLines([]);
        seedAmountsForCategories(cats);
      }
      const nextStep: FirstRunBudgetDraft['step'] = isPublishedLike(existing?.status)
        ? 'done'
        : 'amounts';
      setStep(nextStep);
      await persistDraft({
        calendarYear: year,
        yearId: existing?.id ?? null,
        decisionNote: decisionNote,
        zeroConfirmed: false,
        step: nextStep,
      });
      setZeroConfirmed(false);
      setNote(
        isPublishedLike(existing?.status)
          ? t('admin.firstRunBudgetExistingPublished')
          : t('admin.firstRunBudgetYearReady'),
      );
    } catch (err: unknown) {
      setFormError(presentFormError(err));
    } finally {
      onBusy(false);
    }
  }

  async function onSaveAmounts(e: React.FormEvent) {
    e.preventDefault();
    if (locked) return;
    onBusy(true);
    setFormError(null);
    setNote(null);
    try {
      const yearNum = Number(calendarYear);
      const cats = (categories.length > 0 ? categories : await loadCategories()).slice();
      if (cats.length === 0) throw new Error(t('admin.firstRunErrBudgetLines'));
      // Atomic draft write: all active categories in one RPC (no partial upserts).
      await commitPlanFromAmounts(yearNum, cats);
      const existing = await loadYearByCalendar(yearNum);
      if (!existing) throw new Error(t('admin.firstRunErrBudgetLines'));
      setYearId(existing.id);
      setYearStatus(existing.status);
      await loadLines(existing.id, cats);
      const next: FirstRunBudgetDraft = {
        calendarYear: yearNum,
        yearId: existing.id,
        decisionNote,
        zeroConfirmed: false,
        step: 'review',
      };
      setZeroConfirmed(false);
      setStep('review');
      await persistDraft(next);
      setNote(t('admin.firstRunBudgetAmountsSaved'));
    } catch (err: unknown) {
      setFormError(presentFormError(err));
    } finally {
      onBusy(false);
    }
  }

  function issueReasonText(issue: Pick<BudgetPlanIssue, 'reason' | 'raw'>): string {
    return t(`admin.firstRunBudgetImport_${issue.reason}`).replace(
      '{value}',
      issue.raw != null && String(issue.raw).trim() !== '' ? String(issue.raw) : '—',
    );
  }

  function issueText(issue: BudgetPlanIssue): string {
    const row = t('admin.firstRunBudgetImportRow').replace('{row}', String(issue.row));
    const reason = issueReasonText(issue);
    return `${row}: ${reason}`;
  }

  function downloadTemplate() {
    const bytes = buildBudgetPlanTemplateBuffer(locale);
    const blob = new Blob([bytes], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = localizedTemplateFileName(BUDGET_PLAN_IMPORT_SPEC, locale);
    link.click();
    URL.revokeObjectURL(url);
  }

  async function onPickPlanFile(file: File) {
    setFormError(null);
    setImportNote(null);
    const parsed = readBudgetPlanWorkbook(await file.arrayBuffer());
    const existingByCode = new Map<string, number>();
    for (const line of lines) {
      const code = String(line.category_code ?? '').trim().toLowerCase();
      if (code) existingByCode.set(code, Number(line.planned_amount_eur) || 0);
    }
    // Also map via planCategories id → code when lines empty but amounts seeded.
    for (const cat of planCategories) {
      const code = cat.code.trim().toLowerCase();
      if (!code || existingByCode.has(code)) continue;
      const raw = amounts[cat.id];
      if (raw == null || String(raw).trim() === '') continue;
      const n = Number(String(raw).replace(',', '.'));
      if (Number.isFinite(n)) existingByCode.set(code, n);
    }
    const enriched = enrichBudgetPreviewWithExisting(parsed, existingByCode);
    setImportPreview(enriched);
    setImportIssues(enriched.issues);
  }

  async function onConfirmImport() {
    if (!importPreview || importPreview.issues.length > 0 || importPreview.articles.length === 0) return;
    const year = Number(calendarYear);
    if (!Number.isInteger(year) || year < 2020 || year > 2100) {
      setFormError(t('admin.firstRunBudgetYearInvalid'));
      return;
    }
    const previewCount = importPreview.articles.length;
    const previewTotal = importPreview.articles.reduce((sum, row) => sum + row.amount, 0);
    onBusy(true);
    setFormError(null);
    setImportNote(null);
    try {
      const { data, error } = await untyped(supabase).rpc('admin_commit_budget_plan', {
        p_calendar_year: year,
        p_rows: importPreview.articles.map((article) => ({
          row: article.row,
          code: article.code,
          name: article.name,
          amount: article.amount.toFixed(2),
        })),
      });
      if (error) throw error;
      const result = (data && typeof data === 'object' ? data : {}) as {
        applied?: unknown;
        idempotent?: unknown;
        categories?: unknown;
        total?: unknown;
        year_id?: unknown;
      };
      const applied = result.applied === true;
      const idempotent = result.idempotent === true;
      if (!applied && !idempotent) {
        throw new Error(t('admin.firstRunBudgetImportNotSaved'));
      }
      const existing = await loadYearByCalendar(year);
      if (!existing) throw new Error(t('admin.firstRunBudgetImportNotSaved'));
      setYearId(existing.id);
      setYearStatus(existing.status);
      const cats = categories.length > 0 ? categories : await loadCategories();
      await loadLines(existing.id, cats);
      const savedCount =
        typeof result.categories === 'number' && Number.isFinite(result.categories)
          ? result.categories
          : previewCount;
      const savedTotal =
        typeof result.total === 'number' && Number.isFinite(result.total)
          ? result.total
          : previewTotal;
      setImportPreview(null);
      setImportIssues([]);
      setImportNote(
        (applied
          ? t('admin.firstRunBudgetImportSavedDetail')
          : t('admin.firstRunBudgetImportUnchangedDetail')
        )
          .replace('{count}', String(savedCount))
          .replace('{year}', String(year))
          .replace('{total}', moneyEur(savedTotal)),
      );
      setStep('amounts');
    } catch (err: unknown) {
      console.error('admin_commit_budget_plan failed', err);
      setFormError(presentFormError(err));
    } finally {
      onBusy(false);
    }
  }

  async function onPublish() {
    onBusy(true);
    setFormError(null);
    setNote(null);
    try {
      if (needsZeroConfirm && !zeroConfirmed) {
        throw new Error(t('admin.firstRunBudgetZeroRequired'));
      }
      const yearNum = Number(calendarYear);
      const cats = (categories.length > 0 ? categories : await loadCategories()).slice();
      if (cats.length === 0) throw new Error(t('admin.firstRunErrBudgetLines'));

      let publishYearId = yearId;
      if (!locked) {
        // Never publish an empty year: commit every active category first
        // (zeros are valid when the operator confirmed a zero plan).
        await commitPlanFromAmounts(yearNum, cats);
        const created = await loadYearByCalendar(yearNum);
        if (!created) throw new Error(t('admin.firstRunErrBudgetLines'));
        publishYearId = created.id;
        setYearId(created.id);
        await loadLines(created.id, cats);
      }
      if (!publishYearId) throw new Error(t('admin.firstRunErrBudgetLines'));

      const draftPayload: FirstRunBudgetDraft = {
        calendarYear: yearNum,
        yearId: publishYearId,
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
          p_year_id: publishYearId,
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
      setFormError(presentFormError(err));
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
    <FirstRunScreen
      icon={Wallet}
      iconClass="text-teal-700"
      title={t('admin.firstRunStageBudget')}
      lead={t('admin.firstRunBudgetLead')}
      busy={busy}
    >
      <p className={styles.hint}>{t('admin.firstRunBudgetNoCharge')}</p>
      {moduleReady ? <p className={styles.okNote}>{t('admin.firstRunBudgetModuleEnabled')}</p> : null}
      {loadError ? <FirstRunErrorNote raw={loadError} t={t} /> : null}

      {step === 'year' ? (
        <form onSubmit={(e) => void onSelectYear(e)} className={styles.formGrid}>
          <label className={styles.field}>
            {t('admin.firstRunBudgetYear')}
            <input
              className={styles.input}
              type="number"
              min={2020}
              max={2100}
              value={calendarYear}
              onChange={(e) => setCalendarYear(e.target.value)}
              required
            />
            <span className={styles.hint}>{t('admin.firstRunBudgetYearHint')}</span>
          </label>
          <FirstRunStageActions>
            <button type="submit" className={styles.primary} disabled={busy}>
              {busy ? t('admin.firstRunBusy') : t('admin.firstRunBudgetYearContinue')}
            </button>
          </FirstRunStageActions>
        </form>
      ) : null}

      {step === 'amounts' && !locked ? (
        <form onSubmit={(e) => void onSaveAmounts(e)} className={styles.group}>
          <p className={styles.groupTitle}>
            {t('admin.firstRunBudgetAmountsTitle').replace('{year}', calendarYear)}
          </p>
          <div className={styles.importGrid}>
            <div className={styles.stepBlock}>
              <p className={styles.importLabel}>{t('admin.firstRunImportDownload')}</p>
              <button type="button" className={styles.secondary} disabled={busy} onClick={downloadTemplate}>
                {t('admin.firstRunBudgetDownload')}
              </button>
              <p className={styles.hint}>{t('admin.firstRunBudgetImportColumnsHint')}</p>
            </div>
            <div className={styles.stepBlock}>
              <p className={styles.importLabel}>{t('admin.firstRunImportUpload')}</p>
              <AppFilePicker
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                disabled={busy}
                resetInputAfterChange
                hint={`${t('common.fileHintFormats').replace('{formats}', '.xlsx')} · ${t('admin.firstRunFileReselectHint')}`}
                onChange={(picked) => {
                  const file = picked[0];
                  if (file) void onPickPlanFile(file);
                }}
              />
            </div>
            <div className={styles.stepBlock}>
              <p className={styles.importLabel}>{t('admin.firstRunImportCheck')}</p>
              {!importPreview ? (
                <p className={styles.hint}>{t('admin.firstRunImportCheckPending')}</p>
              ) : (
                <>
                  <FirstRunStatusStack>
                    {importIssues.length > 0 ? (
                      <FirstRunStatusBanner
                        tone="error"
                        title={t('admin.firstRunBudgetImportCheckFail')}
                        detail={`${t('admin.firstRunBudgetImportStatErrors')}: ${importIssues.length}`}
                      />
                    ) : (
                      <FirstRunStatusBanner tone="success" title={t('admin.firstRunBudgetImportCheckOk')} />
                    )}
                    {importPreview.skipped.length > 0 ? (
                      <FirstRunStatusBanner
                        tone="warning"
                        title={`${t('admin.firstRunBudgetImportStatWarnings')}: ${importPreview.skipped.length}`}
                        detail={importPreview.skipped
                          .slice(0, 8)
                          .map((row) => t('admin.firstRunBudgetImportSkipped').replace('{row}', String(row.row)))
                          .join('\n')}
                      />
                    ) : null}
                  </FirstRunStatusStack>
                  <div className={styles.stats}>
                    <div className={styles.stat}>
                      <div className={styles.statValue}>{importPreview.previewRows.length}</div>
                      <div className={styles.statLabel}>{t('admin.firstRunBudgetImportStatArticles')}</div>
                    </div>
                    <div className={styles.stat}>
                      <div className={styles.statValue}>{importIssues.length}</div>
                      <div className={styles.statLabel}>{t('admin.firstRunBudgetImportStatErrors')}</div>
                    </div>
                    <div className={styles.stat}>
                      <div className={styles.statValue}>{importPreview.skipped.length}</div>
                      <div className={styles.statLabel}>{t('admin.firstRunBudgetImportStatWarnings')}</div>
                    </div>
                  </div>
                  {importIssues.length === 0 ? (
                    <p className={styles.okNote}>
                      {t('admin.firstRunBudgetImportFullTotal').replace(
                        '{total}',
                        moneyEur(importPreview.articles.reduce((sum, row) => sum + row.amount, 0)),
                      )}
                    </p>
                  ) : importPreview.articles.length > 0 ? (
                    <p className={styles.hint}>
                      {t('admin.firstRunBudgetImportPartialTotal').replace(
                        '{total}',
                        moneyEur(importPreview.articles.reduce((sum, row) => sum + row.amount, 0)),
                      )}
                    </p>
                  ) : null}
                  {importIssues.length > 0 ? (
                    <div className={styles.tableWrap}>
                      <table className={styles.table}>
                        <thead>
                          <tr>
                            <th>{t('admin.firstRunBudgetImportColRow')}</th>
                            <th>{t('admin.firstRunBudgetImportColCode')}</th>
                            <th>{t('admin.firstRunErrReason')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {importIssues.map((issue) => (
                            <tr key={`${issue.row}-${issue.reason}-${issue.code ?? ''}-${issue.raw ?? ''}`}>
                              <td>{issue.row}</td>
                              <td>{issue.code || '—'}</td>
                              <td className={styles.fieldError}>{issueReasonText(issue)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}
                  <p className={styles.hint} style={{ marginTop: 8 }}>
                    {t('admin.firstRunBudgetPreviewYear').replace('{year}', String(calendarYear || '—'))}
                  </p>
                  <div className={styles.tableWrap}>
                    <table className={styles.table}>
                      <thead>
                        <tr>
                          <th>{t('admin.firstRunBudgetImportColRow')}</th>
                          <th>{t('admin.firstRunBudgetImportColCode')}</th>
                          <th>{t('admin.firstRunBudgetImportColName')}</th>
                          <th>{t('admin.firstRunBudgetImportColPrior')}</th>
                          <th>{t('admin.firstRunBudgetImportColAmount')}</th>
                          <th>{t('admin.firstRunSfColAction')}</th>
                          <th>{t('admin.firstRunBudgetImportColNotes')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {importPreview.previewRows.map((row) => {
                          const notes = row.issues.map((reason) =>
                            issueReasonText({ reason, raw: row.amountRaw }),
                          );
                          const amountText =
                            row.amount != null
                              ? moneyEur(row.amount)
                              : row.amountRaw.trim() !== ''
                                ? row.amountRaw
                                : '—';
                          const priorText =
                            row.priorAmount != null && Number.isFinite(row.priorAmount)
                              ? moneyEur(row.priorAmount)
                              : '—';
                          return (
                            <tr key={`preview-${row.row}-${row.code}`}>
                              <td>{row.row}</td>
                              <td>{row.code || '—'}</td>
                              <td>{row.name || '—'}</td>
                              <td>{priorText}</td>
                              <td className={row.amount == null && row.issues.length > 0 ? styles.fieldError : undefined}>
                                {amountText}
                              </td>
                              <td>{presentBudgetPreviewAction(row.action, t)}</td>
                              <td className={notes.length > 0 ? styles.fieldError : undefined}>
                                {notes.join(' · ') || '—'}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
            <div className={styles.stepBlock}>
              <p className={styles.importLabel}>{t('admin.firstRunImportConfirm')}</p>
              <FirstRunStageActions>
                <button
                  type="button"
                  className={styles.primary}
                  disabled={
                    busy ||
                    !importPreview ||
                    importIssues.length > 0 ||
                    importPreview.articles.length === 0
                  }
                  onClick={() => void onConfirmImport()}
                >
                  {busy ? t('admin.firstRunImporting') : t('admin.firstRunBudgetImportConfirm')}
                </button>
              </FirstRunStageActions>
            </div>
          </div>
          {importNote ? <p className={styles.okNote}>{importNote}</p> : null}
          <div className={styles.formGrid}>
            {planCategories.map((cat) => (
              <label key={cat.id} className={styles.field}>
                {categoryLabel(cat, locale)}
                <input
                  className={styles.input}
                  type="number"
                  step="0.01"
                  min="0"
                  value={amounts[cat.id] ?? '0'}
                  onChange={(e) => setAmounts((m) => ({ ...m, [cat.id]: e.target.value }))}
                  required
                />
              </label>
            ))}
            <label className={`${styles.field} ${styles.span2}`}>
              {t('admin.firstRunBudgetBasisNote')}
              <input
                className={styles.input}
                value={decisionNote}
                onChange={(e) => setDecisionNote(e.target.value)}
                placeholder={t('admin.firstRunBudgetBasisNotePh')}
              />
              <span className={styles.hint}>{t('admin.firstRunBudgetBasisNoteHint')}</span>
            </label>
          </div>
          <FirstRunStageActions>
            <button type="submit" className={styles.primary} disabled={busy}>
              {busy ? t('admin.firstRunBusy') : t('admin.firstRunBudgetReviewContinue')}
            </button>
            <button
              type="button"
              className={styles.secondary}
              disabled={busy}
              onClick={() => setStep('year')}
            >
              {t('admin.firstRunBudgetBackYear')}
            </button>
          </FirstRunStageActions>
        </form>
      ) : null}

      {(step === 'review' || step === 'done' || locked) ? (
        <div className={styles.stepBlock}>
          <p className={styles.groupTitle}>
            {t('admin.firstRunBudgetReviewTitle').replace('{year}', calendarYear)}
          </p>
          <ul className={styles.reviewList}>
            {planCategories.map((cat) => (
              <li key={cat.id} className={styles.reviewRow}>
                <span className={styles.reviewName}>{categoryLabel(cat, locale)}</span>
                <span className={styles.reviewAmt}>{moneyEur(Number(amounts[cat.id] ?? 0))}</span>
              </li>
            ))}
          </ul>
          <p className={styles.groupTitle}>
            {t('admin.firstRunBudgetTotal').replace('{total}', moneyEur(total))}
          </p>
          {decisionNote.trim() ? (
            <p className={styles.hint}>
              {t('admin.firstRunBudgetBasisNote')}: {decisionNote.trim()}
            </p>
          ) : null}
          {yearStatus ? (
            <p className={styles.hint}>
              {t('admin.firstRunBudgetStatus')}: {budgetYearStatusLabel(yearStatus, t)}
            </p>
          ) : null}

          {needsZeroConfirm && !locked ? (
            <label className={styles.checkLine}>
              <input
                type="checkbox"
                checked={zeroConfirmed}
                onChange={(e) => setZeroConfirmed(e.target.checked)}
              />
              <span>{t('admin.firstRunBudgetZeroConfirm')}</span>
            </label>
          ) : null}

          <FirstRunStageActions>
            {!locked ? (
              <>
                <button
                  type="button"
                  className={styles.primary}
                  disabled={busy || (needsZeroConfirm && !zeroConfirmed)}
                  onClick={() => void onPublish()}
                >
                  {busy ? t('admin.firstRunBusy') : t('admin.firstRunBudgetPublish')}
                </button>
                <p className={`${styles.hint} ${styles.span2}`}>{t('admin.firstRunBudgetPublishHint')}</p>
                <button
                  type="button"
                  className={styles.secondary}
                  disabled={busy}
                  onClick={() => setStep('amounts')}
                >
                  {t('admin.firstRunBudgetBackAmounts')}
                </button>
              </>
            ) : (
              <button
                type="button"
                className={styles.primary}
                disabled={busy}
                onClick={() => void onFinishStage()}
              >
                {busy ? t('admin.firstRunBusy') : t('admin.firstRunBudgetContinue')}
              </button>
            )}
          </FirstRunStageActions>
          {locked && lines.length === 0 ? (
            <p className={styles.hint}>{t('admin.firstRunBudgetExistingPublished')}</p>
          ) : null}
        </div>
      ) : null}

      {formError ? <FirstRunErrorNote raw={formError} t={t} /> : null}
      {note ? <p className={styles.okNote}>{note}</p> : null}
    </FirstRunScreen>
  );
}
