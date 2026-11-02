'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  FirstRunCapitalRepair,
  FirstRunErrorNote,
  FirstRunFinish,
  FirstRunSupportFee,
} from '@/components/admin/FirstRunFinance';
import styles from '@/components/admin/FirstRunFrame.module.css';
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
  BUDGET_MODULE_KEY,
  firstRunBudgetDraftPayload,
  type FirstRunBudgetDraft,
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
import { AdminFirstRunTariffs } from '@/components/admin/AdminFirstRunTariffs';
import { AdminFirstRunBudget } from '@/components/admin/AdminFirstRunBudget';
import { FirstRunFrame, FirstRunWelcome } from '@/components/admin/FirstRunFrame';
import {
  FirstRunBookImport,
  FirstRunComplexCard,
  FirstRunMetersImport,
  FirstRunMetersSelectForm,
} from '@/components/admin/FirstRunSteps';

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

  // ---------------------------------------------------------------------------
  // tariffs → budget → complete
  // ---------------------------------------------------------------------------

  async function onTariffsContinue() {
    await run(async () => {
      applyState(
        await completeFirstRunStage(supabase, {
          stage: 'tariffs',
          nextStage: 'budget',
        }),
      );
      setNote(t('admin.firstRunTariffsCommitted'));
      goStage('budget');
    });
  }

  async function onBudgetContinue(payload: FirstRunBudgetDraft) {
    await run(async () => {
      await activateModule(BUDGET_MODULE_KEY);
      applyState(
        await completeFirstRunStage(supabase, {
          stage: 'budget',
          nextStage: 'complete',
          draft: firstRunBudgetDraftPayload(payload),
        }),
      );
      setNote(t('admin.firstRunBudgetCommitted'));
      goStage('complete');
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

  return (
    <FirstRunFrame
      t={t}
      stages={visibleStages}
      stage={stage}
      stageRows={state?.stages}
      stageLabel={stageLabel}
    >
      {error ? <FirstRunErrorNote raw={error} t={t} /> : null}
      {note ? <div className={styles.okNote}>{note}</div> : null}

      {stage === 'welcome' ? (
        <FirstRunWelcome t={t} busy={busy} onStart={() => void onStartSetup()} />
      ) : null}

      {stage === 'complex_card' ? (
        <FirstRunComplexCard
          t={t}
          form={form}
          formErrors={formErrors}
          busy={busy}
          showBack={returnStage != null}
          onChange={setForm}
          onSave={() => void onSaveComplex()}
          onBack={() => {
            const back = returnStage;
            if (!back) return;
            setReturnStage(null);
            goStage(back);
          }}
        />
      ) : null}

      {stage === 'property_book' ? (
        <FirstRunBookImport
          t={t}
          apartmentCount={state?.complex.apartment_count != null ? String(state.complex.apartment_count) : '—'}
          busy={busy}
          dry={bookDry}
          errorRows={errorRows}
          countMismatch={countMismatch ?? (state?.complex.apartment_count != null ? { expected: state.complex.apartment_count, actual: null } : null)}
          committed={bookCommitted}
          needsComplexFix={bookNeedsComplexFix}
          onDownload={() => downloadXlsx(buildPropertyBookIs2TemplateBuffer(), 'property_book_opening_template.xlsx')}
          onFile={(file) => void onBookFile(file)}
          onCommit={() => void onBookCommit()}
          onContinue={() => goStage('meters_select')}
          onEditComplex={() => editComplexFrom('property_book')}
        />
      ) : null}

      {stage === 'meters_select' ? (
        <FirstRunMetersSelectForm
          t={t}
          water={selection.water}
          electricity={selection.electricity}
          busy={busy}
          valid={validateMetersSelection(selection).ok}
          onWater={(checked) => setSelection({ ...selection, water: checked })}
          onElectricity={(checked) => setSelection({ ...selection, electricity: checked })}
          onContinue={() => void onMetersSelectContinue()}
          onEditComplex={() => editComplexFrom('meters_select')}
        />
      ) : null}

      {stage === 'meters_water' ? (
        <FirstRunMetersImport
          utility="water"
          t={t}
          busy={busy}
          dry={meterDry}
          rows={meterRows}
          errorRows={errorRows}
          committed={meterCommitted}
          onDownload={() => downloadXlsx(buildWaterMeterIs3TemplateBuffer(), 'water_meters_opening_template.xlsx')}
          onFile={(file) => void onMetersFile('water', file)}
          onCommit={() => void onMetersCommit('water')}
          onContinue={() => onMetersContinue('water')}
          onEditComplex={() => editComplexFrom('meters_water')}
        />
      ) : null}
      {stage === 'meters_electricity' ? (
        <FirstRunMetersImport
          utility="electricity"
          t={t}
          busy={busy}
          dry={meterDry}
          rows={meterRows}
          errorRows={errorRows}
          committed={meterCommitted}
          onDownload={() =>
            downloadXlsx(buildElectricityMeterIs3TemplateBuffer(), 'electricity_meters_opening_template.xlsx')
          }
          onFile={(file) => void onMetersFile('electricity', file)}
          onCommit={() => void onMetersCommit('electricity')}
          onContinue={() => onMetersContinue('electricity')}
          onEditComplex={() => editComplexFrom('meters_electricity')}
        />
      ) : null}

      {stage === 'support_fee_opening' ? (
        <FirstRunSupportFee
          t={t}
          busy={busy}
          dry={sfDry}
          errorRows={errorRows}
          committed={sfCommitted}
          canCommit={Boolean(sfDry?.ok && sfRows)}
          note={note}
          error={error}
          onDownload={() =>
            downloadXlsx(buildSupportFeeIs4TemplateBuffer(), 'support_fee_opening_template.xlsx')
          }
          onFile={(file) => void onSfFile(file)}
          onCommit={() => void onSfCommit()}
          onContinue={() => goStage('capital_repair_opening')}
        />
      ) : null}

      {stage === 'capital_repair_opening' ? (
        <FirstRunCapitalRepair
          t={t}
          busy={busy}
          dry={crDry}
          errorRows={errorRows}
          committed={crCommitted}
          canCommit={Boolean(crDry?.ok && crRows)}
          fundOk={crFundOk}
          balance={crFundBalance}
          date={crFundDate}
          source={crFundSource}
          notes={crFundNotes}
          note={note}
          error={error}
          onDownload={() =>
            downloadXlsx(buildCapitalRepairIs8TemplateBuffer(), 'capital_repair_opening_template.xlsx')
          }
          onFile={(file) => void onCrFile(file)}
          onCommit={() => void onCrCommit()}
          onBalance={setCrFundBalance}
          onDate={setCrFundDate}
          onSource={setCrFundSource}
          onNotes={setCrFundNotes}
          onFundConfirm={() => void onCrFundConfirm()}
          onContinue={() => void onCrContinue()}
        />
      ) : null}

      {stage === 'tariffs' ? (
        <AdminFirstRunTariffs
          supabase={supabase}
          t={t}
          selection={selectionChosen ? selection : { water: true, electricity: true }}
          busy={busy}
          onBusy={setBusy}
          onContinue={onTariffsContinue}
        />
      ) : null}

      {stage === 'budget' ? (
        <AdminFirstRunBudget
          supabase={supabase}
          t={t}
          draft={state?.draft ?? {}}
          busy={busy}
          onBusy={setBusy}
          onState={applyState}
          onContinue={onBudgetContinue}
        />
      ) : null}

      {stage === 'complete' ? (
        <FirstRunFinish t={t} busy={busy} onFinish={() => void onFinish()} />
      ) : null}
    </FirstRunFrame>
  );
}
