import { describe, expect, it } from 'vitest';
import {
  adminOwnerSupportOutstandingParity,
  buildSupportBalanceView,
  canonicalSupportOutstanding,
  displaySupportOutstanding,
  hasSupportBalanceDiscrepancy,
  indexCanonicalSupportOutstanding,
  sumDisplaySupportOutstanding,
  supportOverpayment,
} from '@/lib/supportFeeBalance';
import {
  canCallOwnershipChangeOverdueDebt,
  canSelectSupportFeeLedger,
  scrubGuestPropertyFinanceFields,
} from '@/lib/securityRpcPolicy';

/** Fixtures mirroring live apts 1, 2, 111, 112 (read-only audit). */
const assessments = [
  { property_id: 111, remaining_due: 360, status: 'open' },
  { property_id: 112, remaining_due: 440, status: 'open' },
];

const properties = [
  { id: 1, debt: 0, overpayment: 1 },
  { id: 2, debt: 0, overpayment: 162.3 },
  { id: 111, debt: 360, overpayment: 0 },
  { id: 112, debt: 440, overpayment: 0 },
];

describe('E2.3-A2 · admin/owner/PDF Support Fee display consistency', () => {
  it('admin and owner use the same outstanding for each apartment', () => {
    for (const p of properties) {
      const parity = adminOwnerSupportOutstandingParity({
        propertyId: p.id,
        assessments,
        assessmentsLoaded: true,
        portalDebt: p.debt,
      });
      expect(parity.aligned).toBe(true);
      expect(parity.admin).toBe(parity.owner);
      expect(parity.admin).toBe(
        displaySupportOutstanding({
          assessmentsLoaded: true,
          assessments,
          propertyId: p.id,
          portalDebt: p.debt,
        })
      );
    }
  });

  it('PDF/export debt totals match sum of remaining_due (not portal-only mix)', () => {
    const indexed = indexCanonicalSupportOutstanding(assessments);
    expect(indexed.get(111)).toBe(360);
    expect(indexed.get(112)).toBe(440);
    expect(indexed.has(1)).toBe(false);
    expect(indexed.has(2)).toBe(false);

    const total = sumDisplaySupportOutstanding(properties, assessments, true);
    expect(total).toBe(800);
    expect(total).toBe(canonicalSupportOutstanding(assessments));

    const debtRows = properties.filter(
      (p) =>
        displaySupportOutstanding({
          assessmentsLoaded: true,
          assessments,
          propertyId: p.id,
          portalDebt: p.debt,
        }) > 0
    );
    expect(debtRows.map((p) => p.id)).toEqual([111, 112]);
  });

  it('separates overpayment from outstanding; apartments without assessments show 0 debt', () => {
    expect(
      displaySupportOutstanding({
        assessmentsLoaded: true,
        assessments,
        propertyId: 1,
        portalDebt: 0,
      })
    ).toBe(0);
    expect(supportOverpayment(1)).toBe(1);
    expect(supportOverpayment(162.3)).toBe(162.3);
  });

  it('partial payment and overpayment math stay independent of display SoT', () => {
    const afterPartial = buildSupportBalanceView({
      propertyId: 111,
      portalDebt: 320,
      portalOverpayment: 0,
      assessments: [{ property_id: 111, remaining_due: 320, status: 'open' }],
      ledger: [
        { property_id: 111, kind: 'charge', amount: 360 },
        { property_id: 111, kind: 'payment', amount: 40 },
      ],
    });
    expect(afterPartial.outstandingDue).toBe(320);
    expect(afterPartial.overpayment).toBe(0);

    const withOver = buildSupportBalanceView({
      propertyId: 2,
      portalDebt: 0,
      portalOverpayment: 162.3,
      assessments: [],
      ledger: [{ property_id: 2, kind: 'payment', amount: 150 }],
    });
    expect(withOver.outstandingDue).toBe(0);
    expect(withOver.overpayment).toBe(162.3);
    expect(hasSupportBalanceDiscrepancy(withOver)).toBe(true);
  });

  it('preserves legacy discrepancy detection without auto-correcting', () => {
    const legacy1 = buildSupportBalanceView({
      propertyId: 1,
      portalDebt: 0,
      portalOverpayment: 1,
      assessments: [],
      ledger: [
        { property_id: 1, kind: 'payment', amount: 45.5 },
        { property_id: 1, kind: 'payment', amount: 1 },
      ],
    });
    expect(legacy1.outstandingDue).toBe(0);
    expect(hasSupportBalanceDiscrepancy(legacy1)).toBe(true);
  });

  it('co-owners see the same apartment outstanding (no share split)', () => {
    const due = displaySupportOutstanding({
      assessmentsLoaded: true,
      assessments,
      propertyId: 111,
      portalDebt: 360,
    });
    // Two co-owner views of the same property_id
    expect(due).toBe(360);
    expect(due).toBe(
      displaySupportOutstanding({
        assessmentsLoaded: true,
        assessments,
        propertyId: 111,
        portalDebt: 360,
      })
    );
  });

  it('guest finance scrub and cross-apartment authz boundaries remain', () => {
    expect(scrubGuestPropertyFinanceFields({ debt: 360, overpayment: 10 })).toEqual({
      debt: 0,
      overpayment: 0,
    });
    expect(
      canCallOwnershipChangeOverdueDebt({
        role: 'authenticated',
        isBookAdmin: false,
        isAccountant: false,
        ownsProperty: false,
        isGuestOnly: false,
        isFormerOwner: false,
      })
    ).toBe(false);
    expect(
      canSelectSupportFeeLedger({
        role: 'authenticated',
        isBookAdmin: false,
        isAccountant: false,
        ownsProperty: false,
        isGuestOnly: true,
      })
    ).toBe(false);
    expect(
      canSelectSupportFeeLedger({
        role: 'authenticated',
        isBookAdmin: false,
        isAccountant: false,
        ownsProperty: true,
        isGuestOnly: false,
      })
    ).toBe(true);
  });
});
