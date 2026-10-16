/**
 * INV-2 — Inventory operations contract (pure analysis + lifecycle helpers).
 */

export const INV2_MIGRATION =
  'supabase/migrations/20261101120000_inv2_inventory_operations.sql';

export const INV2_ASSET_RPCS = [
  'inventory_create_draft_asset',
  'inventory_update_asset',
  'inventory_set_asset_number',
  'inventory_activate_asset',
  'inventory_assign_asset',
  'inventory_transfer_asset',
  'inventory_set_asset_condition',
  'inventory_record_maintenance',
  'inventory_propose_asset_write_off',
  'inventory_approve_asset_write_off',
  'inventory_archive_asset',
] as const;

export const INV2_CATEGORY_LOCATION_RPCS = [
  'inventory_upsert_category',
  'inventory_archive_category',
  'inventory_upsert_location',
  'inventory_archive_location',
] as const;

export const INV2_STOCK_RPCS = [
  'inventory_register_stock_item',
  'inventory_stock_move',
] as const;

export const INV2_SESSION_RPCS = [
  'inventory_create_session',
  'inventory_add_session_participant',
  'inventory_start_session',
  'inventory_add_session_item',
  'inventory_update_session_item',
  'inventory_submit_session_item',
  'inventory_submit_session_for_review',
  'inventory_review_session_item',
  'inventory_approve_and_post_session',
  'inventory_close_session',
  'inventory_post_session_item',
] as const;

export const INV2_ALL_RPCS = [
  ...INV2_ASSET_RPCS,
  ...INV2_CATEGORY_LOCATION_RPCS,
  ...INV2_STOCK_RPCS,
  ...INV2_SESSION_RPCS,
  'inventory_set_staff_capabilities',
  'inventory_assert_cap',
  'inventory_assert_authenticated',
  'inventory_log_asset_event',
  'inventory_log_session_event',
] as const;

export const INV2_FORBIDDEN_FINANCE_PATTERNS = [
  /insert\s+into\s+public\.support_fee/i,
  /insert\s+into\s+public\.capital_repair/i,
  /insert\s+into\s+public\.internet_ledger/i,
  /insert\s+into\s+public\.uk_expenses\b/i,
  /record_support_payment/i,
  /record_internet_payment/i,
  /charge_support_fee/i,
  /charge_capital_repair/i,
] as const;

export type AssetLifecycleStatus =
  | 'draft'
  | 'active'
  | 'assigned'
  | 'maintenance'
  | 'written_off'
  | 'archived';

const ASSET_TRANSITIONS: Record<AssetLifecycleStatus, AssetLifecycleStatus[]> = {
  draft: ['active'],
  active: ['assigned', 'maintenance', 'written_off'],
  assigned: ['assigned', 'maintenance', 'active', 'written_off'],
  maintenance: ['active', 'assigned', 'maintenance', 'written_off'],
  written_off: ['archived'],
  archived: [],
};

export function assetTransitionAllowed(
  from: AssetLifecycleStatus,
  to: AssetLifecycleStatus,
): boolean {
  return ASSET_TRANSITIONS[from]?.includes(to) ?? false;
}

export type SessionStatus = 'DRAFT' | 'IN_PROGRESS' | 'REVIEW' | 'APPROVED' | 'CLOSED';

const SESSION_TRANSITIONS: Record<SessionStatus, SessionStatus[]> = {
  DRAFT: ['IN_PROGRESS'],
  IN_PROGRESS: ['IN_PROGRESS', 'REVIEW', 'APPROVED'],
  REVIEW: ['APPROVED'],
  APPROVED: ['CLOSED'],
  CLOSED: [],
};

export function sessionTransitionAllowed(from: SessionStatus, to: SessionStatus): boolean {
  return SESSION_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Only administrator (or approve_sessions capability) may approve. */
export function mayApproveSession(actor: {
  isAdmin: boolean;
  canApproveSessions: boolean;
  isParticipantOnly: boolean;
}): boolean {
  if (actor.isAdmin || actor.canApproveSessions) return true;
  return false;
}

export function stockMoveDelta(
  movementType: string,
  qty: number,
): { ok: boolean; delta?: number; reason?: string } {
  if (!qty || qty === 0) return { ok: false, reason: 'qty_zero' };
  const abs = Math.abs(qty);
  switch (movementType) {
    case 'OPENING':
    case 'RECEIPT':
      return { ok: true, delta: abs };
    case 'ISSUE':
    case 'WRITE_OFF':
      return { ok: true, delta: -abs };
    case 'ADJUSTMENT':
      return { ok: true, delta: qty };
    case 'TRANSFER':
      return { ok: true, delta: abs };
    default:
      return { ok: false, reason: 'type' };
  }
}

export function sessionPostStockDelta(args: {
  countedQty: number;
  onHand: number;
  hasMovements: boolean;
}): { kind: 'none' | 'OPENING' | 'ADJUSTMENT'; qty: number } {
  const delta = args.countedQty - args.onHand;
  if (delta === 0) return { kind: 'none', qty: 0 };
  if (delta > 0 && args.onHand === 0 && !args.hasMovements) {
    return { kind: 'OPENING', qty: delta };
  }
  return { kind: 'ADJUSTMENT', qty: delta };
}

export type Inv2MigrationAnalysis = {
  hasAssetRpcs: boolean;
  hasCategoryLocationRpcs: boolean;
  hasStockRpcs: boolean;
  hasSessionRpcs: boolean;
  hasPosting: boolean;
  hasOptimisticLocking: boolean;
  hasIdempotency: boolean;
  hasAdminApprovalGate: boolean;
  moduleNotAutoEnabled: boolean;
  financeSideEffects: string[];
  missingRpcs: string[];
};

export function analyzeInv2MigrationSql(sql: string): Inv2MigrationAnalysis {
  const missingRpcs = INV2_ALL_RPCS.filter(
    (name) => !sql.includes(`function public.${name}`),
  );
  const financeSideEffects = INV2_FORBIDDEN_FINANCE_PATTERNS.filter((re) =>
    re.test(sql),
  ).map((re) => re.source);

  return {
    hasAssetRpcs: INV2_ASSET_RPCS.every((r) => sql.includes(`function public.${r}`)),
    hasCategoryLocationRpcs: INV2_CATEGORY_LOCATION_RPCS.every((r) =>
      sql.includes(`function public.${r}`),
    ),
    hasStockRpcs: INV2_STOCK_RPCS.every((r) => sql.includes(`function public.${r}`)),
    hasSessionRpcs: INV2_SESSION_RPCS.every((r) => sql.includes(`function public.${r}`)),
    hasPosting:
      sql.includes('inventory_approve_and_post_session') &&
      sql.includes('inventory_post_session_item') &&
      sql.includes('internal_balance'),
    hasOptimisticLocking:
      sql.includes('stale session row_version') &&
      sql.includes('stale item row_version'),
    hasIdempotency: sql.includes('idempotency_key'),
    hasAdminApprovalGate: sql.includes('administrator approval required'),
    moduleNotAutoEnabled:
      !/update\s+public\.building_modules[\s\S]{0,200}enabled\s*=\s*true/i.test(sql) &&
      !/set\s+enabled\s*=\s*true/i.test(sql) &&
      /implemented\s*=\s*false/i.test(sql),
    financeSideEffects,
    missingRpcs,
  };
}
