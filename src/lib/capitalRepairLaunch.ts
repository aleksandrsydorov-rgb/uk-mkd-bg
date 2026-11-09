/**
 * Capital-repair launch year helpers (UI + RPC payload parsing).
 * Server: public.complex_launch_year() / capital_repair_launch_context().
 */

export type CapitalRepairLaunchContext = {
  launchYear: number | null;
  minChargeYear: number | null;
  hasLaunchYear: boolean;
};

export type CapitalRepairYearChargeContext = {
  billingYear: number;
  launchYear: number | null;
  minChargeYear: number | null;
  blocked: boolean;
  blockReason: string | null;
  assessmentId: string | null;
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

export function parseCapitalRepairLaunchContext(raw: unknown): CapitalRepairLaunchContext {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const launchYear = asNum(o.launch_year);
  const minChargeYear = asNum(o.min_charge_year);
  return {
    launchYear,
    minChargeYear,
    hasLaunchYear: asBool(o.has_launch_year) || launchYear != null,
  };
}

export function parseCapitalRepairYearChargeContext(
  raw: unknown,
): CapitalRepairYearChargeContext | null {
  const o = (raw && typeof raw === 'object' ? raw : null) as Record<string, unknown> | null;
  if (!o) return null;
  const billingYear = asNum(o.billing_year);
  if (billingYear == null) return null;
  return {
    billingYear,
    launchYear: asNum(o.launch_year),
    minChargeYear: asNum(o.min_charge_year),
    blocked: asBool(o.blocked),
    blockReason: o.block_reason != null ? String(o.block_reason) : null,
    assessmentId: o.assessment_id != null ? String(o.assessment_id) : null,
    apartmentsTotal: Math.max(0, Math.floor(asNum(o.apartments_total) ?? 0)),
    apartmentsCharged: Math.max(0, Math.floor(asNum(o.apartments_charged) ?? 0)),
    apartmentsOpening: Math.max(0, Math.floor(asNum(o.apartments_opening) ?? 0)),
    apartmentsRemaining: Math.max(0, Math.floor(asNum(o.apartments_remaining) ?? 0)),
  };
}

/** True when billing year is the launch year or earlier (new operational charge forbidden). */
export function isCapitalRepairLaunchYearBlocked(
  billingYear: number,
  launchYear: number | null | undefined,
): boolean {
  if (launchYear == null || !Number.isFinite(launchYear)) return false;
  return billingYear <= launchYear;
}
