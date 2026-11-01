/**
 * Task 10 — Support Fee overview presentation helpers (no amount mutation).
 */

export type SupportFeeOverviewLedgerLite = {
  kind: string;
  amount: number | string | null | undefined;
};

export type SupportFeeOverviewStats = {
  chargesTotal: number;
  paymentsTotal: number;
  debtorsCount: number;
  apartmentsCount: number;
  outstandingTotal: number;
  overpaymentTotal: number;
  balanceShareOutstanding: number;
  balanceShareOverpayment: number;
  activityShareCharges: number;
  activitySharePayments: number;
};

function roundMoney(n: number) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/** Gross turnover of one ledger kind. Not a standing balance and not a repayment share. */
export function sumLedgerByKind(
  ledger: SupportFeeOverviewLedgerLite[],
  kind: string,
): number {
  return roundMoney(
    ledger
      .filter((e) => String(e.kind) === kind)
      .reduce((s, e) => s + (Number(e.amount) || 0), 0),
  );
}

/**
 * Standing operational charges.
 * charge − assessment_void + assessment_restore.
 * Restore puts a voided charge back once and does not add a second charge.
 * Opening, adjustments, payments, and late_increase_waive are not charges.
 */
export function supportFeeStandingCharges(ledger: SupportFeeOverviewLedgerLite[]): number {
  return roundMoney(
    Math.max(
      0,
      sumLedgerByKind(ledger, 'charge') -
        sumLedgerByKind(ledger, 'assessment_void') +
        sumLedgerByKind(ledger, 'assessment_restore'),
    ),
  );
}

/**
 * Standing operational payments: payment − payment_reversal.
 * A reversal row is the full original payment, so a partial allocation still nets to zero paid.
 * Opening settlement/credit and late_increase_waive are not payments.
 */
export function supportFeeStandingPayments(ledger: SupportFeeOverviewLedgerLite[]): number {
  return roundMoney(
    Math.max(
      0,
      sumLedgerByKind(ledger, 'payment') - sumLedgerByKind(ledger, 'payment_reversal'),
    ),
  );
}

export function countSupportFeeDebtors(outstandingByProperty: number[]): number {
  return outstandingByProperty.filter((n) => Number(n) > 0).length;
}

/** Share of a in a+b for a simple bar (0..1). */
export function overviewBarShare(a: number, b: number): number {
  const x = Math.max(0, Number(a) || 0);
  const y = Math.max(0, Number(b) || 0);
  const t = x + y;
  if (!(t > 0)) return 0;
  return x / t;
}

export function buildSupportFeeOverviewStats(input: {
  ledger: SupportFeeOverviewLedgerLite[];
  outstandingTotal: number;
  overpaymentTotal: number;
  outstandingByProperty: number[];
  apartmentsCount: number;
}): SupportFeeOverviewStats {
  const chargesTotal = supportFeeStandingCharges(input.ledger);
  const paymentsTotal = supportFeeStandingPayments(input.ledger);
  const outstandingTotal = roundMoney(input.outstandingTotal);
  const overpaymentTotal = roundMoney(input.overpaymentTotal);
  return {
    chargesTotal,
    paymentsTotal,
    debtorsCount: countSupportFeeDebtors(input.outstandingByProperty),
    apartmentsCount: Math.max(0, Math.floor(Number(input.apartmentsCount) || 0)),
    outstandingTotal,
    overpaymentTotal,
    balanceShareOutstanding: overviewBarShare(outstandingTotal, overpaymentTotal),
    balanceShareOverpayment: overviewBarShare(overpaymentTotal, outstandingTotal),
    // Composition of the two standing totals only. Not a repayment ratio and not shown as one.
    activityShareCharges: overviewBarShare(chargesTotal, paymentsTotal),
    activitySharePayments: overviewBarShare(paymentsTotal, chargesTotal),
  };
}
