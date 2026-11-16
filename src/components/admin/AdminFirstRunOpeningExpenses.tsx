'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ScrollText } from 'lucide-react';
import type { Database } from '@/lib/database.types';
import { FirstRunStageActions } from '@/components/admin/FirstRunFrame';
import { FirstRunScreen } from '@/components/admin/FirstRunSteps';
import styles from './FirstRunFrame.module.css';
import { FirstRunStatusBanner, FirstRunStatusStack } from '@/components/admin/FirstRunStatusBanner';
import { AppFilePicker } from '@/components/ui/AppFilePicker';
import { useAppConfirm } from '@/components/ui/AppConfirmDialog';
import { categoryLabel, moneyEur } from '@/lib/budget';
import { parseFirstRunBudgetDraft, saveFirstRunProgress, type FirstRunState } from '@/lib/firstRun';
import { toUserFacingMessage } from '@/lib/userFacingError';
import {
  applyOpeningAmountDraft,
  buildOpeningTotalsTemplateBuffer,
  openingAmountEditBaseline,
  openingPreviewAction,
  parseOpeningTotalsMatrix,
  presentOpeningPreviewAction,
  readFirstSheetMatrix,
  rebuildOpeningTotalParse,
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
  opening_amount_eur: number;
};

type OpeningDraftRow = OpeningTotalPreviewRow & {
  /** Stable key for React + edits (file row number). */
  key: number;
  /** Amount text as loaded from the file (empty stays empty). */
  fileBaseline: string;
  /** Current editable text; may differ from fileBaseline. */
  draftRaw: string;
  edited: boolean;
};

type SavedArticle = {
  category_id: string;
  code: string;
  name: string;
  amount: number;
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

function toDraftRows(parsed: OpeningTotalParse): OpeningDraftRow[] {
  return parsed.previewRows.map((row) => {
    const fileBaseline = openingAmountEditBaseline(row);
    return {
      ...row,
      key: row.row,
      fileBaseline,
      draftRaw: fileBaseline,
      edited: false,
    };
  });
}

function recomputeDraftRow(row: OpeningDraftRow, draftRaw: string): OpeningDraftRow {
  const next = applyOpeningAmountDraft(row, draftRaw);
  return {
    ...next,
    key: row.key,
    fileBaseline: row.fileBaseline,
    draftRaw,
    edited: draftRaw !== row.fileBaseline,
  };
}

function parseFromDrafts(draftRows: OpeningDraftRow[]): OpeningTotalParse {
  return rebuildOpeningTotalParse(draftRows);
}

function parseAmount(raw: string | undefined): number {
  const n = Number(String(raw ?? '').replace(/\s/g, '').replace(',', '.').trim() || '0');
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : Number.NaN;
}

function amountTextFromServer(value: number): string {
  return value > 0 ? String(value) : '';
}

function isDraftNoneFlag(draft: Record<string, unknown>): boolean {
  return ['true', 't', '1', 'yes'].includes(
    String(draft.uk_expenses_opening_none ?? '').trim().toLowerCase(),
  );
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
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [baseline, setBaseline] = useState<Record<string, number>>({});
  const [savedArticles, setSavedArticles] = useState<SavedArticle[]>([]);
  const [savedNone, setSavedNone] = useState(draftNoneFlag);
  const [saved, setSaved] = useState(false);
  const [draftRows, setDraftRows] = useState<OpeningDraftRow[] | null>(null);
  const [bulkConfirm, setBulkConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preview = useMemo(
    () => (draftRows ? parseFromDrafts(draftRows) : null),
    [draftRows],
  );

  const dirty = useMemo(() => {
    if (!saved) return false;
    if (savedNone) {
      // Any positive draft amount leaves the explicit "none" state.
      return rows.some((row) => parseAmount(amounts[row.category_id]) > 0);
    }
    for (const row of rows) {
      const current = parseAmount(amounts[row.category_id]);
      if (!Number.isFinite(current)) return true;
      const base = baseline[row.category_id] ?? 0;
      if (Math.abs(current - base) > 0.0001) return true;
    }
    return false;
  }, [amounts, baseline, rows, saved, savedNone]);

  const formOverPlan = useMemo(
    () =>
      rows.filter((row) => {
        const spent = parseAmount(amounts[row.category_id]);
        return Number.isFinite(spent) && spent - row.planned_amount_eur > 0.000001;
      }),
    [amounts, rows],
  );

  const applyServerRows = useCallback(
    (list: OpeningRow[], noneFlag: boolean) => {
      setRows(list);
      const nextAmounts: Record<string, string> = {};
      const nextBaseline: Record<string, number> = {};
      const articles: SavedArticle[] = [];
      for (const row of list) {
        const amount = Number(row.opening_amount_eur) || 0;
        nextBaseline[row.category_id] = amount;
        nextAmounts[row.category_id] = amountTextFromServer(amount);
        if (amount > 0) {
          articles.push({
            category_id: row.category_id,
            code: row.code,
            name: categoryLabel(row, locale),
            amount,
          });
        }
      }
      setAmounts(nextAmounts);
      setBaseline(nextBaseline);
      setSavedArticles(articles);
      const hasPositive = articles.length > 0;
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
    [locale],
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
      opening_amount_eur: Number(row.opening_amount_eur),
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

  function payloadRows() {
    return rows.map((row, index) => ({
      row: index + 2,
      category_id: row.category_id,
      amount: (amounts[row.category_id] ?? '').trim() || '0',
    }));
  }

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
    opts?: { quiet?: boolean },
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
      setDraftRows(null);
      setBulkConfirm(false);
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
      persistDraft: async () => {
        if (!saved && !dirty) return true;
        if (!dirty) return true;
        return save(false, payloadRows(), { quiet: true });
      },
    });
    return () => onNavHandle(null);
    // payloadRows/save close over latest amounts/rows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onNavHandle, amounts, rows, budget.calendarYear, saved, dirty, savedNone]);

  function downloadTemplate() {
    downloadBuffer(
      buildOpeningTotalsTemplateBuffer(
        rows.map((row) => ({
          code: row.code,
          name: categoryLabel(row, locale),
          planned: row.planned_amount_eur,
        })),
        locale,
      ),
      localizedTemplateFileName(OPENING_TOTALS_IMPORT_SPEC, locale),
    );
  }

  async function onFile(file: File) {
    setError(null);
    setBulkConfirm(false);
    const checked = parseOpeningTotalsMatrix(
      readFirstSheetMatrix(await file.arrayBuffer()),
      rows.map((row) => ({
        code: row.code,
        name: categoryLabel(row, locale),
        planned: row.planned_amount_eur,
      })),
    );
    setDraftRows(toDraftRows(checked));
  }

  function updateDraftAmount(key: number, draftRaw: string) {
    setBulkConfirm(false);
    setDraftRows((current) => {
      if (!current) return current;
      return current.map((row) => (row.key === key ? recomputeDraftRow(row, draftRaw) : row));
    });
  }

  function setDraftZero(key: number) {
    updateDraftAmount(key, '0');
  }

  function restoreFileValue(key: number) {
    setBulkConfirm(false);
    setDraftRows((current) => {
      if (!current) return current;
      return current.map((row) =>
        row.key === key ? recomputeDraftRow(row, row.fileBaseline) : row,
      );
    });
  }

  const emptyAmountKeys = useMemo(
    () => (draftRows ?? []).filter((row) => row.draftRaw.trim() === '').map((row) => row.key),
    [draftRows],
  );

  function applyBulkZeros() {
    setDraftRows((current) => {
      if (!current) return current;
      const empty = new Set(emptyAmountKeys);
      return current.map((row) =>
        empty.has(row.key) ? recomputeDraftRow(row, '0') : row,
      );
    });
    setBulkConfirm(false);
  }

  function issueReasonText(issue: Pick<OpeningTotalIssue, 'reason' | 'raw'>): string {
    if (issue.reason === 'required_amount') {
      return t('admin.firstRunOpeningAmountRequired');
    }
    if (issue.reason === 'unknown_code') {
      return t('admin.firstRunOpeningUnknown');
    }
    return t(`admin.firstRunBudgetImport_${issue.reason}`).replace('{value}', issue.raw ?? '');
  }

  function rowCheckText(row: OpeningDraftRow): string {
    const parts: string[] = [];
    for (const reason of row.issues) {
      parts.push(issueReasonText({ reason, raw: row.amountRaw }));
    }
    for (const warning of row.warnings) {
      if (warning === 'over_plan') {
        parts.push(
          t('admin.firstRunOpeningOverPlanDetail').replace(
            '{amount}',
            moneyEur(row.overBy ?? 0),
          ),
        );
      }
    }
    return parts.join(' · ') || '—';
  }

  const previewSummary = useMemo(() => {
    if (!preview) return null;
    const planTotal = preview.previewRows.reduce(
      (sum, row) => sum + (row.planned != null ? row.planned : 0),
      0,
    );
    const spentTotal = preview.rows.reduce((sum, row) => sum + row.amount, 0);
    const incomplete = preview.previewRows.some((row) => row.amount == null);
    return {
      articles: preview.previewRows.length,
      errors: preview.issues.length,
      warnings: preview.warnings.length,
      planTotal,
      spentTotal,
      incomplete,
    };
  }, [preview]);

  const savedTotal = useMemo(
    () => savedArticles.reduce((sum, row) => sum + row.amount, 0),
    [savedArticles],
  );

  async function confirmFile() {
    if (!preview || !draftRows || preview.issues.length > 0 || preview.rows.length === 0) return;
    const checked = parseFromDrafts(draftRows);
    if (checked.issues.length > 0 || checked.rows.length === 0) {
      setDraftRows(toDraftRows(checked));
      setError(t('admin.firstRunOpeningCheckFailTitle'));
      return;
    }
    const byCode = new Map(rows.map((row) => [row.code.toLowerCase(), row]));
    const nextRows: Array<{ row: number; category_id: string; amount: string }> = [];
    for (const row of checked.rows) {
      const known = byCode.get(row.code.toLowerCase());
      if (!known) {
        setError(t('admin.firstRunOpeningUnknown'));
        return;
      }
      nextRows.push({
        row: row.row,
        category_id: known.category_id,
        amount: String(row.amount),
      });
    }
    await save(false, nextRows);
  }

  async function onSaveAmounts() {
    await save(false, payloadRows());
  }

  async function onSaveNone() {
    const savedNonZero = savedArticles.length > 0;
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
    if (!dirty) {
      await onContinue(savedNone);
      return;
    }
    const saveFirst = await confirm({
      title: t('admin.firstRunOpeningUnsavedTitle'),
      description: t('admin.firstRunOpeningUnsavedBody'),
      confirmLabel: t('admin.firstRunOpeningSaveAndContinue'),
      cancelLabel: t('common.cancel'),
    });
    if (!saveFirst) return;
    const ok = await save(false, payloadRows());
    if (!ok) return;
    await onContinue(false);
  }

  async function onContinueWithoutSaving() {
    if (!saved || !dirty) return;
    await onContinue(savedNone);
  }

  const showSavedSuccess = saved && !dirty;

  return (
    <FirstRunScreen
      icon={ScrollText}
      iconClass="text-emerald-800"
      title={t('admin.firstRunStageOpeningExpenses')}
      lead={t('admin.firstRunOpeningLead')}
      busy={busy}
    >
      <p className={styles.hint}>{t('admin.budgetPlanRemainderHint')}</p>

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
              .replace('{count}', String(savedArticles.length))
              .replace('{total}', moneyEur(savedTotal))}
          />
        ) : null}
        {dirty ? (
          <FirstRunStatusBanner tone="warning" title={t('admin.firstRunOpeningUnsavedChanges')}>
            <FirstRunStageActions>
              <button
                type="button"
                className={styles.secondary}
                disabled={busy}
                onClick={() => void onContinueWithoutSaving()}
              >
                {t('admin.firstRunOpeningContinueWithoutSave')}
              </button>
            </FirstRunStageActions>
          </FirstRunStatusBanner>
        ) : null}
      </FirstRunStatusStack>

      {showSavedSuccess && !savedNone && savedArticles.length > 0 ? (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{t('admin.firstRunBudgetImportColCode')}</th>
                <th>{t('admin.firstRunOpeningColName')}</th>
                <th>{t('admin.firstRunOpeningColAmount')}</th>
              </tr>
            </thead>
            <tbody>
              {savedArticles.map((row) => (
                <tr key={`saved-opening-${row.category_id}`}>
                  <td>{row.code}</td>
                  <td>{row.name}</td>
                  <td>{moneyEur(row.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {formOverPlan.length > 0 ? (
        <div className={styles.stepBlock}>
          <FirstRunStatusBanner
            tone="warning"
            title={t('admin.firstRunOpeningOverPlan')}
            detail={formOverPlan
              .slice(0, 8)
              .map((row) => {
                const spent = parseAmount(amounts[row.category_id]);
                return `${row.code}: ${moneyEur(spent - row.planned_amount_eur)}`;
              })
              .join('\n')}
          />
        </div>
      ) : null}

      <div className={styles.importGrid}>
        <div className={styles.stepBlock}>
          <p className={styles.importLabel}>{t('admin.firstRunImportDownload')}</p>
          <button type="button" className={styles.secondary} disabled={busy || rows.length === 0} onClick={downloadTemplate}>
            {t('admin.firstRunOpeningDownload')}
          </button>
          <p className={styles.hint}>{t('admin.firstRunOpeningImportColumnsHint')}</p>
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
          {!preview || !draftRows ? (
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
                    title={`${t('admin.firstRunBudgetImportStatWarnings')}: ${preview.warnings.length}`}
                    detail={preview.warnings
                      .slice(0, 8)
                      .map((warn) =>
                        t('admin.firstRunOpeningOverPlanRow')
                          .replace('{row}', String(warn.row))
                          .replace('{code}', warn.code)
                          .replace('{amount}', moneyEur(warn.overBy)),
                      )
                      .join('\n')}
                  />
                ) : null}
              </FirstRunStatusStack>
              {previewSummary ? (
                <div className={styles.stats}>
                  <div className={styles.stat}>
                    <div className={styles.statValue}>{previewSummary.articles}</div>
                    <div className={styles.statLabel}>{t('admin.firstRunBudgetImportStatArticles')}</div>
                  </div>
                  <div className={styles.stat}>
                    <div className={styles.statValue}>{previewSummary.errors}</div>
                    <div className={styles.statLabel}>{t('admin.firstRunBudgetImportStatErrors')}</div>
                  </div>
                  <div className={styles.stat}>
                    <div className={styles.statValue}>{previewSummary.warnings}</div>
                    <div className={styles.statLabel}>{t('admin.firstRunBudgetImportStatWarnings')}</div>
                  </div>
                </div>
              ) : null}
              {previewSummary ? (
                <>
                  <p className={styles.okNote}>
                    {t('admin.firstRunOpeningPlanTotal').replace(
                      '{total}',
                      moneyEur(previewSummary.planTotal),
                    )}
                  </p>
                  {previewSummary.incomplete ? (
                    <p className={styles.hint}>
                      {t('admin.firstRunOpeningSpentPartial').replace(
                        '{total}',
                        moneyEur(previewSummary.spentTotal),
                      )}
                    </p>
                  ) : (
                    <p className={styles.okNote}>
                      {t('admin.firstRunOpeningSpentTotal').replace(
                        '{total}',
                        moneyEur(previewSummary.spentTotal),
                      )}
                    </p>
                  )}
                </>
              ) : null}
              {emptyAmountKeys.length > 0 ? (
                <div className={styles.bulkZeroBar}>
                  {!bulkConfirm ? (
                    <button
                      type="button"
                      className={styles.secondary}
                      disabled={busy}
                      onClick={() => setBulkConfirm(true)}
                    >
                      {t('admin.firstRunOpeningBulkZero').replace('{n}', String(emptyAmountKeys.length))}
                    </button>
                  ) : (
                    <>
                      <p className={styles.hint}>{t('admin.firstRunOpeningBulkZeroConfirm')}</p>
                      <button type="button" className={styles.primary} disabled={busy} onClick={applyBulkZeros}>
                        {t('admin.firstRunOpeningBulkZeroApply')}
                      </button>
                      <button type="button" className={styles.secondary} disabled={busy} onClick={() => setBulkConfirm(false)}>
                        {t('admin.firstRunOpeningBulkZeroCancel')}
                      </button>
                    </>
                  )}
                </div>
              ) : null}
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>{t('admin.firstRunOpeningColRow')}</th>
                      <th>{t('admin.firstRunBudgetImportColCode')}</th>
                      <th>{t('admin.firstRunOpeningColName')}</th>
                      <th>{t('admin.firstRunOpeningColPlan')}</th>
                      <th>{t('admin.firstRunOpeningColSpent')}</th>
                      <th>{t('admin.firstRunOpeningColRemainder')}</th>
                      <th>{t('admin.firstRunSfColAction')}</th>
                      <th>{t('admin.firstRunOpeningColCheck')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {draftRows.map((row) => {
                      const hasError = row.issues.length > 0;
                      const hasWarn = !hasError && row.warnings.length > 0;
                      const amountError = row.issues.some((reason) =>
                        ['required_amount', 'invalid_amount', 'negative_amount', 'amount_precision'].includes(
                          reason,
                        ),
                      );
                      const isEmpty = row.draftRaw.trim() === '';
                      const cat = rows.find((r) => r.code.toLowerCase() === row.code.toLowerCase());
                      const baselineAmt = cat ? baseline[cat.category_id] : undefined;
                      const action = openingPreviewAction(baselineAmt, row.amount, hasError);
                      const spentDisplay =
                        row.amount != null
                          ? moneyEur(row.amount)
                          : isEmpty
                            ? '—'
                            : row.draftRaw;
                      return (
                        <tr
                          key={`opening-preview-${row.key}-${row.code}`}
                          className={
                            hasError ? styles.tableRowError : hasWarn ? styles.tableRowWarn : undefined
                          }
                        >
                          <td>{row.row}</td>
                          <td>{row.code || '—'}</td>
                          <td>{row.name || '—'}</td>
                          <td>{row.planned != null ? moneyEur(row.planned) : '—'}</td>
                          <td>
                            <div className={styles.amountEdit}>
                              <input
                                className={`${styles.amountEditInput}${amountError ? ` ${styles.amountEditInputError}` : ''}`}
                                inputMode="decimal"
                                value={row.draftRaw}
                                placeholder=""
                                aria-label={`${t('admin.firstRunOpeningColSpent')} ${row.code}`}
                                disabled={busy}
                                onChange={(e) => updateDraftAmount(row.key, e.target.value)}
                              />
                              <div className={styles.amountEditActions}>
                                {isEmpty ? (
                                  <button
                                    type="button"
                                    className={styles.amountEditBtn}
                                    disabled={busy}
                                    title={t('admin.firstRunOpeningSetZeroHint')}
                                    onClick={() => setDraftZero(row.key)}
                                  >
                                    {t('admin.firstRunOpeningSetZero')}
                                  </button>
                                ) : null}
                                {row.edited ? (
                                  <button
                                    type="button"
                                    className={styles.amountEditBtn}
                                    disabled={busy}
                                    onClick={() => restoreFileValue(row.key)}
                                  >
                                    {t('admin.firstRunOpeningRestoreFile')}
                                  </button>
                                ) : null}
                              </div>
                              {!isEmpty || row.amount === 0 ? (
                                <p className={styles.amountEditHint}>{spentDisplay}</p>
                              ) : (
                                <p className={styles.amountEditHint}>{t('admin.firstRunOpeningSetZeroHint')}</p>
                              )}
                            </div>
                          </td>
                          <td>
                            {row.remainder != null ? moneyEur(row.remainder) : '—'}
                          </td>
                          <td>{presentOpeningPreviewAction(action, t)}</td>
                          <td
                            className={
                              hasError ? styles.fieldError : hasWarn ? styles.warnNoteInline : undefined
                            }
                          >
                            {row.edited ? (
                              <span className={styles.editedMark}>{t('admin.firstRunOpeningEdited')}</span>
                            ) : null}
                            {rowCheckText(row)}
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
              disabled={busy || !preview || preview.issues.length > 0 || preview.rows.length === 0}
              onClick={() => void confirmFile()}
            >
              {busy ? t('admin.firstRunImporting') : t('admin.firstRunBudgetImportConfirm')}
            </button>
          </FirstRunStageActions>
        </div>
      </div>
      <div className={styles.formGrid}>
        {rows.map((row) => {
          const spent = parseAmount(amounts[row.category_id]);
          const over = Number.isFinite(spent) && spent - row.planned_amount_eur > 0.000001;
          return (
            <label key={row.category_id} className={styles.field}>
              {row.code} · {categoryLabel(row, locale)} · {t('admin.firstRunOpeningPlan')} {moneyEur(row.planned_amount_eur)}
              <input
                className={styles.input}
                inputMode="decimal"
                value={amounts[row.category_id] ?? ''}
                placeholder="0"
                onChange={(e) => {
                  setAmounts((current) => ({ ...current, [row.category_id]: e.target.value }));
                }}
              />
              {over ? <span className={styles.warnNote}>{t('admin.firstRunOpeningOverPlan')}</span> : null}
            </label>
          );
        })}
      </div>
      <FirstRunStageActions>
        <button type="button" className={styles.primary} disabled={busy} onClick={() => void onSaveAmounts()}>
          {t('admin.firstRunOpeningSave')}
        </button>
        <p className={`${styles.hint} ${styles.span2}`}>{t('admin.firstRunOpeningSaveHint')}</p>
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
