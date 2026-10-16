/**
 * INV-4 — Administrator Inventory UI helpers (pure + thin RPC wrappers).
 * RPCs remain the authorization boundary; this is UX gating only.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { isBuildingModuleEnabled, type BuildingModulesState } from '@/lib/modules';
import { INV1_OWNERSHIP_KINDS, INV1_SESSION_STATUSES, INV1_STOCK_MOVEMENT_TYPES } from './inv1Schema';

export const INVENTORY_MODULE_KEY = 'inventory' as const;

export type InventoryAdminView =
  | 'overview'
  | 'assets'
  | 'stock'
  | 'categories'
  | 'locations'
  | 'sessions'
  | 'asset_detail'
  | 'session_detail';

export type InventoryAssetRow = {
  id: string;
  inventory_number: string;
  name: string;
  description: string | null;
  category_id: string | null;
  ownership_kind: string;
  ownership_note: string | null;
  location_id: string | null;
  condition: string;
  operational_status: string;
  responsible_staff_id: number | null;
  estimated_value_eur: number | null;
  serial_number: string | null;
  manufacturer: string | null;
  model: string | null;
  write_off_reason: string | null;
  created_at: string;
  updated_at: string;
};

export type InventoryStockItemRow = {
  id: string;
  sku_code: string;
  name: string;
  unit_code: string;
  ownership_kind: string;
  category_id: string | null;
  default_location_id: string | null;
  min_qty: number | null;
  active: boolean;
};

export type InventoryStockBalanceRow = {
  stock_item_id: string;
  sku_code: string;
  name: string;
  unit_code: string;
  ownership_kind: string;
  qty_on_hand: number;
  min_qty: number | null;
  default_location_id: string | null;
  active: boolean;
};

export type InventoryCategoryRow = {
  id: string;
  parent_id: string | null;
  code: string;
  name_bg: string;
  name_ru: string;
  name_en: string;
  sort_order: number;
  active: boolean;
  archived_at: string | null;
  allowed_tracking_type: string | null;
};

export type InventoryLocationRow = {
  id: string;
  code: string;
  name: string;
  location_kind: string;
  property_id: number | null;
  active: boolean;
  note: string | null;
};

export type InventorySessionRow = {
  id: string;
  title: string;
  status: string;
  row_version: number;
  started_at: string | null;
  approved_at: string | null;
  closed_at: string | null;
  scope_note: string | null;
  zone_location_id: string | null;
  category_id: string | null;
  created_at: string;
};

export type InventorySessionItemRow = {
  id: string;
  session_id: string;
  tracking_type: string;
  draft_name: string;
  draft_inventory_number: string | null;
  draft_sku_code: string | null;
  draft_category_id?: string | null;
  draft_ownership_kind?: string | null;
  draft_location_id?: string | null;
  draft_condition?: string | null;
  finding_status: string;
  counted_qty: number | null;
  expected_qty: number | null;
  unit_code: string | null;
  discrepancy_note: string | null;
  row_version: number;
  posted_at: string | null;
  entered_by_staff_id?: number | null;
  entered_by_email?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type InventoryDocumentRow = {
  id: string;
  asset_id: string | null;
  session_item_id: string | null;
  title: string;
  doc_kind: string;
  storage_path: string;
  mime_type: string | null;
  archived_at: string | null;
  created_at: string;
};

export type InventoryOverviewStats = {
  activeAssets: number;
  byCategory: Record<string, number>;
  byOwnership: Record<string, number>;
  byCondition: Record<string, number>;
  stockSkuCount: number;
  lowStockCount: number;
  activeSessions: number;
  pendingReview: number;
};

export const INVENTORY_OWNERSHIP = INV1_OWNERSHIP_KINDS;
export const INVENTORY_SESSION_STATUSES = INV1_SESSION_STATUSES;
export const INVENTORY_MOVEMENT_TYPES = INV1_STOCK_MOVEMENT_TYPES;

/** UX gate: administration role only (RPCs enforce real authz). */
export function canSeeInventoryAdmin(role?: string | null): boolean {
  return String(role ?? '').trim() === 'администрация';
}

/** Hide Inventory while building_modules.inventory is not enabled (DISABLED). */
export function shouldShowInventoryAdmin(
  role: string | null | undefined,
  modules: BuildingModulesState | null | undefined,
): boolean {
  return canSeeInventoryAdmin(role) && isBuildingModuleEnabled(modules, INVENTORY_MODULE_KEY);
}

export function inventoryAssetStatusTone(
  status: string,
): 'warning' | 'info' | 'success' | 'danger' | 'neutral' {
  if (status === 'draft') return 'warning';
  if (status === 'active' || status === 'assigned') return 'success';
  if (status === 'maintenance') return 'info';
  if (status === 'written_off' || status === 'archived') return 'danger';
  return 'neutral';
}

export function inventorySessionStatusTone(
  status: string,
): 'warning' | 'info' | 'success' | 'danger' | 'neutral' {
  if (status === 'DRAFT') return 'neutral';
  if (status === 'IN_PROGRESS') return 'info';
  if (status === 'REVIEW') return 'warning';
  if (status === 'APPROVED') return 'success';
  if (status === 'CLOSED') return 'neutral';
  return 'neutral';
}

export function categoryDisplayName(
  cat: Pick<InventoryCategoryRow, 'name_bg' | 'name_ru' | 'name_en'>,
  locale: string,
): string {
  if (locale === 'bg') return cat.name_bg;
  if (locale === 'en') return cat.name_en;
  return cat.name_ru;
}

export function computeInventoryOverview(args: {
  assets: InventoryAssetRow[];
  balances: InventoryStockBalanceRow[];
  sessions: InventorySessionRow[];
  categoryNameById: Record<string, string>;
}): InventoryOverviewStats {
  const activeAssets = args.assets.filter(
    (a) => !['written_off', 'archived', 'draft'].includes(a.operational_status),
  );
  const byCategory: Record<string, number> = {};
  const byOwnership: Record<string, number> = {};
  const byCondition: Record<string, number> = {};
  for (const a of activeAssets) {
    const cat = a.category_id
      ? args.categoryNameById[a.category_id] ?? a.category_id
      : '—';
    byCategory[cat] = (byCategory[cat] ?? 0) + 1;
    byOwnership[a.ownership_kind] = (byOwnership[a.ownership_kind] ?? 0) + 1;
    byCondition[a.condition] = (byCondition[a.condition] ?? 0) + 1;
  }
  const activeBalances = args.balances.filter((b) => b.active);
  const lowStockCount = activeBalances.filter(
    (b) => b.min_qty != null && Number(b.qty_on_hand) < Number(b.min_qty),
  ).length;
  const activeSessions = args.sessions.filter((s) =>
    ['DRAFT', 'IN_PROGRESS', 'REVIEW'].includes(s.status),
  ).length;
  const pendingReview = args.sessions.filter((s) => s.status === 'REVIEW').length;
  return {
    activeAssets: activeAssets.length,
    byCategory,
    byOwnership,
    byCondition,
    stockSkuCount: activeBalances.length,
    lowStockCount,
    activeSessions,
    pendingReview,
  };
}

export function filterAssets(
  assets: InventoryAssetRow[],
  q: {
    search?: string;
    categoryId?: string;
    ownership?: string;
    status?: string;
    condition?: string;
    locationId?: string;
  },
): InventoryAssetRow[] {
  const s = (q.search ?? '').trim().toLowerCase();
  return assets.filter((a) => {
    if (q.categoryId && a.category_id !== q.categoryId) return false;
    if (q.ownership && a.ownership_kind !== q.ownership) return false;
    if (q.status && a.operational_status !== q.status) return false;
    if (q.condition && a.condition !== q.condition) return false;
    if (q.locationId && a.location_id !== q.locationId) return false;
    if (!s) return true;
    return (
      a.inventory_number.toLowerCase().includes(s) ||
      a.name.toLowerCase().includes(s) ||
      (a.serial_number ?? '').toLowerCase().includes(s)
    );
  });
}

/** Loose RPC helper — INV tables/RPCs are not yet in database.types.ts. */
export async function inventoryRpc<T = unknown>(
  supabase: SupabaseClient<Database>,
  fn: string,
  args: Record<string, unknown> = {},
): Promise<{ data: T | null; error: { message: string } | null }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc(fn, args);
  return {
    data: (data as T | null) ?? null,
    error: error ? { message: String(error.message ?? error) } : null,
  };
}

/** Loose table select helper. */
export async function inventorySelect<T = unknown>(
  supabase: SupabaseClient<Database>,
  table: string,
  columns = '*',
  options?: { order?: { column: string; ascending?: boolean }; eq?: Record<string, unknown> },
): Promise<{ data: T[]; error: { message: string } | null }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = (supabase as any).from(table).select(columns);
  if (options?.eq) {
    for (const [k, v] of Object.entries(options.eq)) {
      q = q.eq(k, v);
    }
  }
  if (options?.order) {
    q = q.order(options.order.column, { ascending: options.order.ascending ?? true });
  }
  const { data, error } = await q;
  return {
    data: ((data as T[]) ?? []) as T[],
    error: error ? { message: String(error.message ?? error) } : null,
  };
}

/** Detect finance-side-effect strings that must never appear in Inventory UI actions. */
export const INVENTORY_UI_FORBIDDEN_FINANCE = [
  'uk_expenses',
  'charge_support_fee',
  'record_support_payment',
  'capital_repair_ledger',
  'internet_ledger',
] as const;

export function inventoryUiMentionsFinance(source: string): boolean {
  const lower = source.toLowerCase();
  return INVENTORY_UI_FORBIDDEN_FINANCE.some((f) => lower.includes(f.toLowerCase()));
}
