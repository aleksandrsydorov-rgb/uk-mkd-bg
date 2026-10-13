/**
 * Phase E2.3-A — pure policy mirrors for D2/D3/D5 and FIN-P1-7.
 * Keep in sync with:
 * - supabase/migrations/20261017120000_phase_e2_3_a_finance_subject_and_balance.sql
 * - property_tariff_subject_kind (Book legal_entity → legal)
 */

export type TariffSubjectKind = 'natural' | 'legal';

/** Mirror of property_tariff_subject_kind Book branch (entity_kind only — no email/name). */
export function resolveTariffSubjectFromBook(input: {
  activeOwnerEntityKinds: Array<string | null | undefined>;
}): TariffSubjectKind {
  const hasLegal = input.activeOwnerEntityKinds.some(
    (k) => (k ?? '').toLowerCase() === 'legal_entity'
  );
  return hasLegal ? 'legal' : 'natural';
}

/** FIN-P1-7: finalize/reprice must pass subject into 2-arg resolve — never hard-default natural. */
export function supportTariffResolveArgs(input: {
  billingYear: number;
  subjectKind: TariffSubjectKind;
}): { billingYear: number; subjectKind: TariffSubjectKind; usesOneArgNaturalDefault: false } {
  return {
    billingYear: input.billingYear,
    subjectKind: input.subjectKind,
    usesOneArgNaturalDefault: false,
  };
}

/** D2: mid-year / ownership subject change — future periods only. */
export function midYearTariffPolicy(): {
  mode: 'future_periods_only';
  repriceHistoricAssessments: false;
  inventProration: false;
} {
  return {
    mode: 'future_periods_only',
    repriceHistoricAssessments: false,
    inventProration: false,
  };
}

/** D3: publish does not reprice; charge must not auto-reprice; staff may call reprice. */
export function publishedTariffVsAssessmentPolicy(): {
  publishAutoRecalculates: false;
  chargeAutoReprices: false;
  explicitStaffRepriceAllowed: true;
} {
  return {
    publishAutoRecalculates: false,
    chargeAutoReprices: false,
    explicitStaffRepriceAllowed: true,
  };
}

export type RepriceEligibility = {
  allowed: boolean;
  reason:
    | 'ok_open_unpaid'
    | 'no_assessment'
    | 'settled_assessment_immutable'
    | 'same_tariff';
};

/** Mirror reprice guards (D2 settled immutability + same version+rate). */
export function canExplicitlyRepriceSupportAssessment(input: {
  hasAssessment: boolean;
  status?: string | null;
  remainingDue?: number | null;
  snapshotVersionId?: string | null;
  snapshotRate?: number | null;
  resolvedVersionId?: string | null;
  resolvedRate?: number | null;
}): RepriceEligibility {
  if (!input.hasAssessment) return { allowed: false, reason: 'no_assessment' };
  const status = (input.status ?? '').toLowerCase();
  const remaining = Number(input.remainingDue ?? 0);
  if (status === 'paid' || status === 'void' || status === 'corrected' || remaining <= 0) {
    return { allowed: false, reason: 'settled_assessment_immutable' };
  }
  if (
    input.snapshotVersionId === input.resolvedVersionId &&
    Number(input.snapshotRate) === Number(input.resolvedRate)
  ) {
    return { allowed: false, reason: 'same_tariff' };
  }
  return { allowed: true, reason: 'ok_open_unpaid' };
}

/** D5: joint apartment billing — no automatic share split. */
export function splitsSupportFeeByOwnershipShare(): false {
  return false;
}

export function ownershipTransferPreservesApartmentLedger(): true {
  return true;
}
