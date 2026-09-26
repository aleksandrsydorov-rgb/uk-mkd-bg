import { formatEur } from '@/lib/utilities';

export type SupportFeePricingRule = 'early_full_payment' | 'late' | 'standard';
export type SupportFeeQualification = 'not_checked' | 'qualified' | 'not_qualified';
export type SupportFeePolicyStatus = 'draft' | 'published' | 'closed';
export type SupportFeeAllocationType = 'payment' | 'credit';

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
  status: 'open' | 'paid' | string;
  created_at: string;
  created_by_email: string | null;
  finalized_at: string | null;
  finalized_by_email: string | null;
  correction_reason: string | null;
  correction_at: string | null;
  correction_by_email: string | null;
  tariff_version_id: string | null;
  area_sqm_snapshot: number | null;
  rate_eur_per_sqm_year_snapshot: number | null;
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
