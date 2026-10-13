import { describe, expect, it } from 'vitest';
import {
  apartmentCategoryBreakdown,
  buildCapitalReportSnapshot,
  buildSupportFeeReportSnapshot,
  buildUtilitiesReportSnapshot,
  combineVerifiedFinancialObligations,
  isSupportFeeOnlyTotalMisleadingAsAllDebt,
  outstandingFromUtilityBalance,
} from '@/lib/financeReporting';
import { emptyBalance } from '@/lib/utilities';
import { canSelectSupportFeeLedger, scrubGuestPropertyFinanceFields } from '@/lib/securityRpcPolicy';

describe('E2.3-C · D7 separate financial reporting', () => {
  const properties = [
    { id: 111, debt: 360, overpayment: 0 },
    { id: 112, debt: 440, overpayment: 0 },
    { id: 1, debt: 0, overpayment: 1 },
  ];
  const assessments = [
    { property_id: 111, remaining_due: 360, status: 'open' },
    { property_id: 112, remaining_due: 440, status: 'open' },
  ];
  const ledger = [
    { kind: 'charge', amount: 800 },
    { kind: 'payment', amount: 40 },
    { kind: 'payment_reversal', amount: 40 },
    { kind: 'assessment_void', amount: 0 },
  ];

  it('Support Fee report uses D1 outstanding and separates overpayment / reversals / voids', () => {
    const snap = buildSupportFeeReportSnapshot({
      properties,
      assessments,
      assessmentsLoaded: true,
      ledger,
    });
    expect(snap.category).toBe('support_fee');
    expect(snap.reliability).toBe('canonical_remaining_due');
    expect(snap.outstanding).toBe(800);
    expect(snap.overpayment).toBe(1);
    expect(snap.payments).toBe(40);
    expect(snap.reversals).toBe(40);
    expect(snap.apartmentsWithOutstanding).toBe(2);
  });

  it('Capital report stays separate and marks unavailable when not loaded', () => {
    expect(buildCapitalReportSnapshot(null, false).reliability).toBe('unavailable');
    const loaded = buildCapitalReportSnapshot(
      { charged_eur: 1000, paid_eur: 200, balance_eur: 800, apartments_with_debt: 3 },
      true
    );
    expect(loaded.category).toBe('capital');
    expect(loaded.reliability).toBe('ledger_balance');
    expect(loaded.outstanding).toBe(800);
    expect(loaded.charged).toBe(1000);
  });

  it('Utilities report separates domains and never treats missing as zero debt', () => {
    const water = new Map([[111, { ...emptyBalance(), balance_eur: 12 }]]);
    const partial = buildUtilitiesReportSnapshot({
      waterByProperty: water,
      electricityByProperty: null,
      internetByProperty: null,
    });
    expect(partial.waterOutstanding).toBe(12);
    expect(partial.electricityOutstanding).toBeNull();
    expect(partial.combinedDomainOutstanding).toBeNull();

    const full = buildUtilitiesReportSnapshot({
      waterByProperty: water,
      electricityByProperty: new Map([[111, { ...emptyBalance(), balance_eur: 5 }]]),
      internetByProperty: new Map([[111, { ...emptyBalance(), balance_eur: -2 }]]),
    });
    expect(full.internetOutstanding).toBe(0);
    expect(full.combinedDomainOutstanding).toBe(17);
    expect(full.note).toBe('ledger_balances_not_meter_consumption');
  });

  it('does not emit a misleading combined total across SF + capital + utilities', () => {
    expect(
      combineVerifiedFinancialObligations([
        { amount: 800, verified: true, scope: 'd1_sf' },
        { amount: 100, verified: true, scope: 'ledger_capital' },
      ])
    ).toBeNull();

    const apt = apartmentCategoryBreakdown({
      supportOutstanding: 360,
      capitalOutstanding: 100,
      waterOutstanding: 10,
      electricityOutstanding: 5,
      internetOutstanding: 0,
    });
    expect(apt.supportFee).toBe(360);
    expect(apt.capital).toBe(100);
    expect(apt.combinedTotal).toBeNull();
    expect(isSupportFeeOnlyTotalMisleadingAsAllDebt(true)).toBe(true);
    expect(isSupportFeeOnlyTotalMisleadingAsAllDebt(false)).toBe(false);
  });

  it('empty financial categories stay explicit (null / zero domain maps)', () => {
    const emptyUtils = buildUtilitiesReportSnapshot({
      waterByProperty: new Map(),
      electricityByProperty: new Map(),
      internetByProperty: new Map(),
    });
    expect(emptyUtils.waterOutstanding).toBe(0);
    expect(emptyUtils.combinedDomainOutstanding).toBe(0);
    expect(outstandingFromUtilityBalance(undefined)).toBe(0);
  });

  it('admin/PDF SF snapshot matches owner D1 outstanding for same inputs', () => {
    const snap = buildSupportFeeReportSnapshot({
      properties: [{ id: 111, debt: 360, overpayment: 0 }],
      assessments: [{ property_id: 111, remaining_due: 360, status: 'open' }],
      assessmentsLoaded: true,
      ledger: [],
    });
    expect(snap.outstanding).toBe(360);
  });

  it('voided assessments are excluded from Support Fee outstanding', () => {
    const snap = buildSupportFeeReportSnapshot({
      properties: [
        { id: 111, debt: 0, overpayment: 0 },
        { id: 112, debt: 440, overpayment: 0 },
      ],
      assessments: [
        { property_id: 111, remaining_due: 0, status: 'void' },
        { property_id: 112, remaining_due: 440, status: 'open' },
      ],
      assessmentsLoaded: true,
      ledger: [{ kind: 'assessment_void', amount: 360 }],
    });
    expect(snap.outstanding).toBe(440);
    expect(snap.voids).toBe(360);
  });

  it('guest finance scrub and cross-apartment ledger deny remain', () => {
    expect(scrubGuestPropertyFinanceFields({ debt: 100, overpayment: 5 })).toEqual({
      debt: 0,
      overpayment: 0,
    });
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
