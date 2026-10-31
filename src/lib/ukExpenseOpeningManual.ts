/**
 * Task 13 — Manual mid-year UK expense opening entry (no receipts required).
 * Commits only via import_uk_expense_opening_row; never invents AP/payments.
 */

import { sofiaTodayIsoDate, sofiaCurrentYear } from '@/lib/tariffs';

export type UkExpenseOpeningManualInput = {
  title: string;
  amount: number;
  expenseDate: string;
  transitionDate: string;
  sourceRef: string;
  sourceDocument?: string | null;
  notes?: string | null;
  categoryCode?: string | null;
};

/** Accounting year window: 01.01–31.12 of the Sofia calendar year. */
export function ukExpenseOpeningYearBounds(billingYear: number): { from: string; to: string } {
  return { from: `${billingYear}-01-01`, to: `${billingYear}-12-31` };
}

export function defaultUkExpenseOpeningTransitionDate(now = new Date()): string {
  return sofiaTodayIsoDate(now);
}

export function defaultUkExpenseOpeningManualSourceRef(args: {
  expenseDate: string;
  nonce?: string;
}): string {
  const date = String(args.expenseDate ?? '').trim() || 'undated';
  const nonce = String(args.nonce ?? cryptoRandomSuffix()).trim();
  return `manual-opening:${date}:${nonce}`;
}

function cryptoRandomSuffix(): string {
  try {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      return crypto.randomUUID().slice(0, 8);
    }
  } catch {
    /* ignore */
  }
  return String(Date.now()).slice(-8);
}

export function validateUkExpenseOpeningManualInput(
  input: UkExpenseOpeningManualInput,
  opts?: { sofiaTodayIso?: string; billingYear?: number },
): { ok: true } | { ok: false; errorKey: string } {
  const today = opts?.sofiaTodayIso ?? sofiaTodayIsoDate();
  const year = opts?.billingYear ?? sofiaCurrentYear();
  const bounds = ukExpenseOpeningYearBounds(year);

  const title = String(input.title ?? '').trim();
  if (!title) return { ok: false, errorKey: 'admin.expOpeningErrTitle' };

  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || !(amount > 0)) {
    return { ok: false, errorKey: 'admin.expOpeningErrAmount' };
  }

  const expenseDate = String(input.expenseDate ?? '').trim();
  const transitionDate = String(input.transitionDate ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expenseDate)) {
    return { ok: false, errorKey: 'admin.expOpeningErrDate' };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(transitionDate)) {
    return { ok: false, errorKey: 'admin.expOpeningErrTransition' };
  }

  if (expenseDate < bounds.from || expenseDate > bounds.to) {
    return { ok: false, errorKey: 'admin.expOpeningErrYearWindow' };
  }
  if (transitionDate > today) {
    return { ok: false, errorKey: 'admin.expOpeningErrTransitionFuture' };
  }
  if (expenseDate > transitionDate) {
    return { ok: false, errorKey: 'admin.expOpeningErrAfterTransition' };
  }

  const sourceRef = String(input.sourceRef ?? '').trim();
  if (!sourceRef) return { ok: false, errorKey: 'admin.expOpeningErrSource' };

  return { ok: true };
}

/** Opening rows must not require receipt/photo uploads (Task 13). */
export function ukExpenseOpeningRequiresReceipt(): false {
  return false;
}
