import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  canCallOwnershipChangeOverdueDebt,
  canSelectSupportFeeLedger,
  scrubGuestPropertyFinanceFields,
} from '@/lib/securityRpcPolicy';

const MIGRATION = path.resolve(
  process.cwd(),
  'supabase/migrations/20261016120000_phase_e2_1_finance_security_hardening.sql'
);

describe('FIN-P0-1 · ownership_change_overdue_debt authz', () => {
  it('denies anon, guest, former owner, unrelated owner', () => {
    expect(
      canCallOwnershipChangeOverdueDebt({
        role: 'anon',
        isBookAdmin: false,
        isAccountant: false,
        ownsProperty: false,
        isGuestOnly: false,
        isFormerOwner: false,
      })
    ).toBe(false);
    expect(
      canCallOwnershipChangeOverdueDebt({
        role: 'authenticated',
        isBookAdmin: false,
        isAccountant: false,
        ownsProperty: false,
        isGuestOnly: true,
        isFormerOwner: false,
      })
    ).toBe(false);
    expect(
      canCallOwnershipChangeOverdueDebt({
        role: 'authenticated',
        isBookAdmin: false,
        isAccountant: false,
        ownsProperty: false,
        isGuestOnly: false,
        isFormerOwner: true,
      })
    ).toBe(false);
    expect(
      canCallOwnershipChangeOverdueDebt({
        role: 'authenticated',
        isBookAdmin: false,
        isAccountant: false,
        ownsProperty: false,
        isGuestOnly: false,
        isFormerOwner: false,
      })
    ).toBe(false);
  });

  it('allows authorized owner, co-owner (ownsProperty), admin, accountant, service_role', () => {
    expect(
      canCallOwnershipChangeOverdueDebt({
        role: 'authenticated',
        isBookAdmin: false,
        isAccountant: false,
        ownsProperty: true,
        isGuestOnly: false,
        isFormerOwner: false,
      })
    ).toBe(true);
    expect(
      canCallOwnershipChangeOverdueDebt({
        role: 'authenticated',
        isBookAdmin: true,
        isAccountant: false,
        ownsProperty: false,
        isGuestOnly: false,
        isFormerOwner: false,
      })
    ).toBe(true);
    expect(
      canCallOwnershipChangeOverdueDebt({
        role: 'authenticated',
        isBookAdmin: false,
        isAccountant: true,
        ownsProperty: false,
        isGuestOnly: false,
        isFormerOwner: false,
      })
    ).toBe(true);
    expect(
      canCallOwnershipChangeOverdueDebt({
        role: 'service_role',
        isBookAdmin: false,
        isAccountant: false,
        ownsProperty: false,
        isGuestOnly: false,
        isFormerOwner: false,
      })
    ).toBe(true);
  });

  it('migration forbids cross-apartment access and leaves debt gate untouched', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    expect(sql).toContain('ownership_change_overdue_debt: forbidden');
    expect(sql).toContain('owns_property(p_property_id)');
    expect(sql).toContain("has_staff_role('администрация')");
    expect(sql).toContain("has_staff_role('бухгалтер')");
    expect(sql).not.toMatch(/ordinary_debt_gate_enabled\s*=\s*true/i);
  });
});

describe('FIN-P1-1 · guest finance scrub', () => {
  it('zeros debt and overpayment for guest property rows', () => {
    expect(
      scrubGuestPropertyFinanceFields({
        id: 1,
        debt: 120.5,
        overpayment: 10,
        apartment_number: '12',
      })
    ).toEqual({
      id: 1,
      debt: 0,
      overpayment: 0,
      apartment_number: '12',
    });
  });

  it('migration forces guest debt/overpayment to zero', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    expect(sql).toContain('list_my_guest_properties');
    expect(sql).toContain('r.debt := 0');
    expect(sql).toContain('r.overpayment := 0');
  });
});

describe('FIN-P1-2 · support_fee_ledger SELECT isolation', () => {
  it('allows owner of apartment and finance staff; denies guest/anon/unrelated', () => {
    expect(
      canSelectSupportFeeLedger({
        role: 'authenticated',
        isBookAdmin: false,
        isAccountant: false,
        ownsProperty: true,
        isGuestOnly: false,
      })
    ).toBe(true);
    expect(
      canSelectSupportFeeLedger({
        role: 'authenticated',
        isBookAdmin: true,
        isAccountant: false,
        ownsProperty: false,
        isGuestOnly: false,
      })
    ).toBe(true);
    expect(
      canSelectSupportFeeLedger({
        role: 'authenticated',
        isBookAdmin: false,
        isAccountant: true,
        ownsProperty: false,
        isGuestOnly: false,
      })
    ).toBe(true);
    expect(
      canSelectSupportFeeLedger({
        role: 'authenticated',
        isBookAdmin: false,
        isAccountant: false,
        ownsProperty: false,
        isGuestOnly: true,
      })
    ).toBe(false);
    expect(
      canSelectSupportFeeLedger({
        role: 'authenticated',
        isBookAdmin: false,
        isAccountant: false,
        ownsProperty: false,
        isGuestOnly: false,
      })
    ).toBe(false);
    expect(
      canSelectSupportFeeLedger({
        role: 'anon',
        isBookAdmin: false,
        isAccountant: false,
        ownsProperty: false,
        isGuestOnly: false,
      })
    ).toBe(false);
  });

  it('migration restores owns_property on ledger policy', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    expect(sql).toContain('support_fee_ledger_finance_select');
    expect(sql).toContain('owns_property(property_id)');
  });
});

describe('PKG-XFER / transfer compatibility mirrors', () => {
  it('admin overdue access remains allowed without owning the apartment', () => {
    expect(
      canCallOwnershipChangeOverdueDebt({
        role: 'authenticated',
        isBookAdmin: true,
        isAccountant: false,
        ownsProperty: false,
        isGuestOnly: false,
        isFormerOwner: false,
      })
    ).toBe(true);
  });

  it('co-owner with ownsProperty may probe overdue; guest may not', () => {
    expect(
      canCallOwnershipChangeOverdueDebt({
        role: 'authenticated',
        isBookAdmin: false,
        isAccountant: false,
        ownsProperty: true,
        isGuestOnly: false,
        isFormerOwner: false,
      })
    ).toBe(true);
    expect(
      canCallOwnershipChangeOverdueDebt({
        role: 'authenticated',
        isBookAdmin: false,
        isAccountant: false,
        ownsProperty: false,
        isGuestOnly: true,
        isFormerOwner: false,
      })
    ).toBe(false);
  });
});
