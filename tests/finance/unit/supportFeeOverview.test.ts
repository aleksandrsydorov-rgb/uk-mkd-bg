import { describe, expect, it } from 'vitest';
import {
  buildSupportFeeOverviewStats,
  countSupportFeeDebtors,
  overviewBarShare,
  sumLedgerByKind,
} from '@/lib/supportFeeOverview';

describe('Task 10 · Support Fee overview stats', () => {
  it('sums charges and payments without inventing amounts', () => {
    const ledger = [
      { kind: 'charge', amount: 100 },
      { kind: 'payment', amount: 40 },
      { kind: 'charge', amount: 25.5 },
      { kind: 'late_increase_waive', amount: 10 },
    ];
    expect(sumLedgerByKind(ledger, 'charge')).toBe(125.5);
    expect(sumLedgerByKind(ledger, 'payment')).toBe(40);
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
