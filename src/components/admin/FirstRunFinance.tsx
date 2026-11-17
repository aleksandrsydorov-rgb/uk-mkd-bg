'use client';

import { useMemo, useState, type Ref } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { BadgeCheck, CircleDollarSign, Landmark } from 'lucide-react';
import type { Database } from '@/lib/database.types';
import { isFirstRunTariffPrepared, type FirstRunErrorRow, type FirstRunTariffPrepMap } from '@/lib/firstRun';
import { explainFirstRunFailure } from '@/lib/firstRunUserMessage';
import { formatMeterMoney } from '@/lib/firstRunMetersPreview';
import {
  buildSupportFeeOpeningPreview,
  formatSfAptHeading,
  formatSfEntranceTitle,
  presentSfOutcome,
} from '@/lib/firstRunSupportFeePreview';
import {
  buildCapitalRepairOpeningPreview,
  formatCrAptHeading,
  formatCrBalanceLabel,
  formatCrEntranceTitle,
  presentCrOutcome,
} from '@/lib/firstRunCapitalRepairPreview';
import { FirstRunStageActions } from '@/components/admin/FirstRunFrame';
import { FirstRunScreen } from '@/components/admin/FirstRunSteps';
import {
  FirstRunTariffPrepBlock,
  type FirstRunTariffPrepHandle,
} from '@/components/admin/FirstRunTariffPrepBlock';
import { FirstRunStatusBanner, FirstRunStatusStack } from '@/components/admin/FirstRunStatusBanner';
import { AppFilePicker } from '@/components/ui/AppFilePicker';
import { useI18n } from '@/i18n/I18nProvider';
import styles from './FirstRunFrame.module.css';

type T = (key: string, params?: Record<string, string | number>) => string;

type OpeningDry = {
  ok: boolean;
  errors: unknown[];
  rowCount: number;
  createCount: number;
  skippedExisting: number;
  deferredCount?: number;
  debtSum: number;
  creditSum: number;
  /** Optional RPC dry-run row outcomes for preview. */
  rpcRows?: unknown[];
};

export function FirstRunErrorNote({ raw, t }: { raw: string; t: T }) {
  const text = String(raw ?? '').trim();
  const view = explainFirstRunFailure(text, t);
  const unknown = t('admin.firstRunErrUnknown');
  // Budget (and peers) may pass already-localized copy from toUserFacingMessage.
  // Re-explaining that free text would always collapse to Unknown — keep it when
  // it is not a technical / secret diagnostic phrase.
  const looksTechnical =
    /^(first_run:|opening_import:|admin_[a-z0-9_]+:|budget_import:)/i.test(text) ||
    /PGRST|PostgREST|SQLSTATE|rpc_|relation |column |schema cache/i.test(text) ||
    /bearer\s+\S+|eyJ[A-Za-z0-9_-]{8,}\./i.test(text);
  const title =
    view.message !== unknown
      ? view.message
      : !text || looksTechnical
        ? unknown
        : text;
  return <FirstRunStatusBanner tone="error" title={title} />;
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className={styles.stat}>
      <span className={styles.statValue}>{value}</span>
      <span className={styles.statLabel}>{label}</span>
    </div>
  );
}

function OpeningStats({
  dry,
  t,
  locale,
  previewCounts,
  compactSf,
}: {
  dry: OpeningDry;
  t: T;
  locale: string;
  previewCounts?: {
    debtCount: number;
    creditCount: number;
    zeroCount: number;
    debtSum: number;
    creditSum: number;
    readyCount?: number;
    deferCount?: number;
    errorCount?: number;
  } | null;
  /** Unified SF summary: ready / deferred / errors + debt/credit sums. */
  compactSf?: boolean;
}) {
  const debtSum = previewCounts?.debtSum ?? dry.debtSum;
  const creditSum = previewCounts?.creditSum ?? dry.creditSum;
  if (compactSf) {
    const ready = previewCounts?.readyCount ?? dry.createCount + dry.skippedExisting;
    const deferred = previewCounts?.deferCount ?? dry.deferredCount ?? 0;
    const errors = previewCounts?.errorCount ?? (dry.ok ? 0 : dry.errors.length);
    return (
      <div className={styles.stats}>
        <Stat value={String(ready)} label={t('admin.firstRunSfStatReady')} />
        <Stat value={String(deferred)} label={t('admin.firstRunSfStatDeferRows')} />
        <Stat value={String(errors)} label={t('admin.firstRunSfStatErrorRows')} />
        <Stat value={formatMeterMoney(debtSum, locale)} label={t('admin.firstRunStatDebt')} />
        <Stat value={formatMeterMoney(creditSum, locale)} label={t('admin.firstRunStatCredit')} />
      </div>
    );
  }
  return (
    <div className={styles.stats}>
      <Stat value={String(dry.rowCount)} label={t('admin.firstRunStatRows')} />
      <Stat value={String(dry.createCount)} label={t('admin.firstRunStatCreate')} />
      <Stat value={String(dry.skippedExisting)} label={t('admin.firstRunStatSkipped')} />
      {(dry.deferredCount ?? 0) > 0 ? (
        <Stat value={String(dry.deferredCount)} label={t('admin.firstRunSfStatDeferRows')} />
      ) : null}
      {previewCounts ? (
        <>
          <Stat value={String(previewCounts.debtCount)} label={t('admin.firstRunSfStatDebtRows')} />
          <Stat value={String(previewCounts.creditCount)} label={t('admin.firstRunSfStatCreditRows')} />
          <Stat value={String(previewCounts.zeroCount)} label={t('admin.firstRunSfStatZeroRows')} />
        </>
      ) : null}
      <Stat value={formatMeterMoney(debtSum, locale)} label={t('admin.firstRunStatDebt')} />
      <Stat value={formatMeterMoney(creditSum, locale)} label={t('admin.firstRunStatCredit')} />
    </div>
  );
}

export function FirstRunSupportFee({
  t,
  busy,
  dry,
  rows,
  errorRows,
  committed,
  canCommit,
  note,
  error,
  supabase,
  tariffPrep,
  onSaveTariffPrep,
  onTariffBusy,
  tariffNavRef,
  billingYear,
  transitionDate,
  sourceReference,
  onBillingYear,
  onTransitionDate,
  onSourceReference,
  onDownload,
  onDownloadDetailed,
  onFile,
  onCommit,
  onContinue,
}: {
  t: T;
  busy: boolean;
  dry: OpeningDry | null;
  rows: Record<string, string>[] | null;
  errorRows: FirstRunErrorRow[];
  committed: boolean;
  canCommit: boolean;
  note: string | null;
  error: string | null;
  supabase?: SupabaseClient<Database>;
  tariffPrep?: FirstRunTariffPrepMap;
  onSaveTariffPrep?: (next: FirstRunTariffPrepMap) => Promise<void>;
  onTariffBusy?: (v: boolean) => void;
  tariffNavRef?: Ref<FirstRunTariffPrepHandle>;
  billingYear?: string;
  transitionDate?: string;
  sourceReference?: string;
  onBillingYear?: (v: string) => void;
  onTransitionDate?: (v: string) => void;
  onSourceReference?: (v: string) => void;
  onDownload: () => void;
  onDownloadDetailed?: () => void;
  onFile: (file: File | null) => void;
  onCommit: () => void;
  onContinue: () => void;
}) {
  const { locale } = useI18n();
  const [openingUnlocked, setOpeningUnlocked] = useState(() =>
    isFirstRunTariffPrepared('support_fee', tariffPrep ?? {}),
  );
  const [errorsOnly, setErrorsOnly] = useState(false);
  const showImportForm = openingUnlocked || committed;
  const preview = useMemo(() => {
    if (!rows || rows.length === 0 || committed) {
      if (committed) return null;
      if (errorRows.length === 0) return null;
      return buildSupportFeeOpeningPreview([], { errorRows, t });
    }
    return buildSupportFeeOpeningPreview(rows, {
      rpcRows: dry?.rpcRows,
      errorRows,
      t,
    });
  }, [rows, dry?.rpcRows, errorRows, committed, t]);

  const filteredGroups = useMemo(() => {
    if (!preview) return [];
    if (!errorsOnly) return preview.groups;
    return preview.groups
      .map((g) => ({ ...g, items: g.items.filter((i) => i.outcome === 'error') }))
      .filter((g) => g.items.length > 0);
  }, [preview, errorsOnly]);

  const hasCheck = Boolean(preview || dry) && !committed;

  return (
    <FirstRunScreen
      icon={CircleDollarSign}
      iconClass="text-teal-700"
      title={t('admin.firstRunSfTitle')}
      lead={t('admin.firstRunSfLead')}
      busy={busy}
    >
      <FirstRunStatusStack>
        {error ? <FirstRunStatusBanner tone="error" title={error} /> : null}
        {committed ? (
          <FirstRunStatusBanner
            tone="success"
            title={note?.trim() || t('admin.firstRunSfCommitted')}
            detail={t('admin.firstRunImportSavedContinue')}
          />
        ) : null}
        {!committed && note ? <FirstRunStatusBanner tone="success" title={note} /> : null}
        {!committed && dry?.ok ? (
          <FirstRunStatusBanner
            tone="success"
            title={t('admin.firstRunOpeningCheckOkTitle')}
            detail={t('admin.firstRunSfDryRunOk')
              .replace('{rows}', String(dry.rowCount))
              .replace('{create}', String(dry.createCount))
              .replace('{skipped}', String(dry.skippedExisting))
              .replace('{debt}', formatMeterMoney(preview?.debtSum ?? dry.debtSum, locale))
              .replace('{credit}', formatMeterMoney(preview?.creditSum ?? dry.creditSum, locale))}
          />
        ) : null}
        {!committed && ((dry && !dry.ok) || (preview && preview.errorCount > 0 && !dry?.ok)) ? (
          <FirstRunStatusBanner
            tone="error"
            title={t('admin.firstRunOpeningCheckFailTitle')}
            detail={t('admin.firstRunSfBlockingDetail')}
          />
        ) : null}
        {committed && !openingUnlocked ? (
          <FirstRunStatusBanner
            tone="warning"
            title={t('admin.firstRunTariffNeededAfterImportTitle')}
            detail={t('admin.firstRunTariffNeededAfterImportDetail')}
          />
        ) : null}
      </FirstRunStatusStack>
      {supabase && onSaveTariffPrep ? (
        <FirstRunTariffPrepBlock
          ref={tariffNavRef}
          tariffKey="support_fee"
          supabase={supabase}
          t={t}
          prep={tariffPrep ?? {}}
          busy={busy}
          onBusy={onTariffBusy}
          onSavePrep={onSaveTariffPrep}
          onGateChange={(gate) => setOpeningUnlocked(gate.unlockOpening)}
        />
      ) : null}
      <p className={styles.importLabel}>{t('admin.firstRunSectionOpeningData')}</p>
      <p className={styles.hint}>{t('admin.firstRunSectionOpeningBalancesHint')}</p>
      {!showImportForm ? (
        <p className={styles.hint}>{t('admin.firstRunOpeningLockedUntilTariff')}</p>
      ) : (
      <div className={styles.importGrid}>
        <div className={styles.stepBlock}>
          <p className={styles.importLabel}>{t('admin.firstRunImportDownload')}</p>
          <div className={styles.actions} style={{ flexWrap: 'wrap', gap: 8 }}>
            <button
              type="button"
              className={styles.secondary}
              disabled={busy || !openingUnlocked}
              onClick={onDownload}
            >
              {t('admin.firstRunSfDownload')}
            </button>
            {onDownloadDetailed ? (
              <button
                type="button"
                className={styles.secondary}
                disabled={busy || !openingUnlocked}
                onClick={onDownloadDetailed}
              >
                {t('admin.firstRunSfDownloadDetailed')}
              </button>
            ) : null}
          </div>
          <p className={styles.hint}>{t('admin.firstRunSfImportColumnsHint')}</p>
        </div>
        <div className={styles.stepBlock}>
          <p className={styles.importLabel}>{t('admin.firstRunSfFileMetaTitle')}</p>
          <p className={styles.hint}>{t('admin.firstRunSfFileMetaHint')}</p>
          <label className={styles.field}>
            <span>{t('admin.firstRunSfColYear')}</span>
            <input
              className={styles.input}
              inputMode="numeric"
              maxLength={4}
              disabled={busy || committed || !openingUnlocked}
              value={billingYear ?? ''}
              onChange={(e) => onBillingYear?.(e.target.value)}
              placeholder="2026"
            />
          </label>
          <label className={styles.field}>
            <span>{t('admin.feeOpeningTransitionDate')}</span>
            <input
              className={styles.input}
              type="date"
              disabled={busy || committed || !openingUnlocked}
              value={transitionDate ?? ''}
              onChange={(e) => onTransitionDate?.(e.target.value)}
            />
          </label>
          <label className={styles.field}>
            <span>{t('admin.feeOpeningSourceRef')}</span>
            <input
              className={styles.input}
              disabled={busy || committed || !openingUnlocked}
              value={sourceReference ?? ''}
              onChange={(e) => onSourceReference?.(e.target.value)}
            />
          </label>
        </div>
        <div className={styles.stepBlock}>
          <p className={styles.importLabel}>{t('admin.firstRunImportUpload')}</p>
          <AppFilePicker
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            disabled={busy || committed || !openingUnlocked}
            resetInputAfterChange
            hint={
              committed
                ? undefined
                : `${t('common.fileHintFormats').replace('{formats}', '.xlsx')} · ${t('admin.firstRunFileReselectHint')}`
            }
            onChange={(picked) => onFile(picked[0] ?? null)}
          />
        </div>
        <div className={styles.stepBlock}>
          <p className={styles.importLabel}>{t('admin.firstRunImportCheck')}</p>
          {hasCheck ? (
            <OpeningStats
              dry={
                dry ?? {
                  ok: (preview?.errorCount ?? 0) === 0,
                  errors: errorRows,
                  rowCount: preview?.rowCount ?? 0,
                  createCount: preview?.createCount ?? 0,
                  skippedExisting: preview?.skipCount ?? 0,
                  deferredCount: preview?.deferCount ?? 0,
                  debtSum: preview?.debtSum ?? 0,
                  creditSum: preview?.creditSum ?? 0,
                }
              }
              t={t}
              locale={locale}
              compactSf
              previewCounts={
                preview
                  ? {
                      debtCount: preview.debtCount,
                      creditCount: preview.creditCount,
                      zeroCount: preview.zeroCount,
                      debtSum: preview.debtSum,
                      creditSum: preview.creditSum,
                      readyCount: preview.readyCount,
                      deferCount: preview.deferCount,
                      errorCount: preview.errorCount,
                    }
                  : null
              }
            />
          ) : null}
          {!hasCheck ? <p className={styles.hint}>{t('admin.firstRunImportCheckPending')}</p> : null}
          {preview && !committed ? (
            <div className={styles.tableWrap} style={{ marginTop: 12 }}>
              <p className={styles.importLabel}>{t('admin.firstRunSfPreviewTitle')}</p>
              <p className={styles.hint}>{t('admin.firstRunSfPreviewHint')}</p>
              {preview.fileLevelErrors.length > 0 ? (
                <div style={{ marginBottom: 8 }}>
                  {preview.fileLevelErrors.map((msg, i) => (
                    <p key={`sf-file-err-${i}`} className={styles.hint} style={{ color: '#b91c1c' }}>
                      {msg}
                    </p>
                  ))}
                </div>
              ) : null}
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
                  {errorsOnly ? t('admin.firstRunSfFilterErrorsEmpty') : t('admin.firstRunImportCheckPending')}
                </p>
              ) : (
                filteredGroups.map((group) => (
                  <div key={`sf-g-${group.key}`} style={{ marginTop: 12 }}>
                    <p className={styles.hint} style={{ marginBottom: 6, fontWeight: 600 }}>
                      {formatSfEntranceTitle(group, t)}
                    </p>
                    <table className={styles.table}>
                      <thead>
                        <tr>
                          <th>{t('admin.firstRunSfColApt')}</th>
                          <th>{t('admin.firstRunSfColKind')}</th>
                          <th>{t('admin.firstRunSfColAmount')}</th>
                          <th>{t('admin.firstRunSfColAction')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.items.map((item) => (
                          <tr key={item.key}>
                            <td>
                              <div style={{ fontWeight: 600 }}>
                                {formatSfAptHeading(item, t)}
                                {item.sectionCode ? ` · ${item.sectionCode}` : ''}
                                {item.excelRow ? (
                                  <span className={styles.hint} style={{ marginLeft: 6 }}>
                                    {t('admin.firstRunSfErrorRow', { row: item.excelRow })}
                                  </span>
                                ) : null}
                              </div>
                              {item.errorText ? (
                                <div className={styles.hint} style={{ color: '#b91c1c', marginTop: 4 }}>
                                  {item.errorText}
                                </div>
                              ) : null}
                            </td>
                            <td>
                              {item.balanceKind === 'debt'
                                ? t('admin.firstRunSfKindDebt')
                                : item.balanceKind === 'credit'
                                  ? t('admin.firstRunSfKindCredit')
                                  : item.balanceKind === 'zero'
                                    ? t('admin.firstRunSfKindZero')
                                    : '—'}
                            </td>
                            <td>
                              {item.balanceKind === 'debt'
                                ? `${formatMeterMoney(item.remainingDebt ?? 0, locale)} €`
                                : item.balanceKind === 'credit'
                                  ? `${formatMeterMoney(item.overpayment ?? 0, locale)} €`
                                  : item.balanceKind === 'zero'
                                    ? `${formatMeterMoney(0, locale)} €`
                                    : '—'}
                            </td>
                            <td>{presentSfOutcome(item.outcome, t)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))
              )}
            </div>
          ) : null}
        </div>
        <div className={styles.stepBlock}>
          <p className={styles.importLabel}>{t('admin.firstRunImportConfirm')}</p>
          <p className={styles.hint}>{t('admin.firstRunSfConfirm')}</p>
          {!openingUnlocked && !committed ? (
            <p className={styles.hint}>{t('admin.firstRunOpeningConfirmLockedWhileEditing')}</p>
          ) : null}
          <FirstRunStageActions>
            {!committed ? (
              <button
                type="button"
                className={styles.primary}
                disabled={busy || !canCommit || !openingUnlocked || !dry?.ok}
                onClick={onCommit}
              >
                {busy ? t('admin.firstRunImporting') : t('admin.firstRunSfCommit')}
              </button>
            ) : (
              <button type="button" className={styles.primary} disabled={busy || !openingUnlocked} onClick={onContinue}>
                {busy ? t('admin.firstRunBusy') : t('admin.firstRunSfContinue')}
              </button>
            )}
          </FirstRunStageActions>
        </div>
      </div>
      )}
    </FirstRunScreen>
  );
}

export function FirstRunCapitalRepair({
  t,
  busy,
  dry,
  rows,
  errorRows,
  committed,
  canCommit,
  fundOk,
  balance,
  date,
  source,
  notes,
  note,
  error,
  supabase,
  tariffPrep,
  onSaveTariffPrep,
  onTariffBusy,
  tariffNavRef,
  transitionDate,
  sourceReference,
  onTransitionDate,
  onSourceReference,
  onDownload,
  onDownloadDetailed,
  onFile,
  onCommit,
  onBalance,
  onDate,
  onSource,
  onNotes,
  onFundConfirm,
  onContinue,
}: {
  t: T;
  busy: boolean;
  dry: OpeningDry | null;
  rows: Record<string, string>[] | null;
  errorRows: FirstRunErrorRow[];
  committed: boolean;
  canCommit: boolean;
  fundOk: boolean;
  balance: string;
  date: string;
  source: string;
  notes: string;
  note: string | null;
  error: string | null;
  supabase?: SupabaseClient<Database>;
  tariffPrep?: FirstRunTariffPrepMap;
  onSaveTariffPrep?: (next: FirstRunTariffPrepMap) => Promise<void>;
  onTariffBusy?: (v: boolean) => void;
  tariffNavRef?: Ref<FirstRunTariffPrepHandle>;
  transitionDate?: string;
  sourceReference?: string;
  onTransitionDate?: (v: string) => void;
  onSourceReference?: (v: string) => void;
  onDownload: () => void;
  onDownloadDetailed?: () => void;
  onFile: (file: File | null) => void;
  onCommit: () => void;
  onBalance: (value: string) => void;
  onDate: (value: string) => void;
  onSource: (value: string) => void;
  onNotes: (value: string) => void;
  onFundConfirm: () => void;
  onContinue: () => void;
}) {
  const { locale } = useI18n();
  const fundLocked = busy || fundOk;
  const [openingUnlocked, setOpeningUnlocked] = useState(() =>
    isFirstRunTariffPrepared('capital_repair', tariffPrep ?? {}),
  );
  const [errorsOnly, setErrorsOnly] = useState(false);
  const showImportForm = openingUnlocked || committed;
  const preview = useMemo(() => {
    if (!rows || rows.length === 0 || committed) {
      if (committed) return null;
      if (errorRows.length === 0) return null;
      return buildCapitalRepairOpeningPreview([], { errorRows, t });
    }
    return buildCapitalRepairOpeningPreview(rows, {
      rpcRows: dry?.rpcRows,
      errorRows,
      t,
    });
  }, [rows, dry?.rpcRows, errorRows, committed, t]);
  const filteredGroups = useMemo(() => {
    if (!preview) return [];
    if (!errorsOnly) return preview.groups;
    return preview.groups
      .map((g) => ({ ...g, items: g.items.filter((i) => i.outcome === 'error') }))
      .filter((g) => g.items.length > 0);
  }, [preview, errorsOnly]);
  const hasCheck = Boolean(preview || dry) && !committed;
  return (
    <FirstRunScreen
      icon={Landmark}
      iconClass="text-indigo-600"
      title={t('admin.firstRunCrTitle')}
      lead={t('admin.firstRunCrLead')}
      busy={busy}
    >
      <FirstRunStatusStack>
        {error ? <FirstRunStatusBanner tone="error" title={error} /> : null}
        {note ? <FirstRunStatusBanner tone="success" title={note} /> : null}
        {!committed && dry?.ok ? (
          <FirstRunStatusBanner
            tone="success"
            title={t('admin.firstRunOpeningCheckOkTitle')}
            detail={t('admin.firstRunCrDryRunOk')
              .replace('{rows}', String(dry.rowCount))
              .replace('{create}', String(dry.createCount))
              .replace('{skipped}', String(dry.skippedExisting))
              .replace('{debt}', formatMeterMoney(preview?.debtSum ?? dry.debtSum, locale))
              .replace('{credit}', formatMeterMoney(preview?.creditSum ?? dry.creditSum, locale))}
          />
        ) : null}
        {!committed && ((dry && !dry.ok) || (preview && preview.errorCount > 0 && !dry?.ok)) ? (
          <FirstRunStatusBanner
            tone="error"
            title={t('admin.firstRunOpeningCheckFailTitle')}
            detail={t('admin.firstRunCrBlockingDetail')}
          />
        ) : null}
        {committed && !openingUnlocked ? (
          <FirstRunStatusBanner
            tone="warning"
            title={t('admin.firstRunTariffNeededAfterImportTitle')}
            detail={t('admin.firstRunTariffNeededAfterImportDetail')}
          />
        ) : null}
      </FirstRunStatusStack>
      {supabase && onSaveTariffPrep ? (
        <FirstRunTariffPrepBlock
          ref={tariffNavRef}
          tariffKey="capital_repair"
          supabase={supabase}
          t={t}
          prep={tariffPrep ?? {}}
          busy={busy}
          onBusy={onTariffBusy}
          onSavePrep={onSaveTariffPrep}
          onGateChange={(gate) => setOpeningUnlocked(gate.unlockOpening)}
        />
      ) : null}
      <div className={styles.group}>
        <h3 className={styles.groupTitle}>{t('admin.firstRunSectionOpeningData')}</h3>
        <p className={styles.hint}>{t('admin.firstRunSectionOpeningBalancesHint')}</p>
        {!showImportForm ? (
          <p className={styles.hint}>{t('admin.firstRunOpeningLockedUntilTariff')}</p>
        ) : (
        <div className={styles.importGrid}>
          <div className={styles.stepBlock}>
            <p className={styles.importLabel}>{t('admin.firstRunImportDownload')}</p>
            <div className={styles.actions} style={{ flexWrap: 'wrap', gap: 8 }}>
              <button
                type="button"
                className={styles.secondary}
                disabled={busy || !openingUnlocked}
                onClick={onDownload}
              >
                {t('admin.firstRunCrDownload')}
              </button>
              {onDownloadDetailed ? (
                <button
                  type="button"
                  className={styles.secondary}
                  disabled={busy || !openingUnlocked}
                  onClick={onDownloadDetailed}
                >
                  {t('admin.firstRunCrDownloadDetailed')}
                </button>
              ) : null}
            </div>
            <p className={styles.hint}>{t('admin.firstRunCrImportColumnsHint')}</p>
          </div>
          <div className={styles.stepBlock}>
            <p className={styles.importLabel}>{t('admin.firstRunCrFileMetaTitle')}</p>
            <p className={styles.hint}>{t('admin.firstRunCrFileMetaHint')}</p>
            <label className={styles.field}>
              <span>{t('admin.feeOpeningTransitionDate')}</span>
              <input
                className={styles.input}
                type="date"
                disabled={busy || committed || !openingUnlocked}
                value={transitionDate ?? ''}
                onChange={(e) => onTransitionDate?.(e.target.value)}
              />
            </label>
            <label className={styles.field}>
              <span>{t('admin.feeOpeningSourceRef')}</span>
              <input
                className={styles.input}
                disabled={busy || committed || !openingUnlocked}
                value={sourceReference ?? ''}
                onChange={(e) => onSourceReference?.(e.target.value)}
              />
            </label>
          </div>
          <div className={styles.stepBlock}>
            <p className={styles.importLabel}>{t('admin.firstRunImportUpload')}</p>
            <AppFilePicker
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              disabled={busy || committed || !openingUnlocked}
              resetInputAfterChange
              hint={
                committed
                  ? undefined
                  : `${t('common.fileHintFormats').replace('{formats}', '.xlsx')} · ${t('admin.firstRunFileReselectHint')}`
              }
              onChange={(picked) => onFile(picked[0] ?? null)}
            />
          </div>
          <div className={styles.stepBlock}>
            <p className={styles.importLabel}>{t('admin.firstRunImportCheck')}</p>
            {hasCheck ? (
              <OpeningStats
                dry={
                  dry ?? {
                    ok: (preview?.errorCount ?? 0) === 0,
                    errors: errorRows,
                    rowCount: preview?.rowCount ?? 0,
                    createCount: preview?.createCount ?? 0,
                    skippedExisting: preview?.skipCount ?? 0,
                    deferredCount: preview?.deferCount ?? 0,
                    debtSum: preview?.debtSum ?? 0,
                    creditSum: preview?.creditSum ?? 0,
                  }
                }
                t={t}
                locale={locale}
                compactSf
                previewCounts={
                  preview
                    ? {
                        debtCount: preview.debtCount,
                        creditCount: preview.creditCount,
                        zeroCount: preview.zeroCount,
                        debtSum: preview.debtSum,
                        creditSum: preview.creditSum,
                        deferCount: preview.deferCount,
                        errorCount: preview.errorCount,
                      }
                    : null
                }
              />
            ) : null}
            {!hasCheck ? <p className={styles.hint}>{t('admin.firstRunImportCheckPending')}</p> : null}
            {preview && !committed ? (
              <div className={styles.tableWrap} style={{ marginTop: 12 }}>
                <p className={styles.importLabel}>{t('admin.firstRunSfPreviewTitle')}</p>
                <p className={styles.hint}>{t('admin.firstRunSfPreviewHint')}</p>
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
                    {errorsOnly ? t('admin.firstRunSfFilterErrorsEmpty') : t('admin.firstRunImportCheckPending')}
                  </p>
                ) : (
                  filteredGroups.map((group) => (
                    <div key={`cr-g-${group.key}`} style={{ marginTop: 12 }}>
                      <p className={styles.hint} style={{ marginBottom: 6, fontWeight: 600 }}>
                        {formatCrEntranceTitle(group, t)}
                      </p>
                      <table className={styles.table}>
                        <thead>
                          <tr>
                            <th>{t('admin.firstRunSfColApt')}</th>
                            <th>{t('admin.firstRunSfColYear')}</th>
                            <th>{t('admin.firstRunSfColBalance')}</th>
                            <th>{t('admin.firstRunSfColAction')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {group.items.map((item) => (
                            <tr key={item.key}>
                              <td>
                                <div style={{ fontWeight: 600 }}>
                                  {formatCrAptHeading(item, t)}
                                  {item.sectionCode ? ` · ${item.sectionCode}` : ''}
                                  {item.excelRow ? (
                                    <span className={styles.hint} style={{ marginLeft: 6 }}>
                                      {t('admin.firstRunSfErrorRow', { row: item.excelRow })}
                                    </span>
                                  ) : null}
                                </div>
                                {item.errorText ? (
                                  <div className={styles.hint} style={{ color: '#b91c1c', marginTop: 4 }}>
                                    {item.errorText}
                                  </div>
                                ) : null}
                              </td>
                              <td>{item.billingYear || '—'}</td>
                              <td>{formatCrBalanceLabel(item, t, locale)}</td>
                              <td>{presentCrOutcome(item.outcome, t)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))
                )}
              </div>
            ) : null}
          </div>
          <div className={styles.stepBlock}>
            <p className={styles.importLabel}>{t('admin.firstRunImportConfirm')}</p>
            <p className={styles.hint}>{t('admin.firstRunCrConfirm')}</p>
            {!openingUnlocked && !committed ? (
              <p className={styles.hint}>{t('admin.firstRunOpeningConfirmLockedWhileEditing')}</p>
            ) : null}
            <div className={styles.actions}>
              {!committed ? (
                <button
                  type="button"
                  className={styles.primary}
                  disabled={busy || !canCommit || !openingUnlocked || !dry?.ok}
                  onClick={onCommit}
                >
                  {busy ? t('admin.firstRunImporting') : t('admin.firstRunCrCommit')}
                </button>
              ) : (
                <FirstRunStatusBanner tone="success" title={t('admin.firstRunCrAptsCommitted')} />
              )}
            </div>
          </div>
        </div>
        )}
      </div>

      <div className={styles.group}>
        <h3 className={styles.groupTitle}>{t('admin.firstRunCrFundTitle')}</h3>
        <p className={styles.hint}>{t('admin.firstRunCrFundLead')}</p>
        {!openingUnlocked && !fundOk ? (
          <p className={styles.hint}>{t('admin.firstRunOpeningLockedUntilTariff')}</p>
        ) : null}
        <div className={styles.formGrid}>
          <label className={styles.field}>
            {t('admin.firstRunCrFundBalance')}
            <input
              className={styles.input}
              value={balance}
              disabled={fundLocked}
              onChange={(e) => onBalance(e.target.value)}
            />
            <span className={styles.hint}>{t('admin.firstRunCrFundBalanceHint')}</span>
          </label>
          <label className={styles.field}>
            {t('admin.firstRunCrFundDate')}
            <input
              className={styles.input}
              type="date"
              value={date}
              disabled={fundLocked}
              onChange={(e) => onDate(e.target.value)}
            />
            <span className={styles.hint}>{t('admin.firstRunCrFundDateHint')}</span>
          </label>
          <label className={`${styles.field} ${styles.span2}`}>
            {t('admin.firstRunCrFundSource')}
            <input
              className={styles.input}
              value={source}
              disabled={fundLocked}
              onChange={(e) => onSource(e.target.value)}
            />
            <span className={styles.hint}>{t('admin.firstRunCrFundSourceHint')}</span>
          </label>
          <label className={`${styles.field} ${styles.span2}`}>
            {t('admin.firstRunCrFundNotes')}
            <input
              className={styles.input}
              value={notes}
              disabled={fundLocked}
              onChange={(e) => onNotes(e.target.value)}
            />
            <span className={styles.hint}>{t('admin.firstRunCrFundNotesHint')}</span>
          </label>
        </div>
        <FirstRunStageActions>
          {!fundOk ? (
            <button
              type="button"
              className={styles.primary}
              disabled={busy || !committed || !openingUnlocked}
              onClick={onFundConfirm}
            >
              {busy ? t('admin.firstRunBusy') : t('admin.firstRunCrFundCommit')}
            </button>
          ) : (
            <FirstRunStatusBanner tone="success" title={t('admin.firstRunCrFundCommitted')} />
          )}
          <button
            type="button"
            className={styles.primary}
            disabled={busy || !committed || !fundOk || !openingUnlocked}
            onClick={onContinue}
          >
            {busy ? t('admin.firstRunBusy') : t('admin.firstRunCrContinue')}
          </button>
        </FirstRunStageActions>
      </div>
    </FirstRunScreen>
  );
}

export function FirstRunFinish({
  t,
  busy,
  onFinish,
}: {
  t: T;
  busy: boolean;
  onFinish: () => void;
}) {
  return (
    <FirstRunScreen
      icon={BadgeCheck}
      iconClass="text-teal-700"
      title={t('admin.firstRunCompleteTitle')}
      lead={t('admin.firstRunCompleteBody')}
      busy={busy}
    >
      <FirstRunStageActions>
        <button type="button" className={styles.primary} disabled={busy} onClick={onFinish}>
          {busy ? t('admin.firstRunBusy') : t('admin.firstRunCompleteFinish')}
        </button>
      </FirstRunStageActions>
    </FirstRunScreen>
  );
}
