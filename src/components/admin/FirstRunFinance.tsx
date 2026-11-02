'use client';

import { BadgeCheck, CircleDollarSign, Landmark } from 'lucide-react';
import type { FirstRunErrorRow } from '@/lib/firstRun';
import { explainFirstRunFailure } from '@/lib/firstRunUserMessage';
import { FirstRunErrorTable, FirstRunScreen } from '@/components/admin/FirstRunSteps';
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
  const view = explainFirstRunFailure(raw, t);
  return (
    <div className={styles.badNote}>
      <p>{view.message}</p>
      {view.detail ? (
        <details className={styles.detail}>
          <summary>{t('admin.firstRunErrDetail')}</summary>
          <p>{view.detail}</p>
        </details>
      ) : null}
    </div>
  );
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
  onDownload: () => void;
  onFile: (file: File | null) => void;
  onCommit: () => void;
  onContinue: () => void;
}) {
  return (
    <FirstRunScreen
      icon={CircleDollarSign}
      iconClass="text-teal-700"
      title={t('admin.firstRunSfTitle')}
      lead={t('admin.firstRunSfLead')}
      busy={busy}
    >
      <div className={styles.importGrid}>
        <div className={styles.stepBlock}>
          <p className={styles.importLabel}>{t('admin.firstRunImportDownload')}</p>
          <button type="button" className={styles.secondary} disabled={busy} onClick={onDownload}>
            {t('admin.firstRunSfDownload')}
          </button>
        </div>
        <div className={styles.stepBlock}>
          <p className={styles.importLabel}>{t('admin.firstRunImportUpload')}</p>
          <label className={styles.file}>
            {t('admin.firstRunSfUpload')}
            <input
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              disabled={busy}
              onChange={(e) => {
                onFile(e.target.files?.[0] ?? null);
                e.target.value = '';
              }}
            />
          </label>
        </div>
        <div className={styles.stepBlock}>
          <p className={styles.importLabel}>{t('admin.firstRunImportCheck')}</p>
          {dry ? (
            <>
              {dry.ok ? <OpeningStats dry={dry} t={t} /> : null}
              <p className={dry.ok ? styles.okNote : styles.badNote}>
                {dry.ok
                  ? t('admin.firstRunSfDryRunOk')
                      .replace('{rows}', String(dry.rowCount))
                      .replace('{create}', String(dry.createCount))
                      .replace('{skipped}', String(dry.skippedExisting))
                      .replace('{debt}', String(dry.debtSum))
                      .replace('{credit}', String(dry.creditSum))
                  : t('admin.firstRunSfDryRunErrors').replace('{n}', String(dry.errors.length))}
              </p>
            </>
          ) : (
            <p className={styles.hint}>{t('admin.firstRunImportCheckPending')}</p>
          )}
          <div className={styles.tableWrap}>
            <FirstRunErrorTable rows={errorRows} t={t} />
          </div>
        </div>
        <div className={styles.stepBlock}>
          <p className={styles.importLabel}>{t('admin.firstRunImportConfirm')}</p>
          <p className={styles.hint}>{t('admin.firstRunSfConfirm')}</p>
          <div className={styles.actions}>
            {!committed ? (
              <button
                type="button"
                className={styles.primary}
                disabled={busy || !canCommit}
                onClick={onCommit}
              >
                {busy ? t('admin.firstRunBusy') : t('admin.firstRunSfCommit')}
              </button>
            ) : (
              <button type="button" className={styles.primary} disabled={busy} onClick={onContinue}>
                {busy ? t('admin.firstRunBusy') : t('admin.firstRunSfContinue')}
              </button>
            )}
          </div>
          {note ? <p className={styles.okNote}>{note}</p> : null}
          {error ? <p className={styles.badNote}>{error}</p> : null}
        </div>
      </div>
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
  return (
    <FirstRunScreen
      icon={Landmark}
      iconClass="text-indigo-600"
      title={t('admin.firstRunCrTitle')}
      lead={t('admin.firstRunCrLead')}
      busy={busy}
    >
      <div className={styles.group}>
        <h3 className={styles.groupTitle}>{t('admin.firstRunImportCheck')}</h3>
        <div className={styles.importGrid}>
          <div className={styles.stepBlock}>
            <p className={styles.importLabel}>{t('admin.firstRunImportDownload')}</p>
            <button type="button" className={styles.secondary} disabled={busy} onClick={onDownload}>
              {t('admin.firstRunCrDownload')}
            </button>
          </div>
          <div className={styles.stepBlock}>
            <p className={styles.importLabel}>{t('admin.firstRunImportUpload')}</p>
            <label className={styles.file}>
              {t('admin.firstRunCrUpload')}
              <input
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                disabled={busy}
                onChange={(e) => {
                  onFile(e.target.files?.[0] ?? null);
                  e.target.value = '';
                }}
              />
            </label>
          </div>
          <div className={styles.stepBlock}>
            <p className={styles.importLabel}>{t('admin.firstRunImportCheck')}</p>
            {dry ? (
              <>
                {dry.ok ? <OpeningStats dry={dry} t={t} /> : null}
                <p className={dry.ok ? styles.okNote : styles.badNote}>
                  {dry.ok
                    ? t('admin.firstRunCrDryRunOk')
                        .replace('{rows}', String(dry.rowCount))
                        .replace('{create}', String(dry.createCount))
                        .replace('{skipped}', String(dry.skippedExisting))
                        .replace('{debt}', String(dry.debtSum))
                        .replace('{credit}', String(dry.creditSum))
                    : t('admin.firstRunCrDryRunErrors').replace('{n}', String(dry.errors.length))}
                </p>
              </>
            ) : (
              <p className={styles.hint}>{t('admin.firstRunImportCheckPending')}</p>
            )}
            <div className={styles.tableWrap}>
              <FirstRunErrorTable rows={errorRows} t={t} />
            </div>
          </div>
          <div className={styles.stepBlock}>
            <p className={styles.importLabel}>{t('admin.firstRunImportConfirm')}</p>
            <p className={styles.hint}>{t('admin.firstRunCrConfirm')}</p>
            <div className={styles.actions}>
              {!committed ? (
                <button
                  type="button"
                  className={styles.primary}
                  disabled={busy || !canCommit}
                  onClick={onCommit}
                >
                  {busy ? t('admin.firstRunBusy') : t('admin.firstRunCrCommit')}
                </button>
              ) : (
                <p className={styles.okNote}>{t('admin.firstRunCrAptsCommitted')}</p>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className={styles.group}>
        <h3 className={styles.groupTitle}>{t('admin.firstRunCrFundTitle')}</h3>
        <p className={styles.hint}>{t('admin.firstRunCrFundLead')}</p>
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
          </label>
          <label className={`${styles.field} ${styles.span2}`}>
            {t('admin.firstRunCrFundSource')}
            <input
              className={styles.input}
              value={source}
              disabled={fundLocked}
              onChange={(e) => onSource(e.target.value)}
            />
          </label>
          <label className={`${styles.field} ${styles.span2}`}>
            {t('admin.firstRunCrFundNotes')}
            <input
              className={styles.input}
              value={notes}
              disabled={fundLocked}
              onChange={(e) => onNotes(e.target.value)}
            />
          </label>
        </div>
        <div className={styles.actions}>
          {!fundOk ? (
            <button
              type="button"
              className={styles.primary}
              disabled={busy || !committed}
              onClick={onFundConfirm}
            >
              {busy ? t('admin.firstRunBusy') : t('admin.firstRunCrFundCommit')}
            </button>
          ) : (
            <p className={styles.okNote}>{t('admin.firstRunCrFundCommitted')}</p>
          )}
          <button
            type="button"
            className={styles.primary}
            disabled={busy || !committed || !fundOk}
            onClick={onContinue}
          >
            {busy ? t('admin.firstRunBusy') : t('admin.firstRunCrContinue')}
          </button>
        </div>
      </div>
      {note ? <p className={styles.okNote}>{note}</p> : null}
      {error ? <p className={styles.badNote}>{error}</p> : null}
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
      <div className={styles.actions}>
        <button type="button" className={styles.primary} disabled={busy} onClick={onFinish}>
          {busy ? t('admin.firstRunBusy') : t('admin.firstRunCompleteFinish')}
        </button>
      </div>
    </FirstRunScreen>
  );
}
