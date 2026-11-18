/**
 * Browser helpers for inventory opening import (first-run + module setup).
 * Reuses inventory_* RPCs — no parallel registry.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import type {
  ExistingInventoryAssetRef,
  ExistingInventoryStockRef,
  InventoryOpeningClassifyContext,
  InventoryOpeningImportFns,
} from '@/lib/inventory';

type Untyped = {
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{
    data: unknown;
    error: { message: string } | null;
  }>;
  from: (table: string) => any;
};

function sb(client: SupabaseClient<Database>): Untyped {
  return client as unknown as Untyped;
}

function norm(v: string): string {
  return String(v ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export async function loadInventoryOpeningClassifyContext(
  client: SupabaseClient<Database>,
): Promise<InventoryOpeningClassifyContext> {
  const s = sb(client);
  const [cats, locs, units, assets, stock, moves] = await Promise.all([
    s.from('inventory_categories').select('id, code, active, name_bg, name_ru, name_en'),
    s.from('inventory_locations').select('id, code, active, name'),
    s.from('inventory_units').select('code'),
    s
      .from('inventory_assets')
      .select(
        'id, inventory_number, name, ownership_kind, category_id, location_id, condition, serial_number, estimated_value_eur',
      ),
    s
      .from('inventory_stock_items')
      .select('id, sku_code, name, unit_code, ownership_kind, category_id, default_location_id'),
    s.from('inventory_stock_movements').select('stock_item_id, movement_type'),
  ]);

  const categoriesByCode = new Map<string, string>();
  const categoryLabelsById = new Map<string, string>();
  for (const c of (cats.data ?? []) as Array<{
    id: string;
    code: string;
    active?: boolean;
    name_bg?: string;
    name_ru?: string;
    name_en?: string;
  }>) {
    if (c.active === false) continue;
    const id = String(c.id);
    categoriesByCode.set(norm(c.code), id);
    for (const n of [c.name_bg, c.name_ru, c.name_en]) {
      if (n && norm(n)) categoriesByCode.set(norm(n), id);
    }
    categoryLabelsById.set(id, String(c.name_ru || c.name_bg || c.name_en || c.code || '').trim());
  }

  const locationsByCode = new Map<string, string>();
  const locationLabelsById = new Map<string, string>();
  for (const l of (locs.data ?? []) as Array<{
    id: string;
    code: string;
    active?: boolean;
    name?: string;
  }>) {
    if (l.active === false) continue;
    const id = String(l.id);
    locationsByCode.set(norm(l.code), id);
    if (l.name && norm(l.name)) locationsByCode.set(norm(l.name), id);
    locationLabelsById.set(id, String(l.name || l.code || '').trim());
  }

  const unitSet = new Set<string>();
  for (const u of (units.data ?? []) as Array<{ code: string }>) {
    const code = String(u.code ?? '').trim();
    if (!code) continue;
    unitSet.add(code);
    unitSet.add(code.toLowerCase());
  }

  const assetsByNumber = new Map<string, ExistingInventoryAssetRef>();
  for (const a of (assets.data ?? []) as Array<{
    id: string;
    inventory_number: string;
    name: string;
    ownership_kind: string;
    category_id: string | null;
    location_id: string | null;
    condition: string;
    serial_number: string | null;
    estimated_value_eur: number | null;
  }>) {
    assetsByNumber.set(norm(String(a.inventory_number)), {
      id: String(a.id),
      inventoryNumber: String(a.inventory_number),
      name: String(a.name),
      ownershipKind: String(a.ownership_kind),
      categoryId: a.category_id ? String(a.category_id) : null,
      locationId: a.location_id ? String(a.location_id) : null,
      condition: String(a.condition),
      serialNumber: a.serial_number,
      estimatedValueEur: a.estimated_value_eur,
    });
  }

  const openingSkus = new Set<string>();
  for (const m of (moves.data ?? []) as Array<{ stock_item_id: string; movement_type: string }>) {
    if (m.movement_type === 'OPENING') openingSkus.add(String(m.stock_item_id));
  }

  const stockBySku = new Map<string, ExistingInventoryStockRef>();
  for (const row of (stock.data ?? []) as Array<{
    id: string;
    sku_code: string;
    name: string;
    unit_code: string;
    ownership_kind: string;
    category_id: string | null;
    default_location_id: string | null;
  }>) {
    stockBySku.set(norm(String(row.sku_code)), {
      id: String(row.id),
      skuCode: String(row.sku_code),
      name: String(row.name),
      unitCode: String(row.unit_code),
      ownershipKind: String(row.ownership_kind),
      categoryId: row.category_id ? String(row.category_id) : null,
      defaultLocationId: row.default_location_id ? String(row.default_location_id) : null,
      hasOpeningMovement: openingSkus.has(String(row.id)),
      qtyOnHand: 0,
    });
  }

  return {
    categoriesByCode,
    locationsByCode,
    categoryLabelsById,
    locationLabelsById,
    units: unitSet,
    assetsByNumber,
    stockBySku,
    sourceRefsSeen: new Set(),
    allowCreateCatalog: true,
  };
}

export async function countInventoryRegister(client: SupabaseClient<Database>): Promise<{
  assets: number;
  stock: number;
}> {
  const [a, s] = await Promise.all([
    client.from('inventory_assets').select('id', { count: 'exact', head: true }),
    client.from('inventory_stock_items').select('id', { count: 'exact', head: true }),
  ]);
  return { assets: a.count ?? 0, stock: s.count ?? 0 };
}

export function buildInventoryOpeningImportFns(
  client: SupabaseClient<Database>,
): InventoryOpeningImportFns {
  const s = sb(client);
  return {
    ensureCategory: async (a) => {
      const { data, error } = await s.rpc('inventory_upsert_category', {
        p_code: a.code,
        p_name_bg: a.name,
        p_name_ru: a.name,
        p_name_en: a.name,
      });
      if (!error && data) {
        return { ok: true as const, categoryId: String((data as { id: string }).id) };
      }
      const { data: existing } = await s
        .from('inventory_categories')
        .select('id')
        .eq('code', a.code.toLowerCase())
        .maybeSingle();
      if (existing?.id) return { ok: true as const, categoryId: String(existing.id) };
      return { ok: false as const, message: error?.message || 'category_ensure_failed' };
    },
    ensureLocation: async (a) => {
      const { data, error } = await s.rpc('inventory_upsert_location', {
        p_code: a.code,
        p_name: a.name,
        p_location_kind: 'storage',
      });
      if (!error && data) {
        return { ok: true as const, locationId: String((data as { id: string }).id) };
      }
      const { data: existing } = await s
        .from('inventory_locations')
        .select('id')
        .eq('code', a.code.toLowerCase())
        .maybeSingle();
      if (existing?.id) return { ok: true as const, locationId: String(existing.id) };
      return { ok: false as const, message: error?.message || 'location_ensure_failed' };
    },
    findAssetByNumber: async (inventoryNumber) => {
      const { data } = await s
        .from('inventory_assets')
        .select('id, operational_status')
        .eq('inventory_number', inventoryNumber)
        .maybeSingle();
      if (!data?.id) return null;
      return {
        assetId: String(data.id),
        operationalStatus: String(data.operational_status ?? ''),
      };
    },
    findStockBySku: async (skuCode) => {
      const { data: item } = await s
        .from('inventory_stock_items')
        .select('id')
        .eq('sku_code', skuCode)
        .maybeSingle();
      if (!item?.id) return null;
      const { data: moves } = await s
        .from('inventory_stock_movements')
        .select('id')
        .eq('stock_item_id', String(item.id))
        .eq('movement_type', 'OPENING')
        .limit(1);
      return {
        stockItemId: String(item.id),
        hasOpeningMovement: Array.isArray(moves) && moves.length > 0,
      };
    },
    createDraftAsset: async (a) => {
      const { data, error } = await s.rpc('inventory_create_draft_asset', {
        p_inventory_number: a.inventoryNumber,
        p_name: a.name,
        p_ownership_kind: a.ownershipKind,
        p_category_id: a.categoryId,
        p_location_id: a.locationId,
        p_serial_number: a.serialNumber,
        p_condition: a.condition,
        p_estimated_value_eur: a.estimatedValueEur,
        p_description: a.description,
        p_idempotency_key: a.idempotencyKey,
      });
      if (error) return { ok: false as const, message: error.message };
      return { ok: true as const, assetId: String((data as { id: string }).id) };
    },
    activateAsset: async (assetId) => {
      const { error } = await s.rpc('inventory_activate_asset', { p_asset_id: assetId });
      if (error) return { ok: false as const, message: error.message };
      return { ok: true as const };
    },
    registerStockItem: async (a) => {
      const { data, error } = await s.rpc('inventory_register_stock_item', {
        p_sku_code: a.skuCode,
        p_name: a.name,
        p_ownership_kind: a.ownershipKind,
        p_unit_code: a.unitCode,
        p_category_id: a.categoryId,
        p_default_location_id: a.defaultLocationId,
        p_estimated_unit_value_eur: a.estimatedUnitValueEur,
        p_description: a.description,
        p_idempotency_key: a.idempotencyKey,
      });
      if (error) return { ok: false as const, message: error.message };
      return { ok: true as const, stockItemId: String((data as { id: string }).id) };
    },
    postOpeningMove: async (a) => {
      const { error } = await s.rpc('inventory_stock_move', {
        p_stock_item_id: a.stockItemId,
        p_movement_type: 'OPENING',
        p_qty: a.qty,
        p_location_id: a.locationId,
        p_reason: a.reason,
        p_idempotency_key: a.idempotencyKey,
      });
      if (error) return { ok: false as const, message: error.message };
      return { ok: true as const };
    },
  };
}
