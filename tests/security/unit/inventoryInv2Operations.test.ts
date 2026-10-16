import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import {
  INV1_MIGRATION,
  INV2_MIGRATION,
  analyzeInv1MigrationSql,
  analyzeInv2MigrationSql,
  assetTransitionAllowed,
  mayApproveSession,
  sessionPostStockDelta,
  sessionTransitionAllowed,
  stockMoveDelta,
  wouldCreateCategoryCycle,
} from '@/lib/inventory';

const INV2 = path.resolve(process.cwd(), INV2_MIGRATION);
const INV1 = path.resolve(process.cwd(), INV1_MIGRATION);

function sql2(): string {
  return readFileSync(INV2, 'utf8');
}

describe('INV-2 · migration packaging', () => {
  it('orders after INV-1 and does not edit historical migrations', () => {
    const names = readdirSync(path.resolve(process.cwd(), 'supabase/migrations')).filter((f) =>
      f.endsWith('.sql'),
    );
    expect(names).toContain('20261031120000_inv1_inventory_foundation.sql');
    expect(names).toContain('20261101120000_inv2_inventory_operations.sql');
    expect(names).toContain('20261101120100_inv2_inventory_admin_role_fix.sql');
    expect(names.indexOf('20261101120000_inv2_inventory_operations.sql')).toBeGreaterThan(
      names.indexOf('20261031120000_inv1_inventory_foundation.sql'),
    );
    expect(names.indexOf('20261101120100_inv2_inventory_admin_role_fix.sql')).toBeGreaterThan(
      names.indexOf('20261101120000_inv2_inventory_operations.sql'),
    );
    // INV-1 file untouched as foundation reference
    expect(analyzeInv1MigrationSql(readFileSync(INV1, 'utf8')).hasAllCoreTables).toBe(true);
  });

  it('defines full RPC surface without finance side effects or auto-enable', () => {
    const a = analyzeInv2MigrationSql(sql2());
    expect(a.missingRpcs).toEqual([]);
    expect(a.hasAssetRpcs).toBe(true);
    expect(a.hasCategoryLocationRpcs).toBe(true);
    expect(a.hasStockRpcs).toBe(true);
    expect(a.hasSessionRpcs).toBe(true);
    expect(a.hasPosting).toBe(true);
    expect(a.hasOptimisticLocking).toBe(true);
    expect(a.hasIdempotency).toBe(true);
    expect(a.hasAdminApprovalGate).toBe(true);
    expect(a.moduleNotAutoEnabled).toBe(true);
    expect(a.financeSideEffects).toEqual([]);
  });

  it('gates approval and write-off to administrator', () => {
    const text = sql2();
    expect(text).toContain('administrator approval required');
    expect(text).toContain('admin approval required for write-off');
    expect(text).toContain('stale session row_version');
    expect(text).toContain('stale item row_version');
    expect(text).toContain('security definer');
    expect(text).not.toMatch(/update\s+public\.building_modules[\s\S]{0,200}enabled\s*=\s*true/i);
    expect(text).toMatch(/Do not set building_modules\.enabled = true/i);
  });
});

describe('INV-2 · asset lifecycle rules', () => {
  it('allows canonical transitions only', () => {
    expect(assetTransitionAllowed('draft', 'active')).toBe(true);
    expect(assetTransitionAllowed('active', 'assigned')).toBe(true);
    expect(assetTransitionAllowed('assigned', 'maintenance')).toBe(true);
    expect(assetTransitionAllowed('maintenance', 'written_off')).toBe(true);
    expect(assetTransitionAllowed('written_off', 'archived')).toBe(true);
    expect(assetTransitionAllowed('draft', 'written_off')).toBe(false);
    expect(assetTransitionAllowed('archived', 'active')).toBe(false);
    expect(assetTransitionAllowed('written_off', 'active')).toBe(false);
  });
});

describe('INV-2 · category cycle + permissions', () => {
  it('reuses cycle prevention semantics', () => {
    const tree = [
      { id: 'a', parentId: null },
      { id: 'b', parentId: 'a' },
      { id: 'c', parentId: 'b' },
    ];
    expect(wouldCreateCategoryCycle(tree, 'a', 'c')).toBe(true);
    expect(wouldCreateCategoryCycle(tree, 'c', 'a')).toBe(false);
  });

  it('blocks participant-only approval', () => {
    expect(
      mayApproveSession({ isAdmin: false, canApproveSessions: false, isParticipantOnly: true }),
    ).toBe(false);
    expect(
      mayApproveSession({ isAdmin: true, canApproveSessions: false, isParticipantOnly: false }),
    ).toBe(true);
    expect(
      mayApproveSession({ isAdmin: false, canApproveSessions: true, isParticipantOnly: true }),
    ).toBe(true);
  });
});

describe('INV-2 · session lifecycle + concurrency helpers', () => {
  it('enforces DRAFT→…→CLOSED path', () => {
    expect(sessionTransitionAllowed('DRAFT', 'IN_PROGRESS')).toBe(true);
    expect(sessionTransitionAllowed('IN_PROGRESS', 'REVIEW')).toBe(true);
    expect(sessionTransitionAllowed('REVIEW', 'APPROVED')).toBe(true);
    expect(sessionTransitionAllowed('APPROVED', 'CLOSED')).toBe(true);
    expect(sessionTransitionAllowed('DRAFT', 'APPROVED')).toBe(false);
    expect(sessionTransitionAllowed('CLOSED', 'REVIEW')).toBe(false);
  });
});

describe('INV-2 · stock movements + posting math', () => {
  it('normalizes movement signs', () => {
    expect(stockMoveDelta('OPENING', 5)).toEqual({ ok: true, delta: 5 });
    expect(stockMoveDelta('ISSUE', 3)).toEqual({ ok: true, delta: -3 });
    expect(stockMoveDelta('ADJUSTMENT', -2)).toEqual({ ok: true, delta: -2 });
    expect(stockMoveDelta('RECEIPT', 0).ok).toBe(false);
  });

  it('chooses OPENING vs ADJUSTMENT without double-count', () => {
    expect(
      sessionPostStockDelta({ countedQty: 10, onHand: 0, hasMovements: false }),
    ).toEqual({ kind: 'OPENING', qty: 10 });
    expect(
      sessionPostStockDelta({ countedQty: 8, onHand: 10, hasMovements: true }),
    ).toEqual({ kind: 'ADJUSTMENT', qty: -2 });
    expect(
      sessionPostStockDelta({ countedQty: 5, onHand: 5, hasMovements: true }),
    ).toEqual({ kind: 'none', qty: 0 });
    expect(
      sessionPostStockDelta({ countedQty: 3, onHand: 0, hasMovements: true }),
    ).toEqual({ kind: 'ADJUSTMENT', qty: 3 });
  });
});

describe('INV-2 · financial isolation markers', () => {
  it('never posts to financial ledgers from INV-2 SQL', () => {
    const text = sql2();
    expect(text).not.toMatch(/insert into public\.uk_expenses\b/i);
    expect(text).not.toMatch(/insert into public\.support_fee/i);
    expect(text).not.toMatch(/charge_support_fee/i);
    expect(text).not.toMatch(/record_support_payment/i);
    expect(text).toMatch(/Does NOT insert into uk_expenses/i);
  });
});
