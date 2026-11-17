'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  FirstRunCapitalRepair,
  FirstRunErrorNote,
  FirstRunFinish,
  FirstRunSupportFee,
} from '@/components/admin/FirstRunFinance';
import {
  apartmentCountMismatchInfo,
  complexFormToPayload,
  complexToForm,
  validateComplexFormWithIban,
  completeFirstRunStage,
  fetchFirstRunState,
  emptyModuleChoice,
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
  moduleChoiceToDraft,
  parseMetersSelected,
  parseModuleChoice,
  previousVisibleStage,
  resolveFirstRunResumeStage,
  stageAfterCapitalRepairOpening,
  stageAfterModuleSave,
  readTariffPrep,
  isFirstRunTariffPrepared,
  presentComplexFormErrors,
  saveFirstRunProgress,
  validateMetersSelection,
  visibleFirstRunStages,
  BUDGET_MODULE_KEY,
  firstRunBudgetDraftPayload,
  type FirstRunBudgetDraft,
  type FirstRunComplexForm,
  type FirstRunModuleChoice,
  type FirstRunErrorRow,
  type FirstRunMeterUtility,
  type FirstRunStageKey,
  type FirstRunStageRow,
  type FirstRunState,
  type FirstRunTariffPrepMap,
  type MetersSelection,
} from '@/lib/firstRun';
import {
  buildPropertyBookObjectsTemplateBuffer,
  buildPropertyBookOwnersTemplateBuffer,
  propertyBookObjectsTemplateFileName,
  propertyBookOwnersTemplateFileName,
} from '@/lib/moduleCore/adapters/propertyBookOpening';
import {
  buildElectricityMeterIs3TemplateBuffer,
  buildWaterMeterIs3TemplateBuffer,
  ELECTRICITY_MODULE_KEY,
  WATER_MODULE_KEY,
} from '@/lib/moduleCore/adapters/metersOpening';
import { SUPPORT_FEE_MODULE_KEY } from '@/lib/moduleCore/adapters/supportFeeOpening';
import { parseSupportFeeOpeningWorkbook } from '@/lib/supportFeeSimpleOpening';
import {
  resolveSupportFeeOpeningBillingYear,
  supportFeeOpeningTransitionDate,
} from '@/lib/supportFeeOpeningYear';
import { parseCapitalRepairOpeningWorkbook } from '@/lib/capitalRepairSimpleOpening';
import {
  SUPPORT_FEE_SIMPLE_IMPORT_SPEC,
  buildSupportFeeSimpleTemplateBuffer,
} from '@/lib/importTemplates/specs/supportFeeSimple';
import {
  CAPITAL_REPAIR_SIMPLE_IMPORT_SPEC,
  buildCapitalRepairSimpleTemplateBuffer,
} from '@/lib/importTemplates/specs/capitalRepairSimple';
import {
  buildCapitalRepairIs8TemplateBuffer,
  CAPITAL_REPAIR_MODULE_KEY,
} from '@/lib/moduleCore/adapters/capitalRepairOpening';
import { electricityOpeningAdapter } from '@/lib/moduleCore/adapters/electricityOpeningAdapter';
import { waterOpeningAdapter } from '@/lib/moduleCore/adapters/waterOpeningAdapter';
import { parseModuleXlsxBuffer } from '@/lib/moduleCore/xlsxEngine';
import {
  parsePropertyBookWorkbook,
  partitionPropertyBookOwnerRows,
  propertyBookOwnersForImport,
  type PropertyBookWorkbookPayload,
} from '@/lib/propertyBookAdmin';
import {
  apartmentsWithOwnersCount,
  applyOwnershipTypesToObjects,
  collectOwnersStepOwnershipTypeConflicts,
} from '@/lib/propertyBookImportPreview';
import {
  CAPITAL_REPAIR_IMPORT_SPEC,
  ELECTRICITY_METERS_IMPORT_SPEC,
  INTERNET_IMPORT_SPEC,
  SUPPORT_FEE_IMPORT_SPEC,
  WATER_METERS_IMPORT_SPEC,
  aliasesFromSpec,
  downloadImportTemplateBuffer,
  localizedTemplateFileName,
} from '@/lib/importTemplates';
import { useI18n } from '@/i18n/I18nProvider';
import type { Database } from '@/lib/database.types';
import {
  AdminFirstRunTariffs,
  type FirstRunTariffsNavHandle,
} from '@/components/admin/AdminFirstRunTariffs';
import {
  AdminFirstRunInternetOpening,
  type FirstRunInternetNavHandle,
} from '@/components/admin/AdminFirstRunInternetOpening';
import {
  AdminFirstRunBudget,
  type FirstRunBudgetNavHandle,
} from '@/components/admin/AdminFirstRunBudget';
import {
  AdminFirstRunOpeningExpenses,
  type FirstRunOpeningNavHandle,
} from '@/components/admin/AdminFirstRunOpeningExpenses';
import { FirstRunFrame, FirstRunWelcome } from '@/components/admin/FirstRunFrame';
import {
  FirstRunBookImport,
  FirstRunMetersImport,
  FirstRunMetersSelectForm,
  FirstRunModulesSelect,
} from '@/components/admin/FirstRunSteps';
import type { FirstRunTariffPrepHandle } from '@/components/admin/FirstRunTariffPrepBlock';
import { FirstRunComplexProfile } from '@/components/admin/FirstRunComplexProfile';
import { FirstRunStatusBanner } from '@/components/admin/FirstRunStatusBanner';
import { isValidIban } from '@/lib/iban';
import { buildingModulesFromV2Rows, type BuildingModuleV2Row } from '@/lib/modules';
import { toUserFacingMessage } from '@/lib/userFacingError';
import { useAppConfirm } from '@/components/ui/AppConfirmDialog';

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
  warnings: unknown[];
  newCount: number;
  existingCount: number;
  changesCount: number;
  skippedIdenticalCount: number;
  requiresOverwriteConfirmation: boolean;
  bookEmptyAutoCreate: boolean;
  importableCount: number;
  clarificationCount: number;
  blockingErrorCount: number;
  foundApartmentCount: number | null;
  expectedApartmentCount: number | null;
};

type MetersDryRun = {
  ok: boolean;
  errors: unknown[];
  warnings: unknown[];
  rowCount: number;
  skippedExisting: number;
  deferredCount: number;
  preservedCount: number;
};

type SfDryRun = {
  ok: boolean;
  errors: unknown[];
  rowCount: number;
  createCount: number;
  skippedExisting: number;
  deferredCount?: number;
  debtSum: number;
  creditSum: number;
  rpcRows?: unknown[];
};

type CrDryRun = {
  ok: boolean;
  errors: unknown[];
  rowCount: number;
  createCount: number;
  skippedExisting: number;
  deferredCount?: number;
  debtSum: number;
  creditSum: number;
  rpcRows?: unknown[];
};

function downloadXlsx(buf: ArrayBuffer, fileName: string) {
  downloadImportTemplateBuffer(buf, fileName);
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

/** Owners-sheet / owner-binding noise must not block the apartments-only step. */
function isPropertyBookOwnersNoise(entry: unknown): boolean {
  const r = asObj(entry);
  const sheet = String(r.sheet ?? '')
    .trim()
    .toLowerCase();
  if (
    sheet === 'owners' ||
    sheet === 'собственники' ||
    sheet === 'собственици' ||
    sheet.includes('owner')
  ) {
    return true;
  }
  const code = String(r.code || r.reason || '')
    .trim()
    .toLowerCase();
  if (!code) return false;
  if (code.startsWith('owners_') || code === 'owners_required') return true;
  if (
    code.startsWith('owner_') ||
    code === 'sole_requires_one_owner' ||
    code === 'shared_requires_two_owners' ||
    code === 'shares_must_sum_100' ||
    code === 'mixed_natural_legal_forbidden' ||
    code === 'owner_ideal_parts_sum_mismatch' ||
    code === 'sole_ideal_parts_mismatch'
  ) {
    return true;
  }
  // Ownership type is filled on the owners sub-step — not an apartments-step clarify.
  if (
    code === 'ownership_type_required' ||
    code === 'required:ownership_type' ||
    code === 'ownership_type_invalid' ||
    code === 'invalid:ownership_type'
  ) {
    return true;
  }
  return false;
}

function filterObjectsStepBookIssues(entries: unknown[]): unknown[] {
  return entries.filter((e) => !isPropertyBookOwnersNoise(e));
}

function bookStageIsComplete(
  key: 'property_book_objects' | 'property_book_owners',
  rows: FirstRunStageRow[] | undefined,
): boolean {
  const done = (stageKey: string) =>
    rows?.some((row) => row.stage_key === stageKey && row.status === 'complete') ?? false;
  // Legacy single property_book stage counted as both steps complete.
  return done(key) || done('property_book');
}


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

const MODULE_XLSX_IMPORT_SPECS = [
  WATER_METERS_IMPORT_SPEC,
  ELECTRICITY_METERS_IMPORT_SPEC,
  SUPPORT_FEE_IMPORT_SPEC,
  CAPITAL_REPAIR_IMPORT_SPEC,
  INTERNET_IMPORT_SPEC,
];

/** Localized (ru/bg/en) + legacy BG meter headers + snake_case keys so any UI locale parses exported files. */
function moduleXlsxHeaderAliases(schema: { columns: { key: string }[] }): Record<string, string[]> {
  const aliases: Record<string, string[]> = {};
  for (const col of schema.columns) aliases[col.key] = [col.key];
  const bg: Record<string, string> = {
    apartment_number: 'Апартамент',
    section_code: 'Секция / вход',
    meter_number: 'Номер на водомер',
    initial_reading: 'Начално показание',
    initial_day_reading: 'Начално (ден)',
    initial_night_reading: 'Начално (нощ)',
    installed_at: 'Дата на монтаж',
    opening_balance_kind: 'Тип начален остатък',
    opening_balance_eur: 'Сума начален остатък (EUR)',
  };
  for (const [key, label] of Object.entries(bg)) {
    if (aliases[key]) aliases[key] = [...aliases[key], label];
  }
  if (aliases.section_code) {
    aliases.section_code = [
      ...aliases.section_code,
      'Секция / подъезд',
      'Секция',
      'Подъезд',
      'Section / entrance',
      'Section',
    ];
  }
  if (!aliases.block_code) aliases.block_code = ['block_code'];
  aliases.block_code = [
    ...aliases.block_code,
    'Блок',
    'Block',
    'корпус',
    'код блока',
  ];
  if (aliases.meter_number) aliases.meter_number = [...aliases.meter_number, 'Номер на електромер'];
  for (const spec of MODULE_XLSX_IMPORT_SPECS) {
    for (const [key, list] of Object.entries(aliasesFromSpec(spec))) {
      if (!aliases[key]) aliases[key] = [key];
      aliases[key] = [...new Set([...aliases[key], ...list])];
    }
  }
  return aliases;
}

export function AdminFirstRunWizard({ supabase, t, onDone }: Props) {
  const { confirm, dialog } = useAppConfirm(t('common.close'));
  const { locale } = useI18n();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [state, setState] = useState<FirstRunState | null>(null);
  const [stage, setStage] = useState<FirstRunStageKey>('welcome');
  /** Welcome was completed. Revisiting it only switches the screen. */
  const [welcomePassed, setWelcomePassed] = useState(false);
  /** When editing the complex card from a later step, return there after save. */
  const budgetNavRef = useRef<FirstRunBudgetNavHandle | null>(null);
  const openingNavRef = useRef<FirstRunOpeningNavHandle | null>(null);
  const tariffNavRef = useRef<FirstRunTariffPrepHandle | null>(null);
  const tariffsStepNavRef = useRef<FirstRunTariffsNavHandle | null>(null);
  const internetNavRef = useRef<FirstRunInternetNavHandle | null>(null);

  const [form, setForm] = useState<FirstRunComplexForm>(() => complexToForm(null));
  const [formErrors, setFormErrors] = useState<string[]>([]);

  const [selection, setSelection] = useState<MetersSelection>({ water: false, electricity: false });
  const [moduleChoice, setModuleChoice] = useState<FirstRunModuleChoice>(() => emptyModuleChoice());
  const [moduleCatalog, setModuleCatalog] = useState<BuildingModuleV2Row[]>([]);

  const [bookPayload, setBookPayload] = useState<PropertyBookWorkbookPayload | null>(null);
  const [bookDry, setBookDry] = useState<BookDryRun | null>(null);
  const [bookObjectsCommitted, setBookObjectsCommitted] = useState(false);
  const [bookOwnersCommitted, setBookOwnersCommitted] = useState(false);
  const [bookCommitSummary, setBookCommitSummary] = useState<{
    clarificationCount: number;
    importableCount: number | null;
    ownerRowCount?: number | null;
    apartmentsWithOwnersCount?: number | null;
  } | null>(null);

  const [meterRows, setMeterRows] = useState<Record<string, string>[] | null>(null);
  const [meterDry, setMeterDry] = useState<MetersDryRun | null>(null);
  const [meterCommitted, setMeterCommitted] = useState(false);

  const [sfRows, setSfRows] = useState<Record<string, string>[] | null>(null);
  const [sfPreviewRows, setSfPreviewRows] = useState<Record<string, string>[] | null>(null);
  const [sfDry, setSfDry] = useState<SfDryRun | null>(null);
  const [sfCommitted, setSfCommitted] = useState(false);
  const [sfBillingYear, setSfBillingYear] = useState('');

  const [crRows, setCrRows] = useState<Record<string, string>[] | null>(null);
  const [crPreviewRows, setCrPreviewRows] = useState<Record<string, string>[] | null>(null);
  const [crDry, setCrDry] = useState<CrDryRun | null>(null);
  const [crCommitted, setCrCommitted] = useState(false);
  const [crTransitionDate, setCrTransitionDate] = useState('');
  const [crSourceReference, setCrSourceReference] = useState('');
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
    const choice = parseModuleChoice(next.draft);
    const sel = { water: choice.water, electricity: choice.electricity };
    setModuleChoice(choice);
    setSelection(sel);
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
        const resumed = resolveFirstRunResumeStage(result.state);
        setStage(resumed);
        const welcomeDone =
          result.state?.stages.some((row) => row.stage_key === 'welcome' && row.status === 'complete') ??
          false;
        setWelcomePassed(welcomeDone || resumed !== 'welcome');
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resume once per mount (t identity may change).
  }, [supabase, applyState]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase.rpc('get_building_modules_v2');
      if (cancelled || error || !data) return;
      setModuleCatalog(buildingModulesFromV2Rows(data as BuildingModuleV2Row[]).catalog);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  // Rehydrate committed import flags from stage rows after resume / route moves.
  useEffect(() => {
    if (loading || !state) return;
    const rows = state.stages;
    setBookObjectsCommitted(bookStageIsComplete('property_book_objects', rows));
    setBookOwnersCommitted(bookStageIsComplete('property_book_owners', rows));
    // Legacy in-memory stage key → apartments step.
    if (stage === 'property_book') {
      setStage('property_book_objects');
    }
    setMeterCommitted(
      stage === 'meters_electricity'
        ? stageIsComplete('meters_electricity', rows)
        : stageIsComplete('meters_water', rows),
    );
    setSfCommitted(stageIsComplete('support_fee_opening', rows));
    const crDraft = asObj(rows.find((row) => row.stage_key === 'capital_repair_opening')?.draft);
    const draftRoot = asObj(state.draft);
    const crOpeningDraft = asObj(draftRoot.capital_repair_opening);
    const crAptsDone =
      stageIsComplete('capital_repair_opening', rows) ||
      crDraft.apartments_committed === true ||
      crOpeningDraft.apartments_committed === true;
    const crFundDone =
      stageIsComplete('capital_repair_opening', rows) ||
      crDraft.fund_cash_committed === true ||
      crOpeningDraft.fund_cash_committed === true ||
      draftRoot.fund_cash_committed === true ||
      draftRoot.capital_repair_fund_cash_committed === true;
    setCrCommitted(crAptsDone);
    setCrFundOk(crFundDone);
    // stageIsComplete closes over state; rows/stage are the inputs that matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, state, stage]);

  // CR apartment import + fund cash live in tables before the stage is marked complete.
  // Restore UI locks from those rows so reload does not lose a saved opening.
  useEffect(() => {
    if (loading || stage !== 'capital_repair_opening') return;
    let cancelled = false;
    void (async () => {
      type CrOpeningClient = {
        from: (table: 'capital_repair_opening_imports' | 'capital_repair_fund_cash_opening') => {
          select: (
            columns: string,
            opts?: { count?: 'exact'; head?: boolean },
          ) => {
            limit: (n: number) => PromiseLike<{
              data:
                | {
                    balance_eur?: number | null;
                    as_of_date?: string | null;
                    source_reference?: string | null;
                    notes?: string | null;
                  }[]
                | null;
              count: number | null;
              error: { message?: string } | null;
            }>;
          } & PromiseLike<{ count: number | null; error: { message?: string } | null }>;
        };
      };
      const crClient = supabase as unknown as CrOpeningClient;
      const [importsRes, fundRes] = await Promise.all([
        crClient.from('capital_repair_opening_imports').select('property_id', { count: 'exact', head: true }),
        crClient
          .from('capital_repair_fund_cash_opening')
          .select('balance_eur, as_of_date, source_reference, notes')
          .limit(1),
      ]);
      if (cancelled) return;
      if ((importsRes.count ?? 0) > 0) setCrCommitted(true);
      const fundRow = Array.isArray(fundRes.data) ? fundRes.data[0] : null;
      if (fundRow) {
        setCrFundOk(true);
        const bal = fundRow.balance_eur;
        if (bal != null && String(crFundBalance).trim() === '') setCrFundBalance(String(bal));
        if (fundRow.as_of_date && !crFundDate.trim()) setCrFundDate(String(fundRow.as_of_date));
        if (fundRow.source_reference && !crFundSource.trim()) setCrFundSource(String(fundRow.source_reference));
        if (fundRow.notes && !crFundNotes.trim()) setCrFundNotes(String(fundRow.notes));
      }
    })();
    return () => {
      cancelled = true;
    };
    // Intentionally omit fund field state: only seed empty fields once on resume.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, stage, supabase]);

  const legacyChoiceApplied = useRef(false);
  useEffect(() => {
    if (loading || stage !== 'support_fee_opening' || sfBillingYear) return;
    void resolveSupportFeeOpeningBillingYear(supabase)
      .then((y) => setSfBillingYear(String(y)))
      .catch(() => {
        /* keep empty; download/upload will retry */
      });
  }, [loading, stage, sfBillingYear, supabase]);

  useEffect(() => {
    if (legacyChoiceApplied.current || !state || moduleCatalog.length === 0) return;
    legacyChoiceApplied.current = true;
    if (Object.prototype.hasOwnProperty.call(state.draft, 'modules_selected')) return;
    if (state.first_run_stage === 'welcome' || state.first_run_stage === 'modules_select') return;
    const enabled = new Set(
      moduleCatalog.filter((row) => row.enabled === true).map((row) => row.module_key),
    );
    setModuleChoice((current) => ({
      ...current,
      water: current.water || enabled.has('water'),
      electricity: current.electricity || enabled.has('electricity'),
      budget: current.budget || enabled.has('budget'),
      extra: Array.from(
        new Set([
          ...current.extra,
          ...[...enabled].filter(
            (key) =>
              !['water', 'electricity', 'budget', 'tariffs', 'support_fee', 'capital_repair', 'property_book', 'platform_support', 'user_activation', 'residence_status'].includes(key),
          ),
        ]),
      ),
    }));
  }, [moduleCatalog, state]);

  function stageIsComplete(key: FirstRunStageKey, rows: FirstRunStageRow[] | undefined = state?.stages): boolean {
    return rows?.some((row) => row.stage_key === key && row.status === 'complete') ?? false;
  }

  /** Clear transient file/dry-run UI. Keep confirmed imports from stage status. */
  function resetImportUi(nextStage?: FirstRunStageKey) {
    setBookPayload(null);
    setBookDry(null);
    setMeterRows(null);
    setMeterDry(null);
    setSfRows(null);
    setSfPreviewRows(null);
    setSfDry(null);
    setCrRows(null);
    setCrDry(null);
    setErrorRows([]);
    setCountMismatch(null);
    setNote(null);
    setError(null);

    const rows = state?.stages;
    setBookObjectsCommitted(bookStageIsComplete('property_book_objects', rows));
    setBookOwnersCommitted(bookStageIsComplete('property_book_owners', rows));
    setMeterCommitted(
      nextStage === 'meters_electricity'
        ? stageIsComplete('meters_electricity', rows)
        : stageIsComplete('meters_water', rows),
    );
    setSfCommitted(stageIsComplete('support_fee_opening', rows));
    const crDraft = asObj(rows?.find((row) => row.stage_key === 'capital_repair_opening')?.draft);
    const draftRoot = asObj(state?.draft);
    const crOpeningDraft = asObj(draftRoot.capital_repair_opening);
    setCrCommitted(
      stageIsComplete('capital_repair_opening', rows) ||
        crDraft.apartments_committed === true ||
        crOpeningDraft.apartments_committed === true,
    );
    setCrFundOk(
      stageIsComplete('capital_repair_opening', rows) ||
        crDraft.fund_cash_committed === true ||
        crOpeningDraft.fund_cash_committed === true ||
        draftRoot.fund_cash_committed === true ||
        draftRoot.capital_repair_fund_cash_committed === true,
    );
  }

  function goStage(next: FirstRunStageKey) {
    resetImportUi(next);
    setStage(next);
  }

  async function saveTariffPrep(stageKey: FirstRunStageKey, next: FirstRunTariffPrepMap) {
    applyState(
      await saveFirstRunProgress(supabase, {
        stage: stageKey,
        draft: { tariff_prep: next },
      }),
    );
  }

  async function persistDraftBeforeBack(): Promise<boolean> {
    try {
      if (stage === 'modules_select') {
        applyState(
          await saveFirstRunProgress(supabase, {
            stage: 'modules_select',
            draft: moduleChoiceToDraft(moduleChoice),
          }),
        );
        return true;
      }
      if (stage === 'complex_card') {
        applyState(
          await saveFirstRunProgress(supabase, {
            stage: 'complex_card',
            complex: complexFormToPayload(form, { asDraft: true }),
          }),
        );
        return true;
      }
      if (
        stage === 'meters_water' ||
        stage === 'meters_electricity' ||
        stage === 'support_fee_opening' ||
        stage === 'capital_repair_opening'
      ) {
        const ok = (await tariffNavRef.current?.persistDraft()) ?? true;
        if (!ok) {
          return confirm({
            title: t('common.discardChangesTitle'),
            description: t('admin.firstRunLeaveWithoutSave'),
            confirmLabel: t('common.leaveWithoutSaving'),
            cancelLabel: t('common.continueEditing'),
            tone: 'danger',
          });
        }
        return true;
      }
      if (stage === 'tariffs') {
        const ok = (await tariffsStepNavRef.current?.persistDraft()) ?? true;
        if (!ok) {
          return confirm({
            title: t('common.discardChangesTitle'),
            description: t('admin.firstRunLeaveWithoutSave'),
            confirmLabel: t('common.leaveWithoutSaving'),
            cancelLabel: t('common.continueEditing'),
            tone: 'danger',
          });
        }
        return true;
      }
      if (stage === 'internet_opening') {
        const ok = (await internetNavRef.current?.persistDraft()) ?? true;
        if (!ok) {
          return confirm({
            title: t('common.discardChangesTitle'),
            description: t('admin.firstRunLeaveWithoutSave'),
            confirmLabel: t('common.leaveWithoutSaving'),
            cancelLabel: t('common.continueEditing'),
            tone: 'danger',
          });
        }
        return true;
      }
      if (stage === 'budget') {
        const ok = (await budgetNavRef.current?.persistDraft()) ?? true;
        if (!ok) {
          return confirm({
            title: t('common.discardChangesTitle'),
            description: t('admin.firstRunLeaveWithoutSave'),
            confirmLabel: t('common.leaveWithoutSaving'),
            cancelLabel: t('common.continueEditing'),
            tone: 'danger',
          });
        }
        return true;
      }
      if (stage === 'uk_expenses_opening') {
        const ok = (await openingNavRef.current?.persistDraft()) ?? true;
        if (!ok) {
          return confirm({
            title: t('common.discardChangesTitle'),
            description: t('admin.firstRunLeaveWithoutSave'),
            confirmLabel: t('common.leaveWithoutSaving'),
            cancelLabel: t('common.continueEditing'),
            tone: 'danger',
          });
        }
        return true;
      }
      return true;
    } catch (err: unknown) {
      setError(toUserFacingMessage(err, t, { context: 'first_run', fallback: t('admin.errGeneric') }));
      return confirm({
        title: t('common.discardChangesTitle'),
        description: t('admin.firstRunLeaveWithoutSave'),
        confirmLabel: t('common.leaveWithoutSaving'),
        cancelLabel: t('common.continueEditing'),
        tone: 'danger',
      });
    }
  }

  async function handleWizardBack() {
    if (busy) return;
    if (stage === 'welcome') return;

    if (stage === 'budget' && budgetNavRef.current?.handleBack()) {
      return;
    }

    const saved = await persistDraftBeforeBack();
    if (!saved) return;

    const prev = previousVisibleStage(visibleFirstRunStages(moduleChoice), stage);
    if (!prev) return;
    if (prev === 'welcome') setWelcomePassed(true);
    goStage(prev);
  }

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e: unknown) {
      setError(toUserFacingMessage(e, t, { context: 'first_run', fallback: t('admin.errGeneric') }));
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
    if (welcomePassed) {
      const modulesDone = state?.stages.some(
        (row) => row.stage_key === 'modules_select' && row.status === 'complete',
      );
      setStage(modulesDone ? 'complex_card' : 'modules_select');
      return;
    }
    await run(async () => {
      applyState(await completeFirstRunStage(supabase, { stage: 'welcome', nextStage: 'modules_select' }));
      setWelcomePassed(true);
      goStage('modules_select');
    });
  }

  // Autosave incomplete complex/UK/bank draft while on this stage (restored after re-login).
  useEffect(() => {
    if (loading || stage !== 'complex_card' || busy) return;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const next = await saveFirstRunProgress(supabase, {
            stage: 'complex_card',
            complex: complexFormToPayload(form, { asDraft: true }),
          });
          if (next) setState(next);
        } catch {
          // Draft failures stay silent; Continue shows field errors.
        }
      })();
    }, 900);
    return () => window.clearTimeout(timer);
  }, [form, stage, loading, busy, supabase]);

  async function onSaveComplex() {
    const errs = validateComplexFormWithIban(form, isValidIban);
    setFormErrors(errs);
    if (errs.length > 0) {
      // Concrete field + action + retry hint (not the generic one-liner alone).
      setError(presentComplexFormErrors(errs, t));
      return;
    }
    await run(async () => {
      try {
        await saveFirstRunProgress(supabase, {
          stage: 'complex_card',
          complex: complexFormToPayload(form),
        });
        applyState(
          await completeFirstRunStage(supabase, {
            stage: 'complex_card',
            nextStage: 'property_book_objects',
          }),
        );
        goStage('property_book_objects');
      } catch (e) {
        const raw = e instanceof Error ? e.message : String(e);
        if (/iban invalid/i.test(raw)) {
          setFormErrors((prev) => (prev.includes('bank_0_iban') ? prev : [...prev, 'bank_0_iban']));
        }
        throw e;
      }
    });
  }

  // ---------------------------------------------------------------------------
  // property_book_objects → property_book_owners
  // ---------------------------------------------------------------------------

  function applyBookDryRun(
    res: Record<string, unknown>,
    opts: { filterOwnersNoise: boolean; ignoreOverwriteBlock: boolean },
  ) {
    const rawErrors = Array.isArray(res.errors) ? res.errors : [];
    const rawWarnings = Array.isArray(res.warnings) ? res.warnings : [];
    const errors = opts.filterOwnersNoise ? filterObjectsStepBookIssues(rawErrors) : rawErrors;
    const warnings = opts.filterOwnersNoise ? filterObjectsStepBookIssues(rawWarnings) : rawWarnings;
    const foundApartmentCount = Number(res.found_apartment_count ?? res.unique_apartment_count);
    const expectedApartmentCount = Number(res.expected_apartment_count);
    // When owners noise is stripped, recount from the filtered arrays (RPC totals still include it).
    const blockingErrorCount = opts.filterOwnersNoise
      ? errors.length
      : Number(res.blocking_error_count ?? errors.length) || 0;
    const clarificationCount = opts.filterOwnersNoise
      ? warnings.length
      : Number(res.clarification_count ?? warnings.length) || 0;
    const requiresOverwrite =
      !opts.ignoreOverwriteBlock && res.requires_overwrite_confirmation === true;
    setBookDry({
      ok: errors.length === 0 && blockingErrorCount === 0,
      errors,
      warnings,
      newCount: arrLen(res.new_properties),
      existingCount: arrLen(res.existing_properties),
      changesCount: arrLen(res.changes),
      skippedIdenticalCount: arrLen(res.skipped_identical_property_ids),
      requiresOverwriteConfirmation: requiresOverwrite,
      bookEmptyAutoCreate: res.book_empty_auto_create === true,
      importableCount: Number(res.importable_count ?? 0) || 0,
      clarificationCount,
      blockingErrorCount,
      foundApartmentCount: Number.isFinite(foundApartmentCount) ? foundApartmentCount : null,
      expectedApartmentCount: Number.isFinite(expectedApartmentCount)
        ? expectedApartmentCount
        : null,
    });
    setErrorRows(normalizeFirstRunErrors([...errors, ...warnings]));
    setCountMismatch(apartmentCountMismatchInfo(errors));
  }

  async function onBookObjectsFile(file: File | null) {
    if (bookObjectsCommitted) return;
    setBookPayload(null);
    setBookDry(null);
    setBookCommitSummary(null);
    setErrorRows([]);
    setCountMismatch(null);
    setError(null);
    setNote(null);
    if (!file) return;
    await run(async () => {
      const payload = await parsePropertyBookWorkbook(file, 'objects');
      if (payload.objects.length === 0) {
        setError(t('admin.is2PropertyBookEmptyObjects'));
        return;
      }
      const { data, error: rpcErr } = await supabase.rpc('admin_import_property_book', {
        p_objects: payload.objects,
        p_owners: [],
        p_dry_run: true,
        p_allow_create_missing: true,
        p_allow_overwrite: false,
      });
      if (rpcErr) throw new Error(rpcErr.message);
      applyBookDryRun(asObj(data), { filterOwnersNoise: true, ignoreOverwriteBlock: false });
      setBookPayload(payload);
    });
  }

  async function onBookObjectsCommit() {
    if (!bookPayload || !bookDry || !bookDry.ok || bookDry.requiresOverwriteConfirmation) return;
    await run(async () => {
      const { data, error: rpcErr } = await supabase.rpc('admin_import_property_book', {
        p_objects: bookPayload.objects,
        p_owners: [],
        p_dry_run: false,
        p_allow_create_missing: true,
        p_allow_overwrite: false,
      });
      if (rpcErr) {
        const errs = filterObjectsStepBookIssues(errorsFromRpcDetails(rpcErr));
        setErrorRows(normalizeFirstRunErrors(errs));
        setCountMismatch(apartmentCountMismatchInfo(errs));
        throw new Error(
          errs.length > 0
            ? t('admin.is2PropertyBookImportFailed')
            : rpcErr.message || t('admin.is2PropertyBookImportFailed'),
        );
      }
      const res = asObj(data);
      const commitErrors = filterObjectsStepBookIssues(
        Array.isArray(res.errors) ? res.errors : [],
      );
      if (res.ok !== true || commitErrors.length > 0) {
        setErrorRows(normalizeFirstRunErrors(commitErrors));
        setCountMismatch(apartmentCountMismatchInfo(commitErrors));
        throw new Error(t('admin.is2PropertyBookImportFailed'));
      }
      const importableRaw = Number(res.importable_count);
      const softAfter = filterObjectsStepBookIssues(
        Array.isArray(res.warnings) ? res.warnings : [],
      );
      setBookCommitSummary({
        clarificationCount: Array.isArray(res.warnings)
          ? softAfter.length
          : Number(res.clarification_count ?? 0) || 0,
        importableCount: Number.isFinite(importableRaw)
          ? importableRaw
          : bookPayload.objects.length,
      });
      setBookObjectsCommitted(true);
      setNote(null);
      // Activate Property Book module after apartments are saved.
      await activateModule(PROPERTY_BOOK_MODULE);
      applyState(
        await completeFirstRunStage(supabase, {
          stage: 'property_book_objects',
          nextStage: 'property_book_owners',
        }),
      );
    });
  }

  async function loadExistingBookObjectStubs(): Promise<Record<string, string>[]> {
    const { data: bookRows, error: listErr } = await supabase.rpc('admin_list_property_book', {
      p_limit: 5000,
    });
    if (listErr) throw new Error(listErr.message);
    return ((bookRows ?? []) as Array<{
      apartment_number?: string | number | null;
      section_code?: string | null;
      block_code?: string | null;
      purpose?: string | null;
      area_sqm?: number | null;
      ideal_parts_percent?: number | null;
      ownership_type?: string | null;
      floor?: number | null;
    }>).map((r) => ({
      apartment_number: String(r.apartment_number ?? ''),
      section_code: r.section_code != null ? String(r.section_code) : '',
      block_code: r.block_code != null ? String(r.block_code) : '',
      purpose: r.purpose != null ? String(r.purpose) : '',
      area_sqm: r.area_sqm != null ? String(r.area_sqm) : '',
      ideal_parts_percent: r.ideal_parts_percent != null ? String(r.ideal_parts_percent) : '',
      ownership_type: r.ownership_type != null ? String(r.ownership_type) : '',
      floor: r.floor != null ? String(r.floor) : '',
    }));
  }

  /** Prefill owners XLSX from apartments saved on the previous sub-step. */
  async function onBookOwnersTemplateDownload() {
    setNote(null);
    await run(async () => {
      let stubs: Record<string, string>[];
      try {
        stubs = await loadExistingBookObjectStubs();
      } catch (e: unknown) {
        const detail = e instanceof Error && e.message ? e.message : '';
        throw new Error(
          detail
            ? `${t('admin.firstRunBookOwnersDownloadFailed')} ${detail}`
            : t('admin.firstRunBookOwnersDownloadFailed'),
        );
      }
      if (stubs.length === 0) {
        throw new Error(t('admin.firstRunBookOwnersDownloadEmpty'));
      }
      downloadXlsx(
        buildPropertyBookOwnersTemplateBuffer(
          locale,
          stubs.map((r) => ({
            apartment_number: r.apartment_number,
            section_code: r.section_code,
            block_code: r.block_code,
          })),
        ),
        propertyBookOwnersTemplateFileName(locale),
      );
    });
  }

  async function onBookOwnersFile(file: File | null) {
    if (bookOwnersCommitted) return;
    setBookPayload(null);
    setBookDry(null);
    setBookCommitSummary(null);
    setErrorRows([]);
    setCountMismatch(null);
    setError(null);
    setNote(null);
    if (!file) return;
    await run(async () => {
      const payload = await parsePropertyBookWorkbook(file, 'owners');
      const partitioned = partitionPropertyBookOwnerRows(payload.owners);
      // Partial + identity-only stubs are saved (server skips stub wipe when owners exist).
      const ownersForImport = propertyBookOwnersForImport(partitioned);
      if (ownersForImport.length === 0) {
        setError(t('admin.is2PropertyBookEmptyOwners'));
        return;
      }
      // payload.objects = Objects-sheet rows from a combined legacy workbook (type source only).
      const conflictRows = collectOwnersStepOwnershipTypeConflicts({
        owners: ownersForImport,
        objectsFromFile: payload.objects,
      });
      if (conflictRows.length > 0) {
        setBookDry({
          ok: false,
          errors: conflictRows,
          warnings: [],
          newCount: 0,
          existingCount: 0,
          changesCount: 0,
          skippedIdenticalCount: 0,
          requiresOverwriteConfirmation: false,
          bookEmptyAutoCreate: false,
          importableCount: 0,
          clarificationCount: 0,
          blockingErrorCount: conflictRows.length,
          foundApartmentCount: null,
          expectedApartmentCount: null,
        });
        setErrorRows(conflictRows);
        setBookPayload({
          ...payload,
          owners: ownersForImport,
        });
        return;
      }
      const objectStubs = await loadExistingBookObjectStubs();
      if (objectStubs.length === 0) {
        setError(t('admin.is2PropertyBookEmptyObjects'));
        return;
      }
      const objectsWithType = applyOwnershipTypesToObjects(objectStubs, {
        owners: ownersForImport,
        objectsFromFile: payload.objects,
      });
      const { data, error: rpcErr } = await supabase.rpc('admin_import_property_book', {
        p_objects: objectsWithType,
        p_owners: ownersForImport,
        p_dry_run: true,
        p_allow_create_missing: false,
        p_allow_overwrite: true,
      });
      if (rpcErr) throw new Error(rpcErr.message);
      applyBookDryRun(asObj(data), { filterOwnersNoise: false, ignoreOverwriteBlock: true });
      setBookPayload({
        objects: objectsWithType,
        owners: ownersForImport,
      });
    });
  }

  async function onBookOwnersCommit() {
    if (!bookPayload || !bookDry || !bookDry.ok) return;
    await run(async () => {
      const { data, error: rpcErr } = await supabase.rpc('admin_import_property_book', {
        p_objects: bookPayload.objects,
        p_owners: bookPayload.owners,
        p_dry_run: false,
        p_allow_create_missing: false,
        p_allow_overwrite: true,
      });
      if (rpcErr) {
        const errs = errorsFromRpcDetails(rpcErr);
        setErrorRows(normalizeFirstRunErrors(errs));
        setCountMismatch(apartmentCountMismatchInfo(errs));
        throw new Error(
          errs.length > 0
            ? t('admin.is2PropertyBookImportFailed')
            : rpcErr.message || t('admin.is2PropertyBookImportFailed'),
        );
      }
      const res = asObj(data);
      if (res.ok !== true) {
        const errs = Array.isArray(res.errors) ? res.errors : [];
        setErrorRows(normalizeFirstRunErrors(errs));
        setCountMismatch(apartmentCountMismatchInfo(errs));
        throw new Error(t('admin.is2PropertyBookImportFailed'));
      }
      // Do not auto-send portal invites from first-run owners import.
      const importableRaw = Number(res.importable_count);
      setBookCommitSummary({
        clarificationCount: Number(res.clarification_count ?? 0) || 0,
        importableCount: Number.isFinite(importableRaw) ? importableRaw : null,
        ownerRowCount: bookPayload.owners.length,
        apartmentsWithOwnersCount: apartmentsWithOwnersCount(bookPayload.owners),
      });
      setBookOwnersCommitted(true);
      setNote(null);
      const next = firstMetersStage({
        water: moduleChoice.water,
        electricity: moduleChoice.electricity,
      });
      applyState(
        await completeFirstRunStage(supabase, {
          stage: 'property_book_owners',
          nextStage: next,
        }),
      );
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
        setError(t('admin.is3MetersEmptySheet'));
        return;
      }
      const { data, error: rpcErr } = await importMetersOpening(supabase, utility, parsed.rows, true);
      if (rpcErr) throw new Error(rpcErr.message);
      const res = asObj(data);
      const errors = Array.isArray(res.errors) ? res.errors : [];
      const warnings = Array.isArray(res.warnings) ? res.warnings : [];
      setMeterDry({
        ok: res.ok === true && errors.length === 0,
        errors,
        warnings,
        rowCount: parsed.rows.length,
        skippedExisting: Number(res.skipped_existing_count ?? 0) || 0,
        deferredCount: Number(res.deferred_count ?? warnings.length) || 0,
        preservedCount: Number(res.preserved_count ?? 0) || 0,
      });
      // Preview: show blocking errors separately from deferrable warnings.
      setErrorRows(metersErrorRows(errors));
      setMeterRows(parsed.rows);
    });
  }

  async function onMetersCommit(utility: FirstRunMeterUtility) {
    if (!meterRows || !meterDry || !meterDry.ok) return;
    const prep = readTariffPrep(state?.draft);
    if (!isFirstRunTariffPrepared(utility, prep)) {
      setError(t('admin.firstRunOpeningLockedUntilTariff'));
      return;
    }
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

  async function ensureSfBillingYear(): Promise<string> {
    if (/^\d{4}$/.test(sfBillingYear)) return sfBillingYear;
    const year = await resolveSupportFeeOpeningBillingYear(supabase);
    const y = String(year);
    setSfBillingYear(y);
    return y;
  }

  async function onSfFile(file: File | null) {
    if (!file) return;
    await run(async () => {
      setSfDry(null);
      setSfCommitted(false);
      setErrorRows([]);
      setSfPreviewRows(null);
      setSfRows(null);
      const buf = await file.arrayBuffer();
      const year = await ensureSfBillingYear();
      const parsed = parseSupportFeeOpeningWorkbook(buf, locale, {
        billingYear: year,
        transitionDate: supportFeeOpeningTransitionDate(),
        sourceReference: '',
      });
      if (!parsed.ok) {
        setError(parsed.error);
        return;
      }
      const clientErrors = parsed.clientErrors;
      setSfPreviewRows(parsed.previewRows);
      setSfRows(parsed.rows);

      if (parsed.previewRows.length === 0 && clientErrors.length === 0) {
        setError(t('admin.firstRunSfDryRunErrors').replace('{n}', '0'));
        return;
      }

      // Client-blocking errors: still show unified preview; skip RPC until fixed
      // (except soft-defer / valid rows can dry-run in parallel).
      if (parsed.rows.length === 0) {
        setErrorRows(clientErrors);
        setSfDry({
          ok: false,
          errors: clientErrors,
          rowCount: parsed.previewRows.length,
          createCount: 0,
          skippedExisting: 0,
          deferredCount: 0,
          debtSum: 0,
          creditSum: 0,
          rpcRows: [],
        });
        return;
      }

      const { data, error: rpcErr } = await importSupportFeeOpening(supabase, parsed.rows, true);
      if (rpcErr) throw new Error(rpcErr.message);
      const res = asObj(data);
      const rpcErrors = Array.isArray(res.errors) ? res.errors : [];
      const mergedErrors = [...clientErrors, ...normalizeFirstRunErrors(rpcErrors)];
      // Dedupe by row|field|reason
      const seen = new Set<string>();
      const errors = mergedErrors.filter((e) => {
        const k = `${e.row}|${e.field}|${e.reason}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      const reconcile = asObj(res.reconcile);
      const rowsOut = Array.isArray(res.rows) ? res.rows : [];
      const createCount = rowsOut.filter((r) => {
        const o = asObj(r).outcome;
        return o === 'CREATE' || o === 'CREATED';
      }).length;
      const deferredCount =
        Number(res.deferred_count ?? 0) ||
        rowsOut.filter((r) => {
          const o = asObj(r).outcome;
          return o === 'DEFER' || o === 'DEFERRED';
        }).length;
      const rpcOk = res.ok === true && rpcErrors.length === 0;
      setSfDry({
        ok: rpcOk && clientErrors.length === 0,
        errors,
        rowCount: Number(res.row_count ?? parsed.rows.length) || parsed.rows.length,
        createCount,
        skippedExisting: Number(res.skipped_existing_count ?? 0) || 0,
        deferredCount,
        debtSum: Number(reconcile.remaining_debt_sum ?? 0) || 0,
        creditSum: Number(reconcile.opening_overpayment_sum ?? 0) || 0,
        rpcRows: rowsOut,
      });
      setErrorRows(errors);
    });
  }

  async function onSfCommit() {
    if (!sfRows || !sfDry || !sfDry.ok) return;
    const prep = readTariffPrep(state?.draft);
    if (!isFirstRunTariffPrepared('support_fee', prep)) {
      setError(t('admin.firstRunOpeningLockedUntilTariff'));
      return;
    }
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
      setCrPreviewRows(null);
      setCrRows(null);
      const buf = await file.arrayBuffer();
      const parsed = parseCapitalRepairOpeningWorkbook(buf, locale, {
        transitionDate: crTransitionDate,
        sourceReference: crSourceReference,
      });
      if (!parsed.ok) {
        setError(parsed.error);
        return;
      }
      const clientErrors = parsed.clientErrors;
      setCrPreviewRows(parsed.previewRows);
      setCrRows(parsed.rows);

      if (parsed.previewRows.length === 0 && clientErrors.length === 0) {
        setError(t('admin.firstRunCrDryRunErrors').replace('{n}', '0'));
        return;
      }

      // Soft-defer only (blank amounts): no RPC write; still allow confirm when no errors.
      if (parsed.rows.length === 0) {
        const deferOnly = parsed.deferredCount > 0 && clientErrors.length === 0;
        setErrorRows(clientErrors);
        setCrDry({
          ok: deferOnly,
          errors: clientErrors,
          rowCount: parsed.previewRows.length,
          createCount: 0,
          skippedExisting: 0,
          deferredCount: parsed.deferredCount,
          debtSum: 0,
          creditSum: 0,
          rpcRows: [],
        });
        return;
      }

      const { data, error: rpcErr } = await importCapitalRepairOpening(supabase, parsed.rows, true);
      if (rpcErr) throw new Error(rpcErr.message);
      const res = asObj(data);
      const rpcErrors = Array.isArray(res.errors) ? res.errors : [];
      const mergedErrors = [...clientErrors, ...normalizeFirstRunErrors(rpcErrors)];
      const seen = new Set<string>();
      const errors = mergedErrors.filter((e) => {
        const k = `${e.row}|${e.field}|${e.reason}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      const reconcile = asObj(res.reconcile);
      const rowsOut = Array.isArray(res.rows) ? res.rows : [];
      const createCount = rowsOut.filter((r) => {
        const o = asObj(r).outcome;
        return o === 'CREATE' || o === 'CREATED';
      }).length;
      const deferredCount =
        Number(res.deferred_count ?? 0) ||
        rowsOut.filter((r) => {
          const o = asObj(r).outcome;
          return o === 'DEFER' || o === 'DEFERRED';
        }).length ||
        parsed.deferredCount;
      const rpcOk = res.ok === true && rpcErrors.length === 0;
      setCrDry({
        ok: rpcOk && clientErrors.length === 0,
        errors,
        rowCount: Number(res.row_count ?? parsed.rows.length) || parsed.rows.length,
        createCount,
        skippedExisting: Number(res.skipped_existing_count ?? 0) || 0,
        deferredCount,
        debtSum: Number(reconcile.remaining_debt_sum ?? 0) || 0,
        creditSum: Number(reconcile.opening_overpayment_sum ?? 0) || 0,
        rpcRows: rowsOut,
      });
      setErrorRows(errors);
    });
  }

  async function onCrCommit() {
    if (!crDry || !crDry.ok) return;
    const prep = readTariffPrep(state?.draft);
    if (!isFirstRunTariffPrepared('capital_repair', prep)) {
      setError(t('admin.firstRunOpeningLockedUntilTariff'));
      return;
    }
    await run(async () => {
      if (crRows && crRows.length > 0) {
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
      }
      setCrCommitted(true);
      applyState(
        await saveFirstRunProgress(supabase, {
          stage: 'capital_repair_opening',
          draft: {
            capital_repair_opening: { apartments_committed: true },
            apartments_committed: true,
          },
        }),
      );
      setNote(t('admin.firstRunCrAptsCommitted'));
    });
  }

  async function onCrFundConfirm() {
    const bal = Number(String(crFundBalance).replace(',', '.'));
    if (!Number.isFinite(bal) || bal < 0 || !crFundDate.trim() || !crFundSource.trim()) {
      setError(t('admin.firstRunCrFundInvalid'));
      return;
    }
    const ok = await confirm({
      title: t('common.confirmAction'),
      description: t('admin.firstRunCrFundConfirm'),
      confirmLabel: t('common.yes'),
      cancelLabel: t('common.cancel'),
      tone: 'default',
    });
    if (!ok) return;
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
      applyState(
        await saveFirstRunProgress(supabase, {
          stage: 'capital_repair_opening',
          draft: {
            capital_repair_opening: { fund_cash_committed: true },
            fund_cash_committed: true,
          },
        }),
      );
      setNote(t('admin.firstRunCrFundCommitted'));
    });
  }

  async function onCrContinue() {
    if (!crCommitted || !crFundOk) return;
    await run(async () => {
      setNote(t('admin.firstRunCrActivating'));
      await activateModule(CAPITAL_REPAIR_MODULE_KEY);
      // Same sequence as server coerce: installed modules from saved draft, not a fixed "tariffs" jump.
      const next = stageAfterCapitalRepairOpening(parseModuleChoice(state?.draft));
      applyState(
        await completeFirstRunStage(supabase, {
          stage: 'capital_repair_opening',
          nextStage: next,
          draft: {
            capital_repair_opening: {
              apartments_committed: true,
              fund_cash_committed: true,
            },
          },
        }),
      );
      setNote(t('admin.firstRunCrCommitted'));
      goStage(next);
    });
  }

  // ---------------------------------------------------------------------------
  // tariffs → budget → complete
  // ---------------------------------------------------------------------------

  async function onSaveModules() {
    await run(async () => {
      const draft = moduleChoiceToDraft(moduleChoice);
      const next = stageAfterModuleSave(moduleChoice, state?.stages);
      await saveFirstRunProgress(supabase, { stage: 'modules_select', draft });
      applyState(
        await completeFirstRunStage(supabase, {
          stage: 'modules_select',
          nextStage: next,
          draft,
        }),
      );
      goStage(next);
    });
  }

  async function onInternetOpeningContinue(none: boolean) {
    await run(async () => {
      applyState(
        await completeFirstRunStage(supabase, {
          stage: 'internet_opening',
          nextStage: 'tariffs',
          draft: { internet_opening_none: none },
        }),
      );
      setNote(t('admin.firstRunInternetOpeningCommitted'));
      goStage('tariffs');
    });
  }

  async function onTariffsContinue() {
    await run(async () => {
      applyState(await completeFirstRunStage(supabase, { stage: 'tariffs', nextStage: 'budget' }));
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
          nextStage: 'uk_expenses_opening',
          draft: firstRunBudgetDraftPayload(payload),
        }),
      );
      setNote(t('admin.firstRunBudgetCommitted'));
      goStage('uk_expenses_opening');
    });
  }

  async function onOpeningContinue(none: boolean) {
    await run(async () => {
      applyState(
        await completeFirstRunStage(supabase, {
          stage: 'uk_expenses_opening',
          nextStage: 'complete',
          draft: { uk_expenses_opening_none: none },
        }),
      );
      setNote(t('admin.firstRunOpeningCommitted'));
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

  const visibleStages = useMemo(() => visibleFirstRunStages(moduleChoice), [moduleChoice]);
  const lockedOff = (state?.stages ?? [])
    .filter((row) => row.status === 'complete')
    .map((row) =>
      row.stage_key === 'meters_water' ? 'water' : row.stage_key === 'meters_electricity' ? 'electricity' : row.stage_key === 'budget' ? 'budget' : '',
    )
    .filter(Boolean);

  const stageLabel = (key: FirstRunStageKey): string => {
    switch (key) {
      case 'welcome':
        return t('admin.firstRunStageWelcome');
      case 'modules_select':
        return t('admin.firstRunStageModules');
      case 'complex_card':
        return t('admin.firstRunStageComplex');
      case 'property_book':
      case 'property_book_objects':
      case 'property_book_owners':
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
      case 'internet_opening':
        return t('admin.firstRunStageInternetOpening');
      case 'budget':
        return t('admin.firstRunStageBudget');
      case 'uk_expenses_opening':
        return t('admin.firstRunStageOpeningExpenses');
      default:
        return t('admin.firstRunStageComplete');
    }
  };

  if (loading) {
    return <p className="text-sm text-secondary">{t('admin.firstRunLoading')}</p>;
  }

  const bookNeedsComplexFix = hasApartmentCountMismatch(bookDry?.errors) || countMismatch != null;
  const onBookStage =
    stage === 'property_book' ||
    stage === 'property_book_objects' ||
    stage === 'property_book_owners';

  return (
    <FirstRunFrame
      t={t}
      stages={visibleStages}
      stage={stage}
      stageRows={state?.stages}
      stageLabel={stageLabel}
      showBack={stage !== 'welcome'}
      backDisabled={busy}
      onBack={() => void handleWizardBack()}
    >
      {dialog}
      {error &&
      !onBookStage &&
      stage !== 'meters_water' &&
      stage !== 'meters_electricity' &&
      stage !== 'support_fee_opening' &&
      stage !== 'capital_repair_opening' ? (
        <FirstRunErrorNote raw={error} t={t} />
      ) : null}
      {note &&
      !onBookStage &&
      stage !== 'meters_water' &&
      stage !== 'meters_electricity' &&
      stage !== 'support_fee_opening' &&
      stage !== 'capital_repair_opening' ? (
        <FirstRunStatusBanner tone="success" title={note} />
      ) : null}

      {stage === 'welcome' ? (
        <FirstRunWelcome t={t} busy={busy} resume={welcomePassed} onStart={() => void onStartSetup()} />
      ) : null}

      {stage === 'modules_select' ? (
        <FirstRunModulesSelect
          t={t}
          choice={moduleChoice}
          catalog={moduleCatalog}
          lockedOff={lockedOff}
          busy={busy}
          onChange={setModuleChoice}
          onSave={() => void onSaveModules()}
        />
      ) : null}

      {stage === 'complex_card' ? (
        <FirstRunComplexProfile
          t={t}
          form={form}
          formErrors={formErrors}
          busy={busy}
          onChange={setForm}
          onSave={() => void onSaveComplex()}
        />
      ) : null}

      {stage === 'property_book' || stage === 'property_book_objects' ? (
        <FirstRunBookImport
          t={t}
          phase="objects"
          apartmentCount={state?.complex.apartment_count != null ? String(state.complex.apartment_count) : '—'}
          busy={busy}
          dry={bookDry}
          errorRows={errorRows}
          countMismatch={countMismatch ?? (state?.complex.apartment_count != null ? { expected: state.complex.apartment_count, actual: null } : null)}
          committed={bookObjectsCommitted}
          commitSummary={bookCommitSummary}
          error={error}
          needsComplexFix={bookNeedsComplexFix}
          previewObjects={bookPayload?.objects}
          previewOwners={bookPayload?.owners}
          onDownload={() =>
            downloadXlsx(
              buildPropertyBookObjectsTemplateBuffer(locale),
              propertyBookObjectsTemplateFileName(locale),
            )
          }
          onFile={(file) => void onBookObjectsFile(file)}
          onCommit={() => void onBookObjectsCommit()}
          onContinue={() => goStage('property_book_owners')}
        />
      ) : null}

      {stage === 'property_book_owners' ? (
        <FirstRunBookImport
          t={t}
          phase="owners"
          apartmentCount={state?.complex.apartment_count != null ? String(state.complex.apartment_count) : '—'}
          busy={busy}
          dry={bookDry}
          errorRows={errorRows}
          countMismatch={countMismatch}
          committed={bookOwnersCommitted}
          commitSummary={bookCommitSummary}
          error={error}
          needsComplexFix={false}
          previewObjects={bookPayload?.objects}
          previewOwners={bookPayload?.owners}
          onDownload={() => void onBookOwnersTemplateDownload()}
          onFile={(file) => void onBookOwnersFile(file)}
          onCommit={() => void onBookOwnersCommit()}
          onContinue={() =>
            goStage(
              firstMetersStage({ water: moduleChoice.water, electricity: moduleChoice.electricity }),
            )
          }
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
          error={error}
          supabase={supabase}
          tariffPrep={readTariffPrep(state?.draft)}
          tariffNavRef={tariffNavRef}
          onSaveTariffPrep={(next) => saveTariffPrep('meters_water', next)}
          onTariffBusy={setBusy}
          onDownload={() => {
            void run(async () => {
              const stubs = await loadExistingBookObjectStubs();
              if (stubs.length === 0) {
                throw new Error(t('admin.firstRunMetersDownloadEmpty'));
              }
              downloadXlsx(
                buildWaterMeterIs3TemplateBuffer(
                  locale,
                  stubs.map((r) => ({
                    apartment_number: r.apartment_number,
                    section_code: r.section_code,
                    block_code: r.block_code,
                  })),
                ),
                localizedTemplateFileName(WATER_METERS_IMPORT_SPEC, locale),
              );
            });
          }}
          onFile={(file) => void onMetersFile('water', file)}
          onCommit={() => void onMetersCommit('water')}
          onContinue={() => onMetersContinue('water')}
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
          error={error}
          supabase={supabase}
          tariffPrep={readTariffPrep(state?.draft)}
          tariffNavRef={tariffNavRef}
          onSaveTariffPrep={(next) => saveTariffPrep('meters_electricity', next)}
          onTariffBusy={setBusy}
          onDownload={() => {
            void run(async () => {
              const stubs = await loadExistingBookObjectStubs();
              if (stubs.length === 0) {
                throw new Error(t('admin.firstRunMetersDownloadEmpty'));
              }
              downloadXlsx(
                buildElectricityMeterIs3TemplateBuffer(
                  locale,
                  stubs.map((r) => ({
                    apartment_number: r.apartment_number,
                    section_code: r.section_code,
                    block_code: r.block_code,
                  })),
                ),
                localizedTemplateFileName(ELECTRICITY_METERS_IMPORT_SPEC, locale),
              );
            });
          }}
          onFile={(file) => void onMetersFile('electricity', file)}
          onCommit={() => void onMetersCommit('electricity')}
          onContinue={() => onMetersContinue('electricity')}
        />
      ) : null}

      {stage === 'support_fee_opening' ? (
        <FirstRunSupportFee
          t={t}
          busy={busy}
          dry={sfDry}
          rows={sfPreviewRows ?? sfRows}
          errorRows={errorRows}
          committed={sfCommitted}
          canCommit={Boolean(sfDry?.ok && sfRows && sfRows.length > 0)}
          note={note}
          error={error}
          supabase={supabase}
          tariffPrep={readTariffPrep(state?.draft)}
          tariffNavRef={tariffNavRef}
          onSaveTariffPrep={(next) => saveTariffPrep('support_fee_opening', next)}
          onTariffBusy={setBusy}
          billingYear={sfBillingYear}
          onDownload={() => {
            void run(async () => {
              await ensureSfBillingYear();
              const stubs = await loadExistingBookObjectStubs();
              if (stubs.length === 0) {
                throw new Error(t('admin.firstRunMetersDownloadEmpty'));
              }
              downloadXlsx(
                buildSupportFeeSimpleTemplateBuffer(
                  locale,
                  stubs.map((r) => ({
                    apartment_number: r.apartment_number,
                    section_code: r.section_code,
                    block_code: r.block_code,
                  })),
                ),
                localizedTemplateFileName(SUPPORT_FEE_SIMPLE_IMPORT_SPEC, locale),
              );
            });
          }}
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
          rows={crPreviewRows}
          errorRows={errorRows}
          committed={crCommitted}
          canCommit={Boolean(crDry?.ok)}
          fundOk={crFundOk}
          balance={crFundBalance}
          date={crFundDate}
          source={crFundSource}
          notes={crFundNotes}
          note={note}
          error={error}
          supabase={supabase}
          tariffPrep={readTariffPrep(state?.draft)}
          tariffNavRef={tariffNavRef}
          onSaveTariffPrep={(next) => saveTariffPrep('capital_repair_opening', next)}
          onTariffBusy={setBusy}
          transitionDate={crTransitionDate}
          sourceReference={crSourceReference}
          onTransitionDate={setCrTransitionDate}
          onSourceReference={setCrSourceReference}
          onDownload={() =>
            downloadXlsx(
              buildCapitalRepairSimpleTemplateBuffer(locale),
              localizedTemplateFileName(CAPITAL_REPAIR_SIMPLE_IMPORT_SPEC, locale),
            )
          }
          onDownloadDetailed={() =>
            downloadXlsx(
              buildCapitalRepairIs8TemplateBuffer(locale),
              localizedTemplateFileName(CAPITAL_REPAIR_IMPORT_SPEC, locale),
            )
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
          selection={moduleChoice}
          prep={readTariffPrep(state?.draft)}
          busy={busy}
          onBusy={setBusy}
          onSavePrep={(next) => saveTariffPrep('tariffs', next)}
          onContinue={onTariffsContinue}
          onGoToStage={goStage}
          onNavHandle={(handle) => {
            tariffsStepNavRef.current = handle;
          }}
        />
      ) : null}

      {stage === 'internet_opening' ? (
        <AdminFirstRunInternetOpening
          supabase={supabase}
          t={t}
          draft={state?.draft ?? {}}
          busy={busy}
          onBusy={setBusy}
          tariffPrep={readTariffPrep(state?.draft)}
          onSaveTariffPrep={(next) => saveTariffPrep('internet_opening', next)}
          onContinue={onInternetOpeningContinue}
          onNavHandle={(handle) => {
            internetNavRef.current = handle;
          }}
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
          onNavHandle={(handle) => {
            budgetNavRef.current = handle;
          }}
        />
      ) : null}

      {stage === 'uk_expenses_opening' ? (
        <AdminFirstRunOpeningExpenses
          supabase={supabase}
          t={t}
          draft={state?.draft ?? {}}
          busy={busy}
          onBusy={setBusy}
          onContinue={onOpeningContinue}
          onState={applyState}
          onNavHandle={(handle) => {
            openingNavRef.current = handle;
          }}
        />
      ) : null}

      {stage === 'complete' ? (
        <FirstRunFinish t={t} busy={busy} onFinish={() => void onFinish()} />
      ) : null}
    </FirstRunFrame>
  );
}
