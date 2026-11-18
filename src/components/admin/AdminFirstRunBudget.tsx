'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
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
  budgetGroupLabel,
  budgetSubgroupLabel,
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
  budgetArticlePathKey,
  buildBudgetPlanTemplateBuffer,
  buildBudgetPreviewGroups,
  enrichBudgetPreviewWithExisting,
  readBudgetPlanWorkbook,
  validateBudgetPlanAgainstCatalog,
  type BudgetPlanIssue,
  type BudgetPlanParse,
  type BudgetPlanPreviewRow,
  type BudgetPreviewGroup,
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

/** Saved plan lines → nested Group → Subgroup → Article rows (no zero-fill for missing cats). */
function savedLinesToPreviewRows(
  cats: BudgetCategory[],
  lines: BudgetLineRow[],
  locale: string,
): BudgetPlanPreviewRow[] {
  const byId = new Map(cats.map((cat) => [cat.id, cat]));
  return lines.map((line, index) => {
    const cat = byId.get(line.category_id);
    return {
      row: index + 1,
      code: line.category_code,
      name: cat ? categoryLabel(cat, locale) : line.category_name_ru,
      group: cat ? budgetGroupLabel(cat, locale) : '—',
      subgroup: cat ? budgetSubgroupLabel(cat, locale) : '',
      amount: Number(line.planned_amount_eur) || 0,
      amountBlank: false,
      amountRaw: String(line.planned_amount_eur),
      issues: [],
      priorAmount: Number(line.planned_amount_eur) || 0,
      action: 'unchanged',
    };
  });
}

export type FirstRunBudgetNavHandle = {
  /** true when Back stayed inside budget sub-steps. */
  handleBack: () => boolean;
  persistDraft: () => Promise<boolean>;
};

/** Locale-aware plan amount for the hierarchy view (display only). */
function formatPlanEur(n: number, locale: string): string {
  const loc = locale.toLowerCase().startsWith('bg')
    ? 'bg-BG'
    : locale.toLowerCase().startsWith('en')
      ? 'en-GB'
      : 'ru-RU';
  return `${Number(n).toLocaleString(loc, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} €`;
}

/** Amount that will remain / be saved after confirm (blank keeps prior). */
function planAmountToShow(row: BudgetPlanPreviewRow): number | null {
  if (row.amount != null && Number.isFinite(row.amount)) return row.amount;
  if (row.amountBlank && row.priorAmount != null && Number.isFinite(row.priorAmount)) {
    return row.priorAmount;
  }
  return null;
}

function sumPlanAmounts(rows: BudgetPlanPreviewRow[]): number {
  return rows.reduce((acc, row) => {
    const n = planAmountToShow(row);
    return n != null ? acc + n : acc;
  }, 0);
}

function BudgetHierarchyList({
  grouped,
  t,
  locale,
  mode,
  issueReasonText,
}: {
  grouped: { groups: BudgetPreviewGroup[]; grandTotal: number };
  t: (key: string) => string;
  locale: string;
  mode: 'preview' | 'saved';
  issueReasonText?: (issue: Pick<BudgetPlanIssue, 'reason' | 'raw'>) => string;
}) {
  const fmt = (n: number) => formatPlanEur(n, locale);
  const amountLabel = (row: BudgetPlanPreviewRow) => {
    const n = planAmountToShow(row);
    if (n != null) return fmt(n);
    return t('admin.firstRunBudgetPlanUnset');
  };

  let grand = 0;
  for (const g of grouped.groups) {
    grand += sumPlanAmounts(g.rows);
  }
  // Saved view: prefer structural totals from grouped when all amounts are present.
  if (mode === 'saved' && grouped.groups.every((g) => g.rows.every((r) => r.amount != null))) {
    grand = grouped.grandTotal;
  }

  return (
    <div className={styles.budgetTree}>
      <div className={styles.budgetTreeHead}>
        <span>{t('admin.firstRunBudgetPlanCol')}</span>
      </div>
      {grouped.groups.map((group) => {
        const groupTotal = sumPlanAmounts(group.rows);
        return (
          <Fragment key={`tree-g-${group.key}`}>
            <div className={styles.budgetTreeGroup}>{group.label}</div>
            {group.directRows.map((row) => (
              <Fragment key={`tree-d-${row.row}-${row.code || row.name}`}>
                <div className={`${styles.budgetTreeRow} ${styles.budgetTreeArticle}`}>
                  <div className={styles.budgetTreeName}>
                    <span className={styles.budgetTreeBullet} aria-hidden>
                      •
                    </span>
                    {row.name || '—'}
                  </div>
                  <div className={styles.budgetTreeAmt}>{amountLabel(row)}</div>
                </div>
                {mode === 'preview' ? (
                  <BudgetArticleNotes
                    row={row}
                    direct
                    t={t}
                    issueReasonText={issueReasonText}
                  />
                ) : null}
              </Fragment>
            ))}
            {group.subgroups.map((sub) => {
              const subTotal = sumPlanAmounts(sub.rows);
              return (
                <Fragment key={`tree-sg-${group.key}-${sub.key}`}>
                  <div className={styles.budgetTreeSubgroup}>{sub.label}</div>
                  {sub.rows.map((row) => (
                    <Fragment key={`tree-a-${row.row}-${row.code || row.name}`}>
                      <div
                        className={`${styles.budgetTreeRow} ${styles.budgetTreeArticleInSub}`}
                      >
                        <div className={styles.budgetTreeName}>
                          <span className={styles.budgetTreeBullet} aria-hidden>
                            •
                          </span>
                          {row.name || '—'}
                        </div>
                        <div className={styles.budgetTreeAmt}>{amountLabel(row)}</div>
                      </div>
                      {mode === 'preview' ? (
                        <BudgetArticleNotes
                          row={row}
                          direct={false}
                          t={t}
                          issueReasonText={issueReasonText}
                        />
                      ) : null}
                    </Fragment>
                  ))}
                  <div
                    className={`${styles.budgetTreeRow} ${styles.budgetTreeTotalRow} ${styles.budgetTreeTotalSub}`}
                  >
                    <div className={styles.budgetTreeName}>{t('admin.firstRunBudgetTotalCompact')}</div>
                    <div className={styles.budgetTreeAmt}>{fmt(subTotal)}</div>
                  </div>
                </Fragment>
              );
            })}
            <div
              className={`${styles.budgetTreeRow} ${styles.budgetTreeTotalRow} ${styles.budgetTreeTotalGroup}`}
            >
              <div className={styles.budgetTreeName}>{t('admin.firstRunBudgetTotalCompact')}</div>
              <div className={styles.budgetTreeAmt}>{fmt(groupTotal)}</div>
            </div>
          </Fragment>
        );
      })}
      <div
        className={`${styles.budgetTreeRow} ${styles.budgetTreeTotalRow} ${styles.budgetTreeTotalGrand}`}
      >
        <div className={styles.budgetTreeName}>{t('admin.firstRunBudgetImportGrandTotal')}</div>
        <div className={styles.budgetTreeAmt}>{fmt(grand)}</div>
      </div>
    </div>
  );
}

function BudgetArticleNotes({
  row,
  direct,
  t,
  issueReasonText,
}: {
  row: BudgetPlanPreviewRow;
  direct: boolean;
  t: (key: string) => string;
  issueReasonText?: (issue: Pick<BudgetPlanIssue, 'reason' | 'raw'>) => string;
}) {
  const pad = direct ? styles.budgetTreeMsgDirect : undefined;
  const errors = row.issues.map((reason) => {
    const reasonText = issueReasonText
      ? issueReasonText({ reason, raw: row.amountRaw })
      : reason;
    return t('admin.firstRunBudgetImportErrorWithRow')
      .replace('{row}', String(row.row))
      .replace('{reason}', reasonText);
  });
  const hints: string[] = [];
  if (row.amountBlank) hints.push(t('admin.firstRunBudgetImport_blank_amount'));
  if (row.willCreate) hints.push(t('admin.firstRunBudgetImportWillCreate'));
  if (row.similarNames && row.similarNames.length > 0) {
    hints.push(
      t('admin.firstRunBudgetImportSimilarHint').replace('{names}', row.similarNames.join('; ')),
    );
  }
  if (errors.length === 0 && hints.length === 0) return null;
  return (
    <>
      {errors.map((text) => (
        <p
          key={`err-${row.row}-${text}`}
          className={`${styles.budgetTreeMsg} ${styles.budgetTreeError} ${pad ?? ''}`.trim()}
        >
          {text}
        </p>
      ))}
      {hints.map((text) => (
        <p
          key={`hint-${row.row}-${text}`}
          className={`${styles.budgetTreeMsg} ${styles.budgetTreeHint} ${pad ?? ''}`.trim()}
        >
          {text}
        </p>
      ))}
    </>
  );
}

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

  const [step, setStep] = useState<FirstRunBudgetDraft['step']>(
    initial.step === 'review' ? 'amounts' : initial.step,
  );
  const [calendarYear, setCalendarYear] = useState(
    initial.calendarYear != null ? String(initial.calendarYear) : String(defaultYear),
  );
  const [yearId, setYearId] = useState<string | null>(initial.yearId);
  const [yearStatus, setYearStatus] = useState<string | null>(null);
  // Kept for draft round-trip only — never shown or required in the wizard UI.
  const [decisionNote] = useState(initial.decisionNote);
  const [zeroConfirmed, setZeroConfirmed] = useState(initial.zeroConfirmed);
  const [categories, setCategories] = useState<BudgetCategory[]>([]);
  const [planCategories, setPlanCategories] = useState<BudgetCategory[]>([]);
  const [importIssues, setImportIssues] = useState<BudgetPlanIssue[]>([]);
  const [importPreview, setImportPreview] = useState<BudgetPlanParse | null>(null);
  const [importNote, setImportNote] = useState<string | null>(null);
  const [lines, setLines] = useState<BudgetLineRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [moduleReady, setModuleReady] = useState(false);

  const locked = isPublishedLike(yearStatus);

  const total = useMemo(
    () => lines.reduce((acc, line) => acc + (Number(line.planned_amount_eur) || 0), 0),
    [lines],
  );

  const needsZeroConfirm = budgetPlanRequiresZeroConfirmation(total);

  const savedGrouped = useMemo(() => {
    const cats = planCategories.length > 0 ? planCategories : categories;
    return buildBudgetPreviewGroups(savedLinesToPreviewRows(cats, lines, locale));
  }, [categories, lines, locale, planCategories]);

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
        if (step === 'amounts' || step === 'review') {
          if (importPreview) {
            setImportPreview(null);
            setImportIssues([]);
            return true;
          }
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
  }, [currentDraft, importPreview, locked, onNavHandle, persistDraft, step]);

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
      // Catalog for labels/template only — never invent zero amounts for missing lines.
      setPlanCategories(cats.length > 0 ? cats : []);
      return list;
    },
    [supabase],
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
          await loadLines(existing.id, cats);
          if (isPublishedLike(existing.status)) {
            setStep('done');
          } else if (initial.step === 'year') {
            setStep('amounts');
          } else if (initial.step === 'review' || initial.step === 'done') {
            // Old review sub-step removed — stay on import/continue surface.
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
      setPlanCategories(cats);
      if (existing) await loadLines(existing.id, cats);
      else {
        setLines([]);
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

  function issueReasonText(issue: Pick<BudgetPlanIssue, 'reason' | 'raw'>): string {
    return t(`admin.firstRunBudgetImport_${issue.reason}`).replace(
      '{value}',
      issue.raw != null && String(issue.raw).trim() !== '' ? String(issue.raw) : '—',
    );
  }

  function downloadTemplate() {
    const seedCats = (planCategories.length > 0 ? planCategories : categories)
      .slice()
      .filter((cat) => cat.active !== false && cat.code !== '1.10');
    const catalogRows = seedCats.map((cat) => ({
      group: budgetGroupLabel(cat, locale),
      subgroup: budgetSubgroupLabel(cat, locale),
      name: categoryLabel(cat, locale),
      amount: '',
    }));
    const bytes = buildBudgetPlanTemplateBuffer(locale, catalogRows);
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
    const catalog = (categories.length > 0 ? categories : planCategories).map((cat) => ({
      code: cat.code,
      name_ru: cat.name_ru,
      name_en: cat.name_en,
      name_bg: cat.name_bg,
      group_code: cat.group_code,
      group_name_ru: cat.group_name_ru,
      group_name_en: cat.group_name_en,
      group_name_bg: cat.group_name_bg,
      subgroup_code: cat.subgroup_code,
      subgroup_name_ru: cat.subgroup_name_ru,
      subgroup_name_en: cat.subgroup_name_en,
      subgroup_name_bg: cat.subgroup_name_bg,
    }));
    const validated = validateBudgetPlanAgainstCatalog(parsed, catalog, locale, {
      subgroupColumnPresent: parsed.subgroupColumnPresent,
    });
    const existingByCode = new Map<string, number>();
    const existingByPath = new Map<string, number>();
    const cats = categories.length > 0 ? categories : planCategories;
    for (const line of lines) {
      const code = String(line.category_code ?? '').trim().toLowerCase();
      const amount = Number(line.planned_amount_eur) || 0;
      if (code) existingByCode.set(code, amount);
      const cat = cats.find((c) => c.id === line.category_id);
      const group = cat ? budgetGroupLabel(cat, locale) : '';
      const subgroup = cat ? budgetSubgroupLabel(cat, locale) : '';
      const name = cat ? categoryLabel(cat, locale) : line.category_name_ru;
      if (group && name) {
        existingByPath.set(budgetArticlePathKey(group, subgroup, name), amount);
      }
    }
    const enriched = enrichBudgetPreviewWithExisting(validated, existingByCode, existingByPath);
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
          group: article.group,
          subgroup: article.subgroup,
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
      const next: FirstRunBudgetDraft = {
        calendarYear: year,
        yearId: existing.id,
        decisionNote,
        zeroConfirmed: false,
        step: 'amounts',
      };
      setZeroConfirmed(false);
      setStep('amounts');
      await persistDraft(next);
    } catch (err: unknown) {
      console.error('admin_commit_budget_plan failed', err);
      setFormError(presentFormError(err));
    } finally {
      onBusy(false);
    }
  }

  /** Publish imported plan (if needed) and continue the wizard — no separate review editor. */
  async function onPublishAndContinue() {
    onBusy(true);
    setFormError(null);
    setNote(null);
    try {
      if (lines.length === 0) {
        throw new Error(t('admin.firstRunBudgetNeedImport'));
      }
      if (needsZeroConfirm && !zeroConfirmed && !locked) {
        throw new Error(t('admin.firstRunBudgetZeroRequired'));
      }
      const yearNum = Number(calendarYear);
      let publishYearId = yearId;
      if (!publishYearId) {
        const existing = await loadYearByCalendar(yearNum);
        if (!existing) throw new Error(t('admin.firstRunErrBudgetLines'));
        publishYearId = existing.id;
        setYearId(existing.id);
      }

      const draftPayload: FirstRunBudgetDraft = {
        calendarYear: yearNum,
        yearId: publishYearId,
        decisionNote,
        zeroConfirmed: needsZeroConfirm ? true : false,
        step: 'done',
      };
      await persistDraft(draftPayload);

      if (!locked) {
        const { error: pubErr } = await supabase.rpc('admin_set_budget_year_status', {
          p_year_id: publishYearId,
          p_status: 'published',
          p_decision_note: null,
          p_decision_id: null,
        });
        if (pubErr) throw pubErr;
        setYearStatus('published');
      }

      setStep('done');
      await persistDraft(draftPayload);
      setNote(t('admin.firstRunBudgetPublished'));
      await onContinue(draftPayload);
    } catch (err: unknown) {
      setFormError(presentFormError(err));
    } finally {
      onBusy(false);
    }
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

      {(step === 'amounts' || step === 'review') && !locked ? (
        <div className={styles.group}>
          <p className={styles.groupTitle}>
            {t('admin.firstRunBudgetAmountsTitle').replace('{year}', calendarYear)}
          </p>
          {lines.length > 0 && !importPreview ? (
            <p className={styles.okNote}>{t('admin.firstRunBudgetAlreadyImported')}</p>
          ) : null}
          <div className={styles.importGrid}>
            <div className={styles.stepBlock}>
              <p className={styles.importLabel}>{t('admin.firstRunImportDownload')}</p>
              <button type="button" className={styles.secondary} disabled={busy} onClick={downloadTemplate}>
                {t('admin.firstRunBudgetDownload')}
              </button>
              <p className={styles.hint}>{t('admin.firstRunBudgetImportColumnsHint')}</p>
            </div>
            <div className={styles.stepBlock}>
              <p className={styles.importLabel}>
                {lines.length > 0 && !importPreview
                  ? t('admin.firstRunBudgetReupload')
                  : t('admin.firstRunImportUpload')}
              </p>
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
            {importPreview ? (
              <>
                <div className={styles.stepBlock}>
                  <p className={styles.importLabel}>{t('admin.firstRunImportCheck')}</p>
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
                          .map((row) =>
                            t('admin.firstRunBudgetImportSkipped').replace('{row}', String(row.row)),
                          )
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
                  {(() => {
                    const grouped = buildBudgetPreviewGroups(importPreview.previewRows);
                    const previewTotal = sumPlanAmounts(importPreview.previewRows);
                    return (
                      <>
                        {importIssues.length === 0 ? (
                          <p className={styles.okNote}>
                            {t('admin.firstRunBudgetImportFullTotal').replace(
                              '{total}',
                              formatPlanEur(previewTotal, locale),
                            )}
                          </p>
                        ) : importPreview.articles.length > 0 ? (
                          <p className={styles.hint}>
                            {t('admin.firstRunBudgetImportPartialTotal').replace(
                              '{total}',
                              formatPlanEur(previewTotal, locale),
                            )}
                          </p>
                        ) : null}
                        <p className={styles.hint} style={{ marginTop: 8 }}>
                          {t('admin.firstRunBudgetPreviewYear').replace(
                            '{year}',
                            String(calendarYear || '—'),
                          )}
                        </p>
                        <BudgetHierarchyList
                          grouped={grouped}
                          t={t}
                          locale={locale}
                          mode="preview"
                          issueReasonText={issueReasonText}
                        />
                      </>
                    );
                  })()}
                </div>
                <div className={styles.stepBlock}>
                  <p className={styles.importLabel}>{t('admin.firstRunImportConfirm')}</p>
                  <FirstRunStageActions>
                    <button
                      type="button"
                      className={styles.primary}
                      disabled={
                        busy ||
                        importIssues.length > 0 ||
                        importPreview.articles.length === 0
                      }
                      onClick={() => void onConfirmImport()}
                    >
                      {busy ? t('admin.firstRunImporting') : t('admin.firstRunBudgetImportConfirm')}
                    </button>
                    <button
                      type="button"
                      className={styles.secondary}
                      disabled={busy}
                      onClick={() => {
                        setImportPreview(null);
                        setImportIssues([]);
                      }}
                    >
                      {t('admin.firstRunBudgetCancelPreview')}
                    </button>
                  </FirstRunStageActions>
                </div>
              </>
            ) : (
              <div className={styles.stepBlock}>
                <p className={styles.importLabel}>{t('admin.firstRunImportCheck')}</p>
                <p className={styles.hint}>{t('admin.firstRunImportCheckPending')}</p>
              </div>
            )}
          </div>
          {importNote ? <p className={styles.okNote}>{importNote}</p> : null}
          {/* Saved plan only when not previewing a newly picked file — never parallel tables. */}
          {lines.length > 0 && !importPreview ? (
            <div className={styles.stepBlock} style={{ marginTop: 12 }}>
              <p className={styles.groupTitle}>{t('admin.firstRunBudgetSavedTitle')}</p>
              <BudgetHierarchyList
                grouped={savedGrouped}
                t={t}
                locale={locale}
                mode="saved"
              />
              <p className={styles.okNote}>
                {t('admin.firstRunBudgetTotal').replace('{total}', formatPlanEur(total, locale))}
              </p>
            </div>
          ) : null}
          {lines.length > 0 && !importPreview && needsZeroConfirm ? (
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
            {lines.length > 0 && !importPreview ? (
              <button
                type="button"
                className={styles.primary}
                disabled={busy || (needsZeroConfirm && !zeroConfirmed)}
                onClick={() => void onPublishAndContinue()}
              >
                {busy ? t('admin.firstRunBusy') : t('admin.firstRunBudgetContinue')}
              </button>
            ) : null}
            <button
              type="button"
              className={styles.secondary}
              disabled={busy}
              onClick={() => setStep('year')}
            >
              {t('admin.firstRunBudgetBackYear')}
            </button>
          </FirstRunStageActions>
          {lines.length > 0 && !importPreview ? (
            <p className={`${styles.hint} ${styles.span2}`}>{t('admin.firstRunBudgetPublishHint')}</p>
          ) : null}
        </div>
      ) : null}

      {(step === 'done' || locked) ? (
        <div className={styles.stepBlock}>
          <p className={styles.groupTitle}>
            {t('admin.firstRunBudgetReviewTitle').replace('{year}', calendarYear)}
          </p>
          {lines.length > 0 ? (
            <BudgetHierarchyList
              grouped={savedGrouped}
              t={t}
              locale={locale}
              mode="saved"
            />
          ) : (
            <p className={styles.hint}>{t('admin.firstRunBudgetNeedImport')}</p>
          )}
          <p className={styles.groupTitle}>
            {t('admin.firstRunBudgetTotal').replace('{total}', formatPlanEur(total, locale))}
          </p>
          {yearStatus ? (
            <p className={styles.hint}>
              {t('admin.firstRunBudgetStatus')}: {budgetYearStatusLabel(yearStatus, t)}
            </p>
          ) : null}
          <FirstRunStageActions>
            <button
              type="button"
              className={styles.primary}
              disabled={busy || lines.length === 0}
              onClick={() => void onPublishAndContinue()}
            >
              {busy ? t('admin.firstRunBusy') : t('admin.firstRunBudgetContinue')}
            </button>
          </FirstRunStageActions>
        </div>
      ) : null}

      {formError ? <FirstRunErrorNote raw={formError} t={t} /> : null}
      {note ? <p className={styles.okNote}>{note}</p> : null}
    </FirstRunScreen>
  );
}
