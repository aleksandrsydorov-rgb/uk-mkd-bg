'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Wifi } from 'lucide-react';
import type { Database } from '@/lib/database.types';
import { FirstRunStageActions } from '@/components/admin/FirstRunFrame';
import { FirstRunErrorTable, FirstRunScreen } from '@/components/admin/FirstRunSteps';
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
  presentInternetConnectionState,
  presentInternetImportOutcome,
  presentInternetImportWarning,
} from '@/lib/firstRunUserMessage';
import { toUserFacingMessage } from '@/lib/userFacingError';
import {
  downloadInternetIs5Template,
  normalizeInternetOpeningRow,
} from '@/lib/moduleCore/adapters/internetOpening';
import { internetOpeningAdapter } from '@/lib/moduleCore/adapters/internetOpeningAdapter';
import { parseModuleXlsxBuffer } from '@/lib/moduleCore/xlsxEngine';
import { INTERNET_IMPORT_SPEC, aliasesFromSpec } from '@/lib/importTemplates';
import { useI18n } from '@/i18n/I18nProvider';
import {
  formatInternetPaymentStatusLabel,
  internetPaymentStatus,
  type InternetPaidPeriod,
} from '@/lib/moduleCore/adapters/internetOpeningPayment';


function moduleXlsxLabels(
  schema: { columns: { labelKey: string }[] },
  t: (k: string) => string,
): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const col of schema.columns) {
    labels[col.labelKey] = t(`admin.${col.labelKey}`);
  }
  return labels;
}

function moduleXlsxHeaderAliases(schema: { columns: { key: string }[] }): Record<string, string[]> {
  const aliases: Record<string, string[]> = {};
  for (const col of schema.columns) aliases[col.key] = [col.key];
  for (const spec of [INTERNET_IMPORT_SPEC]) {
    for (const [key, list] of Object.entries(aliasesFromSpec(spec))) {
      if (!aliases[key]) continue;
      aliases[key] = [...new Set([...aliases[key], ...list])];
    }
  }
  return aliases;
}

type T = (key: string, params?: Record<string, string | number>) => string;

type PreviewRow = {
  apartment: string;
  status: string;
  connectionDate: string;
  paidPeriod: string;
  paymentStatus: string;
  debt: string;
  credit: string;
  notes: string;
  outcome: string;
  wasWill: string;
};

type DrySummary = {
  asOf: string;
  total: number;
  active: number;
  inactive: number;
  paidActive: number;
  paidExpired: number;
  paidUnknown: number;
  debtSum: number;
  creditSum: number;
  createCount: number;
  skipCount: number;
  correctCount: number;
};

function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function money(n: unknown): string {
  const x = Number(n ?? 0);
  if (!Number.isFinite(x)) return '0';
  return x.toFixed(2);
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
  const [rows, setRows] = useState<Record<string, string>[] | null>(null);
  const [previewPayload, setPreviewPayload] = useState<Record<string, unknown> | null>(null);
  const [previewCommitted, setPreviewCommitted] = useState(false);
  const [summary, setSummary] = useState<DrySummary | null>(null);
  const [dryOk, setDryOk] = useState(false);
  const [needsCorrectionConfirm, setNeedsCorrectionConfirm] = useState(false);
  const [confirmCorrections, setConfirmCorrections] = useState(false);
  const [errorRows, setErrorRows] = useState<FirstRunErrorRow[]>([]);
  const [committed, setCommitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noteKey, setNoteKey] = useState<string | null>(null);
  const [openingUnlocked, setOpeningUnlocked] = useState(() => isFirstRunTariffPrepared('internet', prep));

  const showImportForm = openingUnlocked || importCount > 0 || savedNone || committed;

  useEffect(() => {
    onNavHandle?.({
      persistDraft: async () => (await tariffNavRef.current?.persistDraft()) ?? true,
    });
    return () => onNavHandle?.(null);
  }, [onNavHandle]);

  const refreshImports = useCallback(async () => {
    const importsRes = await supabase
      .from('internet_opening_imports')
      .select('property_id', { count: 'exact', head: true });
    setImportCount(importsRes.count ?? 0);
    if ((importsRes.count ?? 0) > 0) setCommitted(true);
  }, [supabase]);

  useEffect(() => {
    void refreshImports().catch(() => {
      /* ignore until tables exist */
    });
  }, [refreshImports]);

  const canContinue = (none || importCount > 0 || committed) && openingUnlocked;

  const mapPreview = useCallback(
    (data: Record<string, unknown>, sofiaToday: string, opts?: { committed?: boolean }): PreviewRow[] => {
      const list = Array.isArray(data.rows) ? data.rows : [];
      const rowCommitted = opts?.committed === true;
      return list.map((raw) => {
        const r = asObj(raw);
        const status = String(r.status ?? r.connection_state ?? '');
        const billingMode = String(r.billing_mode ?? '').replace(/^"|"$/g, '');
        const paidStart = String(r.paid_period_start ?? '').trim() || null;
        const paidEnd = String(r.paid_period_end ?? r.paid_through ?? '').trim() || null;
        const periods: InternetPaidPeriod[] = [];
        if (Array.isArray(r.periods) && r.periods.length > 0) {
          for (const p of r.periods) {
            const o = asObj(p);
            const en = String(o.end ?? o.period_end ?? '').trim();
            if (en) {
              periods.push({
                start: String(o.start ?? o.period_start ?? '').trim() || null,
                end: en,
              });
            }
          }
        } else if (paidEnd) {
          periods.push({ start: paidStart, end: paidEnd });
        }
        const pay = internetPaymentStatus(periods, sofiaToday);
        const periodList = periods
          .map((p) => (p.start ? `${p.start} → ${p.end}` : t('admin.internetPaidThroughOnly', { date: p.end })))
          .filter(Boolean);
        const paidLabel = periodList.length > 0 ? periodList.join('; ') : '—';
        const warnCodes = Array.isArray(r.warnings)
          ? r.warnings.map((w) => String(w))
          : r.warnings
            ? [String(r.warnings)]
            : [];
        // Status column already covers payment_unknown — keep only apartment-specific notes.
        const warnLabels = warnCodes
          .filter((code) => code !== 'payment_unknown')
          .map((code) => presentInternetImportWarning(code, t, { billingMode }))
          .filter((label): label is string => Boolean(label));
        const payLabel = formatInternetPaymentStatusLabel(
          pay,
          t as (k: string, p?: Record<string, string>) => string,
        );
        const was = asObj(r.was);
        const will = asObj(r.will);
        let wasWill = '—';
        if (Object.keys(was).length || Object.keys(will).length) {
          const wasState = presentInternetConnectionState(String(was.status ?? ''), t);
          const willState = presentInternetConnectionState(String(will.status ?? ''), t);
          wasWill = `${wasState} → ${willState}`;
        }
        const comment = String(r.comment ?? r.notes ?? '').trim();
        const applied = r.applied === true;
        return {
          apartment: String(r.apartment_number ?? '—'),
          status: presentInternetConnectionState(status, t),
          connectionDate: String(r.connection_date ?? '').trim() || '—',
          paidPeriod: paidLabel,
          paymentStatus: payLabel,
          debt: money(r.opening_debt),
          credit: money(r.opening_credit),
          notes: [...(comment ? [comment] : []), ...warnLabels].join(' · ') || '—',
          outcome: presentInternetImportOutcome(String(r.outcome ?? ''), t, {
            committed: rowCommitted && applied,
          }),
          wasWill,
        };
      });
    },
    [t],
  );

  function mapSummary(data: Record<string, unknown>): DrySummary | null {
    const s = asObj(data.summary);
    if (!Object.keys(s).length) return null;
    return {
      asOf: String(s.as_of ?? s.asOf ?? ''),
      total: Number(s.total ?? 0) || 0,
      active: Number(s.active ?? 0) || 0,
      inactive: Number(s.inactive ?? 0) || 0,
      paidActive: Number(s.paid_active ?? s.paidActive ?? 0) || 0,
      paidExpired: Number(s.paid_expired ?? s.paidExpired ?? 0) || 0,
      paidUnknown: Number(s.paid_unknown ?? s.paidUnknown ?? 0) || 0,
      debtSum: Number(s.debt_sum ?? s.debtSum ?? 0) || 0,
      creditSum: Number(s.credit_sum ?? s.creditSum ?? 0) || 0,
      createCount: Number(s.create_count ?? s.createCount ?? 0) || 0,
      skipCount: Number(s.skip_count ?? s.skipCount ?? 0) || 0,
      correctCount: Number(s.correct_count ?? s.correctCount ?? 0) || 0,
    };
  }

  const previewRows = useMemo(() => {
    if (!previewPayload) return [] as PreviewRow[];
    const sofia = String(asObj(previewPayload.summary).as_of ?? new Date().toISOString().slice(0, 10));
    return mapPreview(previewPayload, sofia, { committed: previewCommitted });
  }, [previewPayload, previewCommitted, mapPreview]);

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
    setPreviewCommitted(false);
    setSummary(null);
    setErrorRows([]);
    setNeedsCorrectionConfirm(false);
    setConfirmCorrections(false);
    setCommitted(false);
    try {
      const schema = internetOpeningAdapter.registration.setup?.xlsx;
      if (!schema) throw new Error(t('admin.errGeneric'));
      const parsed = parseModuleXlsxBuffer(
        await file.arrayBuffer(),
        schema,
        moduleXlsxLabels(schema, t),
        moduleXlsxHeaderAliases(schema),
      );
      if (!parsed.ok) {
        setError(parsed.error);
        return;
      }
      if (parsed.rows.length === 0) {
        setError(t('admin.is5InternetEmptySheet'));
        return;
      }
      const normalized = parsed.rows.map((r) => normalizeInternetOpeningRow(r));
      const { data, error: rpcErr } = await importInternetOpening(supabase, normalized, true, {
        confirmCorrections: false,
      });
      if (rpcErr) throw new Error(rpcErr.message);
      const res = asObj(data);
      const errors = Array.isArray(res.errors) ? res.errors : [];
      setRows(normalized);
      setPreviewPayload(res);
      setPreviewCommitted(false);
      setSummary(mapSummary(res));
      setErrorRows(normalizeFirstRunErrors(errors));
      const correctCount = Number(asObj(res.summary).correct_count ?? 0) || 0;
      const needsConfirm =
        correctCount > 0 ||
        errors.some((e) => String(asObj(e).reason ?? '').includes('opening_correction_requires_confirm'));
      setNeedsCorrectionConfirm(needsConfirm);
      setDryOk(res.ok === true && errors.length === 0);
      setNone(false);
      if (res.ok === true && errors.length === 0) {
        setNoteKey('admin.firstRunInternetDryRunOk');
      }
    } catch (err: unknown) {
      setError(toUserFacingMessage(err, t, { context: 'first_run', fallback: t('admin.errGeneric') }));
    } finally {
      onBusy(false);
    }
  }

  async function onCommit() {
    if (!rows || !dryOk) return;
    if (needsCorrectionConfirm && !confirmCorrections) {
      setError(t('admin.firstRunInternetCorrectionConfirmRequired'));
      return;
    }
    onBusy(true);
    setError(null);
    try {
      const { data, error: rpcErr } = await importInternetOpening(supabase, rows, false, {
        confirmCorrections: confirmCorrections || !needsCorrectionConfirm,
      });
      if (rpcErr) {
        const errs = normalizeFirstRunErrors(
          (() => {
            try {
              const d = JSON.parse(String(rpcErr.details ?? '[]'));
              return Array.isArray(d) ? d : [];
            } catch {
              return [];
            }
          })(),
        );
        setErrorRows(errs);
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
      setPreviewCommitted(true);
      setSummary(mapSummary(res));
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
      await onContinue(none && importCount === 0 && !committed);
    } catch (err: unknown) {
      setError(toUserFacingMessage(err, t, { fallback: t('admin.errGeneric') }));
    } finally {
      onBusy(false);
    }
  }

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
        {!committed && noteKey ? <FirstRunStatusBanner tone="success" title={t(noteKey)} /> : null}
        {!committed && dryOk ? (
          <FirstRunStatusBanner tone="success" title={t('admin.firstRunOpeningCheckOkTitle')} />
        ) : null}
        {!committed && rows && !dryOk ? (
          <FirstRunStatusBanner
            tone={needsCorrectionConfirm ? 'warning' : 'error'}
            title={
              needsCorrectionConfirm
                ? t('admin.firstRunInternetCorrectionPendingTitle')
                : t('admin.firstRunOpeningCheckFailTitle')
            }
          />
        ) : null}
        {(importCount > 0 || savedNone || committed) && !openingUnlocked ? (
          <FirstRunStatusBanner
            tone="warning"
            title={t('admin.firstRunTariffNeededAfterImportTitle')}
            detail={t('admin.firstRunTariffNeededAfterImportDetail')}
          />
        ) : null}
      </FirstRunStatusStack>

      <p className={styles.hint}>{t('admin.firstRunInternetOpeningHint')}</p>
      <p className={styles.hint}>{t('admin.internetTariffCalendarHint')}</p>

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
                disabled={busy || importCount > 0 || committed || !openingUnlocked}
                onChange={(e) => {
                  setNone(e.target.checked);
                  setError(null);
                }}
              />
              <span>{t('admin.firstRunInternetOpeningNone')}</span>
            </label>

            {!none ? (
              <div className={styles.importGrid}>
                <div className={styles.stepBlock}>
                  <p className={styles.importLabel}>{t('admin.firstRunImportDownload')}</p>
                  <button
                    type="button"
                    className={styles.secondary}
                    disabled={busy || !openingUnlocked}
                    onClick={() => downloadInternetIs5Template(locale)}
                  >
                    {t('admin.firstRunInternetDownload')}
                  </button>
                  <p className={styles.hint}>{t('admin.firstRunInternetTemplateHint')}</p>
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
                    onChange={(picked) => void onFile(picked[0] ?? null)}
                  />
                </div>
                <div className={styles.stepBlock}>
                  <p className={styles.importLabel}>{t('admin.firstRunImportCheck')}</p>
                  {summary ? (
                    <div className={styles.hint}>
                      <p>
                        {t('admin.firstRunInternetSummaryAsOf')}: {summary.asOf || '—'}
                      </p>
                      <p>
                        {t('admin.firstRunInternetSummaryTotal')}: {summary.total} ·{' '}
                        {t('admin.internetConnectionStateActive')}: {summary.active} ·{' '}
                        {t('admin.internetConnectionStateInactive')}: {summary.inactive}
                      </p>
                      <p>
                        {t('admin.firstRunInternetSummaryPaidActive')}: {summary.paidActive} ·{' '}
                        {t('admin.firstRunInternetSummaryPaidExpired')}: {summary.paidExpired} ·{' '}
                        {t('admin.firstRunInternetSummaryPaidUnknown')}: {summary.paidUnknown}
                      </p>
                      <p>
                        {t('admin.firstRunInternetOpeningDebt')}: {money(summary.debtSum)} ·{' '}
                        {t('admin.firstRunInternetOpeningCredit')}: {money(summary.creditSum)}
                      </p>
                    </div>
                  ) : !committed ? (
                    <p className={styles.hint}>{t('admin.firstRunImportCheckPending')}</p>
                  ) : null}
                  {previewRows.length > 0 ? (
                    <div className={styles.tableWrap}>
                      <p className={styles.hint}>{t('admin.internetImportPreviewGeneralNote')}</p>
                      <table className={styles.table}>
                        <thead>
                          <tr>
                            <th>{t('admin.firstRunErrApartment')}</th>
                            <th>{t('admin.is5ColConnectionState')}</th>
                            <th>{t('admin.firstRunInternetOpeningConnectionDate')}</th>
                            <th>{t('admin.firstRunInternetPaidPeriodCol')}</th>
                            <th>{t('admin.firstRunInternetPaymentStatusCol')}</th>
                            <th>{t('admin.firstRunInternetOpeningDebt')}</th>
                            <th>{t('admin.firstRunInternetOpeningCredit')}</th>
                            <th>{t('admin.is5ColComment')}</th>
                            <th>{t('admin.is5Outcome')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {previewRows.slice(0, 200).map((row, i) => (
                            <tr key={`${row.apartment}-${i}`}>
                              <td>{row.apartment}</td>
                              <td>{row.status}</td>
                              <td>{row.connectionDate}</td>
                              <td>{row.paidPeriod}</td>
                              <td>{row.paymentStatus}</td>
                              <td>{row.debt}</td>
                              <td>{row.credit}</td>
                              <td>{row.notes}</td>
                              <td>
                                {row.outcome}
                                {row.wasWill !== '—' ? (
                                  <>
                                    <br />
                                    <span className={styles.hint}>{row.wasWill}</span>
                                  </>
                                ) : null}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}
                  <div className={styles.tableWrap}>
                    <FirstRunErrorTable rows={errorRows} t={t} nothingSaved={!committed} />
                  </div>
                </div>
                <div className={styles.stepBlock}>
                  <p className={styles.importLabel}>{t('admin.firstRunImportConfirm')}</p>
                  <p className={styles.hint}>{t('admin.firstRunInternetConfirm')}</p>
                  {needsCorrectionConfirm ? (
                    <label className={styles.choice}>
                      <input
                        type="checkbox"
                        checked={confirmCorrections}
                        disabled={busy || committed}
                        onChange={(e) => setConfirmCorrections(e.target.checked)}
                      />
                      <span>{t('admin.firstRunInternetCorrectionConfirm')}</span>
                    </label>
                  ) : null}
                  {!openingUnlocked && !committed ? (
                    <p className={styles.hint}>{t('admin.firstRunOpeningConfirmLockedWhileEditing')}</p>
                  ) : null}
                  {!committed ? (
                    <button
                      type="button"
                      className={styles.primary}
                      disabled={
                        busy ||
                        !dryOk ||
                        !openingUnlocked ||
                        (needsCorrectionConfirm && !confirmCorrections)
                      }
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
