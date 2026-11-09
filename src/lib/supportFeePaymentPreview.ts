/**
 * Client-side preview of Support Fee payment allocation (mirrors FIFO by billing_year).
 * Does not post anything — server remains source of truth.
 */

function roundMoney(n: number) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export type SupportFeePayPreviewAssessment = {
  id: string;
  billing_year: number;
  remaining_due: number;
  base_amount?: number | null;
  increase_percent?: number | null;
  pricing_rule?: string | null;
  penalty_waived_at?: string | null;
  late_penalty_ledger_id?: number | null;
  status?: string | null;
};

export type SupportFeePayPreviewLine = {
  assessmentId: string;
  billingYear: number;
  applied: number;
  remainingAfter: number;
  isPenaltyYear: boolean;
  increasePercent: number;
};

export function previewSupportFeePaymentAllocation(input: {
  amount: number;
  assessments: SupportFeePayPreviewAssessment[];
}): {
  lines: SupportFeePayPreviewLine[];
  appliedToDebt: number;
  overpaymentCreated: number;
  expectedOutstanding: number;
} {
  const pay = roundMoney(Math.max(0, Number(input.amount) || 0));
  const open = [...input.assessments]
    .filter((a) => {
      const st = String(a.status ?? 'open').toLowerCase();
      return st !== 'void' && st !== 'corrected' && roundMoney(a.remaining_due) > 0;
    })
    .sort((a, b) => a.billing_year - b.billing_year || String(a.id).localeCompare(String(b.id)));

  let left = pay;
  const lines: SupportFeePayPreviewLine[] = [];
  let outstanding = 0;
  for (const a of open) {
    const due = roundMoney(a.remaining_due);
    outstanding = roundMoney(outstanding + due);
    const take = roundMoney(Math.min(due, left));
    if (take > 0) {
      lines.push({
        assessmentId: a.id,
        billingYear: a.billing_year,
        applied: take,
        remainingAfter: roundMoney(due - take),
        isPenaltyYear:
          String(a.pricing_rule ?? '') === 'late' &&
          !a.penalty_waived_at &&
          Number(a.increase_percent ?? 0) > 0,
        increasePercent: Number(a.increase_percent ?? 0),
      });
      left = roundMoney(left - take);
    }
  }
  const appliedToDebt = roundMoney(pay - left);
  return {
    lines,
    appliedToDebt,
    overpaymentCreated: left,
    expectedOutstanding: roundMoney(Math.max(0, outstanding - appliedToDebt)),
  };
}

export function supportFeePenaltyCancelLabelPct(increasePercent: number | null | undefined): number {
  const n = Number(increasePercent ?? 0);
  return Number.isFinite(n) ? n : 0;
}
