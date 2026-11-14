'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toUserFacingMessage } from '@/lib/userFacingError';
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
import { AdminInventoryOpeningPanel } from '@/components/admin/AdminInventoryOpeningPanel';
import { AppFilePicker, formatAcceptHint } from '@/components/ui/AppFilePicker';
import {
  CAPITAL_REPAIR_MODULE_KEY,
  CAPITAL_REPAIR_SETUP_SCHEMA_VERSION,
  ELECTRICITY_MODULE_KEY,
  INTERNET_MODULE_KEY,
  INTERNET_SETUP_SCHEMA_VERSION,
  PROPERTY_BOOK_MODULE_KEY,
  SUPPORT_FEE_MODULE_KEY,
  SUPPORT_FEE_SETUP_SCHEMA_VERSION,
  UK_EXPENSES_SETUP_KEY,
  UK_EXPENSES_SETUP_SCHEMA_VERSION,
  INVENTORY_MODULE_KEY,
  INVENTORY_SETUP_SCHEMA_VERSION,
  WATER_MODULE_KEY,
  existingActiveSerialsFromMeters,
  existingMetersBySerialFromMeters,
  bootstrapModuleSetupAdapters,
  buildApartmentIdentityLookup,
  buildCapitalAssessmentsMaps,
  buildCapitalLedgerConflictSets,
  buildCategoryCodeMap,
  buildExistingInternetSubMap,
  buildExistingSfScopeMap,
  buildExistingUkExpenseOpeningMap,
  buildImportPreview,
  canTransitionModuleLifecycle,
  classifyCapitalRepairOpeningRows,
  classifyCrOpeningErrorMessage,
  classifyElectricityMeterOpeningRows,
  classifyInternetOpeningErrorMessage,
  classifyInternetOpeningRows,
  classifyPropertyBookOpeningRows,
  classifySupportFeeOpeningRows,
  classifyUkExpenseOpeningErrorMessage,
  classifyUkExpenseOpeningRows,
  classifyInventoryOpeningRows,
  classifyWaterMeterOpeningRows,
  commitCapitalRepairOpeningBatch,
  commitInternetOpeningBatch,
  commitInventoryOpeningBatch,
  commitSupportFeeOpeningBatch,
  commitUkExpenseOpeningBatch,
  crCommitAuditPayload,
  downloadCapitalRepairErrorReport,
  downloadCapitalRepairOpeningTemplate,
  downloadElectricityOpeningTemplate,
  downloadInternetErrorReport,
  downloadInternetOpeningTemplate,
  downloadMeterErrorReport,
  downloadModuleXlsxTemplate,
  downloadPropertyBookErrorReport,
  downloadPropertyBookOpeningTemplate,
  downloadSupportFeeErrorReport,
  downloadSupportFeeOpeningTemplate,
  downloadUkExpensesErrorReport,
  downloadUkExpensesOpeningTemplate,
  downloadInventoryOpeningErrorReport,
  downloadInventoryOpeningTemplate,
  downloadWaterOpeningTemplate,
  filterPreviewForInventoryRetry,
  inventoryCommitAuditPayload,
  inventoryCommitBatchFromAuditPreview,
  inventoryCommitConfirmedSavedCount,
  inventoryCommitUiSummary,
  inventoryOpeningIdempotencyKey,
  mergeInventoryCommitBatches,
  parseInventoryOpeningXlsxBuffer,
  reconcileInventoryCommitWithServer,
  retryCandidatesFromInventoryBatch,
  commitMeterInventoryBatch,
  filterPreviewForCrRetry,
  filterPreviewForInternetRetry,
  filterPreviewForRetry,
  filterPreviewForSfRetry,
  filterPreviewForUkExpenseRetry,
  getModuleAdapter,
  internetCommitAuditPayload,
  listRegisteredModuleAdapters,
  mergeCrCommitBatches,
  mergeInternetCommitBatches,
  mergeMeterCommitBatches,
  mergeSfCommitBatches,
  mergeUkExpenseCommitBatches,
  meterCommitAuditPayload,
  parseModuleXlsxBuffer,
  mergePropertyBookLocalAndRpcPreview,
  previewFromPropertyBookDryRun,
  reconcileCrCommitWithDb,
  reconcileInternetCommitWithDb,
  reconcileMeterCommitWithDb,
  reconcileSfCommitWithDb,
  reconcileUkExpenseCommitWithDb,
  retryCandidatesFromBatch,
  retryCandidatesFromCrBatch,
  retryCandidatesFromInternetBatch,
  retryCandidatesFromSfBatch,
  retryCandidatesFromUkExpenseBatch,
  setupCompleteFromDraft,
  setupSupportsManual,
  setupSupportsXlsx,
  sfCommitAuditPayload,
  ukExpenseCommitAuditPayload,
  classifySfOpeningErrorMessage,
  evaluateTariffSetupGate,
  propertyBookBlocksDependentSetup,
  type CrCommitBatchResult,
  type ImportPreviewResult,
  type InternetCommitBatchResult,
  type MeterCommitBatchResult,
  type SfCommitBatchResult,
  type UkExpenseCommitBatchResult,
  type InventoryCommitBatchResult,
  type InventoryOpeningClassifyContext,
  type ExistingInventoryAssetRef,
  type ExistingInventoryStockRef,
  type ModuleLifecycleState,
  type TariffListSnapshot,
} from '@/lib/moduleCore';
import {
  isRelease1DistributionExcluded,
  moduleLabelMessageKey,
  type BuildingModuleV2Row,
} from '@/lib/modules';
import {
  buildModuleSetupCatalog,
  moduleWizardSteps,
  type ModuleWizardStepId,
} from '@/lib/moduleSetupCatalog';
import { moduleVisual } from '@/lib/moduleVisuals';
import {
  AdminModuleCatalogPanel,
  isMandatoryBuildingModule,
  parseModuleCatalogFilter,
  type ModuleCatalogFilterId,
} from '@/components/admin/AdminModuleCatalogPanel';
import {
  parsePropertyBookWorkbook,
  type PropertyBookWorkbookPayload,
} from '@/lib/propertyBookAdmin';
import { sofiaTodayIsoDate } from '@/lib/tariffs';
import { FIRST_RUN_LOCKED_MODULES } from '@/lib/firstRun';
import { presentImportCommitOutcome } from '@/lib/firstRunUserMessage';
import { useI18n } from '@/i18n/I18nProvider';
import {
  CAPITAL_REPAIR_IMPORT_SPEC,
  ELECTRICITY_METERS_IMPORT_SPEC,
  INTERNET_IMPORT_SPEC,
  INVENTORY_IMPORT_SPEC,
  SUPPORT_FEE_IMPORT_SPEC,
  UK_EXPENSES_IMPORT_SPEC,
  WATER_METERS_IMPORT_SPEC,
  aliasesFromSpec,
  missingColumnsMessage,
  toImportTemplateLocale,
  type ImportColumnDef,
  type ImportTemplateLocale,
  type ImportTemplateSpec,
} from '@/lib/importTemplates';
import { LOCALE_META } from '@/i18n/config';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@/lib/database.types';

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

/** Localized import specs whose headers (ru/bg/en labels + legacy aliases) are accepted on upload. */
const MODULE_XLSX_IMPORT_SPECS: ImportTemplateSpec[] = [
  WATER_METERS_IMPORT_SPEC,
  ELECTRICITY_METERS_IMPORT_SPEC,
  SUPPORT_FEE_IMPORT_SPEC,
  CAPITAL_REPAIR_IMPORT_SPEC,
  INTERNET_IMPORT_SPEC,
  UK_EXPENSES_IMPORT_SPEC,
  INVENTORY_IMPORT_SPEC,
];
const MODULE_XLSX_SPEC_ALIASES = MODULE_XLSX_IMPORT_SPECS.map((spec) => aliasesFromSpec(spec));

/** Extra header aliases so localized (ru/bg/en) and legacy templates parse under any UI locale. */
function moduleXlsxHeaderAliases(schema: { columns: { key: string; labelKey: string }[] }): Record<string, string[]> {
  const aliases: Record<string, string[]> = {};
  for (const col of schema.columns) {
    aliases[col.key] = [col.key];
  }
  for (const bag of MODULE_XLSX_SPEC_ALIASES) {
    for (const [key, list] of Object.entries(bag)) {
      if (!aliases[key]) continue;
      const merged = new Set(aliases[key]);
      for (const a of list) merged.add(a);
      aliases[key] = [...merged];
    }
  }
  // Stable BG labels from dedicated meter templates
  const bgMeter: Record<string, string> = {
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
  const elMeterNumber = 'Номер на електромер';
  for (const [key, label] of Object.entries(bgMeter)) {
    aliases[key] = [...(aliases[key] ?? [key]), label];
  }
  aliases.meter_number = [...(aliases.meter_number ?? []), elMeterNumber];
  return aliases;
}

/** Column definitions by key across module specs (first spec wins for ambiguous keys). */
function moduleXlsxColumnDefsByKey(keys: string[]): ImportColumnDef[] {
  const out: ImportColumnDef[] = [];
  for (const key of keys) {
    for (const spec of MODULE_XLSX_IMPORT_SPECS) {
      const col = spec.columns.find((c) => c.key === key);
      if (col) {
        out.push(col);
        break;
      }
    }
  }
  return out;
}

function presentModuleXlsxParseError(
  error: string,
  t: (k: string) => string,
  locale?: ImportTemplateLocale | string,
): string {
  const code = error.trim();
  if (code.startsWith('missing_headers:')) {
    const base = t('admin.isXlsxMissingHeaders');
    const keys = code
      .slice('missing_headers:'.length)
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean);
    const defs = moduleXlsxColumnDefsByKey(keys);
    if (!defs.length) return base;
    return `${base} ${missingColumnsMessage(defs, toImportTemplateLocale(locale))}`;
  }
  if (code === 'empty_sheet' || code === 'sheet_missing') return t('admin.isXlsxEmptySheet');
  if (code === 'invalid_file_type') return t('admin.isXlsxInvalidType');
  if (code === 'invalid_file_size') return t('admin.isXlsxInvalidSize');
  if (code === 'row_limit') return t('admin.isXlsxRowLimit');
  if (code === 'parse_failed') return t('admin.isXlsxParseFailed');
  return t('admin.isXlsxParseFailed');
}

type LifecycleRow = {
  installation_key: string;
  module_key: string;
  state: string;
  setup_schema_version: string | null;
  catalog_implemented: boolean;
  building_enabled: boolean;
  last_transition_at: string;
  has_setup_draft: boolean;
};

type Props = {
  supabase: SupabaseClient<Database>;
  t: (key: string) => string;
  /** Catalog filter when no wizard is open. */
  defaultFilter?: ModuleCatalogFilterId;
  /** Hide the standalone page header when embedded under Settings. */
  embedded?: boolean;
  /** Refresh parent nav / building_modules after enable/disable. */
  onModulesChanged?: () => void;
};

// R1-RC8: complex card + Property Book + meters live in the mandatory first-run wizard.
// This hub is for connecting / finishing modules after first-run completes.
const MODULE_SETUP_SELECTED_KEY = 'amadeus.moduleSetup.selected';
const MODULE_SETUP_STEP_KEY = 'amadeus.moduleSetup.step';

function syntheticLifecycleRow(moduleKey: string): LifecycleRow {
  return {
    installation_key: 'default',
    module_key: moduleKey,
    state: 'DISABLED',
    setup_schema_version: '1.0',
    catalog_implemented: false,
    building_enabled: false,
    last_transition_at: '',
    has_setup_draft: false,
  };
}

export function AdminInitialSetup({
  supabase,
  t,
  defaultFilter = 'all',
  embedded = false,
  onModulesChanged,
}: Props) {
  const { locale } = useI18n();
  const dateLocale = LOCALE_META[locale].dates;
  const [rows, setRows] = useState<LifecycleRow[]>([]);
  const [buildingCatalog, setBuildingCatalog] = useState<BuildingModuleV2Row[]>([]);
  const [firstRunCompleted, setFirstRunCompleted] = useState(false);
  const [completedFirstRunStages, setCompletedFirstRunStages] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [catalogFilter, setCatalogFilter] = useState<ModuleCatalogFilterId>(() =>
    parseModuleCatalogFilter(defaultFilter),
  );
  const [moduleSavingKey, setModuleSavingKey] = useState<string | null>(null);
  const [pendingEnableKey, setPendingEnableKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successNote, setSuccessNote] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      return window.sessionStorage.getItem(MODULE_SETUP_SELECTED_KEY);
    } catch {
      return null;
    }
  });
  const [moduleStep, setModuleStep] = useState<ModuleWizardStepId>('data');
  const [busy, setBusy] = useState(false);
  const [draftConfirmed, setDraftConfirmed] = useState(false);
  const [verifiedExisting, setVerifiedExisting] = useState(false);
  const [skipHistoricalExpenses, setSkipHistoricalExpenses] = useState(false);
  const [allowCreateMissing, setAllowCreateMissing] = useState(false);
  const [preview, setPreview] = useState<ImportPreviewResult | null>(null);
  const [previewNote, setPreviewNote] = useState<string | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [pendingPayload, setPendingPayload] = useState<PropertyBookWorkbookPayload | null>(null);
  const [pendingMeterPreview, setPendingMeterPreview] = useState<ImportPreviewResult | null>(null);
  const [meterCommitResult, setMeterCommitResult] = useState<MeterCommitBatchResult | null>(null);
  const [pendingSfPreview, setPendingSfPreview] = useState<ImportPreviewResult | null>(null);
  const [sfCommitResult, setSfCommitResult] = useState<SfCommitBatchResult | null>(null);
  const [pendingInternetPreview, setPendingInternetPreview] = useState<ImportPreviewResult | null>(null);
  const [internetCommitResult, setInternetCommitResult] = useState<InternetCommitBatchResult | null>(null);
  const [pendingUkExpensePreview, setPendingUkExpensePreview] = useState<ImportPreviewResult | null>(null);
  const [ukExpenseCommitResult, setUkExpenseCommitResult] = useState<UkExpenseCommitBatchResult | null>(
    null,
  );
  const [pendingInventoryPreview, setPendingInventoryPreview] = useState<ImportPreviewResult | null>(
    null,
  );
  const [inventoryCommitResult, setInventoryCommitResult] =
    useState<InventoryCommitBatchResult | null>(null);
  const [inventoryPath, setInventoryPath] = useState<'choose' | 'import' | 'empty'>('choose');
  const [inventoryImportCommitted, setInventoryImportCommitted] = useState(false);
  /** Data saved but lifecycle not yet READY (invalid jump / failed setup completion). */
  const [inventorySetupCompletionPending, setInventorySetupCompletionPending] = useState(false);
  /** While restoring commit summary from server after refresh. */
  const [inventoryRestoreLoading, setInventoryRestoreLoading] = useState(false);
  const [pendingCrPreview, setPendingCrPreview] = useState<ImportPreviewResult | null>(null);
  const [crCommitResult, setCrCommitResult] = useState<CrCommitBatchResult | null>(null);
  const [tariffSnapshots, setTariffSnapshots] = useState<TariffListSnapshot[]>([]);

  useEffect(() => {
    bootstrapModuleSetupAdapters();
  }, []);

  useEffect(() => {
    setCatalogFilter(parseModuleCatalogFilter(defaultFilter));
  }, [defaultFilter]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    const sb = supabase as SupabaseClient<Database> & {
      rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
    };

    // Align lifecycle with completed first-run stages (idempotent; never flips enabled).
    await sb.rpc('admin_reconcile_first_run_module_lifecycle');

    const { data, error: err } = await supabase.rpc('admin_list_module_lifecycle');
    if (err) {
      setError(toUserFacingMessage(err, t, { fallback: t('admin.errGeneric') }));
      setRows([]);
    } else {
      setRows((data as LifecycleRow[]) ?? []);
    }

    const { data: catalogRows } = await supabase.rpc('get_building_modules_v2');
    setBuildingCatalog((catalogRows as BuildingModuleV2Row[] | null) ?? []);

    const { data: frRaw } = await sb.rpc('admin_get_first_run_state');
    const fr = frRaw as {
      first_run_status?: string | null;
      completed_at?: string | null;
      stages?: Array<{ stage_key?: string; status?: string }> | null;
    } | null;
    const frDone =
      fr?.first_run_status === 'complete' ||
      (typeof fr?.completed_at === 'string' && fr.completed_at.length > 0);
    setFirstRunCompleted(frDone);
    const doneStages = new Set<string>();
    for (const stage of fr?.stages ?? []) {
      if (stage?.status === 'complete' && stage.stage_key) doneStages.add(String(stage.stage_key));
    }
    setCompletedFirstRunStages(doneStages);

    // IS-7a: read-only Tariff Core snapshot for setup gates (no publish / no module activation).
    const { data: tariffRows, error: tariffErr } = await supabase.rpc('list_tariffs', {
      p_module_key: null,
      p_active_only: true,
      p_limit: 50,
    });
    if (!tariffErr && tariffRows) {
      setTariffSnapshots(
        (tariffRows as {
          tariff_key?: string;
          module_key?: string | null;
          active?: boolean | null;
          current_version_id?: string | null;
          current_published_at?: string | null;
        }[]).map((r) => ({
          tariff_key: String(r.tariff_key ?? ''),
          module_key: r.module_key ?? null,
          active: r.active ?? null,
          current_version_id: r.current_version_id ?? null,
          current_published_at: r.current_published_at ?? null,
        })),
      );
    } else {
      setTariffSnapshots([]);
    }

    setLoading(false);
  }, [supabase, t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    try {
      if (selectedKey) window.sessionStorage.setItem(MODULE_SETUP_SELECTED_KEY, selectedKey);
      else window.sessionStorage.removeItem(MODULE_SETUP_SELECTED_KEY);
    } catch {
      /* ignore */
    }
  }, [selectedKey]);

  useEffect(() => {
    if (!selectedKey) return;
    const steps = moduleWizardSteps(selectedKey);
    try {
      const saved = window.sessionStorage.getItem(MODULE_SETUP_STEP_KEY);
      if (saved && (steps as string[]).includes(saved)) {
        setModuleStep(saved as ModuleWizardStepId);
        return;
      }
    } catch {
      /* ignore */
    }
    setModuleStep(steps[0] ?? 'activate');
  }, [selectedKey]);

  useEffect(() => {
    if (!selectedKey) return;
    try {
      window.sessionStorage.setItem(MODULE_SETUP_STEP_KEY, moduleStep);
    } catch {
      /* ignore */
    }
  }, [moduleStep, selectedKey]);

  const registeredExtra = listRegisteredModuleAdapters().filter(
    (a) => !rows.some((r) => r.module_key === a.registration.moduleKey),
  );

  const displayRows = useMemo(() => {
    const extras = registeredExtra.map((a) => syntheticLifecycleRow(a.registration.moduleKey));
    // Rental (and any other distribution exclusions) never appear in Initial Setup.
    return [...rows, ...extras].filter((r) => !isRelease1DistributionExcluded(r.module_key));
  }, [rows, registeredExtra]);

  const selected = useMemo(
    () => displayRows.find((r) => r.module_key === selectedKey) ?? null,
    [displayRows, selectedKey],
  );
  const adapter = selectedKey ? getModuleAdapter(selectedKey) : null;
  const isPropertyBook = selectedKey === PROPERTY_BOOK_MODULE_KEY;
  const isWater = selectedKey === WATER_MODULE_KEY;
  const isElectricity = selectedKey === ELECTRICITY_MODULE_KEY;
  const isMeters = isWater || isElectricity;
  const isSupportFee = selectedKey === SUPPORT_FEE_MODULE_KEY;
  const isInternet = selectedKey === INTERNET_MODULE_KEY;
  const isUkExpenses = selectedKey === UK_EXPENSES_SETUP_KEY;
  const isCapitalRepair = selectedKey === CAPITAL_REPAIR_MODULE_KEY;
  const isInventory = selectedKey === INVENTORY_MODULE_KEY;

  const selectedTariffReady = useMemo(
    () => (selectedKey ? evaluateTariffSetupGate(selectedKey, tariffSnapshots) : null),
    [selectedKey, tariffSnapshots],
  );
  const propertyBookReadyOrVerified = useMemo(() => {
    const pb = displayRows.find((r) => r.module_key === PROPERTY_BOOK_MODULE_KEY);
    if (!pb) return false;
    return pb.state === 'READY' || pb.state === 'ACTIVE' || pb.state === 'SETUP_IN_PROGRESS';
  }, [displayRows]);

  const setupCatalog = useMemo(
    () =>
      buildModuleSetupCatalog({
        lifecycle: displayRows,
        buildingCatalog,
        firstRunCompleted,
        completedFirstRunStages,
        includeComplete: true,
        includeTariffs: true,
      }),
    [displayRows, buildingCatalog, firstRunCompleted, completedFirstRunStages],
  );

  const catalogByKey = useMemo(() => {
    const map = new Map(setupCatalog.map((row) => [row.moduleKey, row]));
    return map;
  }, [setupCatalog]);

  // One-shot: drop restored/session selection once catalog proves the module is complete.
  useEffect(() => {
    if (loading || !selectedKey) return;
    const row = catalogByKey.get(selectedKey);
    if (row?.status !== 'complete') return;
    setSelectedKey(null);
    setPendingEnableKey(null);
    try {
      window.sessionStorage.removeItem(MODULE_SETUP_SELECTED_KEY);
      window.sessionStorage.removeItem(MODULE_SETUP_STEP_KEY);
    } catch {
      /* ignore */
    }
  }, [loading, selectedKey, catalogByKey]);

  const wizardSteps = useMemo(
    () => (selectedKey ? moduleWizardSteps(selectedKey) : []),
    [selectedKey],
  );

  const labelFor = (moduleKey: string) => {
    const msg = moduleLabelMessageKey(moduleKey);
    if (msg) return t(`admin.${msg}`);
    const reg = getModuleAdapter(moduleKey)?.registration;
    if (reg?.nameKey) {
      const k = `admin.${reg.nameKey}`;
      const translated = t(k);
      if (translated !== k) return translated;
    }
    return moduleKey;
  };

  function resetImportUi() {
    setPreview(null);
    setPreviewNote(null);
    setBatchId(null);
    setPendingPayload(null);
    setPendingMeterPreview(null);
    setMeterCommitResult(null);
    setPendingSfPreview(null);
    setSfCommitResult(null);
    setPendingInternetPreview(null);
    setInternetCommitResult(null);
    setPendingUkExpensePreview(null);
    setPendingInventoryPreview(null);
    setInventoryCommitResult(null);
    setInventoryPath('choose');
    setInventoryImportCommitted(false);
    setInventorySetupCompletionPending(false);
    setInventoryRestoreLoading(false);
    setUkExpenseCommitResult(null);
    setPendingCrPreview(null);
    setCrCommitResult(null);
  }

  async function loadSupportFeeClassifyContext() {
    const { data: bookRows, error: listErr } = await supabase.rpc('admin_list_property_book', {
      p_limit: 5000,
    });
    if (listErr) throw listErr;
    const apartments = ((bookRows as {
      property_id?: number;
      apartment_number?: string | number;
      section_code?: string | null;
      block_code?: string | null;
    }[]) ?? [])
      .filter((r) => r.property_id != null)
      .map((r) => ({
        property_id: Number(r.property_id),
        apartment_number: String(r.apartment_number ?? ''),
        section_code: r.section_code != null ? String(r.section_code) : '',
        block_code: r.block_code != null ? String(r.block_code) : '',
      }));
    const apartmentsByNumber = buildApartmentIdentityLookup(apartments);

    const { data: assessmentRows, error: aErr } = await supabase
      .from('support_fee_assessments')
      .select(
        'property_id, billing_year, remaining_due, base_amount, final_amount, status, opening_import, opening_historically_paid_amount',
      );
    if (aErr) throw aErr;
    const existingByScope = buildExistingSfScopeMap(
      (assessmentRows as {
        property_id: number;
        billing_year: number;
        remaining_due?: number | null;
        base_amount?: number | null;
        final_amount?: number | null;
        status?: string | null;
        opening_import?: boolean | null;
        opening_historically_paid_amount?: number | null;
      }[]) ?? [],
    );

    const openingImportsByScope = new Map<
      string,
      { assessed: number; paid: number; remaining: number; over: number }
    >();
    const { data: importRows, error: iErr } = await supabase
      .from('support_fee_opening_imports')
      .select(
        'property_id, billing_year, assessed_amount, historically_paid_amount, remaining_debt, opening_overpayment',
      );
    // Table may not exist until migration applied — treat as empty for local preview.
    if (!iErr && importRows) {
      for (const r of importRows as {
        property_id: number;
        billing_year: number;
        assessed_amount: number;
        historically_paid_amount: number;
        remaining_debt: number;
        opening_overpayment: number;
      }[]) {
        openingImportsByScope.set(`${r.property_id}|${r.billing_year}`, {
          assessed: Number(r.assessed_amount),
          paid: Number(r.historically_paid_amount),
          remaining: Number(r.remaining_debt),
          over: Number(r.opening_overpayment),
        });
      }
    }

    let supportFeeTariffConfigured = false;
    const { data: tariffRows, error: tErr } = await supabase.rpc('list_tariffs', {
      p_module_key: 'support_fee',
      p_active_only: true,
      p_limit: 20,
    });
    if (!tErr && tariffRows) {
      supportFeeTariffConfigured = (
        tariffRows as { tariff_key?: string; current_version_id?: string | null }[]
      ).some(
        (r) =>
          String(r.tariff_key ?? '').toLowerCase() === 'support_fee' &&
          r.current_version_id != null,
      );
    }

    return {
      apartmentsByNumber,
      existingByScope,
      openingImportsByScope,
      supportFeeTariffConfigured,
    };
  }

  async function loadCapitalRepairClassifyContext() {
    const { data: bookRows, error: listErr } = await supabase.rpc('admin_list_property_book', {
      p_limit: 5000,
    });
    if (listErr) throw listErr;
    const apartments = ((bookRows as {
      property_id?: number;
      apartment_number?: string | number;
      section_code?: string | null;
      block_code?: string | null;
    }[]) ?? [])
      .filter((r) => r.property_id != null)
      .map((r) => ({
        property_id: Number(r.property_id),
        apartment_number: String(r.apartment_number ?? ''),
        section_code: r.section_code != null ? String(r.section_code) : '',
        block_code: r.block_code != null ? String(r.block_code) : '',
      }));
    const apartmentsByNumber = buildApartmentIdentityLookup(apartments);

    const { data: assessmentRows, error: aErr } = await supabase
      .from('capital_repair_assessments')
      .select('id, title, status');
    if (aErr) throw aErr;
    const { assessmentsByTitle, assessmentsByYear } = buildCapitalAssessmentsMaps(
      (assessmentRows as { id: string; title: string | null; status?: string | null }[]) ?? [],
    );

    const operationalChargeScopes = new Set<string>();
    const openingObligationScopes = new Set<string>();
    const { data: ledgerRows, error: lErr } = await supabase
      .from('capital_repair_ledger')
      .select('property_id, assessment_id, kind')
      .in('kind', ['charge', 'opening_obligation']);
    if (!lErr && ledgerRows) {
      const sets = buildCapitalLedgerConflictSets(
        (ledgerRows as {
          property_id: number;
          assessment_id: string | null;
          kind: string;
        }[]) ?? [],
      );
      for (const k of sets.operationalChargeScopes) operationalChargeScopes.add(k);
      for (const k of sets.openingObligationScopes) openingObligationScopes.add(k);
    }

    const openingImportsByScope = new Map<
      string,
      { assessed: number; paid: number; remaining: number; over: number; assessmentId: string }
    >();
    const { data: importRows, error: iErr } = await supabase
      .from('capital_repair_opening_imports')
      .select(
        'property_id, billing_year, assessment_id, assessed_amount, historically_paid_amount, remaining_debt, opening_overpayment',
      );
    // Table may not exist until migration applied — treat as empty for local preview.
    if (!iErr && importRows) {
      for (const r of importRows as {
        property_id: number;
        billing_year: number;
        assessment_id: string;
        assessed_amount: number;
        historically_paid_amount: number;
        remaining_debt: number;
        opening_overpayment: number;
      }[]) {
        openingImportsByScope.set(`${r.property_id}|${r.billing_year}`, {
          assessed: Number(r.assessed_amount),
          paid: Number(r.historically_paid_amount),
          remaining: Number(r.remaining_debt),
          over: Number(r.opening_overpayment),
          assessmentId: String(r.assessment_id),
        });
      }
    }

    return {
      apartmentsByNumber,
      openingImportsByScope,
      assessmentsByTitle,
      assessmentsByYear,
      operationalChargeScopes,
      openingObligationScopes,
    };
  }

  async function loadInternetClassifyContext() {
    const { data: bookRows, error: listErr } = await supabase.rpc('admin_list_property_book', {
      p_limit: 5000,
    });
    if (listErr) throw listErr;
    const apartments = ((bookRows as {
      property_id?: number;
      apartment_number?: string | number;
      section_code?: string | null;
      block_code?: string | null;
    }[]) ?? [])
      .filter((r) => r.property_id != null)
      .map((r) => ({
        property_id: Number(r.property_id),
        apartment_number: String(r.apartment_number ?? ''),
        section_code: r.section_code != null ? String(r.section_code) : '',
        block_code: r.block_code != null ? String(r.block_code) : '',
      }));
    const apartmentsByNumber = buildApartmentIdentityLookup(apartments);

    const openingImportsByProperty = new Map<
      number,
      {
        status: string;
        paidThrough: string | null;
        nextChargeOn: string | null;
        debt: number;
        credit: number;
      }
    >();
    const { data: importRows, error: iErr } = await supabase
      .from('internet_opening_imports')
      .select('property_id, status, paid_through, next_charge_on, opening_debt, opening_credit');
    // Table may not exist until migration applied — treat as empty for local preview.
    if (!iErr && importRows) {
      for (const r of importRows as {
        property_id: number;
        status: string;
        paid_through: string | null;
        next_charge_on: string | null;
        opening_debt: number;
        opening_credit: number;
      }[]) {
        openingImportsByProperty.set(Number(r.property_id), {
          status: String(r.status ?? '').toLowerCase(),
          paidThrough: r.paid_through,
          nextChargeOn: r.next_charge_on,
          debt: Number(r.opening_debt ?? 0),
          credit: Number(r.opening_credit ?? 0),
        });
      }
    }

    const { data: subRows, error: sErr } = await supabase
      .from('internet_subscriptions')
      .select(
        'property_id, status, billing_day, next_charge_on, period_start, opening_import, opening_paid_through',
      );
    if (sErr) throw sErr;
    const existingByProperty = buildExistingInternetSubMap(
      ((subRows as {
        property_id: number;
        status: string;
        billing_day?: number | null;
        next_charge_on?: string | null;
        period_start?: string | null;
        opening_import?: boolean | null;
        opening_paid_through?: string | null;
      }[]) ?? []).map((s) => {
        const oi = openingImportsByProperty.get(Number(s.property_id));
        return {
          ...s,
          opening_debt: oi?.debt ?? 0,
          opening_credit: oi?.credit ?? 0,
        };
      }),
    );

    const pendingWoPropertyIds = new Set<number>();
    const { data: woRows, error: woErr } = await supabase
      .from('work_orders')
      .select('target_property_id, internet_action, status')
      .not('internet_action', 'is', null)
      .in('status', ['open', 'in_progress']);
    if (!woErr && woRows) {
      for (const w of woRows as {
        target_property_id: number | null;
        internet_action: string | null;
        status: string;
      }[]) {
        if (w.target_property_id != null && w.internet_action) {
          pendingWoPropertyIds.add(Number(w.target_property_id));
        }
      }
    }

    let internetTariffConfigured = false;
    const { data: tariffRows, error: tErr } = await supabase.rpc('list_tariffs', {
      p_module_key: 'internet',
      p_active_only: true,
      p_limit: 20,
    });
    if (!tErr && tariffRows) {
      internetTariffConfigured = (
        tariffRows as { tariff_key?: string; current_version_id?: string | null }[]
      ).some(
        (r) =>
          String(r.tariff_key ?? '').toLowerCase() === 'internet' &&
          r.current_version_id != null,
      );
    }

    return {
      apartmentsByNumber,
      existingByProperty,
      openingImportsByProperty,
      pendingWoPropertyIds,
      internetTariffConfigured,
      sofiaTodayIso: sofiaTodayIsoDate(),
    };
  }

  async function loadMeterClassifyContext(utility: 'water' | 'electricity') {
    const { data: bookRows, error: listErr } = await supabase.rpc('admin_list_property_book', {
      p_limit: 5000,
    });
    if (listErr) throw listErr;
    const apartments = ((bookRows as {
      property_id?: number;
      apartment_number?: string | number;
      section_code?: string | null;
      block_code?: string | null;
    }[]) ?? [])
      .filter((r) => r.property_id != null)
      .map((r) => ({
        property_id: Number(r.property_id),
        apartment_number: String(r.apartment_number ?? ''),
        section_code: r.section_code != null ? String(r.section_code) : '',
        block_code: r.block_code != null ? String(r.block_code) : '',
      }));
    const apartmentsByNumber = buildApartmentIdentityLookup(apartments);

    const table = utility === 'water' ? 'water_meters' : 'electricity_meters';
    const { data: meterRows, error: meterErr } = await supabase
      .from(table)
      .select('property_id, meter_number, retired_at');
    if (meterErr) throw meterErr;
    const meters = ((meterRows as { property_id: number; meter_number: string; retired_at: string | null }[]) ?? []).map(
      (m) => ({
        propertyId: Number(m.property_id),
        meterNumber: String(m.meter_number ?? ''),
        retiredAt: m.retired_at,
      }),
    );
    return {
      apartmentsByNumber,
      existingActiveSerials: existingActiveSerialsFromMeters(meters),
      existingMetersBySerial: existingMetersBySerialFromMeters(meters),
      policy: { allowReplace: false as const },
    };
  }

  function openModule(moduleKey: string) {
    const row = catalogByKey.get(moduleKey);
    // One-shot: completed modules never reopen the initial wizard (URL/session restore included).
    if (row?.status === 'complete') {
      setSelectedKey(null);
      setPendingEnableKey(null);
      try {
        window.sessionStorage.removeItem(MODULE_SETUP_SELECTED_KEY);
        window.sessionStorage.removeItem(MODULE_SETUP_STEP_KEY);
      } catch {
        /* ignore */
      }
      return;
    }
    setSelectedKey(moduleKey);
    setError(null);
    setSuccessNote(null);
    resetImportUi();
    setDraftConfirmed(false);
    setVerifiedExisting(false);
    setSkipHistoricalExpenses(false);
    setAllowCreateMissing(false);
    if (moduleKey === INVENTORY_MODULE_KEY) {
      setInventoryRestoreLoading(true);
      setInventorySetupCompletionPending(false);
      void (async () => {
        try {
          const { data, error: progErr } = await supabase.rpc('admin_get_module_setup_progress', {
            p_module_key: moduleKey,
          });
          if (progErr || !data) return;
          const draft = (data as { draft?: Record<string, unknown> | null }).draft ?? null;
          if (!draft || typeof draft !== 'object') return;

          const life =
            (await fetchModuleLifecycleState(moduleKey)) ??
            (catalogByKey.get(moduleKey)?.state as ModuleLifecycleState | undefined) ??
            null;
          const lifeReady =
            life === 'READY' || life === 'ACTIVE' || life === 'SUSPENDED';

          if (draft.import_committed === true) {
            setInventoryImportCommitted(true);
            setInventoryPath('import');
            setVerifiedExisting(false);
            const savedPreview = draft.preview as ImportPreviewResult | undefined;
            if (savedPreview?.rows?.length) {
              setPreview(savedPreview);
              setPendingInventoryPreview(savedPreview);
            }
            if (typeof draft.batch_id === 'string' && draft.batch_id) {
              setBatchId(draft.batch_id);
            }
            const reconciled = await restoreInventoryCommitSummary({
              draft,
              requireCommitted: true,
            });
            if (reconciled) {
              setInventoryCommitResult(reconciled);
              const saved = inventoryCommitConfirmedSavedCount(reconciled);
              const total = reconciled.rows.length || saved;
              setPreviewNote(
                t('admin.inv6ImportSuccessBanner').replace('{n}', String(saved || total)),
              );
            }
            if (!lifeReady) {
              setInventorySetupCompletionPending(true);
              setError(t('admin.inv6DataSavedSetupIncomplete'));
              setModuleStep('data');
            } else {
              setInventorySetupCompletionPending(false);
              setModuleStep('activate');
            }
          } else if (draft.empty_inventory_ok === true) {
            // Only when explicitly confirmed — never auto-pick empty from a zero counter.
            setInventoryPath('empty');
            setVerifiedExisting(true);
            if (!lifeReady) {
              setInventorySetupCompletionPending(true);
              setError(t('admin.inv6DataSavedSetupIncomplete'));
              setModuleStep('data');
            } else {
              setModuleStep('activate');
            }
          } else if (draft.last_commit && typeof draft.last_commit === 'object') {
            // Partial import: restore from draft + prove against server.
            setInventoryPath('import');
            setModuleStep('data');
            const savedPreview = draft.preview as ImportPreviewResult | undefined;
            if (savedPreview?.rows?.length) {
              setPreview(savedPreview);
              setPendingInventoryPreview(savedPreview);
            }
            if (typeof draft.batch_id === 'string' && draft.batch_id) {
              setBatchId(draft.batch_id);
            }
            const reconciled = await restoreInventoryCommitSummary({ draft });
            if (reconciled) {
              setInventoryCommitResult(reconciled);
              const ui = inventoryCommitUiSummary(reconciled);
              setPreviewNote(
                [
                  t('admin.inv6SavedOfTotal')
                    .replace('{saved}', String(inventoryCommitConfirmedSavedCount(reconciled)))
                    .replace('{total}', String(ui.total || inventoryCommitConfirmedSavedCount(reconciled))),
                  t('admin.inv6AlreadySaved').replace('{n}', String(ui.alreadySaved)),
                  t('admin.inv6NotSaved').replace('{n}', String(ui.notSaved)),
                ].join(' · '),
              );
              if (!reconciled.fullySuccessful) {
                setError(t('admin.inv6PartialNotFullySuccessful'));
              }
            }
          }
        } catch {
          /* ignore restore failures — wizard stays at choose */
        } finally {
          setInventoryRestoreLoading(false);
        }
      })();
    }
  }

  function backToCatalog() {
    setSelectedKey(null);
    setPendingEnableKey(null);
    setError(null);
    setSuccessNote(null);
    resetImportUi();
    try {
      window.sessionStorage.removeItem(MODULE_SETUP_STEP_KEY);
    } catch {
      /* ignore */
    }
  }

  async function setBuildingEnabled(moduleKey: string, enabled: boolean): Promise<boolean> {
    if (isMandatoryBuildingModule(moduleKey) && !enabled) {
      setError(t('admin.errNoAccess'));
      return false;
    }
    setModuleSavingKey(moduleKey);
    setError(null);
    try {
      const { error: enableErr } = await supabase.rpc('set_building_module_enabled', {
        p_module_key: moduleKey,
        p_enabled: enabled,
      });
      if (enableErr) throw enableErr;
      await load();
      onModulesChanged?.();
      return true;
    } catch (e: unknown) {
      setError(toUserFacingMessage(e, t, { fallback: t('admin.errGeneric') }));
      return false;
    } finally {
      setModuleSavingKey(null);
    }
  }

  async function handleCatalogToggle(moduleKey: string, enabled: boolean) {
    if ((FIRST_RUN_LOCKED_MODULES as readonly string[]).includes(moduleKey)) return;
    const row = catalogByKey.get(moduleKey);
    if (!row) return;

    if (!enabled) {
      setPendingEnableKey(null);
      await setBuildingEnabled(moduleKey, false);
      return;
    }

    // Already configured (first-run or prior activation): enable UX only.
    if (row.status === 'complete') {
      setPendingEnableKey(null);
      await setBuildingEnabled(moduleKey, true);
      return;
    }

    // First enable of an unconfigured / incomplete module → wizard; toggle stays off
    // until activateAndEnable succeeds on the server.
    setPendingEnableKey(moduleKey);
    openModule(moduleKey);
  }

  async function transition(to: ModuleLifecycleState, reason?: string): Promise<boolean> {
    if (!selectedKey) return false;
    if (
      selectedKey === PROPERTY_BOOK_MODULE_KEY &&
      (to === 'READY' || to === 'ACTIVE')
    ) {
      const { data: bookRows, error: listErr } = await supabase.rpc('admin_list_property_book', {
        p_limit: 1,
      });
      if (listErr) {
        setError(toUserFacingMessage(listErr, t, { fallback: t('admin.errGeneric') }));
        return false;
      }
      if (!Array.isArray(bookRows) || bookRows.length === 0) {
        setError(t('admin.is2PropertyBookEmptyBlocksReady'));
        return false;
      }
    }
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.rpc('admin_transition_module_lifecycle', {
      p_module_key: selectedKey,
      p_to_state: to,
      p_reason: reason ?? null,
    });
    setBusy(false);
    if (err) {
      setError(toUserFacingMessage(err, t, { fallback: t('admin.errGeneric') }));
      return false;
    }
    await load();
    return true;
  }

  async function fetchModuleLifecycleState(
    moduleKey: string,
  ): Promise<ModuleLifecycleState | null> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const { data, error: stErr } = await sb
      .from('module_lifecycle')
      .select('state')
      .eq('module_key', moduleKey)
      .maybeSingle();
    if (stErr || !data?.state) return null;
    return String(data.state) as ModuleLifecycleState;
  }

  /**
   * Strict server sequence only:
   * DISABLED → SETUP_REQUIRED → SETUP_IN_PROGRESS → READY.
   * Never jumps SETUP_REQUIRED → READY.
   */
  async function advanceModuleLifecycleToReady(
    moduleKey: string,
    reason: string,
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    let state =
      (await fetchModuleLifecycleState(moduleKey)) ??
      ((catalogByKey.get(moduleKey)?.state as ModuleLifecycleState | undefined) ?? null);
    if (!state) {
      return { ok: false, message: t('admin.errGeneric') };
    }
    if (state === 'READY' || state === 'ACTIVE' || state === 'SUSPENDED') {
      return { ok: true };
    }

    const run = async (to: ModuleLifecycleState, stepReason: string) => {
      const { error: err } = await supabase.rpc('admin_transition_module_lifecycle', {
        p_module_key: moduleKey,
        p_to_state: to,
        p_reason: stepReason,
      });
      if (err) throw err;
      state = to;
    };

    try {
      if (state === 'DISABLED') {
        await run('SETUP_REQUIRED', `${reason}:begin_setup`);
      }
      if (state === 'SETUP_REQUIRED') {
        await run('SETUP_IN_PROGRESS', `${reason}:setup_in_progress`);
      }
      if (state === 'SETUP_IN_PROGRESS') {
        await run('READY', reason);
      }
      const finalState = (await fetchModuleLifecycleState(moduleKey)) ?? state;
      if (
        finalState !== 'READY' &&
        finalState !== 'ACTIVE' &&
        finalState !== 'SUSPENDED'
      ) {
        return {
          ok: false,
          message: t('admin.inv6SetupCompletionFailed'),
        };
      }
      await load();
      return { ok: true };
    } catch (e: unknown) {
      await load();
      return {
        ok: false,
        message: toUserFacingMessage(e, t, { fallback: t('admin.inv6SetupCompletionFailed') }),
      };
    }
  }

  async function loadLatestInventoryCommitAudit(): Promise<InventoryCommitBatchResult | null> {
    const { data, error: batErr } = await supabase.rpc('admin_list_module_import_batches', {
      p_module_key: INVENTORY_MODULE_KEY,
      p_limit: 20,
    });
    if (batErr || !data) return null;
    const rows = Array.isArray(data) ? data : [];
    const commitBatch = rows.find((r) => {
      if (!r || typeof r !== 'object') return false;
      const name = String((r as { file_name?: string }).file_name ?? '');
      return name.startsWith('inventory-opening-commit-');
    }) as { preview?: Record<string, unknown> } | undefined;
    if (!commitBatch?.preview) return null;
    return inventoryCommitBatchFromAuditPreview(commitBatch.preview);
  }

  async function restoreInventoryCommitSummary(args: {
    draft: Record<string, unknown>;
    requireCommitted?: boolean;
  }): Promise<InventoryCommitBatchResult | null> {
    const presence = await loadInventoryServerPresence();
    const savedPreview = args.draft.preview as ImportPreviewResult | undefined;
    let batch: InventoryCommitBatchResult | null = null;
    if (args.draft.last_commit && typeof args.draft.last_commit === 'object') {
      const raw = args.draft.last_commit as Record<string, unknown>;
      batch =
        inventoryCommitBatchFromAuditPreview(raw) ??
        (Array.isArray(raw.rows) ? (raw as unknown as InventoryCommitBatchResult) : null);
    }
    if (!batch) {
      batch = await loadLatestInventoryCommitAudit();
    }
    if (!batch) {
      // Last resort: presence-only summary (no per-row excel mapping).
      const confirmed = presence.assetNumbers.size + presence.stockBySku.size;
      if (confirmed <= 0) return null;
      return {
        rows: [],
        createdCount: 0,
        skippedExistingCount: confirmed,
        conflictCount: 0,
        failedCount: 0,
        notProcessedCount: 0,
        fullySuccessful: true,
        stoppedEarly: false,
        financeTouched: false,
      };
    }
    const previewRows =
      savedPreview?.rows ??
      batch.rows.map((r) => ({
        rowNumber: r.rowNumber,
        matchKey: r.matchKey,
        data: {
          tracking_type: r.trackingType,
          inventory_number: r.trackingType === 'INDIVIDUAL_ASSET' ? r.matchKey : '',
          sku_code: r.trackingType === 'QUANTITY_STOCK' ? r.matchKey : '',
          opening_qty: '1',
        },
      }));
    return reconcileInventoryCommitWithServer(batch, previewRows, presence);
  }

  /**
   * Activate lifecycle and enable UX access together.
   * If enabling building_modules fails after ACTIVE, roll lifecycle back to READY.
   */
  async function activateAndEnable() {
    if (!selectedKey || !selected) return;
    setSuccessNote(null);
    setError(null);
    setBusy(true);
    try {
      let state = selected.state as ModuleLifecycleState;
      const needsSetup = adapter?.registration.requiresInitialSetup === true;

      if (state === 'DISABLED') {
        if (needsSetup) {
          const { error: beginErr } = await supabase.rpc('admin_transition_module_lifecycle', {
            p_module_key: selectedKey,
            p_to_state: 'SETUP_REQUIRED',
            p_reason: 'begin_setup',
          });
          if (beginErr) throw beginErr;
          await load();
          setModuleStep(wizardSteps.includes('data') ? 'data' : 'confirm');
          setError(t('admin.moduleSetupActivateBlocked'));
          return;
        }
        const { error: readyErr } = await supabase.rpc('admin_transition_module_lifecycle', {
          p_module_key: selectedKey,
          p_to_state: 'READY',
          p_reason: 'no_setup_required',
        });
        if (readyErr) throw readyErr;
        state = 'READY';
      }

      if (state === 'SETUP_REQUIRED' || state === 'SETUP_IN_PROGRESS') {
        setError(t('admin.moduleSetupActivateBlocked'));
        return;
      }

      if (state === 'READY' || state === 'SUSPENDED') {
        const { error: activeErr } = await supabase.rpc('admin_transition_module_lifecycle', {
          p_module_key: selectedKey,
          p_to_state: 'ACTIVE',
          p_reason: 'admin_confirm_activate',
        });
        if (activeErr) throw activeErr;
        state = 'ACTIVE';
      }

      if (state !== 'ACTIVE') {
        setError(t('admin.moduleSetupActivateBlocked'));
        return;
      }

      const { error: enableErr } = await supabase.rpc('set_building_module_enabled', {
        p_module_key: selectedKey,
        p_enabled: true,
      });
      if (enableErr) {
        await supabase.rpc('admin_transition_module_lifecycle', {
          p_module_key: selectedKey,
          p_to_state: 'READY',
          p_reason: 'rollback_enable_failed',
        });
        throw enableErr;
      }

      setSuccessNote(
        t('admin.moduleSetupActivateSuccess').replace('{module}', labelFor(selectedKey)),
      );
      setPendingEnableKey(null);
      await load();
      onModulesChanged?.();
      window.setTimeout(() => backToCatalog(), 1200);
    } catch (err: unknown) {
      setError(toUserFacingMessage(err, t, { fallback: t('admin.errGeneric') }));
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function loadUkExpenseClassifyContext() {
    const { data: expenseRows, error: eErr } = await supabase
      .from('uk_expenses')
      .select(
        'id, source_ref, title, expense_date, amount, opening_transition_date, budget_category_id, status, opening_import',
      )
      .eq('opening_import', true);
    // Table columns may be missing until migration applied — treat as empty.
    const existingBySourceRef = eErr
      ? new Map()
      : buildExistingUkExpenseOpeningMap(
          (expenseRows as {
            id: number;
            source_ref?: string | null;
            title?: string | null;
            expense_date: string;
            amount: number;
            opening_transition_date?: string | null;
            budget_category_id?: string | null;
            status?: string | null;
            opening_import?: boolean | null;
          }[]) ?? [],
        );

    const { data: cats, error: cErr } = await supabase
      .from('budget_categories')
      .select('id, code, active');
    const categoriesByCode = cErr
      ? new Map()
      : buildCategoryCodeMap(
          (cats as { id: string; code: string; active?: boolean | null }[]) ?? [],
        );

    return {
      existingBySourceRef,
      categoriesByCode,
      sofiaTodayIso: sofiaTodayIsoDate(),
    };
  }

  async function loadInventoryServerPresence() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const [{ data: assetRows }, { data: stockRows }, { data: openingMoves }] = await Promise.all([
      sb.from('inventory_assets').select('inventory_number'),
      sb.from('inventory_stock_items').select('id, sku_code'),
      sb
        .from('inventory_stock_movements')
        .select('stock_item_id')
        .eq('movement_type', 'OPENING'),
    ]);
    const openingSet = new Set(
      ((openingMoves as { stock_item_id: string }[] | null) ?? []).map((m) =>
        String(m.stock_item_id),
      ),
    );
    const stockBySku = new Map<string, { stockItemId: string; hasOpeningMovement: boolean }>();
    for (const s of (stockRows as { id: string; sku_code: string }[] | null) ?? []) {
      stockBySku.set(String(s.sku_code), {
        stockItemId: String(s.id),
        hasOpeningMovement: openingSet.has(String(s.id)),
      });
    }
    return {
      assetNumbers: new Set(
        ((assetRows as { inventory_number: string }[] | null) ?? []).map((a) =>
          String(a.inventory_number),
        ),
      ),
      stockBySku,
    };
  }

  async function loadInventoryClassifyContext(): Promise<InventoryOpeningClassifyContext> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const [cats, locs, units, assets, stock, moves] = await Promise.all([
      sb.from('inventory_categories').select('id, code, active, name_bg, name_ru, name_en'),
      sb.from('inventory_locations').select('id, code, active, name'),
      sb.from('inventory_units').select('code'),
      sb
        .from('inventory_assets')
        .select(
          'id, inventory_number, name, ownership_kind, category_id, location_id, condition, serial_number, estimated_value_eur',
        ),
      sb
        .from('inventory_stock_items')
        .select(
          'id, sku_code, name, unit_code, ownership_kind, category_id, default_location_id',
        ),
      sb.from('inventory_stock_movements').select('stock_item_id, movement_type'),
    ]);

    const norm = (v: string) =>
      String(v ?? '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ');
    const categoriesByCode = new Map<string, string>();
    const categoryLabelsById = new Map<string, string>();
    for (const c of (cats.data ?? []) as {
      id: string;
      code: string;
      active?: boolean;
      name_bg?: string;
      name_ru?: string;
      name_en?: string;
    }[]) {
      if (c.active === false) continue;
      const id = String(c.id);
      categoriesByCode.set(norm(c.code), id);
      for (const n of [c.name_bg, c.name_ru, c.name_en]) {
        if (n && norm(n)) categoriesByCode.set(norm(n), id);
      }
      categoryLabelsById.set(
        id,
        String(c.name_ru || c.name_bg || c.name_en || c.code || '').trim(),
      );
    }
    const locationsByCode = new Map<string, string>();
    const locationLabelsById = new Map<string, string>();
    for (const l of (locs.data ?? []) as {
      id: string;
      code: string;
      active?: boolean;
      name?: string;
    }[]) {
      if (l.active === false) continue;
      const id = String(l.id);
      locationsByCode.set(norm(l.code), id);
      if (l.name && norm(l.name)) locationsByCode.set(norm(l.name), id);
      locationLabelsById.set(id, String(l.name || l.code || '').trim());
    }
    const unitSet = new Set<string>();
    for (const u of (units.data ?? []) as { code: string }[]) {
      const code = String(u.code ?? '').trim();
      if (!code) continue;
      unitSet.add(code);
      unitSet.add(code.toLowerCase());
    }
    const assetsByNumber = new Map<string, ExistingInventoryAssetRef>();
    for (const a of (assets.data ?? []) as Array<{
      id: string;
      inventory_number: string;
      name: string;
      ownership_kind: string;
      category_id: string | null;
      location_id: string | null;
      condition: string;
      serial_number: string | null;
      estimated_value_eur: number | null;
    }>) {
      assetsByNumber.set(norm(String(a.inventory_number)), {
        id: String(a.id),
        inventoryNumber: String(a.inventory_number),
        name: String(a.name),
        ownershipKind: String(a.ownership_kind),
        categoryId: a.category_id ? String(a.category_id) : null,
        locationId: a.location_id ? String(a.location_id) : null,
        condition: String(a.condition),
        serialNumber: a.serial_number,
        estimatedValueEur: a.estimated_value_eur,
      });
    }
    const openingSkus = new Set<string>();
    for (const m of (moves.data ?? []) as { stock_item_id: string; movement_type: string }[]) {
      if (m.movement_type === 'OPENING') openingSkus.add(String(m.stock_item_id));
    }
    const stockBySku = new Map<string, ExistingInventoryStockRef>();
    for (const s of (stock.data ?? []) as {
      id: string;
      sku_code: string;
      name: string;
      unit_code: string;
      ownership_kind: string;
      category_id: string | null;
      default_location_id: string | null;
    }[]) {
      stockBySku.set(norm(String(s.sku_code)), {
        id: String(s.id),
        skuCode: String(s.sku_code),
        name: String(s.name),
        unitCode: String(s.unit_code),
        ownershipKind: String(s.ownership_kind),
        categoryId: s.category_id ? String(s.category_id) : null,
        defaultLocationId: s.default_location_id ? String(s.default_location_id) : null,
        hasOpeningMovement: openingSkus.has(String(s.id)),
        qtyOnHand: 0,
      });
    }
    return {
      categoriesByCode,
      locationsByCode,
      categoryLabelsById,
      locationLabelsById,
      units: unitSet,
      assetsByNumber,
      stockBySku,
      sourceRefsSeen: new Set(),
      allowCreateCatalog: true,
    };
  }

  async function saveDraft() {
    if (!selectedKey || !adapter) return;
    setBusy(true);
    const draft = {
      confirmed: draftConfirmed || verifiedExisting || skipHistoricalExpenses,
      verified_existing_readonly: verifiedExisting,
      skip_historical_import: skipHistoricalExpenses,
    };
    const validation = adapter.validateManual?.(draft);
    if (validation && !validation.ok) {
      setBusy(false);
      setError(validation.errors.join(', '));
      return;
    }
    const { error: err } = await supabase.rpc('admin_save_module_setup_progress', {
      p_module_key: selectedKey,
      p_current_step: adapter.registration.setup?.steps[0]?.id ?? 'confirm',
      p_draft: draft,
      p_validation_errors: [],
      p_setup_schema_version: adapter.registration.setup?.schemaVersion ?? '1.0',
    });
    setBusy(false);
    if (err) {
      setError(toUserFacingMessage(err, t, { fallback: t('admin.errGeneric') }));
      return;
    }
    if (
      selected &&
      canTransitionModuleLifecycle(selected.state as ModuleLifecycleState, 'SETUP_IN_PROGRESS')
    ) {
      await transition('SETUP_IN_PROGRESS', 'setup_draft_saved');
    } else {
      await load();
    }
  }

  async function markReady() {
    if (!selectedKey || !adapter) return;
    const draft = {
      confirmed: draftConfirmed || verifiedExisting || skipHistoricalExpenses,
      verified_existing_readonly: verifiedExisting,
      skip_historical_import: skipHistoricalExpenses,
    };
    if (isInventory) {
      const inventoryDraft = {
        empty_inventory_ok: verifiedExisting || inventoryPath === 'empty',
        import_committed: inventoryImportCommitted,
      };
      const validation = adapter.validateManual?.(inventoryDraft);
      if (!validation || !validation.ok) {
        setError(t('admin.inv6SetupIncomplete'));
        return;
      }
    } else if (isUkExpenses || isCapitalRepair) {
      const validation = adapter.validateManual?.(draft);
      if (!validation || !validation.ok) {
        setError(t('admin.is1SetupIncomplete'));
        return;
      }
    } else {
      const complete = setupCompleteFromDraft(adapter.registration, draft);
      if (adapter.registration.requiresInitialSetup && !complete) {
        setError(t('admin.is1SetupIncomplete'));
        return;
      }
    }
    if (
      selected?.state === 'SETUP_IN_PROGRESS' ||
      selected?.state === 'SETUP_REQUIRED' ||
      selected?.state === 'DISABLED'
    ) {
      if (selected.state === 'DISABLED' && !adapter.registration.requiresInitialSetup) {
        await transition('READY', 'no_setup_required');
        return;
      }
      // Allowed path only — never SETUP_REQUIRED → READY in one hop.
      const advanced = await advanceModuleLifecycleToReady(selectedKey, 'setup_complete');
      if (!advanced.ok) {
        setError(advanced.message);
      }
    }
  }

  async function retryInventorySetupCompletion() {
    if (!selectedKey || !isInventory) return;
    if (!inventoryImportCommitted && !(verifiedExisting || inventoryPath === 'empty')) {
      setError(t('admin.inv6SetupIncomplete'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const advanced = await advanceModuleLifecycleToReady(
        selectedKey,
        inventoryImportCommitted
          ? 'inventory_opening_setup_retry'
          : 'inventory_empty_setup_retry',
      );
      if (!advanced.ok) {
        setInventorySetupCompletionPending(true);
        setError(t('admin.inv6DataSavedSetupIncomplete'));
        return;
      }
      await supabase.rpc('admin_save_module_setup_progress', {
        p_module_key: selectedKey,
        p_current_step: 'inventory_opening',
        p_draft: {
          import_committed: inventoryImportCommitted,
          empty_inventory_ok: verifiedExisting || inventoryPath === 'empty',
          created_count: inventoryCommitResult
            ? inventoryCommitConfirmedSavedCount(inventoryCommitResult)
            : undefined,
          saved_count: inventoryCommitResult
            ? inventoryCommitConfirmedSavedCount(inventoryCommitResult)
            : undefined,
          total_rows: inventoryCommitResult?.rows.length,
          last_commit: inventoryCommitResult ?? undefined,
          preview: pendingInventoryPreview ?? undefined,
          setup_completion: 'done',
        },
        p_validation_errors: [],
        p_setup_schema_version: INVENTORY_SETUP_SCHEMA_VERSION,
      });
      setInventorySetupCompletionPending(false);
      setModuleStep('activate');
    } catch (e: unknown) {
      setError(toUserFacingMessage(e, t, { fallback: t('admin.inv6SetupCompletionFailed') }));
    } finally {
      setBusy(false);
    }
  }

  async function onXlsxSelected(file: File | null) {
    resetImportUi();
    if (!file || !selectedKey || !adapter?.registration.setup?.xlsx) return;

    if (isPropertyBook) {
      setBusy(true);
      setError(null);
      try {
        const payload = await parsePropertyBookWorkbook(file);
        if (payload.objects.length === 0) {
          setError(t('admin.is2PropertyBookEmptyObjects'));
          return;
        }
        const { data: bookRows, error: listErr } = await supabase.rpc('admin_list_property_book', {
          p_limit: 5000,
        });
        if (listErr) throw listErr;
        const existingApts = ((bookRows as {
          apartment_number?: string | number;
          section_code?: string | null;
          block_code?: string | null;
        }[]) ?? []).map((r) => ({
          apartment_number: String(r.apartment_number ?? ''),
          section_code: r.section_code != null ? String(r.section_code) : '',
          block_code: r.block_code != null ? String(r.block_code) : '',
        }));

        // Client classify: CREATE/UPDATE/SKIP/ERROR — overwrite always off in IS-2 UI.
        const localPreview = classifyPropertyBookOpeningRows(payload, existingApts, {
          allowOverwrite: false,
          allowCreateMissing,
        });

        // Server dry-run (no writes) — canonical Book RPC.
        const { data: dryData, error: dryErr } = await supabase.rpc('admin_import_property_book', {
          p_objects: payload.objects,
          p_owners: payload.owners,
          p_dry_run: true,
          p_allow_create_missing: allowCreateMissing,
          p_allow_overwrite: false,
        });
        if (dryErr) throw dryErr;

        const rpcPreview = previewFromPropertyBookDryRun(
          (dryData ?? {}) as {
            ok?: boolean;
            errors?: unknown[];
            existing_properties?: unknown[];
            new_properties?: unknown[];
            changes?: unknown[];
            duplicates?: unknown[];
          },
        );

        // Local classify + server dry-run ownership checks (same codes as commit).
        const result = mergePropertyBookLocalAndRpcPreview(localPreview, rpcPreview);
        setPreview(result);
        setPendingPayload(result.errorCount === 0 ? payload : null);

        const { data: batch, error: batchErr } = await supabase.rpc(
          'admin_create_module_import_batch',
          {
            p_module_key: selectedKey,
            p_schema_version: adapter.registration.setup.schemaVersion,
            p_source: 'xlsx',
            p_file_name: file.name,
            p_preview: {
              local: result,
              rpc_dry_run: rpcPreview,
              policy: { allowOverwrite: false, allowCreateMissing },
            },
            p_row_count: result.rows.length,
            p_create_count: result.createCount,
            p_update_count: result.updateCount,
            p_skip_count: result.skipCount,
            p_error_count: result.errorCount,
            p_error_report: result.rows
              .filter((r) => r.errors.length)
              .map((r) => ({
                rowNumber: r.rowNumber,
                sheet: r.data.sheet,
                errors: r.errors,
              })),
          },
        );
        if (batchErr) throw batchErr;
        const id = String((batch as { id?: string })?.id ?? '');
        setBatchId(result.errorCount === 0 ? id || null : null);
        const rpcCodes = rpcPreview.rows
          .filter((r) => r.operation === 'error')
          .flatMap((r) => r.errors)
          .filter(Boolean);
        setPreviewNote(
          t('admin.is1PreviewSaved').replace('{id}', id) +
            (result.errorCount
              ? ` · ${t('admin.is2PropertyBookRpcErrors').replace('{n}', String(result.errorCount))}` +
                (rpcCodes.length
                  ? ` · ${Array.from(new Set(rpcCodes)).slice(0, 8).join(', ')}`
                  : '')
              : ''),
        );
      } catch (e: unknown) {
        setError(toUserFacingMessage(e, t, { fallback: t('admin.errGeneric') }));
      } finally {
        setBusy(false);
      }
      return;
    }

    if (isMeters) {
      setBusy(true);
      setError(null);
      try {
        const schema = adapter.registration.setup.xlsx;
        const buf = await file.arrayBuffer();
        const parsed = parseModuleXlsxBuffer(buf, schema, moduleXlsxLabels(schema, t), moduleXlsxHeaderAliases(schema));
        if (!parsed.ok) {
          setError(presentModuleXlsxParseError(parsed.error, t, locale));
          return;
        }
        if (parsed.rows.length === 0) {
          setError(t('admin.is3MetersEmptySheet'));
          return;
        }
        const utility = isWater ? 'water' : 'electricity';
        const ctx = await loadMeterClassifyContext(utility);
        const result =
          utility === 'water'
            ? classifyWaterMeterOpeningRows(parsed.rows, ctx)
            : classifyElectricityMeterOpeningRows(parsed.rows, ctx);
        setPreview(result);
        setPendingMeterPreview(result);

        const { data: batch, error: batchErr } = await supabase.rpc(
          'admin_create_module_import_batch',
          {
            p_module_key: selectedKey,
            p_schema_version: schema.schemaVersion,
            p_source: 'xlsx',
            p_file_name: file.name,
            p_preview: {
              local: result,
              policy: { allowReplace: false },
              opening_reading_row_commit: 'ENABLED',
              note: 'inventory_assign_only_no_submit_reading',
            },
            p_row_count: result.rows.length,
            p_create_count: result.createCount,
            p_update_count: result.updateCount,
            p_skip_count: result.skipCount,
            p_error_count: result.errorCount,
            p_error_report: result.rows
              .filter((r) => r.errors.length)
              .map((r) => ({
                rowNumber: r.rowNumber,
                errors: r.errors,
              })),
          },
        );
        if (batchErr) throw batchErr;
        const id = String((batch as { id?: string })?.id ?? '');
        setBatchId(id || null);
        setPreviewNote(
          t('admin.is1PreviewSaved').replace('{id}', id) +
            ` · ${t('admin.is3OpeningReadingBlocked')}`,
        );
      } catch (e: unknown) {
        setError(toUserFacingMessage(e, t, { fallback: t('admin.errGeneric') }));
      } finally {
        setBusy(false);
      }
      return;
    }

    if (isSupportFee) {
      setBusy(true);
      setError(null);
      try {
        const schema = adapter.registration.setup.xlsx;
        const buf = await file.arrayBuffer();
        const parsed = parseModuleXlsxBuffer(buf, schema, moduleXlsxLabels(schema, t), moduleXlsxHeaderAliases(schema));
        if (!parsed.ok) {
          setError(presentModuleXlsxParseError(parsed.error, t, locale));
          return;
        }
        if (parsed.rows.length === 0) {
          setError(t('admin.is4SupportFeeEmptySheet'));
          return;
        }
        const ctx = await loadSupportFeeClassifyContext();
        const result = classifySupportFeeOpeningRows(parsed.rows, ctx);
        setPreview(result);
        setPendingSfPreview(result);

        const { data: batch, error: batchErr } = await supabase.rpc(
          'admin_create_module_import_batch',
          {
            p_module_key: selectedKey,
            p_schema_version: schema.schemaVersion,
            p_source: 'xlsx',
            p_file_name: file.name,
            p_preview: {
              local: result,
              policy: {
                no_synthetic_payments: true,
                no_early_late_recalc: true,
                conflict_no_overwrite: true,
              },
            },
            p_row_count: result.rows.length,
            p_create_count: result.createCount,
            p_update_count: result.updateCount,
            p_skip_count: result.skipCount,
            p_error_count: result.errorCount,
            p_error_report: result.rows
              .filter((r) => r.errors.length)
              .map((r) => ({
                rowNumber: r.rowNumber,
                preview_class: r.data.preview_class,
                errors: r.errors,
              })),
          },
        );
        if (batchErr) throw batchErr;
        const id = String((batch as { id?: string })?.id ?? '');
        setBatchId(id || null);
        setPreviewNote(
          t('admin.is1PreviewSaved').replace('{id}', id) +
            ` · ${t('admin.is4SupportFeeNoSyntheticPayments')}`,
        );
      } catch (e: unknown) {
        setError(toUserFacingMessage(e, t, { fallback: t('admin.errGeneric') }));
      } finally {
        setBusy(false);
      }
      return;
    }

    if (isCapitalRepair) {
      setBusy(true);
      setError(null);
      try {
        const schema = adapter.registration.setup.xlsx;
        const buf = await file.arrayBuffer();
        const parsed = parseModuleXlsxBuffer(buf, schema, moduleXlsxLabels(schema, t), moduleXlsxHeaderAliases(schema));
        if (!parsed.ok) {
          setError(presentModuleXlsxParseError(parsed.error, t, locale));
          return;
        }
        if (parsed.rows.length === 0) {
          setError(t('admin.is8CapitalRepairEmptySheet'));
          return;
        }
        const ctx = await loadCapitalRepairClassifyContext();
        const result = classifyCapitalRepairOpeningRows(parsed.rows, ctx);
        setPreview(result);
        setPendingCrPreview(result);

        const { data: batch, error: batchErr } = await supabase.rpc(
          'admin_create_module_import_batch',
          {
            p_module_key: selectedKey,
            p_schema_version: schema.schemaVersion,
            p_source: 'xlsx',
            p_file_name: file.name,
            p_preview: {
              local: result,
              policy: {
                no_synthetic_payments: true,
                no_operational_charges: true,
                mandatory_assessment_id: true,
                conflict_no_overwrite: true,
                fund_vs_cash: 'apartment_obligation_not_bank_cash',
              },
            },
            p_row_count: result.rows.length,
            p_create_count: result.createCount,
            p_update_count: result.updateCount,
            p_skip_count: result.skipCount,
            p_error_count: result.errorCount,
            p_error_report: result.rows
              .filter((r) => r.errors.length)
              .map((r) => ({
                rowNumber: r.rowNumber,
                preview_class: r.data.preview_class,
                errors: r.errors,
              })),
          },
        );
        if (batchErr) throw batchErr;
        const id = String((batch as { id?: string })?.id ?? '');
        setBatchId(id || null);
        setPreviewNote(
          t('admin.is1PreviewSaved').replace('{id}', id) +
            ` · ${t('admin.is8CapitalRepairNoSynthetic')}`,
        );
      } catch (e: unknown) {
        setError(toUserFacingMessage(e, t, { fallback: t('admin.errGeneric') }));
      } finally {
        setBusy(false);
      }
      return;
    }

    if (isInternet) {
      setBusy(true);
      setError(null);
      try {
        const schema = adapter.registration.setup.xlsx;
        const buf = await file.arrayBuffer();
        const parsed = parseModuleXlsxBuffer(buf, schema, moduleXlsxLabels(schema, t), moduleXlsxHeaderAliases(schema));
        if (!parsed.ok) {
          setError(presentModuleXlsxParseError(parsed.error, t, locale));
          return;
        }
        if (parsed.rows.length === 0) {
          setError(t('admin.is5InternetEmptySheet'));
          return;
        }
        const ctx = await loadInternetClassifyContext();
        const result = classifyInternetOpeningRows(parsed.rows, ctx);
        setPreview(result);
        setPendingInternetPreview(result);

        const { data: batch, error: batchErr } = await supabase.rpc(
          'admin_create_module_import_batch',
          {
            p_module_key: selectedKey,
            p_schema_version: schema.schemaVersion,
            p_source: 'xlsx',
            p_file_name: file.name,
            p_preview: {
              local: result,
              policy: {
                no_synthetic_payments: true,
                no_request_internet_connect: true,
                no_system_work_orders: true,
                conflict_no_overwrite: true,
              },
            },
            p_row_count: result.rows.length,
            p_create_count: result.createCount,
            p_update_count: result.updateCount,
            p_skip_count: result.skipCount,
            p_error_count: result.errorCount,
            p_error_report: result.rows
              .filter((r) => r.errors.length)
              .map((r) => ({
                rowNumber: r.rowNumber,
                preview_class: r.data.preview_class,
                errors: r.errors,
              })),
          },
        );
        if (batchErr) throw batchErr;
        const id = String((batch as { id?: string })?.id ?? '');
        setBatchId(id || null);
        setPreviewNote(
          t('admin.is1PreviewSaved').replace('{id}', id) +
            ` · ${t('admin.is5InternetNoSyntheticPayments')}`,
        );
      } catch (e: unknown) {
        setError(toUserFacingMessage(e, t, { fallback: t('admin.errGeneric') }));
      } finally {
        setBusy(false);
      }
      return;
    }

    if (isInventory) {
      setBusy(true);
      setError(null);
      try {
        const buf = await file.arrayBuffer();
        const parsed = parseInventoryOpeningXlsxBuffer(buf);
        if (!parsed.ok) {
          setError(presentModuleXlsxParseError(parsed.error, t, locale));
          return;
        }
        if (parsed.rows.length === 0) {
          setError(t('admin.inv6EmptySheet'));
          return;
        }
        const ctx = await loadInventoryClassifyContext();
        const result = classifyInventoryOpeningRows(parsed.rows, ctx);
        setPreview(result);
        setPendingInventoryPreview(result);
        const { data: batch, error: batchErr } = await supabase.rpc(
          'admin_create_module_import_batch',
          {
            p_module_key: selectedKey,
            p_schema_version: INVENTORY_SETUP_SCHEMA_VERSION,
            p_source: 'xlsx',
            p_file_name: file.name,
            p_preview: {
              local: result,
              policy: {
                read_only_preview: true,
                no_finance: true,
                estimated_value_informational: true,
                conflict_no_overwrite: true,
              },
            },
            p_row_count: result.rows.length,
            p_create_count: result.createCount,
            p_update_count: result.updateCount,
            p_skip_count: result.skipCount,
            p_error_count: result.errorCount,
            p_error_report: result.rows
              .filter((r) => r.errors.length)
              .map((r) => ({
                rowNumber: r.rowNumber,
                preview_class: r.data.preview_class,
                errors: r.errors,
              })),
          },
        );
        if (batchErr) throw batchErr;
        const id = String((batch as { id?: string })?.id ?? '');
        setBatchId(id || null);
        setInventoryPath('import');
        setPreviewNote(t('admin.inv6PreviewReady'));
      } catch (e: unknown) {
        setError(toUserFacingMessage(e, t, { fallback: t('admin.errGeneric') }));
      } finally {
        setBusy(false);
      }
      return;
    }

    if (isUkExpenses) {
      setBusy(true);
      setError(null);
      try {
        const schema = adapter.registration.setup.xlsx;
        const buf = await file.arrayBuffer();
        const parsed = parseModuleXlsxBuffer(buf, schema, moduleXlsxLabels(schema, t), moduleXlsxHeaderAliases(schema));
        if (!parsed.ok) {
          setError(presentModuleXlsxParseError(parsed.error, t, locale));
          return;
        }
        if (parsed.rows.length === 0) {
          setError(t('admin.is6aExpensesEmptySheet'));
          return;
        }
        const ctx = await loadUkExpenseClassifyContext();
        const result = classifyUkExpenseOpeningRows(parsed.rows, ctx);
        setPreview(result);
        setPendingUkExpensePreview(result);

        const { data: batch, error: batchErr } = await supabase.rpc(
          'admin_create_module_import_batch',
          {
            p_module_key: selectedKey,
            p_schema_version: schema.schemaVersion,
            p_source: 'xlsx',
            p_file_name: file.name,
            p_preview: {
              local: result,
              policy: {
                no_auto_publish: true,
                no_ap: true,
                no_payment: true,
                opening_excluded_from_budget_execution: true,
                conflict_no_overwrite: true,
              },
            },
            p_row_count: result.rows.length,
            p_create_count: result.createCount,
            p_update_count: result.updateCount,
            p_skip_count: result.skipCount,
            p_error_count: result.errorCount,
            p_error_report: result.rows
              .filter((r) => r.errors.length)
              .map((r) => ({
                rowNumber: r.rowNumber,
                preview_class: r.data.preview_class,
                errors: r.errors,
              })),
          },
        );
        if (batchErr) throw batchErr;
        const id = String((batch as { id?: string })?.id ?? '');
        setBatchId(id || null);
        setPreviewNote(
          t('admin.is1PreviewSaved').replace('{id}', id) + ` · ${t('admin.is6aExpensesNoAp')}`,
        );
      } catch (e: unknown) {
        setError(toUserFacingMessage(e, t, { fallback: t('admin.errGeneric') }));
      } finally {
        setBusy(false);
      }
      return;
    }

    const schema = adapter.registration.setup.xlsx;
    const buf = await file.arrayBuffer();
    const parsed = parseModuleXlsxBuffer(buf, schema, moduleXlsxLabels(schema, t), moduleXlsxHeaderAliases(schema));
    if (!parsed.ok) {
      setError(presentModuleXlsxParseError(parsed.error, t, locale));
      return;
    }
    const result = buildImportPreview(parsed.rows, schema, (row) => {
      const apt = row.apartment_number?.trim();
      if (!apt) return { operation: 'error', errors: ['required:apartment_number'] };
      return { operation: 'create', matchKey: apt.toLowerCase() };
    });
    setPreview(result);

    const { data, error: err } = await supabase.rpc('admin_create_module_import_batch', {
      p_module_key: selectedKey,
      p_schema_version: schema.schemaVersion,
      p_source: 'xlsx',
      p_file_name: file.name,
      p_preview: result,
      p_row_count: result.rows.length,
      p_create_count: result.createCount,
      p_update_count: result.updateCount,
      p_skip_count: result.skipCount,
      p_error_count: result.errorCount,
      p_error_report: result.rows.filter((r) => r.errors.length).map((r) => ({
        rowNumber: r.rowNumber,
        errors: r.errors,
      })),
    });
    if (err) {
      setError(toUserFacingMessage(err, t, { fallback: t('admin.errGeneric') }));
      return;
    }
    setPreviewNote(
      t('admin.is1PreviewSaved').replace('{id}', String((data as { id?: string })?.id ?? '')),
    );
  }

  async function confirmMeterImport(opts?: { retryOnly?: boolean }) {
    if (!isMeters || !pendingMeterPreview || !batchId || !preview) return;
    if (preview.errorCount > 0 && !opts?.retryOnly) {
      setError(t('admin.is3MetersFixErrors'));
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const utility = isWater ? 'water' : 'electricity';
      let workPreview = pendingMeterPreview;
      if (opts?.retryOnly && meterCommitResult) {
        const table = utility === 'water' ? 'water_meters' : 'electricity_meters';
        const { data: meterRows, error: meterErr } = await supabase
          .from(table)
          .select('property_id, meter_number, retired_at');
        if (meterErr) throw meterErr;
        const live = ((meterRows as { property_id: number; meter_number: string; retired_at: string | null }[]) ?? []).map(
          (m) => ({
            propertyId: Number(m.property_id),
            meterNumber: String(m.meter_number ?? ''),
            retiredAt: m.retired_at,
          }),
        );
        const candidates = retryCandidatesFromBatch(meterCommitResult, live);
        const retryNums = new Set(candidates.map((c) => c.rowNumber));
        workPreview = filterPreviewForRetry(pendingMeterPreview, retryNums);
        if (workPreview.rows.length === 0) {
          setPreviewNote(t('admin.is3MetersRetryEmpty'));
          return;
        }
      }

      const rawBatch = await commitMeterInventoryBatch({
        utility,
        preview: workPreview,
        assignWater: async (p) => {
          const { error: rpcErr } = await supabase.rpc('assign_water_meter', {
            p_property_id: p.propertyId,
            p_meter_number: p.meterNumber,
            p_initial_reading: p.initialReading,
            p_installed_at: p.installedAt,
          });
          if (rpcErr) return { ok: false, message: rpcErr.message };
          return { ok: true };
        },
        assignElectricity: async (p) => {
          const { error: rpcErr } = await supabase.rpc('assign_electricity_meter', {
            p_property_id: p.propertyId,
            p_meter_number: p.meterNumber,
            p_initial_day_reading: p.initialDayReading,
            p_initial_night_reading: p.initialNightReading,
            p_installed_at: p.installedAt,
          });
          if (rpcErr) return { ok: false, message: rpcErr.message };
          return { ok: true };
        },
        registerWaterOpening: async (p) => {
          const { error: rpcErr } = await supabase.rpc('register_water_opening_reading', {
            p_property_id: p.propertyId,
            p_current_value: p.initialReading,
            p_reading_date: p.installedAt,
            p_source_reference: `is3_xlsx:${p.meterNumber}`,
            p_idempotency_key: crypto.randomUUID(),
          });
          if (rpcErr) return { ok: false, message: rpcErr.message };
          return { ok: true };
        },
        registerElectricityOpening: async (p) => {
          const { error: rpcErr } = await supabase.rpc('register_electricity_opening_reading', {
            p_property_id: p.propertyId,
            p_day_reading: p.initialDayReading,
            p_night_reading: p.initialNightReading,
            p_reading_date: p.installedAt,
            p_source_reference: `is3_xlsx:${p.meterNumber}`,
            p_idempotency_key: crypto.randomUUID(),
          });
          if (rpcErr) return { ok: false, message: rpcErr.message };
          return { ok: true };
        },
      });

      const table = utility === 'water' ? 'water_meters' : 'electricity_meters';
      const { data: meterRows, error: meterErr } = await supabase
        .from(table)
        .select('property_id, meter_number, retired_at');
      if (meterErr) throw meterErr;
      const live = ((meterRows as { property_id: number; meter_number: string; retired_at: string | null }[]) ?? []).map(
        (m) => ({
          propertyId: Number(m.property_id),
          meterNumber: String(m.meter_number ?? ''),
          retiredAt: m.retired_at,
        }),
      );
      let reconciled = reconcileMeterCommitWithDb(rawBatch, live);
      if (opts?.retryOnly && meterCommitResult) {
        reconciled = mergeMeterCommitBatches(meterCommitResult, reconciled);
        reconciled = reconcileMeterCommitWithDb(reconciled, live);
      }
      setMeterCommitResult(reconciled);

      // Audit trail batch with per-row outcomes (never claim full success when partial).
      const auditPayload = meterCommitAuditPayload(reconciled) as Json;
      const { error: auditErr } = await supabase.rpc('admin_create_module_import_batch', {
        p_module_key: selectedKey,
        p_schema_version: adapter?.registration.setup?.schemaVersion ?? '1.0',
        p_source: 'api',
        p_file_name: `commit_outcomes_${utility}`,
        p_preview: auditPayload,
        p_row_count: reconciled.rows.length,
        p_create_count: reconciled.createdCount,
        p_update_count: 0,
        p_skip_count: reconciled.skippedExistingCount,
        p_error_count: reconciled.failedCount + reconciled.notProcessedCount,
        p_error_report: reconciled.rows
          .filter((r) => r.outcome === 'FAILED' || r.outcome === 'NOT_PROCESSED')
          .map((r) => ({
            rowNumber: r.rowNumber,
            outcome: r.outcome,
            detail: r.detail,
          })) as Json,
      });
      if (auditErr) throw auditErr;

      // Never call submit_* (charges). Commit preview batch only when fully successful.
      if (reconciled.fullySuccessful) {
        const { error: commitErr } = await supabase.rpc('admin_commit_module_import_batch', {
          p_batch_id: batchId,
        });
        if (commitErr) throw commitErr;
        setPreviewNote(t('admin.is3MetersImportCommitted'));
        if (
          selected &&
          canTransitionModuleLifecycle(selected.state as ModuleLifecycleState, 'SETUP_IN_PROGRESS')
        ) {
          await transition('SETUP_IN_PROGRESS', 'meters_inventory_committed');
        } else {
          await load();
        }
      } else {
        setPreviewNote(
          t('admin.is3MetersPartialCommit')
            .replace('{c}', String(reconciled.createdCount))
            .replace('{s}', String(reconciled.skippedExistingCount))
            .replace('{f}', String(reconciled.failedCount))
            .replace('{n}', String(reconciled.notProcessedCount)),
        );
        setError(t('admin.is3MetersPartialNotFullySuccessful'));
      }
    } catch (e: unknown) {
      setError(toUserFacingMessage(e, t, { fallback: t('admin.errGeneric') }));
    } finally {
      setBusy(false);
    }
  }

  async function confirmPropertyBookImport() {
    if (!isPropertyBook || !pendingPayload || !batchId || !preview) return;
    if (preview.errorCount > 0) {
      setError(t('admin.is2PropertyBookFixErrors'));
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const { data, error: rpcErr } = await supabase.rpc('admin_import_property_book', {
        p_objects: pendingPayload.objects,
        p_owners: pendingPayload.owners,
        p_dry_run: false,
        p_allow_create_missing: allowCreateMissing,
        p_allow_overwrite: false,
      });
      if (rpcErr) {
        setError(toUserFacingMessage(rpcErr, t, { fallback: t('admin.is2PropertyBookImportFailed') }));
        return;
      }
      const result = data as { ok?: boolean; errors?: unknown[] };
      if (!result.ok) {
        setError(t('admin.is2PropertyBookImportFailed'));
        return;
      }
      const { error: commitErr } = await supabase.rpc('admin_commit_module_import_batch', {
        p_batch_id: batchId,
      });
      if (commitErr) throw commitErr;
      setPreviewNote(t('admin.is2PropertyBookImportCommitted'));
      setPendingPayload(null);
      if (
        selected &&
        canTransitionModuleLifecycle(selected.state as ModuleLifecycleState, 'SETUP_IN_PROGRESS')
      ) {
        await transition('SETUP_IN_PROGRESS', 'property_book_import_committed');
      } else {
        await load();
      }
    } catch (e: unknown) {
      setError(toUserFacingMessage(e, t, { fallback: t('admin.errGeneric') }));
    } finally {
      setBusy(false);
    }
  }

  async function confirmSupportFeeImport(opts?: { retryOnly?: boolean }) {
    if (!isSupportFee || !pendingSfPreview || !batchId || !preview) return;
    if (preview.errorCount > 0 && !opts?.retryOnly) {
      setError(t('admin.is4SupportFeeFixErrors'));
      return;
    }

    setBusy(true);
    setError(null);
    try {
      let workPreview = pendingSfPreview;
      if (opts?.retryOnly && sfCommitResult) {
        const retryNums = new Set(retryCandidatesFromSfBatch(sfCommitResult));
        workPreview = filterPreviewForSfRetry(pendingSfPreview, [...retryNums]);
        if (workPreview.rows.length === 0) {
          setPreviewNote(t('admin.is4SupportFeeRetryEmpty'));
          return;
        }
      }

      const rawBatch = await commitSupportFeeOpeningBatch({
        preview: workPreview,
        batchId,
        idempotencyKeyForRow: (rowNumber) => {
          // Deterministic UUID v5-like from batch+row via crypto random fallback:
          // use stable string hashed into UUID format for RPC requirement.
          const seed = `${batchId}:${rowNumber}:is4-sf-opening`;
          let h = 0;
          for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
          const hex = (n: number) => n.toString(16).padStart(8, '0');
          return `${hex(h)}-${hex(rowNumber & 0xffff)}-4${hex(h).slice(1, 4)}-a${hex(h).slice(4, 7)}-${hex(h)}${hex(rowNumber)}`.slice(
            0,
            36,
          );
        },
        importRow: async (p) => {
          const { data, error: rpcErr } = await supabase.rpc('import_support_fee_opening_state', {
            p_property_id: p.propertyId,
            p_billing_year: p.billingYear,
            p_obligation_type: p.obligationType,
            p_assessed_amount: p.assessedAmount,
            p_historically_paid_amount: p.historicallyPaidAmount,
            p_remaining_debt: p.remainingDebt,
            p_opening_overpayment: p.openingOverpayment,
            p_transition_date: p.transitionDate,
            p_source_reference: p.sourceReference || null,
            p_notes: p.notes || null,
            p_idempotency_key: p.idempotencyKey,
            p_batch_id: p.batchId,
          });
          if (rpcErr) {
            const outcome = classifySfOpeningErrorMessage(rpcErr.message);
            return { ok: false, outcome, message: rpcErr.message };
          }
          const body = data as {
            applied?: boolean;
            idempotent?: boolean;
            outcome?: string;
            remaining_due?: number;
            synthetic_payments?: boolean;
          };
          if (body.synthetic_payments === true) {
            return { ok: false, outcome: 'FAILED', message: 'synthetic_payments_forbidden' };
          }
          if (body.idempotent || body.outcome === 'SKIPPED_EXISTING') {
            return {
              ok: true,
              outcome: 'SKIPPED_EXISTING',
              remainingDue: Number(body.remaining_due ?? p.remainingDebt),
            };
          }
          return {
            ok: true,
            outcome: 'CREATED',
            remainingDue: Number(body.remaining_due ?? p.remainingDebt),
          };
        },
      });

      const ctx = await loadSupportFeeClassifyContext();
      const reconciled = reconcileSfCommitWithDb(
        rawBatch,
        [...ctx.existingByScope.values()],
      );
      const merged = mergeSfCommitBatches(
        opts?.retryOnly ? sfCommitResult : null,
        reconciled,
      );
      setSfCommitResult(merged);

      const { error: auditErr } = await supabase.rpc('admin_create_module_import_batch', {
        p_module_key: selectedKey!,
        p_schema_version: SUPPORT_FEE_SETUP_SCHEMA_VERSION,
        p_source: 'api',
        p_file_name: `opening-commit-${batchId}`,
        p_preview: sfCommitAuditPayload(merged) as Json,
        p_row_count: merged.rows.length,
        p_create_count: merged.createdCount,
        p_update_count: 0,
        p_skip_count: merged.skippedExistingCount,
        p_error_count: merged.failedCount + merged.notProcessedCount + merged.conflictCount,
        p_error_report: merged.rows
          .filter((r) => r.outcome === 'FAILED' || r.outcome === 'NOT_PROCESSED' || r.outcome === 'CONFLICT')
          .map((r) => ({
            rowNumber: r.rowNumber,
            outcome: r.outcome,
            detail: r.detail,
          })) as Json,
      });
      if (auditErr) throw auditErr;

      if (merged.fullySuccessful) {
        const { error: commitErr } = await supabase.rpc('admin_commit_module_import_batch', {
          p_batch_id: batchId,
        });
        if (commitErr) throw commitErr;
        setPreviewNote(t('admin.is4SupportFeeImportCommitted'));
        if (
          selected &&
          canTransitionModuleLifecycle(selected.state as ModuleLifecycleState, 'SETUP_IN_PROGRESS')
        ) {
          await transition('SETUP_IN_PROGRESS', 'support_fee_opening_committed');
        } else {
          await load();
        }
      } else {
        setPreviewNote(
          t('admin.is4SupportFeePartialCommit')
            .replace('{c}', String(merged.createdCount))
            .replace('{s}', String(merged.skippedExistingCount))
            .replace('{x}', String(merged.conflictCount))
            .replace('{f}', String(merged.failedCount))
            .replace('{n}', String(merged.notProcessedCount)),
        );
        setError(t('admin.is4SupportFeePartialNotFullySuccessful'));
      }
    } catch (e: unknown) {
      setError(toUserFacingMessage(e, t, { fallback: t('admin.errGeneric') }));
    } finally {
      setBusy(false);
    }
  }

  async function confirmCapitalRepairImport(opts?: { retryOnly?: boolean }) {
    if (!isCapitalRepair || !pendingCrPreview || !batchId || !preview) return;
    if (preview.errorCount > 0 && !opts?.retryOnly) {
      setError(t('admin.is8CapitalRepairFixErrors'));
      return;
    }

    setBusy(true);
    setError(null);
    try {
      let workPreview = pendingCrPreview;
      if (opts?.retryOnly && crCommitResult) {
        const retryNums = new Set(retryCandidatesFromCrBatch(crCommitResult));
        workPreview = filterPreviewForCrRetry(pendingCrPreview, [...retryNums]);
        if (workPreview.rows.length === 0) {
          setPreviewNote(t('admin.is8CapitalRepairRetryEmpty'));
          return;
        }
      }

      const rawBatch = await commitCapitalRepairOpeningBatch({
        preview: workPreview,
        batchId,
        idempotencyKeyForRow: (rowNumber) => {
          const seed = `${batchId}:${rowNumber}:is8-cr-opening`;
          let h = 0;
          for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
          const hex = (n: number) => n.toString(16).padStart(8, '0');
          return `${hex(h)}-${hex(rowNumber & 0xffff)}-4${hex(h).slice(1, 4)}-a${hex(h).slice(4, 7)}-${hex(h)}${hex(rowNumber)}`.slice(
            0,
            36,
          );
        },
        importRow: async (p) => {
          const { data, error: rpcErr } = await supabase.rpc('import_capital_repair_opening_state', {
            p_property_id: p.propertyId,
            p_billing_year: p.billingYear,
            p_obligation_type: p.obligationType,
            p_assessed_amount: p.assessedAmount,
            p_historically_paid_amount: p.historicallyPaidAmount,
            p_remaining_debt: p.remainingDebt,
            p_opening_overpayment: p.openingOverpayment,
            p_transition_date: p.transitionDate,
            p_source_reference: p.sourceReference || null,
            p_notes: p.notes || null,
            p_idempotency_key: p.idempotencyKey,
            p_assessment_title: p.assessmentTitle || null,
            p_batch_id: p.batchId,
          });
          if (rpcErr) {
            const outcome = classifyCrOpeningErrorMessage(rpcErr.message);
            return { ok: false, outcome, message: rpcErr.message };
          }
          const body = data as {
            applied?: boolean;
            idempotent?: boolean;
            outcome?: string;
            remaining_debt?: number;
            assessment_id?: string;
            synthetic_payments?: boolean;
            operational_charges?: boolean;
          };
          if (body.synthetic_payments === true || body.operational_charges === true) {
            return { ok: false, outcome: 'FAILED', message: 'synthetic_payment_or_charge_forbidden' };
          }
          if (body.idempotent || body.outcome === 'SKIPPED_EXISTING') {
            return {
              ok: true,
              outcome: 'SKIPPED_EXISTING',
              remainingDebt: Number(body.remaining_debt ?? p.remainingDebt),
              assessmentId: body.assessment_id,
            };
          }
          return {
            ok: true,
            outcome: 'CREATED',
            remainingDebt: Number(body.remaining_debt ?? p.remainingDebt),
            assessmentId: body.assessment_id,
          };
        },
      });

      const ctx = await loadCapitalRepairClassifyContext();
      const imports = [...ctx.openingImportsByScope.entries()].map(([sk, v]) => {
        const [propertyId, billingYear] = sk.split('|');
        return {
          propertyId: Number(propertyId),
          billingYear: Number(billingYear),
          remainingDebt: v.remaining,
          assessmentId: v.assessmentId,
        };
      });
      const reconciled = reconcileCrCommitWithDb(rawBatch, imports);
      const merged = mergeCrCommitBatches(opts?.retryOnly ? crCommitResult : null, reconciled);
      setCrCommitResult(merged);

      const { error: auditErr } = await supabase.rpc('admin_create_module_import_batch', {
        p_module_key: selectedKey!,
        p_schema_version: CAPITAL_REPAIR_SETUP_SCHEMA_VERSION,
        p_source: 'api',
        p_file_name: `opening-commit-${batchId}`,
        p_preview: crCommitAuditPayload(merged) as Json,
        p_row_count: merged.rows.length,
        p_create_count: merged.createdCount,
        p_update_count: 0,
        p_skip_count: merged.skippedExistingCount,
        p_error_count: merged.failedCount + merged.notProcessedCount + merged.conflictCount,
        p_error_report: merged.rows
          .filter((r) => r.outcome === 'FAILED' || r.outcome === 'NOT_PROCESSED' || r.outcome === 'CONFLICT')
          .map((r) => ({
            rowNumber: r.rowNumber,
            outcome: r.outcome,
            detail: r.detail,
          })) as Json,
      });
      if (auditErr) throw auditErr;

      if (merged.fullySuccessful) {
        const { error: commitErr } = await supabase.rpc('admin_commit_module_import_batch', {
          p_batch_id: batchId,
        });
        if (commitErr) throw commitErr;
        setPreviewNote(t('admin.is8CapitalRepairImportCommitted'));
        if (
          selected &&
          canTransitionModuleLifecycle(selected.state as ModuleLifecycleState, 'SETUP_IN_PROGRESS')
        ) {
          await transition('SETUP_IN_PROGRESS', 'capital_repair_opening_committed');
        } else {
          await load();
        }
      } else {
        setPreviewNote(
          t('admin.is8CapitalRepairPartialCommit')
            .replace('{c}', String(merged.createdCount))
            .replace('{s}', String(merged.skippedExistingCount))
            .replace('{x}', String(merged.conflictCount))
            .replace('{f}', String(merged.failedCount))
            .replace('{n}', String(merged.notProcessedCount)),
        );
        setError(t('admin.is8CapitalRepairPartialNotFullySuccessful'));
      }
    } catch (e: unknown) {
      setError(toUserFacingMessage(e, t, { fallback: t('admin.errGeneric') }));
    } finally {
      setBusy(false);
    }
  }

  async function confirmInternetImport(opts?: { retryOnly?: boolean }) {
    if (!isInternet || !pendingInternetPreview || !batchId || !preview) return;
    if (preview.errorCount > 0 && !opts?.retryOnly) {
      setError(t('admin.is5InternetFixErrors'));
      return;
    }

    setBusy(true);
    setError(null);
    try {
      let workPreview = pendingInternetPreview;
      if (opts?.retryOnly && internetCommitResult) {
        const retryNums = new Set(retryCandidatesFromInternetBatch(internetCommitResult));
        workPreview = filterPreviewForInternetRetry(pendingInternetPreview, [...retryNums]);
        if (workPreview.rows.length === 0) {
          setPreviewNote(t('admin.is5InternetRetryEmpty'));
          return;
        }
      }

      const rawBatch = await commitInternetOpeningBatch({
        preview: workPreview,
        batchId,
        idempotencyKeyForRow: (rowNumber) => {
          const seed = `${batchId}:${rowNumber}:is5-internet-opening`;
          let h = 0;
          for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
          const hex = (n: number) => n.toString(16).padStart(8, '0');
          return `${hex(h)}-${hex(rowNumber & 0xffff)}-4${hex(h).slice(1, 4)}-a${hex(h).slice(4, 7)}-${hex(h)}${hex(rowNumber)}`.slice(
            0,
            36,
          );
        },
        importRow: async (p) => {
          const { data, error: rpcErr } = await supabase.rpc('import_internet_opening_state', {
            p_property_id: p.propertyId,
            p_status: p.status,
            p_tariff_key: p.tariffKey,
            p_connection_date: p.connectionDate,
            p_transition_date: p.transitionDate,
            p_paid_through: p.paidThrough,
            p_opening_debt: p.openingDebt,
            p_opening_credit: p.openingCredit,
            p_source_reference: p.sourceReference || null,
            p_notes: p.notes || null,
            p_idempotency_key: p.idempotencyKey,
            p_batch_id: p.batchId,
          });
          if (rpcErr) {
            const outcome = classifyInternetOpeningErrorMessage(rpcErr.message);
            return { ok: false, outcome, message: rpcErr.message };
          }
          const body = data as {
            applied?: boolean;
            idempotent?: boolean;
            outcome?: string;
            next_charge_on?: string | null;
            balance_eur?: number;
            synthetic_payments?: boolean;
            work_orders_created?: boolean;
          };
          if (body.synthetic_payments === true || body.work_orders_created === true) {
            return {
              ok: false,
              outcome: 'FAILED',
              message: 'synthetic_payments_or_work_orders_forbidden',
            };
          }
          if (body.idempotent || body.outcome === 'SKIPPED_EXISTING') {
            return {
              ok: true,
              outcome: 'SKIPPED_EXISTING',
              nextChargeOn: body.next_charge_on ?? p.nextChargeOn,
              balanceEur: Number(body.balance_eur ?? 0),
            };
          }
          return {
            ok: true,
            outcome: 'CREATED',
            nextChargeOn: body.next_charge_on ?? p.nextChargeOn,
            balanceEur: Number(body.balance_eur ?? 0),
          };
        },
      });

      const ctx = await loadInternetClassifyContext();
      const reconciled = reconcileInternetCommitWithDb(
        rawBatch,
        [...ctx.existingByProperty.values()],
      );
      const merged = mergeInternetCommitBatches(
        opts?.retryOnly ? internetCommitResult : null,
        reconciled,
      );
      setInternetCommitResult(merged);

      const { error: auditErr } = await supabase.rpc('admin_create_module_import_batch', {
        p_module_key: selectedKey!,
        p_schema_version: INTERNET_SETUP_SCHEMA_VERSION,
        p_source: 'api',
        p_file_name: `opening-commit-${batchId}`,
        p_preview: internetCommitAuditPayload(merged) as Json,
        p_row_count: merged.rows.length,
        p_create_count: merged.createdCount,
        p_update_count: 0,
        p_skip_count: merged.skippedExistingCount,
        p_error_count: merged.failedCount + merged.notProcessedCount + merged.conflictCount,
        p_error_report: merged.rows
          .filter((r) => r.outcome === 'FAILED' || r.outcome === 'NOT_PROCESSED' || r.outcome === 'CONFLICT')
          .map((r) => ({
            rowNumber: r.rowNumber,
            outcome: r.outcome,
            detail: r.detail,
          })) as Json,
      });
      if (auditErr) throw auditErr;

      if (merged.fullySuccessful) {
        const { error: commitErr } = await supabase.rpc('admin_commit_module_import_batch', {
          p_batch_id: batchId,
        });
        if (commitErr) throw commitErr;
        setPreviewNote(t('admin.is5InternetImportCommitted'));
        if (
          selected &&
          canTransitionModuleLifecycle(selected.state as ModuleLifecycleState, 'SETUP_IN_PROGRESS')
        ) {
          await transition('SETUP_IN_PROGRESS', 'internet_opening_committed');
        } else {
          await load();
        }
      } else {
        setPreviewNote(
          t('admin.is5InternetPartialCommit')
            .replace('{c}', String(merged.createdCount))
            .replace('{s}', String(merged.skippedExistingCount))
            .replace('{x}', String(merged.conflictCount))
            .replace('{f}', String(merged.failedCount))
            .replace('{n}', String(merged.notProcessedCount)),
        );
        setError(t('admin.is5InternetPartialNotFullySuccessful'));
      }
    } catch (e: unknown) {
      setError(toUserFacingMessage(e, t, { fallback: t('admin.errGeneric') }));
    } finally {
      setBusy(false);
    }
  }

  async function confirmInventoryImport(opts?: { retryOnly?: boolean }) {
    if (!isInventory || !pendingInventoryPreview || !batchId || !preview) return;
    if (preview.errorCount > 0 && !opts?.retryOnly) {
      setError(t('admin.inv6FixErrors'));
      return;
    }

    setBusy(true);
    setError(null);
    try {
      let workPreview = pendingInventoryPreview;
      if (opts?.retryOnly && inventoryCommitResult) {
        const retryNums = new Set(retryCandidatesFromInventoryBatch(inventoryCommitResult));
        workPreview = filterPreviewForInventoryRetry(
          pendingInventoryPreview,
          retryNums,
        );
        if (workPreview.rows.length === 0) {
          setPreviewNote(t('admin.inv6RetryEmpty'));
          return;
        }
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabase as any;
      const rawBatch = await commitInventoryOpeningBatch({
        preview: workPreview,
        batchId,
        idempotencyKeyForRow: (rowNumber, kind) =>
          inventoryOpeningIdempotencyKey(batchId, rowNumber, kind),
        fns: {
          ensureCategory: async (a) => {
            const { data, error: rpcErr } = await sb.rpc('inventory_upsert_category', {
              p_code: a.code,
              p_name_bg: a.name,
              p_name_ru: a.name,
              p_name_en: a.name,
            });
            if (!rpcErr && data) {
              return { ok: true as const, categoryId: String((data as { id: string }).id) };
            }
            // Fallback if DB still has insert-only upsert: resolve by code.
            const { data: existing } = await sb
              .from('inventory_categories')
              .select('id')
              .eq('code', a.code.toLowerCase())
              .maybeSingle();
            if (existing?.id) {
              return { ok: true as const, categoryId: String(existing.id) };
            }
            return { ok: false as const, message: rpcErr?.message || 'category_ensure_failed' };
          },
          ensureLocation: async (a) => {
            const { data, error: rpcErr } = await sb.rpc('inventory_upsert_location', {
              p_code: a.code,
              p_name: a.name,
              p_location_kind: 'storage',
            });
            if (!rpcErr && data) {
              return { ok: true as const, locationId: String((data as { id: string }).id) };
            }
            const { data: existing } = await sb
              .from('inventory_locations')
              .select('id')
              .eq('code', a.code.toLowerCase())
              .maybeSingle();
            if (existing?.id) {
              return { ok: true as const, locationId: String(existing.id) };
            }
            return { ok: false as const, message: rpcErr?.message || 'location_ensure_failed' };
          },
          findAssetByNumber: async (inventoryNumber) => {
            const { data } = await sb
              .from('inventory_assets')
              .select('id, operational_status')
              .eq('inventory_number', inventoryNumber)
              .maybeSingle();
            if (!data?.id) return null;
            return {
              assetId: String(data.id),
              operationalStatus: String(data.operational_status ?? ''),
            };
          },
          findStockBySku: async (skuCode) => {
            const { data: item } = await sb
              .from('inventory_stock_items')
              .select('id')
              .eq('sku_code', skuCode)
              .maybeSingle();
            if (!item?.id) return null;
            const { data: moves } = await sb
              .from('inventory_stock_movements')
              .select('id')
              .eq('stock_item_id', item.id)
              .eq('movement_type', 'OPENING')
              .limit(1);
            return {
              stockItemId: String(item.id),
              hasOpeningMovement: Array.isArray(moves) && moves.length > 0,
            };
          },
          createDraftAsset: async (a) => {
            const { data, error: rpcErr } = await sb.rpc('inventory_create_draft_asset', {
              p_inventory_number: a.inventoryNumber,
              p_name: a.name,
              p_ownership_kind: a.ownershipKind,
              p_category_id: a.categoryId,
              p_location_id: a.locationId,
              p_serial_number: a.serialNumber,
              p_condition: a.condition,
              p_estimated_value_eur: a.estimatedValueEur,
              p_description: a.description,
              p_idempotency_key: a.idempotencyKey,
            });
            if (rpcErr) return { ok: false as const, message: rpcErr.message };
            return { ok: true as const, assetId: String((data as { id: string }).id) };
          },
          activateAsset: async (assetId) => {
            const { error: rpcErr } = await sb.rpc('inventory_activate_asset', {
              p_asset_id: assetId,
            });
            if (rpcErr) return { ok: false as const, message: rpcErr.message };
            return { ok: true as const };
          },
          registerStockItem: async (a) => {
            const { data, error: rpcErr } = await sb.rpc('inventory_register_stock_item', {
              p_sku_code: a.skuCode,
              p_name: a.name,
              p_ownership_kind: a.ownershipKind,
              p_unit_code: a.unitCode,
              p_category_id: a.categoryId,
              p_default_location_id: a.defaultLocationId,
              p_estimated_unit_value_eur: a.estimatedUnitValueEur,
              p_description: a.description,
              p_idempotency_key: a.idempotencyKey,
            });
            if (rpcErr) return { ok: false as const, message: rpcErr.message };
            return { ok: true as const, stockItemId: String((data as { id: string }).id) };
          },
          postOpeningMove: async (a) => {
            const { error: rpcErr } = await sb.rpc('inventory_stock_move', {
              p_stock_item_id: a.stockItemId,
              p_movement_type: 'OPENING',
              p_qty: a.qty,
              p_location_id: a.locationId,
              p_reason: a.reason,
              p_idempotency_key: a.idempotencyKey,
            });
            if (rpcErr) return { ok: false as const, message: rpcErr.message };
            return { ok: true as const };
          },
        },
      });

          // Prove outcomes against server before claiming "not saved".
      const presence = await loadInventoryServerPresence();
      const reconciled = reconcileInventoryCommitWithServer(
        rawBatch,
        workPreview.rows,
        presence,
      );

      const merged = mergeInventoryCommitBatches(
        opts?.retryOnly && inventoryCommitResult
          ? inventoryCommitResult
          : {
              rows: [],
              createdCount: 0,
              skippedExistingCount: 0,
              conflictCount: 0,
              failedCount: 0,
              notProcessedCount: 0,
              fullySuccessful: true,
              stoppedEarly: false,
              financeTouched: false,
            },
        reconciled,
      );
      setInventoryCommitResult(merged);

      const { error: auditErr } = await supabase.rpc('admin_create_module_import_batch', {
        p_module_key: selectedKey!,
        p_schema_version: INVENTORY_SETUP_SCHEMA_VERSION,
        p_source: 'api',
        p_file_name: `inventory-opening-commit-${batchId}`,
        p_preview: inventoryCommitAuditPayload(merged) as Json,
        p_row_count: merged.rows.length,
        p_create_count: merged.createdCount,
        p_update_count: 0,
        p_skip_count: merged.skippedExistingCount,
        p_error_count: merged.failedCount + merged.notProcessedCount + merged.conflictCount,
        p_error_report: merged.rows
          .filter(
            (r) =>
              r.outcome === 'FAILED' || r.outcome === 'NOT_PROCESSED' || r.outcome === 'CONFLICT',
          )
          .map((r) => ({
            rowNumber: r.rowNumber,
            outcome: r.outcome,
            detail: r.detail,
          })) as Json,
      });
      if (auditErr) throw auditErr;

      if (merged.fullySuccessful) {
        const { error: commitErr } = await supabase.rpc('admin_commit_module_import_batch', {
          p_batch_id: batchId,
        });
        if (commitErr) throw commitErr;
        const savedCount = inventoryCommitConfirmedSavedCount(merged);
        setInventoryImportCommitted(true);
        setPreviewNote(
          t('admin.inv6ImportSuccessBanner').replace('{n}', String(savedCount)),
        );
        await supabase.rpc('admin_save_module_setup_progress', {
          p_module_key: selectedKey!,
          p_current_step: 'inventory_opening',
          p_draft: {
            import_committed: true,
            empty_inventory_ok: false,
            created_count: savedCount,
            saved_count: savedCount,
            total_rows: merged.rows.length,
            batch_id: batchId,
            last_commit: merged,
            preview: pendingInventoryPreview,
            setup_completion: 'pending',
          },
          p_validation_errors: [],
          p_setup_schema_version: INVENTORY_SETUP_SCHEMA_VERSION,
        });
        // Data is saved. Complete setup via the allowed path only
        // (SETUP_REQUIRED → SETUP_IN_PROGRESS → READY). Never jump.
        const advanced = await advanceModuleLifecycleToReady(
          selectedKey!,
          'inventory_opening_committed',
        );
        if (!advanced.ok) {
          setInventorySetupCompletionPending(true);
          setError(t('admin.inv6DataSavedSetupIncomplete'));
          setModuleStep('data');
          return;
        }
        await supabase.rpc('admin_save_module_setup_progress', {
          p_module_key: selectedKey!,
          p_current_step: 'inventory_opening',
          p_draft: {
            import_committed: true,
            empty_inventory_ok: false,
            created_count: savedCount,
            saved_count: savedCount,
            total_rows: merged.rows.length,
            batch_id: batchId,
            last_commit: merged,
            preview: pendingInventoryPreview,
            setup_completion: 'done',
          },
          p_validation_errors: [],
          p_setup_schema_version: INVENTORY_SETUP_SCHEMA_VERSION,
        });
        setInventorySetupCompletionPending(false);
        // Import already saved — only activation remains (no re-import).
        setModuleStep('activate');
      } else {
        const ui = inventoryCommitUiSummary(merged);
        setPreviewNote(
          [
            t('admin.inv6SavedOfTotal')
              .replace('{saved}', String(ui.savedNow))
              .replace('{total}', String(ui.total)),
            t('admin.inv6AlreadySaved').replace('{n}', String(ui.alreadySaved)),
            t('admin.inv6NotSaved').replace('{n}', String(ui.notSaved)),
          ].join(' · '),
        );
        setError(t('admin.inv6PartialNotFullySuccessful'));
        // Persist partial result so refresh restores from draft + server proof.
        await supabase.rpc('admin_save_module_setup_progress', {
          p_module_key: selectedKey!,
          p_current_step: 'inventory_opening',
          p_draft: {
            import_committed: false,
            empty_inventory_ok: false,
            batch_id: batchId,
            created_count: merged.createdCount,
            last_commit: merged,
            preview: pendingInventoryPreview,
          },
          p_validation_errors: merged.rows
            .filter(
              (r) =>
                r.outcome === 'FAILED' ||
                r.outcome === 'NOT_PROCESSED' ||
                r.outcome === 'CONFLICT',
            )
            .map((r) => `row ${r.rowNumber}: ${r.detail}`),
          p_setup_schema_version: INVENTORY_SETUP_SCHEMA_VERSION,
        });
      }
    } catch (e: unknown) {
      setError(toUserFacingMessage(e, t, { fallback: t('admin.errGeneric') }));
    } finally {
      setBusy(false);
    }
  }

  async function confirmUkExpenseImport(opts?: { retryOnly?: boolean }) {
    if (!isUkExpenses || !pendingUkExpensePreview || !batchId || !preview) return;
    if (preview.errorCount > 0 && !opts?.retryOnly) {
      setError(t('admin.is6aExpensesFixErrors'));
      return;
    }

    setBusy(true);
    setError(null);
    try {
      let workPreview = pendingUkExpensePreview;
      if (opts?.retryOnly && ukExpenseCommitResult) {
        const retryNums = new Set(retryCandidatesFromUkExpenseBatch(ukExpenseCommitResult));
        workPreview = filterPreviewForUkExpenseRetry(pendingUkExpensePreview, [...retryNums]);
        if (workPreview.rows.length === 0) {
          setPreviewNote(t('admin.is6aExpensesRetryEmpty'));
          return;
        }
      }

      const rawBatch = await commitUkExpenseOpeningBatch({
        preview: workPreview,
        batchId,
        idempotencyKeyForRow: (rowNumber) => {
          const seed = `${batchId}:${rowNumber}:is6a-uk-expense-opening`;
          let h = 0;
          for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
          const hex = (n: number) => n.toString(16).padStart(8, '0');
          return `${hex(h)}-${hex(rowNumber & 0xffff)}-4${hex(h).slice(1, 4)}-a${hex(h).slice(4, 7)}-${hex(h)}${hex(rowNumber)}`.slice(
            0,
            36,
          );
        },
        importRow: async (p) => {
          const { data, error: rpcErr } = await supabase.rpc('import_uk_expense_opening_row', {
            p_source_ref: p.sourceRef,
            p_title: p.title,
            p_expense_date: p.expenseDate,
            p_amount: p.amount,
            p_transition_date: p.transitionDate,
            p_category_code: p.categoryCode || null,
            p_source_document: p.sourceDocument || null,
            p_notes: p.notes || null,
            p_idempotency_key: p.idempotencyKey,
            p_batch_id: p.batchId,
          });
          if (rpcErr) {
            const outcome = classifyUkExpenseOpeningErrorMessage(rpcErr.message);
            return { ok: false, outcome, message: rpcErr.message };
          }
          const body = data as {
            applied?: boolean;
            idempotent?: boolean;
            outcome?: string;
            expense_id?: number;
            published?: boolean;
            ap_created?: boolean;
            payment_created?: boolean;
            synthetic_payments?: boolean;
          };
          if (
            body.published === true ||
            body.ap_created === true ||
            body.payment_created === true ||
            body.synthetic_payments === true
          ) {
            return {
              ok: false,
              outcome: 'FAILED',
              message: 'publish_or_ap_or_payment_forbidden',
            };
          }
          if (body.idempotent || body.outcome === 'SKIPPED_EXISTING') {
            return {
              ok: true,
              outcome: 'SKIPPED_EXISTING',
              expenseId: body.expense_id ?? null,
            };
          }
          return {
            ok: true,
            outcome: 'CREATED',
            expenseId: body.expense_id ?? null,
          };
        },
      });

      const ctx = await loadUkExpenseClassifyContext();
      const reconciled = reconcileUkExpenseCommitWithDb(
        rawBatch,
        [...ctx.existingBySourceRef.values()],
      );
      const merged = mergeUkExpenseCommitBatches(
        opts?.retryOnly ? ukExpenseCommitResult : null,
        reconciled,
      );
      setUkExpenseCommitResult(merged);

      const { error: auditErr } = await supabase.rpc('admin_create_module_import_batch', {
        p_module_key: selectedKey!,
        p_schema_version: UK_EXPENSES_SETUP_SCHEMA_VERSION,
        p_source: 'api',
        p_file_name: `opening-commit-${batchId}`,
        p_preview: ukExpenseCommitAuditPayload(merged) as Json,
        p_row_count: merged.rows.length,
        p_create_count: merged.createdCount,
        p_update_count: 0,
        p_skip_count: merged.skippedExistingCount,
        p_error_count: merged.failedCount + merged.notProcessedCount + merged.conflictCount,
        p_error_report: merged.rows
          .filter((r) => r.outcome === 'FAILED' || r.outcome === 'NOT_PROCESSED' || r.outcome === 'CONFLICT')
          .map((r) => ({
            rowNumber: r.rowNumber,
            outcome: r.outcome,
            detail: r.detail,
          })) as Json,
      });
      if (auditErr) throw auditErr;

      if (merged.fullySuccessful) {
        const { error: commitErr } = await supabase.rpc('admin_commit_module_import_batch', {
          p_batch_id: batchId,
        });
        if (commitErr) throw commitErr;
        setPreviewNote(t('admin.is6aExpensesImportCommitted'));
        if (
          selected &&
          canTransitionModuleLifecycle(selected.state as ModuleLifecycleState, 'SETUP_IN_PROGRESS')
        ) {
          await transition('SETUP_IN_PROGRESS', 'uk_expenses_opening_committed');
        } else {
          await load();
        }
      } else {
        setPreviewNote(
          t('admin.is6aExpensesPartialCommit')
            .replace('{c}', String(merged.createdCount))
            .replace('{s}', String(merged.skippedExistingCount))
            .replace('{x}', String(merged.conflictCount))
            .replace('{f}', String(merged.failedCount))
            .replace('{n}', String(merged.notProcessedCount)),
        );
        setError(t('admin.is6aExpensesPartialNotFullySuccessful'));
      }
    } catch (e: unknown) {
      setError(toUserFacingMessage(e, t, { fallback: t('admin.errGeneric') }));
    } finally {
      setBusy(false);
    }
  }

  function downloadTemplate() {
    if (isPropertyBook) {
      downloadPropertyBookOpeningTemplate(locale);
      return;
    }
    if (isWater) {
      downloadWaterOpeningTemplate(locale);
      return;
    }
    if (isElectricity) {
      downloadElectricityOpeningTemplate(locale);
      return;
    }
    if (isSupportFee) {
      downloadSupportFeeOpeningTemplate(locale);
      return;
    }
    if (isInternet) {
      downloadInternetOpeningTemplate(locale);
      return;
    }
    if (isUkExpenses) {
      downloadUkExpensesOpeningTemplate(locale);
      return;
    }
    if (isInventory) {
      downloadInventoryOpeningTemplate(locale);
      return;
    }
    if (isCapitalRepair) {
      downloadCapitalRepairOpeningTemplate(locale);
      return;
    }
    const schema = adapter?.registration.setup?.xlsx;
    if (!schema) return;
    const labels: Record<string, string> = {};
    for (const col of schema.columns) {
      labels[col.labelKey] = t(`admin.${col.labelKey}`);
    }
    downloadModuleXlsxTemplate(schema, labels, `${selectedKey ?? 'module'}-template.xlsx`);
  }

  function stepLabel(step: ModuleWizardStepId): string {
    if (step === 'tariff') return t('admin.moduleSetupStepTariff');
    if (step === 'data') return t('admin.moduleSetupStepData');
    if (step === 'confirm') return t('admin.moduleSetupStepConfirm');
    return t('admin.moduleSetupStepActivate');
  }

  const selectedVisual = selectedKey ? moduleVisual(selectedKey) : null;
  const SelectedIcon = selectedVisual?.icon;

  return (
    <div className="space-y-4">
      {!embedded || selectedKey ? (
        <AdminPageHeader
          title={t('admin.moduleSetupTitle')}
          secondary={selectedKey ? labelFor(selectedKey) : t('admin.moduleSetupLead')}
          action={
            <button
              type="button"
              className={adminBtnSecondaryClass}
              onClick={() => void load()}
              disabled={loading}
            >
              {t('admin.is1Refresh')}
            </button>
          }
        />
      ) : (
        <div className="flex justify-end">
          <button
            type="button"
            className={adminBtnSecondaryClass}
            onClick={() => void load()}
            disabled={loading}
          >
            {t('admin.is1Refresh')}
          </button>
        </div>
      )}

      {error ? (
        <div className="rounded-lg border border-danger/30 bg-danger-bg px-3 py-2 text-sm text-danger">{error}</div>
      ) : null}
      {successNote ? (
        <div className="rounded-lg border border-emerald-300/50 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          {successNote}
        </div>
      ) : null}

      {!selectedKey ? (
        loading ? (
          <p className="text-sm text-muted">{t('admin.loading')}</p>
        ) : (
          <AdminModuleCatalogPanel
            rows={setupCatalog}
            canChange
            savingKey={moduleSavingKey}
            pendingEnableKey={pendingEnableKey}
            filter={catalogFilter}
            onFilterChange={setCatalogFilter}
            onToggle={(key, enabled) => void handleCatalogToggle(key, enabled)}
            onOpenSetup={openModule}
            t={t}
            dateLocale={dateLocale}
          />
        )
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={adminBtnSecondaryClass} onClick={backToCatalog}>
              {t('admin.moduleSetupBackToList')}
            </button>
          </div>

          <AdminCard>
            <div className="mb-4 flex items-start gap-3">
              {SelectedIcon ? (
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-surface-secondary">
                  <SelectedIcon className={`h-5 w-5 ${selectedVisual?.iconClass ?? ''}`} aria-hidden />
                </span>
              ) : null}
              <div className="min-w-0">
                <h3 className="text-base font-semibold text-foreground">{labelFor(selectedKey)}</h3>
                <p className="mt-1 text-sm text-secondary">{t('admin.moduleSetupWizardLead')}</p>
              </div>
            </div>

            <nav className="mb-4 flex flex-wrap gap-2" aria-label={t('admin.moduleSetupStepsNav')}>
              {wizardSteps.map((stepId, idx) => {
                const on = moduleStep === stepId;
                return (
                  <button
                    key={stepId}
                    type="button"
                    className={`rounded-xl px-3 py-2 text-left text-sm font-semibold transition ${
                      on ? 'bg-accent/10 text-accent ring-1 ring-accent/30' : 'bg-surface-secondary text-secondary hover:bg-hover'
                    }`}
                    onClick={() => setModuleStep(stepId)}
                  >
                    <span className="block text-[10px] font-semibold uppercase tracking-wide text-muted">
                      {idx + 1}/{wizardSteps.length}
                    </span>
                    {stepLabel(stepId)}
                  </button>
                );
              })}
            </nav>

            <div className="mb-4 flex flex-wrap gap-2">
              {!(isInventory && moduleStep === 'data') ? (
                <button
                  type="button"
                  className={adminBtnSecondaryClass}
                  disabled={wizardSteps.indexOf(moduleStep) <= 0 || busy}
                  onClick={() => {
                    const i = wizardSteps.indexOf(moduleStep);
                    if (i > 0) setModuleStep(wizardSteps[i - 1]!);
                  }}
                >
                  {t('admin.moduleSetupBack')}
                </button>
              ) : null}
              {wizardSteps.indexOf(moduleStep) < wizardSteps.length - 1 &&
              !(isInventory && moduleStep === 'data') ? (
                <button
                  type="button"
                  className={adminBtnPrimaryClass}
                  disabled={busy}
                  onClick={() => {
                    const i = wizardSteps.indexOf(moduleStep);
                    if (i >= 0 && i < wizardSteps.length - 1) setModuleStep(wizardSteps[i + 1]!);
                  }}
                >
                  {t('admin.moduleSetupNext')}
                </button>
              ) : null}
            </div>

            {!selected ? (
              <p className="text-sm text-muted">{t('admin.loading')}</p>
            ) : (
            <div className="space-y-3 text-sm">
              {moduleStep === 'tariff' ? (
                <div className="space-y-3 rounded-lg border border-border p-3">
                  <p className="font-medium text-foreground">{t('admin.moduleSetupStepTariff')}</p>
                  <p className="text-xs text-secondary">{t('admin.moduleSetupTariffLead')}</p>
                  {selectedTariffReady ? (
                    <ul className="space-y-1 text-xs text-secondary">
                      <li>
                        {t('admin.is7aImportReady')}:{' '}
                        {selectedTariffReady.importReady ? t('admin.is7aReadyYes') : t('admin.is7aReadyNo')}
                      </li>
                      <li>
                        {t('admin.is7aBillingReady')}:{' '}
                        {selectedTariffReady.billingReady ? t('admin.is7aReadyYes') : t('admin.is7aReadyNo')}
                      </li>
                      {selectedTariffReady.missingMessageKey ? (
                        <li className="text-danger">{t(`admin.${selectedTariffReady.missingMessageKey}`)}</li>
                      ) : null}
                      {selectedTariffReady.billingMissingMessageKey ? (
                        <li className="text-secondary">
                          {t(`admin.${selectedTariffReady.billingMissingMessageKey}`)}
                        </li>
                      ) : null}
                    </ul>
                  ) : (
                    <p className="text-xs text-muted">{t('admin.moduleSetupTariffNone')}</p>
                  )}
                  <p className="text-xs text-muted">{t('admin.moduleSetupLateConnectDateGap')}</p>
                </div>
              ) : null}

              {moduleStep === 'confirm' ? (
                <div className="space-y-3 rounded-lg border border-border p-3">
                  <p className="font-medium">{t('admin.moduleSetupStepConfirm')}</p>
                  <p className="text-xs text-secondary">{t('admin.moduleSetupSimpleConfirmLead')}</p>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={draftConfirmed}
                      onChange={(e) => setDraftConfirmed(e.target.checked)}
                    />
                    {t('admin.moduleSetupSimpleConfirm')}
                  </label>
                  <button
                    type="button"
                    className={adminBtnPrimaryClass}
                    disabled={busy || !draftConfirmed}
                    onClick={() => {
                      setModuleStep('activate');
                    }}
                  >
                    {t('admin.moduleSetupNext')}
                  </button>
                </div>
              ) : null}

              {moduleStep === 'activate' ? (
                <div className="space-y-3 rounded-lg border border-border p-3">
                  <p className="font-medium">{t('admin.moduleSetupStepActivate')}</p>
                  {isInventory ? (
                    <div className="space-y-2 text-sm text-secondary">
                      <p>{t('admin.inv6ActivateLead')}</p>
                      {inventoryRestoreLoading ? (
                        <p>{t('admin.inv6CheckingImportResult')}</p>
                      ) : inventorySetupCompletionPending ? (
                        <>
                          <p className="rounded-lg border border-warning/40 bg-warning/5 px-3 py-2 text-foreground">
                            {t('admin.inv6DataSavedSetupIncomplete')}
                          </p>
                          {inventoryImportCommitted ? (
                            <p className="rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-foreground">
                              {t('admin.inv6ImportSuccessBanner').replace(
                                '{n}',
                                String(
                                  inventoryCommitResult
                                    ? inventoryCommitConfirmedSavedCount(inventoryCommitResult)
                                    : '—',
                                ),
                              )}
                            </p>
                          ) : null}
                          <button
                            type="button"
                            className={adminBtnSecondaryClass}
                            disabled={busy}
                            onClick={() => void retryInventorySetupCompletion()}
                          >
                            {t('admin.inv6RetrySetupCompletion')}
                          </button>
                        </>
                      ) : inventoryImportCommitted ? (
                        <p className="rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-foreground">
                          {t('admin.inv6ImportSuccessBanner').replace(
                            '{n}',
                            String(
                              inventoryCommitResult
                                ? inventoryCommitConfirmedSavedCount(inventoryCommitResult)
                                : '—',
                            ),
                          )}
                        </p>
                      ) : verifiedExisting || inventoryPath === 'empty' ? (
                        <p>{t('admin.inv6ActivateEmptySummary')}</p>
                      ) : (
                        <p className="text-danger">{t('admin.inv6SetupIncomplete')}</p>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-secondary">{t('admin.moduleSetupActivateLead')}</p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className={adminBtnPrimaryClass}
                      disabled={
                        busy ||
                        inventoryRestoreLoading ||
                        inventorySetupCompletionPending ||
                        (isInventory &&
                          (!inventoryImportCommitted ||
                            (inventoryCommitResult != null &&
                              !inventoryCommitResult.fullySuccessful)) &&
                          !(verifiedExisting || inventoryPath === 'empty')) ||
                        (isInventory &&
                          selected?.state !== 'READY' &&
                          selected?.state !== 'SUSPENDED' &&
                          selected?.state !== 'ACTIVE') ||
                        (moduleWizardSteps(selectedKey).includes('confirm') &&
                          !draftConfirmed &&
                          !adapter?.registration.requiresInitialSetup &&
                          selected.state === 'DISABLED')
                      }
                      onClick={() => {
                        void activateAndEnable();
                      }}
                    >
                      {busy ? t('admin.moduleSetupActivating') : t('admin.moduleSetupActivate')}
                    </button>
                  </div>
                </div>
              ) : null}

              {moduleStep === 'data' && isInventory ? (
                <AdminInventoryOpeningPanel
                  t={t}
                  busy={busy}
                  path={inventoryPath}
                  onPathChange={(p) => {
                    setInventoryPath(p);
                    setError(null);
                    if (p === 'choose') {
                      setPreview(null);
                      setPendingInventoryPreview(null);
                      setPreviewNote(null);
                      setBatchId(null);
                    }
                  }}
                  preview={pendingInventoryPreview ?? preview}
                  previewNote={previewNote}
                  batchId={batchId}
                  commitResult={inventoryCommitResult}
                  importCommitted={inventoryImportCommitted}
                  onDownloadTemplate={() => undefined}
                  onFile={(file) => void onXlsxSelected(file)}
                  onConfirmImport={() => void confirmInventoryImport()}
                  onRetryImport={() => void confirmInventoryImport({ retryOnly: true })}
                  onConfirmEmpty={() => {
                    void (async () => {
                      setVerifiedExisting(true);
                      setBusy(true);
                      setError(null);
                      try {
                        await supabase.rpc('admin_save_module_setup_progress', {
                          p_module_key: selectedKey!,
                          p_current_step: 'inventory_opening',
                          p_draft: {
                            empty_inventory_ok: true,
                            import_committed: false,
                            setup_completion: 'pending',
                          },
                          p_validation_errors: [],
                          p_setup_schema_version: INVENTORY_SETUP_SCHEMA_VERSION,
                        });
                        const advanced = await advanceModuleLifecycleToReady(
                          selectedKey!,
                          'inventory_empty_confirmed',
                        );
                        if (!advanced.ok) {
                          setInventorySetupCompletionPending(true);
                          setError(t('admin.inv6DataSavedSetupIncomplete'));
                          setModuleStep('data');
                          return;
                        }
                        await supabase.rpc('admin_save_module_setup_progress', {
                          p_module_key: selectedKey!,
                          p_current_step: 'inventory_opening',
                          p_draft: {
                            empty_inventory_ok: true,
                            import_committed: false,
                            setup_completion: 'done',
                          },
                          p_validation_errors: [],
                          p_setup_schema_version: INVENTORY_SETUP_SCHEMA_VERSION,
                        });
                        setInventorySetupCompletionPending(false);
                        setModuleStep('activate');
                      } catch (e: unknown) {
                        setError(toUserFacingMessage(e, t, { fallback: t('admin.errGeneric') }));
                      } finally {
                        setBusy(false);
                      }
                    })();
                  }}
                  setupCompletionPending={inventorySetupCompletionPending}
                  restoreLoading={inventoryRestoreLoading}
                  onRetrySetupCompletion={() => void retryInventorySetupCompletion()}
                  onGoActivate={() => {
                    if (inventorySetupCompletionPending) {
                      setError(t('admin.inv6DataSavedSetupIncomplete'));
                      return;
                    }
                    setModuleStep('activate');
                  }}
                />
              ) : null}

              {moduleStep === 'data' && !isInventory ? (
              <>

              {isPropertyBook ? (
                <p className="text-xs text-secondary">{t('admin.is2PropertyBookSsotNote')}</p>
              ) : null}
              {isMeters ? (
                <p className="text-xs text-secondary">{t('admin.is3MetersSsotNote')}</p>
              ) : null}
              {isSupportFee ? (
                <p className="text-xs text-secondary">{t('admin.is4SupportFeeSsotNote')}</p>
              ) : null}
              {isInternet ? (
                <p className="text-xs text-secondary">{t('admin.is5InternetSsotNote')}</p>
              ) : null}
              {isUkExpenses ? (
                <p className="text-xs text-secondary">{t('admin.is6aExpensesSsotNote')}</p>
              ) : null}
              {isCapitalRepair ? (
                <p className="text-xs text-secondary">{t('admin.is8CapitalRepairSsotNote')}</p>
              ) : null}

              {selectedKey &&
              propertyBookBlocksDependentSetup({
                moduleKey: selectedKey,
                propertyBookReadyOrVerified,
              }) ? (
                <p className="text-xs text-danger">{t('admin.is7aPropertyBookRequired')}</p>
              ) : null}
              {isSupportFee && selectedTariffReady?.importBlockedByMissingTariff ? (
                <p className="text-xs text-secondary">{t('admin.is7aTariffOptionalSupportFeeOpening')}</p>
              ) : null}
              {isInternet && selectedTariffReady?.importBlockedByMissingTariff ? (
                <p className="text-xs text-danger">{t('admin.is7aTariffMissingInternet')}</p>
              ) : null}
              {isCapitalRepair && selectedTariffReady?.billingBlockedByMissingTariff ? (
                <p className="text-xs text-secondary">{t('admin.is7aTariffMissingCapitalBilling')}</p>
              ) : null}
              {isWater ? (
                <p className="text-xs text-secondary">{t('admin.is7aMeterInventoryIndependentWater')}</p>
              ) : null}
              {isElectricity ? (
                <p className="text-xs text-secondary">
                  {t('admin.is7aMeterInventoryIndependentElectricity')}
                </p>
              ) : null}
              {(isWater || isElectricity) && selectedTariffReady?.billingBlockedByMissingTariff ? (
                <p className="text-xs text-secondary">
                  {t(
                    `admin.${
                      selectedTariffReady.billingMissingMessageKey ??
                      'is7aTariffMissingWaterBilling'
                    }`,
                  )}
                </p>
              ) : null}

              {selected.state === 'DISABLED' && adapter?.registration.requiresInitialSetup ? (
                <button
                  type="button"
                  className={adminBtnSecondaryClass}
                  disabled={busy}
                  onClick={() => void transition('SETUP_REQUIRED', 'begin_setup')}
                >
                  {t('admin.moduleSetupBegin')}
                </button>
              ) : null}

              {adapter && setupSupportsManual(adapter.registration.setup) ? (
                <div className="space-y-2 rounded-lg border border-border p-3">
                  <div className="font-medium">{t('admin.is1ManualEntry')}</div>
                  {isPropertyBook ? (
                    <p className="text-xs text-secondary">{t('admin.is2PropertyBookManualHint')}</p>
                  ) : null}
                  {isMeters ? (
                    <p className="text-xs text-secondary">{t('admin.is3MetersManualHint')}</p>
                  ) : null}
                  {isSupportFee ? (
                    <p className="text-xs text-secondary">{t('admin.is4SupportFeeManualHint')}</p>
                  ) : null}
                  {isInternet ? (
                    <p className="text-xs text-secondary">{t('admin.is5InternetManualHint')}</p>
                  ) : null}
                  {isUkExpenses ? (
                    <p className="text-xs text-secondary">{t('admin.is6aExpensesManualHint')}</p>
                  ) : null}
                  {isInventory ? (
                    <p className="text-xs text-secondary">{t('admin.inv6ManualHint')}</p>
                  ) : null}
                  {isCapitalRepair ? (
                    <p className="text-xs text-secondary">{t('admin.is8CapitalRepairManualHint')}</p>
                  ) : null}
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={draftConfirmed}
                      onChange={(e) => setDraftConfirmed(e.target.checked)}
                    />
                    {isPropertyBook
                      ? t('admin.is2PropertyBookManualConfirm')
                      : isWater
                        ? t('admin.is3WaterManualConfirm')
                        : isElectricity
                          ? t('admin.is3ElectricityManualConfirm')
                          : isSupportFee
                            ? t('admin.is4SupportFeeManualConfirm')
                            : isInternet
                              ? t('admin.is5InternetManualConfirm')
                              : isUkExpenses
                                ? t('admin.is6aExpensesManualConfirm')
                                : isInventory
                                  ? t('admin.inv6ManualConfirm')
                                  : isCapitalRepair
                                    ? t('admin.is8CapitalRepairManualConfirm')
                                    : t('admin.is1ManualConfirm')}
                  </label>
                  {isUkExpenses || isCapitalRepair || isInventory ? (
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={skipHistoricalExpenses}
                        onChange={(e) => setSkipHistoricalExpenses(e.target.checked)}
                      />
                      {isCapitalRepair
                        ? t('admin.is8CapitalRepairSkipImport')
                        : isInventory
                          ? t('admin.inv6SkipImport')
                          : t('admin.is6aExpensesSkipImport')}
                    </label>
                  ) : null}
                  {isInventory ? (
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={allowCreateMissing}
                        onChange={(e) => setAllowCreateMissing(e.target.checked)}
                      />
                      {t('admin.inv6StartPhysical')}
                    </label>
                  ) : null}
                  {isPropertyBook ||
                  isMeters ||
                  isSupportFee ||
                  isInternet ||
                  isUkExpenses ||
                  isInventory ||
                  isCapitalRepair ? (
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={verifiedExisting}
                        onChange={(e) => setVerifiedExisting(e.target.checked)}
                      />
                      {isPropertyBook
                        ? t('admin.is2PropertyBookVerifiedExisting')
                        : isSupportFee
                          ? t('admin.is4SupportFeeVerifiedExisting')
                          : isInternet
                            ? t('admin.is5InternetVerifiedExisting')
                            : isUkExpenses
                              ? t('admin.is6aExpensesVerifiedExisting')
                              : isInventory
                                ? t('admin.inv6EmptyOk')
                                : isCapitalRepair
                                  ? t('admin.is8CapitalRepairVerifiedExisting')
                                  : t('admin.is3MetersVerifiedExisting')}
                    </label>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className={adminBtnSecondaryClass} disabled={busy} onClick={() => void saveDraft()}>
                      {t('admin.is1SaveProgress')}
                    </button>
                    <button type="button" className={adminBtnPrimaryClass} disabled={busy} onClick={() => void markReady()}>
                      {t('admin.is1CompleteSetup')}
                    </button>
                  </div>
                </div>
              ) : null}

              {adapter && setupSupportsXlsx(adapter.registration.setup) ? (
                <div className="space-y-2 rounded-lg border border-border p-3">
                  <div className="font-medium">{t('admin.is1XlsxImport')}</div>
                  {isPropertyBook ? (
                    <p className="text-xs text-secondary">{t('admin.is2PropertyBookXlsxHint')}</p>
                  ) : null}
                  {isMeters ? (
                    <p className="text-xs text-secondary">{t('admin.is3MetersXlsxHint')}</p>
                  ) : null}
                  {isSupportFee ? (
                    <p className="text-xs text-secondary">{t('admin.is4SupportFeeXlsxHint')}</p>
                  ) : null}
                  {isInternet ? (
                    <p className="text-xs text-secondary">{t('admin.is5InternetXlsxHint')}</p>
                  ) : null}
                  {isUkExpenses ? (
                    <p className="text-xs text-secondary">{t('admin.is6aExpensesXlsxHint')}</p>
                  ) : null}
                  {isInventory ? (
                    <p className="text-xs text-secondary">{t('admin.inv6XlsxHint')}</p>
                  ) : null}
                  {isCapitalRepair ? (
                    <p className="text-xs text-secondary">{t('admin.is8CapitalRepairXlsxHint')}</p>
                  ) : null}
                  <button type="button" className={adminBtnSecondaryClass} onClick={downloadTemplate}>
                    {t('admin.is1DownloadTemplate')}
                  </button>
                  {isPropertyBook ? (
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={allowCreateMissing}
                        onChange={(e) => {
                          setAllowCreateMissing(e.target.checked);
                          resetImportUi();
                        }}
                      />
                      {t('admin.is2PropertyBookAllowCreate')}
                    </label>
                  ) : null}
                  <AppFilePicker
                    accept=".xlsx,.xls"
                    disabled={busy}
                    resetInputAfterChange
                    hint={t('common.fileHintFormats').replace(
                      '{formats}',
                      formatAcceptHint('.xlsx,.xls'),
                    )}
                    onChange={(picked) => void onXlsxSelected(picked[0] ?? null)}
                  />
                  {previewNote ? <p className="text-xs text-secondary">{previewNote}</p> : null}
                  {preview ? (
                    <>
                      <p className="text-xs text-muted">
                        {t('admin.is1PreviewSummary')
                          .replace('{c}', String(preview.createCount))
                          .replace('{u}', String(preview.updateCount))
                          .replace('{s}', String(preview.skipCount))
                          .replace('{e}', String(preview.errorCount))}
                      </p>
                      {preview.errorCount > 0 ? (
                        <button
                          type="button"
                          className={adminBtnSecondaryClass}
                          onClick={() =>
                            isMeters
                              ? downloadMeterErrorReport(preview)
                              : isSupportFee
                                ? downloadSupportFeeErrorReport(preview)
                                : isInternet
                                  ? downloadInternetErrorReport(preview)
                                  : isUkExpenses
                                    ? downloadUkExpensesErrorReport(preview)
                                    : isInventory
                                      ? downloadInventoryOpeningErrorReport(preview)
                                      : isCapitalRepair
                                        ? downloadCapitalRepairErrorReport(preview)
                                        : downloadPropertyBookErrorReport(preview)
                          }
                        >
                          {t('admin.is2PropertyBookDownloadErrors')}
                        </button>
                      ) : null}
                      {isPropertyBook && pendingPayload && batchId ? (
                        <button
                          type="button"
                          className={adminBtnPrimaryClass}
                          disabled={busy || preview.errorCount > 0}
                          onClick={() => void confirmPropertyBookImport()}
                        >
                          {busy ? t('admin.firstRunImporting') : t('admin.is2PropertyBookConfirmButton')}
                        </button>
                      ) : null}
                      {isMeters && pendingMeterPreview && batchId ? (
                        <button
                          type="button"
                          className={adminBtnPrimaryClass}
                          disabled={busy || preview.errorCount > 0}
                          onClick={() => void confirmMeterImport()}
                        >
                          {busy ? t('admin.firstRunImporting') : t('admin.is3MetersConfirmButton')}
                        </button>
                      ) : null}
                      {isSupportFee && pendingSfPreview && batchId ? (
                        <button
                          type="button"
                          className={adminBtnPrimaryClass}
                          disabled={busy || preview.errorCount > 0}
                          onClick={() => void confirmSupportFeeImport()}
                        >
                          {busy ? t('admin.firstRunImporting') : t('admin.is4SupportFeeConfirmButton')}
                        </button>
                      ) : null}
                      {isInternet && pendingInternetPreview && batchId ? (
                        <button
                          type="button"
                          className={adminBtnPrimaryClass}
                          disabled={busy || preview.errorCount > 0}
                          onClick={() => void confirmInternetImport()}
                        >
                          {busy ? t('admin.firstRunImporting') : t('admin.is5InternetConfirmButton')}
                        </button>
                      ) : null}
                      {isUkExpenses && pendingUkExpensePreview && batchId ? (
                        <button
                          type="button"
                          className={adminBtnPrimaryClass}
                          disabled={busy || preview.errorCount > 0}
                          onClick={() => void confirmUkExpenseImport()}
                        >
                          {busy ? t('admin.firstRunImporting') : t('admin.is6aExpensesConfirmButton')}
                        </button>
                      ) : null}
                      {isInventory && pendingInventoryPreview && batchId ? (
                        <button
                          type="button"
                          className={adminBtnPrimaryClass}
                          disabled={busy || preview.errorCount > 0}
                          onClick={() => void confirmInventoryImport()}
                        >
                          {busy ? t('admin.firstRunImporting') : t('admin.inv6ConfirmButton')}
                        </button>
                      ) : null}
                      {isCapitalRepair && pendingCrPreview && batchId ? (
                        <button
                          type="button"
                          className={adminBtnPrimaryClass}
                          disabled={busy || preview.errorCount > 0}
                          onClick={() => void confirmCapitalRepairImport()}
                        >
                          {busy ? t('admin.firstRunImporting') : t('admin.is8CapitalRepairConfirmButton')}
                        </button>
                      ) : null}
                      {isMeters &&
                      meterCommitResult &&
                      !meterCommitResult.fullySuccessful &&
                      pendingMeterPreview ? (
                        <button
                          type="button"
                          className={adminBtnSecondaryClass}
                          disabled={busy}
                          onClick={() => void confirmMeterImport({ retryOnly: true })}
                        >
                          {t('admin.is3MetersRetryMissing')}
                        </button>
                      ) : null}
                      {isSupportFee &&
                      sfCommitResult &&
                      !sfCommitResult.fullySuccessful &&
                      pendingSfPreview ? (
                        <button
                          type="button"
                          className={adminBtnSecondaryClass}
                          disabled={busy}
                          onClick={() => void confirmSupportFeeImport({ retryOnly: true })}
                        >
                          {t('admin.is4SupportFeeRetryMissing')}
                        </button>
                      ) : null}
                      {isInternet &&
                      internetCommitResult &&
                      !internetCommitResult.fullySuccessful &&
                      pendingInternetPreview ? (
                        <button
                          type="button"
                          className={adminBtnSecondaryClass}
                          disabled={busy}
                          onClick={() => void confirmInternetImport({ retryOnly: true })}
                        >
                          {t('admin.is5InternetRetryMissing')}
                        </button>
                      ) : null}
                      {isUkExpenses &&
                      ukExpenseCommitResult &&
                      !ukExpenseCommitResult.fullySuccessful &&
                      pendingUkExpensePreview ? (
                        <button
                          type="button"
                          className={adminBtnSecondaryClass}
                          disabled={busy}
                          onClick={() => void confirmUkExpenseImport({ retryOnly: true })}
                        >
                          {t('admin.is6aExpensesRetryMissing')}
                        </button>
                      ) : null}
                      {isInventory &&
                      inventoryCommitResult &&
                      !inventoryCommitResult.fullySuccessful &&
                      pendingInventoryPreview ? (
                        <button
                          type="button"
                          className={adminBtnSecondaryClass}
                          disabled={busy}
                          onClick={() => void confirmInventoryImport({ retryOnly: true })}
                        >
                          {t('admin.inv6RetryMissing')}
                        </button>
                      ) : null}
                      {isCapitalRepair &&
                      crCommitResult &&
                      !crCommitResult.fullySuccessful &&
                      pendingCrPreview ? (
                        <button
                          type="button"
                          className={adminBtnSecondaryClass}
                          disabled={busy}
                          onClick={() => void confirmCapitalRepairImport({ retryOnly: true })}
                        >
                          {t('admin.is8CapitalRepairRetryMissing')}
                        </button>
                      ) : null}
                      {meterCommitResult ? (
                        <div className="max-h-48 overflow-auto rounded border border-border text-xs">
                          <table className="w-full">
                            <thead>
                              <tr className={adminTableHeadRowClass}>
                                <th className={adminTableCellClass}>#</th>
                                <th className={adminTableCellClass}>{t('admin.is3ColApartment')}</th>
                                <th className={adminTableCellClass}>{t('admin.is3ColMeterNumber')}</th>
                                <th className={adminTableCellClass}>{t('admin.is3Outcome')}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {meterCommitResult.rows.map((r) => (
                                <tr key={`${r.rowNumber}-${r.meterNumber}`} className={adminTableRowClass}>
                                  <td className={adminTableCellClass}>{r.rowNumber}</td>
                                  <td className={adminTableCellClass}>{r.apartmentNumber}</td>
                                  <td className={adminTableCellClass}>{r.meterNumber}</td>
                                  <td className={adminTableCellClass}>
                                    {presentImportCommitOutcome(r.outcome, t, { committed: true })}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : null}
                      {sfCommitResult ? (
                        <div className="max-h-48 overflow-auto rounded border border-border text-xs">
                          <table className="w-full">
                            <thead>
                              <tr className={adminTableHeadRowClass}>
                                <th className={adminTableCellClass}>#</th>
                                <th className={adminTableCellClass}>{t('admin.is4ColApartment')}</th>
                                <th className={adminTableCellClass}>{t('admin.is4ColBillingYear')}</th>
                                <th className={adminTableCellClass}>{t('admin.is4Outcome')}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {sfCommitResult.rows.map((r) => (
                                <tr key={`${r.rowNumber}-${r.billingYear}`} className={adminTableRowClass}>
                                  <td className={adminTableCellClass}>{r.rowNumber}</td>
                                  <td className={adminTableCellClass}>{r.apartmentNumber}</td>
                                  <td className={adminTableCellClass}>{r.billingYear}</td>
                                  <td className={adminTableCellClass}>
                                    {presentImportCommitOutcome(r.outcome, t, { committed: true })}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : null}
                      {internetCommitResult ? (
                        <div className="max-h-48 overflow-auto rounded border border-border text-xs">
                          <table className="w-full">
                            <thead>
                              <tr className={adminTableHeadRowClass}>
                                <th className={adminTableCellClass}>#</th>
                                <th className={adminTableCellClass}>{t('admin.is5ColApartment')}</th>
                                <th className={adminTableCellClass}>{t('admin.is5ColStatus')}</th>
                                <th className={adminTableCellClass}>{t('admin.is5Outcome')}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {internetCommitResult.rows.map((r) => (
                                <tr key={`${r.rowNumber}-${r.propertyId}`} className={adminTableRowClass}>
                                  <td className={adminTableCellClass}>{r.rowNumber}</td>
                                  <td className={adminTableCellClass}>{r.apartmentNumber}</td>
                                  <td className={adminTableCellClass}>
                                    {r.nextChargeOn ?? '—'}
                                  </td>
                                  <td className={adminTableCellClass}>
                                    {presentImportCommitOutcome(r.outcome, t, { committed: true })}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : null}
                      {ukExpenseCommitResult ? (
                        <div className="max-h-48 overflow-auto rounded border border-border text-xs">
                          <table className="w-full">
                            <thead>
                              <tr className={adminTableHeadRowClass}>
                                <th className={adminTableCellClass}>#</th>
                                <th className={adminTableCellClass}>{t('admin.is6aColSourceRef')}</th>
                                <th className={adminTableCellClass}>{t('admin.is6aOutcome')}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {ukExpenseCommitResult.rows.map((r) => (
                                <tr key={`${r.rowNumber}-${r.sourceRef}`} className={adminTableRowClass}>
                                  <td className={adminTableCellClass}>{r.rowNumber}</td>
                                  <td className={adminTableCellClass}>{r.sourceRef}</td>
                                  <td className={adminTableCellClass}>
                                    {presentImportCommitOutcome(r.outcome, t, { committed: true })}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : null}
                      {crCommitResult ? (
                        <div className="max-h-48 overflow-auto rounded border border-border text-xs">
                          <table className="w-full">
                            <thead>
                              <tr className={adminTableHeadRowClass}>
                                <th className={adminTableCellClass}>#</th>
                                <th className={adminTableCellClass}>{t('admin.is8ColApartment')}</th>
                                <th className={adminTableCellClass}>{t('admin.is8ColBillingYear')}</th>
                                <th className={adminTableCellClass}>{t('admin.is8Outcome')}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {crCommitResult.rows.map((r) => (
                                <tr key={`${r.rowNumber}-${r.billingYear}`} className={adminTableRowClass}>
                                  <td className={adminTableCellClass}>{r.rowNumber}</td>
                                  <td className={adminTableCellClass}>{r.apartmentNumber}</td>
                                  <td className={adminTableCellClass}>{r.billingYear}</td>
                                  <td className={adminTableCellClass}>
                                    {presentImportCommitOutcome(r.outcome, t, { committed: true })}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : null}
                    </>
                  ) : null}
                  <p className="text-xs text-secondary">
                    {isPropertyBook
                      ? t('admin.is2PropertyBookNoOverwrite')
                      : isMeters
                        ? t('admin.is3MetersNoOverwrite')
                        : isSupportFee
                          ? t('admin.is4SupportFeeNoOverwrite')
                          : isInternet
                            ? t('admin.is5InternetNoOverwrite')
                            : isUkExpenses
                              ? t('admin.is6aExpensesNoOverwrite')
                              : isCapitalRepair
                                ? t('admin.is8CapitalRepairNoOverwrite')
                                : t('admin.is1NoAutoCommit')}
                  </p>
                </div>
              ) : null}
              </>
              ) : null}
            </div>
            )}
          </AdminCard>
        </div>
      )}
    </div>
  );
}
