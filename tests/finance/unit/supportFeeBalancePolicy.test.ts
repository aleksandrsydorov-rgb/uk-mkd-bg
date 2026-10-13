import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  applySupportCharge,
  applySupportPayment,
  annualSupportFee,
  monthlySupportFee,
} from '@/lib/finance';
import {
  apartmentSupportAmountIgnoresShares,
  buildSupportBalanceView,
  canonicalSupportOutstanding,
  displaySupportOutstanding,
  hasSupportBalanceDiscrepancy,
  supportLedgerNet,
  supportOverpayment,
} from '@/lib/supportFeeBalance';
import {
  canExplicitlyRepriceSupportAssessment,
  midYearTariffPolicy,
  ownershipTransferPreservesApartmentLedger,
  publishedTariffVsAssessmentPolicy,
  resolveTariffSubjectFromBook,
  splitsSupportFeeByOwnershipShare,
  supportTariffResolveArgs,
} from '@/lib/financePolicy';

const MIGRATION = path.resolve(
  process.cwd(),
  'supabase/migrations/20261017120000_phase_e2_3_a_finance_subject_and_balance.sql'
);

describe('FIN-P1-7 · tariff subject resolution', () => {
  it('maps Book legal_entity → legal and persons → natural (no email/name)', () => {
    expect(
      resolveTariffSubjectFromBook({ activeOwnerEntityKinds: ['person', 'person'] })
    ).toBe('natural');
    expect(
      resolveTariffSubjectFromBook({ activeOwnerEntityKinds: ['legal_entity'] })
    ).toBe('legal');
    expect(
      resolveTariffSubjectFromBook({
        activeOwnerEntityKinds: ['person', 'legal_entity'],
      })
    ).toBe('legal');
  });

  it('resolve args never use one-arg natural default', () => {
    expect(supportTariffResolveArgs({ billingYear: 2026, subjectKind: 'legal' })).toEqual({
      billingYear: 2026,
      subjectKind: 'legal',
      usesOneArgNaturalDefault: false,
    });
  });

  it('migration wires subject-aware finalize/reprice and blocks auto-reprice on charge', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    expect(sql).toContain('property_tariff_subject_kind(p_property_id)');
    expect(sql).toContain('resolve_support_tariff_for_year(p_billing_year, v_subject)');
    expect(sql).toContain('assessment_exists_no_auto_reprice');
    expect(sql).toContain('settled_assessment_immutable');
    expect(sql).not.toMatch(
      /finalize_support_fee_assessment[\s\S]*resolve_support_tariff_for_year\(p_billing_year\)\s+as/
    );
  });
});

describe('D1 · canonical remaining_due balance', () => {
  it('sums active remaining_due and ignores void/corrected', () => {
    expect(
      canonicalSupportOutstanding([
        { property_id: 1, remaining_due: 100, status: 'open' },
        { property_id: 1, remaining_due: 50, status: 'void' },
        { property_id: 1, remaining_due: 20, status: 'corrected' },
        { property_id: 2, remaining_due: 999, status: 'open' },
      ], 1)
    ).toBe(100);
  });

  it('separates outstanding debt from overpayment', () => {
    const view = buildSupportBalanceView({
      propertyId: 111,
      portalDebt: 360,
      portalOverpayment: 0,
      assessments: [{ property_id: 111, remaining_due: 360, status: 'open' }],
      ledger: [{ property_id: 111, kind: 'charge', amount: 360 }],
    });
    expect(view.outstandingDue).toBe(360);
    expect(view.overpayment).toBe(0);
    expect(view.portalVsOutstandingDelta).toBe(0);
    expect(hasSupportBalanceDiscrepancy(view)).toBe(false);
  });

  it('flags legacy portal vs remaining and overpayment vs ledger mismatch', () => {
    const legacy = buildSupportBalanceView({
      propertyId: 2,
      portalDebt: 0,
      portalOverpayment: 162.3,
      assessments: [],
      ledger: [{ property_id: 2, kind: 'payment', amount: 150 }],
    });
    expect(legacy.outstandingDue).toBe(0);
    expect(legacy.ledgerNet).toBe(-150);
    expect(hasSupportBalanceDiscrepancy(legacy)).toBe(true);
  });

  it('display prefers assessments when loaded; falls back to portal otherwise', () => {
    expect(
      displaySupportOutstanding({
        assessmentsLoaded: true,
        assessments: [{ property_id: 1, remaining_due: 40, status: 'open' }],
        propertyId: 1,
        portalDebt: 99,
      })
    ).toBe(40);
    expect(
      displaySupportOutstanding({
        assessmentsLoaded: false,
        assessments: [],
        propertyId: 1,
        portalDebt: 99,
      })
    ).toBe(99);
  });

  it('handles no assessments, partial payment, overpayment, credits', () => {
    expect(canonicalSupportOutstanding([], 1)).toBe(0);
    expect(applySupportPayment(100, 0, 40)).toEqual({ debt: 60, overpayment: 0 });
    expect(applySupportPayment(30, 5, 50)).toEqual({ debt: 0, overpayment: 25 });
    expect(applySupportCharge(0, 20, 15)).toEqual({ debt: 0, overpayment: 5 });
    expect(supportOverpayment(12.345)).toBe(12.35);
    expect(
      supportLedgerNet([
        { property_id: 1, kind: 'charge', amount: 100 },
        { property_id: 1, kind: 'payment', amount: 40 },
        { property_id: 1, kind: 'adjustment_credit', amount: 10 },
      ], 1)
    ).toBe(50);
  });
});

describe('D2 · mid-year future periods only', () => {
  it('does not invent proration or historic reprice', () => {
    expect(midYearTariffPolicy()).toEqual({
      mode: 'future_periods_only',
      repriceHistoricAssessments: false,
      inventProration: false,
    });
  });
});

describe('D3 · publish/charge vs explicit reprice', () => {
  it('publish and charge do not auto-reprice; staff reprice allowed for open unpaid', () => {
    expect(publishedTariffVsAssessmentPolicy()).toEqual({
      publishAutoRecalculates: false,
      chargeAutoReprices: false,
      explicitStaffRepriceAllowed: true,
    });
    expect(
      canExplicitlyRepriceSupportAssessment({
        hasAssessment: true,
        status: 'open',
        remainingDue: 100,
        snapshotVersionId: 'v1',
        snapshotRate: 8,
        resolvedVersionId: 'v2',
        resolvedRate: 9,
      }).allowed
    ).toBe(true);
    expect(
      canExplicitlyRepriceSupportAssessment({
        hasAssessment: true,
        status: 'paid',
        remainingDue: 0,
        snapshotVersionId: 'v1',
        snapshotRate: 8,
        resolvedVersionId: 'v2',
        resolvedRate: 9,
      }).reason
    ).toBe('settled_assessment_immutable');
    expect(
      canExplicitlyRepriceSupportAssessment({
        hasAssessment: true,
        status: 'open',
        remainingDue: 50,
        snapshotVersionId: 'v1',
        snapshotRate: 8,
        resolvedVersionId: 'v1',
        resolvedRate: 8,
      }).reason
    ).toBe('same_tariff');
  });
});

describe('D5 · joint apartment billing', () => {
  it('does not split by ownership share; co-owners see same apartment amount', () => {
    expect(splitsSupportFeeByOwnershipShare()).toBe(false);
    expect(apartmentSupportAmountIgnoresShares(400, 25)).toBe(400);
    expect(apartmentSupportAmountIgnoresShares(400, 75)).toBe(400);
    expect(ownershipTransferPreservesApartmentLedger()).toBe(true);
  });
});

describe('Rounding / natural vs legal preview', () => {
  it('keeps EUR precision and area×rate for both subjects', () => {
    expect(annualSupportFee(50.125, 8)).toBe(401);
    expect(monthlySupportFee(100, 8)).toBe(66.67);
    const natural = annualSupportFee(45, 8);
    const legal = annualSupportFee(45, 10);
    expect(natural).toBe(360);
    expect(legal).toBe(450);
    expect(natural).not.toBe(legal);
  });
});
