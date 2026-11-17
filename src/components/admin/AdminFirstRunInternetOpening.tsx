'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Wifi } from 'lucide-react';
import type { Database } from '@/lib/database.types';
import { FirstRunStageActions } from '@/components/admin/FirstRunFrame';
import { FirstRunScreen } from '@/components/admin/FirstRunSteps';
import {
  FirstRunTariffPrepBlock,
  type FirstRunTariffPrepHandle,
} from '@/components/admin/FirstRunTariffPrepBlock';
import styles from './FirstRunFrame.module.css';
import { FirstRunStatusBanner, FirstRunStatusStack } from '@/components/admin/FirstRunStatusBanner';
import { AppFilePicker } from '@/components/ui/AppFilePicker';
import {
  importInternetOpening,
  isFirstRunTariffPrepared,
  normalizeFirstRunErrors,
  readTariffPrep,
  type FirstRunErrorRow,
  type FirstRunTariffPrepMap,
} from '@/lib/firstRun';
import {
  buildInternetOpeningClarify,
  presentInternetReadySummary,
} from '@/lib/firstRunMetersImportPreview';
import {
  buildInternetOpeningPreview,
  formatInetAptHeading,
  formatInetEntranceTitle,
} from '@/lib/firstRunInternetOpeningPreview';
import { parseInternetOpeningWorkbook } from '@/lib/internetSimpleOpening';
import {
  INTERNET_SIMPLE_IMPORT_SPEC,
  buildInternetSimpleTemplateBuffer,
} from '@/lib/importTemplates/specs/internetSimple';
import { localizedTemplateFileName } from '@/lib/importTemplates';
import { formatEur } from '@/lib/utilities';
import { toUserFacingMessage } from '@/lib/userFacingError';
import { useI18n } from '@/i18n/I18nProvider';

type T = (key: string, params?: Record<string, string | number>) => string;

function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function downloadXlsx(buf: ArrayBuffer, fileName: string) {
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

export type FirstRunInternetNavHandle = {
  persistDraft: () => Promise<boolean>;
};

export function AdminFirstRunInternetOpening({
  supabase,
  t,
  draft,
  busy,
  onBusy,
  onContinue,
  tariffPrep,
  onSaveTariffPrep,
  onNavHandle,
}: {
  supabase: SupabaseClient<Database>;
  t: T;
  draft: Record<string, unknown>;
  busy: boolean;
  onBusy: (v: boolean) => void;
  onContinue: (none: boolean) => Promise<void>;
  tariffPrep?: FirstRunTariffPrepMap;
  onSaveTariffPrep?: (next: FirstRunTariffPrepMap) => Promise<void>;
  onNavHandle?: (handle: FirstRunInternetNavHandle | null) => void;
}) {
  const { locale } = useI18n();
  const savedNone = useMemo(() => {
    const raw = String(draft.internet_opening_none ?? '')
      .trim()
      .toLowerCase();
    return raw === 'true' || raw === 't' || raw === '1' || raw === 'yes';
  }, [draft.internet_opening_none]);

  const prep = tariffPrep ?? readTariffPrep(draft);
  const tariffNavRef = useRef<FirstRunTariffPrepHandle | null>(null);

  const [none, setNone] = useState(savedNone);
  const [importCount, setImportCount] = useState(0);
  const [subscriptionCount, setSubscriptionCount] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [rows, setRows] = useState<Record<string, string>[] | null>(null);
  const [previewPayload, setPreviewPayload] = useState<Record<string, unknown> | null>(null);
  const [errorRows, setErrorRows] = useState<FirstRunErrorRow[]>([]);
  const [dryOk, setDryOk] = useState(false);
  const [committed, setCommitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noteKey, setNoteKey] = useState<string | null>(null);
  const [openingUnlocked, setOpeningUnlocked] = useState(() =>
    isFirstRunTariffPrepared('internet', prep),
  );
  const [errorsOnly, setErrorsOnly] = useState(false);

  const showImportForm = openingUnlocked || importCount > 0 || pendingCount > 0 || savedNone || committed;

  useEffect(() => {
    onNavHandle?.({
      persistDraft: async () => (await tariffNavRef.current?.persistDraft()) ?? true,
    });
    return () => onNavHandle?.(null);
  }, [onNavHandle]);

  const refreshImports = useCallback(async () => {
    const [importsRes, subsRes, pendingRes] = await Promise.all([
      supabase.from('internet_opening_imports').select('property_id', { count: 'exact', head: true }),
      supabase.from('internet_subscriptions').select('id', { count: 'exact', head: true }),
      supabase
        .from('utility_opening_pending')
        .select('property_id', { count: 'exact', head: true })
        .eq('utility', 'internet')
        .eq('status', 'needs_initial'),
    ]);
    const imports = importsRes.count ?? 0;
    const subs = subsRes.count ?? 0;
    const pending = pendingRes.count ?? 0;
    setImportCount(imports);
    setSubscriptionCount(subs);
    setPendingCount(pending);
    // Existing imports/pending unlock Continue and block the "none" checkbox,
    // but must NOT lock the file picker — re-upload is needed for SKIP/conflict preview.
  }, [supabase]);

  useEffect(() => {
    void refreshImports().catch(() => {
      /* ignore until tables exist */
    });
  }, [refreshImports]);

  const hasExistingOpeningData = importCount > 0 || subscriptionCount > 0 || pendingCount > 0;
  const noneBlocked = hasExistingOpeningData;

  useEffect(() => {
    if (noneBlocked) {
      setNone(false);
      return;
    }
    setNone(savedNone);
  }, [noneBlocked, savedNone]);

  // Match server first_run_assert_internet_opening_ready: none OR imports OR soft pending
  // (or this-session commit that just wrote them). Preview/download alone are not enough.
  const hasSavedOpening = importCount > 0 || pendingCount > 0 || committed;
  const canContinue = (none || hasSavedOpening) && openingUnlocked;

  const preview = useMemo(() => {
    // Keep preview available after a successful apply so re-check / SKIP rows stay visible.
    if (!rows || rows.length === 0) {
      if (errorRows.length === 0) return null;
      return buildInternetOpeningPreview([], { errorRows, t });
    }
    const rpcList = previewPayload && Array.isArray(previewPayload.rows) ? previewPayload.rows : [];
    return buildInternetOpeningPreview(rows, {
      rpcRows: rpcList,
      errorRows,
      t,
    });
  }, [rows, previewPayload, errorRows, t]);

  const filteredGroups = useMemo(() => {
    if (!preview) return [];
    if (!errorsOnly) return preview.groups;
    return preview.groups
      .map((g) => ({ ...g, items: g.items.filter((i) => i.outcome === 'error') }))
      .filter((g) => g.items.length > 0);
  }, [preview, errorsOnly]);

  async function onDownload() {
    if (!openingUnlocked) {
      setError(t('admin.firstRunOpeningLockedUntilTariff'));
      return;
    }
    onBusy(true);
    setError(null);
    try {
      const { data: bookRows, error: listErr } = await supabase.rpc('admin_list_property_book', {
        p_limit: 5000,
      });
      if (listErr) throw new Error(listErr.message);
      const stubs = (bookRows || []).map((r: Record<string, unknown>) => ({
        apartment_number: String(r.apartment_number ?? ''),
        section_code: r.section_code != null ? String(r.section_code) : '',
        block_code: r.block_code != null ? String(r.block_code) : '',
      }));
      if (stubs.length === 0) {
        throw new Error(t('admin.firstRunMetersDownloadEmpty'));
      }
      downloadXlsx(
        buildInternetSimpleTemplateBuffer(locale, stubs),
        localizedTemplateFileName(INTERNET_SIMPLE_IMPORT_SPEC, locale),
      );
    } catch (err: unknown) {
      setError(toUserFacingMessage(err, t, { context: 'first_run', fallback: t('admin.errGeneric') }));
    } finally {
      onBusy(false);
    }
  }

  async function onFile(file: File | null) {
    if (!file) return;
    if (!openingUnlocked) {
      setError(t('admin.firstRunOpeningLockedUntilTariff'));
      return;
    }
    onBusy(true);
    setError(null);
    setNoteKey(null);
    setDryOk(false);
    setPreviewPayload(null);
    setErrorRows([]);
    setCommitted(false);
    try {
      const buf = await file.arrayBuffer();
      const parsed = parseInternetOpeningWorkbook(buf, locale);
      if (!parsed.ok) {
        setError(parsed.error);
        return;
      }
      if (parsed.previewRows.length === 0 && parsed.clientErrors.length === 0) {
        setError(t('admin.is5InternetEmptySheet'));
        return;
      }

      setRows(parsed.previewRows);

      if (parsed.rows.length === 0) {
        setErrorRows(parsed.clientErrors);
        setDryOk(false);
        return;
      }

      const { data, error: rpcErr } = await importInternetOpening(supabase, parsed.rows, true, {
        confirmCorrections: false,
      });
      if (rpcErr) throw new Error(rpcErr.message);
      const res = asObj(data);
      const rpcErrors = Array.isArray(res.errors) ? res.errors : [];
      const merged = [...parsed.clientErrors, ...normalizeFirstRunErrors(rpcErrors)];
      const seen = new Set<string>();
      const errors = merged.filter((e) => {
        const k = `${e.row}|${e.field}|${e.reason}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      setPreviewPayload(res);
      setErrorRows(errors);
      const ok = res.ok === true && errors.length === 0;
      setDryOk(ok);
      setNone(false);
      if (ok) setNoteKey('admin.firstRunInternetDryRunOk');
    } catch (err: unknown) {
      setError(toUserFacingMessage(err, t, { context: 'first_run', fallback: t('admin.errGeneric') }));
    } finally {
      onBusy(false);
    }
  }

  async function onCommit() {
    if (!rows || !dryOk) return;
    onBusy(true);
    setError(null);
    try {
      const rpcRows = rows.map((r) => {
        const out: Record<string, string> = {};
        for (const [k, v] of Object.entries(r)) {
          if (!k.startsWith('_')) out[k] = v;
        }
        return out;
      });
      const { data, error: rpcErr } = await importInternetOpening(supabase, rpcRows, false, {
        confirmCorrections: true,
      });
      if (rpcErr) {
        setErrorRows(
          normalizeFirstRunErrors(
            (() => {
              try {
                const d = JSON.parse(String(rpcErr.details ?? '[]'));
                return Array.isArray(d) ? d : [];
              } catch {
                return [];
              }
            })(),
          ),
        );
        throw new Error(rpcErr.message);
      }
      const res = asObj(data);
      if (res.ok !== true) {
        setErrorRows(normalizeFirstRunErrors(Array.isArray(res.errors) ? res.errors : []));
        throw new Error(t('admin.firstRunInternetImportFailed'));
      }
      setCommitted(true);
      setDryOk(false);
      setPreviewPayload(res);
      await refreshImports();
      setNoteKey('admin.firstRunInternetOpeningCommitted');
    } catch (err: unknown) {
      setError(toUserFacingMessage(err, t, { context: 'first_run', fallback: t('admin.errGeneric') }));
    } finally {
      onBusy(false);
    }
  }

  async function submit() {
    if (!openingUnlocked) {
      setError(t('admin.firstRunOpeningLockedUntilTariff'));
      return;
    }
    if (!canContinue) {
      setError(t('admin.firstRunInternetOpeningNeedConfirm'));
      return;
    }
    onBusy(true);
    setError(null);
    try {
      await onContinue(none && importCount === 0 && pendingCount === 0 && !committed);
    } catch (err: unknown) {
      setError(toUserFacingMessage(err, t, { fallback: t('admin.errGeneric') }));
    } finally {
      onBusy(false);
    }
  }

  const filePickerDisabled = busy || none || !openingUnlocked;
  const filePickerDisabledReason = !openingUnlocked
    ? t('admin.firstRunOpeningLockedUntilTariff')
    : none
      ? t('admin.firstRunInternetOpeningNoneHint')
      : busy
        ? t('admin.firstRunBusy')
        : null;
  const hasCheck = Boolean(preview || previewPayload);

  return (
    <FirstRunScreen
      icon={Wifi}
      iconClass="text-sky-600"
      title={t('admin.firstRunStageInternetOpening')}
      lead={t('admin.firstRunInternetOpeningLead')}
      busy={busy}
    >
      <FirstRunStatusStack>
        {error ? <FirstRunStatusBanner tone="error" title={error} /> : null}
        {committed ? (
          <FirstRunStatusBanner
            tone="success"
            title={noteKey ? t(noteKey) : t('admin.firstRunInternetOpeningCommitted')}
            detail={t('admin.firstRunImportSavedContinue')}
          />
        ) : null}
        {!committed && noteKey && !dryOk ? (
          <FirstRunStatusBanner tone="success" title={t(noteKey)} />
        ) : null}
        {!committed && dryOk && preview ? (
          <FirstRunStatusBanner
            tone="success"
            title={t('admin.firstRunOpeningCheckOkTitle')}
            detail={t('admin.firstRunInternetDryRunDetail')
              .replace('{rows}', String(preview.rowCount))
              .replace('{debt}', formatEur(preview.debtSum, locale))
              .replace('{credit}', formatEur(preview.creditSum, locale))
              .replace('{clarify}', String(preview.connectionClarifyCount))}
          />
        ) : null}
        {!committed && dryOk && previewPayload && !preview ? (
          <FirstRunStatusBanner
            tone="success"
            title={t('admin.firstRunMetersReadyTitle')}
            detail={presentInternetReadySummary(
              buildInternetOpeningClarify(
                Array.isArray(previewPayload.rows)
                  ? (previewPayload.rows as Record<string, unknown>[])
                  : [],
              ),
              t,
              locale,
            )}
          />
        ) : null}
        {!committed && rows && !dryOk ? (
          <FirstRunStatusBanner
            tone="error"
            title={t('admin.firstRunOpeningCheckFailTitle')}
            detail={t('admin.firstRunMetersBlockingDetail')}
          />
        ) : null}
        {(importCount > 0 || pendingCount > 0 || savedNone || committed) && !openingUnlocked ? (
          <FirstRunStatusBanner
            tone="warning"
            title={t('admin.firstRunTariffNeededAfterImportTitle')}
            detail={t('admin.firstRunTariffNeededAfterImportDetail')}
          />
        ) : null}
      </FirstRunStatusStack>

      <p className={styles.hint}>{t('admin.firstRunInternetOpeningHint')}</p>

      {onSaveTariffPrep ? (
        <FirstRunTariffPrepBlock
          ref={tariffNavRef}
          tariffKey="internet"
          supabase={supabase}
          t={t}
          prep={prep}
          busy={busy}
          onBusy={onBusy}
          onSavePrep={onSaveTariffPrep}
          onGateChange={(gate) => setOpeningUnlocked(gate.unlockOpening)}
        />
      ) : null}

      <div className={styles.group}>
        <h3 className={styles.groupTitle}>{t('admin.firstRunSectionOpeningData')}</h3>
        {!showImportForm ? (
          <p className={styles.hint}>{t('admin.firstRunOpeningLockedUntilTariff')}</p>
        ) : (
          <>
            <label className={styles.choice}>
              <input
                type="checkbox"
                checked={none}
                disabled={busy || noneBlocked || !openingUnlocked}
                onChange={(e) => {
                  setNone(e.target.checked);
                  setError(null);
                }}
              />
              <span>{t('admin.firstRunInternetOpeningNone')}</span>
            </label>
            {noneBlocked ? (
              <p className={styles.hint} role="status">
                {t('admin.firstRunInternetOpeningNoneBlocked')}
              </p>
            ) : null}
            {none && !noneBlocked ? (
              <p className={styles.hint}>{t('admin.firstRunInternetOpeningNoneHint')}</p>
            ) : null}

            {!none ? (
              <div className={styles.importGrid}>
                <div className={styles.stepBlock}>
                  <p className={styles.importLabel}>{t('admin.firstRunImportDownload')}</p>
                  <button
                    type="button"
                    className={styles.secondary}
                    disabled={busy || !openingUnlocked}
                    onClick={() => void onDownload()}
                  >
                    {t('admin.firstRunInternetDownload')}
                  </button>
                  <p className={styles.hint}>{t('admin.firstRunInternetTemplateHint')}</p>
                </div>
                <div className={styles.stepBlock}>
                  <p className={styles.importLabel}>{t('admin.firstRunImportUpload')}</p>
                  <AppFilePicker
                    accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    disabled={filePickerDisabled}
                    resetInputAfterChange
                    hint={
                      filePickerDisabledReason
                        ? filePickerDisabledReason
                        : `${t('common.fileHintFormats').replace('{formats}', '.xlsx')} · ${t('admin.firstRunFileReselectHint')}${
                            hasExistingOpeningData
                              ? ` · ${t('admin.firstRunInternetOpeningReuploadHint')}`
                              : ''
                          }`
                    }
                    onChange={(picked) => void onFile(picked[0] ?? null)}
                  />
                </div>
                <div className={styles.stepBlock}>
                  <p className={styles.importLabel}>{t('admin.firstRunImportCheck')}</p>
                  {hasCheck && preview ? (
                    <div className={styles.hint}>
                      <p>
                        {t('admin.firstRunSfKindDebt')}: {preview.debtCount} · Σ{' '}
                        {formatEur(preview.debtSum, locale)} · {t('admin.firstRunSfKindCredit')}:{' '}
                        {preview.creditCount} · Σ {formatEur(preview.creditSum, locale)}
                      </p>
                      <p>
                        {t('admin.firstRunInternetConnectionClarifyCount')}:{' '}
                        {preview.connectionClarifyCount}
                      </p>
                    </div>
                  ) : (
                    <p className={styles.hint}>{t('admin.firstRunImportCheckPending')}</p>
                  )}
                  {preview ? (
                    <div className={styles.tableWrap} style={{ marginTop: 12 }}>
                      <p className={styles.importLabel}>{t('admin.firstRunSfPreviewTitle')}</p>
                      <p className={styles.hint}>{t('admin.firstRunInternetPreviewHint')}</p>
                      <label className={styles.field} style={{ marginBottom: 8 }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                          <input
                            type="checkbox"
                            checked={errorsOnly}
                            onChange={(e) => setErrorsOnly(e.target.checked)}
                          />
                          {t('admin.firstRunSfFilterErrorsOnly')}
                        </span>
                      </label>
                      {filteredGroups.length === 0 ? (
                        <p className={styles.hint}>
                          {errorsOnly
                            ? t('admin.firstRunSfFilterErrorsEmpty')
                            : t('admin.firstRunImportCheckPending')}
                        </p>
                      ) : (
                        <table className={styles.previewTableFixed}>
                          <colgroup>
                            <col className={styles.previewColApt} />
                            <col className={styles.previewColKind} />
                            <col className={styles.previewColAmount} />
                            <col className={styles.previewColAction} />
                          </colgroup>
                          <thead>
                            <tr>
                              <th scope="col">{t('admin.firstRunSfColApt')}</th>
                              <th scope="col">{t('admin.firstRunSfColKind')}</th>
                              <th scope="col" className={styles.previewAmount}>
                                {t('admin.firstRunSfColAmount')}
                              </th>
                              <th scope="col">{t('admin.firstRunSfColAction')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filteredGroups.map((group) => (
                              <Fragment key={`inet-g-${group.key}`}>
                                <tr className={styles.previewEntranceSep}>
                                  <td colSpan={4}>{formatInetEntranceTitle(group, t)}</td>
                                </tr>
                                {group.items.map((item) => {
                                  const amount =
                                    item.balanceKind === 'debt'
                                      ? formatEur(item.remainingDebt ?? 0, locale)
                                      : item.balanceKind === 'credit'
                                        ? formatEur(item.overpayment ?? 0, locale)
                                        : item.balanceKind === 'zero'
                                          ? formatEur(0, locale)
                                          : '—';
                                  const kindLabel =
                                    item.balanceKind === 'debt'
                                      ? t('admin.firstRunSfKindDebt')
                                      : item.balanceKind === 'credit'
                                        ? t('admin.firstRunSfKindCredit')
                                        : item.balanceKind === 'zero'
                                          ? t('admin.firstRunSfKindZero')
                                          : t('admin.firstRunSfOutcomeDefer');
                                  return (
                                    <tr
                                      key={item.key}
                                      className={
                                        item.outcome === 'error'
                                          ? styles.tableRowError
                                          : item.outcome === 'defer'
                                            ? styles.tableRowWarn
                                            : undefined
                                      }
                                    >
                                      <td>
                                        <div className={styles.previewAptName}>
                                          {formatInetAptHeading(item, t)}
                                          {item.sectionCode ? ` · ${item.sectionCode}` : ''}
                                        </div>
                                        {item.excelRow ? (
                                          <div className={styles.previewAptMeta}>
                                            {t('admin.firstRunSfErrorRow', { row: item.excelRow })}
                                          </div>
                                        ) : null}
                                        {item.connectionNeedsClarify ? (
                                          <div className={styles.previewAptMeta}>
                                            {t('admin.firstRunInternetConnectionNeedsClarify')}
                                          </div>
                                        ) : null}
                                        {item.errorText ? (
                                          <div
                                            className={`${styles.previewMsg} ${styles.previewMsgError}`}
                                          >
                                            {item.errorText}
                                          </div>
                                        ) : null}
                                      </td>
                                      <td>{kindLabel}</td>
                                      <td className={styles.previewAmount}>{amount}</td>
                                      <td className={styles.previewAction}>{item.outcomeLabel}</td>
                                    </tr>
                                  );
                                })}
                              </Fragment>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  ) : null}
                </div>
                <div className={styles.stepBlock}>
                  <p className={styles.importLabel}>{t('admin.firstRunImportConfirm')}</p>
                  <p className={styles.hint}>{t('admin.firstRunInternetConfirm')}</p>
                  {!openingUnlocked && !committed ? (
                    <p className={styles.hint}>{t('admin.firstRunOpeningConfirmLockedWhileEditing')}</p>
                  ) : null}
                  {!committed ? (
                    <button
                      type="button"
                      className={styles.primary}
                      disabled={busy || !dryOk || !openingUnlocked}
                      onClick={() => void onCommit()}
                    >
                      {busy ? t('admin.firstRunImporting') : t('admin.firstRunInternetCommit')}
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>

      <FirstRunStageActions>
        <button
          type="button"
          className={styles.primary}
          disabled={busy || !canContinue}
          onClick={() => void submit()}
        >
          {busy ? t('admin.firstRunBusy') : t('admin.firstRunContinue')}
        </button>
      </FirstRunStageActions>
    </FirstRunScreen>
  );
}
