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
    expect(sql).toContain('tariff_can_publish');
    expect(sql).toContain('make_date(p_application_year, 1, 1)');
    expect(sql).not.toMatch(/reprice_capital|mass.?reprice|charge_capital_repair/i);
    expect(sql).not.toMatch(/capital_repair_ledger|capital_repair_fund|update public\.properties/i);
  });

  it('does not replace RC8 opening charge block or period-scoped first-run check', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    const opening = readFileSync(
      path.resolve(process.cwd(), 'supabase/migrations/20261125170000_r1_rc8_first_run_capital_repair_opening.sql'),
      'utf8',
    );
    const period = readFileSync(
      path.resolve(process.cwd(), 'supabase/migrations/20261125200000_r1_rc8_first_run_tariff_period_ready.sql'),
      'utf8',
    );
    expect(sql).not.toMatch(/create or replace function public\.charge_capital_repair/i);
    expect(sql).not.toMatch(/create or replace function public\.first_run_tariff_has_published/i);
    expect(opening).toContain('opening_import_blocks_charge');
    expect(opening).toContain('opening_import blocks charge');
    expect(period).toContain("first_run_tariff_has_published('capital_repair', v_cr_year)");
    expect(period).toContain('make_date(v_year, 1, 1)');
  });
});
