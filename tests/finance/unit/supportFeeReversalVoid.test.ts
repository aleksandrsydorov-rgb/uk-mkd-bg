import { describe, expect, it } from 'vitest';
import {
  assessVoidSupportAssessmentEligibility,
  assertSupportFeeVoidTargetMatch,
  buildSupportFeeVoidTarget,
  isSupportLedgerReversed,
  isSupportPaymentReversible,
  previewReverseSupportPayment,
  previewVoidUnpaidAssessment,
  supportLedgerKindLabelKey,
} from '@/lib/supportFeeReversal';
import { canMutateSupportFeeReversalOrVoid } from '@/lib/securityRpcPolicy';
import { canReverseOrVoidSupportFees } from '@/lib/finance';
import { canonicalSupportOutstanding } from '@/lib/supportFeeBalance';

describe('E2.3-B · payment reversal + assessment void policy', () => {
  it('full reversal restores debt when payment was fully allocated', () => {
    const preview = previewReverseSupportPayment({
      paymentAmount: 100,
      allocatedAmount: 100,
      portalDebt: 20,
      portalOverpayment: 0,
    });
    expect(preview.valid).toBe(true);
    expect(preview.surplus).toBe(0);
    expect(preview.newDebt).toBe(120);
    expect(preview.newOverpayment).toBe(0);
  });

  it('partial allocation + surplus reverses debt and overpayment correctly', () => {
    const preview = previewReverseSupportPayment({
      paymentAmount: 80,
      allocatedAmount: 50,
      portalDebt: 10,
      portalOverpayment: 40,
    });
    expect(preview.surplus).toBe(30);
    expect(preview.newDebt).toBe(60); // 10 + 50 + 0
    expect(preview.newOverpayment).toBe(10); // 40 - 30
  });

  it('unallocated payment (legacy overpay-only) reverses from overpayment', () => {
    const preview = previewReverseSupportPayment({
      paymentAmount: 150,
      allocatedAmount: 0,
      portalDebt: 0,
      portalOverpayment: 162.3,
    });
    expect(preview.surplus).toBe(150);
    expect(preview.newDebt).toBe(0);
    expect(preview.newOverpayment).toBe(12.3);
  });

  it('rejects duplicate reversal via ledger scan', () => {
    expect(isSupportPaymentReversible('payment')).toBe(true);
    expect(isSupportPaymentReversible('charge')).toBe(false);
    expect(
      isSupportLedgerReversed({
        originalLedgerId: 13,
        ledger: [
          { kind: 'payment', reverses_ledger_id: null },
          { kind: 'payment_reversal', reverses_ledger_id: 13 },
        ],
      })
    ).toBe(true);
    expect(
      isSupportLedgerReversed({
        originalLedgerId: 13,
        ledger: [{ kind: 'payment_reversal', reverses_ledger_id: 99 }],
      })
    ).toBe(false);
  });

  it('allows void only for unpaid open assessments', () => {
    expect(
      assessVoidSupportAssessmentEligibility({
        status: 'open',
        remainingDue: 360,
        appliedPaymentAmount: 0,
        appliedCreditAmount: 0,
      })
    ).toEqual({ ok: true, voidableDue: 360 });
  });

  it('blocks partially and fully paid assessment voids', () => {
    expect(
      assessVoidSupportAssessmentEligibility({
        status: 'open',
        remainingDue: 100,
        appliedPaymentAmount: 40,
      }).ok
    ).toBe(false);
    expect(
      assessVoidSupportAssessmentEligibility({
        status: 'paid',
        remainingDue: 0,
        appliedPaymentAmount: 360,
      }).ok
    ).toBe(false);
    const credited = assessVoidSupportAssessmentEligibility({
      status: 'open',
      remainingDue: 200,
      appliedCreditAmount: 50,
    });
    expect(credited.ok).toBe(false);
    if (!credited.ok) expect(credited.reason).toBe('has_credit_allocations');
  });

  it('void unpaid preview reduces portal debt; keeps overpayment separate', () => {
    expect(
      previewVoidUnpaidAssessment({
        remainingDue: 360,
        portalDebt: 800,
        portalOverpayment: 163.3,
      })
    ).toEqual({ newDebt: 440, newOverpayment: 163.3 });

    const after = [
      { property_id: 111, remaining_due: 0, status: 'void' },
      { property_id: 112, remaining_due: 440, status: 'open' },
    ];
    expect(canonicalSupportOutstanding(after)).toBe(440);
  });

  it('authorization: staff only; guests/owners cannot mutate', () => {
    expect(canReverseOrVoidSupportFees('администрация')).toBe(true);
    expect(canReverseOrVoidSupportFees('бухгалтер')).toBe(true);
    expect(canReverseOrVoidSupportFees('инженер')).toBe(false);
    expect(
      canMutateSupportFeeReversalOrVoid({
        role: 'authenticated',
        isBookAdmin: true,
        isAccountant: false,
        isGuestOnly: false,
        ownsProperty: false,
      })
    ).toBe(true);
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

  it('cross-apartment isolation: reversal preview is per-apartment balances only', () => {
    const apt111 = previewReverseSupportPayment({
      paymentAmount: 40,
      allocatedAmount: 40,
      portalDebt: 320,
      portalOverpayment: 0,
    });
    const apt112 = previewReverseSupportPayment({
      paymentAmount: 40,
      allocatedAmount: 40,
      portalDebt: 440,
      portalOverpayment: 0,
    });
    expect(apt111.newDebt).toBe(360);
    expect(apt112.newDebt).toBe(480);
    expect(apt111.newDebt).not.toBe(apt112.newDebt);
  });

  it('labels distinguish active / reversal / void kinds for audit UI', () => {
    expect(supportLedgerKindLabelKey('payment')).toBe('admin.kindPayment');
    expect(supportLedgerKindLabelKey('payment_reversal')).toBe('admin.kindPaymentReversal');
    expect(supportLedgerKindLabelKey('assessment_void')).toBe('admin.kindAssessmentVoid');
  });

  describe('E2.3-D · void target apartment binding', () => {
    const target99408 = buildSupportFeeVoidTarget({
      assessment: {
        id: '20781d03-4fd8-4b39-91bb-d0223d563029',
        property_id: 114,
        billing_year: 2026,
        remaining_due: 132,
        final_amount: 132,
        base_amount: 120,
      },
      apartmentNumber: '99408',
    });
    const live99408 = {
      id: '20781d03-4fd8-4b39-91bb-d0223d563029',
      property_id: 114,
      billing_year: 2026,
      remaining_due: 132,
      status: 'open',
    };
    const wrongAptAssessment = {
      id: 'e85d923f-77c1-494c-b752-52eb4f5e45ce',
      property_id: 111,
      billing_year: 2026,
      remaining_due: 360,
      status: 'open',
    };

    it('accepts frozen target matching live assessment + confirmed apartment', () => {
      expect(
        assertSupportFeeVoidTargetMatch({
          target: target99408,
          assessment: live99408,
          expectedPropertyId: 114,
          confirmedApartmentNumber: '99408',
        })
      ).toEqual({ ok: true });
    });

    it('rejects wrong-apartment selection (stale assessment id from another row)', () => {
      expect(
        assertSupportFeeVoidTargetMatch({
          target: target99408,
          assessment: wrongAptAssessment,
          expectedPropertyId: 114,
          confirmedApartmentNumber: '99408',
        }).ok
      ).toBe(false);
      expect(
        assertSupportFeeVoidTargetMatch({
          target: {
            ...target99408,
            assessmentId: wrongAptAssessment.id,
            propertyId: 111,
            apartmentNumber: '99405',
          },
          assessment: wrongAptAssessment,
          expectedPropertyId: 114,
          confirmedApartmentNumber: '99405',
        })
      ).toEqual({ ok: false, reason: 'property_mismatch' });
    });

    it('rejects stale UI state when live assessment disappeared or already void', () => {
      expect(
        assertSupportFeeVoidTargetMatch({
          target: target99408,
          assessment: null,
          expectedPropertyId: 114,
          confirmedApartmentNumber: '99408',
        })
      ).toEqual({ ok: false, reason: 'stale_assessment' });
      expect(
        assertSupportFeeVoidTargetMatch({
          target: target99408,
          assessment: { ...live99408, status: 'void' },
          expectedPropertyId: 114,
          confirmedApartmentNumber: '99408',
        })
      ).toEqual({ ok: false, reason: 'stale_assessment' });
    });

    it('rejects mismatched assessment id / missing expected property / wrong apt confirm', () => {
      expect(
        assertSupportFeeVoidTargetMatch({
          target: target99408,
          assessment: { ...live99408, id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' },
          expectedPropertyId: 114,
          confirmedApartmentNumber: '99408',
        })
      ).toEqual({ ok: false, reason: 'assessment_mismatch' });
      expect(
        assertSupportFeeVoidTargetMatch({
          target: target99408,
          assessment: live99408,
          expectedPropertyId: null,
          confirmedApartmentNumber: '99408',
        })
      ).toEqual({ ok: false, reason: 'missing_expected_property' });
      expect(
        assertSupportFeeVoidTargetMatch({
          target: target99408,
          assessment: live99408,
          expectedPropertyId: 114,
          confirmedApartmentNumber: '99405',
        })
      ).toEqual({ ok: false, reason: 'apartment_mismatch' });
      expect(
        assertSupportFeeVoidTargetMatch({
          target: null,
          assessment: live99408,
          expectedPropertyId: 114,
          confirmedApartmentNumber: '99408',
        })
      ).toEqual({ ok: false, reason: 'missing_target' });
    });

    it('buildSupportFeeVoidTarget freezes immutable identity fields', () => {
      expect(target99408).toMatchObject({
        assessmentId: '20781d03-4fd8-4b39-91bb-d0223d563029',
        propertyId: 114,
        apartmentNumber: '99408',
        billingYear: 2026,
        remainingDue: 132,
        finalAmount: 132,
      });
    });
  });

  it('invalid reverse amounts are rejected (concurrency / negative guard mirror)', () => {
    expect(
      previewReverseSupportPayment({
        paymentAmount: 0,
        allocatedAmount: 0,
        portalDebt: 0,
        portalOverpayment: 0,
      }).valid
    ).toBe(false);
    expect(
      previewReverseSupportPayment({
        paymentAmount: 10,
        allocatedAmount: 20,
        portalDebt: 0,
        portalOverpayment: 0,
      }).valid
    ).toBe(false);
  });
});
