/**
 * INV-5 — Staff collaborative inventory UI helpers (pure + permission gates).
 * RPCs remain the authorization boundary; this is UX gating only.
 */

import { isBuildingModuleEnabled, type BuildingModulesState } from '@/lib/modules';
import { INVENTORY_MODULE_KEY } from './admin';
import type { InventorySessionItemRow, InventorySessionRow } from './admin';
import { assertOptimisticRowVersion } from './inv1Schema';
import { mayApproveSession } from './inv2Operations';

export type InventoryStaffView = 'dashboard' | 'session' | 'finding_form' | 'finding_detail';

export type InventoryStaffCapabilityFlags = {
  canView: boolean;
  canSessionParticipate: boolean;
  canSessionReview: boolean;
  canApproveSessions: boolean;
  canWriteOff: boolean;
  canEditAssets: boolean;
};

export type InventoryParticipantAssignment = {
  session_id: string;
  staff_id: number;
  role_in_session: string;
  assigned_zone_location_id: string | null;
  assigned_category_id: string | null;
  active: boolean;
};

export type StaffSessionDashboardRow = {
  session: InventorySessionRow;
  assignment: InventoryParticipantAssignment | null;
  findingsTotal: number;
  myFindings: number;
  myDrafts: number;
  pendingReview: number;
  discrepancies: number;
  lastSavedAt: string | null;
};

/** Admin-only RPCs that must never appear in Staff Inventory UI. */
export const STAFF_INVENTORY_FORBIDDEN_RPCS = [
  'inventory_approve_and_post_session',
  'inventory_approve_asset_write_off',
  'inventory_set_staff_capabilities',
  'inventory_archive_category',
  'inventory_stock_move',
] as const;

export const STAFF_INVENTORY_ALLOWED_RPCS = [
  'inventory_add_session_item',
  'inventory_update_session_item',
  'inventory_submit_session_item',
  'inventory_register_document',
  'inventory_build_document_path',
  'inventory_list_documents_for_session_item',
] as const;

export function emptyInventoryStaffCapabilities(): InventoryStaffCapabilityFlags {
  return {
    canView: false,
    canSessionParticipate: false,
    canSessionReview: false,
    canApproveSessions: false,
    canWriteOff: false,
    canEditAssets: false,
  };
}

export function parseInventoryStaffCapabilities(
  row: Record<string, unknown> | null | undefined,
): InventoryStaffCapabilityFlags {
  if (!row) return emptyInventoryStaffCapabilities();
  return {
    canView: Boolean(row.can_view),
    canSessionParticipate: Boolean(row.can_session_participate),
    canSessionReview: Boolean(row.can_session_review),
    canApproveSessions: Boolean(row.can_approve_sessions),
    canWriteOff: Boolean(row.can_write_off),
    canEditAssets: Boolean(row.can_edit_assets),
  };
}

/** Do not auto-grant all staff — require participate flag or an assignment. */
export function canSeeInventoryStaff(args: {
  staffActive: boolean;
  caps: InventoryStaffCapabilityFlags;
  hasAssignedSessions: boolean;
}): boolean {
  if (!args.staffActive) return false;
  return (
    args.caps.canSessionParticipate ||
    args.caps.canView ||
    args.hasAssignedSessions
  );
}

export function shouldShowInventoryStaff(
  modules: BuildingModulesState | null | undefined,
  args: {
    staffActive: boolean;
    caps: InventoryStaffCapabilityFlags;
    hasAssignedSessions: boolean;
  },
): boolean {
  return isBuildingModuleEnabled(modules, INVENTORY_MODULE_KEY) && canSeeInventoryStaff(args);
}

/** Staff must never approve/post from this UI. */
export function staffMayApproveFromUi(caps: InventoryStaffCapabilityFlags, isAdmin: boolean): boolean {
  return mayApproveSession({
    isAdmin,
    canApproveSessions: caps.canApproveSessions,
    isParticipantOnly: !isAdmin && !caps.canApproveSessions,
  });
}

export function staffFindingEditable(args: {
  item: Pick<InventorySessionItemRow, 'finding_status' | 'entered_by_staff_id'>;
  staffId: number | null;
  isAdmin: boolean;
  canReview: boolean;
}): boolean {
  if (!['draft', 'submitted'].includes(args.item.finding_status)) return false;
  if (args.isAdmin || args.canReview) return true;
  if (args.staffId == null) return false;
  return args.item.entered_by_staff_id === args.staffId;
}

export function sessionAcceptsNewFindings(status: string): boolean {
  return status === 'DRAFT' || status === 'IN_PROGRESS';
}

export function isStaleRowVersionError(message: string): boolean {
  const m = message.toLowerCase();
  return m.includes('stale') || m.includes('row_version') || m.includes('40001');
}

export function applyStaffItemUpdateVersion(
  expected: number,
  actual: number,
): { ok: true; nextVersion: number } | { ok: false; conflict: true } {
  const r = assertOptimisticRowVersion(expected, actual);
  if (!r.ok || r.nextVersion == null) return { ok: false, conflict: true };
  return { ok: true, nextVersion: r.nextVersion };
}

/**
 * Staff Inventory stale row_version UX contract:
 * - never keep the local draft form after a conflict
 * - always prefer the latest server row when present
 * - surface an explicit reload affordance
 */
export function resolveStaffStaleConflict(args: {
  errorMessage: string;
  editingItemId: string | null;
  latestItems: InventorySessionItemRow[];
}): {
  isConflict: boolean;
  discardLocalDraft: boolean;
  latestItem: InventorySessionItemRow | null;
  offerReload: boolean;
} {
  const isConflict = isStaleRowVersionError(args.errorMessage);
  if (!isConflict) {
    return {
      isConflict: false,
      discardLocalDraft: false,
      latestItem: null,
      offerReload: false,
    };
  }
  const latestItem =
    args.editingItemId == null
      ? null
      : (args.latestItems.find((i) => i.id === args.editingItemId) ?? null);
  return {
    isConflict: true,
    discardLocalDraft: true,
    latestItem,
    offerReload: true,
  };
}

export function computeStaffSessionStats(args: {
  session: InventorySessionRow;
  assignment: InventoryParticipantAssignment | null;
  items: InventorySessionItemRow[];
  staffId: number | null;
}): StaffSessionDashboardRow {
  const mine = args.items.filter((i) =>
    args.staffId != null ? i.entered_by_staff_id === args.staffId : false,
  );
  const myDrafts = mine.filter((i) => i.finding_status === 'draft').length;
  const pendingReview = args.items.filter((i) =>
    ['submitted', 'draft'].includes(i.finding_status),
  ).length;
  const discrepancies = args.items.filter(
    (i) => Boolean(i.discrepancy_note?.trim()) ||
      (i.counted_qty != null &&
        i.expected_qty != null &&
        Number(i.counted_qty) !== Number(i.expected_qty)),
  ).length;
  let lastSavedAt: string | null = null;
  for (const i of mine) {
    const ts = i.updated_at ?? i.created_at ?? null;
    if (ts && (!lastSavedAt || ts > lastSavedAt)) lastSavedAt = ts;
  }
  return {
    session: args.session,
    assignment: args.assignment,
    findingsTotal: args.items.length,
    myFindings: mine.length,
    myDrafts,
    pendingReview,
    discrepancies,
    lastSavedAt,
  };
}

export function staffInventoryUiMentionsForbiddenRpc(source: string): boolean {
  const lower = source.toLowerCase();
  return STAFF_INVENTORY_FORBIDDEN_RPCS.some((fn) => lower.includes(fn.toLowerCase()));
}

export function filterAssignedSessions(
  sessions: InventorySessionRow[],
  assignments: InventoryParticipantAssignment[],
  staffId: number,
): InventorySessionRow[] {
  const ids = new Set(
    assignments.filter((a) => a.staff_id === staffId && a.active).map((a) => a.session_id),
  );
  return sessions.filter((s) => ids.has(s.id));
}

export function staffActiveSessionStatuses(): string[] {
  return ['DRAFT', 'IN_PROGRESS', 'REVIEW'];
}
