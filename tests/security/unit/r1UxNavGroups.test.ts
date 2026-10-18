import { describe, expect, it } from 'vitest';
import {
  buildAdminNavGroups,
  buildStaffNavGroups,
  type AdminNavFlags,
} from '@/lib/adminNav';

const allOn: AdminNavFlags = {
  isComplexAdmin: true,
  showMyTasks: true,
  showInventoryStaff: true,
  showApartments: true,
  showBook: true,
  showTransfers: true,
  showServiceLock: true,
  showSecurity: true,
  showCleaning: true,
  showInventory: true,
  showWater: true,
  showElectricity: true,
  showSupportFee: true,
  showCapital: true,
  showInternet: true,
  showElectricityFinance: true,
  showExpenses: true,
  showBudget: true,
  showTariffs: true,
  showReporting: true,
  showRequests: true,
  showWorkOrders: true,
  showAnnouncements: true,
  showPolls: true,
  showChat: true,
  showDocuments: true,
  showStaff: true,
  showSettings: true,
  showInitialSetup: true,
  showPlatform: true,
  showUserActivation: true,
};

describe('R1-UX admin/staff navigation groups', () => {
  it('admin has exactly 8 approved top-level groups when fully enabled', () => {
    const groups = buildAdminNavGroups(allOn);
    expect(groups.map((g) => g.id)).toEqual([
      'overview',
      'objects',
      'finance',
      'utilities',
      'operations',
      'comms',
      'docs',
      'system',
    ]);
    expect(groups).toHaveLength(8);
    // Meetings never appear as a nav leaf.
    const leaves = groups.flatMap((g) => g.items);
    expect(leaves).not.toContain('собрания');
    expect(leaves).not.toContain('решения');
    // Electricity lives under utilities, not a parallel finance meter ledger.
    expect(groups.find((g) => g.id === 'utilities')?.items).toContain('электроэнергия');
    expect(groups.find((g) => g.id === 'finance')?.items).not.toContain('электроэнергия');
  });

  it('admin omits empty groups when modules/permissions are off', () => {
    const groups = buildAdminNavGroups({
      ...allOn,
      showDocuments: false,
      showAnnouncements: false,
      showPolls: false,
      showChat: false,
      showWater: false,
      showElectricity: false,
      showElectricityFinance: false,
      showInternet: false,
    });
    expect(groups.find((g) => g.id === 'docs')).toBeUndefined();
    expect(groups.find((g) => g.id === 'comms')).toBeUndefined();
    expect(groups.find((g) => g.id === 'utilities')).toBeUndefined();
  });

  it('staff nav is capability-filtered and capped at 6 groups', () => {
    const full = buildStaffNavGroups({ ...allOn, isComplexAdmin: false });
    expect(full.length).toBeLessThanOrEqual(6);
    expect(full[0]?.id).toBe('overview');

    const restricted = buildStaffNavGroups({
      ...allOn,
      isComplexAdmin: false,
      showMyTasks: false,
      showInventoryStaff: false,
      showApartments: false,
      showBook: false,
      showTransfers: false,
      showServiceLock: false,
      showSupportFee: false,
      showCapital: false,
      showExpenses: false,
      showBudget: false,
      showTariffs: false,
      showReporting: false,
      showRequests: true,
      showWorkOrders: false,
      showWater: false,
      showElectricity: false,
      showElectricityFinance: false,
      showInternet: false,
      showCleaning: false,
      showSecurity: false,
      showInventory: false,
      showAnnouncements: false,
      showPolls: false,
      showChat: false,
      showDocuments: false,
      showStaff: false,
      showSettings: true,
    });
    expect(restricted.map((g) => g.id)).toEqual(['overview', 'maintenance', 'settings']);
    expect(restricted.find((g) => g.id === 'maintenance')?.items).toEqual(['заявки']);
  });

  it('staff with no permissions besides overview keeps a usable shell', () => {
    const emptyish = buildStaffNavGroups({
      ...allOn,
      isComplexAdmin: false,
      showMyTasks: false,
      showInventoryStaff: false,
      showApartments: false,
      showBook: false,
      showTransfers: false,
      showServiceLock: false,
      showSecurity: false,
      showCleaning: false,
      showInventory: false,
      showWater: false,
      showElectricity: false,
      showSupportFee: false,
      showCapital: false,
      showInternet: false,
      showElectricityFinance: false,
      showExpenses: false,
      showBudget: false,
      showTariffs: false,
      showReporting: false,
      showRequests: false,
      showWorkOrders: false,
      showAnnouncements: false,
      showPolls: false,
      showChat: false,
      showDocuments: false,
      showStaff: false,
      showSettings: false,
      showInitialSetup: false,
      showPlatform: false,
      showUserActivation: false,
    });
    expect(emptyish.map((g) => g.id)).toEqual(['overview']);
  });
});
