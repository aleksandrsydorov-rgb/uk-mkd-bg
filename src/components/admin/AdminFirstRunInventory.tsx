'use client';

import { useCallback, useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { Package } from 'lucide-react';
import { FirstRunStageActions } from '@/components/admin/FirstRunFrame';
import { FirstRunScreen } from '@/components/admin/FirstRunSteps';
import { FirstRunErrorNote } from '@/components/admin/FirstRunFinance';
import { FirstRunStatusBanner, FirstRunStatusStack } from '@/components/admin/FirstRunStatusBanner';
import { AppFilePicker, formatAcceptHint } from '@/components/ui/AppFilePicker';
import styles from './FirstRunFrame.module.css';
import {
  completeFirstRunStage,
  saveFirstRunProgress,
  type FirstRunState,
} from '@/lib/firstRun';
import { toUserFacingMessage } from '@/lib/userFacingError';
import { useI18n } from '@/i18n/I18nProvider';
import type { ImportPreviewResult } from '@/lib/moduleCore/types';
import {
  INVENTORY_MODULE_KEY,
  INVENTORY_SETUP_SCHEMA_VERSION,
  classifyInventoryOpeningRows,
  commitInventoryOpeningBatch,
  downloadInventoryOpeningTemplate,
  groupInventoryOpeningPreviewByCategory,
  inventoryCommitConfirmedSavedCount,
  inventoryOpeningIdempotencyKey,
  inventoryOpeningWarningCount,
  parseInventoryOpeningXlsxBuffer,
  presentInventoryOpeningIssue,
  presentInventoryUnit,
  type InventoryCommitBatchResult,
} from '@/lib/inventory';
import {
  buildInventoryOpeningImportFns,
  countInventoryRegister,
  loadInventoryOpeningClassifyContext,
} from '@/lib/inventory/openingClient';

export type FirstRunInventoryNavHandle = {
  persistDraft: () => Promise<boolean>;
  hasPendingFile: () => boolean;
};

type UntypedRpc = {
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{
    data: unknown;
    error: { message: string } | null;
  }>;
};

function untyped(supabase: SupabaseClient<Database>): UntypedRpc {
  return supabase as unknown as UntypedRpc;
}

function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function truthy(v: unknown): boolean {
  const s = String(v ?? '')
    .trim()
    .toLowerCase();
  return s === 'true' || s === 't' || s === '1' || s === 'yes';
}

export function AdminFirstRunInventory({
  supabase,
  t,
  draft,
  busy,
  onBusy,
  onState,
  onFinished,
  onNavHandle,
}: {
  supabase: SupabaseClient<Database>;
  t: (key: string) => string;
  draft: Record<string, unknown>;
  busy: boolean;
  onBusy: (v: boolean) => void;
  onState: (state: FirstRunState | null) => void;
  onFinished: () => Promise<void>;
  onNavHandle?: (handle: FirstRunInventoryNavHandle | null) => void;
}) {
  const { locale } = useI18n();
  const [deferred, setDeferred] = useState(() => truthy(draft.inventory_opening_deferred));
  const [imported, setImported] = useState(() => truthy(draft.inventory_opening_imported));
  const [preview, setPreview] = useState<ImportPreviewResult | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [commitResult, setCommitResult] = useState<InventoryCommitBatchResult | null>(null);
  const [existingCount, setExistingCount] = useState({ assets: 0, stock: 0 });
  const [formError, setFormError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const refreshCounts = useCallback(async () => {
    const counts = await countInventoryRegister(supabase);
    setExistingCount(counts);
    return counts;
  }, [supabase]);

  useEffect(() => {
    void refreshCounts().catch(() => undefined);
  }, [refreshCounts]);

  useEffect(() => {
    if (!onNavHandle) return;
    onNavHandle({
      persistDraft: async () => {
        try {
          const state = await saveFirstRunProgress(supabase, {
            stage: 'inventory_opening',
            draft: {
              inventory_opening_deferred: deferred,
              inventory_opening_imported: imported,
            },
          });
          onState(state);
          return true;
        } catch {
          return false;
        }
      },
      hasPendingFile: () => !!fileName && !imported && !deferred && !!preview,
    });
    return () => onNavHandle(null);
  }, [deferred, fileName, imported, onNavHandle, onState, preview, supabase]);

  async function onPickFile(file: File) {
    setFormError(null);
    setNote(null);
    setCommitResult(null);
    onBusy(true);
    try {
      const buf = await file.arrayBuffer();
      const parsed = parseInventoryOpeningXlsxBuffer(buf);
      if (!parsed.ok) {
        setPreview(null);
        setBatchId(null);
        setFileName(null);
        setFormError(
          typeof parsed.error === 'string'
            ? parsed.error
            : t('admin.inv6EmptySheet'),
        );
        return;
      }
      if (parsed.rows.length === 0) {
        setFormError(t('admin.inv6EmptySheet'));
        return;
      }
      const ctx = await loadInventoryOpeningClassifyContext(supabase);
      const result = classifyInventoryOpeningRows(parsed.rows, ctx);
      setPreview(result);
      setFileName(file.name);
      const { data: batch, error: batchErr } = await untyped(supabase).rpc(
        'admin_create_module_import_batch',
        {
          p_module_key: INVENTORY_MODULE_KEY,
          p_schema_version: INVENTORY_SETUP_SCHEMA_VERSION,
          p_source: 'xlsx',
          p_file_name: file.name,
          p_preview: {
            local: result,
            policy: {
              read_only_preview: true,
              no_finance: true,
              estimated_value_informational: true,
              conflict_no_overwrite: true,
            },
          },
          p_row_count: result.rows.length,
          p_create_count: result.createCount,
          p_update_count: result.updateCount,
          p_skip_count: result.skipCount,
          p_error_count: result.errorCount,
          p_error_report: result.rows
            .filter((r) => r.errors.length)
            .map((r) => ({
              rowNumber: r.rowNumber,
              preview_class: r.data.preview_class,
              errors: r.errors,
            })),
        },
      );
      if (batchErr) throw batchErr;
      setBatchId(String((batch as { id?: string } | null)?.id ?? '') || null);
      setNote(t('admin.inv6PreviewReady'));
    } catch (e: unknown) {
      setFormError(toUserFacingMessage(e, t, { context: 'first_run', fallback: t('admin.errGeneric') }));
    } finally {
      onBusy(false);
    }
  }

  async function onConfirmImport() {
    if (!preview || !batchId || preview.errorCount > 0) return;
    onBusy(true);
    setFormError(null);
    try {
      const rawBatch = await commitInventoryOpeningBatch({
        preview,
        batchId,
        idempotencyKeyForRow: (rowNumber, kind) =>
          inventoryOpeningIdempotencyKey(batchId, rowNumber, kind),
        fns: buildInventoryOpeningImportFns(supabase),
      });
      setCommitResult(rawBatch);
      const saved = inventoryCommitConfirmedSavedCount(rawBatch);
      if (rawBatch.failedCount > 0 || rawBatch.conflictCount > 0) {
        setFormError(t('admin.inv6PartialNotFullySuccessful'));
      } else {
        setImported(true);
        setDeferred(false);
        setFileName(null);
        const state = await saveFirstRunProgress(supabase, {
          stage: 'inventory_opening',
          draft: {
            inventory_opening_imported: true,
            inventory_opening_deferred: false,
            inventory_opening_batch_id: batchId,
          },
        });
        onState(state);
        await refreshCounts();
        setNote(t('admin.inv6ImportSuccessBanner').replace('{n}', String(saved)));
      }
    } catch (e: unknown) {
      setFormError(toUserFacingMessage(e, t, { context: 'first_run', fallback: t('admin.errGeneric') }));
    } finally {
      onBusy(false);
    }
  }

  async function onToggleDeferred(next: boolean) {
    setFormError(null);
    if (next) {
      const counts = await refreshCounts();
      if (counts.assets > 0 || counts.stock > 0) {
        setNote(
          t('admin.firstRunInventoryExistingKeep')
            .replace('{assets}', String(counts.assets))
            .replace('{stock}', String(counts.stock)),
        );
      }
      setDeferred(true);
      setPreview(null);
      setBatchId(null);
      setFileName(null);
      setCommitResult(null);
    } else {
      setDeferred(false);
    }
  }

  async function finishStage() {
    onBusy(true);
    setFormError(null);
    try {
      if (deferred) {
        const counts = await refreshCounts();
        if (counts.assets > 0 || counts.stock > 0) {
          // Defer must never wipe — only record the explicit postpone decision.
          setNote(
            t('admin.firstRunInventoryExistingKeep')
              .replace('{assets}', String(counts.assets))
              .replace('{stock}', String(counts.stock)),
          );
        }
        const state = await completeFirstRunStage(supabase, {
          stage: 'inventory_opening',
          nextStage: 'complete',
          draft: {
            inventory_opening_deferred: true,
            inventory_opening_imported: imported,
          },
        });
        onState(state);
        await onFinished();
        return;
      }
      if (!imported && existingCount.assets === 0 && existingCount.stock === 0) {
        setFormError(t('admin.firstRunInventoryNeedImportOrDefer'));
        return;
      }
      const state = await completeFirstRunStage(supabase, {
        stage: 'inventory_opening',
        nextStage: 'complete',
        draft: {
          inventory_opening_deferred: false,
          inventory_opening_imported: true,
        },
      });
      onState(state);
      await onFinished();
    } catch (e: unknown) {
      setFormError(toUserFacingMessage(e, t, { context: 'first_run', fallback: t('admin.errGeneric') }));
    } finally {
      onBusy(false);
    }
  }

  const warningCount = preview ? inventoryOpeningWarningCount(preview) : 0;
  const groups = preview ? groupInventoryOpeningPreviewByCategory(preview) : [];
  const draftRoot = asObj(draft);

  return (
    <FirstRunScreen
      icon={Package}
      iconClass="text-amber-700"
      title={t('admin.firstRunStageInventory')}
      lead={t('admin.firstRunInventoryLead')}
      busy={busy}
    >
      <p className={styles.hint}>{t('admin.firstRunInventoryNoFake')}</p>
      {(existingCount.assets > 0 || existingCount.stock > 0 || truthy(draftRoot.inventory_opening_imported)) && (
        <FirstRunStatusBanner
          tone="success"
          title={t('admin.firstRunInventoryExistingKeep')
            .replace('{assets}', String(existingCount.assets))
            .replace('{stock}', String(existingCount.stock))}
        />
      )}

      <label className={styles.checkLine}>
        <input
          type="checkbox"
          checked={deferred}
          disabled={busy}
          onChange={(e) => void onToggleDeferred(e.target.checked)}
        />
        <span>{t('admin.firstRunInventoryDefer')}</span>
      </label>
      <p className={styles.hint}>{t('admin.firstRunInventoryDeferHint')}</p>

      {!deferred ? (
        <div className={styles.importGrid}>
          <div className={styles.stepBlock}>
            <p className={styles.importLabel}>{t('admin.firstRunImportDownload')}</p>
            <button
              type="button"
              className={styles.secondary}
              disabled={busy}
              onClick={() => downloadInventoryOpeningTemplate(locale)}
            >
              {t('admin.firstRunInventoryDownload')}
            </button>
            <p className={styles.hint}>{t('admin.inv6XlsxInstructions')}</p>
            <p className={styles.hint}>{t('admin.firstRunInventoryMatchHint')}</p>
          </div>
          <div className={styles.stepBlock}>
            <p className={styles.importLabel}>{t('admin.firstRunImportUpload')}</p>
            <AppFilePicker
              accept=".xlsx,.xls"
              disabled={busy || imported}
              resetInputAfterChange
              hint={`${t('common.fileHintFormats').replace('{formats}', formatAcceptHint('.xlsx,.xls'))} · ${t('admin.firstRunFileReselectHint')}`}
              onChange={(picked) => {
                const file = picked[0];
                if (file) void onPickFile(file);
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
                  {preview.errorCount > 0 ? (
                    <FirstRunStatusBanner
                      tone="error"
                      title={t('admin.inv6FixErrors')}
                      detail={`${t('admin.firstRunBudgetImportStatErrors')}: ${preview.errorCount}`}
                    />
                  ) : (
                    <FirstRunStatusBanner tone="success" title={t('admin.inv6PreviewReady')} />
                  )}
                  {warningCount > 0 ? (
                    <FirstRunStatusBanner
                      tone="warning"
                      title={`${t('admin.firstRunBudgetImportStatWarnings')}: ${warningCount}`}
                    />
                  ) : null}
                </FirstRunStatusStack>
                <div className={styles.stats}>
                  <div className={styles.stat}>
                    <div className={styles.statValue}>{preview.rows.length}</div>
                    <div className={styles.statLabel}>{t('admin.firstRunInventoryStatRows')}</div>
                  </div>
                  <div className={styles.stat}>
                    <div className={styles.statValue}>{preview.createCount}</div>
                    <div className={styles.statLabel}>{t('admin.internetImportOutcomeWillCreate')}</div>
                  </div>
                  <div className={styles.stat}>
                    <div className={styles.statValue}>{preview.skipCount}</div>
                    <div className={styles.statLabel}>{t('admin.internetImportOutcomeWillSkip')}</div>
                  </div>
                </div>
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>{t('admin.firstRunBudgetImportColRow')}</th>
                        <th>{t('admin.inv6Col_item_name')}</th>
                        <th>{t('admin.firstRunInventoryColQty')}</th>
                        <th>{t('admin.inv6Col_location_code')}</th>
                        <th>{t('admin.firstRunSfColAction')}</th>
                        <th>{t('admin.firstRunBudgetImportColNotes')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {groups.flatMap((g) =>
                        g.rows.map((row) => {
                          const qty =
                            row.data.opening_qty ||
                            row.data.quantity ||
                            row.data.inventory_number ||
                            '—';
                          const notes = [
                            ...row.errors.map((e) => presentInventoryOpeningIssue(e, t)),
                            ...(row.warnings ?? []).map((w) => presentInventoryOpeningIssue(w, t)),
                          ];
                          return (
                            <tr key={`inv-${row.rowNumber}-${row.matchKey ?? ''}`}>
                              <td>{row.rowNumber}</td>
                              <td>{String(row.data.item_name || '—')}</td>
                              <td>
                                {String(qty)}
                                {row.data.unit_code
                                  ? ` ${presentInventoryUnit(String(row.data.unit_code), t)}`
                                  : ''}
                              </td>
                              <td>
                                {String(
                                  row.data.location_label || row.data.location_code || '—',
                                )}
                              </td>
                              <td>
                                {row.operation === 'create'
                                  ? t('admin.internetImportOutcomeWillCreate')
                                  : row.operation === 'skip'
                                    ? t('admin.internetImportOutcomeWillSkip')
                                    : t('admin.internetImportOutcomeError')}
                              </td>
                              <td className={notes.length ? styles.fieldError : undefined}>
                                {notes.join(' · ') || '—'}
                              </td>
                            </tr>
                          );
                        }),
                      )}
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
                  imported ||
                  !preview ||
                  !batchId ||
                  preview.errorCount > 0 ||
                  preview.createCount + preview.skipCount === 0
                }
                onClick={() => void onConfirmImport()}
              >
                {busy ? t('admin.firstRunImporting') : t('admin.firstRunInventoryImportConfirm')}
              </button>
            </FirstRunStageActions>
            {commitResult ? (
              <p className={styles.okNote}>
                {t('admin.inv6ImportSuccessBanner').replace(
                  '{n}',
                  String(inventoryCommitConfirmedSavedCount(commitResult)),
                )}
              </p>
            ) : null}
          </div>
        </div>
      ) : (
        <FirstRunStatusBanner tone="warning" title={t('admin.firstRunInventoryDeferredBanner')} />
      )}

      {formError ? <FirstRunErrorNote raw={formError} t={t} /> : null}
      {note ? <p className={styles.okNote}>{note}</p> : null}

      <FirstRunStageActions>
        <button
          type="button"
          className={styles.primary}
          disabled={
            busy ||
            (!deferred && !imported && existingCount.assets === 0 && existingCount.stock === 0)
          }
          onClick={() => void finishStage()}
        >
          {busy ? t('admin.firstRunBusy') : t('admin.firstRunContinue')}
        </button>
      </FirstRunStageActions>
    </FirstRunScreen>
  );
}
