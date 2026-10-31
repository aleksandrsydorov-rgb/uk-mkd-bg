import { describe, expect, it } from 'vitest';
import {
  EXPENSE_RECEIPT_ACCEPT,
  isExpenseReceiptPdfPath,
  isOpeningExpense,
  operationalExpenseRequiresSupportingFile,
  validateOperationalExpenseSupportingFiles,
} from '@/lib/expenses';
import { EXPENSE_RECEIPTS_BUCKET, privateUploadRejectReason } from '@/lib/privateMedia';

describe('Task 14 · operational UK expense receipts', () => {
  it('requires supporting files for operational rows only', () => {
    expect(operationalExpenseRequiresSupportingFile(null)).toBe(true);
    expect(operationalExpenseRequiresSupportingFile({ opening_import: false })).toBe(true);
    expect(operationalExpenseRequiresSupportingFile({ opening_import: true })).toBe(false);
    expect(isOpeningExpense({ opening_import: true })).toBe(true);

    expect(
      validateOperationalExpenseSupportingFiles({
        expense: null,
        existingUrls: [],
        newFilesCount: 0,
      }),
    ).toEqual({ ok: false, errorKey: 'admin.expReceiptRequired' });

    expect(
      validateOperationalExpenseSupportingFiles({
        expense: { opening_import: true },
        existingUrls: [],
        newFilesCount: 0,
      }),
    ).toEqual({ ok: true });

    expect(
      validateOperationalExpenseSupportingFiles({
        expense: { opening_import: false },
        existingUrls: ['expenses/1/a.jpg'],
        newFilesCount: 0,
      }),
    ).toEqual({ ok: true });
  });

  it('accepts PDF paths and PDF mime for expense receipts bucket', () => {
    expect(isExpenseReceiptPdfPath('expenses/9/abc.pdf')).toBe(true);
    expect(isExpenseReceiptPdfPath('expenses/9/abc.jpg')).toBe(false);
    expect(EXPENSE_RECEIPT_ACCEPT).toContain('application/pdf');

    const pdf = new File(['%PDF'], 'scan.pdf', { type: 'application/pdf' });
    const jpg = new File(['x'], 'r.jpg', { type: 'image/jpeg' });
    const txt = new File(['x'], 'n.txt', { type: 'text/plain' });
    expect(privateUploadRejectReason(EXPENSE_RECEIPTS_BUCKET, pdf)).toBeNull();
    expect(privateUploadRejectReason(EXPENSE_RECEIPTS_BUCKET, jpg)).toBeNull();
    expect(privateUploadRejectReason(EXPENSE_RECEIPTS_BUCKET, txt)).toBe('type');
  });
});
