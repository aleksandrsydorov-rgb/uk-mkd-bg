import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { bg, en, ru } from '@/i18n/messages';
import { emptyBuildingModulesState } from '@/lib/modules';
import {
  applyStaffItemUpdateVersion,
  canSeeInventoryStaff,
  computeStaffSessionStats,
  filterAssignedSessions,
  isStaleRowVersionError,
  parseInventoryStaffCapabilities,
  resolveStaffStaleConflict,
  sessionAcceptsNewFindings,
  shouldShowInventoryStaff,
  staffFindingEditable,
  staffInventoryUiMentionsForbiddenRpc,
  staffMayApproveFromUi,
  STAFF_INVENTORY_ALLOWED_RPCS,
  STAFF_INVENTORY_FORBIDDEN_RPCS,
  emptyInventoryStaffCapabilities,
  type InventoryParticipantAssignment,
  type InventorySessionItemRow,
  type InventorySessionRow,
} from '@/lib/inventory';

const ROOT = process.cwd();

function read(rel: string): string {
  return readFileSync(path.resolve(ROOT, rel), 'utf8');
}

function session(partial: Partial<InventorySessionRow> & Pick<InventorySessionRow, 'id' | 'title'>): InventorySessionRow {
  return {
    status: 'IN_PROGRESS',
    row_version: 1,
    started_at: null,
    approved_at: null,
    closed_at: null,
    scope_note: null,
    zone_location_id: null,
    category_id: null,
    created_at: '2026-01-01T00:00:00Z',
    ...partial,
  };
}

function item(
  partial: Partial<InventorySessionItemRow> & Pick<InventorySessionItemRow, 'id' | 'session_id' | 'draft_name'>,
): InventorySessionItemRow {
  return {
    tracking_type: 'INDIVIDUAL_ASSET',
    draft_inventory_number: null,
    draft_sku_code: null,
    finding_status: 'draft',
    counted_qty: null,
    expected_qty: null,
    unit_code: null,
    discrepancy_note: null,
    row_version: 1,
    posted_at: null,
    entered_by_staff_id: 10,
    ...partial,
  };
}

describe('INV-5 · staff navigation & module gating', () => {
  it('wires staff inventory section behind shouldShowInventoryStaff', () => {
    const page = read('src/app/admin/page.tsx');
    const nav = read('src/lib/adminNav.ts');
    expect(page).toContain("import { StaffInventory }");
    expect(page).toContain("shouldShowInventoryStaff");
    expect(page).toContain("| 'моя_инвентаризация'");
    expect(page).toContain("['моя_инвентаризация', 'admin.invStaff']");
    expect(page).toContain("case 'моя_инвентаризация':");
    expect(page).toContain('<StaffInventory');
    expect(page).toContain("showInventoryStaff");
    expect(nav).toContain("...(f.showInventoryStaff ? (['моя_инвентаризация'] as const) : [])");
  });

  it('hides staff inventory when module disabled or staff not eligible', () => {
    const empty = emptyBuildingModulesState();
    const caps = emptyInventoryStaffCapabilities();
    expect(shouldShowInventoryStaff(empty, { staffActive: true, caps, hasAssignedSessions: true })).toBe(
      false,
    );
    expect(
      canSeeInventoryStaff({
        staffActive: false,
        caps: { ...caps, canSessionParticipate: true },
        hasAssignedSessions: false,
      }),
    ).toBe(false);
    expect(
      canSeeInventoryStaff({
        staffActive: true,
        caps,
        hasAssignedSessions: false,
      }),
    ).toBe(false);
    expect(
      canSeeInventoryStaff({
        staffActive: true,
        caps: { ...caps, canSessionParticipate: true },
        hasAssignedSessions: false,
      }),
    ).toBe(true);
    expect(
      shouldShowInventoryStaff(
        { ...empty, inventory: true },
        { staffActive: true, caps, hasAssignedSessions: true },
      ),
    ).toBe(true);
  });
});

describe('INV-5 · assigned sessions & dashboard', () => {
  it('filters sessions to assigned staff only', () => {
    const sessions = [
      session({ id: 's1', title: 'A' }),
      session({ id: 's2', title: 'B' }),
    ];
    const assignments: InventoryParticipantAssignment[] = [
      {
        session_id: 's1',
        staff_id: 7,
        role_in_session: 'counter',
        assigned_zone_location_id: null,
        assigned_category_id: null,
        active: true,
      },
    ];
    expect(filterAssignedSessions(sessions, assignments, 7).map((s) => s.id)).toEqual(['s1']);
    expect(filterAssignedSessions(sessions, assignments, 99)).toEqual([]);
  });

  it('computes finding / draft / discrepancy / last-saved stats', () => {
    const row = computeStaffSessionStats({
      session: session({ id: 's1', title: 'Spring' }),
      assignment: null,
      staffId: 10,
      items: [
        item({
          id: 'i1',
          session_id: 's1',
          draft_name: 'Pump',
          finding_status: 'draft',
          updated_at: '2026-02-01T10:00:00Z',
        }),
        item({
          id: 'i2',
          session_id: 's1',
          draft_name: 'Bolts',
          finding_status: 'submitted',
          counted_qty: 3,
          expected_qty: 5,
          updated_at: '2026-02-01T12:00:00Z',
        }),
        item({
          id: 'i3',
          session_id: 's1',
          draft_name: 'Other',
          entered_by_staff_id: 99,
          finding_status: 'draft',
        }),
      ],
    });
    expect(row.myFindings).toBe(2);
    expect(row.myDrafts).toBe(1);
    expect(row.discrepancies).toBe(1);
    expect(row.lastSavedAt).toBe('2026-02-01T12:00:00Z');
  });
});

describe('INV-5 · draft create/update & concurrency', () => {
  it('allows draft edits for own items and blocks others', () => {
    const mine = item({ id: 'a', session_id: 's', draft_name: 'X', entered_by_staff_id: 5 });
    const other = item({ id: 'b', session_id: 's', draft_name: 'Y', entered_by_staff_id: 9 });
    expect(
      staffFindingEditable({ item: mine, staffId: 5, isAdmin: false, canReview: false }),
    ).toBe(true);
    expect(
      staffFindingEditable({ item: other, staffId: 5, isAdmin: false, canReview: false }),
    ).toBe(false);
    expect(
      staffFindingEditable({ item: other, staffId: 5, isAdmin: true, canReview: false }),
    ).toBe(true);
  });

  it('detects stale row_version conflicts', () => {
    expect(applyStaffItemUpdateVersion(3, 3)).toEqual({ ok: true, nextVersion: 4 });
    expect(applyStaffItemUpdateVersion(3, 4)).toEqual({ ok: false, conflict: true });
    expect(isStaleRowVersionError('inventory: stale item row_version')).toBe(true);
    expect(isStaleRowVersionError('ok')).toBe(false);
  });

  it('stale conflict discards local draft and offers reload of latest record', () => {
    const localDraft = item({
      id: 'i1',
      session_id: 's1',
      draft_name: 'Local unsaved name',
      row_version: 2,
      entered_by_staff_id: 10,
    });
    const serverLatest = item({
      id: 'i1',
      session_id: 's1',
      draft_name: 'Peer saved name',
      row_version: 3,
      entered_by_staff_id: 10,
      discrepancy_note: 'updated by peer',
    });
    const resolved = resolveStaffStaleConflict({
      errorMessage: 'inventory: stale item row_version',
      editingItemId: localDraft.id,
      latestItems: [serverLatest],
    });
    expect(resolved.isConflict).toBe(true);
    expect(resolved.discardLocalDraft).toBe(true);
    expect(resolved.offerReload).toBe(true);
    expect(resolved.latestItem?.draft_name).toBe('Peer saved name');
    expect(resolved.latestItem?.row_version).toBe(3);
    expect(resolved.latestItem?.draft_name).not.toBe(localDraft.draft_name);

    const ui = read('src/components/admin/StaffInventory.tsx');
    expect(ui).toContain('resolveStaffStaleConflict');
    expect(ui).toContain('invStaffConflict');
    expect(ui).toContain('invStaffReloadLatest');
    expect(ui).toContain('discardLocalDraft');
  });

  it('accepts findings only while DRAFT/IN_PROGRESS', () => {
    expect(sessionAcceptsNewFindings('IN_PROGRESS')).toBe(true);
    expect(sessionAcceptsNewFindings('REVIEW')).toBe(false);
    expect(sessionAcceptsNewFindings('APPROVED')).toBe(false);
  });
});

describe('INV-5 · permission boundaries', () => {
  it('denies staff approval from UI helper for participant-only', () => {
    const caps = parseInventoryStaffCapabilities({
      can_view: true,
      can_session_participate: true,
      can_session_review: false,
      can_approve_sessions: false,
      can_write_off: false,
      can_edit_assets: false,
    });
    expect(staffMayApproveFromUi(caps, false)).toBe(false);
    expect(staffMayApproveFromUi({ ...caps, canApproveSessions: true }, false)).toBe(true);
    expect(staffMayApproveFromUi(caps, true)).toBe(true);
  });

  it('StaffInventory uses allowed RPCs and never admin approve/post/write-off', () => {
    const ui = read('src/components/admin/StaffInventory.tsx');
    for (const fn of STAFF_INVENTORY_ALLOWED_RPCS.slice(0, 3)) {
      expect(ui).toContain(fn);
    }
    expect(ui).toContain('uploadAndRegisterInventoryDocument');
    expect(ui).toContain('session-item');
    expect(ui).toContain('invStaffConflict');
    expect(staffInventoryUiMentionsForbiddenRpc(ui)).toBe(false);
    for (const fn of STAFF_INVENTORY_FORBIDDEN_RPCS) {
      expect(ui).not.toContain(fn);
    }
  });
});

describe('INV-5 · localization BG/RU/EN', () => {
  const keys = [
    'invStaff',
    'invStaffLead',
    'invStaffDenied',
    'invStaffNoSessions',
    'invStaffAddFinding',
    'invStaffSaveDraft',
    'invStaffConflict',
    'invStaffReloadLatest',
    'invStaffPhotos',
  ] as const;

  it('keeps staff inventory keys aligned', () => {
    for (const key of keys) {
      expect(ru.admin[key]).toBeTruthy();
      expect(en.admin[key]).toBeTruthy();
      expect(bg.admin[key]).toBeTruthy();
    }
    expect(ru.admin.invStaff).toBe('Моя инвентаризация');
    expect(en.admin.invStaff).toBe('My inventory');
    expect(bg.admin.invStaff).toBe('Моята инвентаризация');
  });
});
