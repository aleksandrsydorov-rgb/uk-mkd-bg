'use client';

import type { ReactNode } from 'react';
import { BookOpen, Building2, Droplets, Gauge, Zap, type LucideIcon } from 'lucide-react';
import type { FirstRunComplexForm, FirstRunErrorRow, FirstRunMeterUtility } from '@/lib/firstRun';
import styles from './FirstRunFrame.module.css';

type T = (key: string) => string;

export function FirstRunScreen({
  icon: Icon,
  iconClass,
  title,
  lead,
  busy,
  children,
}: {
  icon: LucideIcon;
  iconClass: string;
  title: string;
  lead: string;
  busy: boolean;
  children: ReactNode;
}) {
  return (
    <section className={styles.screen} aria-busy={busy}>
      <header className={styles.screenHead}>
        <Icon className={`${styles.screenIcon} ${iconClass}`} aria-hidden="true" />
        <div>
          <h2 className={styles.screenTitle}>{title}</h2>
          <p className={styles.screenLead}>{lead}</p>
        </div>
      </header>
      {children}
    </section>
  );
}

function Field({
  label,
  hint,
  error,
  wide,
  children,
}: {
  label: string;
  hint: string;
  error?: string | null;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <label className={`${styles.field} ${wide ? styles.span2 : ''}`}>
      {label}
      {children}
      <span className={styles.hint}>{hint}</span>
      {error ? <span className={styles.fieldError}>{error}</span> : null}
    </label>
  );
}

export function FirstRunComplexCard({
  t,
  form,
  formErrors,
  busy,
  showBack,
  onChange,
  onSave,
  onBack,
}: {
  t: T;
  form: FirstRunComplexForm;
  formErrors: string[];
  busy: boolean;
  showBack: boolean;
  onChange: (next: FirstRunComplexForm) => void;
  onSave: () => void;
  onBack: () => void;
}) {
  const err = (key: string) => (formErrors.includes(key) ? t(`admin.firstRunComplexErr_${key}`) : null);
  return (
    <FirstRunScreen
      icon={Building2}
      iconClass="text-teal-700"
      title={t('admin.firstRunComplexTitle')}
      lead={t('admin.firstRunComplexLead')}
      busy={busy}
    >
      <div className={styles.group}>
        <h3 className={styles.groupTitle}>{t('admin.firstRunGroupIdentity')}</h3>
        <div className={styles.formGrid}>
          <Field label={t('admin.firstRunFieldName')} hint={t('admin.firstRunFieldNameHint')} error={err('display_name')} wide>
            <input
              className={styles.input}
              value={form.display_name}
              disabled={busy}
              onChange={(e) => onChange({ ...form, display_name: e.target.value })}
            />
          </Field>
          <Field label={t('admin.firstRunFieldAddress')} hint={t('admin.firstRunFieldAddressHint')} error={err('address')} wide>
            <input
              className={styles.input}
              value={form.address}
              disabled={busy}
              onChange={(e) => onChange({ ...form, address: e.target.value })}
            />
          </Field>
        </div>
      </div>
      <div className={styles.group}>
        <h3 className={styles.groupTitle}>{t('admin.firstRunGroupContacts')}</h3>
        <div className={styles.formGrid}>
          <Field
            label={t('admin.firstRunFieldApartmentCount')}
            hint={t('admin.firstRunFieldApartmentCountHint')}
            error={err('apartment_count')}
          >
            <input
              className={styles.input}
              inputMode="numeric"
              value={form.apartment_count}
              disabled={busy}
              onChange={(e) => onChange({ ...form, apartment_count: e.target.value })}
            />
          </Field>
          <Field label={t('admin.firstRunFieldPhone')} hint={t('admin.firstRunFieldPhoneHint')}>
            <input
              className={styles.input}
              type="tel"
              value={form.contact_phone}
              disabled={busy}
              onChange={(e) => onChange({ ...form, contact_phone: e.target.value })}
            />
          </Field>
          <Field
            label={t('admin.firstRunFieldEmail')}
            hint={t('admin.firstRunFieldEmailHint')}
            error={err('contact_email')}
            wide
          >
            <input
              className={styles.input}
              type="email"
              value={form.contact_email}
              disabled={busy}
              onChange={(e) => onChange({ ...form, contact_email: e.target.value })}
            />
          </Field>
        </div>
      </div>
      <div className={styles.actions}>
        <button type="button" className={styles.primary} disabled={busy} onClick={onSave}>
          {busy ? t('admin.firstRunBusy') : t('admin.firstRunContinue')}
        </button>
        {showBack ? (
          <button type="button" className={styles.secondary} disabled={busy} onClick={onBack}>
            {t('admin.firstRunBack')}
          </button>
        ) : null}
      </div>
    </FirstRunScreen>
  );
}

export function FirstRunErrorTable({ rows, t }: { rows: FirstRunErrorRow[]; t: T }) {
  if (rows.length === 0) return null;
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>{t('admin.firstRunErrRow')}</th>
            <th>{t('admin.firstRunErrApartment')}</th>
            <th>{t('admin.firstRunErrField')}</th>
            <th>{t('admin.firstRunErrReason')}</th>
            <th>{t('admin.firstRunErrSheet')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 200).map((row, index) => (
            <tr key={`${row.sheet}-${row.row}-${row.field}-${index}`}>
              <td>{row.row || '—'}</td>
              <td>{row.apartment || '—'}</td>
              <td>{row.field || '—'}</td>
              <td>{row.reason || '—'}</td>
              <td>{row.sheet || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 200 ? (
        <p className={styles.hint}>{t('admin.firstRunErrTruncated').replace('{n}', String(rows.length))}</p>
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

export function FirstRunBookImport({
  t,
  apartmentCount,
  busy,
  dry,
  errorRows,
  countMismatch,
  committed,
  needsComplexFix,
  onDownload,
  onFile,
  onCommit,
  onContinue,
  onEditComplex,
}: {
  t: T;
  apartmentCount: string;
  busy: boolean;
  dry: {
    ok: boolean;
    newCount: number;
    existingCount: number;
    changesCount: number;
    requiresOverwriteConfirmation: boolean;
  } | null;
  errorRows: FirstRunErrorRow[];
  countMismatch: { expected: number | null; actual: number | null } | null;
  committed: boolean;
  needsComplexFix: boolean;
  onDownload: () => void;
  onFile: (file: File | null) => void;
  onCommit: () => void;
  onContinue: () => void;
  onEditComplex: () => void;
}) {
  return (
    <FirstRunScreen
      icon={BookOpen}
      iconClass="text-indigo-600"
      title={t('admin.firstRunBookTitle')}
      lead={t('admin.firstRunBookLead').replace('{n}', apartmentCount)}
      busy={busy}
    >
      <div className={styles.importGrid}>
        <div className={styles.stepBlock}>
          <p className={styles.importLabel}>{t('admin.firstRunImportDownload')}</p>
          <button type="button" className={styles.secondary} onClick={onDownload}>
            {t('admin.firstRunBookDownload')}
          </button>
        </div>
        <div className={styles.stepBlock}>
          <p className={styles.importLabel}>{t('admin.firstRunImportUpload')}</p>
          <label className={styles.file}>
            {t('admin.firstRunBookUpload')}
            <input
              type="file"
              accept=".xlsx"
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
              <div className={styles.stats}>
                <Stat value={String(dry.newCount)} label={t('admin.firstRunBookStatNew')} />
                <Stat value={String(dry.existingCount)} label={t('admin.firstRunBookStatExisting')} />
                <Stat value={String(dry.changesCount)} label={t('admin.firstRunBookStatChanges')} />
              </div>
              {dry.ok ? (
                <p className={styles.okNote}>
                  {t('admin.firstRunBookDryRunOk')
                    .replace('{new}', String(dry.newCount))
                    .replace('{existing}', String(dry.existingCount))
                    .replace('{changes}', String(dry.changesCount))}
                </p>
              ) : (
                <p className={styles.badNote}>
                  {t('admin.firstRunBookDryRunErrors').replace('{n}', String(errorRows.length))}
                </p>
              )}
              {dry.requiresOverwriteConfirmation ? (
                <p className={styles.warnNote}>{t('admin.firstRunBookOverwriteBlocked')}</p>
              ) : null}
            </>
          ) : (
            <p className={styles.hint}>{t('admin.firstRunImportCheckPending')}</p>
          )}
          {needsComplexFix ? (
            <div className={styles.warnNote}>
              <p>
                {t('admin.firstRunBookCountMismatch')
                  .replace('{expected}', String(countMismatch?.expected ?? apartmentCount))
                  .replace('{actual}', String(countMismatch?.actual ?? '—'))}
              </p>
              <button type="button" className={`${styles.secondary}`} disabled={busy} onClick={onEditComplex}>
                {t('admin.firstRunBookBackToComplex')}
              </button>
            </div>
          ) : null}
          <div className={styles.tableWrap} style={{ marginTop: 8 }}>
            <FirstRunErrorTable rows={errorRows} t={t} />
          </div>
        </div>
        <div className={styles.stepBlock}>
          <p className={styles.importLabel}>{t('admin.firstRunImportConfirm')}</p>
          <div className={styles.actions}>
            {!committed ? (
              <button
                type="button"
                className={styles.primary}
                disabled={busy || !dry?.ok || dry.requiresOverwriteConfirmation}
                onClick={onCommit}
              >
                {busy ? t('admin.firstRunBusy') : t('admin.firstRunBookCommit')}
              </button>
            ) : (
              <button type="button" className={styles.primary} onClick={onContinue}>
                {t('admin.firstRunContinue')}
              </button>
            )}
            <button type="button" className={styles.secondary} disabled={busy} onClick={onEditComplex}>
              {t('admin.firstRunEditComplex')}
            </button>
          </div>
        </div>
      </div>
    </FirstRunScreen>
  );
}

export function FirstRunMetersSelectForm({
  t,
  water,
  electricity,
  busy,
  valid,
  onWater,
  onElectricity,
  onContinue,
  onEditComplex,
}: {
  t: T;
  water: boolean;
  electricity: boolean;
  busy: boolean;
  valid: boolean;
  onWater: (checked: boolean) => void;
  onElectricity: (checked: boolean) => void;
  onContinue: () => void;
  onEditComplex: () => void;
}) {
  return (
    <FirstRunScreen
      icon={Gauge}
      iconClass="text-amber-600"
      title={t('admin.firstRunMetersSelectTitle')}
      lead={t('admin.firstRunMetersSelectLead')}
      busy={busy}
    >
      <div className={styles.choices}>
        <label className={`${styles.choice} ${water ? styles.choiceOn : ''}`}>
          <input type="checkbox" checked={water} disabled={busy} onChange={(e) => onWater(e.target.checked)} />
          <Droplets className="h-4 w-4 text-sky-600" aria-hidden="true" />
          {t('admin.firstRunMetersSelectWater')}
        </label>
        <label className={`${styles.choice} ${electricity ? styles.choiceOn : ''}`}>
          <input
            type="checkbox"
            checked={electricity}
            disabled={busy}
            onChange={(e) => onElectricity(e.target.checked)}
          />
          <Zap className="h-4 w-4 text-yellow-600" aria-hidden="true" />
          {t('admin.firstRunMetersSelectElectricity')}
        </label>
      </div>
      {!valid ? <p className={styles.fieldError}>{t('admin.firstRunMetersSelectRequired')}</p> : null}
      <div className={styles.actions}>
        <button type="button" className={styles.primary} disabled={busy || !valid} onClick={onContinue}>
          {busy ? t('admin.firstRunBusy') : t('admin.firstRunContinue')}
        </button>
        <button type="button" className={styles.secondary} disabled={busy} onClick={onEditComplex}>
          {t('admin.firstRunEditComplex')}
        </button>
      </div>
    </FirstRunScreen>
  );
}

const METER_COLUMNS = [
  ['apartment_number', 'admin.firstRunMetersColApartment'],
  ['meter_number', 'admin.firstRunMetersColNumber'],
  ['initial_reading', 'admin.firstRunMetersColReading'],
  ['opening_balance_kind', 'admin.firstRunMetersColKind'],
  ['opening_balance_eur', 'admin.firstRunMetersColAmount'],
] as const;

export function FirstRunMetersImport({
  utility,
  t,
  busy,
  dry,
  rows,
  errorRows,
  committed,
  onDownload,
  onFile,
  onCommit,
  onContinue,
  onEditComplex,
}: {
  utility: FirstRunMeterUtility;
  t: T;
  busy: boolean;
  dry: { ok: boolean; rowCount: number; skippedExisting: number } | null;
  rows: Record<string, string>[] | null;
  errorRows: FirstRunErrorRow[];
  committed: boolean;
  onDownload: () => void;
  onFile: (file: File | null) => void;
  onCommit: () => void;
  onContinue: () => void;
  onEditComplex: () => void;
}) {
  const title = utility === 'water' ? t('admin.firstRunStageMetersWater') : t('admin.firstRunStageMetersElectricity');
  const Icon = utility === 'water' ? Droplets : Zap;
  const iconClass = utility === 'water' ? 'text-sky-600' : 'text-yellow-600';
  return (
    <FirstRunScreen icon={Icon} iconClass={iconClass} title={title} lead={t('admin.firstRunMetersLead')} busy={busy}>
      <div className={styles.importGrid}>
        <div className={styles.stepBlock}>
          <p className={styles.importLabel}>{t('admin.firstRunImportDownload')}</p>
          <button type="button" className={styles.secondary} onClick={onDownload}>
            {t('admin.firstRunMetersDownload')}
          </button>
        </div>
        <div className={styles.stepBlock}>
          <p className={styles.importLabel}>{t('admin.firstRunImportUpload')}</p>
          <label className={styles.file}>
            {t('admin.firstRunMetersUpload')}
            <input
              type="file"
              accept=".xlsx"
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
              <div className={styles.stats}>
                <Stat value={String(dry.rowCount)} label={t('admin.firstRunMetersStatRows')} />
                <Stat value={String(dry.skippedExisting)} label={t('admin.firstRunMetersStatSkipped')} />
              </div>
              {dry.ok ? (
                <p className={styles.okNote}>
                  {t('admin.firstRunMetersDryRunOk')
                    .replace('{rows}', String(dry.rowCount))
                    .replace('{skipped}', String(dry.skippedExisting))}
                </p>
              ) : (
                <p className={styles.badNote}>
                  {t('admin.firstRunMetersDryRunErrors').replace('{n}', String(errorRows.length))}
                </p>
              )}
            </>
          ) : (
            <p className={styles.hint}>{t('admin.firstRunImportCheckPending')}</p>
          )}
          {rows && rows.length > 0 ? (
            <div className={styles.tableWrap} style={{ marginTop: 8 }}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    {METER_COLUMNS.map(([, key]) => (
                      <th key={key}>{t(key)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => (
                    <tr key={`${row.meter_number ?? ''}-${row.apartment_number ?? ''}-${index}`}>
                      {METER_COLUMNS.map(([field]) => (
                        <td key={field}>{row[field]?.trim() ? row[field] : '—'}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <div style={{ marginTop: 8 }}>
            <FirstRunErrorTable rows={errorRows} t={t} />
          </div>
        </div>
        <div className={styles.stepBlock}>
          <p className={styles.importLabel}>{t('admin.firstRunImportConfirm')}</p>
          <div className={styles.actions}>
            {!committed ? (
              <button type="button" className={styles.primary} disabled={busy || !dry?.ok} onClick={onCommit}>
                {busy ? t('admin.firstRunBusy') : t('admin.firstRunMetersCommit')}
              </button>
            ) : (
              <button type="button" className={styles.primary} onClick={onContinue}>
                {t('admin.firstRunContinue')}
              </button>
            )}
            <button type="button" className={styles.secondary} disabled={busy} onClick={onEditComplex}>
              {t('admin.firstRunEditComplex')}
            </button>
          </div>
        </div>
      </div>
    </FirstRunScreen>
  );
}
