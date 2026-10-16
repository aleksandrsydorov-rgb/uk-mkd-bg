import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import {
  INV1_MIGRATION,
  INV1_OWNERSHIP_KINDS,
  INV1_SEED_CATEGORY_CODES,
  INV1_SESSION_STATUSES,
  INV1_STOCK_MOVEMENT_TYPES,
  analyzeInv1MigrationSql,
  assertOptimisticRowVersion,
  detectSessionDuplicateKeys,
  inventoryMigrationHasNoFinanceSideEffects,
  missingInv1ContractTokens,
  projectedStockOnHand,
  sessionMayPostToRegister,
  wouldCreateCategoryCycle,
} from '@/lib/inventory';

const MIGRATION = path.resolve(process.cwd(), INV1_MIGRATION);

function sql(): string {
  return readFileSync(MIGRATION, 'utf8');
}

describe('INV-1 · migration packaging', () => {
  it('additive migration file exists and sorts after IS-10d', () => {
    const names = readdirSync(path.resolve(process.cwd(), 'supabase/migrations')).filter((f) =>
      f.endsWith('.sql'),
    );
    expect(names).toContain('20261031120000_inv1_inventory_foundation.sql');
    const is10d = names.indexOf(
      '20261030120000_is10d_distributive_neutralize_amadeus11_sf_cutover.sql',
    );
    const inv1 = names.indexOf('20261031120000_inv1_inventory_foundation.sql');
    expect(is10d).toBeGreaterThanOrEqual(0);
    expect(inv1).toBeGreaterThan(is10d);
  });

  it('satisfies full INV-1 DDL contract', () => {
    const a = analyzeInv1MigrationSql(sql());
    expect(a.missingTables).toEqual([]);
    expect(a.missingHelpers).toEqual([]);
    expect(a.missingSeedCodes).toEqual([]);
    expect(a.hasAllCoreTables).toBe(true);
    expect(a.hasAuthHelpers).toBe(true);
    expect(a.hasSeedCatalog).toBe(true);
    expect(a.hasCyclePrevention).toBe(true);
    expect(a.hasNonnegStock).toBe(true);
    expect(a.hasImmutableMovements).toBe(true);
    expect(a.hasImmutableAssetEvents).toBe(true);
    expect(a.hasImmutableSessionEvents).toBe(true);
    expect(a.hasOptimisticLocking).toBe(true);
    expect(a.hasOwnershipKinds).toBe(true);
    expect(a.hasSessionLifecycle).toBe(true);
    expect(a.hasCapabilityTable).toBe(true);
    expect(a.moduleNotAutoActivated).toBe(true);
    expect(a.emptyAssetsOnSeed).toBe(true);
    expect(a.hasRlsEnabled).toBe(true);
    expect(a.hasAdminApprovalHelper).toBe(true);
    expect(a.financeSideEffects).toEqual([]);
    expect(missingInv1ContractTokens(sql())).toEqual([]);
  });

  it('seeds BG/RU/EN category catalog without assets', () => {
    const text = sql();
    for (const code of INV1_SEED_CATEGORY_CODES) {
      expect(text).toContain(`'${code}'`);
    }
    expect(text).toContain('Инструменти');
    expect(text).toContain('Инструменты');
    expect(text).toContain("'Tools'");
    expect(text).toContain('Floor cleaning machines');
    expect(text).toMatch(/Empty on fresh install/i);
    expect(text).not.toMatch(/insert into public\.inventory_assets\b/i);
    expect(text).not.toMatch(/insert into public\.inventory_stock_items\b/i);
  });

  it('encodes ownership, tracking, session and movement enums', () => {
    const text = sql();
    for (const k of INV1_OWNERSHIP_KINDS) expect(text).toContain(`'${k}'`);
    for (const s of INV1_SESSION_STATUSES) expect(text).toContain(`'${s}'`);
    for (const m of INV1_STOCK_MOVEMENT_TYPES) expect(text).toContain(`'${m}'`);
    expect(text).toContain("'INDIVIDUAL_ASSET'");
    expect(text).toContain("'QUANTITY_STOCK'");
    expect(text).toContain('inventory_assets_number_uidx');
    expect(text).toContain('internal_balance');
  });

  it('has no financial ledger side effects', () => {
    expect(inventoryMigrationHasNoFinanceSideEffects(sql())).toBe(true);
    const text = sql();
    expect(text).not.toMatch(/insert into public\.support_fee/i);
    expect(text).not.toMatch(/insert into public\.uk_expenses\b/i);
    expect(text).not.toMatch(/charge_support_fee/i);
    expect(text).not.toMatch(/record_support_payment/i);
  });

  it('registers inventory for Module Lifecycle without auto-activation', () => {
    const text = sql();
    expect(text).toContain("module_key = 'inventory'");
    expect(text).toContain("'DISABLED'");
    expect(text).toMatch(/Do not auto-activate|Do not force implemented|keep implemented=false/i);
    expect(text).toContain("'inventory', false");
  });

  it('wires granular RLS helpers and capability columns', () => {
    const text = sql();
    expect(text).toContain('staff_inventory_capabilities');
    expect(text).toContain('can_approve_inventory_session');
    expect(text).toContain('can_participate_inventory_session');
    expect(text).toContain("has_staff_role('администрация')");
    expect(text).toContain('enable row level security');
    expect(text).toMatch(/revoke all on table public\.inventory_assets/i);
  });
});

describe('INV-1 · category nesting & cycle protection', () => {
  const tree = [
    { id: 'root', parentId: null },
    { id: 'machinery', parentId: 'root' },
    { id: 'cleaning', parentId: 'machinery' },
    { id: 'floor', parentId: 'cleaning' },
  ];

  it('allows valid nesting', () => {
    expect(wouldCreateCategoryCycle(tree, 'floor', 'machinery')).toBe(false);
    expect(wouldCreateCategoryCycle(tree, 'new', 'floor')).toBe(false);
  });

  it('blocks self and ancestor cycles', () => {
    expect(wouldCreateCategoryCycle(tree, 'machinery', 'machinery')).toBe(true);
    expect(wouldCreateCategoryCycle(tree, 'machinery', 'floor')).toBe(true);
    expect(wouldCreateCategoryCycle(tree, 'root', 'floor')).toBe(true);
  });
});

describe('INV-1 · stock quantity invariants', () => {
  it('accepts opening/receipt and rejects negative on-hand', () => {
    expect(projectedStockOnHand(0, 10, 'OPENING')).toEqual({ ok: true, next: 10 });
    expect(projectedStockOnHand(10, 5, 'RECEIPT')).toEqual({ ok: true, next: 15 });
    expect(projectedStockOnHand(10, -3, 'ISSUE')).toEqual({ ok: true, next: 7 });
    expect(projectedStockOnHand(2, -5, 'ISSUE')).toEqual({
      ok: false,
      next: -3,
      reason: 'negative',
    });
    expect(projectedStockOnHand(5, -5, 'WRITE_OFF')).toEqual({ ok: true, next: 0 });
  });

  it('enforces movement sign rules and transfer neutrality', () => {
    expect(projectedStockOnHand(5, -1, 'RECEIPT').ok).toBe(false);
    expect(projectedStockOnHand(5, 1, 'ISSUE').ok).toBe(false);
    expect(projectedStockOnHand(5, 0, 'ADJUSTMENT').reason).toBe('qty_zero');
    expect(projectedStockOnHand(5, -2, 'TRANSFER')).toEqual({ ok: true, next: 5 });
  });
});

describe('INV-1 · collaborative session rules', () => {
  it('optimistic locking increments only on match', () => {
    expect(assertOptimisticRowVersion(3, 3)).toEqual({ ok: true, nextVersion: 4 });
    expect(assertOptimisticRowVersion(3, 4)).toEqual({ ok: false });
  });

  it('detects duplicate asset/sku/number findings', () => {
    const dupes = detectSessionDuplicateKeys([
      { assetId: 'a1', findingStatus: 'draft' },
      { assetId: 'a1', findingStatus: 'submitted' },
      { draftInventoryNumber: 'INV-9', findingStatus: 'draft' },
      { draftInventoryNumber: 'inv-9', findingStatus: 'draft' },
      { stockItemId: 's1', findingStatus: 'rejected' },
      { stockItemId: 's1', findingStatus: 'draft' },
    ]);
    expect(dupes).toEqual(expect.arrayContaining(['asset:a1', 'num:inv-9']));
    expect(dupes).not.toContain('stock:s1');
  });

  it('only APPROVED sessions may post to internal register', () => {
    expect(sessionMayPostToRegister('DRAFT')).toBe(false);
    expect(sessionMayPostToRegister('IN_PROGRESS')).toBe(false);
    expect(sessionMayPostToRegister('REVIEW')).toBe(false);
    expect(sessionMayPostToRegister('APPROVED')).toBe(true);
    expect(sessionMayPostToRegister('CLOSED')).toBe(false);
  });
});
