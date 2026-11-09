'use client';

import type { ImportPreviewResult } from '@/lib/moduleCore/types';
import {
  downloadInventoryOpeningTemplate,
  inventoryCommitConfirmedSavedCount,
  inventoryCommitUiSummary,
  unsavedInventoryCommitOutcomes,
  type InventoryCommitBatchResult,
} from '@/lib/inventory';
import {
  groupInventoryOpeningPreviewByCategory,
  inventoryOpeningCatalogCreates,
  inventoryOpeningUniqueCategoryCount,
  inventoryOpeningWarningCount,
} from '@/lib/inventory/openingPreview';
import { presentInventoryOpeningIssue } from '@/lib/inventory/openingMessages';
import {
  isInventoryCatalogCreateWarning,
  presentInventoryCommitDetail,
  presentInventoryCondition,
  presentInventoryUnit,
} from '@/lib/inventory/openingLabels';
import {
  adminBtnPrimaryClass,
  adminBtnSecondaryClass,
  adminTableCellClass,
  adminTableHeadRowClass,
  adminTableRowClass,
} from '@/components/admin/AdminUi';
import styles from './FirstRunFrame.module.css';
import { AppFilePicker, formatAcceptHint } from '@/components/ui/AppFilePicker';
import { useI18n } from '@/i18n/I18nProvider';

type TFn = (key: string, vars?: Record<string, string>) => string;

export type InventoryOpeningPath = 'choose' | 'import' | 'empty';

type Props = {
  t: TFn;
  busy: boolean;
  path: InventoryOpeningPath;
  onPathChange: (path: InventoryOpeningPath) => void;
  preview: ImportPreviewResult | null;
  previewNote: string | null;
  batchId: string | null;
  commitResult: InventoryCommitBatchResult | null;
  importCommitted: boolean;
  onDownloadTemplate: () => void;
  onFile: (file: File | null) => void;
  onConfirmImport: () => void;
  onRetryImport?: () => void;
  onConfirmEmpty: () => void;
  onGoActivate: () => void;
  /** Data saved; lifecycle not READY yet — retry completion only (no re-import). */
  setupCompletionPending?: boolean;
  onRetrySetupCompletion?: () => void;
  /** Restoring commit summary from server after refresh. */
  restoreLoading?: boolean;
};

export function AdminInventoryOpeningPanel({
  t,
  busy,
  path,
  onPathChange,
  preview,
  previewNote,
  batchId,
  commitResult,
  importCommitted,
  onDownloadTemplate,
  onFile,
  onConfirmImport,
  onRetryImport,
  onConfirmEmpty,
  onGoActivate,
  setupCompletionPending = false,
  onRetrySetupCompletion,
  restoreLoading = false,
}: Props) {
  const { locale } = useI18n();
  const warningCount = preview ? inventoryOpeningWarningCount(preview) : 0;
  const categoryCount = preview ? inventoryOpeningUniqueCategoryCount(preview) : 0;
  const groups = preview ? groupInventoryOpeningPreviewByCategory(preview) : [];
  const creates = preview ? inventoryOpeningCatalogCreates(preview) : { categories: [], locations: [] };
  const canImport =
    !!preview &&
    !!batchId &&
    preview.errorCount === 0 &&
    !importCommitted &&
    !busy &&
    !setupCompletionPending;
  const confirmedSaved = commitResult ? inventoryCommitConfirmedSavedCount(commitResult) : 0;
  const uiSummary = commitResult ? inventoryCommitUiSummary(commitResult) : null;
  const unsaved = commitResult ? unsavedInventoryCommitOutcomes(commitResult) : [];
  const previewByRow = new Map((preview?.rows ?? []).map((r) => [r.rowNumber, r]));

  if (path === 'choose') {
    return (
      <div className="space-y-4">
        <p className="text-sm text-secondary">{t('admin.inv6Lead')}</p>
        <div className="grid gap-3 md:grid-cols-2">
          <button
            type="button"
            disabled={busy}
            className="rounded-xl border border-border bg-surface px-4 py-4 text-left transition hover:border-accent/40 hover:bg-accent-bg/40"
            onClick={() => onPathChange('import')}
          >
            <p className="text-sm font-semibold text-foreground">{t('admin.inv6ChoiceImport')}</p>
            <p className="mt-1 text-xs text-secondary">{t('admin.inv6ChoiceImportHint')}</p>
          </button>
          <button
            type="button"
            disabled={busy}
            className="rounded-xl border border-border bg-surface px-4 py-4 text-left transition hover:border-accent/40 hover:bg-accent-bg/40"
            onClick={() => onPathChange('empty')}
          >
            <p className="text-sm font-semibold text-foreground">{t('admin.inv6ChoiceEmpty')}</p>
            <p className="mt-1 text-xs text-secondary">{t('admin.inv6ChoiceEmptyHint')}</p>
          </button>
        </div>
      </div>
    );
  }

  if (path === 'empty') {
    return (
      <div className="space-y-4">
        <button
          type="button"
          className={adminBtnSecondaryClass}
          disabled={busy}
          onClick={() => onPathChange('choose')}
        >
          {t('admin.moduleSetupBack')}
        </button>
        <div className="rounded-xl border border-border p-4 space-y-3">
          <p className="text-sm font-semibold text-foreground">{t('admin.inv6ChoiceEmpty')}</p>
          <p className="text-sm text-secondary">{t('admin.inv6EmptyConfirmLead')}</p>
          <button
            type="button"
            className={adminBtnPrimaryClass}
            disabled={busy}
            onClick={onConfirmEmpty}
          >
            {t('admin.inv6EmptyConfirmButton')}
          </button>
        </div>
      </div>
    );
  }

  // import path
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={adminBtnSecondaryClass}
          disabled={busy || importCommitted}
          onClick={() => onPathChange('choose')}
        >
          {t('admin.moduleSetupBack')}
        </button>
      </div>

      <p className="text-sm text-secondary">{t('admin.inv6ImportLead')}</p>

      <div className={styles.importGrid}>
        <div className={styles.stepBlock}>
          <p className={styles.importLabel}>{t('admin.firstRunImportDownload')}</p>
          <button
            type="button"
            className={adminBtnSecondaryClass}
            disabled={busy}
            onClick={() => {
              downloadInventoryOpeningTemplate(locale);
              onDownloadTemplate();
            }}
          >
            {t('admin.inv6DownloadTemplate')}
          </button>
          <p className="mt-2 text-xs text-muted">{t('admin.inv6XlsxInstructions')}</p>
        </div>

        <div className={styles.stepBlock}>
          <p className={styles.importLabel}>{t('admin.firstRunImportUpload')}</p>
          <AppFilePicker
            accept=".xlsx,.xls"
            disabled={busy || importCommitted}
            resetInputAfterChange
            hint={
              importCommitted
                ? undefined
                : `${t('common.fileHintFormats').replace('{formats}', formatAcceptHint('.xlsx,.xls'))} · ${t('admin.firstRunFileReselectHint')}`
            }
            onChange={(picked) => onFile(picked[0] ?? null)}
          />
        </div>

        <div className={styles.stepBlock}>
          <p className={styles.importLabel}>{t('admin.firstRunImportCheck')}</p>
          {preview ? (
            <div className="space-y-2">
              <div className={styles.stats}>
                <div>
                  <p className="text-lg font-semibold text-foreground">{preview.rows.length}</p>
                  <p className="text-xs text-muted">{t('admin.inv6StatItems')}</p>
                </div>
                <div>
                  <p className="text-lg font-semibold text-foreground">{categoryCount}</p>
                  <p className="text-xs text-muted">{t('admin.inv6StatCategories')}</p>
                </div>
                <div>
                  <p className={`text-lg font-semibold ${preview.errorCount ? 'text-danger' : 'text-foreground'}`}>
                    {preview.errorCount}
                  </p>
                  <p className="text-xs text-muted">{t('admin.inv6StatErrors')}</p>
                </div>
                <div>
                  <p className={`text-lg font-semibold ${warningCount ? 'text-warning' : 'text-foreground'}`}>
                    {warningCount}
                  </p>
                  <p className="text-xs text-muted">{t('admin.inv6StatWarnings')}</p>
                </div>
              </div>

              {creates.categories.length > 0 || creates.locations.length > 0 ? (
                <div className="rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-foreground">
                  <p className="font-semibold">{t('admin.inv6WillCreateTitle')}</p>
                  {creates.categories.length > 0 ? (
                    <p className="mt-1">
                      {t('admin.inv6WillCreateCategories')}: {creates.categories.join(', ')}
                    </p>
                  ) : null}
                  {creates.locations.length > 0 ? (
                    <p className="mt-1">
                      {t('admin.inv6WillCreateLocations')}: {creates.locations.join(', ')}
                    </p>
                  ) : null}
                </div>
              ) : null}

              <div className="max-h-80 space-y-3 overflow-auto">
                {groups.map((g) => (
                  <div key={g.categoryKey} className="rounded-lg border border-border">
                    <div className="flex items-center justify-between gap-2 border-b border-border bg-surface-secondary px-3 py-2">
                      <p className="text-sm font-semibold text-foreground">
                        {g.categoryLabel}
                        {g.willCreateCategory ? (
                          <span className="ml-2 text-xs font-normal text-warning">
                            ({t('admin.inv6NewCatalog')})
                          </span>
                        ) : null}
                      </p>
                      <p className="text-xs text-muted">{g.rows.length}</p>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[36rem] text-xs">
                        <thead>
                          <tr className={adminTableHeadRowClass}>
                            <th className={adminTableCellClass}>#</th>
                            <th className={adminTableCellClass}>{t('admin.inv6Col_item_name')}</th>
                            <th className={adminTableCellClass}>{t('admin.inv6Col_inventory_number')}</th>
                            <th className={adminTableCellClass}>{t('admin.inv6Col_location_code')}</th>
                            <th className={adminTableCellClass}>{t('admin.inv6Col_quantity')}</th>
                            <th className={adminTableCellClass}>{t('admin.inv6Col_unit_code')}</th>
                            <th className={adminTableCellClass}>{t('admin.inv6Col_condition')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {g.rows.map((row) => {
                            const rowWarns = (row.warnings ?? []).filter(
                              (w) => !isInventoryCatalogCreateWarning(w),
                            );
                            const hasErr = row.errors.length > 0;
                            const hasWarn = rowWarns.length > 0;
                            const isAsset = row.data.tracking_type === 'INDIVIDUAL_ASSET';
                            const isStock = row.data.tracking_type === 'QUANTITY_STOCK';
                            const qty = isStock
                              ? row.data.opening_qty || row.data.quantity || '—'
                              : isAsset
                                ? '1'
                                : '—';
                            const unitRaw = isStock
                              ? row.data.unit_code || ''
                              : isAsset
                                ? 'pcs'
                                : '';
                            const unit = unitRaw ? presentInventoryUnit(unitRaw, t) : '—';
                            const qtyDisplay =
                              qty !== '—' && unit !== '—' ? `${qty} ${unit}` : qty;
                            const invNo = isAsset
                              ? row.data.inventory_number || '—'
                              : isStock
                                ? row.data.sku_code || '—'
                                : '—';
                            return (
                              <tr
                                key={`${row.rowNumber}-${row.matchKey ?? ''}`}
                                className={`${adminTableRowClass} ${
                                  hasErr ? 'bg-danger/5' : hasWarn ? 'bg-warning/5' : ''
                                }`}
                              >
                                <td className={adminTableCellClass}>{row.rowNumber}</td>
                                <td className={adminTableCellClass}>{row.data.item_name || '—'}</td>
                                <td className={adminTableCellClass}>{invNo}</td>
                                <td className={adminTableCellClass}>
                                  {row.data.location_label || row.data.location_code || '—'}
                                  {row.data.will_create_location === 'true' ? (
                                    <span className="ml-1 text-warning">*</span>
                                  ) : null}
                                </td>
                                <td className={adminTableCellClass}>{qtyDisplay}</td>
                                <td className={adminTableCellClass}>{isStock ? unit : '—'}</td>
                                <td className={adminTableCellClass}>
                                  {isAsset
                                    ? presentInventoryCondition(row.data.condition || 'good', t)
                                    : '—'}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    {g.rows.some(
                      (r) =>
                        r.errors.length ||
                        (r.warnings ?? []).some((w) => !isInventoryCatalogCreateWarning(w)),
                    ) ? (
                      <ul className="space-y-1 border-t border-border px-3 py-2 text-xs">
                        {g.rows.flatMap((r) => [
                          ...r.errors.map((code) => (
                            <li key={`${r.rowNumber}-e-${code}`} className="text-danger">
                              {t('admin.inv6IssueLine')
                                .replace('{row}', String(r.rowNumber))
                                .replace('{field}', fieldHint(code, t))
                                .replace('{reason}', presentInventoryOpeningIssue(code, t))}
                            </li>
                          )),
                          ...(r.warnings ?? [])
                            .filter((code) => !isInventoryCatalogCreateWarning(code))
                            .map((code) => (
                              <li key={`${r.rowNumber}-w-${code}`} className="text-warning">
                                {t('admin.inv6IssueLine')
                                  .replace('{row}', String(r.rowNumber))
                                  .replace('{field}', fieldHint(code, t))
                                  .replace('{reason}', presentInventoryOpeningIssue(code, t))}
                              </li>
                            )),
                        ])}
                      </ul>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted">{t('admin.firstRunImportCheckPending')}</p>
          )}
        </div>

        <div className={styles.stepBlock}>
          <p className={styles.importLabel}>{t('admin.firstRunImportConfirm')}</p>
          {restoreLoading ? (
            <p className="text-sm text-secondary">{t('admin.inv6CheckingImportResult')}</p>
          ) : setupCompletionPending && importCommitted ? (
            <div className="space-y-3">
              <div className="rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm text-foreground">
                {t('admin.inv6ImportSuccessBanner').replace(
                  '{n}',
                  String(confirmedSaved || uiSummary?.total || '—'),
                )}
              </div>
              <div className="rounded-lg border border-warning/40 bg-warning/5 px-3 py-2 text-sm text-foreground">
                {t('admin.inv6DataSavedSetupIncomplete')}
              </div>
              {onRetrySetupCompletion ? (
                <button
                  type="button"
                  className={adminBtnPrimaryClass}
                  disabled={busy}
                  onClick={onRetrySetupCompletion}
                >
                  {t('admin.inv6RetrySetupCompletion')}
                </button>
              ) : null}
            </div>
          ) : importCommitted && commitResult?.fullySuccessful ? (
            <div className="space-y-3">
              <div className="rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm text-foreground">
                {t('admin.inv6ImportSuccessBanner').replace('{n}', String(confirmedSaved))}
              </div>
              <p className="text-xs text-secondary">{t('admin.inv6ImportSuccessNext')}</p>
              <button type="button" className={adminBtnPrimaryClass} disabled={busy} onClick={onGoActivate}>
                {t('admin.moduleSetupNext')}
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <button
                type="button"
                className={adminBtnPrimaryClass}
                disabled={!canImport}
                onClick={onConfirmImport}
              >
                {busy ? t('admin.firstRunImporting') : t('admin.inv6ConfirmButton')}
              </button>
              {preview && preview.errorCount > 0 ? (
                <p className="text-xs text-danger">{t('admin.inv6FixErrors')}</p>
              ) : null}
              {commitResult && !commitResult.fullySuccessful && uiSummary ? (
                <div className="space-y-2 rounded-lg border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-foreground">
                  <p>
                    {t('admin.inv6SavedOfTotal')
                      .replace(
                        '{saved}',
                        String(inventoryCommitConfirmedSavedCount(commitResult)),
                      )
                      .replace('{total}', String(uiSummary.total))}
                  </p>
                  <p>{t('admin.inv6AlreadySaved').replace('{n}', String(uiSummary.alreadySaved))}</p>
                  <p>{t('admin.inv6NotSaved').replace('{n}', String(uiSummary.notSaved))}</p>
                  {unsaved.length > 0 ? (
                    <ul className="mt-2 max-h-48 space-y-1 overflow-auto border-t border-border/60 pt-2">
                      {unsaved.map((r) => {
                        const prow = previewByRow.get(r.rowNumber);
                        const name = prow?.data.item_name || r.matchKey || '—';
                        const idLabel =
                          r.trackingType === 'QUANTITY_STOCK' ||
                          prow?.data.tracking_type === 'QUANTITY_STOCK'
                            ? prow?.data.sku_code || r.matchKey || '—'
                            : prow?.data.inventory_number || r.matchKey || '—';
                        const { reason, action } = presentInventoryCommitDetail(r.detail, t);
                        return (
                          <li key={`unsaved-${r.rowNumber}`} className="text-danger">
                            {t('admin.inv6UnsavedLine')
                              .replace('{row}', String(r.rowNumber))
                              .replace('{name}', name)
                              .replace('{id}', idLabel)
                              .replace('{reason}', reason)
                              .replace('{action}', action)}
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}
                </div>
              ) : null}
              {commitResult && !commitResult.fullySuccessful && onRetryImport ? (
                <button
                  type="button"
                  className={adminBtnSecondaryClass}
                  disabled={busy || unsaved.length === 0}
                  onClick={onRetryImport}
                >
                  {t('admin.inv6RetryMissing')}
                </button>
              ) : null}
              {previewNote && !(commitResult && !commitResult.fullySuccessful) ? (
                <p className="text-xs text-muted">{previewNote}</p>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function fieldHint(code: string, t: TFn): string {
  if (code.includes('tracking')) return t('admin.inv6Col_tracking_type');
  if (code.includes('item_name')) return t('admin.inv6Col_item_name');
  if (code.includes('ownership')) return t('admin.inv6Col_ownership_kind');
  if (code.includes('inventory_number')) return t('admin.inv6Col_inventory_number');
  if (code.includes('condition')) return t('admin.inv6Col_condition');
  if (code.includes('unit')) return t('admin.inv6Col_unit_code');
  if (code.includes('opening_qty') || code.includes('quantity')) return t('admin.inv6Col_opening_qty');
  if (code.includes('category')) return t('admin.inv6Col_category_code');
  if (code.includes('location')) return t('admin.inv6Col_location_code');
  if (code.includes('sku')) return t('admin.inv6Col_sku_code');
  return '—';
}
