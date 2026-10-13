/**
 * Phase E2.3-B — D4-A client mirrors for payment reversal / assessment void.
 * Keep in sync with:
 * supabase/migrations/20261018120000_phase_e2_3_b_reversal_and_void.sql
 */

function roundMoney(n: number) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export type SupportLedgerKind =
  | 'payment'
  | 'charge'
  | 'adjustment_debit'
  | 'adjustment_credit'
  | 'payment_reversal'
  | 'assessment_void';

export function isSupportPaymentReversible(kind: string | null | undefined): boolean {
  return (kind ?? '') === 'payment';
}

export function isSupportLedgerReversed(input: {
  originalLedgerId: number;
  ledger: Array<{ kind: string; reverses_ledger_id?: number | null }>;
}): boolean {
  return input.ledger.some(
    (row) =>
      row.kind === 'payment_reversal' &&
      Number(row.reverses_ledger_id) === Number(input.originalLedgerId)
  );
}

/** Portal balance effect of reversing a payment (append-only mirror). */
export function previewReverseSupportPayment(input: {
  paymentAmount: number;
  allocatedAmount: number;
  portalDebt: number;
  portalOverpayment: number;
}): {
  surplus: number;
  newDebt: number;
  newOverpayment: number;
  valid: boolean;
} {
  const pay = roundMoney(input.paymentAmount);
  const allocated = roundMoney(Math.max(0, input.allocatedAmount));
  if (pay <= 0 || allocated > pay) {
    return { surplus: 0, newDebt: 0, newOverpayment: 0, valid: false };
  }
  const surplus = roundMoney(pay - allocated);
  const debt = Math.max(0, roundMoney(input.portalDebt));
  const over = Math.max(0, roundMoney(input.portalOverpayment));
  const takeOver = Math.min(surplus, over);
  const newOverpayment = roundMoney(over - takeOver);
  const newDebt = roundMoney(debt + allocated + (surplus - takeOver));
  return {
    surplus,
    newDebt,
    newOverpayment,
    valid: newDebt >= 0 && newOverpayment >= 0,
  };
}

export type VoidAssessmentEligibility =
  | { ok: true; voidableDue: number }
  | { ok: false; reason: string };

/**
 * D4-A: only unpaid open assessments with no payment/credit applications.
 * Partially/fully paid or credited → blocked (no invented reallocation).
 */
export function assessVoidSupportAssessmentEligibility(input: {
  status?: string | null;
  remainingDue?: number | null;
  appliedPaymentAmount?: number | null;
  appliedCreditAmount?: number | null;
  paymentAllocationSum?: number | null;
  creditAllocationSum?: number | null;
}): VoidAssessmentEligibility {
  const status = (input.status ?? 'open').toLowerCase();
  if (status === 'void') {
    return { ok: false, reason: 'already_void' };
  }
  if (status === 'corrected') {
    return { ok: false, reason: 'corrected_immutable' };
  }
  if (status === 'paid') {
    return { ok: false, reason: 'paid_requires_payment_reversal_first' };
  }
  if (Number(input.appliedPaymentAmount ?? 0) > 0 || Number(input.paymentAllocationSum ?? 0) > 0) {
    return { ok: false, reason: 'has_payment_allocations' };
  }
  if (Number(input.appliedCreditAmount ?? 0) > 0 || Number(input.creditAllocationSum ?? 0) > 0) {
    return { ok: false, reason: 'has_credit_allocations' };
  }
  const due = Math.max(0, roundMoney(Number(input.remainingDue ?? 0)));
  if (due <= 0) {
    return { ok: false, reason: 'zero_due_undefined_credit_handling' };
  }
  return { ok: true, voidableDue: due };
}

export function previewVoidUnpaidAssessment(input: {
  remainingDue: number;
  portalDebt: number;
  portalOverpayment: number;
}): { newDebt: number; newOverpayment: number } {
  const due = Math.max(0, roundMoney(input.remainingDue));
  const debt = Math.max(0, roundMoney(input.portalDebt));
  const over = Math.max(0, roundMoney(input.portalOverpayment));
  if (due <= debt) {
    return { newDebt: roundMoney(debt - due), newOverpayment: over };
  }
  return { newDebt: 0, newOverpayment: over };
}

/** Immutable void target captured at row-click time (E2.3-D wrong-apt guard). */
export type SupportFeeVoidTarget = {
  assessmentId: string;
  propertyId: number;
  apartmentNumber: string;
  billingYear: number;
  remainingDue: number;
  finalAmount: number;
  baseAmount: number;
};

export type VoidTargetMatchResult =
  | { ok: true }
  | { ok: false; reason: 'missing_target' | 'missing_expected_property' | 'assessment_mismatch' | 'property_mismatch' | 'apartment_mismatch' | 'stale_assessment' };

/**
 * Reject void when the frozen UI target no longer matches the assessment row
 * or the operator-confirmed apartment number.
 */
export function assertSupportFeeVoidTargetMatch(input: {
  target: SupportFeeVoidTarget | null | undefined;
  assessment?: {
    id?: string | null;
    property_id?: number | null;
    billing_year?: number | null;
    remaining_due?: number | null;
    status?: string | null;
  } | null;
  expectedPropertyId?: number | null;
  confirmedApartmentNumber?: string | null;
}): VoidTargetMatchResult {
  const target = input.target;
  if (!target?.assessmentId) return { ok: false, reason: 'missing_target' };
  if (input.expectedPropertyId == null || !Number.isFinite(Number(input.expectedPropertyId))) {
    return { ok: false, reason: 'missing_expected_property' };
  }
  if (Number(target.propertyId) !== Number(input.expectedPropertyId)) {
    return { ok: false, reason: 'property_mismatch' };
  }
  const confirmed = String(input.confirmedApartmentNumber ?? '').trim();
  if (!confirmed || confirmed !== String(target.apartmentNumber).trim()) {
    return { ok: false, reason: 'apartment_mismatch' };
  }
  const a = input.assessment;
  if (!a?.id) return { ok: false, reason: 'stale_assessment' };
  if (String(a.id) !== String(target.assessmentId)) {
    return { ok: false, reason: 'assessment_mismatch' };
  }
  if (Number(a.property_id) !== Number(target.propertyId)) {
    return { ok: false, reason: 'property_mismatch' };
  }
  if (a.status != null && String(a.status).toLowerCase() === 'void') {
    return { ok: false, reason: 'stale_assessment' };
  }
  return { ok: true };
}

export function buildSupportFeeVoidTarget(input: {
  assessment: {
    id: string;
    property_id: number;
    billing_year: number;
    remaining_due?: number | null;
    final_amount?: number | null;
    base_amount?: number | null;
  };
  apartmentNumber: string | number;
}): SupportFeeVoidTarget {
  return {
    assessmentId: String(input.assessment.id),
    propertyId: Number(input.assessment.property_id),
    apartmentNumber: String(input.apartmentNumber ?? '').trim(),
    billingYear: Number(input.assessment.billing_year),
    remainingDue: roundMoney(Number(input.assessment.remaining_due ?? 0)),
    finalAmount: roundMoney(Number(input.assessment.final_amount ?? 0)),
    baseAmount: roundMoney(Number(input.assessment.base_amount ?? 0)),
  };
}

export function supportLedgerKindLabelKey(kind: string | null | undefined): string {
  switch (kind) {
    case 'payment':
      return 'admin.kindPayment';
    case 'charge':
      return 'admin.kindCharge';
    case 'payment_reversal':
      return 'admin.kindPaymentReversal';
    case 'assessment_void':
      return 'admin.kindAssessmentVoid';
    case 'adjustment_debit':
      return 'admin.kindAdjDebit';
    case 'adjustment_credit':
      return 'admin.kindAdjCredit';
    default:
      return 'admin.kind';
  }
}
