/**
 * First-run meters preview helpers — keep display honest to parsed XLSX rows.
 * Does not invent readings or opening amounts.
 */

import {
  resolveMeterOpeningBalance,
  type OpeningBalanceKind,
} from '@/lib/moduleCore/adapters/metersOpening';

export type MeterOpeningBalanceCells = {
  debtText: string;
  overpaymentText: string;
  debtInvalid: boolean;
  overpaymentInvalid: boolean;
};

/** Single-label balance status for the simplified water preview. */
export type MeterOpeningBalanceStatus = {
  labelKey:
    | 'debt'
    | 'overpayment'
    | 'zero'
    | 'unspecified'
    | 'invalid';
  amountText: string;
  invalid: boolean;
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

export function presentMeterOpeningBalanceStatus(
  status: MeterOpeningBalanceStatus,
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  if (status.labelKey === 'unspecified') return t('admin.firstRunMetersBalanceUnspecified');
  if (status.labelKey === 'invalid') return status.amountText || t('admin.firstRunMetersAmountError');
  if (status.labelKey === 'zero') return t('admin.firstRunMetersBalanceZero');
  if (status.labelKey === 'debt') {
    return t('admin.firstRunMetersBalanceDebt', { amount: status.amountText });
  }
  return t('admin.firstRunMetersBalanceCredit', { amount: status.amountText });
}

/**
 * Map opening balance into Debt / Overpayment columns (legacy two-column preview).
 * Empty kind + empty amount → unspecified (both show — / zero placeholder for electricity).
 */
export function meterOpeningBalanceCells(
  row: Record<string, string>,
  opts: { locale?: string; errorLabel: string },
): MeterOpeningBalanceCells {
  const locale = opts.locale ?? 'ru';
  const zero = formatMeterMoney(0, locale);
  const resolved = resolveMeterOpeningBalance(row);
  if (resolved.errors.length) {
    return {
      debtText: opts.errorLabel,
      overpaymentText: opts.errorLabel,
      debtInvalid: true,
      overpaymentInvalid: true,
    };
  }
  if (resolved.kind == null) {
    return {
      debtText: '—',
      overpaymentText: '—',
      debtInvalid: false,
      overpaymentInvalid: false,
    };
  }
  if (resolved.kind === 'zero') {
    return {
      debtText: zero,
      overpaymentText: zero,
      debtInvalid: false,
      overpaymentInvalid: false,
    };
  }
  if (resolved.kind === 'debt') {
    return {
      debtText: formatMeterMoney(resolved.amountAbs, locale),
      overpaymentText: zero,
      debtInvalid: false,
      overpaymentInvalid: false,
    };
  }
  return {
    debtText: zero,
    overpaymentText: formatMeterMoney(resolved.amountAbs, locale),
    debtInvalid: false,
    overpaymentInvalid: false,
  };
}

/** Single status cell for water signed-amount preview. */
export function meterOpeningBalanceStatus(
  row: Record<string, string>,
  opts: { locale?: string; errorLabel: string },
): MeterOpeningBalanceStatus {
  const locale = opts.locale ?? 'ru';
  const resolved = resolveMeterOpeningBalance(row);
  if (resolved.errors.length) {
    return { labelKey: 'invalid', amountText: opts.errorLabel, invalid: true };
  }
  if (resolved.kind == null) {
    return { labelKey: 'unspecified', amountText: '', invalid: false };
  }
  if (resolved.kind === 'zero') {
    return {
      labelKey: 'zero',
      amountText: formatMeterMoney(0, locale),
      invalid: false,
    };
  }
  return {
    labelKey: resolved.kind === 'debt' ? 'debt' : 'overpayment',
    amountText: formatMeterMoney(resolved.amountAbs, locale),
    invalid: false,
  };
}

/**
 * Sum debt/overpayment once per apartment (no double-count on multi-meter rows).
 */
export function summarizeMeterOpeningBalances(rows: Record<string, string>[]): {
  debtTotal: number;
  overpaymentTotal: number;
} {
  let debtTotal = 0;
  let overpaymentTotal = 0;
  const seen = new Set<string>();
  for (const row of rows) {
    const scope = [
      String(row.apartment_number ?? '').trim().toLowerCase(),
      String(row.section_code ?? '').trim().toLowerCase(),
      String(row.block_code ?? '').trim().toLowerCase(),
    ].join('\u0001');
    if (!scope.replace(/\u0001/g, '')) continue;
    if (seen.has(scope)) continue;
    const resolved = resolveMeterOpeningBalance(row);
    if (resolved.errors.length || resolved.kind == null) continue;
    seen.add(scope);
    if (resolved.kind === 'debt') debtTotal += resolved.amountAbs;
    else if (resolved.kind === 'overpayment') overpaymentTotal += resolved.amountAbs;
  }
  return { debtTotal, overpaymentTotal };
}

/** Entrance letter order: Latin A/B/C ↔ Cyrillic А/Б/В (same as Property Book). */
function meterEntranceSortKey(section: string): string {
  const s = String(section ?? '').trim();
  const map: Record<string, string> = {
    A: '01',
    a: '01',
    А: '01',
    а: '01',
    B: '02',
    b: '02',
    Б: '02',
    б: '02',
    C: '03',
    c: '03',
    В: '03',
    в: '03',
  };
  return map[s] ?? `99:${s.toLowerCase()}`;
}

/** Group meter rows by entrance (section) for the unified first-run preview. */
export function groupMeterPreviewRowsByEntrance(rows: Record<string, string>[]): Array<{
  key: string;
  sectionCode: string;
  rows: Array<{ row: Record<string, string>; index: number }>;
}> {
  const map = new Map<
    string,
    { key: string; sectionCode: string; rows: Array<{ row: Record<string, string>; index: number }> }
  >();
  rows.forEach((row, index) => {
    const sectionCode = String(row.section_code ?? '').trim();
    const key = sectionCode.toLowerCase() || '__plain__';
    let group = map.get(key);
    if (!group) {
      group = { key, sectionCode, rows: [] };
      map.set(key, group);
    }
    group.rows.push({ row, index });
  });
  return Array.from(map.values()).sort((a, b) => {
    if (!a.sectionCode && b.sectionCode) return 1;
    if (a.sectionCode && !b.sectionCode) return -1;
    return meterEntranceSortKey(a.sectionCode).localeCompare(meterEntranceSortKey(b.sectionCode));
  });
}

export type { OpeningBalanceKind };
