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
      expect.arrayContaining([
        'empty_inventory_valid',
        'optional_import',
        'no_auto_activation',
        'no_finance_postings',
      ]),
    );
    expect(a!.validateManual?.({ empty_inventory_ok: true })?.ok).toBe(true);
    expect(a!.validateManual?.({ import_committed: true })?.ok).toBe(true);
    expect(a!.validateManual?.({})?.ok).toBe(false);
  });

  it('supports lifecycle path without forcing ACTIVE before sessions', () => {
    expect(canTransitionModuleLifecycle('DISABLED', 'SETUP_REQUIRED')).toBe(true);
    expect(canTransitionModuleLifecycle('SETUP_REQUIRED', 'SETUP_IN_PROGRESS')).toBe(true);
    expect(canTransitionModuleLifecycle('SETUP_IN_PROGRESS', 'READY')).toBe(true);
    expect(canTransitionModuleLifecycle('READY', 'ACTIVE')).toBe(true);
    expect(suspensionPreservesData('ACTIVE', 'SUSPENDED')).toBe(true);
    expect(inventorySetupManualComplete({ empty_inventory_ok: true })).toBe(true);
    expect(inventorySetupManualComplete({ import_committed: true })).toBe(true);
    expect(inventorySetupManualComplete({ skip_import: true })).toBe(false);
    expect(inventorySetupManualComplete({ start_physical_inventory: true })).toBe(false);
  });

  it('wires AdminInitialSetup inventory branches', () => {
    const ui = read('src/components/admin/AdminInitialSetup.tsx');
    expect(ui).toContain('INVENTORY_MODULE_KEY');
    expect(ui).toContain('isInventory');
    expect(ui).toContain('confirmInventoryImport');
    expect(ui).toContain('parseInventoryOpeningXlsxBuffer');
    expect(ui).toContain('commitInventoryOpeningBatch');
    expect(ui).toContain('AdminInventoryOpeningPanel');
    expect(ui).toContain("p_movement_type: 'OPENING'");
    const commit = read('src/lib/inventory/openingCommit.ts');
    expect(commit).not.toMatch(/\.rpc\(\s*['"]charge_support_fee/);
    expect(commit).not.toMatch(/uk_expenses/);
    expect(commit).toContain('financeTouched: false');
    expect(inventoryOpeningMentionsFinance('charge_support_fee()')).toBe(true);
  });
});

describe('INV-6 · XLSX template & validation', () => {
  it('builds a localized template (header only; examples live on Instructions) that parses', () => {
    for (const locale of ['ru', 'bg', 'en'] as const) {
      const buf = buildInventoryOpeningTemplateBuffer(locale);
      const parsed = parseInventoryOpeningXlsxBuffer(buf);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      expect(parsed.schemaVersion).toBe(INVENTORY_SETUP_SCHEMA_VERSION);
      expect(parsed.rows).toEqual([]);
    }
  });

  it('parses filled rows from a localized template and keeps legacy aliases working', () => {
    const XLSX = require('xlsx');
    const wb = XLSX.read(buildInventoryOpeningTemplateBuffer('bg'), { type: 'array' });
    XLSX.utils.sheet_add_aoa(wb.Sheets[wb.SheetNames[0]], [['Оборудване', 'Инструменти', 'Къртач', 'INV-1', '', '', 'CONDOMINIUM']], {
      origin: 'A2',
    });
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    const parsed = parseInventoryOpeningXlsxBuffer(buf);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0].tracking_type).toBe('INDIVIDUAL_ASSET');
    expect(parsed.rows[0].item_name).toBe('Къртач');
    expect(parsed.rows[0].inventory_number).toBe('INV-1');

    const legacy = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      legacy,
      XLSX.utils.aoa_to_sheet([['schema_version', INVENTORY_SETUP_SCHEMA_VERSION]]),
      'meta',
    );
    XLSX.utils.book_append_sheet(
      legacy,
      XLSX.utils.aoa_to_sheet([
        ['tracking_type', 'item_name', 'ownership_kind', 'inventory_number'],
        ['INDIVIDUAL_ASSET', 'Drill', 'CONDOMINIUM', 'INV-2'],
      ]),
      'inventory',
    );
    const legacyParsed = parseInventoryOpeningXlsxBuffer(
      XLSX.write(legacy, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer,
    );
    expect(legacyParsed.ok).toBe(true);
    if (legacyParsed.ok) expect(legacyParsed.rows[0].item_name).toBe('Drill');
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

    // New drill create; identical skip; conflict; stock with opening skip; unknown category → will_create warning (still create)
    expect(preview.createCount).toBe(2);
    expect(preview.skipCount).toBe(2);
    expect(preview.errorCount).toBeGreaterThanOrEqual(1);
    expect(preview.rows.every((r) => r.data.finance_isolated === 'true')).toBe(true);
    const badCat = preview.rows.find((r) => r.data.inventory_number === 'INV-BADCAT');
    expect(badCat?.operation).toBe('create');
    expect(badCat?.warnings ?? []).toContain('will_create:category');
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

  it('reuses category/location ensure within one batch (no duplicate catalog writes)', async () => {
    const catCalls: string[] = [];
    const locCalls: string[] = [];
    const preview = classifyInventoryOpeningRows(
      [
        {
          tracking_type: 'INDIVIDUAL_ASSET',
          item_name: 'A',
          ownership_kind: 'CONDOMINIUM',
          inventory_number: 'ISO-A',
          condition: 'good',
          category_code: 'iso-cat',
          location_code: 'iso-loc',
        },
        {
          tracking_type: 'INDIVIDUAL_ASSET',
          item_name: 'B',
          ownership_kind: 'CONDOMINIUM',
          inventory_number: 'ISO-B',
          condition: 'good',
          category_code: 'iso-cat',
          location_code: 'iso-loc',
        },
      ].map((r) => ({
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
      emptyCtx({ categoriesByCode: new Map(), locationsByCode: new Map() }),
    );
    expect(preview.rows.every((r) => r.data.will_create_category === 'true')).toBe(true);
    const batch = await commitInventoryOpeningBatch({
      preview,
      batchId: 'iso-cat',
      idempotencyKeyForRow: (row, kind) => inventoryOpeningIdempotencyKey('iso-cat', row, kind),
      fns: {
        ensureCategory: async (a) => {
          catCalls.push(a.code);
          return { ok: true, categoryId: 'cat-iso' };
        },
        ensureLocation: async (a) => {
          locCalls.push(a.code);
          return { ok: true, locationId: 'loc-iso' };
        },
        createDraftAsset: async () => ({ ok: true, assetId: 'a' }),
        activateAsset: async () => ({ ok: true }),
        registerStockItem: async () => ({ ok: true, stockItemId: 's' }),
        postOpeningMove: async () => ({ ok: true }),
      },
    });
    expect(batch.fullySuccessful).toBe(true);
    expect(catCalls).toEqual(['iso-cat']);
    expect(locCalls).toEqual(['iso-loc']);
  });

  it('retries only unsaved rows; find* skips duplicates and completes missing opening', async () => {
    const {
      filterPreviewForInventoryRetry,
      inventoryCommitUiSummary,
      mergeInventoryCommitBatches,
      reconcileInventoryCommitWithServer,
      retryCandidatesFromInventoryBatch,
    } = await import('@/lib/inventory/openingCommit');

    const assets = new Set<string>();
    const stock = new Map<string, { stockItemId: string; hasOpeningMovement: boolean; qtyPosted: number }>();
    let failOnce = true;
    const fns: InventoryOpeningImportFns = {
      findAssetByNumber: async (n) =>
        assets.has(n) ? { assetId: `id-${n}`, operationalStatus: 'active' } : null,
      findStockBySku: async (sku) => stock.get(sku) ?? null,
      createDraftAsset: async (a) => {
        if (failOnce && a.inventoryNumber === 'ISO-FAIL') {
          failOnce = false;
          return { ok: false, message: 'simulated_mid_batch_failure' };
        }
        assets.add(a.inventoryNumber);
        return { ok: true, assetId: `id-${a.inventoryNumber}` };
      },
      activateAsset: async () => ({ ok: true }),
      registerStockItem: async (a) => {
        const row = { stockItemId: `st-${a.skuCode}`, hasOpeningMovement: false, qtyPosted: 0 };
        stock.set(a.skuCode, row);
        return { ok: true, stockItemId: row.stockItemId };
      },
      postOpeningMove: async (a) => {
        const entry = [...stock.values()].find((s) => s.stockItemId === a.stockItemId);
        if (!entry) return { ok: false, message: 'no_stock' };
        if (entry.hasOpeningMovement) return { ok: true }; // idempotent
        entry.hasOpeningMovement = true;
        entry.qtyPosted += a.qty;
        return { ok: true };
      },
    };

    const rawRows = [
      {
        tracking_type: 'INDIVIDUAL_ASSET',
        item_name: 'Ok',
        ownership_kind: 'CONDOMINIUM',
        inventory_number: 'ISO-OK',
        condition: 'good',
        category_code: 'tools',
        location_code: 'warehouse',
      },
      {
        tracking_type: 'INDIVIDUAL_ASSET',
        item_name: 'Fail',
        ownership_kind: 'CONDOMINIUM',
        inventory_number: 'ISO-FAIL',
        condition: 'good',
        category_code: 'tools',
        location_code: 'warehouse',
      },
      {
        tracking_type: 'INDIVIDUAL_ASSET',
        item_name: 'Later',
        ownership_kind: 'CONDOMINIUM',
        inventory_number: 'ISO-LATER',
        condition: 'good',
        category_code: 'tools',
        location_code: 'warehouse',
      },
      {
        tracking_type: 'QUANTITY_STOCK',
        item_name: 'Consumable',
        ownership_kind: 'CONDOMINIUM',
        sku_code: 'ISO-SKU',
        unit_code: 'pcs',
        opening_qty: '7',
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
    }));
    const preview = classifyInventoryOpeningRows(
      rawRows as Record<string, string>[],
      emptyCtx(),
    );

    const first = await commitInventoryOpeningBatch({
      preview,
      batchId: 'iso-retry',
      idempotencyKeyForRow: (n, k) => inventoryOpeningIdempotencyKey('iso-retry', n, k),
      fns,
    });
    expect(first.fullySuccessful).toBe(false);
    expect(first.createdCount).toBe(1);
    expect(first.failedCount).toBe(1);
    expect(first.notProcessedCount).toBe(2);
    expect(assets.has('ISO-OK')).toBe(true);
    expect(assets.has('ISO-LATER')).toBe(false);

    // Simulate stock created but opening missing (network blip after register).
    stock.set('ISO-SKU', {
      stockItemId: 'st-ISO-SKU',
      hasOpeningMovement: false,
      qtyPosted: 0,
    });

    const presence = {
      assetNumbers: new Set(assets),
      stockBySku: new Map(
        [...stock.entries()].map(([k, v]) => [
          k,
          { stockItemId: v.stockItemId, hasOpeningMovement: v.hasOpeningMovement },
        ]),
      ),
    };
    const reconciled = reconcileInventoryCommitWithServer(first, preview.rows, presence);
    const retryNums = new Set(retryCandidatesFromInventoryBatch(reconciled));
    expect(retryNums.has(preview.rows[0]!.rowNumber)).toBe(false); // already saved
    expect(retryNums.size).toBeGreaterThanOrEqual(2);

    const retryPreview = filterPreviewForInventoryRetry(preview, retryNums);
    const second = await commitInventoryOpeningBatch({
      preview: retryPreview,
      batchId: 'iso-retry',
      idempotencyKeyForRow: (n, k) => inventoryOpeningIdempotencyKey('iso-retry', n, k),
      fns,
    });
    const merged = mergeInventoryCommitBatches(reconciled, second);
    const after = reconcileInventoryCommitWithServer(merged, preview.rows, {
      assetNumbers: new Set(assets),
      stockBySku: new Map(
        [...stock.entries()].map(([k, v]) => [
          k,
          { stockItemId: v.stockItemId, hasOpeningMovement: v.hasOpeningMovement },
        ]),
      ),
    });
    expect(after.fullySuccessful).toBe(true);
    expect(assets.size).toBe(3);
    expect(stock.get('ISO-SKU')?.qtyPosted).toBe(7);

    // Full success retry must not re-create or re-post qty.
    const third = await commitInventoryOpeningBatch({
      preview,
      batchId: 'iso-retry',
      idempotencyKeyForRow: (n, k) => inventoryOpeningIdempotencyKey('iso-retry', n, k),
      fns,
    });
    expect(third.skippedExistingCount).toBe(4);
    expect(stock.get('ISO-SKU')?.qtyPosted).toBe(7);

    const ui = inventoryCommitUiSummary(after);
    expect(ui.savedNow + ui.alreadySaved).toBe(ui.total);
    expect(ui.notSaved).toBe(0);
  });
});

describe('INV-6 · staff cannot approve + localization', () => {
  it('denies participant approval helper', () => {
    expect(
      staffMayApproveFromUi(emptyInventoryStaffCapabilities(), false),
    ).toBe(false);
  });

  it('keeps inv6 keys in BG/RU/EN', () => {
    for (const key of [
      'inv6Name',
      'inv6EmptyOk',
      'inv6ConfirmImport',
      'inv6NoFinance',
      'inv6SavedOfTotal',
      'inv6AlreadySaved',
      'inv6NotSaved',
      'inv6Condition_good',
      'inv6Unit_pcs',
      'inv6RetryMissing',
      'inv6CheckingImportResult',
      'inv6DataSavedSetupIncomplete',
      'inv6RetrySetupCompletion',
    ] as const) {
      expect(ru.admin[key]).toBeTruthy();
      expect(en.admin[key]).toBeTruthy();
      expect(bg.admin[key]).toBeTruthy();
    }
    expect(ru.admin.inv6Condition_good).toBe('Хорошее');
    expect(ru.admin.inv6Unit_pcs).toBe('шт.');
    expect(ru.admin.inv6DataSavedSetupIncomplete).toContain('Данные импортированы');
  });

  it('counts confirmed saved rows as created+skipped, not last-pass creates alone', async () => {
    const {
      inventoryCommitBatchFromAuditPreview,
      inventoryCommitConfirmedSavedCount,
    } = await import('@/lib/inventory/openingCommit');
    const fromAudit = inventoryCommitBatchFromAuditPreview({
      rows: [
        {
          rowNumber: 2,
          matchKey: 'A',
          trackingType: 'INDIVIDUAL_ASSET',
          outcome: 'SKIPPED_EXISTING',
          detail: 'asset_already_present',
          attempted: true,
        },
        {
          rowNumber: 3,
          matchKey: 'B',
          trackingType: 'INDIVIDUAL_ASSET',
          outcome: 'CREATED',
          detail: 'asset_created_activated',
          attempted: true,
        },
      ],
      createdCount: 1,
      skippedExistingCount: 1,
      fullySuccessful: true,
    });
    expect(fromAudit?.rows).toHaveLength(2);
    expect(inventoryCommitConfirmedSavedCount(fromAudit!)).toBe(2);
    expect(fromAudit!.createdCount).toBe(1);
    expect(
      inventoryCommitConfirmedSavedCount({
        rows: fromAudit!.rows,
        createdCount: 0,
        skippedExistingCount: 241,
        conflictCount: 0,
        failedCount: 0,
        notProcessedCount: 0,
        fullySuccessful: true,
        stoppedEarly: false,
        financeTouched: false,
      }),
    ).toBe(241);
  });
});
