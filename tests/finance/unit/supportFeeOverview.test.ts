import { describe, expect, it } from 'vitest';
import { canonicalSupportOutstanding, supportOverpayment } from '@/lib/supportFeeBalance';
import { computeLateIncreaseWaiveAmount } from '@/lib/supportFeePenalty';
import { previewReverseSupportPayment } from '@/lib/supportFeeReversal';
import {
  buildSupportFeeOverviewStats,
  countSupportFeeDebtors,
  overviewBarShare,
  sumLedgerByKind,
  supportFeeStandingCharges,
  supportFeeStandingPayments,
} from '@/lib/supportFeeOverview';

describe('Task 10 · Support Fee overview stats', () => {
  it('sums charges and payments without inventing amounts', () => {
    const ledger = [
      { kind: 'charge', amount: 100 },
      { kind: 'payment', amount: 40 },
      { kind: 'charge', amount: 25.5 },
      { kind: 'late_increase_waive', amount: 10 },
      { kind: 'opening_obligation', amount: 80 },
      { kind: 'opening_historical_settlement', amount: 20 },
      { kind: 'opening_credit', amount: 5 },
      { kind: 'payment_reversal', amount: 15 },
      { kind: 'assessment_void', amount: 30 },
      { kind: 'adjustment_debit', amount: 7 },
      { kind: 'adjustment_credit', amount: 3 },
    ];
    expect(sumLedgerByKind(ledger, 'charge')).toBe(125.5);
    expect(sumLedgerByKind(ledger, 'payment')).toBe(40);
    expect(sumLedgerByKind(ledger, 'assessment_void')).toBe(30);
    expect(sumLedgerByKind(ledger, 'payment_reversal')).toBe(15);
    const stats = buildSupportFeeOverviewStats({
      ledger,
      outstandingTotal: 90,
      overpaymentTotal: 12,
      outstandingByProperty: [90],
      apartmentsCount: 1,
    });
    expect(stats.chargesTotal).toBe(95.5);
    expect(stats.paymentsTotal).toBe(25);
    expect(stats.chargesTotal).not.toBe(sumLedgerByKind(ledger, 'charge'));
    expect(stats.paymentsTotal).not.toBe(sumLedgerByKind(ledger, 'payment'));
    expect(stats.outstandingTotal).toBe(90);
    expect(stats.overpaymentTotal).toBe(12);
  });

  it('counts debtors and builds shares', () => {
    expect(countSupportFeeDebtors([10, 0, 5, 0])).toBe(2);
    expect(overviewBarShare(75, 25)).toBe(0.75);
    expect(overviewBarShare(0, 0)).toBe(0);

    const stats = buildSupportFeeOverviewStats({
      ledger: [
        { kind: 'charge', amount: 200 },
        { kind: 'payment', amount: 50 },
      ],
      outstandingTotal: 120,
      overpaymentTotal: 30,
      outstandingByProperty: [100, 20, 0],
      apartmentsCount: 3,
    });
    expect(stats.chargesTotal).toBe(200);
    expect(stats.paymentsTotal).toBe(50);
    expect(stats.debtorsCount).toBe(2);
    expect(stats.balanceShareOutstanding).toBe(0.8);
    expect(stats.activitySharePayments).toBe(0.2);
  });
});

describe('Support Fee overview KPI scenarios', () => {
  function kpi(input: {
    ledger: Array<{ kind: string; amount: number }>;
    assessments: Array<{ property_id: number; remaining_due: number; status: string }>;
    overpayment: number;
  }) {
    const outstanding = canonicalSupportOutstanding(input.assessments);
    const overpayment = supportOverpayment(input.overpayment);
    const stats = buildSupportFeeOverviewStats({
      ledger: input.ledger,
      outstandingTotal: outstanding,
      overpaymentTotal: overpayment,
      outstandingByProperty: [outstanding],
      apartmentsCount: 1,
    });
    return {
      charged: stats.chargesTotal,
      paid: stats.paymentsTotal,
      outstanding: stats.outstandingTotal,
      overpayment: stats.overpaymentTotal,
      balanceShareOutstanding: stats.balanceShareOutstanding,
      balanceShareOverpayment: stats.balanceShareOverpayment,
      grossCharged: sumLedgerByKind(input.ledger, 'charge'),
      grossPaid: sumLedgerByKind(input.ledger, 'payment'),
    };
  }

  it('charge 100 then void: standing charge is 0, outstanding stays 0', () => {
    const row = kpi({
      ledger: [
        { kind: 'charge', amount: 100 },
        { kind: 'assessment_void', amount: 100 },
      ],
      assessments: [{ property_id: 1, remaining_due: 0, status: 'void' }],
      overpayment: 0,
    });
    expect(row.grossCharged).toBe(100);
    expect(row).toMatchObject({
      charged: 0,
      paid: 0,
      outstanding: 0,
      overpayment: 0,
      balanceShareOutstanding: 0,
      balanceShareOverpayment: 0,
    });
    expect(supportFeeStandingCharges([
      { kind: 'charge', amount: 100 },
      { kind: 'assessment_void', amount: 100 },
    ])).toBe(0);
  });

  it('payment 100 fully allocated, then full reversal: paid returns to 0 and debt to 100', () => {
    const row = kpi({
      ledger: [
        { kind: 'charge', amount: 100 },
        { kind: 'payment', amount: 100 },
        { kind: 'payment_reversal', amount: 100 },
      ],
      assessments: [{ property_id: 1, remaining_due: 100, status: 'open' }],
      overpayment: 0,
    });
    expect(row.grossPaid).toBe(100);
    expect(row).toMatchObject({
      charged: 100,
      paid: 0,
      outstanding: 100,
      overpayment: 0,
      balanceShareOutstanding: 1,
      balanceShareOverpayment: 0,
    });
  });

  it('payment 100 partially allocated, then reversal of the whole payment: surplus credit is not left behind', () => {
    const preview = previewReverseSupportPayment({
      paymentAmount: 100,
      allocatedAmount: 60,
      portalDebt: 40,
      portalOverpayment: 40,
    });
    expect(preview.newDebt).toBe(100);
    expect(preview.newOverpayment).toBe(0);
    const row = kpi({
      ledger: [
        { kind: 'charge', amount: 100 },
        { kind: 'payment', amount: 100 },
        { kind: 'payment_reversal', amount: 100 },
      ],
      assessments: [{ property_id: 1, remaining_due: preview.newDebt, status: 'open' }],
      overpayment: preview.newOverpayment,
    });
    expect(row.grossPaid).toBe(100);
    expect(row).toMatchObject({
      charged: 100,
      paid: 0,
      outstanding: 100,
      overpayment: 0,
      balanceShareOutstanding: 1,
      balanceShareOverpayment: 0,
    });
  });

  it('void then restore: charge is back once, not doubled', () => {
    const row = kpi({
      ledger: [
        { kind: 'charge', amount: 100 },
        { kind: 'assessment_void', amount: 100 },
        { kind: 'assessment_restore', amount: 100 },
      ],
      assessments: [{ property_id: 1, remaining_due: 100, status: 'open' }],
      overpayment: 0,
    });
    expect(row.grossCharged).toBe(100);
    expect(row).toMatchObject({
      charged: 100,
      paid: 0,
      outstanding: 100,
      overpayment: 0,
      balanceShareOutstanding: 1,
      balanceShareOverpayment: 0,
    });
    expect(row.charged).not.toBe(200);
  });

  it('opening debt and credit without a new charge stay out of charged and paid', () => {
    const row = kpi({
      ledger: [
        { kind: 'opening_obligation', amount: 100 },
        { kind: 'opening_historical_settlement', amount: 20 },
        { kind: 'opening_credit', amount: 25 },
      ],
      assessments: [{ property_id: 1, remaining_due: 80, status: 'open' }],
      overpayment: 25,
    });
    expect(row).toMatchObject({
      charged: 0,
      paid: 0,
      outstanding: 80,
      overpayment: 25,
    });
    expect(row.balanceShareOutstanding).toBeCloseTo(80 / 105, 10);
    expect(row.balanceShareOverpayment).toBeCloseTo(25 / 105, 10);
    expect(row.grossCharged).toBe(0);
    expect(row.grossPaid).toBe(0);
  });

  it('late increase waive reduces outstanding only and is not a payment', () => {
    const waive = computeLateIncreaseWaiveAmount({
      baseAmount: 100,
      lateAmount: 110,
      remainingDue: 110,
    });
    expect(waive).toBe(10);
    const row = kpi({
      ledger: [
        { kind: 'charge', amount: 110 },
        { kind: 'late_increase_waive', amount: waive },
      ],
      assessments: [{ property_id: 1, remaining_due: 100, status: 'open' }],
      overpayment: 0,
    });
    expect(row).toMatchObject({
      charged: 110,
      paid: 0,
      outstanding: 100,
      overpayment: 0,
      balanceShareOutstanding: 1,
      balanceShareOverpayment: 0,
    });
    expect(supportFeeStandingPayments([{ kind: 'late_increase_waive', amount: waive }])).toBe(0);
    expect(supportFeeStandingCharges([{ kind: 'charge', amount: 110 }, { kind: 'late_increase_waive', amount: waive }])).toBe(110);
  });
});
