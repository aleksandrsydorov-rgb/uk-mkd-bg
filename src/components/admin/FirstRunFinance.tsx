'use client';

import { useState, type Ref } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { BadgeCheck, CircleDollarSign, Landmark } from 'lucide-react';
import type { Database } from '@/lib/database.types';
import { isFirstRunTariffPrepared, type FirstRunErrorRow, type FirstRunTariffPrepMap } from '@/lib/firstRun';
import { explainFirstRunFailure } from '@/lib/firstRunUserMessage';
import { FirstRunStageActions } from '@/components/admin/FirstRunFrame';
import { FirstRunErrorTable, FirstRunScreen } from '@/components/admin/FirstRunSteps';
import {
  FirstRunTariffPrepBlock,
  type FirstRunTariffPrepHandle,
} from '@/components/admin/FirstRunTariffPrepBlock';
import { FirstRunStatusBanner, FirstRunStatusStack } from '@/components/admin/FirstRunStatusBanner';
import { AppFilePicker } from '@/components/ui/AppFilePicker';
import styles from './FirstRunFrame.module.css';

type T = (key: string) => string;

type OpeningDry = {
  ok: boolean;
  errors: unknown[];
  rowCount: number;
  createCount: number;
  skippedExisting: number;
  debtSum: number;
  creditSum: number;
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

function OpeningStats({ dry, t }: { dry: OpeningDry; t: T }) {
  return (
    <div className={styles.stats}>
      <Stat value={String(dry.rowCount)} label={t('admin.firstRunStatRows')} />
      <Stat value={String(dry.createCount)} label={t('admin.firstRunStatCreate')} />
      <Stat value={String(dry.skippedExisting)} label={t('admin.firstRunStatSkipped')} />
      <Stat value={String(dry.debtSum)} label={t('admin.firstRunStatDebt')} />
      <Stat value={String(dry.creditSum)} label={t('admin.firstRunStatCredit')} />
    </div>
  );
}

export function FirstRunSupportFee({
  t,
  busy,
  dry,
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
  const [openingUnlocked, setOpeningUnlocked] = useState(() =>
    isFirstRunTariffPrepared('support_fee', tariffPrep ?? {}),
  );
  const showImportForm = openingUnlocked || committed;
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
              .replace('{debt}', String(dry.debtSum))
              .replace('{credit}', String(dry.creditSum))}
          />
        ) : null}
        {!committed && dry && !dry.ok ? (
          <FirstRunStatusBanner
            tone="error"
            title={t('admin.firstRunOpeningCheckFailTitle')}
            detail={t('admin.firstRunSfDryRunErrors').replace('{n}', String(dry.errors.length))}
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
          {dry && !committed && dry.ok ? <OpeningStats dry={dry} t={t} /> : null}
          {!dry && !committed ? <p className={styles.hint}>{t('admin.firstRunImportCheckPending')}</p> : null}
          <div className={styles.tableWrap}>
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
                disabled={busy || !canCommit || !openingUnlocked}
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
            {dry && !committed && dry.ok ? <OpeningStats dry={dry} t={t} /> : null}
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
