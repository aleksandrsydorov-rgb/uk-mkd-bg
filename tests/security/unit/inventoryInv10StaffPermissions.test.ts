import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  emptyStaffInventoryPermissionsForm,
  inventoryStaffFormMentionsAdminOnlyCaps,
  staffInventoryCapabilitiesPayload,
  staffInventoryFormFromCapabilities,
  withInventoryAccess,
  shouldShowInventoryStaff,
  emptyInventoryStaffCapabilities,
  canSeeInventoryStaff,
} from '@/lib/inventory';
import { emptyBuildingModulesState } from '@/lib/modules';
import { bg, en, ru } from '@/i18n/messages';

const root = join(__dirname, '../../..');

function readSrc(rel: string): string {
  return readFileSync(join(root, rel), 'utf8');
}

describe('INV-10 staff inventory permissions form', () => {
  it('wires employee form section and canonical RPC save', () => {
    const page = readSrc('src/app/admin/page.tsx');
    expect(page).toContain('invStaffRespTitle');
    expect(page).toContain('invStaffRespAccess');
    expect(page).toContain('withInventoryAccess');
    expect(page).toContain('staffInventoryCapabilitiesPayload');
    expect(page).toContain('inventory_set_staff_capabilities');
    expect(page).toContain('staff_inventory_capabilities');
    expect(page).toContain('set_staff_work_profile');
    expect(inventoryStaffFormMentionsAdminOnlyCaps(page)).toBe(false);
  });

  it('maps granular form to payload without admin-only elevation', () => {
    const form = withInventoryAccess(emptyStaffInventoryPermissionsForm(), true);
    form.canView = true;
    form.canSessionParticipate = true;
    form.canEditAssets = true;
    form.canStockMove = true;
    form.canRecordMaintenance = true;
    const payload = staffInventoryCapabilitiesPayload(form, { employeeActive: true });
    expect(payload.p_can_view).toBe(true);
    expect(payload.p_can_session_participate).toBe(true);
    expect(payload.p_can_edit_assets).toBe(true);
    expect(payload.p_can_stock_move).toBe(true);
    expect(payload.p_can_approve_sessions).toBe(false);
    expect(payload.p_can_write_off).toBe(false);
    expect(payload.p_can_manage_categories).toBe(false);
    expect(payload.p_can_session_review).toBe(false);
  });

  it('revokes all effective caps when access disabled', () => {
    const form = withInventoryAccess(emptyStaffInventoryPermissionsForm(), true);
    form.canView = true;
    form.canEditAssets = true;
    const cleared = withInventoryAccess(form, false);
    expect(cleared.hasAccess).toBe(false);
    const payload = staffInventoryCapabilitiesPayload(cleared, { employeeActive: true });
    expect(Object.values(payload).every((v) => v === false)).toBe(true);
  });

  it('revokes caps when employee inactive even if form has access', () => {
    const form = withInventoryAccess(emptyStaffInventoryPermissionsForm(), true);
    form.canView = true;
    form.canSessionParticipate = true;
    const payload = staffInventoryCapabilitiesPayload(form, { employeeActive: false });
    expect(payload.p_can_view).toBe(false);
    expect(payload.p_can_session_participate).toBe(false);
  });

  it('maintenance checkbox maps to can_edit_assets (canonical gate)', () => {
    const form = withInventoryAccess(emptyStaffInventoryPermissionsForm(), true);
    form.canView = true;
    form.canRecordMaintenance = true;
    form.canEditAssets = false;
    const payload = staffInventoryCapabilitiesPayload(form);
    expect(payload.p_can_edit_assets).toBe(true);
  });

  it('reloads form from capabilities row', () => {
    const form = staffInventoryFormFromCapabilities({
      can_view: true,
      can_session_participate: true,
      can_edit_assets: false,
      can_stock_move: true,
      can_approve_sessions: false,
      can_write_off: false,
    });
    expect(form.hasAccess).toBe(true);
    expect(form.canView).toBe(true);
    expect(form.canSessionParticipate).toBe(true);
    expect(form.canStockMove).toBe(true);
    expect(form.canEditAssets).toBe(false);
    expect(form.canRecordMaintenance).toBe(false);
  });

  it('staff navigation still requires module + caps/assignment', () => {
    const caps = emptyInventoryStaffCapabilities();
    caps.canView = true;
    expect(
      shouldShowInventoryStaff(
        { ...emptyBuildingModulesState(), inventory: true },
        { staffActive: true, caps, hasAssignedSessions: false },
      ),
    ).toBe(true);
    expect(
      shouldShowInventoryStaff(
        { ...emptyBuildingModulesState(), inventory: false },
        { staffActive: true, caps, hasAssignedSessions: true },
      ),
    ).toBe(false);
    expect(
      canSeeInventoryStaff({
        staffActive: false,
        caps,
        hasAssignedSessions: true,
      }),
    ).toBe(false);
  });

  it('BG/RU/EN localization keys present', () => {
    for (const m of [ru.admin, en.admin, bg.admin]) {
      expect(m.invStaffRespTitle).toBeTruthy();
      expect(m.invStaffRespAccess).toBeTruthy();
      expect(m.invStaffRespView).toBeTruthy();
      expect(m.invStaffRespParticipate).toBeTruthy();
      expect(m.invStaffRespEditAssets).toBeTruthy();
      expect(m.invStaffRespStockMove).toBeTruthy();
      expect(m.invStaffRespMaintenance).toBeTruthy();
      expect(m.invStaffRespHint).toBeTruthy();
      expect(m.woResponsibility).toBeTruthy();
    }
  });

  it('preserves ticket responsibility keys and save path', () => {
    const page = readSrc('src/app/admin/page.tsx');
    expect(page).toContain('woResponsibility');
    expect(page).toContain('can_self_claim_requests');
    expect(page).toContain('can_receive_work_orders');
    expect(page).toContain('set_staff_work_profile');
    expect(page.indexOf('set_staff_work_profile')).toBeLessThan(
      page.indexOf('inventory_set_staff_capabilities'),
    );
  });
});
