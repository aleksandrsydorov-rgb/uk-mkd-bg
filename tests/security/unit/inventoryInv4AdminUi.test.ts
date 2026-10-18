import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  canSeeInventoryAdmin,
  shouldShowInventoryAdmin,
  computeInventoryOverview,
  filterAssets,
  inventoryUiMentionsFinance,
  categoryDisplayName,
  inventoryAssetStatusTone,
  inventorySessionStatusTone,
  createInventorySignedUrl,
  InventoryDocumentValidationError,
  inventoryExtensionFromFile,
  INV3_BUCKET,
  type InventoryAssetRow,
  type InventoryStockBalanceRow,
  type InventorySessionRow,
} from '@/lib/inventory';
import { emptyBuildingModulesState } from '@/lib/modules';
import { bg, en, ru } from '@/i18n/messages';

const ROOT = process.cwd();

function read(rel: string): string {
  return readFileSync(path.resolve(ROOT, rel), 'utf8');
}

function asset(partial: Partial<InventoryAssetRow> & Pick<InventoryAssetRow, 'id' | 'inventory_number' | 'name'>): InventoryAssetRow {
  return {
    description: null,
    category_id: null,
    ownership_kind: 'CONDOMINIUM',
    ownership_note: null,
    location_id: null,
    condition: 'good',
    operational_status: 'active',
    responsible_staff_id: null,
    estimated_value_eur: null,
    serial_number: null,
    manufacturer: null,
    model: null,
    write_off_reason: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...partial,
  };
}

describe('INV-4 · navigation & module gating', () => {
  it('wires inventory section into admin page behind shouldShowInventoryAdmin', () => {
    const page = read('src/app/admin/page.tsx');
    const nav = read('src/lib/adminNav.ts');
    expect(page).toContain("import { AdminInventory }");
    expect(page).toContain('shouldShowInventoryAdmin');
    expect(page).toContain("| 'инвентарь'");
    expect(page).toContain("['инвентарь', 'admin.inventory']");
    expect(page).toContain('showInventory = shouldShowInventoryAdmin');
    expect(page).toContain('showInventory,');
    expect(nav).toContain("...(f.showInventory ? (['инвентарь'] as const) : [])");
    expect(page).toContain("case 'инвентарь':");
    expect(page).toContain('<AdminInventory');
  });

  it('hides Inventory when module disabled or role is not administration', () => {
    const empty = emptyBuildingModulesState();
    expect(empty.inventory).toBe(false);
    expect(canSeeInventoryAdmin('администрация')).toBe(true);
    expect(canSeeInventoryAdmin('охрана')).toBe(false);
    expect(canSeeInventoryAdmin(null)).toBe(false);
    expect(shouldShowInventoryAdmin('администрация', empty)).toBe(false);
    expect(
      shouldShowInventoryAdmin('администрация', { ...empty, inventory: true }),
    ).toBe(true);
    expect(shouldShowInventoryAdmin('техник', { ...empty, inventory: true })).toBe(false);
  });
});

describe('INV-4 · overview / assets / stock helpers', () => {
  it('computes overview without mixing finance ledgers', () => {
    const assets = [
      asset({ id: '1', inventory_number: 'A-1', name: 'Pump', ownership_kind: 'CONDOMINIUM', condition: 'good', category_id: 'c1' }),
      asset({ id: '2', inventory_number: 'A-2', name: 'Draft', operational_status: 'draft' }),
      asset({
        id: '3',
        inventory_number: 'A-3',
        name: 'Old',
        operational_status: 'written_off',
        ownership_kind: 'UK',
      }),
    ];
    const balances: InventoryStockBalanceRow[] = [
      {
        stock_item_id: 's1',
        sku_code: 'SKU-1',
        name: 'Bolts',
        unit_code: 'pcs',
        ownership_kind: 'CONDOMINIUM',
        qty_on_hand: 2,
        min_qty: 5,
        default_location_id: null,
        active: true,
      },
      {
        stock_item_id: 's2',
        sku_code: 'SKU-2',
        name: 'Tape',
        unit_code: 'pcs',
        ownership_kind: 'CONDOMINIUM',
        qty_on_hand: 10,
        min_qty: 1,
        default_location_id: null,
        active: true,
      },
    ];
    const sessions: InventorySessionRow[] = [
      {
        id: 'sess1',
        title: 'Spring',
        status: 'REVIEW',
        row_version: 1,
        started_at: null,
        approved_at: null,
        closed_at: null,
        scope_note: null,
        zone_location_id: null,
        category_id: null,
        created_at: '2026-01-01T00:00:00Z',
      },
    ];
    const overview = computeInventoryOverview({
      assets,
      balances,
      sessions,
      categoryNameById: { c1: 'Equipment' },
    });
    expect(overview.activeAssets).toBe(1);
    expect(overview.byOwnership.CONDOMINIUM).toBe(1);
    expect(overview.byCondition.good).toBe(1);
    expect(overview.byCategory.Equipment).toBe(1);
    expect(overview.stockSkuCount).toBe(2);
    expect(overview.lowStockCount).toBe(1);
    expect(overview.activeSessions).toBe(1);
    expect(overview.pendingReview).toBe(1);
  });

  it('filters assets by search, ownership, status', () => {
    const assets = [
      asset({ id: '1', inventory_number: 'INV-100', name: 'Boiler', ownership_kind: 'UK', operational_status: 'active' }),
      asset({ id: '2', inventory_number: 'INV-200', name: 'Ladder', ownership_kind: 'CONDOMINIUM', operational_status: 'assigned' }),
    ];
    expect(filterAssets(assets, { search: '100' })).toHaveLength(1);
    expect(filterAssets(assets, { ownership: 'UK' })[0].id).toBe('1');
    expect(filterAssets(assets, { status: 'assigned' })[0].name).toBe('Ladder');
  });

  it('localizes category names and status tones', () => {
    const cat = { name_bg: 'Оборудване', name_ru: 'Оборудование', name_en: 'Equipment' };
    expect(categoryDisplayName(cat, 'bg')).toBe('Оборудване');
    expect(categoryDisplayName(cat, 'en')).toBe('Equipment');
    expect(categoryDisplayName(cat, 'ru')).toBe('Оборудование');
    expect(inventoryAssetStatusTone('active')).toBe('success');
    expect(inventoryAssetStatusTone('written_off')).toBe('danger');
    expect(inventorySessionStatusTone('REVIEW')).toBe('warning');
    expect(inventorySessionStatusTone('APPROVED')).toBe('success');
  });
});

describe('INV-4 · AdminInventory UI contracts', () => {
  it('uses canonical INV-2 RPCs and never writes finance ledgers', () => {
    const ui = read('src/components/admin/AdminInventory.tsx');
    const rpcs = [
      'inventory_create_draft_asset',
      'inventory_update_asset',
      'inventory_activate_asset',
      'inventory_assign_asset',
      'inventory_transfer_asset',
      'inventory_record_maintenance',
      'inventory_propose_asset_write_off',
      'inventory_approve_asset_write_off',
      'inventory_archive_asset',
      'inventory_register_stock_item',
      'inventory_stock_move',
      'inventory_upsert_category',
      'inventory_archive_category',
      'inventory_upsert_location',
      'inventory_create_session',
      'inventory_start_session',
      'inventory_submit_session_for_review',
      'inventory_approve_and_post_session',
      'inventory_close_session',
      'inventory_add_session_participant',
      'inventory_review_session_item',
    ];
    for (const fn of rpcs) {
      expect(ui).toContain(fn);
    }
    expect(inventoryUiMentionsFinance(ui)).toBe(false);
    expect(ui).not.toMatch(/uk_expenses|charge_support_fee|capital_repair_ledger/i);
    expect(ui).toContain('invNoFinance');
    expect(ui).toContain('uploadAndRegisterInventoryDocument');
    expect(ui).toContain('SignedStorageLink');
    expect(ui).toContain("id: 'overview'");
  });

  it('exposes session approval confirm and posting path', () => {
    const ui = read('src/components/admin/AdminInventory.tsx');
    expect(ui).toContain('invApproveConfirm');
    expect(ui).toContain('inventory_approve_and_post_session');
    expect(ui).toContain('p_row_version');
  });
});

describe('INV-4 · documents / signed URLs', () => {
  it('validates extensions and rejects traversal in signed URL helper', async () => {
    expect(inventoryExtensionFromFile(new File([], 'a.JPEG', { type: 'image/jpeg' }))).toBe('jpg');
    expect(inventoryExtensionFromFile(new File([], 'x.pdf', { type: 'application/pdf' }))).toBe('pdf');
    const fake = {
      storage: {
        from: () => ({
          createSignedUrl: async () => ({ data: { signedUrl: 'https://example/signed' }, error: null }),
        }),
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ok = await createInventorySignedUrl(fake as any, `inventory/default/asset/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.jpg`);
    expect(ok).toBe('https://example/signed');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await createInventorySignedUrl(fake as any, '../etc/passwd')).toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await createInventorySignedUrl(fake as any, 'https://evil.example/x')).toBeNull();
    expect(INV3_BUCKET).toBe('inventory-documents');
    expect(new InventoryDocumentValidationError('size').reason).toBe('size');
  });

  it('routes inventory paths to private bucket in privateMedia', () => {
    const media = read('src/lib/privateMedia.ts');
    expect(media).toContain('inventory-documents');
    expect(media).toContain('INVENTORY_DOCUMENTS_BUCKET');
    expect(media).toContain('session-item');
  });
});

describe('INV-4 · localization BG/RU/EN', () => {
  const required = [
    'inventory',
    'invLead',
    'invDenied',
    'invTabOverview',
    'invTabAssets',
    'invTabStock',
    'invTabCategories',
    'invTabLocations',
    'invTabSessions',
    'invApproveConfirm',
    'invNoFinance',
    'invMigrationNeeded',
  ] as const;

  it('keeps inventory admin keys aligned across locales', () => {
    for (const key of required) {
      expect(ru.admin[key]).toBeTruthy();
      expect(en.admin[key]).toBeTruthy();
      expect(bg.admin[key]).toBeTruthy();
    }
    expect(ru.admin.inventory).toBe('Инвентарь');
    expect(en.admin.inventory).toBe('Inventory');
    expect(bg.admin.inventory).toBe('Инвентар');
  });
});
