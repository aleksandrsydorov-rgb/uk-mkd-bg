/**
 * INV-6 — Category-grouped preview helpers for inventory opening (pure).
 */

import type { ImportPreviewResult, ImportPreviewRow } from '@/lib/moduleCore/types';
import { isInventoryCatalogCreateWarning } from './openingLabels';

export type InventoryPreviewCategoryGroup = {
  categoryKey: string;
  categoryLabel: string;
  willCreateCategory: boolean;
  rows: ImportPreviewRow[];
};

export function inventoryOpeningCategoryLabel(row: ImportPreviewRow): string {
  const raw =
    String(row.data.category_label ?? '').trim() ||
    String(row.data.category_code ?? '').trim();
  return raw || '—';
}

export function inventoryOpeningNormalizeKey(raw: string): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/** Group preview rows by category; categories and items sorted alphabetically. */
export function groupInventoryOpeningPreviewByCategory(
  preview: ImportPreviewResult,
): InventoryPreviewCategoryGroup[] {
  const map = new Map<string, InventoryPreviewCategoryGroup>();

  for (const row of preview.rows) {
    const label = inventoryOpeningCategoryLabel(row);
    const key = inventoryOpeningNormalizeKey(label) || '_none';
    let group = map.get(key);
    if (!group) {
      group = {
        categoryKey: key,
        categoryLabel: label,
        willCreateCategory: row.data.will_create_category === 'true',
        rows: [],
      };
      map.set(key, group);
    } else if (row.data.will_create_category === 'true') {
      group.willCreateCategory = true;
    }
    group.rows.push(row);
  }

  const groups = [...map.values()].sort((a, b) =>
    a.categoryLabel.localeCompare(b.categoryLabel, undefined, { sensitivity: 'base' }),
  );
  for (const g of groups) {
    g.rows.sort((a, b) => {
      const an = String(a.data.item_name ?? '');
      const bn = String(b.data.item_name ?? '');
      const byName = an.localeCompare(bn, undefined, { sensitivity: 'base' });
      if (byName !== 0) return byName;
      return a.rowNumber - b.rowNumber;
    });
  }
  return groups;
}

export function inventoryOpeningCatalogCreates(preview: ImportPreviewResult): {
  categories: string[];
  locations: string[];
} {
  const categories = new Set<string>();
  const locations = new Set<string>();
  for (const row of preview.rows) {
    if (row.data.will_create_category === 'true') {
      const label = inventoryOpeningCategoryLabel(row);
      if (label && label !== '—') categories.add(label);
    }
    if (row.data.will_create_location === 'true') {
      const loc =
        String(row.data.location_label ?? '').trim() ||
        String(row.data.location_code ?? '').trim();
      if (loc) locations.add(loc);
    }
  }
  return {
    categories: [...categories].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })),
    locations: [...locations].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })),
  };
}

export function inventoryOpeningWarningCount(preview: ImportPreviewResult): number {
  // Catalog-create notices are shown once in the compact summary — not as row warnings.
  return preview.rows.reduce(
    (n, r) =>
      n + (r.warnings ?? []).filter((w) => !isInventoryCatalogCreateWarning(w)).length,
    0,
  );
}

export function inventoryOpeningUniqueCategoryCount(preview: ImportPreviewResult): number {
  return groupInventoryOpeningPreviewByCategory(preview).length;
}
