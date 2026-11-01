export const EXPENSE_PENDING = 'на проверке';
export const EXPENSE_PUBLISHED = 'опубликован';
export const MAX_EXPENSE_PHOTOS = 5;

export function isExpensePublished(expense: { status?: string | null }) {
  const s = (expense.status ?? '').trim().toLowerCase();
  if (!s) return true;
  return s === EXPENSE_PUBLISHED || s === 'approved' || s === 'published';
}

/** Historical opening row. Receipt is not required. */
export function isOpeningExpense(expense: { opening_import?: boolean | null }) {
  return expense.opening_import === true;
}

export function expensePhotoUrls(expense: { photo_urls?: string[] | null }): string[] {
  return (expense.photo_urls ?? []).filter(Boolean).slice(0, MAX_EXPENSE_PHOTOS);
}

/** Images and PDF for operational UK expense receipts. */
export const EXPENSE_RECEIPT_ACCEPT = 'image/*,application/pdf,.pdf';
export const EXPENSE_RECEIPT_CAMERA_ACCEPT = 'image/*';

/**
 * New operational rows need a supporting file. Opening never does.
 * An existing operational row still reports true; the screen does not
 * reject historical rows that were saved without a file. The server
 * rejects a new operational row with no real receipt and blocks
 * unlinking the last required receipt.
 */
export function expenseReceiptServerErrorKey(
  message: string | null | undefined,
): 'admin.expReceiptRequired' | null {
  const msg = message ?? '';
  if (
    msg.includes('uk_expenses: receipt required')
    || msg.includes('uk_expenses: receipt unlink blocked')
  ) {
    return 'admin.expReceiptRequired';
  }
  return null;
}
export function operationalExpenseRequiresSupportingFile(
  expense?: { opening_import?: boolean | null } | null,
): boolean {
  if (!expense) return true;
  return !isOpeningExpense(expense);
}

export function expenseSupportingFileCount(args: {
  existingUrls?: string[] | null;
  newFilesCount?: number;
}): number {
  return expensePhotoUrls({ photo_urls: args.existingUrls ?? [] }).length + Math.max(0, args.newFilesCount ?? 0);
}

export function validateOperationalExpenseSupportingFiles(args: {
  expense?: { opening_import?: boolean | null } | null;
  existingUrls?: string[] | null;
  newFilesCount?: number;
}): { ok: true } | { ok: false; errorKey: string } {
  if (!operationalExpenseRequiresSupportingFile(args.expense)) return { ok: true };
  const n = expenseSupportingFileCount(args);
  if (n < 1) return { ok: false, errorKey: 'admin.expReceiptRequired' };
  if (n > MAX_EXPENSE_PHOTOS) return { ok: false, errorKey: 'admin.expReceiptTooMany' };
  return { ok: true };
}

export function isExpenseReceiptPdfPath(path: string): boolean {
  const clean = String(path ?? '').split('?')[0]?.trim() ?? '';
  return /\.pdf$/i.test(clean);
}