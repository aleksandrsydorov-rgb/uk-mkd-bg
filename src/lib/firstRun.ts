/**
 * R1-RC8 — Mandatory first-run wizard helpers (gate, stage resume, validation).
 * Pure helpers + thin Supabase RPC wrappers. Browser-safe (no service-role).
 *
 * Gate source of truth is admin_get_first_run_state().gate_required — never properties count.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { isValidIban } from '@/lib/iban';
import {
  normalizeInternetOpeningRow,
  resolveMeterOpeningBalance,
} from '@/lib/moduleCore';

/** Section id reserved for the forced wizard (not part of the normal admin nav). */
export const FIRST_RUN_SECTION = 'first_run';
export const FIRST_RUN_WIZARD_PATH = `/admin?section=${FIRST_RUN_SECTION}`;
export const ADMIN_HOME_PATH = '/admin';

export const FIRST_RUN_STAGES = [
  'welcome',
  'modules_select',
  'complex_card',
  'property_book_objects',
  'property_book_owners',
  /** @deprecated Kept for resume of older in-progress installs; hidden from new routes. */
  'property_book',
  'meters_select',
  'meters_water',
  'meters_electricity',
  'support_fee_opening',
  'capital_repair_opening',
  'internet_opening',
  'tariffs',
  'budget',
  'uk_expenses_opening',
  'complete',
] as const;
export type FirstRunStageKey = (typeof FIRST_RUN_STAGES)[number];

/** Tariff Core keys required before first-run tariffs stage can complete. */
export type FirstRunTariffKey = 'water' | 'electricity' | 'internet' | 'support_fee' | 'capital_repair';

export type FirstRunStatus = 'pending' | 'in_progress' | 'complete';
export type FirstRunMeterUtility = 'water' | 'electricity';

export type FirstRunBankAccount = {
  id?: string;
  purpose: string;
  account_holder: string;
  bank_name: string;
  iban: string;
  bic_swift: string;
  currency: string;
  is_primary: boolean;
};

export type FirstRunComplex = {
  display_name: string;
  complex_name: string;
  address: string;
  address_country: string;
  address_city: string;
  address_postal_code: string;
  address_street: string;
  address_building_number: string;
  apartment_count: number | null;
  contact_phone: string;
  contact_email: string;
  mgmt_legal_name: string;
  mgmt_legal_form: string;
  mgmt_registration_country: string;
  mgmt_registration_number: string;
  mgmt_vat_registered: boolean;
  mgmt_vat_number: string;
  mgmt_registered_address: string;
  mgmt_correspondence_address: string;
  mgmt_representative_name: string;
  mgmt_representative_title: string;
  mgmt_phone: string;
  mgmt_email: string;
  bank_accounts: FirstRunBankAccount[];
};

export type FirstRunStageRow = {
  stage_key: string;
  sort_order: number;
  required: boolean;
  module_key: string | null;
  label_i18n_key: string;
  status: string;
  draft: Record<string, unknown>;
  completed_at: string | null;
};

export type FirstRunState = {
  ok: boolean;
  code?: string;
  installation_id: string | null;
  first_run_status: FirstRunStatus;
  first_run_stage: FirstRunStageKey;
  gate_required: boolean;
  complex: FirstRunComplex;
  draft: Record<string, unknown>;
  stages: FirstRunStageRow[];
  completed_at: string | null;
};

export type FirstRunComplexForm = {
  display_name: string;
  address_country: string;
  address_city: string;
  address_postal_code: string;
  address_street: string;
  address_building_number: string;
  apartment_count: string;
  contact_phone: string;
  contact_email: string;
  mgmt_legal_name: string;
  mgmt_legal_form: string;
  mgmt_registration_country: string;
  mgmt_registration_number: string;
  mgmt_vat_registered: boolean;
  mgmt_vat_number: string;
  mgmt_registered_address: string;
  mgmt_correspondence_address: string;
  mgmt_representative_name: string;
  mgmt_representative_title: string;
  mgmt_phone: string;
  mgmt_email: string;
  bank_accounts: FirstRunBankAccount[];
};

export function emptyBankAccount(primary = false): FirstRunBankAccount {
  return {
    purpose: '',
    account_holder: '',
    bank_name: '',
    iban: '',
    bic_swift: '',
    currency: 'EUR',
    is_primary: primary,
  };
}

export function composeComplexAddressLine(form: Pick<
  FirstRunComplexForm,
  'address_street' | 'address_building_number' | 'address_postal_code' | 'address_city' | 'address_country'
>): string {
  const line1 = [form.address_street, form.address_building_number].map((s) => s.trim()).filter(Boolean).join(' ');
  const line2 = [form.address_postal_code, form.address_city].map((s) => s.trim()).filter(Boolean).join(' ');
  return [line1, line2, form.address_country.trim()].filter(Boolean).join(', ');
}

/** Normalized import error row for UI (Book / meters RPC errors). */
export type FirstRunErrorRow = {
  sheet: string;
  row: string;
  field: string;
  /** Stable machine code — present via presentFirstRunErrorRow before UI. */
  reason: string;
  apartment: string;
  severity: 'error' | 'warning';
  /** Optional RPC / client enrichment (sections, row lists, invalid value). */
  meta?: {
    candidateSections?: string[];
    sourceRows?: number[];
    sectionCode?: string;
    blockCode?: string;
    value?: string;
    declared?: number | string;
    actual?: number | string;
    objectsValue?: string;
    ownersValue?: string;
    billingYear?: string;
    savedNet?: string;
    newNet?: string;
  };
};

type RpcResult = { data: unknown; error: { message: string; details?: string } | null };
type UntypedRpcClient = {
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<RpcResult>;
};

/** RPCs added after database.types.ts generation — call through untyped surface. */
function untypedRpc(supabase: SupabaseClient<Database>): UntypedRpcClient {
  return supabase as unknown as UntypedRpcClient;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function str(v: unknown): string {
  return v == null ? '' : String(v);
}

export function normalizeFirstRunStage(raw: unknown): FirstRunStageKey {
  const v = String(raw ?? '').trim();
  // Legacy single book stage → apartments step (owners follow after objects are saved).
  if (v === 'property_book') return 'property_book_objects';
  return (FIRST_RUN_STAGES as readonly string[]).includes(v) ? (v as FirstRunStageKey) : 'welcome';
}

function normalizeStatus(raw: unknown): FirstRunStatus {
  const v = String(raw ?? '').trim();
  return v === 'complete' || v === 'in_progress' ? v : 'pending';
}

/** Parse admin_get_first_run_state jsonb → typed state (null if not an object). */
export function parseFirstRunState(data: unknown): FirstRunState | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const o = data as Record<string, unknown>;
  const complexRaw = asRecord(o.complex);
  const countRaw = complexRaw.apartment_count;
  const count = countRaw == null || countRaw === '' ? null : Number(countRaw);
  const banksRaw = Array.isArray(complexRaw.bank_accounts) ? complexRaw.bank_accounts : [];
  const bank_accounts: FirstRunBankAccount[] = banksRaw.map((item) => {
    const b = asRecord(item);
    return {
      id: b.id == null ? undefined : str(b.id),
      purpose: str(b.purpose),
      account_holder: str(b.account_holder),
      bank_name: str(b.bank_name),
      iban: str(b.iban),
      bic_swift: str(b.bic_swift),
      currency: str(b.currency) || 'EUR',
      is_primary: b.is_primary === true,
    };
  });
  const status = normalizeStatus(o.first_run_status);
  const stages = Array.isArray(o.stages)
    ? (o.stages as unknown[]).map((s) => {
        const r = asRecord(s);
        return {
          stage_key: str(r.stage_key),
          sort_order: Number(r.sort_order ?? 0),
          required: r.required !== false,
          module_key: r.module_key == null ? null : str(r.module_key),
          label_i18n_key: str(r.label_i18n_key),
          status: str(r.status || 'pending'),
          draft: asRecord(r.draft),
          completed_at: r.completed_at == null ? null : str(r.completed_at),
        } satisfies FirstRunStageRow;
      })
    : [];
  return {
    ok: o.ok !== false,
    code: o.code == null ? undefined : str(o.code),
    installation_id: o.installation_id == null ? null : str(o.installation_id),
    first_run_status: status,
    first_run_stage: normalizeFirstRunStage(o.first_run_stage),
    gate_required:
      typeof o.gate_required === 'boolean' ? o.gate_required : status !== 'complete',
    complex: {
      display_name: str(complexRaw.display_name),
      complex_name: str(complexRaw.complex_name),
      address: str(complexRaw.address),
      address_country: str(complexRaw.address_country),
      address_city: str(complexRaw.address_city),
      address_postal_code: str(complexRaw.address_postal_code),
      address_street: str(complexRaw.address_street),
      address_building_number: str(complexRaw.address_building_number),
      apartment_count: count != null && Number.isFinite(count) ? count : null,
      contact_phone: str(complexRaw.contact_phone),
      contact_email: str(complexRaw.contact_email),
      mgmt_legal_name: str(complexRaw.mgmt_legal_name),
      mgmt_legal_form: str(complexRaw.mgmt_legal_form),
      mgmt_registration_country: str(complexRaw.mgmt_registration_country),
      mgmt_registration_number: str(complexRaw.mgmt_registration_number),
      mgmt_vat_registered: complexRaw.mgmt_vat_registered === true,
      mgmt_vat_number: str(complexRaw.mgmt_vat_number),
      mgmt_registered_address: str(complexRaw.mgmt_registered_address),
      mgmt_correspondence_address: str(complexRaw.mgmt_correspondence_address),
      mgmt_representative_name: str(complexRaw.mgmt_representative_name),
      mgmt_representative_title: str(complexRaw.mgmt_representative_title),
      mgmt_phone: str(complexRaw.mgmt_phone),
      mgmt_email: str(complexRaw.mgmt_email),
      bank_accounts,
    },
    draft: asRecord(o.draft),
    stages,
    completed_at: o.completed_at == null ? null : str(o.completed_at),
  };
}

/** True when the server explicitly requires the wizard. */
export function isFirstRunGateRequired(state: FirstRunState | null | undefined): boolean {
  return state != null && state.gate_required === true;
}

export type FirstRunFetchResult =
  | { ok: true; state: FirstRunState }
  | { ok: false; error: string };

/**
 * Fetch first-run gate state. Failures are explicit — callers must NOT open admin.
 */
export async function fetchFirstRunState(
  supabase: SupabaseClient<Database>,
): Promise<FirstRunFetchResult> {
  try {
    const { data, error } = await untypedRpc(supabase).rpc('admin_get_first_run_state');
    if (error) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[firstRun] admin_get_first_run_state', error.message);
      }
      return { ok: false, error: 'FIRST_RUN_STATE_UNAVAILABLE' };
    }
    const state = parseFirstRunState(data);
    if (!state) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[firstRun] admin_get_first_run_state invalid response');
      }
      return { ok: false, error: 'FIRST_RUN_STATE_INVALID' };
    }
    return { ok: true, state };
  } catch (e: unknown) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[firstRun] admin_get_first_run_state', e);
    }
    return { ok: false, error: 'FIRST_RUN_STATE_UNAVAILABLE' };
  }
}

/** Throws on RPC error (UI shows message). Returns refreshed state. */
export async function saveFirstRunProgress(
  supabase: SupabaseClient<Database>,
  args: { stage: FirstRunStageKey; draft?: Record<string, unknown>; complex?: Record<string, unknown> | null },
): Promise<FirstRunState | null> {
  const { data, error } = await untypedRpc(supabase).rpc('admin_save_first_run_progress', {
    p_stage: args.stage,
    p_draft: args.draft ?? {},
    p_complex: args.complex ?? null,
  });
  if (error) throw new Error(error.message);
  return parseFirstRunState(data);
}

export async function completeFirstRunStage(
  supabase: SupabaseClient<Database>,
  args: { stage: FirstRunStageKey; nextStage?: FirstRunStageKey | null; draft?: Record<string, unknown> },
): Promise<FirstRunState | null> {
  const { data, error } = await untypedRpc(supabase).rpc('admin_complete_first_run_stage', {
    p_stage: args.stage,
    p_next_stage: args.nextStage ?? null,
    p_draft: args.draft ?? {},
  });
  if (error) throw new Error(error.message);
  return parseFirstRunState(data);
}

/** Dry-run / commit for multi-meter opening (admin_import_*_meters_opening). */
export async function importMetersOpening(
  supabase: SupabaseClient<Database>,
  utility: FirstRunMeterUtility,
  rows: Record<string, string>[],
  dryRun: boolean,
): Promise<{ data: unknown; error: { message: string; details?: string } | null }> {
  const fn =
    utility === 'water' ? 'admin_import_water_meters_opening' : 'admin_import_electricity_meters_opening';
  // Resolve signed amounts / localized kinds to canonical zero|debt|overpayment for RPC.
  const normalized = rows.map((row) => {
    const next = { ...row };
    const resolved = resolveMeterOpeningBalance(row);
    if (resolved.errors.length) {
      // Leave raw values; SQL / client preview already surface the same codes.
      return next;
    }
    if (resolved.kind == null) {
      next.opening_balance_kind = '';
      next.opening_balance_eur = '';
      return next;
    }
    next.opening_balance_kind = resolved.kind;
    next.opening_balance_eur = resolved.kind === 'zero' ? '0' : String(resolved.amountAbs);
    return next;
  });
  return untypedRpc(supabase).rpc(fn, { p_rows: normalized, p_dry_run: dryRun });
}

/** Dry-run / atomic commit for Support Fee opening inventarisation. */
export async function importSupportFeeOpening(
  supabase: SupabaseClient<Database>,
  rows: Record<string, string>[],
  dryRun: boolean,
  batchId?: string | null,
): Promise<{ data: unknown; error: { message: string; details?: string } | null }> {
  return untypedRpc(supabase).rpc('admin_import_support_fee_opening', {
    p_rows: rows,
    p_dry_run: dryRun,
    p_batch_id: batchId ?? null,
  });
}

/** Dry-run / atomic commit for Internet opening inventarisation (subscriptions + paid periods + balances). */
export async function importInternetOpening(
  supabase: SupabaseClient<Database>,
  rows: Record<string, string>[],
  dryRun: boolean,
  opts?: { confirmCorrections?: boolean; batchId?: string | null },
): Promise<{ data: unknown; error: { message: string; details?: string } | null }> {
  // Templates accept RU/BG labels (активен/неактивен); RPC expects active|inactive.
  const normalized = rows.map((row) => normalizeInternetOpeningRow(row));
  return untypedRpc(supabase).rpc('admin_import_internet_opening', {
    p_rows: normalized,
    p_dry_run: dryRun,
    p_confirm_corrections: opts?.confirmCorrections === true,
    p_batch_id: opts?.batchId ?? null,
  });
}

/** Dry-run / atomic commit for Capital Repair apartment opening inventarisation. */
export async function importCapitalRepairOpening(
  supabase: SupabaseClient<Database>,
  rows: Record<string, string>[],
  dryRun: boolean,
  batchId?: string | null,
): Promise<{ data: unknown; error: { message: string; details?: string } | null }> {
  return untypedRpc(supabase).rpc('admin_import_capital_repair_opening', {
    p_rows: rows,
    p_dry_run: dryRun,
    p_batch_id: batchId ?? null,
  });
}

/** Dry-run / confirm factual CR fund bank/cash balance (not derived from apt debts). */
export async function setCapitalRepairFundCashOpening(
  supabase: SupabaseClient<Database>,
  args: {
    balanceEur: number;
    asOfDate: string;
    sourceReference: string;
    notes?: string | null;
    dryRun: boolean;
    idempotencyKey?: string | null;
  },
): Promise<{ data: unknown; error: { message: string; details?: string } | null }> {
  return untypedRpc(supabase).rpc('admin_set_capital_repair_fund_cash_opening', {
    p_balance_eur: args.balanceEur,
    p_as_of_date: args.asOfDate,
    p_source_reference: args.sourceReference,
    p_notes: args.notes ?? null,
    p_dry_run: args.dryRun,
    p_idempotency_key: args.idempotencyKey ?? null,
  });
}

function firstRunStageRowDone(
  rows: { stage_key: string; status: string }[] | undefined,
  key: FirstRunStageKey,
): boolean {
  return (
    rows?.some(
      (row) =>
        row.stage_key === key && (row.status === 'complete' || row.status === 'skipped'),
    ) ?? false
  );
}

/**
 * Where the wizard resumes after load/re-login.
 * Complete ⇒ 'complete' stage (done screen).
 * If the server pointer jumped to tariffs/budget before internet opening finished,
 * resume at internet_opening so reload/login cannot skip the installed module.
 */
export function resolveFirstRunResumeStage(state: FirstRunState | null | undefined): FirstRunStageKey {
  if (!state) return 'welcome';
  if (state.first_run_status === 'complete') return 'complete';
  const choice = parseModuleChoice(state.draft);
  let stage = state.first_run_stage;
  if (
    choice.internet &&
    !firstRunStageRowDone(state.stages, 'internet_opening') &&
    (stage === 'tariffs' || stage === 'budget' || stage === 'uk_expenses_opening' || stage === 'complete')
  ) {
    if (firstRunStageRowDone(state.stages, 'capital_repair_opening')) {
      stage = 'internet_opening';
    }
  }
  return stage;
}

/** Sidebar/nav collapses objects+owners into one “Property Book” step. */
export function isPropertyBookInternalStage(stage: FirstRunStageKey | string): boolean {
  return (
    stage === 'property_book' ||
    stage === 'property_book_objects' ||
    stage === 'property_book_owners'
  );
}

/** Map internal book stages to the single sidebar key. */
export function firstRunNavStage(stage: FirstRunStageKey): FirstRunStageKey {
  return isPropertyBookInternalStage(stage) ? 'property_book' : stage;
}

/** Property Book nav item is complete only when both internal stages (or legacy) are done. */
export function propertyBookNavComplete(
  rows: { stage_key: string; status: string }[] | undefined,
): boolean {
  const done = (key: string) =>
    rows?.some((row) => row.stage_key === key && row.status === 'complete') ?? false;
  if (done('property_book')) return true;
  return done('property_book_objects') && done('property_book_owners');
}

/** Wizard steps for the saved choice. Optional stages stay hidden until selected. */
export function visibleFirstRunStages(
  selection: { water: boolean; electricity: boolean; budget?: boolean; internet?: boolean } | null,
): FirstRunStageKey[] {
  return FIRST_RUN_STAGES.filter((s) => {
    if (s === 'meters_select') return false;
    // One sidebar item for the book; objects/owners are internal substages.
    if (s === 'property_book_objects' || s === 'property_book_owners') return false;
    if (s === 'meters_water') return selection?.water === true;
    if (s === 'meters_electricity') return selection?.electricity === true;
    if (s === 'internet_opening') return selection?.internet === true;
    return true;
  });
}

/**
 * Previous step on the visible wizard route (not browser history).
 * Inside Property Book, Back moves owners → apartments, then apartments → complex card.
 * Legacy `meters_select` is not listed in the sidebar — Back returns to the property book.
 */
export function previousVisibleStage(
  stages: FirstRunStageKey[],
  current: FirstRunStageKey,
): FirstRunStageKey | null {
  if (current === 'meters_select') return 'property_book_owners';
  if (current === 'property_book_owners') return 'property_book_objects';
  if (current === 'property_book_objects' || current === 'property_book') return 'complex_card';
  const navCurrent = firstRunNavStage(current);
  const index = stages.indexOf(navCurrent);
  if (index <= 0) return null;
  const prev = stages[index - 1] ?? null;
  // Leaving a later stage “Back” into the book lands on the unfinished substage.
  if (prev === 'property_book') {
    return 'property_book_owners';
  }
  return prev;
}

// ---------------------------------------------------------------------------
// Meters selection (optional; zero types is valid)
// ---------------------------------------------------------------------------

export type MetersSelection = { water: boolean; electricity: boolean };

export function parseMetersSelected(draft: unknown): MetersSelection {
  const raw = asRecord(draft).meters_selected;
  const list = Array.isArray(raw) ? raw.map((x) => String(x).trim().toLowerCase()) : [];
  return {
    water: list.includes('water'),
    electricity: list.includes('electricity') || list.includes('electric'),
  };
}

export function metersSelectedToDraft(sel: MetersSelection): string[] {
  const out: string[] = [];
  if (sel.water) out.push('water');
  if (sel.electricity) out.push('electricity');
  return out;
}

/** Meter types are optional. An empty choice is valid. */
export function validateMetersSelection(sel: MetersSelection): { ok: boolean } {
  void sel;
  return { ok: true };
}

/** First meter stage after the property book, or the support-fee step when none are selected. */
export function firstMetersStage(sel: MetersSelection): FirstRunStageKey {
  if (sel.water) return 'meters_water';
  if (sel.electricity) return 'meters_electricity';
  return 'support_fee_opening';
}

export const FIRST_RUN_LOCKED_MODULES = ['property_book', 'support_fee', 'capital_repair', 'budget', 'uk_expenses', 'guest_mode'] as const;

export type FirstRunModuleChoice = {
  water: boolean;
  electricity: boolean;
  internet: boolean;
  budget: boolean;
  extra: string[];
};

export function emptyModuleChoice(): FirstRunModuleChoice {
  return { water: false, electricity: false, internet: false, budget: true, extra: [] };
}

/** Restore a saved choice. The budget stays selected. A draft without modules_selected keeps the old meter list. */
export function parseModuleChoice(draft: unknown): FirstRunModuleChoice {
  const record = asRecord(draft);
  const rawModules = record.modules_selected;
  const explicit = Array.isArray(rawModules);
  const list = explicit ? rawModules.map((item) => String(item).trim().toLowerCase()) : [];
  const meters = parseMetersSelected(record);
  const extra = explicit
    ? list.filter(
        (key: string) =>
          key !== 'property_book' &&
          key !== 'support_fee' &&
          key !== 'capital_repair' &&
          key !== 'water' &&
          key !== 'electricity' &&
          key !== 'electric' &&
          key !== 'internet' &&
          key !== 'budget' &&
          key !== 'uk_expenses' &&
          key !== 'guest_mode' &&
          key !== 'tariffs',
      )
    : [];
  return {
    water: explicit ? list.includes('water') : meters.water,
    electricity: explicit ? list.includes('electricity') || list.includes('electric') : meters.electricity,
    internet: explicit ? list.includes('internet') : false,
    budget: true,
    extra,
  };
}

export function moduleChoiceToDraft(choice: FirstRunModuleChoice): {
  modules_selected: string[];
  meters_selected: string[];
} {
  const modules = ['property_book', 'support_fee', 'capital_repair', 'budget', 'uk_expenses', 'guest_mode'];
  if (choice.water) modules.push('water');
  if (choice.electricity) modules.push('electricity');
  if (choice.internet) modules.push('internet');
  for (const key of choice.extra) {
    // Import substages are wizard progress only — never module catalog keys.
    if (key === 'property_book_objects' || key === 'property_book_owners' || key === 'property_book') {
      continue;
    }
    if (!modules.includes(key)) modules.push(key);
  }
  return {
    modules_selected: modules,
    meters_selected: metersSelectedToDraft(choice),
  };
}

export function stageAfterTariffs(choice: FirstRunModuleChoice): FirstRunStageKey {
  void choice;
  return 'budget';
}

/** Next real stage after saving the module choice. Does not skip an unfinished selected step. */
export function stageAfterModuleSave(
  choice: FirstRunModuleChoice,
  rows: { stage_key: string; status: string }[] | undefined,
): FirstRunStageKey {
  const done = (key: string) => rows?.some((row) => row.stage_key === key && row.status === 'complete') ?? false;
  if (!done('complex_card')) return 'complex_card';
  if (!done('property_book_objects') && !done('property_book')) return 'property_book_objects';
  if (!done('property_book_owners') && !done('property_book')) return 'property_book_owners';
  if (choice.water && !done('meters_water')) return 'meters_water';
  if (choice.electricity && !done('meters_electricity')) return 'meters_electricity';
  if (!done('support_fee_opening')) return 'support_fee_opening';
  if (!done('capital_repair_opening')) return 'capital_repair_opening';
  if (choice.internet && !done('internet_opening')) return 'internet_opening';
  if (!done('tariffs')) return 'tariffs';
  if (!done('budget')) return 'budget';
  if (!done('uk_expenses_opening')) return 'uk_expenses_opening';
  return 'complete';
}

/** Next stage after finishing a meter stage, honoring selection. */
export function nextAfterMetersStage(
  current: 'meters_water' | 'meters_electricity',
  sel: MetersSelection,
): FirstRunStageKey {
  if (current === 'meters_water' && sel.electricity) return 'meters_electricity';
  return 'support_fee_opening';
}

/**
 * Modules that expose a Tariff Core key.
 * Single filter used by first-run checklist and post-setup AdminTariffs.
 */
export type TariffModuleFlags = {
  water: boolean;
  electricity: boolean;
  internet: boolean;
  support_fee: boolean;
  capital_repair: boolean;
};

/** Tariff keys required for the given installed/enabled modules (order: utilities → SF → CR). */
export function tariffKeysForModules(flags: TariffModuleFlags): FirstRunTariffKey[] {
  const keys: FirstRunTariffKey[] = [];
  if (flags.water) keys.push('water');
  if (flags.electricity) keys.push('electricity');
  if (flags.internet) keys.push('internet');
  if (flags.support_fee) keys.push('support_fee');
  if (flags.capital_repair) keys.push('capital_repair');
  return keys;
}

/** Map a saved `modules_selected` list to tariff flags (UI + server must match). */
export function tariffFlagsFromModulesSelected(modules: Iterable<string>): TariffModuleFlags {
  const set = new Set(
    [...modules].map((item) => String(item).trim().toLowerCase()).filter((item) => item.length > 0),
  );
  return {
    water: set.has('water'),
    electricity: set.has('electricity') || set.has('electric'),
    internet: set.has('internet'),
    support_fee: set.has('support_fee'),
    capital_repair: set.has('capital_repair'),
  };
}

/**
 * Required first-run tariffs from the module choice that is persisted.
 * Locked SF/CR come only via `moduleChoiceToDraft` → `modules_selected`, not a parallel hardcode.
 */
export function requiredFirstRunTariffKeys(
  choice: Pick<FirstRunModuleChoice, 'water' | 'electricity'> &
    Partial<Pick<FirstRunModuleChoice, 'internet' | 'budget' | 'extra'>>,
): FirstRunTariffKey[] {
  const full: FirstRunModuleChoice = {
    water: choice.water === true,
    electricity: choice.electricity === true,
    internet: 'internet' in choice ? choice.internet === true : false,
    budget: choice.budget !== false,
    extra: choice.extra ?? [],
  };
  return tariffKeysForModules(tariffFlagsFromModulesSelected(moduleChoiceToDraft(full).modules_selected));
}

/** Same rule from a saved first-run draft (`modules_selected`). */
export function requiredFirstRunTariffKeysFromDraft(draft: unknown): FirstRunTariffKey[] {
  const record = asRecord(draft);
  if (Array.isArray(record.modules_selected)) {
    return tariffKeysForModules(tariffFlagsFromModulesSelected(record.modules_selected.map(String)));
  }
  return requiredFirstRunTariffKeys(parseModuleChoice(draft));
}

/** Next stage after capital-repair opening: internet inventarisation before the tariffs checklist. */
export function stageAfterCapitalRepairOpening(
  choice: Pick<FirstRunModuleChoice, 'internet'>,
): FirstRunStageKey {
  return choice.internet ? 'internet_opening' : 'tariffs';
}

function hasTariffVersionId(id: string | null | undefined): boolean {
  return id != null && String(id).trim().length > 0;
}

/**
 * True when Tariff Core has a published version for first-run.
 * Annual tariffs (support_fee / capital_repair) may land as nearest_future when
 * application_year is next calendar year — that still counts as published.
 */
export function isFirstRunTariffPublished(
  row:
    | {
        current_version_id?: string | null;
        nearest_future_version_id?: string | null;
      }
    | null
    | undefined,
): boolean {
  if (row == null) return false;
  return (
    hasTariffVersionId(row.current_version_id) || hasTariffVersionId(row.nearest_future_version_id)
  );
}

export type FirstRunAnnualTariffPrep = {
  rate_natural: number;
  rate_legal: number;
  basis_type: 'external_decision' | 'general_meeting';
  basis_reference: string | null;
  /** Optional for support_fee first-run prep; still required for capital_repair. */
  basis_date: string | null;
  /** May be empty for support_fee first-run prep; required for capital_repair. */
  basis_note: string;
  decision_id: string | null;
};

export type FirstRunWaterTariffPrep = {
  rate: number;
  basis_type: 'supplier_notice' | 'invoice' | 'other';
  /** Optional for water first-run (document number no longer collected). */
  basis_reference: string | null;
  basis_date: string | null;
  /** May be empty for water first-run prep. */
  basis_note: string;
};

export type InstallationWaterSupplier = {
  short: string;
  legal_name: string;
};

export const DEFAULT_WATER_SUPPLIER: InstallationWaterSupplier = {
  short: 'ВиК Бургас',
  legal_name: '«Водоснабдяване и канализация» ЕАД — Бургас',
};

export type FirstRunElectricityTariffPrep = {
  day: number;
  night: number;
  basis_type: 'supplier_notice' | 'invoice' | 'other';
  /** Optional for electricity first-run (document number no longer collected). */
  basis_reference: string | null;
  basis_date: string | null;
  /** May be empty for electricity first-run prep. */
  basis_note: string;
};

export type InstallationElectricitySupplier = {
  short: string;
  legal_name: string;
};

export const DEFAULT_ELECTRICITY_SUPPLIER: InstallationElectricitySupplier = {
  short: 'EVN',
  legal_name: '„ЕВН България Електроснабдяване“ ЕАД',
};

export type FirstRunInternetTariffPrep = {
  package_30: number;
  day: number;
  basis_type: 'supplier_notice' | 'invoice' | 'other';
  basis_reference: string;
  basis_date: string | null;
  basis_note: string;
};

export type FirstRunTariffPrepMap = {
  support_fee?: FirstRunAnnualTariffPrep;
  capital_repair?: FirstRunAnnualTariffPrep;
  water?: FirstRunWaterTariffPrep;
  electricity?: FirstRunElectricityTariffPrep;
  internet?: FirstRunInternetTariffPrep;
};

function positive(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

function nonNegative(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Support fee first-run: rates + basis type only (no document number/date/note). */
export function isSupportFeeTariffPrep(value: unknown): value is FirstRunAnnualTariffPrep {
  const row = asRecord(value);
  if (!row) return false;
  const natural = positive(row.rate_natural);
  const legal = positive(row.rate_legal ?? row.rate_natural);
  const basis = text(row.basis_type);
  if (natural == null || legal == null) return false;
  return basis === 'external_decision' || basis === 'general_meeting';
}

/** Capital repair first-run: rates + document basis fields. */
export function isCapitalRepairTariffPrep(value: unknown): value is FirstRunAnnualTariffPrep {
  const row = asRecord(value);
  if (!row) return false;
  const natural = positive(row.rate_natural);
  const legal = positive(row.rate_legal ?? row.rate_natural);
  const basis = text(row.basis_type);
  const note = text(row.basis_note);
  const date = text(row.basis_date);
  const reference = text(row.basis_reference);
  const decision = text(row.decision_id);
  if (natural == null || legal == null || !note || !date) return false;
  if (basis === 'external_decision') return reference.length > 0;
  if (basis === 'general_meeting') return decision.length > 0;
  return false;
}

/** @deprecated Prefer isSupportFeeTariffPrep / isCapitalRepairTariffPrep. Capital-repair rules. */
export function isAnnualTariffPrep(value: unknown): value is FirstRunAnnualTariffPrep {
  return isCapitalRepairTariffPrep(value);
}

function normalizeAnnualPrep(row: Record<string, unknown>): FirstRunAnnualTariffPrep {
  const natural = positive(row.rate_natural)!;
  const legal = positive(row.rate_legal ?? row.rate_natural)!;
  return {
    rate_natural: natural,
    rate_legal: legal,
    basis_type: text(row.basis_type) as FirstRunAnnualTariffPrep['basis_type'],
    basis_reference: text(row.basis_reference) || null,
    basis_date: text(row.basis_date) || null,
    basis_note: text(row.basis_note),
    decision_id: text(row.decision_id) || null,
  };
}

/** Water first-run: rate + basis type only (no supplier document number/date/note). */
export function isWaterTariffPrep(value: unknown): value is FirstRunWaterTariffPrep {
  const row = asRecord(value);
  if (!row) return false;
  const basis = text(row.basis_type);
  return (
    nonNegative(row.rate) != null &&
    (basis === 'supplier_notice' || basis === 'invoice' || basis === 'other')
  );
}

function normalizeWaterPrep(row: Record<string, unknown>): FirstRunWaterTariffPrep {
  return {
    rate: nonNegative(row.rate)!,
    basis_type: text(row.basis_type) as FirstRunWaterTariffPrep['basis_type'],
    basis_reference: text(row.basis_reference) || null,
    basis_date: text(row.basis_date) || null,
    basis_note: text(row.basis_note),
  };
}

export function readInstallationWaterSupplier(value: unknown): InstallationWaterSupplier {
  const row = asRecord(value);
  if (!row) return { ...DEFAULT_WATER_SUPPLIER };
  const short = text(row.short) || DEFAULT_WATER_SUPPLIER.short;
  const legal = text(row.legal_name) || DEFAULT_WATER_SUPPLIER.legal_name;
  return { short, legal_name: legal };
}

/** Electricity first-run: day/night rates + basis type only (no supplier document number/date/note). */
export function isElectricityTariffPrep(value: unknown): value is FirstRunElectricityTariffPrep {
  const row = asRecord(value);
  if (!row) return false;
  const basis = text(row.basis_type);
  return (
    nonNegative(row.day) != null &&
    nonNegative(row.night) != null &&
    (basis === 'supplier_notice' || basis === 'invoice' || basis === 'other')
  );
}

function normalizeElectricityPrep(row: Record<string, unknown>): FirstRunElectricityTariffPrep {
  return {
    day: nonNegative(row.day)!,
    night: nonNegative(row.night)!,
    basis_type: text(row.basis_type) as FirstRunElectricityTariffPrep['basis_type'],
    basis_reference: text(row.basis_reference) || null,
    basis_date: text(row.basis_date) || null,
    basis_note: text(row.basis_note),
  };
}

export function readInstallationElectricitySupplier(value: unknown): InstallationElectricitySupplier {
  const row = asRecord(value);
  if (!row) return { ...DEFAULT_ELECTRICITY_SUPPLIER };
  const short = text(row.short) || DEFAULT_ELECTRICITY_SUPPLIER.short;
  const legal = text(row.legal_name) || DEFAULT_ELECTRICITY_SUPPLIER.legal_name;
  return { short, legal_name: legal };
}

export function isInternetTariffPrep(value: unknown): value is FirstRunInternetTariffPrep {
  const row = asRecord(value);
  if (!row) return false;
  const basis = text(row.basis_type);
  return (
    nonNegative(row.package_30) != null &&
    nonNegative(row.day) != null &&
    (basis === 'supplier_notice' || basis === 'invoice' || basis === 'other') &&
    text(row.basis_reference).length > 0 &&
    text(row.basis_note).length > 0
  );
}

export function readTariffPrep(draft: Record<string, unknown> | null | undefined): FirstRunTariffPrepMap {
  const raw = asRecord(draft?.tariff_prep);
  if (!raw) return {};
  const prep: FirstRunTariffPrepMap = {};
  if (isSupportFeeTariffPrep(raw.support_fee)) {
    prep.support_fee = normalizeAnnualPrep(asRecord(raw.support_fee)!);
  }
  if (isCapitalRepairTariffPrep(raw.capital_repair)) {
    prep.capital_repair = normalizeAnnualPrep(asRecord(raw.capital_repair)!);
  }
  if (isWaterTariffPrep(raw.water)) prep.water = normalizeWaterPrep(asRecord(raw.water)!);
  if (isElectricityTariffPrep(raw.electricity)) {
    prep.electricity = normalizeElectricityPrep(asRecord(raw.electricity)!);
  }
  if (isInternetTariffPrep(raw.internet)) prep.internet = raw.internet;
  return prep;
}

export function isFirstRunTariffPrepared(key: FirstRunTariffKey, prep: FirstRunTariffPrepMap): boolean {
  if (key === 'support_fee') return isSupportFeeTariffPrep(prep.support_fee);
  if (key === 'capital_repair') return isCapitalRepairTariffPrep(prep.capital_repair);
  if (key === 'water') return isWaterTariffPrep(prep.water);
  if (key === 'internet') return isInternetTariffPrep(prep.internet);
  return isElectricityTariffPrep(prep.electricity);
}

/** Service stage where the operator enters this tariff during first-run. */
export function firstRunTariffSetupStage(key: FirstRunTariffKey): FirstRunStageKey {
  switch (key) {
    case 'water':
      return 'meters_water';
    case 'electricity':
      return 'meters_electricity';
    case 'support_fee':
      return 'support_fee_opening';
    case 'capital_repair':
      return 'capital_repair_opening';
    case 'internet':
      return 'internet_opening';
  }
}

/** i18n key for the service stage that owns this tariff. */
export function firstRunTariffSetupStageLabelKey(key: FirstRunTariffKey): string {
  switch (key) {
    case 'water':
      return 'admin.firstRunStageMetersWater';
    case 'electricity':
      return 'admin.firstRunStageMetersElectricity';
    case 'support_fee':
      return 'admin.firstRunStageSupportFee';
    case 'capital_repair':
      return 'admin.firstRunStageCapitalRepair';
    case 'internet':
      return 'admin.firstRunStageInternetOpening';
  }
}

function formatFirstRunTariffAmount(raw: string | number, locale?: string): string {
  const n = typeof raw === 'number' ? raw : Number(String(raw).replace(',', '.'));
  if (!Number.isFinite(n)) return String(raw);
  if (!locale) {
    return n.toFixed(2);
  }
  const tag = locale === 'bg' || locale.startsWith('bg') ? 'bg-BG' : locale === 'en' || locale.startsWith('en') ? 'en-US' : 'ru-RU';
  return new Intl.NumberFormat(tag, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

/** Short rate summary for the tariffs checklist (same draft as service stages). */
export function formatFirstRunTariffPrepSummary(
  key: FirstRunTariffKey,
  prep: FirstRunTariffPrepMap,
  t: (k: string) => string,
  locale?: string,
): string | null {
  if (!isFirstRunTariffPrepared(key, prep)) return null;
  const amt = (v: string | number) => formatFirstRunTariffAmount(v, locale);
  if (key === 'water' && prep.water) {
    const basis =
      prep.water.basis_type === 'supplier_notice'
        ? t('admin.tcBasisSupplier')
        : prep.water.basis_type === 'invoice'
          ? t('admin.tcBasisInvoice')
          : prep.water.basis_type === 'other'
            ? t('admin.tcBasisOther')
            : prep.water.basis_type;
    return `${amt(prep.water.rate)} €/${t('admin.tcUnitM3')}\n${t('admin.tcBasis')}: ${basis}`;
  }
  if (key === 'electricity' && prep.electricity) {
    const basis =
      prep.electricity.basis_type === 'supplier_notice'
        ? t('admin.tcBasisSupplier')
        : prep.electricity.basis_type === 'invoice'
          ? t('admin.tcBasisInvoice')
          : prep.electricity.basis_type === 'other'
            ? t('admin.tcBasisOther')
            : prep.electricity.basis_type;
    return `${t('admin.tcCompDay')}: ${amt(prep.electricity.day)} €/${t('admin.tcUnitKwh')}\n${t('admin.tcCompNight')}: ${amt(prep.electricity.night)} €/${t('admin.tcUnitKwh')}\n${t('admin.tcBasis')}: ${basis}`;
  }
  if (key === 'internet' && prep.internet) {
    return `${t('admin.internetTariffPackage30')}: ${amt(prep.internet.package_30)} €\n${t('admin.internetTariffDay24')}: ${amt(prep.internet.day)} €`;
  }
  if ((key === 'support_fee' || key === 'capital_repair') && prep[key]) {
    const item = prep[key]!;
    // Catalog: support_fee and capital_repair = €/m²·year × properties.area_sqm.
    const unit = t('admin.perSqmYear');
    const basis =
      item.basis_type === 'general_meeting'
        ? t('admin.tcBasisGm')
        : item.basis_type === 'external_decision'
          ? t('admin.tcBasisExternal')
          : item.basis_type;
    return `${t('admin.tcSubjectNatural')}: ${amt(item.rate_natural)} ${unit}\n${t('admin.tcSubjectLegal')}: ${amt(item.rate_legal)} ${unit}\n${t('admin.tcBasis')}: ${basis}`;
  }
  return null;
}

/** A future-only version does not cover activation. A saved preparation does. */
export function firstRunTariffStepReady(
  key: FirstRunTariffKey,
  row: { current_version_id?: string | null } | null | undefined,
  prep: FirstRunTariffPrepMap,
): boolean {
  if (isFirstRunTariffPrepared(key, prep)) return true;
  return hasTariffVersionId(row?.current_version_id);
}

/** Keys still missing a published Tariff Core version. */
export function missingFirstRunTariffs(
  required: readonly FirstRunTariffKey[],
  rows: readonly {
    tariff_key: string;
    current_version_id?: string | null;
    nearest_future_version_id?: string | null;
  }[],
): FirstRunTariffKey[] {
  return required.filter((key) => {
    const row = rows.find((r) => String(r.tariff_key).toLowerCase() === key);
    return !isFirstRunTariffPublished(row);
  });
}

export const BUDGET_MODULE_KEY = 'budget';

export type FirstRunBudgetDraft = {
  calendarYear: number | null;
  yearId: string | null;
  decisionNote: string;
  zeroConfirmed: boolean;
  step: 'year' | 'amounts' | 'review' | 'done';
};

/** Parse budget fields from first_run_draft (server progress). */
export function parseFirstRunBudgetDraft(draft: unknown): FirstRunBudgetDraft {
  const d = asRecord(draft);
  const yearRaw = d.budget_calendar_year;
  const yearNum = yearRaw == null || yearRaw === '' ? NaN : Number(yearRaw);
  const stepRaw = String(d.budget_ui_step ?? '').trim();
  const step =
    stepRaw === 'amounts' || stepRaw === 'review' || stepRaw === 'done' || stepRaw === 'year'
      ? stepRaw
      : 'year';
  const zeroRaw = String(d.budget_zero_confirmed ?? '').trim().toLowerCase();
  return {
    calendarYear: Number.isFinite(yearNum) && yearNum >= 2020 && yearNum <= 2100 ? yearNum : null,
    yearId: d.budget_year_id == null || d.budget_year_id === '' ? null : String(d.budget_year_id),
    decisionNote: str(d.budget_decision_note),
    zeroConfirmed: zeroRaw === 'true' || zeroRaw === 't' || zeroRaw === '1' || zeroRaw === 'yes',
    step,
  };
}

export function firstRunBudgetDraftPayload(d: FirstRunBudgetDraft): Record<string, unknown> {
  return {
    budget_calendar_year: d.calendarYear,
    budget_year_id: d.yearId,
    budget_decision_note: d.decisionNote,
    budget_zero_confirmed: d.zeroConfirmed,
    budget_ui_step: d.step,
  };
}

/** Fully zero plan needs an explicit confirmation flag (server re-checks). */
export function budgetPlanRequiresZeroConfirmation(totalPlannedEur: number): boolean {
  return !(Number(totalPlannedEur) > 0);
}

// ---------------------------------------------------------------------------
// Complex / UK / bank form
// ---------------------------------------------------------------------------

export function complexToForm(c: FirstRunComplex | null | undefined): FirstRunComplexForm {
  const street =
    c?.address_street?.trim() ||
    (!c?.address_city?.trim() && !c?.address_country?.trim() ? c?.address ?? '' : '');
  const banks = c?.bank_accounts?.length ? c.bank_accounts : [emptyBankAccount(true)];
  return {
    display_name: c?.display_name || c?.complex_name || '',
    address_country: c?.address_country ?? '',
    address_city: c?.address_city ?? '',
    address_postal_code: c?.address_postal_code ?? '',
    address_street: street,
    address_building_number: c?.address_building_number ?? '',
    apartment_count: c?.apartment_count != null ? String(c.apartment_count) : '',
    contact_phone: c?.contact_phone ?? '',
    contact_email: c?.contact_email ?? '',
    mgmt_legal_name: c?.mgmt_legal_name ?? '',
    mgmt_legal_form: c?.mgmt_legal_form ?? '',
    mgmt_registration_country: c?.mgmt_registration_country ?? '',
    mgmt_registration_number: c?.mgmt_registration_number ?? '',
    mgmt_vat_registered: c?.mgmt_vat_registered === true,
    mgmt_vat_number: c?.mgmt_vat_number ?? '',
    mgmt_registered_address: c?.mgmt_registered_address ?? '',
    mgmt_correspondence_address: c?.mgmt_correspondence_address ?? '',
    mgmt_representative_name: c?.mgmt_representative_name ?? '',
    mgmt_representative_title: c?.mgmt_representative_title ?? '',
    mgmt_phone: c?.mgmt_phone ?? '',
    mgmt_email: c?.mgmt_email ?? '',
    bank_accounts: banks.map((b) => ({ ...b })),
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function bankRowFilled(b: FirstRunBankAccount): boolean {
  return Boolean(
    b.purpose.trim() ||
      b.account_holder.trim() ||
      b.bank_name.trim() ||
      b.iban.trim() ||
      b.bic_swift.trim(),
  );
}

/** Returns error codes (empty = valid). Mirrors SQL commit rules. */
export function validateComplexForm(form: FirstRunComplexForm): string[] {
  const errors: string[] = [];
  if (!form.display_name.trim()) errors.push('display_name');
  if (!form.address_country.trim()) errors.push('address_country');
  if (!form.address_city.trim()) errors.push('address_city');
  if (!form.address_street.trim()) errors.push('address_street');
  if (!form.address_building_number.trim()) errors.push('address_building_number');
  const n = Number(form.apartment_count.trim());
  if (!form.apartment_count.trim() || !Number.isInteger(n) || n <= 0) errors.push('apartment_count');
  const email = form.contact_email.trim();
  if (email && !EMAIL_RE.test(email)) errors.push('contact_email');

  if (!form.mgmt_legal_name.trim()) errors.push('mgmt_legal_name');
  if (!form.mgmt_registration_country.trim()) errors.push('mgmt_registration_country');
  if (!form.mgmt_registration_number.trim()) errors.push('mgmt_registration_number');
  if (!form.mgmt_registered_address.trim()) errors.push('mgmt_registered_address');
  if (!form.mgmt_representative_name.trim()) errors.push('mgmt_representative_name');
  if (!form.mgmt_phone.trim()) errors.push('mgmt_phone');
  if (!form.mgmt_email.trim()) errors.push('mgmt_email');
  else if (!EMAIL_RE.test(form.mgmt_email.trim())) errors.push('mgmt_email');
  if (form.mgmt_vat_registered && !form.mgmt_vat_number.trim()) errors.push('mgmt_vat_number');

  form.bank_accounts.forEach((b, idx) => {
    if (!bankRowFilled(b)) return;
    if (!b.account_holder.trim()) errors.push(`bank_${idx}_account_holder`);
    if (!b.bank_name.trim()) errors.push(`bank_${idx}_bank_name`);
    if (!b.iban.trim()) errors.push(`bank_${idx}_iban`);
    else {
      // Dynamic import avoided — validate via inline require of isValidIban at call sites.
    }
  });
  return errors;
}

export function validateComplexFormWithIban(
  form: FirstRunComplexForm,
  ibanOk: (raw: string) => boolean,
): string[] {
  const errors = validateComplexForm(form);
  form.bank_accounts.forEach((b, idx) => {
    if (!bankRowFilled(b) || !b.iban.trim()) return;
    if (!ibanOk(b.iban)) errors.push(`bank_${idx}_iban`);
  });
  return errors;
}

const COMPLEX_FIELD_ACTION_KEYS: Record<string, string> = {
  display_name: 'admin.firstRunComplexAction_display_name',
  address_country: 'admin.firstRunComplexAction_address_country',
  address_city: 'admin.firstRunComplexAction_address_city',
  address_street: 'admin.firstRunComplexAction_address_street',
  address_building_number: 'admin.firstRunComplexAction_address_building_number',
  apartment_count: 'admin.firstRunComplexAction_apartment_count',
  contact_email: 'admin.firstRunComplexAction_contact_email',
  mgmt_legal_name: 'admin.firstRunComplexAction_mgmt_legal_name',
  mgmt_registration_country: 'admin.firstRunComplexAction_mgmt_registration_country',
  mgmt_registration_number: 'admin.firstRunComplexAction_mgmt_registration_number',
  mgmt_registered_address: 'admin.firstRunComplexAction_mgmt_registered_address',
  mgmt_representative_name: 'admin.firstRunComplexAction_mgmt_representative_name',
  mgmt_phone: 'admin.firstRunComplexAction_mgmt_phone',
  mgmt_email: 'admin.firstRunComplexAction_mgmt_email',
  mgmt_vat_number: 'admin.firstRunComplexAction_mgmt_vat_number',
};

/**
 * User-facing summary for complex-card validation: field + what to do + retry hint.
 * Codes like bank_0_iban map to the IBAN action line.
 */
export function presentComplexFormErrors(
  codes: string[],
  t: (key: string) => string,
): string {
  if (!codes.length) return t('admin.firstRunComplexInvalid');
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const code of codes) {
    let actionKey = COMPLEX_FIELD_ACTION_KEYS[code];
    if (!actionKey && /^bank_\d+_iban$/.test(code)) actionKey = 'admin.firstRunComplexAction_bank_iban';
    if (!actionKey && /^bank_\d+_account_holder$/.test(code)) {
      actionKey = 'admin.firstRunComplexAction_bank_account_holder';
    }
    if (!actionKey && /^bank_\d+_bank_name$/.test(code)) {
      actionKey = 'admin.firstRunComplexAction_bank_name';
    }
    if (!actionKey) continue;
    if (seen.has(actionKey)) continue;
    seen.add(actionKey);
    lines.push(t(actionKey));
  }
  if (lines.length === 0) return t('admin.firstRunComplexInvalid');
  return `${lines.join(' ')} ${t('admin.firstRunComplexFixRetry')}`;
}

export function complexFormToPayload(
  form: FirstRunComplexForm,
  opts?: { asDraft?: boolean },
): Record<string, unknown> {
  const asDraft = opts?.asDraft === true;
  const banks = form.bank_accounts
    .filter((b) => {
      if (!bankRowFilled(b)) return false;
      // Draft: skip incomplete rows so partial typing does not block autosave.
      if (asDraft) {
        // Skip incomplete / invalid IBANs so draft autosave never hits first_run: iban invalid.
        return Boolean(
          b.account_holder.trim() &&
            b.bank_name.trim() &&
            b.iban.trim() &&
            isValidIban(b.iban),
        );
      }
      return true;
    })
    .map((b, index) => ({
      purpose: b.purpose.trim(),
      account_holder: b.account_holder.trim(),
      bank_name: b.bank_name.trim(),
      iban: b.iban.trim(),
      bic_swift: b.bic_swift.trim() || null,
      currency: (b.currency.trim() || 'EUR').toUpperCase(),
      is_primary: b.is_primary === true,
      sort_order: index,
    }));
  const countRaw = form.apartment_count.trim();
  const apartment_count = countRaw
    ? Number(countRaw)
    : asDraft
      ? null
      : Number.NaN;
  return {
    display_name: form.display_name.trim(),
    address: composeComplexAddressLine(form),
    address_country: form.address_country.trim(),
    address_city: form.address_city.trim(),
    address_postal_code: form.address_postal_code.trim(),
    address_street: form.address_street.trim(),
    address_building_number: form.address_building_number.trim(),
    apartment_count,
    contact_phone: form.contact_phone.trim(),
    contact_email: form.contact_email.trim(),
    mgmt_legal_name: form.mgmt_legal_name.trim(),
    mgmt_legal_form: form.mgmt_legal_form.trim(),
    mgmt_registration_country: form.mgmt_registration_country.trim(),
    mgmt_registration_number: form.mgmt_registration_number.trim(),
    mgmt_vat_registered: form.mgmt_vat_registered === true,
    mgmt_vat_number: form.mgmt_vat_registered ? form.mgmt_vat_number.trim() : '',
    mgmt_registered_address: form.mgmt_registered_address.trim(),
    mgmt_correspondence_address: form.mgmt_correspondence_address.trim(),
    mgmt_representative_name: form.mgmt_representative_name.trim(),
    mgmt_representative_title: form.mgmt_representative_title.trim(),
    mgmt_phone: form.mgmt_phone.trim(),
    mgmt_email: form.mgmt_email.trim(),
    bank_accounts: banks,
    as_draft: asDraft,
  };
}

// ---------------------------------------------------------------------------
// Import errors (Property Book / meters RPC)
// ---------------------------------------------------------------------------

function asStringList(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.map((x) => String(x ?? '').trim()).filter(Boolean);
  return out.length ? out : undefined;
}

function asIntList(v: unknown): number[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v
    .map((x) => Number(x))
    .filter((n) => Number.isFinite(n) && n > 0)
    .map((n) => Math.trunc(n));
  return out.length ? out : undefined;
}

export function normalizeFirstRunErrors(errors: unknown): FirstRunErrorRow[] {
  if (!Array.isArray(errors)) return [];
  return errors.map((e) => {
    const r = asRecord(e);
    const severityRaw = str(r.severity).toLowerCase();
    const reason = str(r.code || r.reason);
    const candidateSections =
      asStringList(r.candidate_sections) || asStringList(r.candidateSections);
    const sourceRows = asIntList(r.source_rows) || asIntList(r.sourceRows) || asIntList(r.rows);
    const sectionCode = str(r.section_code || r.sectionCode);
    const blockCode = str(r.block_code || r.blockCode);
    const value = str(r.value);
    const billingYear = str(r.billing_year ?? r.billingYear);
    const savedNet =
      r.saved_net != null && r.saved_net !== ''
        ? str(r.saved_net)
        : r.savedNet != null && r.savedNet !== ''
          ? str(r.savedNet)
          : '';
    const newNet =
      r.new_net != null && r.new_net !== ''
        ? str(r.new_net)
        : r.newNet != null && r.newNet !== ''
          ? str(r.newNet)
          : '';
    const meta =
      candidateSections || sourceRows || sectionCode || blockCode || value || billingYear || savedNet || newNet
        ? {
            ...(candidateSections ? { candidateSections } : {}),
            ...(sourceRows ? { sourceRows } : {}),
            ...(sectionCode ? { sectionCode } : {}),
            ...(blockCode ? { blockCode } : {}),
            ...(value ? { value } : {}),
            ...(billingYear ? { billingYear } : {}),
            ...(savedNet ? { savedNet } : {}),
            ...(newNet ? { newNet } : {}),
          }
        : undefined;
    return {
      sheet: str(r.sheet),
      row: str(r.row ?? r._row),
      field: str(r.field),
      // Keep a single stable code; never dump codes[] arrays into the UI reason.
      reason,
      apartment: str(r.apartment_number),
      severity: severityRaw === 'warning' ? 'warning' : 'error',
      meta,
    };
  });
}

export function hasApartmentCountMismatch(errors: unknown): boolean {
  if (!Array.isArray(errors)) return false;
  return errors.some((e) => {
    const r = asRecord(e);
    return r.code === 'apartment_count_mismatch' || r.reason === 'apartment_count_mismatch';
  });
}

export function apartmentCountMismatchInfo(
  errors: unknown,
): { expected: number | null; actual: number | null } | null {
  if (!Array.isArray(errors)) return null;
  for (const e of errors) {
    const r = asRecord(e);
    if (r.code === 'apartment_count_mismatch' || r.reason === 'apartment_count_mismatch') {
      const exp = Number(r.expected);
      const act = Number(r.actual);
      return {
        expected: Number.isFinite(exp) ? exp : null,
        actual: Number.isFinite(act) ? act : null,
      };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Module lifecycle path (wizard auto-activation)
// ---------------------------------------------------------------------------

/**
 * Ordered target states to reach ACTIVE using the strict IS-1 transition table.
 * Unknown / missing state ⇒ treated as DISABLED (RPC creates the row).
 */
export function lifecyclePathToActive(from: string | null | undefined): string[] {
  switch (String(from ?? 'DISABLED').toUpperCase()) {
    case 'ACTIVE':
      return [];
    case 'READY':
    case 'SUSPENDED':
      return ['ACTIVE'];
    case 'SETUP_IN_PROGRESS':
      return ['READY', 'ACTIVE'];
    case 'SETUP_REQUIRED':
      return ['SETUP_IN_PROGRESS', 'READY', 'ACTIVE'];
    default:
      return ['SETUP_REQUIRED', 'SETUP_IN_PROGRESS', 'READY', 'ACTIVE'];
  }
}
