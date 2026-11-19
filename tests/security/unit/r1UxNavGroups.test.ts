import { describe, expect, it } from 'vitest';
import {
  buildAdminNavGroups,
  buildStaffNavGroups,
  isAdminNavLeafActive,
  resolveDualEntryNavGroupId,
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
  showWaterFinance: true,
  showElectricityFinance: true,
  showInternetFinance: true,
  showSupportFee: true,
  showCapital: true,
  showInternet: true,
  showExpenses: true,
  showBudget: true,
  showTariffs: true,
  showReporting: true,
  showRequests: true,
  showWorkOrders: true,
  showAnnouncements: true,
  showPolls: true,
  showChat: true,
  showMeetings: true,
  showDocuments: true,
  showLegalDocuments: true,
  showStaff: true,
  showSettings: true,
  showNotifications: true,
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
    // RC8+: Meetings is a docs leaf when enabled; decisions stay out of top nav.
    const leaves = groups.flatMap((g) => g.items);
    expect(leaves).toContain('собрания');
    expect(leaves).not.toContain('решения');
    expect(groups.find((g) => g.id === 'docs')?.items).toEqual(['собрания', 'документы', 'правни']);
    // Same modules appear in Finance (finance tab) and Utilities (meters tab).
    expect(groups.find((g) => g.id === 'utilities')?.items).toContain('электроэнергия');
    expect(groups.find((g) => g.id === 'utilities')?.items).toContain('вода');
    expect(groups.find((g) => g.id === 'finance')?.items).toContain('электроэнергия');
    expect(groups.find((g) => g.id === 'finance')?.items).toContain('вода');
  });

  it('omits water/electricity from finance when only utilities flags are on', () => {
    const groups = buildAdminNavGroups({
      ...allOn,
      showWaterFinance: false,
      showElectricityFinance: false,
    });
    expect(groups.find((g) => g.id === 'finance')?.items).not.toContain('вода');
    expect(groups.find((g) => g.id === 'finance')?.items).not.toContain('электроэнергия');
    expect(groups.find((g) => g.id === 'utilities')?.items).toContain('вода');
    expect(groups.find((g) => g.id === 'utilities')?.items).toContain('электроэнергия');
  });

  it('admin omits empty groups when modules/permissions are off', () => {
    const groups = buildAdminNavGroups({
      ...allOn,
      showMeetings: false,
      showDocuments: false,
      showLegalDocuments: false,
      showAnnouncements: false,
      showPolls: false,
      showChat: false,
      showWater: false,
      showElectricity: false,
      showWaterFinance: false,
      showElectricityFinance: false,
      showInternet: false,
    });
    expect(groups.find((g) => g.id === 'docs')).toBeUndefined();
    expect(groups.find((g) => g.id === 'comms')).toBeUndefined();
    expect(groups.find((g) => g.id === 'utilities')).toBeUndefined();
  });

  it('admin shows Meetings alone under docs when documents module is off', () => {
    const groups = buildAdminNavGroups({
      ...allOn,
      showMeetings: true,
      showDocuments: false,
      showLegalDocuments: false,
    });
    expect(groups.find((g) => g.id === 'docs')?.items).toEqual(['собрания']);
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
      showWaterFinance: false,
      showElectricityFinance: false,
      showInternet: false,
      showInternetFinance: false,
      showCleaning: false,
      showSecurity: false,
      showInventory: false,
      showAnnouncements: false,
      showPolls: false,
      showChat: false,
      showMeetings: false,
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
      showWaterFinance: false,
      showSupportFee: false,
      showCapital: false,
      showInternet: false,
      showInternetFinance: false,
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
      showMeetings: false,
      showDocuments: false,
      showStaff: false,
      showSettings: false,
      showNotifications: false,
      showInitialSetup: false,
      showPlatform: false,
      showUserActivation: false,
    });
    expect(emptyish.map((g) => g.id)).toEqual(['overview']);
  });

  it('dual-entry active leaf follows section + finance/utilities group, not the other twin', () => {
    const groups = buildAdminNavGroups(allOn);
    expect(resolveDualEntryNavGroupId({ section: 'вода', tab: 'finance', groups })).toBe('finance');
    expect(resolveDualEntryNavGroupId({ section: 'вода', tab: 'overview', groups })).toBe('utilities');
    expect(resolveDualEntryNavGroupId({ section: 'электроэнергия', tab: 'meter', groups })).toBe(
      'utilities',
    );
    expect(resolveDualEntryNavGroupId({ section: 'интернет', tab: 'finance', groups })).toBe('finance');
    expect(resolveDualEntryNavGroupId({ section: 'интернет', tab: 'operations', groups })).toBe(
      'utilities',
    );

    expect(
      isAdminNavLeafActive({
        section: 'вода',
        groupId: 'finance',
        activeSection: 'вода',
        tab: 'finance',
      }),
    ).toBe(true);
    expect(
      isAdminNavLeafActive({
        section: 'вода',
        groupId: 'utilities',
        activeSection: 'вода',
        tab: 'finance',
      }),
    ).toBe(false);
    expect(
      isAdminNavLeafActive({
        section: 'вода',
        groupId: 'utilities',
        activeSection: 'вода',
        tab: 'overview',
      }),
    ).toBe(true);
    expect(
      isAdminNavLeafActive({
        section: 'вода',
        groupId: 'finance',
        activeSection: 'вода',
        tab: 'overview',
      }),
    ).toBe(false);
  });

  it('staff dual-entry metering group is maintenance, not utilities', () => {
    const groups = buildStaffNavGroups({ ...allOn, isComplexAdmin: false });
    expect(resolveDualEntryNavGroupId({ section: 'вода', tab: 'readings', groups })).toBe(
      'maintenance',
    );
    expect(resolveDualEntryNavGroupId({ section: 'вода', tab: 'finance', groups })).toBe('finance');
  });
});
