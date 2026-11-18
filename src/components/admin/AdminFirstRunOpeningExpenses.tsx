'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ScrollText } from 'lucide-react';
import type { Database } from '@/lib/database.types';
import { FirstRunStageActions } from '@/components/admin/FirstRunFrame';
import { FirstRunScreen } from '@/components/admin/FirstRunSteps';
import styles from './FirstRunFrame.module.css';
import { FirstRunStatusBanner, FirstRunStatusStack } from '@/components/admin/FirstRunStatusBanner';
import { AppFilePicker } from '@/components/ui/AppFilePicker';
import { useAppConfirm } from '@/components/ui/AppConfirmDialog';
import {
  budgetGroupLabel,
  budgetSubgroupLabel,
  categoryLabel,
  moneyEur,
} from '@/lib/budget';
import { parseFirstRunBudgetDraft, saveFirstRunProgress, type FirstRunState } from '@/lib/firstRun';
import { toUserFacingMessage } from '@/lib/userFacingError';
import {
  buildOpeningPreviewGroups,
  buildOpeningTotalsTemplateBuffer,
  parseOpeningTotalsMatrix,
  readFirstSheetMatrix,
  type OpeningKnownArticle,
  type OpeningPreviewTotals,
  type OpeningTotalIssue,
  type OpeningTotalParse,
  type OpeningTotalPreviewRow,
} from '@/lib/budgetPlanImport';
import { useI18n } from '@/i18n/I18nProvider';
import { OPENING_TOTALS_IMPORT_SPEC, localizedTemplateFileName } from '@/lib/importTemplates';

type UntypedRpc = {
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{
    data: unknown;
    error: { message: string } | null;
  }>;
};

type OpeningRow = {
  category_id: string;
  code: string;
  name_ru: string;
  name_en: string;
  name_bg: string;
  planned_amount_eur: number;
  opening_amount_eur: number | null;
  group_name_ru?: string | null;
  group_name_en?: string | null;
  group_name_bg?: string | null;
  subgroup_name_ru?: string | null;
  subgroup_name_en?: string | null;
  subgroup_name_bg?: string | null;
};

function untyped(supabase: SupabaseClient<Database>): UntypedRpc {
  return supabase as unknown as UntypedRpc;
}

function downloadBuffer(bytes: ArrayBuffer, name: string) {
  const blob = new Blob([bytes], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

function isDraftNoneFlag(draft: Record<string, unknown>): boolean {
  return ['true', 't', '1', 'yes'].includes(
    String(draft.uk_expenses_opening_none ?? '').trim().toLowerCase(),
  );
}

function formatMaybeEur(value: number | null | undefined, unsetLabel: string): string {
  if (value == null || !Number.isFinite(value)) return unsetLabel;
  return moneyEur(value);
}

function OpeningHierarchyPreview({
  rows,
  t,
  showErrors,
}: {
  rows: OpeningTotalPreviewRow[];
  t: (key: string) => string;
  showErrors?: boolean;
}) {
  const grouped = useMemo(() => buildOpeningPreviewGroups(rows), [rows]);
  const unset = t('admin.firstRunOpeningAmountMissing');

  function renderTotals(totals: OpeningPreviewTotals, className: string) {
    return (
      <div className={`${styles.budgetTreeRow} ${styles.budgetTreeTotalRow} ${className}`}>
        <div className={styles.budgetTreeName}>{t('admin.firstRunBudgetTotalCompact')}</div>
        <div className={styles.budgetTreeAmts}>
          <span>{formatMaybeEur(totals.plan, unset)}</span>
          <span>{formatMaybeEur(totals.fact, unset)}</span>
          <span>
            {totals.incomplete
              ? t('admin.firstRunOpeningDiffIncomplete')
              : formatMaybeEur(totals.diff, unset)}
          </span>
        </div>
      </div>
    );
  }

  function renderArticle(row: OpeningTotalPreviewRow, nested: boolean) {
    const hasError = row.issues.length > 0;
    const hasWarn = !hasError && row.warnings.length > 0;
    return (
      <Fragment key={`opening-art-${row.row}-${row.categoryId || row.name}`}>
        <div
          className={`${styles.budgetTreeRow} ${
            nested ? styles.budgetTreeArticleInSub : styles.budgetTreeArticle
          }${hasError ? ` ${styles.tableRowError}` : hasWarn ? ` ${styles.tableRowWarn}` : ''}`}
        >
          <div className={styles.budgetTreeName}>
            <span className={styles.budgetTreeBullet} aria-hidden>
              •
            </span>
            {row.name || '—'}
          </div>
          <div className={styles.budgetTreeAmts}>
            <span>{formatMaybeEur(row.planned, unset)}</span>
            <span>
              {row.amountBlank
                ? unset
                : row.amount != null
                  ? moneyEur(row.amount)
                  : row.amountRaw || unset}
            </span>
            <span>
              {row.amountBlank || row.amount == null || row.planned == null
                ? '—'
                : moneyEur(row.remainder ?? row.planned - row.amount)}
            </span>
          </div>
        </div>
        {showErrors && hasError ? (
          <p
            className={`${styles.budgetTreeMsg} ${styles.budgetTreeError} ${
              nested ? '' : styles.budgetTreeMsgDirect
            }`}
          >
            {row.issues
              .map((reason) =>
                issueReasonText(t, { reason, raw: row.amountRaw }),
              )
              .join(' · ')}
          </p>
        ) : null}
        {showErrors && hasWarn ? (
          <p
            className={`${styles.budgetTreeMsg} ${styles.budgetTreeHint} ${
              nested ? '' : styles.budgetTreeMsgDirect
            }`}
          >
            {t('admin.firstRunOpeningOverPlanDetail').replace(
              '{amount}',
              moneyEur(row.overBy ?? 0),
            )}
          </p>
        ) : null}
      </Fragment>
    );
  }

  return (
    <div className={styles.budgetTree}>
      <div className={`${styles.budgetTreeHead} ${styles.budgetTreeHeadOpening}`}>
        <span className={styles.budgetTreeHeadName}>{t('admin.firstRunOpeningColName')}</span>
        <div className={styles.budgetTreeAmts}>
          <span>{t('admin.firstRunOpeningColPlan')}</span>
          <span>{t('admin.firstRunOpeningColFact')}</span>
          <span>{t('admin.firstRunOpeningColDiff')}</span>
        </div>
      </div>
      {grouped.groups.map((group) => (
        <Fragment key={`opening-g-${group.key}`}>
          <div className={styles.budgetTreeGroup}>{group.label}</div>
          {group.directRows.map((row) => renderArticle(row, false))}
          {group.subgroups.map((sub) => (
            <Fragment key={`opening-sg-${group.key}-${sub.key}`}>
              <div className={styles.budgetTreeSubgroup}>{sub.label}</div>
              {sub.rows.map((row) => renderArticle(row, true))}
              {renderTotals(sub.totals, styles.budgetTreeTotalSub)}
            </Fragment>
          ))}
          {renderTotals(group.totals, styles.budgetTreeTotalGroup)}
        </Fragment>
      ))}
      <div
        className={`${styles.budgetTreeRow} ${styles.budgetTreeTotalRow} ${styles.budgetTreeTotalGrand}`}
      >
        <div className={styles.budgetTreeName}>{t('admin.firstRunBudgetImportGrandTotal')}</div>
        <div className={styles.budgetTreeAmts}>
          <span>{formatMaybeEur(grouped.totals.plan, unset)}</span>
          <span>{formatMaybeEur(grouped.totals.fact, unset)}</span>
          <span>
            {grouped.totals.incomplete
              ? t('admin.firstRunOpeningDiffIncomplete')
              : formatMaybeEur(grouped.totals.diff, unset)}
          </span>
        </div>
      </div>
      {grouped.totals.incomplete ? (
        <p className={styles.hint}>{t('admin.firstRunOpeningTotalsIncompleteHint')}</p>
      ) : null}
    </div>
  );
}

function issueReasonText(
  t: (key: string) => string,
  issue: Pick<OpeningTotalIssue, 'reason' | 'raw'>,
): string {
  if (issue.reason === 'required_amount') {
    return t('admin.firstRunOpeningAmountRequired');
  }
  if (issue.reason === 'unknown_code' || issue.reason === 'unknown_article') {
    return t('admin.firstRunOpeningUnknown');
  }
  if (issue.reason === 'ambiguous_article') {
    return t('admin.firstRunOpeningAmbiguous');
  }
  if (issue.reason === 'required_name') {
    return t('admin.firstRunBudgetImport_required_name');
  }
  if (issue.reason === 'duplicate_article') {
    return t('admin.firstRunBudgetImport_duplicate_article');
  }
  return t(`admin.firstRunBudgetImport_${issue.reason}`).replace('{value}', issue.raw ?? '');
}

function rowsToKnown(rows: OpeningRow[], locale: string): OpeningKnownArticle[] {
  return rows.map((row) => ({
    categoryId: row.category_id,
    code: row.code,
    name: categoryLabel(row, locale),
    group: budgetGroupLabel(row, locale),
    subgroup: budgetSubgroupLabel(row, locale),
    planned: row.planned_amount_eur,
  }));
}

function savedPreviewRows(rows: OpeningRow[], locale: string): OpeningTotalPreviewRow[] {
  return rows.map((row, index) => {
    const amount =
      row.opening_amount_eur == null || !Number.isFinite(Number(row.opening_amount_eur))
        ? null
        : Number(row.opening_amount_eur);
    const blank = amount == null;
    const planned = row.planned_amount_eur;
    const overPlan = amount != null && amount - planned > 0.000001;
    return {
      row: index + 2,
      categoryId: row.category_id,
      code: row.code,
      name: categoryLabel(row, locale),
      group: budgetGroupLabel(row, locale),
      subgroup: budgetSubgroupLabel(row, locale),
      planned,
      amount,
      amountRaw: amount == null ? '' : String(amount),
      amountBlank: blank,
      remainder: amount == null ? null : planned - amount,
      overPlan,
      overBy: overPlan && amount != null ? amount - planned : null,
      issues: [],
      warnings: overPlan ? ['over_plan'] : [],
    };
  });
}

export type FirstRunOpeningNavHandle = {
  /** Best-effort draft persist before leaving the stage. Returns false when save failed. */
  persistDraft: () => Promise<boolean>;
};

export function AdminFirstRunOpeningExpenses({
  supabase,
  t,
  draft,
  busy,
  onBusy,
  onContinue,
  onState,
  onNavHandle,
}: {
  supabase: SupabaseClient<Database>;
  t: (key: string) => string;
  draft: Record<string, unknown>;
  busy: boolean;
  onBusy: (v: boolean) => void;
  onContinue: (none: boolean) => Promise<void>;
  onState?: (state: FirstRunState | null) => void;
  onNavHandle?: (handle: FirstRunOpeningNavHandle | null) => void;
}) {
  const { locale } = useI18n();
  const { confirm, dialog } = useAppConfirm(t('common.close'));
  const budget = parseFirstRunBudgetDraft(draft);
  const draftNoneFlag = isDraftNoneFlag(draft);

  const [rows, setRows] = useState<OpeningRow[]>([]);
  const [saved, setSaved] = useState(false);
  const [savedNone, setSavedNone] = useState(draftNoneFlag);
  const [preview, setPreview] = useState<OpeningTotalParse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const knownArticles = useMemo(() => rowsToKnown(rows, locale), [rows, locale]);

  const applyServerRows = useCallback(
    (list: OpeningRow[], noneFlag: boolean) => {
      setRows(list);
      const hasPositive = list.some(
        (row) => row.opening_amount_eur != null && Number(row.opening_amount_eur) > 0,
      );
      if (hasPositive) {
        setSaved(true);
        setSavedNone(false);
      } else if (noneFlag) {
        setSaved(true);
        setSavedNone(true);
      } else {
        setSaved(false);
        setSavedNone(false);
      }
    },
    [],
  );

  const fetchRows = useCallback(async (): Promise<OpeningRow[]> => {
    if (budget.calendarYear == null) {
      throw new Error(t('admin.firstRunErrBudgetYear'));
    }
    const { data, error: rpcError } = await untyped(supabase).rpc('admin_list_first_run_opening_totals', {
      p_calendar_year: budget.calendarYear,
    });
    if (rpcError) throw rpcError;
    return ((data as OpeningRow[] | null) ?? []).map((row) => ({
      ...row,
      category_id: String(row.category_id),
      planned_amount_eur: Number(row.planned_amount_eur),
      opening_amount_eur:
        row.opening_amount_eur == null || row.opening_amount_eur === ('' as unknown)
          ? null
          : Number(row.opening_amount_eur),
    }));
  }, [budget.calendarYear, supabase, t]);

  const load = useCallback(async () => {
    const list = await fetchRows();
    applyServerRows(list, draftNoneFlag);
  }, [applyServerRows, draftNoneFlag, fetchRows]);

  useEffect(() => {
    void load().catch((err: unknown) =>
      setError(toUserFacingMessage(err, t, { context: 'first_run', fallback: t('admin.errGeneric') })),
    );
  }, [load, t]);

  async function persistNoneFlag(nextNone: boolean): Promise<void> {
    const state = await saveFirstRunProgress(supabase, {
      stage: 'uk_expenses_opening',
      draft: { uk_expenses_opening_none: nextNone },
    });
    onState?.(state);
  }

  async function save(
    nextNone: boolean,
    nextRows: Array<{ row: number; category_id: string; amount: string }>,
  ): Promise<boolean> {
    if (budget.calendarYear == null) {
      setError(t('admin.firstRunErrBudgetYear'));
      return false;
    }
    onBusy(true);
    setError(null);
    try {
      const { error: rpcError } = await untyped(supabase).rpc('admin_save_first_run_opening_totals', {
        p_calendar_year: budget.calendarYear,
        p_rows: nextRows,
        p_none: nextNone,
      });
      if (rpcError) throw rpcError;
      await persistNoneFlag(nextNone);
      const list = await fetchRows();
      applyServerRows(list, nextNone);
      setPreview(null);
      return true;
    } catch (err: unknown) {
      setError(toUserFacingMessage(err, t, { context: 'first_run', fallback: t('admin.errGeneric') }));
      return false;
    } finally {
      onBusy(false);
    }
  }

  useEffect(() => {
    if (!onNavHandle) return;
    onNavHandle({
      persistDraft: async () => true,
    });
    return () => onNavHandle(null);
  }, [onNavHandle]);

  function downloadTemplate() {
    downloadBuffer(
      buildOpeningTotalsTemplateBuffer(knownArticles, locale),
      localizedTemplateFileName(OPENING_TOTALS_IMPORT_SPEC, locale),
    );
  }

  async function onFile(file: File) {
    setError(null);
    const checked = parseOpeningTotalsMatrix(readFirstSheetMatrix(await file.arrayBuffer()), knownArticles);
    setPreview(checked);
  }

  const previewGrouped = useMemo(
    () => (preview ? buildOpeningPreviewGroups(preview.previewRows) : null),
    [preview],
  );

  const savedRows = useMemo(() => savedPreviewRows(rows, locale), [rows, locale]);
  const savedPositiveCount = useMemo(
    () => savedRows.filter((row) => row.amount != null && row.amount > 0).length,
    [savedRows],
  );
  const savedFactTotal = useMemo(
    () =>
      savedRows.reduce((sum, row) => sum + (row.amount != null && row.amount > 0 ? row.amount : 0), 0),
    [savedRows],
  );

  async function confirmFile() {
    if (!preview || preview.issues.length > 0) return;
    if (preview.rows.length === 0) {
      setError(t('admin.firstRunOpeningNoAmounts'));
      return;
    }
    const nextRows = preview.rows.map((row) => ({
      row: row.row,
      category_id: row.categoryId,
      amount: String(row.amount),
    }));
    await save(false, nextRows);
  }

  async function onSaveNone() {
    const savedNonZero = savedPositiveCount > 0;
    if (savedNonZero) {
      const ok = await confirm({
        title: t('admin.firstRunOpeningNoneConfirmTitle'),
        description: t('admin.firstRunOpeningNoneConfirmBody'),
        confirmLabel: t('admin.firstRunOpeningNoneConfirm'),
        cancelLabel: t('common.cancel'),
        tone: 'danger',
      });
      if (!ok) return;
    }
    await save(true, []);
  }

  async function onContinueClick() {
    if (!saved) return;
    await onContinue(savedNone);
  }

  const showSavedSuccess = saved;

  return (
    <FirstRunScreen
      icon={ScrollText}
      iconClass="text-emerald-800"
      title={t('admin.firstRunStageOpeningExpenses')}
      lead={t('admin.firstRunOpeningLead')}
      busy={busy}
    >
      <p className={styles.hint}>{t('admin.firstRunOpeningImportColumnsHint')}</p>

      <FirstRunStatusStack>
        {error ? <FirstRunStatusBanner tone="error" title={error} /> : null}
        {showSavedSuccess && savedNone ? (
          <FirstRunStatusBanner tone="success" title={t('admin.firstRunOpeningNoneSaved')} />
        ) : null}
        {showSavedSuccess && !savedNone ? (
          <FirstRunStatusBanner
            tone="success"
            title={t('admin.firstRunOpeningSaved')}
            detail={t('admin.firstRunOpeningSavedDetail')
              .replace('{count}', String(savedPositiveCount))
              .replace('{total}', moneyEur(savedFactTotal))}
          />
        ) : null}
      </FirstRunStatusStack>

      {showSavedSuccess && !savedNone && savedPositiveCount > 0 ? (
        <OpeningHierarchyPreview rows={savedRows} t={t} />
      ) : null}

      <div className={styles.importGrid}>
        <div className={styles.stepBlock}>
          <p className={styles.importLabel}>{t('admin.firstRunImportDownload')}</p>
          <button
            type="button"
            className={styles.secondary}
            disabled={busy || rows.length === 0}
            onClick={downloadTemplate}
          >
            {t('admin.firstRunOpeningDownload')}
          </button>
        </div>
        <div className={styles.stepBlock}>
          <p className={styles.importLabel}>{t('admin.firstRunImportUpload')}</p>
          <AppFilePicker
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            disabled={busy || rows.length === 0}
            resetInputAfterChange
            hint={`${t('common.fileHintFormats').replace('{formats}', '.xlsx')} · ${t('admin.firstRunFileReselectHint')}`}
            onChange={(picked) => {
              const file = picked[0];
              if (file) void onFile(file);
            }}
          />
        </div>
        <div className={styles.stepBlock}>
          <p className={styles.importLabel}>{t('admin.firstRunImportCheck')}</p>
          {!preview ? (
            <p className={styles.hint}>{t('admin.firstRunImportCheckPending')}</p>
          ) : (
            <>
              <FirstRunStatusStack>
                {preview.issues.length > 0 ? (
                  <FirstRunStatusBanner
                    tone="error"
                    title={t('admin.firstRunOpeningCheckFailTitle')}
                    detail={`${t('admin.firstRunBudgetImportStatErrors')}: ${preview.issues.length}`}
                  />
                ) : (
                  <FirstRunStatusBanner tone="success" title={t('admin.firstRunOpeningCheckOkTitle')} />
                )}
                {preview.warnings.length > 0 ? (
                  <FirstRunStatusBanner
                    tone="warning"
                    title={t('admin.firstRunOpeningOverPlan')}
                    detail={preview.warnings
                      .slice(0, 8)
                      .map((warn) => {
                        const article =
                          preview.previewRows.find((row) => row.row === warn.row)?.name ||
                          warn.code;
                        return t('admin.firstRunOpeningOverPlanRow')
                          .replace('{row}', String(warn.row))
                          .replace('{code}', article)
                          .replace('{amount}', moneyEur(warn.overBy));
                      })
                      .join('\n')}
                  />
                ) : null}
                {preview.incomplete ? (
                  <FirstRunStatusBanner
                    tone="warning"
                    title={t('admin.firstRunOpeningIncompleteTitle')}
                    detail={t('admin.firstRunOpeningIncompleteBody')}
                  />
                ) : null}
              </FirstRunStatusStack>
              {previewGrouped ? (
                <div className={styles.stats}>
                  <div className={styles.stat}>
                    <div className={styles.statValue}>{preview.previewRows.length}</div>
                    <div className={styles.statLabel}>{t('admin.firstRunBudgetImportStatArticles')}</div>
                  </div>
                  <div className={styles.stat}>
                    <div className={styles.statValue}>{preview.issues.length}</div>
                    <div className={styles.statLabel}>{t('admin.firstRunBudgetImportStatErrors')}</div>
                  </div>
                  <div className={styles.stat}>
                    <div className={styles.statValue}>{preview.warnings.length}</div>
                    <div className={styles.statLabel}>{t('admin.firstRunBudgetImportStatWarnings')}</div>
                  </div>
                </div>
              ) : null}
              <OpeningHierarchyPreview rows={preview.previewRows} t={t} showErrors />
            </>
          )}
        </div>
        <div className={styles.stepBlock}>
          <p className={styles.importLabel}>{t('admin.firstRunImportConfirm')}</p>
          <FirstRunStageActions>
            <button
              type="button"
              className={styles.primary}
              disabled={busy || !preview || preview.issues.length > 0 || preview.rows.length === 0}
              onClick={() => void confirmFile()}
            >
              {busy ? t('admin.firstRunImporting') : t('admin.firstRunOpeningConfirmImport')}
            </button>
          </FirstRunStageActions>
        </div>
      </div>

      <FirstRunStageActions>
        <button type="button" className={styles.secondary} disabled={busy} onClick={() => void onSaveNone()}>
          {t('admin.firstRunOpeningNone')}
        </button>
        <button
          type="button"
          className={styles.primary}
          disabled={busy || !saved}
          onClick={() => void onContinueClick()}
        >
          {busy ? t('admin.firstRunBusy') : t('admin.firstRunOpeningContinue')}
        </button>
      </FirstRunStageActions>
      {dialog}
    </FirstRunScreen>
  );
}
