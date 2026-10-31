import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  capitalRepairAllowedApplicationYears,
  capitalRepairPublishValidFrom,
  defaultCapitalRepairPublishIntent,
  validateCapitalRepairPublishInput,
} from '@/lib/tariffs';

const MIGRATION = path.resolve(
  process.cwd(),
  'supabase/migrations/20261129140000_capital_repair_tariff_lifecycle_policy.sql',
);

const FIXED_NOW = new Date('2026-06-15T12:00:00+03:00');

describe('Task 11 · Capital Repair tariff lifecycle helpers', () => {
  it('defaults activation vs next-year and limits years', () => {
    expect(defaultCapitalRepairPublishIntent({ current_version_id: null })).toBe('activation');
    expect(defaultCapitalRepairPublishIntent({ current_version_id: 'v1' })).toBe('next_year');
    expect(capitalRepairAllowedApplicationYears('activation', FIXED_NOW)).toEqual([2026, 2027]);
    expect(capitalRepairAllowedApplicationYears('next_year', FIXED_NOW)).toEqual([2027]);
    expect(capitalRepairAllowedApplicationYears('amend', FIXED_NOW)).toEqual([2026]);
  });

  it('validates capital intents with capital error keys', () => {
    expect(
      validateCapitalRepairPublishInput({
        intent: 'activation',
        applicationYear: 2026,
        validFrom: null,
        hasCurrentTariff: false,
        todayIso: '2026-06-15',
      }),
    ).toEqual({ ok: true });

    expect(
      validateCapitalRepairPublishInput({
        intent: 'next_year',
        applicationYear: 2028,
        validFrom: null,
        hasCurrentTariff: true,
        todayIso: '2026-06-15',
      }),
    ).toEqual({ ok: false, errorKey: 'admin.tcErrCapitalNextYearOnly' });

    expect(
      validateCapitalRepairPublishInput({
        intent: 'amend',
        applicationYear: 2026,
        validFrom: '2026-07-01',
        hasCurrentTariff: true,
        todayIso: '2026-06-15',
      }),
    ).toEqual({ ok: true });

    expect(
      capitalRepairPublishValidFrom({
        intent: 'amend',
        applicationYear: 2026,
        amendValidFrom: '2026-07-01',
      }),
    ).toBe('2026-07-01');
  });
});

describe('Task 11 · Capital Repair publish_tariff_version migration', () => {
  it('applies activation/next-year/amend to capital_repair without auto-reprice', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    expect(sql).toContain("v_cat.module_key in ('support_fee', 'capital_repair')");
    expect(sql).toContain('activation year must be');
    expect(sql).toContain('planned % tariff must be next calendar year');
    expect(sql).toContain('amendment requires an existing tariff');
    expect(sql).toContain('does not auto-reprice assessments');
    expect(sql).not.toMatch(/reprice_capital|mass.?reprice/i);
  });
});
