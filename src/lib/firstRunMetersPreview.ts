/**
 * First-run meters preview helpers — keep display honest to parsed XLSX rows.
 * Does not invent readings or opening amounts.
 */

export type MeterOpeningBalanceCells = {
  debtText: string;
  overpaymentText: string;
  debtInvalid: boolean;
  overpaymentInvalid: boolean;
};

function parseNonNeg(raw: string | undefined | null): number | null {
  const t = String(raw ?? '')
    .trim()
    .replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

/** Zero readings stay "0"; blank/invalid stay a placeholder (caller may localize). */
export function formatMeterReadingCell(
  raw: string | undefined | null,
  emptyPlaceholder = '—',
): string {
  const t = String(raw ?? '').trim();
  if (!t) return emptyPlaceholder;
  const n = parseNonNeg(t);
  if (n == null) return emptyPlaceholder;
  // Preserve file precision without forcing trailing zeros.
  return String(n);
}

export function formatMeterMoney(n: number, locale = 'ru'): string {
  return n.toLocaleString(locale === 'bg' ? 'bg-BG' : locale === 'en' ? 'en-GB' : 'ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Map opening_balance_kind + opening_balance_eur into separate Debt / Overpayment columns.
 * - zero: both 0.00 (empty amount allowed)
 * - debt/overpayment with missing/invalid amount: show errorLabel, never coerce to 0
 */
export function meterOpeningBalanceCells(
  row: Record<string, string>,
  opts: { locale?: string; errorLabel: string },
): MeterOpeningBalanceCells {
  const locale = opts.locale ?? 'ru';
  const zero = formatMeterMoney(0, locale);
  const kind = String(row.opening_balance_kind ?? '')
    .trim()
    .toLowerCase();
  const effective = kind || 'zero';
  const rawAmount = String(row.opening_balance_eur ?? '').trim();
  const amount = parseNonNeg(rawAmount);

  if (effective === 'zero') {
    if (rawAmount && amount == null) {
      return {
        debtText: opts.errorLabel,
        overpaymentText: opts.errorLabel,
        debtInvalid: true,
        overpaymentInvalid: true,
      };
    }
    return {
      debtText: zero,
      overpaymentText: zero,
      debtInvalid: false,
      overpaymentInvalid: false,
    };
  }

  if (effective === 'debt') {
    if (amount == null || amount <= 0) {
      return {
        debtText: opts.errorLabel,
        overpaymentText: zero,
        debtInvalid: true,
        overpaymentInvalid: false,
      };
    }
    return {
      debtText: formatMeterMoney(amount, locale),
      overpaymentText: zero,
      debtInvalid: false,
      overpaymentInvalid: false,
    };
  }

  if (effective === 'overpayment') {
    if (amount == null || amount <= 0) {
      return {
        debtText: zero,
        overpaymentText: opts.errorLabel,
        debtInvalid: false,
        overpaymentInvalid: true,
      };
    }
    return {
      debtText: zero,
      overpaymentText: formatMeterMoney(amount, locale),
      debtInvalid: false,
      overpaymentInvalid: false,
    };
  }

  return {
    debtText: opts.errorLabel,
    overpaymentText: opts.errorLabel,
    debtInvalid: true,
    overpaymentInvalid: true,
  };
}

/** Sum only valid positive debt/overpayment amounts from parsed rows. */
export function summarizeMeterOpeningBalances(rows: Record<string, string>[]): {
  debtTotal: number;
  overpaymentTotal: number;
} {
  let debtTotal = 0;
  let overpaymentTotal = 0;
  for (const row of rows) {
    const kind = String(row.opening_balance_kind ?? '')
      .trim()
      .toLowerCase() || 'zero';
    const amount = parseNonNeg(row.opening_balance_eur);
    if (amount == null || amount <= 0) continue;
    if (kind === 'debt') debtTotal += amount;
    else if (kind === 'overpayment') overpaymentTotal += amount;
  }
  return { debtTotal, overpaymentTotal };
}
