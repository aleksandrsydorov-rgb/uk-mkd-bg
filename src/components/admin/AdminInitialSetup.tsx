'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
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
  ELECTRICITY_MODULE_KEY,
  INTERNET_MODULE_KEY,
  INTERNET_SETUP_SCHEMA_VERSION,
  PROPERTY_BOOK_MODULE_KEY,
  SUPPORT_FEE_MODULE_KEY,
  SUPPORT_FEE_SETUP_SCHEMA_VERSION,
  UK_EXPENSES_SETUP_KEY,
  UK_EXPENSES_SETUP_SCHEMA_VERSION,
  WATER_MODULE_KEY,
  activePropertyIdsFromMeters,
  bootstrapModuleSetupAdapters,
  buildApartmentLookup,
  buildCategoryCodeMap,
  buildExistingInternetSubMap,
  buildExistingSfScopeMap,
  buildExistingUkExpenseOpeningMap,
  buildImportPreview,
  canTransitionModuleLifecycle,
  classifyElectricityMeterOpeningRows,
  classifyInternetOpeningErrorMessage,
  classifyInternetOpeningRows,
  classifyPropertyBookOpeningRows,
  classifySupportFeeOpeningRows,
  classifyUkExpenseOpeningErrorMessage,
  classifyUkExpenseOpeningRows,
  classifyWaterMeterOpeningRows,
  commitInternetOpeningBatch,
  commitSupportFeeOpeningBatch,
  commitUkExpenseOpeningBatch,
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
  downloadWaterOpeningTemplate,
  commitMeterInventoryBatch,
  filterPreviewForInternetRetry,
  filterPreviewForRetry,
  filterPreviewForSfRetry,
  filterPreviewForUkExpenseRetry,
  getModuleAdapter,
  internetCommitAuditPayload,
  listRegisteredModuleAdapters,
  mergeInternetCommitBatches,
  mergeMeterCommitBatches,
  mergeSfCommitBatches,
  mergeUkExpenseCommitBatches,
  meterCommitAuditPayload,
  parseModuleXlsxBuffer,
  previewFromPropertyBookDryRun,
  reconcileInternetCommitWithDb,
  reconcileMeterCommitWithDb,
  reconcileSfCommitWithDb,
  reconcileUkExpenseCommitWithDb,
  retryCandidatesFromBatch,
  retryCandidatesFromInternetBatch,
  retryCandidatesFromSfBatch,
  retryCandidatesFromUkExpenseBatch,
  serialSetFromMeters,
  setupCompleteFromDraft,
  setupSupportsManual,
  setupSupportsXlsx,
  sfCommitAuditPayload,
  ukExpenseCommitAuditPayload,
  classifySfOpeningErrorMessage,
  type ImportPreviewResult,
  type InternetCommitBatchResult,
  type MeterCommitBatchResult,
  type SfCommitBatchResult,
  type UkExpenseCommitBatchResult,
  type ModuleLifecycleState,
} from '@/lib/moduleCore';
import { moduleLabelMessageKey } from '@/lib/modules';
import {
  parsePropertyBookWorkbook,
  type PropertyBookWorkbookPayload,
} from '@/lib/propertyBookAdmin';
import { sofiaTodayIsoDate } from '@/lib/tariffs';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@/lib/database.types';

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
};

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

export function AdminInitialSetup({ supabase, t }: Props) {
  const [rows, setRows] = useState<LifecycleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
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

  useEffect(() => {
    bootstrapModuleSetupAdapters();
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase.rpc('admin_list_module_lifecycle');
    if (err) {
      setError(err.message);
      setRows([]);
    } else {
      setRows((data as LifecycleRow[]) ?? []);
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  const registeredExtra = listRegisteredModuleAdapters().filter(
    (a) => !rows.some((r) => r.module_key === a.registration.moduleKey),
  );

  const displayRows = useMemo(() => {
    const extras = registeredExtra.map((a) => syntheticLifecycleRow(a.registration.moduleKey));
    return [...rows, ...extras];
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
    setUkExpenseCommitResult(null);
  }

  async function loadSupportFeeClassifyContext() {
    const { data: bookRows, error: listErr } = await supabase.rpc('admin_list_property_book', {
      p_limit: 5000,
    });
    if (listErr) throw listErr;
    const apartments = ((bookRows as { property_id?: number; apartment_number?: string | number }[]) ?? [])
      .filter((r) => r.property_id != null)
      .map((r) => ({
        property_id: Number(r.property_id),
        apartment_number: String(r.apartment_number ?? ''),
      }));
    const apartmentsByNumber = buildApartmentLookup(apartments);

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

    return { apartmentsByNumber, existingByScope, openingImportsByScope };
  }

  async function loadInternetClassifyContext() {
    const { data: bookRows, error: listErr } = await supabase.rpc('admin_list_property_book', {
      p_limit: 5000,
    });
    if (listErr) throw listErr;
    const apartments = ((bookRows as { property_id?: number; apartment_number?: string | number }[]) ?? [])
      .filter((r) => r.property_id != null)
      .map((r) => ({
        property_id: Number(r.property_id),
        apartment_number: String(r.apartment_number ?? ''),
      }));
    const apartmentsByNumber = buildApartmentLookup(apartments);

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
    const apartments = ((bookRows as { property_id?: number; apartment_number?: string | number }[]) ?? [])
      .filter((r) => r.property_id != null)
      .map((r) => ({
        property_id: Number(r.property_id),
        apartment_number: String(r.apartment_number ?? ''),
      }));
    const apartmentsByNumber = buildApartmentLookup(apartments);

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
      activePropertyIds: activePropertyIdsFromMeters(meters),
      existingSerials: serialSetFromMeters(meters),
      policy: { allowReplace: false as const },
    };
  }

  async function transition(to: ModuleLifecycleState, reason?: string) {
    if (!selectedKey) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.rpc('admin_transition_module_lifecycle', {
      p_module_key: selectedKey,
      p_to_state: to,
      p_reason: reason ?? null,
    });
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    await load();
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
      setError(err.message);
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
    if (isUkExpenses) {
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
    if (selected?.state === 'SETUP_IN_PROGRESS' || selected?.state === 'SETUP_REQUIRED') {
      await transition('READY', 'setup_complete');
    } else if (selected?.state === 'DISABLED' && !adapter.registration.requiresInitialSetup) {
      await transition('READY', 'no_setup_required');
    } else if (selected?.state === 'DISABLED' && adapter.registration.requiresInitialSetup) {
      await transition('SETUP_REQUIRED', 'begin_setup');
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
        if (payload.owners.length === 0) {
          setError(t('admin.is2PropertyBookEmptyOwners'));
          return;
        }

        const { data: bookRows, error: listErr } = await supabase.rpc('admin_list_property_book', {
          p_limit: 5000,
        });
        if (listErr) throw listErr;
        const existingApts = ((bookRows as { apartment_number?: string | number }[]) ?? []).map(
          (r) => String(r.apartment_number ?? ''),
        );

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

        // Prefer local row-level ops; merge RPC errors into summary note.
        const result: ImportPreviewResult = {
          ...localPreview,
          // If RPC found hard errors beyond local, surface via errorCount bump in note.
        };
        setPreview(result);
        setPendingPayload(payload);

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
        setBatchId(id || null);
        setPreviewNote(
          t('admin.is1PreviewSaved').replace('{id}', id) +
            (rpcPreview.errorCount
              ? ` · ${t('admin.is2PropertyBookRpcErrors').replace('{n}', String(rpcPreview.errorCount))}`
              : ''),
        );
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : t('admin.errGeneric'));
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
        const parsed = parseModuleXlsxBuffer(buf, schema);
        if (!parsed.ok) {
          setError(parsed.error);
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
              opening_reading_row_commit: 'BLOCKED',
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
        setError(e instanceof Error ? e.message : t('admin.errGeneric'));
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
        const parsed = parseModuleXlsxBuffer(buf, schema);
        if (!parsed.ok) {
          setError(parsed.error);
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
        setError(e instanceof Error ? e.message : t('admin.errGeneric'));
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
        const parsed = parseModuleXlsxBuffer(buf, schema);
        if (!parsed.ok) {
          setError(parsed.error);
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
        setError(e instanceof Error ? e.message : t('admin.errGeneric'));
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
        const parsed = parseModuleXlsxBuffer(buf, schema);
        if (!parsed.ok) {
          setError(parsed.error);
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
        setError(e instanceof Error ? e.message : t('admin.errGeneric'));
      } finally {
        setBusy(false);
      }
      return;
    }

    const schema = adapter.registration.setup.xlsx;
    const buf = await file.arrayBuffer();
    const parsed = parseModuleXlsxBuffer(buf, schema);
    if (!parsed.ok) {
      setError(parsed.error);
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
      setError(err.message);
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
    if (!window.confirm(t('admin.is3MetersConfirmImport'))) return;

    setBusy(true);
    setError(null);
    try {
      const utility = isWater ? 'water' : 'electricity';
      let workPreview = pendingMeterPreview;
      if (opts?.retryOnly && meterCommitResult) {
        const ctx = await loadMeterClassifyContext(utility);
        const meters = [...ctx.activePropertyIds].map((propertyId) => ({
          propertyId,
          meterNumber: '',
          retiredAt: null as string | null,
        }));
        // Prefer live meter list for retry filtering.
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
        const candidates = retryCandidatesFromBatch(meterCommitResult, live.length ? live : meters);
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
      setError(e instanceof Error ? e.message : t('admin.errGeneric'));
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
    if (!window.confirm(t('admin.is2PropertyBookConfirmImport'))) return;

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
      if (rpcErr) throw rpcErr;
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
      setError(e instanceof Error ? e.message : t('admin.errGeneric'));
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
    if (!window.confirm(t('admin.is4SupportFeeConfirmImport'))) return;

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
      setError(e instanceof Error ? e.message : t('admin.errGeneric'));
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
    if (!window.confirm(t('admin.is5InternetConfirmImport'))) return;

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
      setError(e instanceof Error ? e.message : t('admin.errGeneric'));
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
    if (!window.confirm(t('admin.is6aExpensesConfirmImport'))) return;

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
      setError(e instanceof Error ? e.message : t('admin.errGeneric'));
    } finally {
      setBusy(false);
    }
  }

  function downloadTemplate() {
    if (isPropertyBook) {
      downloadPropertyBookOpeningTemplate();
      return;
    }
    if (isWater) {
      downloadWaterOpeningTemplate();
      return;
    }
    if (isElectricity) {
      downloadElectricityOpeningTemplate();
      return;
    }
    if (isSupportFee) {
      downloadSupportFeeOpeningTemplate();
      return;
    }
    if (isInternet) {
      downloadInternetOpeningTemplate();
      return;
    }
    if (isUkExpenses) {
      downloadUkExpensesOpeningTemplate();
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

  return (
    <div className="space-y-4">
      <AdminPageHeader
        title={t('admin.is1Title')}
        secondary={t('admin.is1Lead')}
        action={
          <button type="button" className={adminBtnSecondaryClass} onClick={() => void load()} disabled={loading}>
            {t('admin.is1Refresh')}
          </button>
        }
      />

      {error ? (
        <div className="rounded-lg border border-danger/30 bg-danger-bg px-3 py-2 text-sm text-danger">{error}</div>
      ) : null}

      <p className="text-sm text-secondary">{t('admin.is1CompatibilityNote')}</p>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <AdminCard>
          <h3 className="mb-3 text-sm font-semibold text-foreground">{t('admin.is1ModuleList')}</h3>
          {loading ? (
            <p className="text-sm text-muted">{t('admin.loading')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className={adminTableHeadRowClass}>
                    <th className={adminTableCellClass}>{t('admin.is1ColModule')}</th>
                    <th className={adminTableCellClass}>{t('admin.is1ColLifecycle')}</th>
                    <th className={adminTableCellClass}>{t('admin.is1ColUxEnabled')}</th>
                    <th className={adminTableCellClass}>{t('admin.is1ColSetup')}</th>
                  </tr>
                </thead>
                <tbody>
                  {displayRows.map((row) => (
                    <tr
                      key={row.module_key}
                      className={`${adminTableRowClass} cursor-pointer ${
                        selectedKey === row.module_key ? 'bg-accent/5' : ''
                      }`}
                      onClick={() => {
                        setSelectedKey(row.module_key);
                        resetImportUi();
                        setDraftConfirmed(false);
                        setVerifiedExisting(false);
                        setSkipHistoricalExpenses(false);
                        setAllowCreateMissing(false);
                        setError(null);
                      }}
                    >
                      <td className={adminTableCellClass}>{labelFor(row.module_key)}</td>
                      <td className={adminTableCellClass}>
                        <code className="text-xs">{row.state}</code>
                      </td>
                      <td className={adminTableCellClass}>
                        {row.building_enabled ? t('admin.is1Yes') : t('admin.is1No')}
                      </td>
                      <td className={adminTableCellClass}>
                        {getModuleAdapter(row.module_key)?.registration.requiresInitialSetup
                          ? t('admin.is1SetupRequired')
                          : t('admin.is1SetupOptional')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {registeredExtra.length ? (
                <p className="mt-3 text-xs text-muted">
                  {t('admin.is1ExtraAdapters')}:{' '}
                  {registeredExtra.map((a) => a.registration.moduleKey).join(', ')}
                </p>
              ) : null}
            </div>
          )}
        </AdminCard>

        <AdminCard>
          <h3 className="mb-3 text-sm font-semibold text-foreground">{t('admin.is1DetailTitle')}</h3>
          {!selected ? (
            <p className="text-sm text-muted">{t('admin.is1SelectModule')}</p>
          ) : (
            <div className="space-y-3 text-sm">
              <div>
                <div className="font-medium text-foreground">{labelFor(selected.module_key)}</div>
                <div className="text-xs text-muted">
                  <code>{selected.module_key}</code> · {selected.state}
                </div>
              </div>

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

              <div className="flex flex-wrap gap-2">
                {canTransitionModuleLifecycle(selected.state as ModuleLifecycleState, 'SETUP_REQUIRED') ? (
                  <button
                    type="button"
                    className={adminBtnSecondaryClass}
                    disabled={busy}
                    onClick={() => void transition('SETUP_REQUIRED')}
                  >
                    {t('admin.is1ToSetupRequired')}
                  </button>
                ) : null}
                {canTransitionModuleLifecycle(selected.state as ModuleLifecycleState, 'READY') &&
                !adapter?.registration.requiresInitialSetup ? (
                  <button
                    type="button"
                    className={adminBtnSecondaryClass}
                    disabled={busy}
                    onClick={() => void transition('READY', 'no_setup_required')}
                  >
                    {t('admin.is1MarkReady')}
                  </button>
                ) : null}
                {canTransitionModuleLifecycle(selected.state as ModuleLifecycleState, 'ACTIVE') ? (
                  <button
                    type="button"
                    className={adminBtnPrimaryClass}
                    disabled={busy}
                    onClick={() => {
                      if (!window.confirm(t('admin.is1ActivateConfirm'))) return;
                      void transition('ACTIVE', 'admin_confirm_activate');
                    }}
                  >
                    {t('admin.is1Activate')}
                  </button>
                ) : null}
                {canTransitionModuleLifecycle(selected.state as ModuleLifecycleState, 'SUSPENDED') ? (
                  <button
                    type="button"
                    className={adminBtnSecondaryClass}
                    disabled={busy}
                    onClick={() => void transition('SUSPENDED', 'admin_suspend')}
                  >
                    {t('admin.is1Suspend')}
                  </button>
                ) : null}
              </div>

              <p className="text-xs text-secondary">{t('admin.is1NoUxToggleNote')}</p>

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
                                : t('admin.is1ManualConfirm')}
                  </label>
                  {isUkExpenses ? (
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={skipHistoricalExpenses}
                        onChange={(e) => setSkipHistoricalExpenses(e.target.checked)}
                      />
                      {t('admin.is6aExpensesSkipImport')}
                    </label>
                  ) : null}
                  {isPropertyBook || isMeters || isSupportFee || isInternet || isUkExpenses ? (
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
                  <input
                    className={adminFieldClass}
                    type="file"
                    accept=".xlsx,.xls"
                    disabled={busy}
                    onChange={(e) => void onXlsxSelected(e.target.files?.[0] ?? null)}
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
                          {t('admin.is2PropertyBookConfirmButton')}
                        </button>
                      ) : null}
                      {isMeters && pendingMeterPreview && batchId ? (
                        <button
                          type="button"
                          className={adminBtnPrimaryClass}
                          disabled={busy || preview.errorCount > 0}
                          onClick={() => void confirmMeterImport()}
                        >
                          {t('admin.is3MetersConfirmButton')}
                        </button>
                      ) : null}
                      {isSupportFee && pendingSfPreview && batchId ? (
                        <button
                          type="button"
                          className={adminBtnPrimaryClass}
                          disabled={busy || preview.errorCount > 0}
                          onClick={() => void confirmSupportFeeImport()}
                        >
                          {t('admin.is4SupportFeeConfirmButton')}
                        </button>
                      ) : null}
                      {isInternet && pendingInternetPreview && batchId ? (
                        <button
                          type="button"
                          className={adminBtnPrimaryClass}
                          disabled={busy || preview.errorCount > 0}
                          onClick={() => void confirmInternetImport()}
                        >
                          {t('admin.is5InternetConfirmButton')}
                        </button>
                      ) : null}
                      {isUkExpenses && pendingUkExpensePreview && batchId ? (
                        <button
                          type="button"
                          className={adminBtnPrimaryClass}
                          disabled={busy || preview.errorCount > 0}
                          onClick={() => void confirmUkExpenseImport()}
                        >
                          {t('admin.is6aExpensesConfirmButton')}
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
                                    <code>{r.outcome}</code>
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
                                    <code>{r.outcome}</code>
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
                                    <code>{r.nextChargeOn ?? '—'}</code>
                                  </td>
                                  <td className={adminTableCellClass}>
                                    <code>{r.outcome}</code>
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
                                    <code>{r.outcome}</code>
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
                              : t('admin.is1NoAutoCommit')}
                  </p>
                </div>
              ) : null}
            </div>
          )}
        </AdminCard>
      </div>
    </div>
  );
}
