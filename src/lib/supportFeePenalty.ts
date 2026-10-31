/**
 * Task 08 — Support Fee discount/penalty helpers (client mirrors).
 * Waive late increase: documented exception only; pricing snapshot stays late.
 */

function roundMoney(n: number) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/** Default early-payment deadline calendar date (Sofia): 31 Dec of prior year. */
export function defaultEarlyPaymentDeadlineDate(billingYear: number): string {
  return `${billingYear - 1}-12-31`;
}

/** Build timestamptz string for upsert RPC (end of Sofia calendar day, fixed +02:00). */
export function earlyPaymentDeadlineIsoFromDate(ymd: string): string | null {
  const s = String(ymd ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return `${s}T23:59:00+02:00`;
}

export function validateSupportFeeAnnualPolicyDraft(args: {
  discountPercent: number;
  increasePercent: number;
  deadlineYmd: string;
  billingYear: number;
}): { ok: true } | { ok: false; errorKey: string } {
  const disc = Number(args.discountPercent);
  const inc = Number(args.increasePercent);
  const year = Number(args.billingYear);
  if (!Number.isFinite(year) || year < 2000 || year > 2100) {
    return { ok: false, errorKey: 'admin.sfErrPolicyYear' };
  }
  if (!Number.isFinite(disc) || disc < 0 || disc > 100) {
    return { ok: false, errorKey: 'admin.sfErrDiscountPct' };
  }
  if (!Number.isFinite(inc) || inc < 0 || inc > 100) {
    return { ok: false, errorKey: 'admin.sfErrIncreasePct' };
  }
  const ymd = String(args.deadlineYmd ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
    return { ok: false, errorKey: 'admin.sfErrDeadline' };
  }
  const yearStart = `${year}-01-01`;
  if (ymd >= yearStart) {
    return { ok: false, errorKey: 'admin.sfErrDeadlineBeforeYear' };
  }
  return { ok: true };
}

/** Penalty portion of a late assessment still eligible to waive. */
export function computeLateIncreaseWaiveAmount(input: {
  baseAmount: number;
  lateAmount: number;
  remainingDue: number;
}): number {
  const base = roundMoney(input.baseAmount);
  const late = roundMoney(input.lateAmount);
  const remaining = Math.max(0, roundMoney(input.remainingDue));
  const penalty = Math.max(0, roundMoney(late - base));
  return Math.min(remaining, penalty);
}

export type WaiveLateIncreaseEligibility =
  | { ok: true; waiveAmount: number }
  | { ok: false; reason: string };

export function assessWaiveLateIncreaseEligibility(input: {
  status?: string | null;
  pricingRule?: string | null;
  increasePercent?: number | null;
  baseAmount?: number | null;
  lateAmount?: number | null;
  remainingDue?: number | null;
  alreadyWaived?: boolean;
}): WaiveLateIncreaseEligibility {
  const status = String(input.status ?? 'open').toLowerCase();
  if (status === 'void') return { ok: false, reason: 'void' };
  if (status === 'corrected') return { ok: false, reason: 'corrected' };
  if (status === 'paid') return { ok: false, reason: 'paid' };
  if (status !== 'open') return { ok: false, reason: 'not_open' };
  if (input.alreadyWaived) return { ok: false, reason: 'already_waived' };
  if (String(input.pricingRule ?? '') !== 'late') return { ok: false, reason: 'not_late' };
  if (!(Number(input.increasePercent ?? 0) > 0)) return { ok: false, reason: 'no_increase' };
  const waiveAmount = computeLateIncreaseWaiveAmount({
    baseAmount: Number(input.baseAmount ?? 0),
    lateAmount: Number(input.lateAmount ?? 0),
    remainingDue: Number(input.remainingDue ?? 0),
  });
  if (!(waiveAmount > 0)) return { ok: false, reason: 'nothing_to_waive' };
  return { ok: true, waiveAmount };
}

export function validateWaiveLateIncreaseReason(reason: string | null | undefined): boolean {
  return String(reason ?? '').trim().length > 0;
}
