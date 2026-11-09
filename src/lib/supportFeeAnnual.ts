import { formatEur } from '@/lib/utilities';

export type SupportFeePricingRule = 'early_full_payment' | 'late' | 'standard';
export type SupportFeeQualification = 'not_checked' | 'qualified' | 'not_qualified';
export type SupportFeePolicyStatus = 'draft' | 'published' | 'closed';
export type SupportFeeAllocationType = 'payment' | 'credit' | 'payment_reversal';

export interface SupportFeeAnnualPolicy {
  id: string;
  billing_year: number;
  enabled: boolean;
  status: SupportFeePolicyStatus | string;
  early_discount_percent: number;
  late_increase_percent: number;
  early_payment_deadline: string;
  created_at: string;
  created_by_email: string | null;
  updated_at: string;
  updated_by_email: string | null;
}

export interface SupportFeeAssessment {
  id: string;
  property_id: number;
  billing_year: number;
  policy_id: string | null;
  charge_ledger_id: number | null;
  base_amount: number;
  discount_percent: number;
  increase_percent: number;
  early_amount: number;
  late_amount: number;
  early_deadline_at: string | null;
  pricing_rule: SupportFeePricingRule | string;
  pricing_reason_code: string | null;
  qualification_status: SupportFeeQualification | string;
  qualification_checked_at: string | null;
  available_credit_at_check: number;
  amount_covered_at_check: number;
  dedicated_payment_at_check: number;
  applied_credit_amount: number;
  applied_payment_amount: number;
  final_amount: number;
  remaining_due: number;
  balance_before: number | null;
  balance_after: number | null;
  status: 'open' | 'paid' | 'void' | 'corrected' | string;
  created_at: string;
  created_by_email: string | null;
  finalized_at: string | null;
  finalized_by_email: string | null;
  correction_reason: string | null;
  correction_at: string | null;
  correction_by_email: string | null;
  void_reason?: string | null;
  voided_at?: string | null;
  voided_by_email?: string | null;
  restore_reason?: string | null;
  restored_at?: string | null;
  restored_by_email?: string | null;
  restore_ledger_id?: number | null;
  penalty_waive_reason?: string | null;
  penalty_waived_at?: string | null;
  penalty_waived_by_email?: string | null;
  penalty_waive_ledger_id?: number | null;
  early_discount_ledger_id?: number | null;
  late_penalty_ledger_id?: number | null;
  tariff_version_id: string | null;
  area_sqm_snapshot: number | null;
  rate_eur_per_sqm_year_snapshot: number | null;
  opening_import?: boolean | null;
}

export interface SupportFeeAllocation {
  id: string;
  assessment_id: string;
  ledger_entry_id: number | null;
  amount: number;
  allocation_type: SupportFeeAllocationType | string;
  created_at: string;
  created_by_email: string | null;
}

export interface SupportFeeYearPreview {
  billing_year: number;
  policy_enabled: boolean;
  pricing_mode?: string;
  early_deadline_at?: string;
  year_starts_at?: string;
  in_early_window?: boolean;
  discount_percent?: number;
  increase_percent?: number;
  base_amount: number;
  early_amount: number;
  late_amount: number;
  available_credit: number;
  old_debt: number;
  credit_covers_early?: boolean;
  amount_needed_for_discount?: number | null;
  rate_eur_per_sqm_year?: number;
  tariff_version_id?: string;
  preview?: boolean;
}

export function sofiaCalendarYear(at: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Sofia',
    year: 'numeric',
  }).formatToParts(at);
  return Number(parts.find((p) => p.type === 'year')?.value ?? at.getFullYear());
}

export function formatEurAmount(n: number | null | undefined, locale?: string): string {
  return formatEur(Number(n) || 0, locale);
}

/** Net cash payments allocated to an assessment (payment − payment_reversal). */
export function netSupportFeeAllocatedPayments(
  allocations: ReadonlyArray<Pick<SupportFeeAllocation, 'allocation_type' | 'amount'>>,
  fallbackAppliedPayment = 0,
): number {
  let pay = 0;
  let rev = 0;
  let saw = false;
  for (const row of allocations) {
    const kind = String(row.allocation_type ?? '');
    const amt = Number(row.amount) || 0;
    if (kind === 'payment') {
      saw = true;
      pay += amt;
    } else if (kind === 'payment_reversal') {
      saw = true;
      rev += amt;
    }
  }
  if (!saw) return Math.max(0, Math.round((Number(fallbackAppliedPayment) || 0) * 100) / 100);
  return Math.max(0, Math.round((pay - rev) * 100) / 100);
}

/** Net overpayment credit applied to an assessment. */
export function netSupportFeeAllocatedCredit(
  allocations: ReadonlyArray<Pick<SupportFeeAllocation, 'allocation_type' | 'amount'>>,
  fallbackAppliedCredit = 0,
): number {
  let credit = 0;
  let saw = false;
  for (const row of allocations) {
    if (String(row.allocation_type ?? '') === 'credit') {
      saw = true;
      credit += Number(row.amount) || 0;
    }
  }
  if (!saw) return Math.max(0, Math.round((Number(fallbackAppliedCredit) || 0) * 100) / 100);
  return Math.max(0, Math.round(credit * 100) / 100);
}

/** Amount already settled toward final_amount (cash + credit), for display. */
export function supportFeeSettledTowardFinal(
  finalAmount: number,
  remainingDue: number,
): number {
  return Math.max(0, Math.round((Number(finalAmount) - Number(remainingDue)) * 100) / 100);
}

export function moneyDelta(percent: number, ofBase: number): number {
  return Math.round((Number(ofBase) || 0) * (Number(percent) || 0)) / 100;
}

const sofiaDateTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Sofia',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** Display-only. Converts stored timestamptz to Europe/Sofia calendar clock. */
export function formatSofiaDeadline(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const parts = Object.fromEntries(sofiaDateTime.formatToParts(d).map((p) => [p.type, p.value]));
  return `${parts.day}.${parts.month}.${parts.year} · ${parts.hour}:${parts.minute}`;
}

export function formatSofiaDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const parts = Object.fromEntries(sofiaDateTime.formatToParts(d).map((p) => [p.type, p.value]));
  return `${parts.day}.${parts.month}.${parts.year}`;
}

export function sofiaYearStartLabel(billingYear: number): string {
  return `01.01.${billingYear}`;
}
