import { describe, expect, it } from 'vitest';
import {
  assertSupportFeeRestoreTargetMatch,
  assessRestoreSupportAssessmentEligibility,
  buildSupportFeeRestoreTarget,
  previewRestoreVoidedAssessment,
  restorePreservesVoidAndChargeHistory,
  supportLedgerKindLabelKey,
} from '@/lib/supportFeeReversal';
import { canMutateSupportFeeReversalOrVoid } from '@/lib/securityRpcPolicy';
import { canReverseOrVoidSupportFees } from '@/lib/finance';
import { canonicalSupportOutstanding } from '@/lib/supportFeeBalance';
import { dictionaries } from '@/i18n/messages';

describe('E2.3-D · assessment restore', () => {
  const incidentAssessment = {
    id: 'e85d923f-77c1-494c-b752-52eb4f5e45ce',
    property_id: 111,
    billing_year: 2026,
    final_amount: 360,
    void_reason: 'E2E-FINANCE-D test void',
    status: 'void' as const,
    remaining_due: 0,
    applied_payment_amount: 0,
    applied_credit_amount: 0,
    restored_at: null as string | null,
    restore_ledger_id: null as number | null,
  };

  const target99405 = buildSupportFeeRestoreTarget({
    assessment: incidentAssessment,
    apartmentNumber: '99405',
    restoreAmount: 360,
  });

  it('allows successful restoration eligibility for unpaid void', () => {
    expect(
      assessRestoreSupportAssessmentEligibility({
        status: 'void',
        restoredAt: null,
        finalAmount: 360,
        voidedAmount: 360,
        appliedPaymentAmount: 0,
        appliedCreditAmount: 0,
      })
    ).toEqual({ ok: true, restoreAmount: 360 });
  });

  it('restores canonical remaining_due without double counting charge', () => {
    const preview = previewRestoreVoidedAssessment({
      restoreAmount: 360,
      portalDebt: 0,
      portalOverpayment: 0,
    });
    expect(preview.valid).toBe(true);
    expect(preview.newDebt).toBe(360);
    expect(preview.newOverpayment).toBe(0);

    const after = [
      { property_id: 111, remaining_due: 360, status: 'open' },
      { property_id: 114, remaining_due: 132, status: 'open' },
    ];
    expect(canonicalSupportOutstanding(after, 111)).toBe(360);
    expect(canonicalSupportOutstanding(after)).toBe(492);
  });

  it('preserves original charge and void ledger; adds assessment_restore', () => {
    const ledger = [
      { id: 25, kind: 'charge' },
      { id: 32, kind: 'assessment_void' },
      { id: 99, kind: 'assessment_restore' },
    ];
    expect(
      restorePreservesVoidAndChargeHistory({
        ledger,
        chargeLedgerId: 25,
        voidLedgerId: 32,
        restoreLedgerId: 99,
      })
    ).toBe(true);
    expect(
      restorePreservesVoidAndChargeHistory({
        ledger: ledger.filter((r) => r.id !== 32),
        chargeLedgerId: 25,
        voidLedgerId: 32,
        restoreLedgerId: 99,
      })
    ).toBe(false);
  });

  it('rejects duplicate restore (already restored audit)', () => {
    expect(
      assessRestoreSupportAssessmentEligibility({
        status: 'void',
        restoredAt: '2026-10-14T00:00:00Z',
        finalAmount: 360,
      }).ok
    ).toBe(false);
    expect(
      assessRestoreSupportAssessmentEligibility({
        status: 'void',
        restoreLedgerId: 99,
        finalAmount: 360,
      })
    ).toEqual({ ok: false, reason: 'already_restored' });
  });

  it('concurrent restore protection via stale match when status leaves void', () => {
    expect(
      assertSupportFeeRestoreTargetMatch({
        target: target99405,
        assessment: { ...incidentAssessment, status: 'open', restored_at: '2026-10-14T00:00:00Z' },
        expectedPropertyId: 111,
        confirmedApartmentNumber: '99405',
      })
    ).toEqual({ ok: false, reason: 'stale_assessment' });
  });

  it('rejects wrong-apartment / null expected property', () => {
    expect(
      assertSupportFeeRestoreTargetMatch({
        target: target99405,
        assessment: incidentAssessment,
        expectedPropertyId: 114,
        confirmedApartmentNumber: '99405',
      })
    ).toEqual({ ok: false, reason: 'property_mismatch' });
    expect(
      assertSupportFeeRestoreTargetMatch({
        target: target99405,
        assessment: incidentAssessment,
        expectedPropertyId: null,
        confirmedApartmentNumber: '99405',
      })
    ).toEqual({ ok: false, reason: 'missing_expected_property' });
    expect(
      assertSupportFeeRestoreTargetMatch({
        target: target99405,
        assessment: incidentAssessment,
        expectedPropertyId: 111,
        confirmedApartmentNumber: '99408',
      })
    ).toEqual({ ok: false, reason: 'apartment_mismatch' });
  });

  it('denies owner and guest mutation; allows admin/accountant', () => {
    expect(canReverseOrVoidSupportFees('администрация')).toBe(true);
    expect(canReverseOrVoidSupportFees('бухгалтер')).toBe(true);
    expect(
      canMutateSupportFeeReversalOrVoid({
        role: 'authenticated',
        isBookAdmin: false,
        isAccountant: false,
        isGuestOnly: true,
        ownsProperty: false,
      })
    ).toBe(false);
    expect(
      canMutateSupportFeeReversalOrVoid({
        role: 'authenticated',
        isBookAdmin: false,
        isAccountant: false,
        isGuestOnly: false,
        ownsProperty: true,
      })
    ).toBe(false);
  });

  it('cross-complex isolation: restore preview is per-apartment balances only', () => {
    const apt111 = previewRestoreVoidedAssessment({
      restoreAmount: 360,
      portalDebt: 0,
      portalOverpayment: 0,
    });
    const apt114 = previewRestoreVoidedAssessment({
      restoreAmount: 132,
      portalDebt: 132,
      portalOverpayment: 0,
    });
    expect(apt111.newDebt).toBe(360);
    expect(apt114.newDebt).toBe(264);
    expect(apt111.newDebt).not.toBe(apt114.newDebt);
  });

  it('rejects invalid assessment state and linked payments/credits', () => {
    expect(
      assessRestoreSupportAssessmentEligibility({
        status: 'open',
        finalAmount: 360,
      })
    ).toEqual({ ok: false, reason: 'not_void' });
    expect(
      assessRestoreSupportAssessmentEligibility({
        status: 'void',
        finalAmount: 360,
        appliedPaymentAmount: 40,
      })
    ).toEqual({ ok: false, reason: 'has_payment_allocations' });
    expect(
      assessRestoreSupportAssessmentEligibility({
        status: 'void',
        finalAmount: 360,
        appliedCreditAmount: 10,
      })
    ).toEqual({ ok: false, reason: 'has_credit_allocations' });
    expect(
      assessRestoreSupportAssessmentEligibility({
        status: 'void',
        finalAmount: 360,
        hasActiveSiblingForYear: true,
      })
    ).toEqual({ ok: false, reason: 'active_sibling_year' });
  });

  it('UI frozen target freezes assessment + property identity', () => {
    expect(target99405).toMatchObject({
      assessmentId: 'e85d923f-77c1-494c-b752-52eb4f5e45ce',
      propertyId: 111,
      apartmentNumber: '99405',
      billingYear: 2026,
      restoreAmount: 360,
    });
    expect(
      assertSupportFeeRestoreTargetMatch({
        target: target99405,
        assessment: incidentAssessment,
        expectedPropertyId: 111,
        confirmedApartmentNumber: '99405',
      })
    ).toEqual({ ok: true });
  });

  it('BG/RU/EN restore labels are present and distinct from void submit', () => {
    for (const locale of ['ru', 'en', 'bg'] as const) {
      const admin = dictionaries[locale].admin;
      expect(admin.feeRestoreAssessment.length).toBeGreaterThan(0);
      expect(admin.feeRestoreSubmit.length).toBeGreaterThan(0);
      expect(admin.feeRestoreAptConfirm).toContain('{n}');
      expect(admin.feeRestoreSubmit).not.toBe(admin.feeVoidAssessment);
      expect(admin.feeRestoreSubmit).not.toBe(admin.feeVoidSubmit);
      expect(admin.kindAssessmentRestore.length).toBeGreaterThan(0);
    }
    expect(supportLedgerKindLabelKey('assessment_restore')).toBe('admin.kindAssessmentRestore');
  });
});
