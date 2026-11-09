/** Localized display helpers for inventory opening preview (codes stay in data model). */

export {
  presentInventoryCondition,
  presentInventoryUnit,
} from './labels';

type TFn = (key: string, vars?: Record<string, string>) => string;

/** Catalog-create warnings are shown once in a compact summary — not per row. */
export function isInventoryCatalogCreateWarning(code: string): boolean {
  return code === 'will_create:category' || code === 'will_create:location';
}

export function presentInventoryCommitDetail(
  detail: string,
  t: TFn,
): { reason: string; action: string } {
  const d = String(detail ?? '').trim();
  const known: Record<string, { reasonKey: string; actionKey: string }> = {
    stopped_after_prior_failure: {
      reasonKey: 'admin.inv6CommitReason_stopped',
      actionKey: 'admin.inv6CommitAction_retry',
    },
    opening_move_missing: {
      reasonKey: 'admin.inv6CommitReason_openingMissing',
      actionKey: 'admin.inv6CommitAction_retryOpening',
    },
    reconcile_missing_asset_after_create: {
      reasonKey: 'admin.inv6CommitReason_missingAsset',
      actionKey: 'admin.inv6CommitAction_retry',
    },
    reconcile_missing_stock_after_create: {
      reasonKey: 'admin.inv6CommitReason_missingStock',
      actionKey: 'admin.inv6CommitAction_retry',
    },
    category_ensure_failed: {
      reasonKey: 'admin.inv6CommitReason_category',
      actionKey: 'admin.inv6CommitAction_retry',
    },
    location_ensure_failed: {
      reasonKey: 'admin.inv6CommitReason_location',
      actionKey: 'admin.inv6CommitAction_retry',
    },
  };
  const hit = known[d];
  if (hit) {
    return { reason: t(hit.reasonKey), action: t(hit.actionKey) };
  }
  if (d.includes('inventory_categories_code') || d.toLowerCase().includes('category')) {
    return { reason: t('admin.inv6CommitReason_category'), action: t('admin.inv6CommitAction_retry') };
  }
  if (d.includes('inventory_locations_code') || d.toLowerCase().includes('location')) {
    return { reason: t('admin.inv6CommitReason_location'), action: t('admin.inv6CommitAction_retry') };
  }
  if (d) {
    return { reason: d, action: t('admin.inv6CommitAction_retry') };
  }
  return { reason: t('admin.inv6CommitReason_unknown'), action: t('admin.inv6CommitAction_retry') };
}
