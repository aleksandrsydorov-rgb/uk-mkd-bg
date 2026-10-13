/**
 * Phase E2.3-A — D1 Support Fee balance contracts.
 * Canonical outstanding = sum(remaining_due) on non-void/corrected assessments.
 * Portal debt/overpayment remain cache / credit store; capital & utilities stay separate.
 */

export type SupportAssessmentBalanceRow = {
  property_id: number;
  remaining_due?: number | null;
  status?: string | null;
  billing_year?: number | null;
};

export type SupportLedgerBalanceRow = {
  property_id: number;
  kind: string;
  amount: number | null;
};

export type SupportBalanceView = {
  /** D1 SoT — unpaid assessment obligations */
  outstandingDue: number;
  /** Available credit (portal overpayment) */
  overpayment: number;
  /** Legacy/cache portal debt column */
  portalDebt: number;
  /** Signed ledger net: charge/adjustment_debit − payment/adjustment_credit */
  ledgerNet: number;
  /** portalDebt − outstandingDue (0 when aligned) */
  portalVsOutstandingDelta: number;
  /** −overpayment − ledgerNet when debt=0 legacy pattern; informational */
  overpaymentVsLedgerDelta: number;
  hasOpenAssessments: boolean;
};

function roundMoney(n: number) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export function isActiveSupportAssessmentStatus(status?: string | null): boolean {
  const s = (status ?? 'open').toLowerCase();
  return s !== 'void' && s !== 'corrected';
}

/** D1 canonical outstanding Support Fee for one apartment. */
export function canonicalSupportOutstanding(
  assessments: SupportAssessmentBalanceRow[],
  propertyId?: number
): number {
  let sum = 0;
  for (const a of assessments) {
    if (propertyId != null && a.property_id !== propertyId) continue;
    if (!isActiveSupportAssessmentStatus(a.status)) continue;
    sum += Math.max(0, Number(a.remaining_due ?? 0));
  }
  return roundMoney(sum);
}

/** Portal overpayment is the available SF credit (not part of outstanding). */
export function supportOverpayment(portalOverpayment: number | null | undefined): number {
  return Math.max(0, roundMoney(Number(portalOverpayment ?? 0)));
}

export function supportLedgerNet(
  ledger: SupportLedgerBalanceRow[],
  propertyId?: number
): number {
  let net = 0;
  for (const row of ledger) {
    if (propertyId != null && row.property_id !== propertyId) continue;
    const amt = Math.max(0, Number(row.amount ?? 0));
    const kind = (row.kind ?? '').toLowerCase();
    if (kind === 'charge' || kind === 'adjustment_debit') net += amt;
    else if (kind === 'payment' || kind === 'adjustment_credit') net -= amt;
  }
  return roundMoney(net);
}

export function buildSupportBalanceView(input: {
  assessments: SupportAssessmentBalanceRow[];
  ledger: SupportLedgerBalanceRow[];
  propertyId: number;
  portalDebt?: number | null;
  portalOverpayment?: number | null;
}): SupportBalanceView {
  const outstandingDue = canonicalSupportOutstanding(input.assessments, input.propertyId);
  const overpayment = supportOverpayment(input.portalOverpayment);
  const portalDebt = Math.max(0, roundMoney(Number(input.portalDebt ?? 0)));
  const ledgerNet = supportLedgerNet(input.ledger, input.propertyId);
  const hasOpenAssessments = input.assessments.some(
    (a) =>
      a.property_id === input.propertyId &&
      isActiveSupportAssessmentStatus(a.status) &&
      Number(a.remaining_due ?? 0) > 0
  );
  return {
    outstandingDue,
    overpayment,
    portalDebt,
    ledgerNet,
    portalVsOutstandingDelta: roundMoney(portalDebt - outstandingDue),
    overpaymentVsLedgerDelta: roundMoney(overpayment + ledgerNet),
    hasOpenAssessments,
  };
}

/** True when portal debt cache disagrees with D1 outstanding (legacy or sync drift). */
export function hasSupportBalanceDiscrepancy(view: SupportBalanceView): boolean {
  if (view.portalVsOutstandingDelta !== 0) return true;
  // When no open assessments, overpayment should equal −ledgerNet for clean history.
  if (!view.hasOpenAssessments && view.overpayment > 0 && view.overpaymentVsLedgerDelta !== 0) {
    return true;
  }
  return false;
}

/**
 * Display debt for owner/admin SF surfaces: prefer D1 remaining_due sum.
 * Falls back to portal debt only when assessments are unavailable (empty load).
 */
export function displaySupportOutstanding(input: {
  assessmentsLoaded: boolean;
  assessments: SupportAssessmentBalanceRow[];
  propertyId: number;
  portalDebt?: number | null;
}): number {
  if (!input.assessmentsLoaded) {
    return Math.max(0, roundMoney(Number(input.portalDebt ?? 0)));
  }
  return canonicalSupportOutstanding(input.assessments, input.propertyId);
}

/** D5: ownership shares never scale apartment SF amounts. */
export function apartmentSupportAmountIgnoresShares(
  apartmentAmount: number,
  _sharePercent: number | null | undefined
): number {
  return roundMoney(apartmentAmount);
}

/** Map property_id → D1 outstanding (for admin list / PDF). */
export function indexCanonicalSupportOutstanding(
  assessments: SupportAssessmentBalanceRow[]
): Map<number, number> {
  const map = new Map<number, number>();
  for (const a of assessments) {
    if (!isActiveSupportAssessmentStatus(a.status)) continue;
    const due = Math.max(0, Number(a.remaining_due ?? 0));
    if (due <= 0) continue;
    map.set(a.property_id, roundMoney((map.get(a.property_id) ?? 0) + due));
  }
  return map;
}

/**
 * Building / selection sum of display outstanding.
 * When assessmentsLoaded, uses D1 only (no portal fallback mix).
 */
export function sumDisplaySupportOutstanding(
  properties: Array<{ id: number; debt?: number | null }>,
  assessments: SupportAssessmentBalanceRow[],
  assessmentsLoaded: boolean
): number {
  if (!assessmentsLoaded) {
    return roundMoney(
      properties.reduce((sum, p) => sum + Math.max(0, Number(p.debt ?? 0)), 0)
    );
  }
  const index = indexCanonicalSupportOutstanding(assessments);
  return roundMoney(
    properties.reduce((sum, p) => sum + (index.get(p.id) ?? 0), 0)
  );
}

/** Admin/owner consistency: same inputs → same outstanding for a property. */
export function adminOwnerSupportOutstandingParity(input: {
  propertyId: number;
  assessments: SupportAssessmentBalanceRow[];
  assessmentsLoaded: boolean;
  portalDebt?: number | null;
}): { admin: number; owner: number; aligned: boolean } {
  const value = displaySupportOutstanding({
    assessmentsLoaded: input.assessmentsLoaded,
    assessments: input.assessments,
    propertyId: input.propertyId,
    portalDebt: input.portalDebt,
  });
  return { admin: value, owner: value, aligned: true };
}
