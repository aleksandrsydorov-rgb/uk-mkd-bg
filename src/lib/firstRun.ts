/**
 * R1-RC8 — Mandatory first-run wizard helpers (gate, stage resume, validation).
 * Pure helpers + thin Supabase RPC wrappers. Browser-safe (no service-role).
 *
 * Gate source of truth is admin_get_first_run_state().gate_required — never properties count.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';

/** Section id reserved for the forced wizard (not part of the normal admin nav). */
export const FIRST_RUN_SECTION = 'first_run';
export const FIRST_RUN_WIZARD_PATH = `/admin?section=${FIRST_RUN_SECTION}`;
export const ADMIN_HOME_PATH = '/admin';

export const FIRST_RUN_STAGES = [
  'welcome',
  'complex_card',
  'property_book',
  'meters_select',
  'meters_water',
  'meters_electricity',
  'support_fee_opening',
  'capital_repair_opening',
  'tariffs',
  'complete',
] as const;
export type FirstRunStageKey = (typeof FIRST_RUN_STAGES)[number];

export type FirstRunStatus = 'pending' | 'in_progress' | 'complete';
export type FirstRunMeterUtility = 'water' | 'electricity';

export type FirstRunComplex = {
  display_name: string;
  complex_name: string;
  address: string;
  apartment_count: number | null;
  contact_phone: string;
  contact_email: string;
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
  address: string;
  apartment_count: string;
  contact_phone: string;
  contact_email: string;
};

/** Normalized import error row for UI (Book / meters RPC errors). */
export type FirstRunErrorRow = {
  sheet: string;
  row: string;
  field: string;
  reason: string;
  apartment: string;
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
      apartment_count: count != null && Number.isFinite(count) ? count : null,
      contact_phone: str(complexRaw.contact_phone),
      contact_email: str(complexRaw.contact_email),
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
      return { ok: false, error: error.message || 'admin_get_first_run_state failed' };
    }
    const state = parseFirstRunState(data);
    if (!state) {
      return { ok: false, error: 'admin_get_first_run_state returned invalid payload' };
    }
    return { ok: true, state };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'admin_get_first_run_state failed';
    return { ok: false, error: msg };
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
  return untypedRpc(supabase).rpc(fn, { p_rows: rows, p_dry_run: dryRun });
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

/** Where the wizard resumes after load/re-login. Complete ⇒ 'complete' stage (done screen). */
export function resolveFirstRunResumeStage(state: FirstRunState | null | undefined): FirstRunStageKey {
  if (!state) return 'welcome';
  if (state.first_run_status === 'complete') return 'complete';
  return state.first_run_stage;
}

/** Wizard steps visible as progress dots (skipped meter stages are removed). */
export function visibleFirstRunStages(selection: MetersSelection | null): FirstRunStageKey[] {
  return FIRST_RUN_STAGES.filter((s) => {
    if (s === 'meters_water') return selection == null || selection.water;
    if (s === 'meters_electricity') return selection == null || selection.electricity;
    return true;
  });
}

// ---------------------------------------------------------------------------
// Meters selection (≥1 utility required)
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

export function validateMetersSelection(sel: MetersSelection): { ok: boolean; error?: 'at_least_one' } {
  if (!sel.water && !sel.electricity) return { ok: false, error: 'at_least_one' };
  return { ok: true };
}

/** First meter stage after selection (water first), or 'complete' when none (invalid). */
export function firstMetersStage(sel: MetersSelection): FirstRunStageKey {
  if (sel.water) return 'meters_water';
  if (sel.electricity) return 'meters_electricity';
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

// ---------------------------------------------------------------------------
// Complex card form
// ---------------------------------------------------------------------------

export function complexToForm(c: FirstRunComplex | null | undefined): FirstRunComplexForm {
  return {
    display_name: c?.display_name ?? '',
    address: c?.address ?? '',
    apartment_count: c?.apartment_count != null ? String(c.apartment_count) : '',
    contact_phone: c?.contact_phone ?? '',
    contact_email: c?.contact_email ?? '',
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Returns error codes (empty = valid). Mirrors SQL: name, address, apartment_count > 0 required. */
export function validateComplexForm(form: FirstRunComplexForm): string[] {
  const errors: string[] = [];
  if (!form.display_name.trim()) errors.push('display_name');
  if (!form.address.trim()) errors.push('address');
  const n = Number(form.apartment_count.trim());
  if (!form.apartment_count.trim() || !Number.isInteger(n) || n <= 0) errors.push('apartment_count');
  const email = form.contact_email.trim();
  if (email && !EMAIL_RE.test(email)) errors.push('contact_email');
  return errors;
}

export function complexFormToPayload(form: FirstRunComplexForm): Record<string, unknown> {
  return {
    display_name: form.display_name.trim(),
    address: form.address.trim(),
    apartment_count: Number(form.apartment_count.trim()),
    contact_phone: form.contact_phone.trim(),
    contact_email: form.contact_email.trim(),
  };
}

// ---------------------------------------------------------------------------
// Import errors (Property Book / meters RPC)
// ---------------------------------------------------------------------------

export function normalizeFirstRunErrors(errors: unknown): FirstRunErrorRow[] {
  if (!Array.isArray(errors)) return [];
  return errors.map((e) => {
    const r = asRecord(e);
    const codes = Array.isArray(r.codes) ? (r.codes as unknown[]).map(String).join(', ') : '';
    return {
      sheet: str(r.sheet),
      row: str(r.row ?? r._row),
      field: str(r.field),
      reason: str(r.reason || r.code) + (codes ? `: ${codes}` : ''),
      apartment: str(r.apartment_number),
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
