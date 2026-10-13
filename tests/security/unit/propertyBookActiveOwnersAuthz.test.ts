import { describe, expect, it } from 'vitest';
import { canCallPropertyBookActiveOwners } from '@/lib/securityRpcPolicy';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const MIGRATION = path.resolve(
  process.cwd(),
  'supabase/migrations/20261015120000_phase_e1_security_hardening.sql'
);

describe('SEC-P1-1 · property_book_active_owners authz', () => {
  it('allows service_role and book admin', () => {
    expect(
      canCallPropertyBookActiveOwners({
        role: 'service_role',
        isBookAdmin: false,
        ownsProperty: false,
        isGuestOnly: false,
      })
    ).toBe(true);
    expect(
      canCallPropertyBookActiveOwners({
        role: 'authenticated',
        isBookAdmin: true,
        ownsProperty: false,
        isGuestOnly: false,
      })
    ).toBe(true);
  });

  it('allows Book owner / co-owner on the target property', () => {
    expect(
      canCallPropertyBookActiveOwners({
        role: 'authenticated',
        isBookAdmin: false,
        ownsProperty: true,
        isGuestOnly: false,
      })
    ).toBe(true);
  });

  it('denies anon, guests, and unrelated owners', () => {
    expect(
      canCallPropertyBookActiveOwners({
        role: 'anon',
        isBookAdmin: false,
        ownsProperty: false,
        isGuestOnly: false,
      })
    ).toBe(false);
    expect(
      canCallPropertyBookActiveOwners({
        role: 'authenticated',
        isBookAdmin: false,
        ownsProperty: false,
        isGuestOnly: true,
      })
    ).toBe(false);
    expect(
      canCallPropertyBookActiveOwners({
        role: 'authenticated',
        isBookAdmin: false,
        ownsProperty: false,
        isGuestOnly: false,
      })
    ).toBe(false);
  });

  it('migration embeds owns_property + admin + forbidden raise', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    expect(sql).toContain('create or replace function public.property_book_active_owners');
    expect(sql).toContain("has_staff_role('администрация')");
    expect(sql).toContain('owns_property(p_property_id)');
    expect(sql).toContain("property_book_active_owners: forbidden");
    expect(sql).toContain("errcode = '42501'");
  });
});
