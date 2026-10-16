/**
 * INV-10 — Staff form Inventory responsibility helpers (pure).
 * Persists only via inventory_set_staff_capabilities (canonical table).
 * Does not grant approve / write-off / manage_categories / session_review.
 *
 * Maintenance recording RPCs assert edit_assets today — the maintenance
 * checkbox maps to that same canonical flag (no parallel permission source).
 */

export type StaffInventoryPermissionsForm = {
  /** Master: «Имеет доступ к Инвентарю» */
  hasAccess: boolean;
  canView: boolean;
  canSessionParticipate: boolean;
  canEditAssets: boolean;
  canStockMove: boolean;
  /** Maps to can_edit_assets (same RPC gate as inventory_record_maintenance). */
  canRecordMaintenance: boolean;
};

export type StaffInventoryCapabilitiesPayload = {
  p_can_view: boolean;
  p_can_edit_assets: boolean;
  p_can_manage_categories: boolean;
  p_can_stock_move: boolean;
  p_can_session_participate: boolean;
  p_can_session_review: boolean;
  p_can_approve_sessions: boolean;
  p_can_write_off: boolean;
};

export function emptyStaffInventoryPermissionsForm(): StaffInventoryPermissionsForm {
  return {
    hasAccess: false,
    canView: false,
    canSessionParticipate: false,
    canEditAssets: false,
    canStockMove: false,
    canRecordMaintenance: false,
  };
}

/** Load form from staff_inventory_capabilities row (or null). */
export function staffInventoryFormFromCapabilities(
  row: Record<string, unknown> | null | undefined,
): StaffInventoryPermissionsForm {
  if (!row) return emptyStaffInventoryPermissionsForm();
  const canView = row.can_view === true;
  const canSessionParticipate = row.can_session_participate === true;
  const canEditAssets = row.can_edit_assets === true;
  const canStockMove = row.can_stock_move === true;
  const hasAccess =
    canView ||
    canSessionParticipate ||
    canEditAssets ||
    canStockMove ||
    row.can_session_review === true ||
    row.can_approve_sessions === true ||
    row.can_write_off === true ||
    row.can_manage_categories === true;
  return {
    hasAccess,
    canView,
    canSessionParticipate,
    canEditAssets,
    canStockMove,
    // Maintenance shares edit_assets authorization boundary.
    canRecordMaintenance: canEditAssets,
  };
}

/**
 * Build RPC payload. When master access is off or employee inactive → all false.
 * Never elevates admin-only caps from this form.
 */
export function staffInventoryCapabilitiesPayload(
  form: StaffInventoryPermissionsForm,
  opts?: { employeeActive?: boolean },
): StaffInventoryCapabilitiesPayload {
  const active = opts?.employeeActive !== false;
  if (!form.hasAccess || !active) {
    return {
      p_can_view: false,
      p_can_edit_assets: false,
      p_can_manage_categories: false,
      p_can_stock_move: false,
      p_can_session_participate: false,
      p_can_session_review: false,
      p_can_approve_sessions: false,
      p_can_write_off: false,
    };
  }
  const editAssets = form.canEditAssets || form.canRecordMaintenance;
  const anyGranular =
    form.canView ||
    form.canSessionParticipate ||
    editAssets ||
    form.canStockMove;
  return {
    p_can_view: form.canView || anyGranular,
    p_can_edit_assets: editAssets,
    p_can_manage_categories: false,
    p_can_stock_move: form.canStockMove,
    p_can_session_participate: form.canSessionParticipate,
    p_can_session_review: false,
    p_can_approve_sessions: false,
    p_can_write_off: false,
  };
}

/** Toggle master access; clearing access clears granular flags. */
export function withInventoryAccess(
  form: StaffInventoryPermissionsForm,
  hasAccess: boolean,
): StaffInventoryPermissionsForm {
  if (!hasAccess) return emptyStaffInventoryPermissionsForm();
  return {
    ...form,
    hasAccess: true,
    // Default to view when enabling access with no granular yet.
    canView: form.canView || !(
      form.canSessionParticipate ||
      form.canEditAssets ||
      form.canStockMove ||
      form.canRecordMaintenance
    ),
  };
}

export function inventoryStaffFormMentionsAdminOnlyCaps(source: string): boolean {
  const s = source.toLowerCase();
  return (
    s.includes('can_approve_sessions') ||
    s.includes('can_write_off') ||
    s.includes('p_can_approve') ||
    s.includes('p_can_write_off') ||
    s.includes('can_manage_categories')
  );
}
