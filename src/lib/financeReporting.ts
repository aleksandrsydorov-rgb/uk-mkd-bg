/**
 * Phase E2.3-C — D7 separate financial reporting helpers (reporting-only).
 * Support Fee uses D1 remaining_due. Capital/utilities use existing ledger balance RPCs.
 * Never invent a combined "total debt" unless every included part is verified and same-scope.
 */

import {
  canonicalSupportOutstanding,
  displaySupportOutstanding,
  sumDisplaySupportOutstanding,
  supportOverpayment,
  type SupportAssessmentBalanceRow,
} from '@/lib/supportFeeBalance';
import type { UtilityBalance } from '@/lib/utilities';

export type FinanceReportCategory = 'support_fee' | 'capital' | 'utilities';

export type DomainBalanceReliability =
  /** D1 assessment remaining_due (Support Fee). */
  | 'canonical_remaining_due'
  /** Ledger-derived balance from get_*_balance / fund totals (Capital / utilities). */
  | 'ledger_balance'
  /** Category data not loaded or RPC unavailable. */
  | 'unavailable';

function roundMoney(n: number) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export function outstandingFromUtilityBalance(balance: UtilityBalance | null | undefined): number {
  return Math.max(0, roundMoney(Number(balance?.balance_eur ?? 0)));
}

export function overpaymentFromUtilityBalance(balance: UtilityBalance | null | undefined): number {
  const bal = roundMoney(Number(balance?.balance_eur ?? 0));
  return bal < 0 ? roundMoney(Math.abs(bal)) : 0;
}

export type SupportFeeReportSnapshot = {
  category: 'support_fee';
  reliability: 'canonical_remaining_due' | 'portal_fallback';
  assessedAmount: number;
  outstanding: number;
  payments: number;
  charges: number;
  reversals: number;
  voids: number;
  overpayment: number;
  apartmentsWithOutstanding: number;
};

export function buildSupportFeeReportSnapshot(input: {
  properties: Array<{ id: number; debt?: number | null; overpayment?: number | null }>;
  assessments: SupportAssessmentBalanceRow[];
  assessmentsLoaded: boolean;
  ledger: Array<{ kind: string; amount: number | null; property_id?: number }>;
}): SupportFeeReportSnapshot {
  const assessedAmount = roundMoney(
    input.assessments
      .filter((a) => {
        const s = (a.status ?? 'open').toLowerCase();
        return s !== 'void' && s !== 'corrected';
      })
      .reduce((sum, a) => {
        // Prefer final remaining+applied when available; fall back to remaining_due only.
        const due = Math.max(0, Number(a.remaining_due ?? 0));
        return sum + due;
      }, 0)
  );
  // When assessments carry only remaining_due (admin list load), assessed ≈ open remaining;
  // charges from ledger give better assessed proxy for the period register.
  const outstanding = sumDisplaySupportOutstanding(
    input.properties,
    input.assessments,
    input.assessmentsLoaded
  );
  const canonical = canonicalSupportOutstanding(input.assessments);
  let payments = 0;
  let charges = 0;
  let reversals = 0;
  let voids = 0;
  for (const row of input.ledger) {
    const amt = Math.max(0, Number(row.amount ?? 0));
    const kind = (row.kind ?? '').toLowerCase();
    if (kind === 'payment') payments += amt;
    else if (kind === 'charge') charges += amt;
    else if (kind === 'payment_reversal') reversals += amt;
    else if (kind === 'assessment_void') voids += amt;
  }
  const overpayment = roundMoney(
    input.properties.reduce((s, p) => s + supportOverpayment(p.overpayment), 0)
  );
  const apartmentsWithOutstanding = input.properties.filter(
    (p) =>
      displaySupportOutstanding({
        assessmentsLoaded: input.assessmentsLoaded,
        assessments: input.assessments,
        propertyId: p.id,
        portalDebt: p.debt,
      }) > 0
  ).length;

  return {
    category: 'support_fee',
    reliability: input.assessmentsLoaded ? 'canonical_remaining_due' : 'portal_fallback',
    assessedAmount: charges > 0 ? roundMoney(charges) : assessedAmount || canonical,
    outstanding,
    payments: roundMoney(payments),
    charges: roundMoney(charges),
    reversals: roundMoney(reversals),
    voids: roundMoney(voids),
    overpayment,
    apartmentsWithOutstanding,
  };
}

export type FundTotalsLike = {
  charged_eur?: number | null;
  paid_eur?: number | null;
  balance_eur?: number | null;
  apartments_with_debt?: number | null;
};

export type CapitalReportSnapshot = {
  category: 'capital';
  reliability: DomainBalanceReliability;
  charged: number | null;
  paid: number | null;
  /** Ledger-derived fund balance; not D1 assessment remaining_due. */
  outstanding: number | null;
  apartmentsWithDebt: number | null;
};

export function buildCapitalReportSnapshot(
  fund: FundTotalsLike | null | undefined,
  loaded: boolean
): CapitalReportSnapshot {
  if (!loaded || fund == null) {
    return {
      category: 'capital',
      reliability: 'unavailable',
      charged: null,
      paid: null,
      outstanding: null,
      apartmentsWithDebt: null,
    };
  }
  return {
    category: 'capital',
    reliability: 'ledger_balance',
    charged: roundMoney(Number(fund.charged_eur ?? 0)),
    paid: roundMoney(Number(fund.paid_eur ?? 0)),
    outstanding: Math.max(0, roundMoney(Number(fund.balance_eur ?? 0))),
    apartmentsWithDebt: Math.max(0, Math.round(Number(fund.apartments_with_debt ?? 0))),
  };
}

export type UtilitiesReportSnapshot = {
  category: 'utilities';
  reliability: DomainBalanceReliability;
  waterOutstanding: number | null;
  electricityOutstanding: number | null;
  internetOutstanding: number | null;
  /** Sum of domain ledger outstandings only when all domains loaded. */
  combinedDomainOutstanding: number | null;
  note: 'ledger_balances_not_meter_consumption';
};

export function buildUtilitiesReportSnapshot(input: {
  waterByProperty: Map<number, UtilityBalance> | null;
  electricityByProperty: Map<number, UtilityBalance> | null;
  internetByProperty: Map<number, UtilityBalance> | null;
}): UtilitiesReportSnapshot {
  const sumMap = (m: Map<number, UtilityBalance> | null) => {
    if (!m) return null;
    let sum = 0;
    for (const bal of m.values()) sum += outstandingFromUtilityBalance(bal);
    return roundMoney(sum);
  };
  const water = sumMap(input.waterByProperty);
  const elec = sumMap(input.electricityByProperty);
  const net = sumMap(input.internetByProperty);
  const allLoaded = water != null && elec != null && net != null;
  return {
    category: 'utilities',
    reliability: allLoaded ? 'ledger_balance' : water == null && elec == null && net == null ? 'unavailable' : 'ledger_balance',
    waterOutstanding: water,
    electricityOutstanding: elec,
    internetOutstanding: net,
    combinedDomainOutstanding: allLoaded ? roundMoney(water! + elec! + net!) : null,
    note: 'ledger_balances_not_meter_consumption',
  };
}

/**
 * Combined apartment/building total is allowed only when every part is present
 * and marked verified for the same reporting scope. SF D1 + capital/utilities
 * ledger balances are different reliability classes → return null (no aggregate).
 */
export function combineVerifiedFinancialObligations(
  parts: Array<{ amount: number | null | undefined; verified: boolean; scope: string }>
): number | null {
  if (parts.length === 0) return null;
  const scope0 = parts[0].scope;
  for (const p of parts) {
    if (!p.verified) return null;
    if (p.amount == null || !Number.isFinite(Number(p.amount))) return null;
    if (p.scope !== scope0) return null;
  }
  return roundMoney(parts.reduce((s, p) => s + Number(p.amount), 0));
}

/** D7: Support Fee outstanding must never be labeled as total apartment/complex debt. */
export function isSupportFeeOnlyTotalMisleadingAsAllDebt(labelImpliesAllDebt: boolean): boolean {
  return labelImpliesAllDebt === true;
}

export function apartmentCategoryBreakdown(input: {
  supportOutstanding: number;
  capitalOutstanding: number | null;
  waterOutstanding: number | null;
  electricityOutstanding: number | null;
  internetOutstanding: number | null;
}): {
  supportFee: number;
  capital: number | null;
  utilities: { water: number | null; electricity: number | null; internet: number | null };
  combinedTotal: number | null;
} {
  const utilitiesVerified =
    input.waterOutstanding != null &&
    input.electricityOutstanding != null &&
    input.internetOutstanding != null;
  const combined = combineVerifiedFinancialObligations([
    { amount: input.supportOutstanding, verified: true, scope: 'd1_sf' },
    {
      amount: input.capitalOutstanding,
      verified: input.capitalOutstanding != null,
      scope: 'ledger_capital',
    },
    {
      amount: utilitiesVerified
        ? roundMoney(
            (input.waterOutstanding ?? 0) +
              (input.electricityOutstanding ?? 0) +
              (input.internetOutstanding ?? 0)
          )
        : null,
      verified: utilitiesVerified,
      scope: 'ledger_utilities',
    },
  ]);
  // Different scopes → combineVerified returns null (correct for D7).
  return {
    supportFee: roundMoney(input.supportOutstanding),
    capital: input.capitalOutstanding,
    utilities: {
      water: input.waterOutstanding,
      electricity: input.electricityOutstanding,
      internet: input.internetOutstanding,
    },
    combinedTotal: combined,
  };
}
