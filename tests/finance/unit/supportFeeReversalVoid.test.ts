import { describe, expect, it } from 'vitest';
import {
  assessVoidSupportAssessmentEligibility,
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
