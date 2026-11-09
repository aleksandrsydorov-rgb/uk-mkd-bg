/**
 * Support-fee launch year helpers (UI + RPC payload parsing).
 * Server source of truth: public.complex_launch_year() / support_fee_launch_context().
 */

export type SupportFeeLaunchContext = {
  launchYear: number | null;
  minChargeYear: number | null;
  hasLaunchYear: boolean;
};

export type SupportFeeYearChargeContext = {
  billingYear: number;
  launchYear: number | null;
  minChargeYear: number | null;
  blocked: boolean;
  blockReason: string | null;
  rateEurPerSqmYear: number | null;
  tariffVersionId: string | null;
  policyStatus: string | null;
  policyEnabled: boolean | null;
  earlyDiscountPercent: number | null;
  lateIncreasePercent: number | null;
  earlyPaymentDeadline: string | null;
  pricingMode: 'policy' | 'standard_tariff';
  apartmentsTotal: number;
  apartmentsCharged: number;
  apartmentsOpening: number;
  apartmentsRemaining: number;
};

function asNum(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function asBool(v: unknown): boolean {
  return v === true || v === 'true' || v === 1;
}

export function parseSupportFeeLaunchContext(raw: unknown): SupportFeeLaunchContext {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const launchYear = asNum(o.launch_year);
  const minChargeYear = asNum(o.min_charge_year);
  return {
    launchYear,
    minChargeYear,
    hasLaunchYear: asBool(o.has_launch_year) || launchYear != null,
  };
}

export function parseSupportFeeYearChargeContext(raw: unknown): SupportFeeYearChargeContext | null {
  const o = (raw && typeof raw === 'object' ? raw : null) as Record<string, unknown> | null;
  if (!o) return null;
  const billingYear = asNum(o.billing_year);
  if (billingYear == null) return null;
  const pricingMode = o.pricing_mode === 'policy' ? 'policy' : 'standard_tariff';
  return {
    billingYear,
    launchYear: asNum(o.launch_year),
    minChargeYear: asNum(o.min_charge_year),
    blocked: asBool(o.blocked),
    blockReason: o.block_reason != null ? String(o.block_reason) : null,
    rateEurPerSqmYear: asNum(o.rate_eur_per_sqm_year),
    tariffVersionId: o.tariff_version_id != null ? String(o.tariff_version_id) : null,
    policyStatus: o.policy_status != null ? String(o.policy_status) : null,
    policyEnabled: o.policy_enabled == null ? null : asBool(o.policy_enabled),
    earlyDiscountPercent: asNum(o.early_discount_percent),
    lateIncreasePercent: asNum(o.late_increase_percent),
    earlyPaymentDeadline:
      o.early_payment_deadline != null ? String(o.early_payment_deadline) : null,
    pricingMode,
    apartmentsTotal: Math.max(0, Math.floor(asNum(o.apartments_total) ?? 0)),
    apartmentsCharged: Math.max(0, Math.floor(asNum(o.apartments_charged) ?? 0)),
    apartmentsOpening: Math.max(0, Math.floor(asNum(o.apartments_opening) ?? 0)),
    apartmentsRemaining: Math.max(0, Math.floor(asNum(o.apartments_remaining) ?? 0)),
  };
}

/** True when billing year is the launch year or earlier (new operational charge forbidden). */
export function isSupportFeeLaunchYearBlocked(
  billingYear: number,
  launchYear: number | null | undefined,
): boolean {
  if (launchYear == null || !Number.isFinite(launchYear)) return false;
  return billingYear <= launchYear;
}

export function supportFeeYearChargedAmount(
  assessments: Array<{
    billing_year?: number | null;
    final_amount?: number | null;
    status?: string | null;
    opening_import?: boolean | null;
  }>,
  billingYear: number,
): number {
  let sum = 0;
  for (const a of assessments) {
    if (Number(a.billing_year) !== billingYear) continue;
    const s = String(a.status ?? 'open').toLowerCase();
    if (s === 'void' || s === 'corrected') continue;
    if (a.opening_import) continue;
    sum += Math.max(0, Number(a.final_amount ?? 0));
  }
  return Math.round(sum * 100) / 100;
}

export function supportFeeOpeningRemaining(
  assessments: Array<{
    property_id?: number;
    remaining_due?: number | null;
    status?: string | null;
    opening_import?: boolean | null;
  }>,
  propertyId?: number,
): number {
  let sum = 0;
  for (const a of assessments) {
    if (propertyId != null && a.property_id !== propertyId) continue;
    if (!a.opening_import) continue;
    const s = String(a.status ?? 'open').toLowerCase();
    if (s === 'void' || s === 'corrected') continue;
    sum += Math.max(0, Number(a.remaining_due ?? 0));
  }
  return Math.round(sum * 100) / 100;
}

export function supportFeeYearRemaining(
  assessments: Array<{
    property_id?: number;
    billing_year?: number | null;
    remaining_due?: number | null;
    status?: string | null;
    opening_import?: boolean | null;
  }>,
  billingYear: number,
  propertyId?: number,
): number {
  let sum = 0;
  for (const a of assessments) {
    if (propertyId != null && a.property_id !== propertyId) continue;
    if (Number(a.billing_year) !== billingYear) continue;
    if (a.opening_import) continue;
    const s = String(a.status ?? 'open').toLowerCase();
    if (s === 'void' || s === 'corrected') continue;
    sum += Math.max(0, Number(a.remaining_due ?? 0));
  }
  return Math.round(sum * 100) / 100;
}

/** Ledger kinds that represent credit offset (зачёт), not a cash payment. */
export function isSupportFeeCreditOffsetKind(kind: string | null | undefined): boolean {
  const k = String(kind ?? '').toLowerCase();
  return (
    k === 'opening_credit' ||
    k === 'opening_historical_settlement' ||
    k === 'adjustment_credit'
  );
}
