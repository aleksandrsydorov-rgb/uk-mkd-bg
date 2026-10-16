/**
 * INV-1 — Inventory foundation schema contract (pure analysis helpers).
 * Movement/session operational RPCs are INV-2+; this module asserts DDL shape only.
 */

export const INV1_MIGRATION =
  'supabase/migrations/20261031120000_inv1_inventory_foundation.sql';

export const INV1_OWNERSHIP_KINDS = [
  'CONDOMINIUM',
  'MANAGEMENT_COMPANY',
  'THIRD_PARTY',
] as const;

export const INV1_TRACKING_TYPES = ['INDIVIDUAL_ASSET', 'QUANTITY_STOCK'] as const;

export const INV1_ASSET_STATUSES = [
  'draft',
  'active',
  'assigned',
  'maintenance',
  'written_off',
  'archived',
] as const;

export const INV1_CONDITIONS = [
  'new',
  'good',
  'fair',
  'poor',
  'unserviceable',
] as const;

export const INV1_STOCK_MOVEMENT_TYPES = [
  'OPENING',
  'RECEIPT',
  'ISSUE',
  'TRANSFER',
  'ADJUSTMENT',
  'WRITE_OFF',
] as const;

export const INV1_SESSION_STATUSES = [
  'DRAFT',
  'IN_PROGRESS',
  'REVIEW',
  'APPROVED',
  'CLOSED',
] as const;

export const INV1_SEED_CATEGORY_CODES = [
  'tools',
  'machinery',
  'cleaning_equipment',
  'furniture',
  'electronics',
  'security_safety',
  'pool_territory',
  'household',
  'materials_consumables',
  'other',
  'machinery_cleaning',
  'machinery_cleaning_floor',
] as const;

export const INV1_CORE_TABLES = [
  'inventory_categories',
  'inventory_locations',
  'inventory_assets',
  'inventory_assignments',
  'inventory_maintenance_events',
  'inventory_documents',
  'inventory_asset_events',
  'inventory_asset_expense_links',
  'inventory_units',
  'inventory_stock_items',
  'inventory_stock_movements',
  'inventory_sessions',
  'inventory_session_participants',
  'inventory_session_items',
  'inventory_session_events',
  'staff_inventory_capabilities',
] as const;

export const INV1_AUTH_HELPERS = [
  'inventory_module_enabled',
  'inventory_is_admin',
  'inventory_current_staff_id',
  'inventory_staff_cap',
  'can_view_inventory',
  'can_edit_inventory_assets',
  'can_manage_inventory_categories',
  'can_register_inventory_stock_moves',
  'can_participate_inventory_session',
  'can_review_inventory_session',
  'can_approve_inventory_session',
  'can_write_off_inventory',
  'inventory_stock_on_hand',
] as const;

export const INV1_CAPABILITY_COLUMNS = [
  'can_view',
  'can_edit_assets',
  'can_manage_categories',
  'can_stock_move',
  'can_session_participate',
  'can_session_review',
  'can_approve_sessions',
  'can_write_off',
] as const;

/** Forbidden financial side-effect patterns in INV-1 DDL. */
export const INV1_FORBIDDEN_FINANCE_PATTERNS = [
  /insert\s+into\s+public\.support_fee/i,
  /insert\s+into\s+public\.capital_repair/i,
  /insert\s+into\s+public\.internet_ledger/i,
  /record_support_payment/i,
  /record_internet_payment/i,
  /charge_support_fee/i,
  /charge_capital_repair/i,
  /insert\s+into\s+public\.uk_expenses\b/i,
] as const;

export type Inv1MigrationAnalysis = {
  hasAllCoreTables: boolean;
  missingTables: string[];
  hasAuthHelpers: boolean;
  missingHelpers: string[];
  hasSeedCatalog: boolean;
  missingSeedCodes: string[];
  hasCyclePrevention: boolean;
  hasNonnegStock: boolean;
  hasImmutableMovements: boolean;
  hasImmutableAssetEvents: boolean;
  hasImmutableSessionEvents: boolean;
  hasOptimisticLocking: boolean;
  hasOwnershipKinds: boolean;
  hasSessionLifecycle: boolean;
  hasCapabilityTable: boolean;
  moduleNotAutoActivated: boolean;
  emptyAssetsOnSeed: boolean;
  financeSideEffects: string[];
  hasRlsEnabled: boolean;
  hasAdminApprovalHelper: boolean;
};

function missingTokens(sql: string, tokens: readonly string[]): string[] {
  return tokens.filter((t) => !sql.includes(t));
}

export function analyzeInv1MigrationSql(sql: string): Inv1MigrationAnalysis {
  const missingTables = INV1_CORE_TABLES.filter(
    (t) => !sql.includes(`create table if not exists public.${t}`),
  );
  const missingHelpers = INV1_AUTH_HELPERS.filter(
    (h) => !sql.includes(`function public.${h}`),
  );
  const missingSeedCodes = INV1_SEED_CATEGORY_CODES.filter(
    (c) => !sql.includes(`'${c}'`),
  );

  const financeSideEffects = INV1_FORBIDDEN_FINANCE_PATTERNS.filter((re) =>
    re.test(sql),
  ).map((re) => re.source);

  const createsAssetRowsInSeed =
    /insert into public\.inventory_assets\b/i.test(sql) ||
    /insert into public\.inventory_stock_items\b/i.test(sql);

  return {
    hasAllCoreTables: missingTables.length === 0,
    missingTables,
    hasAuthHelpers: missingHelpers.length === 0,
    missingHelpers,
    hasSeedCatalog: missingSeedCodes.length === 0,
    missingSeedCodes,
    hasCyclePrevention:
      sql.includes('inventory_category_prevent_cycle') &&
      sql.includes('cycle detected'),
    hasNonnegStock:
      sql.includes('inventory_stock_movements_nonneg') &&
      sql.includes('negative stock not allowed'),
    hasImmutableMovements:
      sql.includes('inventory_stock_movements_immutable') &&
      sql.includes('append-only'),
    hasImmutableAssetEvents: sql.includes('inventory_asset_events_immutable'),
    hasImmutableSessionEvents: sql.includes('inventory_session_events_immutable'),
    hasOptimisticLocking: sql.includes('row_version'),
    hasOwnershipKinds: INV1_OWNERSHIP_KINDS.every((k) => sql.includes(`'${k}'`)),
    hasSessionLifecycle: INV1_SESSION_STATUSES.every((s) => sql.includes(`'${s}'`)),
    hasCapabilityTable: INV1_CAPABILITY_COLUMNS.every((c) => sql.includes(c)),
    moduleNotAutoActivated:
      /'inventory',\s*false/i.test(sql) &&
      !/building_modules[\s\S]{0,400}enabled\s*=\s*true/i.test(sql) &&
      !/set\s+implemented\s*=\s*true/i.test(sql),
    emptyAssetsOnSeed: !createsAssetRowsInSeed,
    financeSideEffects,
    hasRlsEnabled: /enable row level security/i.test(sql),
    hasAdminApprovalHelper: sql.includes('can_approve_inventory_session'),
  };
}

/** Category tree cycle check (application-level mirror of SQL trigger walk). */
export function wouldCreateCategoryCycle(
  nodes: ReadonlyArray<{ id: string; parentId: string | null }>,
  nodeId: string,
  newParentId: string | null,
): boolean {
  if (newParentId == null) return false;
  if (newParentId === nodeId) return true;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  let walk: string | null = newParentId;
  let guard = 0;
  while (walk != null) {
    if (walk === nodeId) return true;
    guard += 1;
    if (guard > 64) return true;
    walk = byId.get(walk)?.parentId ?? null;
  }
  return false;
}

/** Projected on-hand after a signed delta (TRANSFER excluded at SQL layer). */
export function projectedStockOnHand(
  currentOnHand: number,
  qtyDelta: number,
  movementType: (typeof INV1_STOCK_MOVEMENT_TYPES)[number],
): { ok: boolean; next: number; reason?: string } {
  if (qtyDelta === 0) {
    return { ok: false, next: currentOnHand, reason: 'qty_zero' };
  }
  if (movementType === 'TRANSFER') {
    return { ok: true, next: currentOnHand };
  }
  if (
    (movementType === 'OPENING' || movementType === 'RECEIPT') &&
    qtyDelta <= 0
  ) {
    return { ok: false, next: currentOnHand, reason: 'sign' };
  }
  if (
    (movementType === 'ISSUE' || movementType === 'WRITE_OFF') &&
    qtyDelta >= 0
  ) {
    return { ok: false, next: currentOnHand, reason: 'sign' };
  }
  const next = currentOnHand + qtyDelta;
  if (next < 0) {
    return { ok: false, next, reason: 'negative' };
  }
  return { ok: true, next };
}

/** Session approval boundary: only APPROVED (or CLOSED after) may post. */
export function sessionMayPostToRegister(
  status: (typeof INV1_SESSION_STATUSES)[number],
): boolean {
  return status === 'APPROVED';
}

/** Draft concurrency: updates require matching row_version. */
export function assertOptimisticRowVersion(
  expected: number,
  actual: number,
): { ok: boolean; nextVersion?: number } {
  if (expected !== actual) return { ok: false };
  return { ok: true, nextVersion: actual + 1 };
}

/** Duplicate finding keys within one session. */
export function detectSessionDuplicateKeys(
  items: ReadonlyArray<{
    assetId?: string | null;
    stockItemId?: string | null;
    draftInventoryNumber?: string | null;
    findingStatus: string;
  }>,
): string[] {
  const seen = new Set<string>();
  const dupes: string[] = [];
  for (const it of items) {
    if (it.findingStatus === 'rejected') continue;
    const keys = [
      it.assetId ? `asset:${it.assetId}` : null,
      it.stockItemId ? `stock:${it.stockItemId}` : null,
      it.draftInventoryNumber
        ? `num:${it.draftInventoryNumber.trim().toLowerCase()}`
        : null,
    ].filter(Boolean) as string[];
    for (const k of keys) {
      if (seen.has(k)) dupes.push(k);
      else seen.add(k);
    }
  }
  return dupes;
}

export function inventoryMigrationHasNoFinanceSideEffects(sql: string): boolean {
  return analyzeInv1MigrationSql(sql).financeSideEffects.length === 0;
}

export function missingInv1ContractTokens(sql: string): string[] {
  const a = analyzeInv1MigrationSql(sql);
  return [
    ...a.missingTables.map((t) => `table:${t}`),
    ...a.missingHelpers.map((h) => `helper:${h}`),
    ...a.missingSeedCodes.map((c) => `seed:${c}`),
    ...missingTokens(sql, [
      'inventory_number',
      'ownership_kind',
      'qty_delta',
      'idempotency_key',
      'opening_import',
      'internal_balance',
    ]),
  ];
}
