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
  formatSfBalanceLabel,
  formatSfEntranceTitle,
  presentSfOutcome,
} from '@/lib/firstRunSupportFeePreview';
import { FirstRunStageActions } from '@/components/admin/FirstRunFrame';
import { FirstRunErrorTable, FirstRunScreen } from '@/components/admin/FirstRunSteps';
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
  } | null;
}) {
  const debtSum = previewCounts?.debtSum ?? dry.debtSum;
  const creditSum = previewCounts?.creditSum ?? dry.creditSum;
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
  onDownload,
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
  onDownload: () => void;
  onFile: (file: File | null) => void;
  onCommit: () => void;
  onContinue: () => void;
}) {
  const { locale } = useI18n();
  const [openingUnlocked, setOpeningUnlocked] = useState(() =>
    isFirstRunTariffPrepared('support_fee', tariffPrep ?? {}),
  );
  const showImportForm = openingUnlocked || committed;
  const preview = useMemo(() => {
    if (!rows || rows.length === 0 || committed) return null;
    return buildSupportFeeOpeningPreview(rows, {
      rpcRows: dry?.rpcRows,
      errorRows,
      t,
    });
  }, [rows, dry?.rpcRows, errorRows, committed, t]);
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
        {!committed && dry && !dry.ok ? (
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
          <button type="button" className={styles.secondary} disabled={busy || !openingUnlocked} onClick={onDownload}>
            {t('admin.firstRunSfDownload')}
          </button>
          <p className={styles.hint}>{t('admin.firstRunSfImportColumnsHint')}</p>
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
          {dry && !committed ? (
            <OpeningStats
              dry={dry}
              t={t}
              locale={locale}
              previewCounts={
                preview
                  ? {
                      debtCount: preview.debtCount,
                      creditCount: preview.creditCount,
                      zeroCount: preview.zeroCount,
                      debtSum: preview.debtSum,
                      creditSum: preview.creditSum,
                    }
                  : null
              }
            />
          ) : null}
          {!dry && !committed ? <p className={styles.hint}>{t('admin.firstRunImportCheckPending')}</p> : null}
          {preview && preview.groups.length > 0 && !committed ? (
            <div className={styles.tableWrap} style={{ marginTop: 12 }}>
              <p className={styles.importLabel}>{t('admin.firstRunSfPreviewTitle')}</p>
              <p className={styles.hint}>{t('admin.firstRunSfPreviewHint')}</p>
              {preview.groups.map((group) => (
                <div key={`sf-g-${group.key}`} style={{ marginTop: 12 }}>
                  <p className={styles.hint} style={{ marginBottom: 6, fontWeight: 600 }}>
                    {formatSfEntranceTitle(group, t)}
                  </p>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>{t('admin.firstRunSfColApt')}</th>
                        <th>{t('admin.firstRunSfColYear')}</th>
                        <th>{t('admin.firstRunSfColAssessed')}</th>
                        <th>{t('admin.firstRunSfColPaid')}</th>
                        <th>{t('admin.firstRunSfColBalance')}</th>
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
                            </div>
                            {item.errorText ? (
                              <div className={styles.hint} style={{ color: '#b91c1c', marginTop: 4 }}>
                                {item.errorText}
                              </div>
                            ) : null}
                          </td>
                          <td>{item.billingYear || '—'}</td>
                          <td>
                            {item.assessed == null ? '—' : `${formatMeterMoney(item.assessed, locale)} €`}
                          </td>
                          <td>
                            {item.paid == null ? '—' : `${formatMeterMoney(item.paid, locale)} €`}
                          </td>
                          <td>{formatSfBalanceLabel(item, t, locale)}</td>
                          <td>{presentSfOutcome(item.outcome, t)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          ) : null}
          <div className={styles.tableWrap} style={{ marginTop: 8 }}>
            {!dry?.ok && errorRows.length > 0 ? (
              <p className={styles.hint} style={{ marginBottom: 8 }}>
                {t('admin.firstRunSfBlockingDetail')}
              </p>
            ) : null}
            <FirstRunErrorTable rows={errorRows} t={t} nothingSaved={!committed} />
          </div>
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
  onDownload,
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
  onDownload: () => void;
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
  const showImportForm = openingUnlocked || committed;
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
              .replace('{debt}', String(dry.debtSum))
              .replace('{credit}', String(dry.creditSum))}
          />
        ) : null}
        {!committed && dry && !dry.ok ? (
          <FirstRunStatusBanner
            tone="error"
            title={t('admin.firstRunOpeningCheckFailTitle')}
            detail={t('admin.firstRunCrDryRunErrors').replace('{n}', String(dry.errors.length))}
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
            <button type="button" className={styles.secondary} disabled={busy || !openingUnlocked} onClick={onDownload}>
              {t('admin.firstRunCrDownload')}
            </button>
            <p className={styles.hint}>{t('admin.firstRunCrImportColumnsHint')}</p>
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
            {dry && !committed && dry.ok ? (
              <OpeningStats dry={dry} t={t} locale={locale} previewCounts={null} />
            ) : null}
            {!dry && !committed ? <p className={styles.hint}>{t('admin.firstRunImportCheckPending')}</p> : null}
            <div className={styles.tableWrap}>
              <FirstRunErrorTable rows={errorRows} t={t} nothingSaved={!committed} />
            </div>
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
                  disabled={busy || !canCommit || !openingUnlocked}
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
