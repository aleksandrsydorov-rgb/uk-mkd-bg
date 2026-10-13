import { describe, expect, it } from 'vitest';
import {
  annualSupportFee,
  applySupportCharge,
  applySupportPayment,
  canRecordSupportPayments,
  monthlySupportFee,
  supportPaymentIdempotencySignature,
} from '@/lib/finance';

/**
 * Phase E2 contract tests — pure client mirrors of support-fee money math.
 * Do not invent billing rules; assert documented helpers only.
 */
describe('Finance contract · support fee money math', () => {
  it('rounds area × rate to 2 decimals (apartment-level, not share-split)', () => {
    expect(annualSupportFee(50.125, 8)).toBe(401); // 50.125*8=401
    expect(annualSupportFee(33.333, 8)).toBe(266.66);
    expect(annualSupportFee(10, null)).toBeNull();
    expect(annualSupportFee(10, 0)).toBeNull();
  });

  it('derives monthly as annual/12 with money rounding', () => {
    expect(monthlySupportFee(100, 8)).toBe(66.67); // 800/12
  });

  it('allocates partial payment against debt without touching overpayment', () => {
    expect(applySupportPayment(100, 5, 40)).toEqual({ debt: 60, overpayment: 5 });
  });

  it('turns surplus payment into overpayment', () => {
    expect(applySupportPayment(30, 0, 50)).toEqual({ debt: 0, overpayment: 20 });
  });

  it('consumes overpayment before increasing debt on charge', () => {
    expect(applySupportCharge(10, 25, 20)).toEqual({ debt: 10, overpayment: 5 });
    expect(applySupportCharge(10, 5, 20)).toEqual({ debt: 25, overpayment: 0 });
  });

  it('rejects non-positive payment/charge amounts', () => {
    expect(() => applySupportPayment(10, 0, 0)).toThrow();
    expect(() => applySupportCharge(10, 0, -1)).toThrow();
  });

  it('builds deterministic payment idempotency signatures', () => {
    expect(
      supportPaymentIdempotencySignature({
        mode: 'regular',
        propertyId: 12,
        amount: 10.5,
        note: null,
      })
    ).toBe('regular|12|10.50|Оплата таксы поддержки');
    expect(
      supportPaymentIdempotencySignature({
        mode: 'year',
        propertyId: 12,
        amount: 10.5,
        billingYear: 2026,
        note: 'x',
      })
    ).toBe('year|12|10.50|2026|x');
  });

  it('limits payment recording to admin/accountant roles (UX helper)', () => {
    expect(canRecordSupportPayments('администрация')).toBe(true);
    expect(canRecordSupportPayments('бухгалтер')).toBe(true);
    expect(canRecordSupportPayments('инженер')).toBe(false);
    expect(canRecordSupportPayments(null)).toBe(false);
  });
});
