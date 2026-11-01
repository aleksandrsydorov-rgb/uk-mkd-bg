import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  assessWaiveLateIncreaseEligibility,
  computeLateIncreaseWaiveAmount,
  defaultEarlyPaymentDeadlineDate,
  earlyPaymentDeadlineIsoFromDate,
  validateSupportFeeAnnualPolicyDraft,
  validateWaiveLateIncreaseReason,
} from '@/lib/supportFeePenalty';

const MIGRATION = path.resolve(
  process.cwd(),
  'supabase/migrations/20261129130000_support_fee_late_increase_waive.sql',
);

describe('Task 08 · Support Fee discount/penalty policy helpers', () => {
  it('defaults early deadline to 31 Dec of prior year and builds ISO', () => {
    expect(defaultEarlyPaymentDeadlineDate(2027)).toBe('2026-12-31');
    expect(earlyPaymentDeadlineIsoFromDate('2026-12-15')).toBe('2026-12-15T23:59:00+02:00');
    expect(earlyPaymentDeadlineIsoFromDate('bad')).toBeNull();
  });

  it('validates configurable discount, increase, and deadline', () => {
    expect(
      validateSupportFeeAnnualPolicyDraft({
        discountPercent: 10,
        increasePercent: 10,
        deadlineYmd: '2026-12-31',
        billingYear: 2027,
      }),
    ).toEqual({ ok: true });

    expect(
      validateSupportFeeAnnualPolicyDraft({
        discountPercent: 10,
        increasePercent: 10,
        deadlineYmd: '2027-01-01',
        billingYear: 2027,
      }),
    ).toEqual({ ok: false, errorKey: 'admin.sfErrDeadlineBeforeYear' });

    expect(
      validateSupportFeeAnnualPolicyDraft({
        discountPercent: 101,
        increasePercent: 10,
        deadlineYmd: '2026-12-31',
        billingYear: 2027,
      }),
    ).toEqual({ ok: false, errorKey: 'admin.sfErrDiscountPct' });
  });

  it('computes waiveable late-increase portion', () => {
    expect(
      computeLateIncreaseWaiveAmount({ baseAmount: 100, lateAmount: 110, remainingDue: 110 }),
    ).toBe(10);
    expect(
      computeLateIncreaseWaiveAmount({ baseAmount: 100, lateAmount: 110, remainingDue: 5 }),
    ).toBe(5);
    expect(
      computeLateIncreaseWaiveAmount({ baseAmount: 100, lateAmount: 100, remainingDue: 100 }),
    ).toBe(0);
  });

  it('gates waive eligibility and requires reason', () => {
    expect(
      assessWaiveLateIncreaseEligibility({
        status: 'open',
        pricingRule: 'late',
        increasePercent: 10,
        baseAmount: 100,
        lateAmount: 110,
        remainingDue: 110,
      }),
    ).toEqual({ ok: true, waiveAmount: 10 });

    expect(
      assessWaiveLateIncreaseEligibility({
        status: 'open',
        pricingRule: 'late',
        increasePercent: 10,
        baseAmount: 100,
        lateAmount: 110,
        remainingDue: 110,
        alreadyWaived: true,
      }),
    ).toEqual({ ok: false, reason: 'already_waived' });

    expect(
      assessWaiveLateIncreaseEligibility({
        status: 'open',
        pricingRule: 'early_full_payment',
        increasePercent: 10,
        baseAmount: 90,
        lateAmount: 110,
        remainingDue: 90,
      }),
    ).toEqual({ ok: false, reason: 'not_late' });

    expect(validateWaiveLateIncreaseReason('')).toBe(false);
    expect(validateWaiveLateIncreaseReason('  GM decision #12  ')).toBe(true);
  });
});

describe('Task 08 · late increase waive migration', () => {
  it('requires reason and append-only late_increase_waive kind', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    expect(sql).toContain('waive_support_fee_late_increase');
    expect(sql).toContain('reason required');
    expect(sql).toContain('late_increase_waive');
    expect(sql).toContain('penalty_waive_reason');
    expect(sql).toContain('penalty_waived_at');
    expect(sql).toContain('penalty_waived_by_email');
    expect(sql).toContain('opening_import blocks waive');
    expect(sql).toContain('already waived');
    expect(sql).not.toMatch(/delete from public\.support_fee_assessments/i);
  });
});
