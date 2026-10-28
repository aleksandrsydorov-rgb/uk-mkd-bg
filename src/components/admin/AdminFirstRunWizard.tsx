'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  AdminCard,
  AdminPageHeader,
  adminBtnPrimaryClass,
  adminBtnSecondaryClass,
  adminFieldClass,
  adminTableCellClass,
  adminTableHeadRowClass,
  adminTableRowClass,
} from '@/components/admin/AdminUi';
import {
  apartmentCountMismatchInfo,
  complexFormToPayload,
  complexToForm,
  completeFirstRunStage,
  fetchFirstRunState,
  firstMetersStage,
  hasApartmentCountMismatch,
  importCapitalRepairOpening,
  importMetersOpening,
  importSupportFeeOpening,
  lifecyclePathToActive,
  setCapitalRepairFundCashOpening,
  metersSelectedToDraft,
  nextAfterMetersStage,
  normalizeFirstRunErrors,
  parseMetersSelected,
  resolveFirstRunResumeStage,
  saveFirstRunProgress,
  validateComplexForm,
  validateMetersSelection,
  visibleFirstRunStages,
  type FirstRunComplexForm,
  type FirstRunErrorRow,
  type FirstRunMeterUtility,
  type FirstRunStageKey,
  type FirstRunState,
  type MetersSelection,
} from '@/lib/firstRun';
import { buildPropertyBookIs2TemplateBuffer } from '@/lib/moduleCore/adapters/propertyBookOpening';
import {
  buildElectricityMeterIs3TemplateBuffer,
  buildWaterMeterIs3TemplateBuffer,
  ELECTRICITY_MODULE_KEY,
  WATER_MODULE_KEY,
} from '@/lib/moduleCore/adapters/metersOpening';
import {
  buildSupportFeeIs4TemplateBuffer,
  SUPPORT_FEE_MODULE_KEY,
} from '@/lib/moduleCore/adapters/supportFeeOpening';
import { supportFeeOpeningAdapter } from '@/lib/moduleCore/adapters/supportFeeOpeningAdapter';
import {
  buildCapitalRepairIs8TemplateBuffer,
  CAPITAL_REPAIR_MODULE_KEY,
} from '@/lib/moduleCore/adapters/capitalRepairOpening';
import { capitalRepairOpeningAdapter } from '@/lib/moduleCore/adapters/capitalRepairOpeningAdapter';
import { electricityOpeningAdapter } from '@/lib/moduleCore/adapters/electricityOpeningAdapter';
import { waterOpeningAdapter } from '@/lib/moduleCore/adapters/waterOpeningAdapter';
import { parseModuleXlsxBuffer } from '@/lib/moduleCore/xlsxEngine';
import { parsePropertyBookWorkbook, type PropertyBookWorkbookPayload } from '@/lib/propertyBookAdmin';
import type { Database } from '@/lib/database.types';

type Props = {
  supabase: SupabaseClient<Database>;
  t: (key: string) => string;
  /** Called after admin_complete_first_run_stage('complete') succeeded. */
  onDone: () => void;
};

const PROPERTY_BOOK_MODULE = 'property_book';

type BookDryRun = {
  ok: boolean;
  errors: unknown[];
  newCount: number;
  existingCount: number;
  changesCount: number;
  skippedIdenticalCount: number;
  requiresOverwriteConfirmation: boolean;
  bookEmptyAutoCreate: boolean;
};

type MetersDryRun = {
  ok: boolean;
  errors: unknown[];
  rowCount: number;
  skippedExisting: number;
};

type SfDryRun = {
  ok: boolean;
  errors: unknown[];
  rowCount: number;
  createCount: number;
  skippedExisting: number;
  debtSum: number;
  creditSum: number;
};

type CrDryRun = {
  ok: boolean;
  errors: unknown[];
  rowCount: number;
  createCount: number;
  skippedExisting: number;
  debtSum: number;
  creditSum: number;
};

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

function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function arrLen(v: unknown): number {
  return Array.isArray(v) ? v.length : 0;
}

/** RPC `raise exception ... detail = v_errors::text` → error rows (best effort). */
function errorsFromRpcDetails(err: { details?: string | null } | null | undefined): unknown[] {
  const detail = err?.details;
  if (!detail) return [];
  try {
    const parsed: unknown = JSON.parse(detail);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function ErrorTable({ rows, t }: { rows: FirstRunErrorRow[]; t: (key: string) => string }) {
  if (rows.length === 0) return null;
  return (
    <div className="overflow-x-auto rounded-lg border border-danger/30">
      <table className="min-w-full text-sm">
        <thead>
          <tr className={adminTableHeadRowClass}>
            <th className={adminTableCellClass}>{t('admin.firstRunErrSheet')}</th>
            <th className={adminTableCellClass}>{t('admin.firstRunErrRow')}</th>
            <th className={adminTableCellClass}>{t('admin.firstRunErrApartment')}</th>
            <th className={adminTableCellClass}>{t('admin.firstRunErrField')}</th>
            <th className={adminTableCellClass}>{t('admin.firstRunErrReason')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 200).map((r, i) => (
            <tr key={`${r.sheet}-${r.row}-${r.field}-${i}`} className={adminTableRowClass}>
              <td className={adminTableCellClass}>{r.sheet || '—'}</td>
              <td className={adminTableCellClass}>{r.row || '—'}</td>
              <td className={adminTableCellClass}>{r.apartment || '—'}</td>
              <td className={adminTableCellClass}>{r.field || '—'}</td>
              <td className={adminTableCellClass}>{r.reason || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 200 ? (
        <p className="px-3 py-2 text-xs text-muted">
          {t('admin.firstRunErrTruncated').replace('{n}', String(rows.length))}
        </p>
      ) : null}
    </div>
  );
}

export function AdminFirstRunWizard({ supabase, t, onDone }: Props) {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [state, setState] = useState<FirstRunState | null>(null);
  const [stage, setStage] = useState<FirstRunStageKey>('welcome');
  /** When editing the complex card from a later step, return there after save. */
  const [returnStage, setReturnStage] = useState<FirstRunStageKey | null>(null);

  const [form, setForm] = useState<FirstRunComplexForm>(() => complexToForm(null));
  const [formErrors, setFormErrors] = useState<string[]>([]);

  const [selection, setSelection] = useState<MetersSelection>({ water: false, electricity: false });
  const [selectionChosen, setSelectionChosen] = useState(false);

  const [bookPayload, setBookPayload] = useState<PropertyBookWorkbookPayload | null>(null);
  const [bookDry, setBookDry] = useState<BookDryRun | null>(null);
  const [bookCommitted, setBookCommitted] = useState(false);

  const [meterRows, setMeterRows] = useState<Record<string, string>[] | null>(null);
  const [meterDry, setMeterDry] = useState<MetersDryRun | null>(null);
  const [meterCommitted, setMeterCommitted] = useState(false);

  const [sfRows, setSfRows] = useState<Record<string, string>[] | null>(null);
  const [sfDry, setSfDry] = useState<SfDryRun | null>(null);
  const [sfCommitted, setSfCommitted] = useState(false);

  const [crRows, setCrRows] = useState<Record<string, string>[] | null>(null);
  const [crDry, setCrDry] = useState<CrDryRun | null>(null);
  const [crCommitted, setCrCommitted] = useState(false);
  const [crFundBalance, setCrFundBalance] = useState('');
  const [crFundDate, setCrFundDate] = useState('');
  const [crFundSource, setCrFundSource] = useState('');
  const [crFundNotes, setCrFundNotes] = useState('');
  const [crFundOk, setCrFundOk] = useState(false);

  const [errorRows, setErrorRows] = useState<FirstRunErrorRow[]>([]);
  const [countMismatch, setCountMismatch] = useState<{
    expected: number | null;
    actual: number | null;
  } | null>(null);

  const applyState = useCallback((next: FirstRunState | null) => {
    if (!next) return;
    setState(next);
    setForm(complexToForm(next.complex));
    const sel = parseMetersSelected(next.draft);
    setSelection(sel);
    setSelectionChosen(sel.water || sel.electricity);
  }, []);

  // Resume: load server state and jump to first_run_stage.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const result = await fetchFirstRunState(supabase);
      if (cancelled) return;
      if (!result.ok) {
        setError(t('admin.firstRunErrLoad'));
      } else {
        applyState(result.state);
        setStage(resolveFirstRunResumeStage(result.state));
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resume once per mount (t identity may change).
  }, [supabase, applyState]);

  function resetImportUi() {
    setBookPayload(null);
    setBookDry(null);
    setBookCommitted(false);
    setMeterRows(null);
    setMeterDry(null);
    setMeterCommitted(false);
    setSfRows(null);
    setSfDry(null);
    setSfCommitted(false);
    setErrorRows([]);
    setCountMismatch(null);
    setNote(null);
    setError(null);
  }

  function goStage(next: FirstRunStageKey) {
    resetImportUi();
    setStage(next);
  }

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t('admin.errGeneric'));
    } finally {
      setBusy(false);
    }
  }

  /** Walk module lifecycle to ACTIVE using the strict transition table. */
  async function activateModule(moduleKey: string) {
    const { data, error: listErr } = await supabase.rpc('admin_list_module_lifecycle');
    if (listErr) throw new Error(listErr.message);
    const row = (data ?? []).find((r) => r.module_key === moduleKey);
    for (const to of lifecyclePathToActive(row?.state)) {
      const { error: trErr } = await supabase.rpc('admin_transition_module_lifecycle', {
        p_module_key: moduleKey,
        p_to_state: to,
        p_reason: 'first_run_wizard',
      });
      if (trErr) throw new Error(trErr.message);
    }
  }

  // ---------------------------------------------------------------------------
  // welcome / complex_card
  // ---------------------------------------------------------------------------

  async function onStartSetup() {
    await run(async () => {
      applyState(await completeFirstRunStage(supabase, { stage: 'welcome', nextStage: 'complex_card' }));
      goStage('complex_card');
    });
  }

  async function onSaveComplex() {
    const errs = validateComplexForm(form);
    setFormErrors(errs);
    if (errs.length > 0) {
      setError(t('admin.firstRunComplexInvalid'));
      return;
    }
    await run(async () => {
      const next: FirstRunStageKey = returnStage && returnStage !== 'complex_card' ? returnStage : 'property_book';
      await saveFirstRunProgress(supabase, {
        stage: 'complex_card',
        complex: complexFormToPayload(form),
      });
      applyState(await completeFirstRunStage(supabase, { stage: 'complex_card', nextStage: next }));
      setReturnStage(null);
      goStage(next);
    });
  }

  function editComplexFrom(from: FirstRunStageKey) {
    setReturnStage(from);
    goStage('complex_card');
  }

  // ---------------------------------------------------------------------------
  // property_book
  // ---------------------------------------------------------------------------

  async function onBookFile(file: File | null) {
    setBookPayload(null);
    setBookDry(null);
    setBookCommitted(false);
    setErrorRows([]);
    setCountMismatch(null);
    setNote(null);
    if (!file) return;
    await run(async () => {
      const payload = await parsePropertyBookWorkbook(file);
      if (payload.objects.length === 0) {
        setError(t('admin.is2PropertyBookEmptyObjects'));
        return;
      }
      if (payload.owners.length === 0) {
        setError(t('admin.is2PropertyBookEmptyOwners'));
        return;
      }
      const { data, error: rpcErr } = await supabase.rpc('admin_import_property_book', {
        p_objects: payload.objects,
        p_owners: payload.owners,
        p_dry_run: true,
        p_allow_create_missing: true,
        p_allow_overwrite: false,
      });
      if (rpcErr) throw new Error(rpcErr.message);
      const res = asObj(data);
      const errors = Array.isArray(res.errors) ? res.errors : [];
      setBookDry({
        ok: res.ok === true && errors.length === 0,
        errors,
        newCount: arrLen(res.new_properties),
        existingCount: arrLen(res.existing_properties),
        changesCount: arrLen(res.changes),
        skippedIdenticalCount: arrLen(res.skipped_identical_property_ids),
        requiresOverwriteConfirmation: res.requires_overwrite_confirmation === true,
        bookEmptyAutoCreate: res.book_empty_auto_create === true,
      });
      setErrorRows(normalizeFirstRunErrors(errors));
      setCountMismatch(apartmentCountMismatchInfo(errors));
      setBookPayload(payload);
    });
  }

  async function onBookCommit() {
    if (!bookPayload || !bookDry || !bookDry.ok) return;
    if (!window.confirm(t('admin.firstRunBookConfirm'))) return;
    await run(async () => {
      const { data, error: rpcErr } = await supabase.rpc('admin_import_property_book', {
        p_objects: bookPayload.objects,
        p_owners: bookPayload.owners,
        p_dry_run: false,
        p_allow_create_missing: true,
        p_allow_overwrite: false,
      });
      if (rpcErr) {
        const errs = errorsFromRpcDetails(rpcErr);
        setErrorRows(normalizeFirstRunErrors(errs));
        setCountMismatch(apartmentCountMismatchInfo(errs));
        throw new Error(
          errs.length > 0 ? t('admin.is2PropertyBookImportFailed') : rpcErr.message || t('admin.is2PropertyBookImportFailed'),
        );
      }
      const res = asObj(data);
      if (res.ok !== true) {
        const errs = Array.isArray(res.errors) ? res.errors : [];
        setErrorRows(normalizeFirstRunErrors(errs));
        setCountMismatch(apartmentCountMismatchInfo(errs));
        throw new Error(t('admin.is2PropertyBookImportFailed'));
      }
      setBookCommitted(true);
      setNote(t('admin.firstRunBookActivating'));
      // SETUP_IN_PROGRESS → READY → ACTIVE (idempotent when already ACTIVE).
      await activateModule(PROPERTY_BOOK_MODULE);
      applyState(await completeFirstRunStage(supabase, { stage: 'property_book', nextStage: 'meters_select' }));
      setNote(t('admin.firstRunBookCommitted'));
    });
  }

  // ---------------------------------------------------------------------------
  // meters_select
  // ---------------------------------------------------------------------------

  async function onMetersSelectContinue() {
    const check = validateMetersSelection(selection);
    if (!check.ok) {
      setError(t('admin.firstRunMetersSelectRequired'));
      return;
    }
    await run(async () => {
      const draft = { meters_selected: metersSelectedToDraft(selection) };
      await saveFirstRunProgress(supabase, { stage: 'meters_select', draft });
      applyState(
        await completeFirstRunStage(supabase, {
          stage: 'meters_select',
          nextStage: firstMetersStage(selection),
          draft,
        }),
      );
      setSelectionChosen(true);
      goStage(firstMetersStage(selection));
    });
  }

  // ---------------------------------------------------------------------------
  // meters_water / meters_electricity
  // ---------------------------------------------------------------------------

  function metersSchema(utility: FirstRunMeterUtility) {
    const adapter = utility === 'water' ? waterOpeningAdapter : electricityOpeningAdapter;
    return adapter.registration.setup?.xlsx ?? null;
  }

  function metersErrorRows(errors: unknown[]): FirstRunErrorRow[] {
    // RPC `row` is the 1-based data row index; spreadsheet row = index + 1 (header on row 1).
    return normalizeFirstRunErrors(errors).map((r) => {
      const n = Number(r.row);
      return Number.isFinite(n) && r.row !== '' ? { ...r, row: String(n + 1) } : r;
    });
  }

  async function onMetersFile(utility: FirstRunMeterUtility, file: File | null) {
    setMeterRows(null);
    setMeterDry(null);
    setMeterCommitted(false);
    setErrorRows([]);
    setNote(null);
    if (!file) return;
    await run(async () => {
      const schema = metersSchema(utility);
      if (!schema) throw new Error(t('admin.errGeneric'));
      const parsed = parseModuleXlsxBuffer(await file.arrayBuffer(), schema);
      if (!parsed.ok) {
        setError(parsed.error);
        return;
      }
      if (parsed.rows.length === 0) {
        setError(t('admin.is3MetersEmptySheet'));
        return;
      }
      const { data, error: rpcErr } = await importMetersOpening(supabase, utility, parsed.rows, true);
      if (rpcErr) throw new Error(rpcErr.message);
      const res = asObj(data);
      const errors = Array.isArray(res.errors) ? res.errors : [];
      setMeterDry({
        ok: res.ok === true && errors.length === 0,
        errors,
        rowCount: parsed.rows.length,
        skippedExisting: Number(res.skipped_existing_count ?? 0) || 0,
      });
      setErrorRows(metersErrorRows(errors));
      setMeterRows(parsed.rows);
    });
  }

  async function onMetersCommit(utility: FirstRunMeterUtility) {
    if (!meterRows || !meterDry || !meterDry.ok) return;
    if (!window.confirm(t('admin.firstRunMetersConfirm'))) return;
    const stageKey: 'meters_water' | 'meters_electricity' =
      utility === 'water' ? 'meters_water' : 'meters_electricity';
    await run(async () => {
      const { data, error: rpcErr } = await importMetersOpening(supabase, utility, meterRows, false);
      if (rpcErr) {
        const errs = errorsFromRpcDetails(rpcErr);
        setErrorRows(metersErrorRows(errs));
        throw new Error(errs.length > 0 ? t('admin.firstRunMetersImportFailed') : rpcErr.message);
      }
      const res = asObj(data);
      if (res.ok !== true) {
        setErrorRows(metersErrorRows(Array.isArray(res.errors) ? res.errors : []));
        throw new Error(t('admin.firstRunMetersImportFailed'));
      }
      setMeterCommitted(true);
      setNote(t('admin.firstRunMetersActivating'));
      await activateModule(utility === 'water' ? WATER_MODULE_KEY : ELECTRICITY_MODULE_KEY);
      const next = nextAfterMetersStage(stageKey, selection);
      applyState(await completeFirstRunStage(supabase, { stage: stageKey, nextStage: next }));
      setNote(t('admin.firstRunMetersCommitted'));
    });
  }

  function onMetersContinue(utility: FirstRunMeterUtility) {
    const stageKey: 'meters_water' | 'meters_electricity' =
      utility === 'water' ? 'meters_water' : 'meters_electricity';
    goStage(nextAfterMetersStage(stageKey, selection));
  }

  // ---------------------------------------------------------------------------
  // support_fee_opening
  // ---------------------------------------------------------------------------

  async function onSfFile(file: File | null) {
    if (!file) return;
    await run(async () => {
      setSfDry(null);
      setSfCommitted(false);
      setErrorRows([]);
      const buf = await file.arrayBuffer();
      const schema = supportFeeOpeningAdapter.registration.setup?.xlsx;
      if (!schema) throw new Error(t('admin.errGeneric'));
      const parsed = parseModuleXlsxBuffer(buf, schema);
      if (!parsed.ok) {
        setError(parsed.error);
        return;
      }
      if (parsed.rows.length === 0) {
        setError(t('admin.firstRunSfDryRunErrors').replace('{n}', '0'));
        return;
      }
      const { data, error: rpcErr } = await importSupportFeeOpening(supabase, parsed.rows, true);
      if (rpcErr) throw new Error(rpcErr.message);
      const res = asObj(data);
      const errors = Array.isArray(res.errors) ? res.errors : [];
      const reconcile = asObj(res.reconcile);
      const rowsOut = Array.isArray(res.rows) ? res.rows : [];
      const createCount = rowsOut.filter((r) => {
        const o = asObj(r).outcome;
        return o === 'CREATE' || o === 'CREATED';
      }).length;
      setSfDry({
        ok: res.ok === true && errors.length === 0,
        errors,
        rowCount: parsed.rows.length,
        createCount,
        skippedExisting: Number(res.skipped_existing_count ?? 0) || 0,
        debtSum: Number(reconcile.remaining_debt_sum ?? 0) || 0,
        creditSum: Number(reconcile.opening_overpayment_sum ?? 0) || 0,
      });
      setErrorRows(normalizeFirstRunErrors(errors));
      setSfRows(parsed.rows);
    });
  }

  async function onSfCommit() {
    if (!sfRows || !sfDry || !sfDry.ok) return;
    if (!window.confirm(t('admin.firstRunSfConfirm'))) return;
    await run(async () => {
      const { data, error: rpcErr } = await importSupportFeeOpening(supabase, sfRows, false);
      if (rpcErr) {
        const errs = errorsFromRpcDetails(rpcErr);
        setErrorRows(normalizeFirstRunErrors(errs));
        throw new Error(errs.length > 0 ? t('admin.firstRunSfImportFailed') : rpcErr.message);
      }
      const res = asObj(data);
      if (res.ok !== true) {
        setErrorRows(normalizeFirstRunErrors(Array.isArray(res.errors) ? res.errors : []));
        throw new Error(t('admin.firstRunSfImportFailed'));
      }
      setSfCommitted(true);
      setNote(t('admin.firstRunSfActivating'));
      await activateModule(SUPPORT_FEE_MODULE_KEY);
      applyState(
        await completeFirstRunStage(supabase, {
          stage: 'support_fee_opening',
          nextStage: 'capital_repair_opening',
          draft: {
            support_fee_opening: {
              batch_id: res.batch_id ?? null,
              created_count: res.created_count ?? 0,
              skipped_existing_count: res.skipped_existing_count ?? 0,
              reconcile: res.reconcile ?? null,
            },
          },
        }),
      );
      setNote(t('admin.firstRunSfCommitted'));
      goStage('capital_repair_opening');
    });
  }

  // ---------------------------------------------------------------------------
  // capital_repair_opening
  // ---------------------------------------------------------------------------

  async function onCrFile(file: File | null) {
    if (!file) return;
    await run(async () => {
      setCrDry(null);
      setCrCommitted(false);
      setErrorRows([]);
      const buf = await file.arrayBuffer();
      const schema = capitalRepairOpeningAdapter.registration.setup?.xlsx;
      if (!schema) throw new Error(t('admin.errGeneric'));
      const parsed = parseModuleXlsxBuffer(buf, schema);
      if (!parsed.ok) {
        setError(parsed.error);
        return;
      }
      if (parsed.rows.length === 0) {
        setError(t('admin.firstRunCrDryRunErrors').replace('{n}', '0'));
        return;
      }
      const { data, error: rpcErr } = await importCapitalRepairOpening(supabase, parsed.rows, true);
      if (rpcErr) throw new Error(rpcErr.message);
      const res = asObj(data);
      const errors = Array.isArray(res.errors) ? res.errors : [];
      const reconcile = asObj(res.reconcile);
      const rowsOut = Array.isArray(res.rows) ? res.rows : [];
      const createCount = rowsOut.filter((r) => {
        const o = asObj(r).outcome;
        return o === 'CREATE' || o === 'CREATED';
      }).length;
      setCrDry({
        ok: res.ok === true && errors.length === 0,
        errors,
        rowCount: parsed.rows.length,
        createCount,
        skippedExisting: Number(res.skipped_existing_count ?? 0) || 0,
        debtSum: Number(reconcile.remaining_debt_sum ?? 0) || 0,
        creditSum: Number(reconcile.opening_overpayment_sum ?? 0) || 0,
      });
      setErrorRows(normalizeFirstRunErrors(errors));
      setCrRows(parsed.rows);
    });
  }

  async function onCrCommit() {
    if (!crRows || !crDry || !crDry.ok) return;
    if (!window.confirm(t('admin.firstRunCrConfirm'))) return;
    await run(async () => {
      const { data, error: rpcErr } = await importCapitalRepairOpening(supabase, crRows, false);
      if (rpcErr) {
        const errs = errorsFromRpcDetails(rpcErr);
        setErrorRows(normalizeFirstRunErrors(errs));
        throw new Error(errs.length > 0 ? t('admin.firstRunCrImportFailed') : rpcErr.message);
      }
      const res = asObj(data);
      if (res.ok !== true) {
        setErrorRows(normalizeFirstRunErrors(Array.isArray(res.errors) ? res.errors : []));
        throw new Error(t('admin.firstRunCrImportFailed'));
      }
      setCrCommitted(true);
      setNote(t('admin.firstRunCrAptsCommitted'));
    });
  }

  async function onCrFundConfirm() {
    const bal = Number(String(crFundBalance).replace(',', '.'));
    if (!Number.isFinite(bal) || bal < 0 || !crFundDate.trim() || !crFundSource.trim()) {
      setError(t('admin.firstRunCrFundInvalid'));
      return;
    }
    if (!window.confirm(t('admin.firstRunCrFundConfirm'))) return;
    await run(async () => {
      const { data, error: rpcErr } = await setCapitalRepairFundCashOpening(supabase, {
        balanceEur: bal,
        asOfDate: crFundDate.trim(),
        sourceReference: crFundSource.trim(),
        notes: crFundNotes.trim() || null,
        dryRun: false,
      });
      if (rpcErr) throw new Error(rpcErr.message);
      const res = asObj(data);
      if (res.ok !== true) {
        throw new Error(t('admin.firstRunCrFundFailed'));
      }
      setCrFundOk(true);
      setNote(t('admin.firstRunCrFundCommitted'));
    });
  }

  async function onCrContinue() {
    if (!crCommitted || !crFundOk) return;
    await run(async () => {
      setNote(t('admin.firstRunCrActivating'));
      await activateModule(CAPITAL_REPAIR_MODULE_KEY);
      applyState(
        await completeFirstRunStage(supabase, {
          stage: 'capital_repair_opening',
          nextStage: 'tariffs',
          draft: {
            capital_repair_opening: {
              apartments_committed: true,
              fund_cash_committed: true,
            },
          },
        }),
      );
      setNote(t('admin.firstRunCrCommitted'));
      goStage('tariffs');
    });
  }

  async function onTariffsContinue() {
    await run(async () => {
      applyState(
        await completeFirstRunStage(supabase, {
          stage: 'tariffs',
          nextStage: 'budget',
        }),
      );
      goStage('budget');
    });
  }

  // ---------------------------------------------------------------------------
  // complete
  // ---------------------------------------------------------------------------

  async function onFinish() {
    await run(async () => {
      await completeFirstRunStage(supabase, { stage: 'complete' });
      onDone();
    });
  }

  // ---------------------------------------------------------------------------
  // render
  // ---------------------------------------------------------------------------

  const visibleStages = useMemo(
    () => visibleFirstRunStages(selectionChosen ? selection : null),
    [selection, selectionChosen],
  );
  const stageIndex = Math.max(0, visibleStages.indexOf(stage));

  const stageLabel = (key: FirstRunStageKey): string => {
    switch (key) {
      case 'welcome':
        return t('admin.firstRunStageWelcome');
      case 'complex_card':
        return t('admin.firstRunStageComplex');
      case 'property_book':
        return t('admin.firstRunStagePropertyBook');
      case 'meters_select':
        return t('admin.firstRunStageMetersSelect');
      case 'meters_water':
        return t('admin.firstRunStageMetersWater');
      case 'meters_electricity':
        return t('admin.firstRunStageMetersElectricity');
      case 'support_fee_opening':
        return t('admin.firstRunStageSupportFee');
      case 'capital_repair_opening':
        return t('admin.firstRunStageCapitalRepair');
      case 'tariffs':
        return t('admin.firstRunStageTariffs');
      case 'budget':
        return t('admin.firstRunStageBudget');
      default:
        return t('admin.firstRunStageComplete');
    }
  };

  if (loading) {
    return <p className="text-sm text-secondary">{t('admin.firstRunLoading')}</p>;
  }

  const bookNeedsComplexFix = hasApartmentCountMismatch(bookDry?.errors) || countMismatch != null;

  function fieldError(key: string) {
    return formErrors.includes(key) ? (
      <span className="mt-1 block text-xs text-danger">{t(`admin.firstRunComplexErr_${key}`)}</span>
    ) : null;
  }

  function renderMetersStage(utility: FirstRunMeterUtility) {
    const title =
      utility === 'water' ? t('admin.firstRunStageMetersWater') : t('admin.firstRunStageMetersElectricity');
    return (
      <AdminCard>
        <h3 className="mb-1 text-base font-semibold text-foreground">{title}</h3>
        <p className="mb-3 text-sm text-secondary">{t('admin.firstRunMetersLead')}</p>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={adminBtnSecondaryClass}
            onClick={() =>
              downloadXlsx(
                utility === 'water' ? buildWaterMeterIs3TemplateBuffer() : buildElectricityMeterIs3TemplateBuffer(),
                utility === 'water' ? 'water_meters_opening_template.xlsx' : 'electricity_meters_opening_template.xlsx',
              )
            }
          >
            {t('admin.firstRunMetersDownload')}
          </button>
          <label className="text-sm text-secondary">
            <span className="mr-2">{t('admin.firstRunMetersUpload')}</span>
            <input
              type="file"
              accept=".xlsx"
              disabled={busy}
              className="text-sm"
              onChange={(e) => {
                void onMetersFile(utility, e.target.files?.[0] ?? null);
                e.target.value = '';
              }}
            />
          </label>
        </div>

        {meterDry ? (
          <div className="mt-4 space-y-3">
            {meterDry.ok ? (
              <p className="text-sm text-success">
                {t('admin.firstRunMetersDryRunOk')
                  .replace('{rows}', String(meterDry.rowCount))
                  .replace('{skipped}', String(meterDry.skippedExisting))}
              </p>
            ) : (
              <p className="text-sm text-danger">
                {t('admin.firstRunMetersDryRunErrors').replace('{n}', String(errorRows.length))}
              </p>
            )}
          </div>
        ) : null}
        <div className="mt-3">
          <ErrorTable rows={errorRows} t={t} />
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {!meterCommitted ? (
            <button
              type="button"
              className={adminBtnPrimaryClass}
              disabled={busy || !meterDry?.ok}
              onClick={() => void onMetersCommit(utility)}
            >
              {busy ? t('admin.firstRunBusy') : t('admin.firstRunMetersCommit')}
            </button>
          ) : (
            <button type="button" className={adminBtnPrimaryClass} onClick={() => onMetersContinue(utility)}>
              {t('admin.firstRunContinue')}
            </button>
          )}
          <button
            type="button"
            className={adminBtnSecondaryClass}
            disabled={busy}
            onClick={() => editComplexFrom(stage)}
          >
            {t('admin.firstRunEditComplex')}
          </button>
        </div>
      </AdminCard>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      <AdminPageHeader title={t('admin.firstRunTitle')} secondary={t('admin.firstRunLead')} />

      <nav aria-label={t('admin.firstRunTitle')}>
        <ol className="flex flex-wrap gap-1.5">
          {visibleStages.map((key, idx) => (
            <li
              key={key}
              className={`rounded-full border px-2.5 py-1 text-xs ${
                key === stage
                  ? 'border-accent/30 bg-accent-bg font-semibold text-accent'
                  : idx < stageIndex
                    ? 'border-border bg-surface text-secondary'
                    : 'border-transparent text-muted'
              }`}
            >
              {idx + 1}. {stageLabel(key)}
            </li>
          ))}
        </ol>
        <p className="mt-2 text-xs text-muted">
          {t('admin.firstRunProgress')
            .replace('{n}', String(stageIndex + 1))
            .replace('{total}', String(visibleStages.length))}
        </p>
      </nav>

      {error ? (
        <div className="rounded-lg border border-danger/30 bg-danger-bg px-3 py-2 text-sm text-danger">{error}</div>
      ) : null}
      {note ? (
        <div className="rounded-lg border border-accent/20 bg-accent-bg px-3 py-2 text-sm text-foreground">{note}</div>
      ) : null}

      {stage === 'welcome' ? (
        <AdminCard>
          <h3 className="mb-2 text-base font-semibold text-foreground">{t('admin.firstRunWelcomeTitle')}</h3>
          <p className="mb-2 text-sm text-secondary">{t('admin.firstRunWelcomeBody')}</p>
          <ul className="mb-4 list-inside list-disc space-y-1 text-sm text-secondary">
            <li>{t('admin.firstRunWelcomeCap1')}</li>
            <li>{t('admin.firstRunWelcomeCap2')}</li>
            <li>{t('admin.firstRunWelcomeCap3')}</li>
            <li>{t('admin.firstRunWelcomeCap4')}</li>
          </ul>
          <p className="mb-4 text-xs text-muted">{t('admin.firstRunWelcomeMandatory')}</p>
          <button type="button" className={adminBtnPrimaryClass} disabled={busy} onClick={() => void onStartSetup()}>
            {busy ? t('admin.firstRunBusy') : t('admin.firstRunWelcomeStart')}
          </button>
        </AdminCard>
      ) : null}

      {stage === 'complex_card' ? (
        <AdminCard>
          <h3 className="mb-1 text-base font-semibold text-foreground">{t('admin.firstRunComplexTitle')}</h3>
          <p className="mb-3 text-sm text-secondary">{t('admin.firstRunComplexLead')}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm text-secondary sm:col-span-2">
              {t('admin.firstRunFieldName')}
              <input
                className={`${adminFieldClass} mt-1`}
                value={form.display_name}
                onChange={(e) => setForm({ ...form, display_name: e.target.value })}
                disabled={busy}
              />
              {fieldError('display_name')}
            </label>
            <label className="block text-sm text-secondary sm:col-span-2">
              {t('admin.firstRunFieldAddress')}
              <input
                className={`${adminFieldClass} mt-1`}
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                disabled={busy}
              />
              {fieldError('address')}
            </label>
            <label className="block text-sm text-secondary">
              {t('admin.firstRunFieldApartmentCount')}
              <input
                className={`${adminFieldClass} mt-1`}
                inputMode="numeric"
                value={form.apartment_count}
                onChange={(e) => setForm({ ...form, apartment_count: e.target.value })}
                disabled={busy}
              />
              {fieldError('apartment_count')}
            </label>
            <label className="block text-sm text-secondary">
              {t('admin.firstRunFieldPhone')}
              <input
                className={`${adminFieldClass} mt-1`}
                type="tel"
                value={form.contact_phone}
                onChange={(e) => setForm({ ...form, contact_phone: e.target.value })}
                disabled={busy}
              />
            </label>
            <label className="block text-sm text-secondary sm:col-span-2">
              {t('admin.firstRunFieldEmail')}
              <input
                className={`${adminFieldClass} mt-1`}
                type="email"
                value={form.contact_email}
                onChange={(e) => setForm({ ...form, contact_email: e.target.value })}
                disabled={busy}
              />
              {fieldError('contact_email')}
            </label>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" className={adminBtnPrimaryClass} disabled={busy} onClick={() => void onSaveComplex()}>
              {busy ? t('admin.firstRunBusy') : t('admin.firstRunContinue')}
            </button>
            {returnStage ? (
              <button
                type="button"
                className={adminBtnSecondaryClass}
                disabled={busy}
                onClick={() => {
                  const back = returnStage;
                  setReturnStage(null);
                  goStage(back);
                }}
              >
                {t('admin.firstRunBack')}
              </button>
            ) : null}
          </div>
        </AdminCard>
      ) : null}

      {stage === 'property_book' ? (
        <AdminCard>
          <h3 className="mb-1 text-base font-semibold text-foreground">{t('admin.firstRunBookTitle')}</h3>
          <p className="mb-3 text-sm text-secondary">
            {t('admin.firstRunBookLead').replace(
              '{n}',
              state?.complex.apartment_count != null ? String(state.complex.apartment_count) : '—',
            )}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={adminBtnSecondaryClass}
              onClick={() =>
                downloadXlsx(buildPropertyBookIs2TemplateBuffer(), 'property_book_opening_template.xlsx')
              }
            >
              {t('admin.firstRunBookDownload')}
            </button>
            <label className="text-sm text-secondary">
              <span className="mr-2">{t('admin.firstRunBookUpload')}</span>
              <input
                type="file"
                accept=".xlsx"
                disabled={busy}
                className="text-sm"
                onChange={(e) => {
                  void onBookFile(e.target.files?.[0] ?? null);
                  e.target.value = '';
                }}
              />
            </label>
          </div>

          {bookDry ? (
            <div className="mt-4 space-y-2">
              {bookDry.ok ? (
                <p className="text-sm text-success">
                  {t('admin.firstRunBookDryRunOk')
                    .replace('{new}', String(bookDry.newCount))
                    .replace('{existing}', String(bookDry.existingCount))
                    .replace('{changes}', String(bookDry.changesCount))}
                </p>
              ) : (
                <p className="text-sm text-danger">
                  {t('admin.firstRunBookDryRunErrors').replace('{n}', String(errorRows.length))}
                </p>
              )}
              {bookDry.requiresOverwriteConfirmation ? (
                <p className="text-sm text-warning">{t('admin.firstRunBookOverwriteBlocked')}</p>
              ) : null}
            </div>
          ) : null}

          {bookNeedsComplexFix ? (
            <div className="mt-3 rounded-lg border border-warning/40 bg-warning-bg px-3 py-2 text-sm text-foreground">
              <p>
                {t('admin.firstRunBookCountMismatch')
                  .replace(
                    '{expected}',
                    String(countMismatch?.expected ?? state?.complex.apartment_count ?? '—'),
                  )
                  .replace('{actual}', String(countMismatch?.actual ?? '—'))}
              </p>
              <button
                type="button"
                className={`${adminBtnSecondaryClass} mt-2`}
                disabled={busy}
                onClick={() => editComplexFrom('property_book')}
              >
                {t('admin.firstRunBookBackToComplex')}
              </button>
            </div>
          ) : null}

          <div className="mt-3">
            <ErrorTable rows={errorRows} t={t} />
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {!bookCommitted ? (
              <button
                type="button"
                className={adminBtnPrimaryClass}
                disabled={busy || !bookDry?.ok || bookDry.requiresOverwriteConfirmation}
                onClick={() => void onBookCommit()}
              >
                {busy ? t('admin.firstRunBusy') : t('admin.firstRunBookCommit')}
              </button>
            ) : (
              <button type="button" className={adminBtnPrimaryClass} onClick={() => goStage('meters_select')}>
                {t('admin.firstRunContinue')}
              </button>
            )}
            <button
              type="button"
              className={adminBtnSecondaryClass}
              disabled={busy}
              onClick={() => editComplexFrom('property_book')}
            >
              {t('admin.firstRunEditComplex')}
            </button>
          </div>
        </AdminCard>
      ) : null}

      {stage === 'meters_select' ? (
        <AdminCard>
          <h3 className="mb-1 text-base font-semibold text-foreground">{t('admin.firstRunMetersSelectTitle')}</h3>
          <p className="mb-3 text-sm text-secondary">{t('admin.firstRunMetersSelectLead')}</p>
          <div className="mb-3 space-y-2">
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={selection.water}
                disabled={busy}
                onChange={(e) => setSelection({ ...selection, water: e.target.checked })}
              />
              {t('admin.firstRunMetersSelectWater')}
            </label>
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={selection.electricity}
                disabled={busy}
                onChange={(e) => setSelection({ ...selection, electricity: e.target.checked })}
              />
              {t('admin.firstRunMetersSelectElectricity')}
            </label>
          </div>
          {!validateMetersSelection(selection).ok ? (
            <p className="mb-3 text-xs text-muted">{t('admin.firstRunMetersSelectRequired')}</p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={adminBtnPrimaryClass}
              disabled={busy || !validateMetersSelection(selection).ok}
              onClick={() => void onMetersSelectContinue()}
            >
              {busy ? t('admin.firstRunBusy') : t('admin.firstRunContinue')}
            </button>
            <button
              type="button"
              className={adminBtnSecondaryClass}
              disabled={busy}
              onClick={() => editComplexFrom('meters_select')}
            >
              {t('admin.firstRunEditComplex')}
            </button>
          </div>
        </AdminCard>
      ) : null}

      {stage === 'meters_water' ? renderMetersStage('water') : null}
      {stage === 'meters_electricity' ? renderMetersStage('electricity') : null}

      {stage === 'support_fee_opening' ? (
        <AdminCard>
          <h3 className="mb-1 text-base font-semibold text-foreground">{t('admin.firstRunSfTitle')}</h3>
          <p className="mb-3 text-sm text-secondary">{t('admin.firstRunSfLead')}</p>
          <div className="mb-3 flex flex-wrap gap-2">
            <button
              type="button"
              className={adminBtnSecondaryClass}
              disabled={busy}
              onClick={() => downloadXlsx(buildSupportFeeIs4TemplateBuffer(), 'support_fee_opening_template.xlsx')}
            >
              {t('admin.firstRunSfDownload')}
            </button>
            <label className={`${adminBtnSecondaryClass} cursor-pointer`}>
              {t('admin.firstRunSfUpload')}
              <input
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="hidden"
                disabled={busy}
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  e.target.value = '';
                  void onSfFile(f);
                }}
              />
            </label>
          </div>
          {sfDry ? (
            <p className={`mb-3 text-sm ${sfDry.ok ? 'text-secondary' : 'text-danger'}`}>
              {sfDry.ok
                ? t('admin.firstRunSfDryRunOk')
                    .replace('{rows}', String(sfDry.rowCount))
                    .replace('{create}', String(sfDry.createCount))
                    .replace('{skipped}', String(sfDry.skippedExisting))
                    .replace('{debt}', String(sfDry.debtSum))
                    .replace('{credit}', String(sfDry.creditSum))
                : t('admin.firstRunSfDryRunErrors').replace('{n}', String(sfDry.errors.length))}
            </p>
          ) : null}
          <ErrorTable rows={errorRows} t={t} />
          <div className="mt-3 flex flex-wrap gap-2">
            {!sfCommitted ? (
              <button
                type="button"
                className={adminBtnPrimaryClass}
                disabled={busy || !sfDry?.ok || !sfRows}
                onClick={() => void onSfCommit()}
              >
                {busy ? t('admin.firstRunBusy') : t('admin.firstRunSfCommit')}
              </button>
            ) : (
              <button
                type="button"
                className={adminBtnPrimaryClass}
                disabled={busy}
                onClick={() => goStage('capital_repair_opening')}
              >
                {t('admin.firstRunSfContinue')}
              </button>
            )}
          </div>
          {note ? <p className="mt-3 text-xs text-secondary">{note}</p> : null}
          {error ? <p className="mt-3 text-xs text-danger">{error}</p> : null}
        </AdminCard>
      ) : null}

      {stage === 'capital_repair_opening' ? (
        <AdminCard>
          <h3 className="mb-1 text-base font-semibold text-foreground">{t('admin.firstRunCrTitle')}</h3>
          <p className="mb-3 text-sm text-secondary">{t('admin.firstRunCrLead')}</p>
          <div className="mb-3 flex flex-wrap gap-2">
            <button
              type="button"
              className={adminBtnSecondaryClass}
              disabled={busy}
              onClick={() =>
                downloadXlsx(buildCapitalRepairIs8TemplateBuffer(), 'capital_repair_opening_template.xlsx')
              }
            >
              {t('admin.firstRunCrDownload')}
            </button>
            <label className={`${adminBtnSecondaryClass} cursor-pointer`}>
              {t('admin.firstRunCrUpload')}
              <input
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="hidden"
                disabled={busy}
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  e.target.value = '';
                  void onCrFile(f);
                }}
              />
            </label>
          </div>
          {crDry ? (
            <p className={`mb-3 text-sm ${crDry.ok ? 'text-secondary' : 'text-danger'}`}>
              {crDry.ok
                ? t('admin.firstRunCrDryRunOk')
                    .replace('{rows}', String(crDry.rowCount))
                    .replace('{create}', String(crDry.createCount))
                    .replace('{skipped}', String(crDry.skippedExisting))
                    .replace('{debt}', String(crDry.debtSum))
                    .replace('{credit}', String(crDry.creditSum))
                : t('admin.firstRunCrDryRunErrors').replace('{n}', String(crDry.errors.length))}
            </p>
          ) : null}
          <ErrorTable rows={errorRows} t={t} />
          <div className="mt-3 flex flex-wrap gap-2">
            {!crCommitted ? (
              <button
                type="button"
                className={adminBtnPrimaryClass}
                disabled={busy || !crDry?.ok || !crRows}
                onClick={() => void onCrCommit()}
              >
                {busy ? t('admin.firstRunBusy') : t('admin.firstRunCrCommit')}
              </button>
            ) : (
              <p className="text-sm text-secondary">{t('admin.firstRunCrAptsCommitted')}</p>
            )}
          </div>

          <div className="mt-6 border-t border-border pt-4">
            <h4 className="mb-1 text-sm font-semibold text-foreground">{t('admin.firstRunCrFundTitle')}</h4>
            <p className="mb-3 text-xs text-secondary">{t('admin.firstRunCrFundLead')}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="text-xs text-secondary">
                {t('admin.firstRunCrFundBalance')}
                <input
                  className={`${adminFieldClass} mt-1`}
                  value={crFundBalance}
                  disabled={busy || crFundOk}
                  onChange={(e) => setCrFundBalance(e.target.value)}
                />
              </label>
              <label className="text-xs text-secondary">
                {t('admin.firstRunCrFundDate')}
                <input
                  type="date"
                  className={`${adminFieldClass} mt-1`}
                  value={crFundDate}
                  disabled={busy || crFundOk}
                  onChange={(e) => setCrFundDate(e.target.value)}
                />
              </label>
              <label className="text-xs text-secondary sm:col-span-2">
                {t('admin.firstRunCrFundSource')}
                <input
                  className={`${adminFieldClass} mt-1`}
                  value={crFundSource}
                  disabled={busy || crFundOk}
                  onChange={(e) => setCrFundSource(e.target.value)}
                />
              </label>
              <label className="text-xs text-secondary sm:col-span-2">
                {t('admin.firstRunCrFundNotes')}
                <input
                  className={`${adminFieldClass} mt-1`}
                  value={crFundNotes}
                  disabled={busy || crFundOk}
                  onChange={(e) => setCrFundNotes(e.target.value)}
                />
              </label>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {!crFundOk ? (
                <button
                  type="button"
                  className={adminBtnPrimaryClass}
                  disabled={busy || !crCommitted}
                  onClick={() => void onCrFundConfirm()}
                >
                  {busy ? t('admin.firstRunBusy') : t('admin.firstRunCrFundCommit')}
                </button>
              ) : (
                <p className="text-sm text-secondary">{t('admin.firstRunCrFundCommitted')}</p>
              )}
              <button
                type="button"
                className={adminBtnPrimaryClass}
                disabled={busy || !crCommitted || !crFundOk}
                onClick={() => void onCrContinue()}
              >
                {t('admin.firstRunCrContinue')}
              </button>
            </div>
          </div>
          {note ? <p className="mt-3 text-xs text-secondary">{note}</p> : null}
          {error ? <p className="mt-3 text-xs text-danger">{error}</p> : null}
        </AdminCard>
      ) : null}

      {stage === 'tariffs' ? (
        <AdminCard>
          <h3 className="mb-2 text-base font-semibold text-foreground">{t('admin.firstRunStageTariffs')}</h3>
          <p className="mb-3 text-sm text-secondary">{t('admin.firstRunTariffsStubBody')}</p>
          <button
            type="button"
            className={adminBtnPrimaryClass}
            disabled={busy}
            onClick={() => void onTariffsContinue()}
          >
            {busy ? t('admin.firstRunBusy') : t('admin.firstRunTariffsContinue')}
          </button>
        </AdminCard>
      ) : null}

      {stage === 'budget' ? (
        <AdminCard>
          <h3 className="mb-2 text-base font-semibold text-foreground">{t('admin.firstRunBudgetStubTitle')}</h3>
          <p className="mb-3 text-sm text-secondary">{t('admin.firstRunBudgetStubBody')}</p>
          <p className="text-sm text-danger">{t('admin.firstRunBudgetBlocked')}</p>
        </AdminCard>
      ) : null}

      {stage === 'complete' ? (
        <AdminCard>
          <h3 className="mb-2 text-base font-semibold text-foreground">{t('admin.firstRunCompleteTitle')}</h3>
          <p className="mb-4 text-sm text-secondary">{t('admin.firstRunCompleteBody')}</p>
          <button type="button" className={adminBtnPrimaryClass} disabled={busy} onClick={() => void onFinish()}>
            {busy ? t('admin.firstRunBusy') : t('admin.firstRunCompleteFinish')}
          </button>
        </AdminCard>
      ) : null}
    </div>
  );
}
