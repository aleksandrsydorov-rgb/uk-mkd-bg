import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  EXPENSE_RECEIPT_ACCEPT,
  expenseReceiptServerErrorKey,
  isExpenseReceiptPdfPath,
  isOpeningExpense,
  operationalExpenseRequiresSupportingFile,
  validateOperationalExpenseSupportingFiles,
} from '@/lib/expenses';
import { EXPENSE_RECEIPTS_BUCKET, expensePendingReceiptPath, privateUploadRejectReason } from '@/lib/privateMedia';

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

  it('maps the server receipt errors onto the existing UI key', () => {
    expect(expenseReceiptServerErrorKey('uk_expenses: receipt required')).toBe('admin.expReceiptRequired');
    expect(expenseReceiptServerErrorKey('uk_expenses: receipt unlink blocked')).toBe('admin.expReceiptRequired');
    expect(expenseReceiptServerErrorKey('uk_expenses: status')).toBeNull();
    expect(expensePendingReceiptPath('scan.pdf')).toMatch(
      /^expenses\/pending\/[0-9a-f-]{36}\.pdf$/,
    );
  });

  it('keeps the server receipt rule in the additive migration', () => {
    const sql = readFileSync(
      path.join(process.cwd(), 'supabase/migrations/20261129160000_uk_expense_operational_receipt_required.sql'),
      'utf8',
    );
    expect(sql).toContain('uk_expenses: receipt required');
    expect(sql).toContain('uk_expenses: receipt unlink blocked');
    expect(sql).toContain('claim_uk_expense_opening_origin');
    expect(sql).not.toMatch(/drop policy/i);
    expect(sql).not.toMatch(/set\s+public\s*=\s*true/i);
    const stub = readFileSync(
      path.join(process.cwd(), 'supabase/packages/fresh_install/113_ux_expense_operational_receipt.sql'),
      'utf8',
    );
    expect(stub).toMatch(/package stub|chronological migration/i);
    expect(stub).not.toMatch(/create or replace function/i);
  });

  it('restores staff writes without an anonymous or unconditional grant', () => {
    const sql = readFileSync(
      path.join(process.cwd(), 'supabase/migrations/20261129170000_uk_expense_staff_write_path.sql'),
      'utf8',
    );
    expect(sql).toContain('grant insert, update, delete on table public.uk_expenses to authenticated');
    expect(sql).toContain("has_staff_role('администрация')");
    expect(sql).toContain("has_staff_role('бухгалтер')");
    expect(sql).not.toMatch(/grant\s+insert[\s\S]*to\s+anon/i);
    expect(sql).not.toMatch(/drop policy if exists uk_expenses_staff_delete/i);
    const stub = readFileSync(
      path.join(process.cwd(), 'supabase/packages/fresh_install/114_ux_expense_staff_write_path.sql'),
      'utf8',
    );
    expect(stub).toMatch(/package stub|chronological migration/i);
    expect(stub).not.toMatch(/create policy/i);
  });
});
