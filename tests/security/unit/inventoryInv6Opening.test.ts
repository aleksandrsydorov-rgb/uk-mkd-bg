import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { bg, en, ru } from '@/i18n/messages';
import {
  bootstrapModuleSetupAdapters,
  canTransitionModuleLifecycle,
  getModuleAdapter,
  resetModuleSetupAdaptersForTests,
  suspensionPreservesData,
} from '@/lib/moduleCore';
import {
  INVENTORY_MODULE_KEY,
  INVENTORY_SETUP_SCHEMA_VERSION,
  buildInventoryOpeningTemplateBuffer,
  classifyInventoryOpeningRows,
  commitInventoryOpeningBatch,
  inventoryOpeningIdempotencyKey,
  inventoryOpeningMentionsFinance,
  inventorySetupManualComplete,
  parseInventoryOpeningXlsxBuffer,
  readInventoryOpeningSchemaVersion,
  validateInventoryOpeningRow,
  type InventoryOpeningClassifyContext,
  type InventoryOpeningImportFns,
} from '@/lib/inventory';
import { staffMayApproveFromUi, emptyInventoryStaffCapabilities } from '@/lib/inventory';

const ROOT = process.cwd();

function read(rel: string): string {
  return readFileSync(path.resolve(ROOT, rel), 'utf8');
}

function emptyCtx(overrides?: Partial<InventoryOpeningClassifyContext>): InventoryOpeningClassifyContext {
  return {
    categoriesByCode: new Map([['tools', 'cat-tools']]),
    locationsByCode: new Map([['warehouse', 'loc-wh']]),
    units: new Set(['pcs', 'kg']),
    assetsByNumber: new Map(),
    stockBySku: new Map(),
    sourceRefsSeen: new Set(),
    ...overrides,
  };
}

describe('INV-6 · setup adapter & lifecycle', () => {
  it('registers inventory opening adapter with optional empty/manual/xlsx', () => {
    resetModuleSetupAdaptersForTests();
    bootstrapModuleSetupAdapters();
    const a = getModuleAdapter(INVENTORY_MODULE_KEY);
    expect(a).toBeTruthy();
    expect(a!.registration.requiresInitialSetup).toBe(true);
    expect(a!.registration.setup?.importMethods).toEqual(expect.arrayContaining(['xlsx', 'manual']));
    expect(a!.registration.setup?.schemaVersion).toBe(INVENTORY_SETUP_SCHEMA_VERSION);
    expect(a!.registration.legalOrOperationalGates).toEqual(
      expect.arrayContaining(['empty_inventory_valid', 'no_finance_postings', 'setup_sessions_before_active_ok']),
    );
    expect(a!.validateManual?.({ empty_inventory_ok: true })?.ok).toBe(true);
    expect(a!.validateManual?.({})?.ok).toBe(false);
  });

  it('supports lifecycle path without forcing ACTIVE before sessions', () => {
    expect(canTransitionModuleLifecycle('DISABLED', 'SETUP_REQUIRED')).toBe(true);
    expect(canTransitionModuleLifecycle('SETUP_REQUIRED', 'SETUP_IN_PROGRESS')).toBe(true);
    expect(canTransitionModuleLifecycle('SETUP_IN_PROGRESS', 'READY')).toBe(true);
    expect(canTransitionModuleLifecycle('READY', 'ACTIVE')).toBe(true);
    expect(suspensionPreservesData('ACTIVE', 'SUSPENDED')).toBe(true);
    expect(inventorySetupManualComplete({ skip_import: true })).toBe(true);
    expect(inventorySetupManualComplete({ start_physical_inventory: true })).toBe(true);
  });

  it('wires AdminInitialSetup inventory branches', () => {
    const ui = read('src/components/admin/AdminInitialSetup.tsx');
    expect(ui).toContain('INVENTORY_MODULE_KEY');
    expect(ui).toContain('isInventory');
    expect(ui).toContain('confirmInventoryImport');
    expect(ui).toContain('parseInventoryOpeningXlsxBuffer');
    expect(ui).toContain('commitInventoryOpeningBatch');
    expect(ui).toContain("p_movement_type: 'OPENING'");
    const commit = read('src/lib/inventory/openingCommit.ts');
    expect(commit).not.toMatch(/\.rpc\(\s*['"]charge_support_fee/);
    expect(commit).not.toMatch(/uk_expenses/);
    expect(commit).toContain('financeTouched: false');
    expect(inventoryOpeningMentionsFinance('charge_support_fee()')).toBe(true);
  });
});

describe('INV-6 · XLSX template & validation', () => {
  it('builds versioned template with meta + examples', () => {
    const buf = buildInventoryOpeningTemplateBuffer();
    expect(readInventoryOpeningSchemaVersion(buf)).toBe(INVENTORY_SETUP_SCHEMA_VERSION);
    const parsed = parseInventoryOpeningXlsxBuffer(buf);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.rows.length).toBeGreaterThanOrEqual(4);
    expect(parsed.rows.some((r) => r.tracking_type === 'INDIVIDUAL_ASSET')).toBe(true);
    expect(parsed.rows.some((r) => r.tracking_type === 'QUANTITY_STOCK')).toBe(true);
  });

  it('rejects unsupported schema version', () => {
    const XLSX = require('xlsx');
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([['schema_version', '9.9']]),
      'meta',
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([['tracking_type', 'item_name', 'ownership_kind'], ['INDIVIDUAL_ASSET', 'X', 'CONDOMINIUM']]),
      'inventory',
    );
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    const parsed = parseInventoryOpeningXlsxBuffer(buf);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toContain('unsupported_schema_version');
  });

  it('validates missing inventory number and invalid ownership/qty', () => {
    expect(
      validateInventoryOpeningRow({
        tracking_type: 'INDIVIDUAL_ASSET',
        item_name: 'Drill',
        ownership_kind: 'CONDOMINIUM',
        inventory_number: '',
      }),
    ).toContain('required:inventory_number');
    expect(
      validateInventoryOpeningRow({
        tracking_type: 'QUANTITY_STOCK',
        item_name: 'Bags',
        ownership_kind: 'NOPE',
        sku_code: 'S1',
        unit_code: 'pcs',
        opening_qty: '10',
      }),
    ).toContain('invalid:ownership_kind');
    expect(
      validateInventoryOpeningRow({
        tracking_type: 'QUANTITY_STOCK',
        item_name: 'Bags',
        ownership_kind: 'CONDOMINIUM',
        sku_code: 'S1',
        unit_code: 'pcs',
        opening_qty: '-1',
      }),
    ).toContain('invalid:opening_qty');
  });
});

describe('INV-6 · preview classify (read-only)', () => {
  it('classifies create / skip / conflict / unknown category', () => {
    const ctx = emptyCtx({
      assetsByNumber: new Map([
        [
          'inv-exist',
          {
            id: 'a1',
            inventoryNumber: 'INV-EXIST',
            name: 'Same',
            ownershipKind: 'CONDOMINIUM',
            categoryId: 'cat-tools',
            locationId: 'loc-wh',
            condition: 'good',
            serialNumber: null,
            estimatedValueEur: null,
          },
        ],
        [
          'inv-conflict',
          {
            id: 'a2',
            inventoryNumber: 'INV-CONFLICT',
            name: 'Other',
            ownershipKind: 'CONDOMINIUM',
            categoryId: null,
            locationId: null,
            condition: 'good',
            serialNumber: null,
            estimatedValueEur: null,
          },
        ],
      ]),
      stockBySku: new Map([
        [
          'sku-open',
          {
            id: 's1',
            skuCode: 'SKU-OPEN',
            name: 'Bags',
            unitCode: 'pcs',
            ownershipKind: 'CONDOMINIUM',
            categoryId: null,
            defaultLocationId: null,
            hasOpeningMovement: true,
            qtyOnHand: 10,
          },
        ],
      ]),
    });

    const preview = classifyInventoryOpeningRows(
      [
        {
          tracking_type: 'INDIVIDUAL_ASSET',
          item_name: 'New drill',
          ownership_kind: 'CONDOMINIUM',
          inventory_number: 'INV-NEW',
          category_code: 'tools',
          location_code: 'warehouse',
          condition: 'good',
        },
        {
          tracking_type: 'INDIVIDUAL_ASSET',
          item_name: 'Same',
          ownership_kind: 'CONDOMINIUM',
          inventory_number: 'INV-EXIST',
          category_code: 'tools',
          location_code: 'warehouse',
          condition: 'good',
        },
        {
          tracking_type: 'INDIVIDUAL_ASSET',
          item_name: 'Changed',
          ownership_kind: 'CONDOMINIUM',
          inventory_number: 'INV-CONFLICT',
          condition: 'good',
        },
        {
          tracking_type: 'QUANTITY_STOCK',
          item_name: 'Bags',
          ownership_kind: 'CONDOMINIUM',
          sku_code: 'SKU-OPEN',
          unit_code: 'pcs',
          opening_qty: '10',
        },
        {
          tracking_type: 'INDIVIDUAL_ASSET',
          item_name: 'Bad cat',
          ownership_kind: 'CONDOMINIUM',
          inventory_number: 'INV-BADCAT',
          category_code: 'nope',
          condition: 'good',
        },
      ].map((r) => ({
        category_code: '',
        serial_number: '',
        sku_code: '',
        location_code: '',
        condition: '',
        quantity: '',
        unit_code: '',
        opening_qty: '',
        estimated_value_eur: '',
        source_ref: '',
        notes: '',
        inventory_number: '',
        ...r,
      })) as Record<string, string>[],
      ctx,
    );

    expect(preview.createCount).toBe(1);
    expect(preview.skipCount).toBe(2);
    expect(preview.errorCount).toBeGreaterThanOrEqual(2);
    expect(preview.rows.every((r) => r.data.finance_isolated === 'true')).toBe(true);
    // Preview must not call any writers — pure classification only.
  });
});

describe('INV-6 · approved commit idempotency & partial failure', () => {
  it('commits assets/stock via RPCs with retry-safe keys and finance untouched', async () => {
    const calls: string[] = [];
    const fns: InventoryOpeningImportFns = {
      createDraftAsset: async (a) => {
        calls.push(`asset:${a.inventoryNumber}:${a.idempotencyKey}`);
        return { ok: true, assetId: 'asset-1' };
      },
      activateAsset: async (id) => {
        calls.push(`activate:${id}`);
        return { ok: true };
      },
      registerStockItem: async (a) => {
        calls.push(`sku:${a.skuCode}`);
        return { ok: true, stockItemId: 'stock-1' };
      },
      postOpeningMove: async (a) => {
        calls.push(`opening:${a.qty}:${a.idempotencyKey}`);
        return { ok: true };
      },
    };

    const preview = classifyInventoryOpeningRows(
      [
        {
          tracking_type: 'INDIVIDUAL_ASSET',
          item_name: 'Drill',
          ownership_kind: 'CONDOMINIUM',
          inventory_number: 'INV-1',
          condition: 'good',
          category_code: 'tools',
          location_code: 'warehouse',
        },
        {
          tracking_type: 'QUANTITY_STOCK',
          item_name: 'Bags',
          ownership_kind: 'CONDOMINIUM',
          sku_code: 'SKU-1',
          unit_code: 'pcs',
          opening_qty: '5',
          category_code: 'tools',
          location_code: 'warehouse',
        },
      ].map((r) => ({
        serial_number: '',
        quantity: '',
        estimated_value_eur: '',
        source_ref: '',
        notes: '',
        inventory_number: '',
        sku_code: '',
        unit_code: '',
        opening_qty: '',
        ...r,
      })) as Record<string, string>[],
      emptyCtx(),
    );

    const batch = await commitInventoryOpeningBatch({
      preview,
      fns,
      batchId: 'batch-1',
      idempotencyKeyForRow: (n, k) => inventoryOpeningIdempotencyKey('batch-1', n, k),
    });
    expect(batch.fullySuccessful).toBe(true);
    expect(batch.financeTouched).toBe(false);
    expect(batch.createdCount).toBe(2);
    expect(calls.some((c) => c.startsWith('opening:5:'))).toBe(true);

    // Concurrent retry with same idempotency keys
    const again = await commitInventoryOpeningBatch({
      preview,
      fns,
      batchId: 'batch-1',
      idempotencyKeyForRow: (n, k) => inventoryOpeningIdempotencyKey('batch-1', n, k),
    });
    expect(again.createdCount).toBe(2);
    expect(inventoryOpeningIdempotencyKey('batch-1', 2, 'asset')).toBe(
      inventoryOpeningIdempotencyKey('batch-1', 2, 'asset'),
    );
    const uuidRe =
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/;
    expect(inventoryOpeningIdempotencyKey('batch-1', 2, 'asset')).toMatch(uuidRe);
    for (let i = 0; i < 64; i += 1) {
      expect(inventoryOpeningIdempotencyKey(`batch-${i}`, i, i % 2 ? 'asset' : 'sku')).toMatch(
        uuidRe,
      );
    }
  });

  it('stops after failure and marks remaining NOT_PROCESSED', async () => {
    const preview = classifyInventoryOpeningRows(
      [
        {
          tracking_type: 'INDIVIDUAL_ASSET',
          item_name: 'A',
          ownership_kind: 'CONDOMINIUM',
          inventory_number: 'INV-A',
          condition: 'good',
        },
        {
          tracking_type: 'INDIVIDUAL_ASSET',
          item_name: 'B',
          ownership_kind: 'CONDOMINIUM',
          inventory_number: 'INV-B',
          condition: 'good',
        },
      ].map((r) => ({
        category_code: 'tools',
        location_code: 'warehouse',
        serial_number: '',
        sku_code: '',
        quantity: '',
        unit_code: '',
        opening_qty: '',
        estimated_value_eur: '',
        source_ref: '',
        notes: '',
        ...r,
      })),
      emptyCtx(),
    );
    let n = 0;
    const batch = await commitInventoryOpeningBatch({
      preview,
      batchId: 'b',
      idempotencyKeyForRow: (row, kind) => inventoryOpeningIdempotencyKey('b', row, kind),
      fns: {
        createDraftAsset: async () => {
          n += 1;
          if (n === 1) return { ok: false, message: 'boom_failed' };
          return { ok: true, assetId: 'x' };
        },
        activateAsset: async () => ({ ok: true }),
        registerStockItem: async () => ({ ok: true, stockItemId: 's' }),
        postOpeningMove: async () => ({ ok: true }),
      },
    });
    expect(batch.fullySuccessful).toBe(false);
    expect(batch.failedCount).toBe(1);
    expect(batch.notProcessedCount).toBe(1);
  });
});

describe('INV-6 · staff cannot approve + localization', () => {
  it('denies participant approval helper', () => {
    expect(
      staffMayApproveFromUi(emptyInventoryStaffCapabilities(), false),
    ).toBe(false);
  });

  it('keeps inv6 keys in BG/RU/EN', () => {
    for (const key of ['inv6Name', 'inv6EmptyOk', 'inv6ConfirmImport', 'inv6NoFinance'] as const) {
      expect(ru.admin[key]).toBeTruthy();
      expect(en.admin[key]).toBeTruthy();
      expect(bg.admin[key]).toBeTruthy();
    }
  });
});
