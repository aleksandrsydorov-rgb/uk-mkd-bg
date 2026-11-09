/** User-facing labels for inventory opening issue codes (no internal jargon). */

export function presentInventoryOpeningIssue(
  code: string,
  t: (key: string, vars?: Record<string, string>) => string,
): string {
  const key = `admin.inv6Issue_${code.replace(/[^a-z0-9_:]/gi, '_')}`;
  const labeled = t(key);
  if (labeled && labeled !== key) return labeled;

  const map: Record<string, string> = {
    'invalid:tracking_type': t('admin.inv6Issue_invalid_tracking_type'),
    'required:item_name': t('admin.inv6Issue_required_item_name'),
    'invalid:ownership_kind': t('admin.inv6Issue_invalid_ownership_kind'),
    'required:inventory_number': t('admin.inv6Issue_required_inventory_number'),
    'invalid:condition': t('admin.inv6Issue_invalid_condition'),
    'required:unit_code': t('admin.inv6Issue_required_unit_code'),
    'invalid:opening_qty': t('admin.inv6Issue_invalid_opening_qty'),
    'unknown:unit_code': t('admin.inv6Issue_unknown_unit_code'),
    'unknown:category_code': t('admin.inv6Issue_unknown_category'),
    'unknown:location_code': t('admin.inv6Issue_unknown_location'),
    'duplicate_in_file:inventory_number': t('admin.inv6Issue_dup_inventory_number'),
    'duplicate_in_file:sku_code': t('admin.inv6Issue_dup_sku'),
    'conflict:inventory_number': t('admin.inv6Issue_conflict_inventory_number'),
    'conflict:sku_code': t('admin.inv6Issue_conflict_sku'),
    'will_create:category': t('admin.inv6Issue_will_create_category'),
    'will_create:location': t('admin.inv6Issue_will_create_location'),
    'auto:sku_code': t('admin.inv6Issue_auto_sku'),
  };
  return map[code] || code;
}
