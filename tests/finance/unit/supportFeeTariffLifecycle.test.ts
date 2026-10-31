import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  defaultSupportFeePublishIntent,
  supportFeeAllowedApplicationYears,
  supportFeeHasCurrentTariff,
  supportFeePlannedApplicationYear,
  supportFeePublishValidFrom,
  validateSupportFeePublishInput,
} from '@/lib/tariffs';

const MIGRATION = path.resolve(
  process.cwd(),
  'supabase/migrations/20261129120000_support_fee_tariff_lifecycle_policy.sql',
);

const FIXED_NOW = new Date('2026-06-15T12:00:00+03:00');

describe('Task 07 · Support Fee tariff lifecycle helpers', () => {
  it('detects first activation vs working building', () => {
    expect(supportFeeHasCurrentTariff(null)).toBe(false);
    expect(supportFeeHasCurrentTariff({ current_version_id: null })).toBe(false);
    expect(supportFeeHasCurrentTariff({ current_version_id: 'v1' })).toBe(true);
    expect(defaultSupportFeePublishIntent({ current_version_id: null })).toBe('activation');
    expect(defaultSupportFeePublishIntent({ current_version_id: 'v1' })).toBe('next_year');
  });

  it('limits planned year to next calendar year only', () => {
    expect(supportFeePlannedApplicationYear(FIXED_NOW)).toBe(2027);
    expect(supportFeeAllowedApplicationYears('next_year', FIXED_NOW)).toEqual([2027]);
    expect(supportFeeAllowedApplicationYears('activation', FIXED_NOW)).toEqual([2026, 2027]);
    expect(supportFeeAllowedApplicationYears('amend', FIXED_NOW)).toEqual([2026]);
  });

  it('validates activation / next_year / amend intents', () => {
    expect(
      validateSupportFeePublishInput({
        intent: 'activation',
        applicationYear: 2026,
        validFrom: null,
        hasCurrentTariff: false,
        todayIso: '2026-06-15',
      }),
    ).toEqual({ ok: true });

    expect(
      validateSupportFeePublishInput({
        intent: 'activation',
        applicationYear: 2025,
        validFrom: null,
        hasCurrentTariff: false,
        todayIso: '2026-06-15',
      }),
    ).toEqual({ ok: false, errorKey: 'admin.tcErrSupportActivationYear' });

    expect(
      validateSupportFeePublishInput({
        intent: 'activation',
        applicationYear: 2026,
        validFrom: null,
        hasCurrentTariff: true,
        todayIso: '2026-06-15',
      }),
    ).toEqual({ ok: false, errorKey: 'admin.tcErrSupportActivationDone' });

    expect(
      validateSupportFeePublishInput({
        intent: 'next_year',
        applicationYear: 2027,
        validFrom: null,
        hasCurrentTariff: true,
        todayIso: '2026-06-15',
      }),
    ).toEqual({ ok: true });

    expect(
      validateSupportFeePublishInput({
        intent: 'next_year',
        applicationYear: 2028,
        validFrom: null,
        hasCurrentTariff: true,
        todayIso: '2026-06-15',
      }),
    ).toEqual({ ok: false, errorKey: 'admin.tcErrSupportNextYearOnly' });

    expect(
      validateSupportFeePublishInput({
        intent: 'amend',
        applicationYear: 2026,
        validFrom: '2026-07-01',
        hasCurrentTariff: true,
        todayIso: '2026-06-15',
      }),
    ).toEqual({ ok: true });

    expect(
      validateSupportFeePublishInput({
        intent: 'amend',
        applicationYear: 2026,
        validFrom: '2026-06-01',
        hasCurrentTariff: true,
        todayIso: '2026-06-15',
      }),
    ).toEqual({ ok: false, errorKey: 'admin.tcErrValidFrom' });

    expect(
      validateSupportFeePublishInput({
        intent: 'amend',
        applicationYear: 2027,
        validFrom: '2026-07-01',
        hasCurrentTariff: true,
        todayIso: '2026-06-15',
      }),
    ).toEqual({ ok: false, errorKey: 'admin.tcErrSupportAmendYear' });
  });

  it('passes valid_from only for amend intent', () => {
    expect(
      supportFeePublishValidFrom({
        intent: 'activation',
        applicationYear: 2026,
        amendValidFrom: '2026-06-15',
      }),
    ).toBeNull();
    expect(
      supportFeePublishValidFrom({
        intent: 'next_year',
        applicationYear: 2027,
        amendValidFrom: '2026-06-15',
      }),
    ).toBeNull();
    expect(
      supportFeePublishValidFrom({
        intent: 'amend',
        applicationYear: 2026,
        amendValidFrom: '2026-07-01',
      }),
    ).toBe('2026-07-01');
  });
});

describe('Task 07 · Support Fee publish_tariff_version migration', () => {
  it('encodes activation / next-year / amend rules without auto-reprice language', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    expect(sql).toContain("v_cat.module_key = 'support_fee'");
    expect(sql).toContain('support activation year must be');
    expect(sql).toContain('planned support tariff must be next calendar year');
    expect(sql).toContain('support amendment requires an existing tariff');
    expect(sql).toContain('support amendment year must be current year');
    expect(sql).toContain('past valid_from not allowed');
    expect(sql).toContain('does not auto-reprice assessments');
    expect(sql).not.toMatch(/reprice_support|finalize_support_fee_assessment|mass.?reprice/i);
  });
});
