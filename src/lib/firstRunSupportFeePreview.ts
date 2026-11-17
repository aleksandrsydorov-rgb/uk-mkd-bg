/**
 * Client-side preview for support-fee opening import (first-run).
 * Import/billing rules stay in SQL; this only shapes the operator table.
 */

import { formatMeterMoney } from '@/lib/firstRunMetersPreview';
import type { FirstRunErrorRow } from '@/lib/firstRun';
import { presentFirstRunErrorRow, presentImportField } from '@/lib/firstRunUserMessage';

export type SfPreviewOutcome = 'create' | 'skip' | 'defer' | 'error' | 'unknown';

export type SfPreviewBalanceKind = 'debt' | 'credit' | 'zero' | 'empty';

export type SfPreviewItem = {
  key: string;
  excelRow: number | null;
  apartment: string;
  sectionCode: string;
  blockCode: string;
  billingYear: string;
  assessed: number | null;
  paid: number | null;
  remainingDebt: number | null;
  overpayment: number | null;
  balanceKind: SfPreviewBalanceKind;
  outcome: SfPreviewOutcome;
  errorText: string | null;
};

export type SfPreviewEntranceGroup = {
  key: string;
  sectionCode: string;
  items: SfPreviewItem[];
};

export type SfPreviewSummary = {
  rowCount: number;
  debtCount: number;
  creditCount: number;
  zeroCount: number;
  deferCount: number;
  debtSum: number;
  creditSum: number;
  createCount: number;
  skipCount: number;
  errorCount: number;
  /** Ready = create + skip (non-error, non-defer). */
  readyCount: number;
  fileLevelErrors: string[];
  groups: SfPreviewEntranceGroup[];
  items: SfPreviewItem[];
};

type T = (key: string, params?: Record<string, string | number>) => string;

function trim(v: unknown): string {
  return v == null ? '' : String(v).trim();
}

/** Parse money; empty → null (do not substitute 0). */
function moneyOrNull(raw: unknown): number | null {
  const s = trim(raw).replace(',', '.');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

function balanceKindFromSimple(raw: string): SfPreviewBalanceKind | null {
  const v = trim(raw).toLowerCase();
  if (!v) return 'empty';
  if (v === 'debt') return 'debt';
  if (v === 'overpayment' || v === 'credit') return 'credit';
  if (v === 'zero') return 'zero';
  if (v === 'invalid') return 'empty';
  return null;
}

function balanceKind(
  remaining: number | null,
  over: number | null,
  amountsBlank: boolean,
): SfPreviewBalanceKind {
  if (amountsBlank) return 'empty';
  const rem = remaining ?? 0;
  const ov = over ?? 0;
  if (rem > 0.0001) return 'debt';
  if (ov > 0.0001) return 'credit';
  return 'zero';
}

function mapOutcome(raw: unknown): SfPreviewOutcome {
  const o = trim(raw).toUpperCase();
  if (o === 'CREATE' || o === 'CREATED') return 'create';
  if (o === 'SKIP' || o === 'SKIPPED' || o === 'SKIPPED_EXISTING') return 'skip';
  if (o === 'DEFER' || o === 'DEFERRED' || o === 'NEEDS_INITIAL') return 'defer';
  if (o === 'ERROR' || o === 'FAILED' || o === 'CONFLICT') return 'error';
  return 'unknown';
}

function identityKey(apartment: string, section: string, block: string, year: string): string {
  return [apartment.toLowerCase(), section.toLowerCase(), block.toLowerCase(), year].join('\u0001');
}

function formatInlineError(e: FirstRunErrorRow, t: T): string {
  const presented = presentFirstRunErrorRow(e, t, { nothingSaved: true });
  const sheet = trim(e.sheet);
  const sheetLabel = sheet
    ? t('admin.firstRunSfErrorSheet', { sheet: presented.sheet || sheet })
    : '';
  const rowPart =
    e.row && e.row !== '—' && e.row !== '0'
      ? t('admin.firstRunSfErrorRow', { row: e.row })
      : '';
  const fieldPart =
    e.field && e.field !== '—'
      ? t('admin.firstRunSfErrorColumn', { column: presentImportField(e.field, t) })
      : '';
  const where = [sheetLabel, rowPart, fieldPart].filter(Boolean).join(', ');
  return where ? `${presented.reason} (${where})` : presented.reason;
}

export function formatSfBalanceLabel(
  item: Pick<SfPreviewItem, 'balanceKind' | 'remainingDebt' | 'overpayment'>,
  t: T,
  locale: string,
): string {
  if (item.balanceKind === 'empty') {
    return t('admin.firstRunSfBalanceEmpty');
  }
  if (item.balanceKind === 'debt') {
    return t('admin.firstRunSfBalanceDebt', {
      amount: formatMeterMoney(item.remainingDebt ?? 0, locale),
    });
  }
  if (item.balanceKind === 'credit') {
    return t('admin.firstRunSfBalanceCredit', {
      amount: formatMeterMoney(item.overpayment ?? 0, locale),
    });
  }
  return t('admin.firstRunSfBalanceZero', { amount: formatMeterMoney(0, locale) });
}

export function presentSfOutcome(outcome: SfPreviewOutcome, t: T): string {
  if (outcome === 'create') return t('admin.firstRunSfOutcomeCreate');
  if (outcome === 'skip') return t('admin.firstRunSfOutcomeSkip');
  if (outcome === 'defer') return t('admin.firstRunSfOutcomeDefer');
  if (outcome === 'error') return t('admin.firstRunSfOutcomeError');
  return t('admin.firstRunSfOutcomeUnknown');
}

export function formatSfAptHeading(item: SfPreviewItem, t: T): string {
  const apt = item.apartment || '—';
  if (item.blockCode) {
    return t('admin.firstRunSfAptWithBlock', { apt, block: item.blockCode });
  }
  return t('admin.firstRunSfAptHeading', { apt });
}

export function formatSfEntranceTitle(group: SfPreviewEntranceGroup, t: T): string {
  const n = group.items.length;
  const abs = Math.abs(Math.trunc(n));
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  let form: 'one' | 'few' | 'many' = 'many';
  if (mod10 === 1 && mod100 !== 11) form = 'one';
  else if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) form = 'few';
  const countLabel = t(`admin.bookPreviewEntranceAptCount_${form}`, { n: abs });
  const section = (group.sectionCode || '').trim();
  if (!section) return t('admin.bookPreviewEntranceGroupPlain', { countLabel });
  return t('admin.bookPreviewEntranceGroup', { section, countLabel });
}

function groupByEntrance(items: SfPreviewItem[]): SfPreviewEntranceGroup[] {
  const map = new Map<string, SfPreviewEntranceGroup>();
  for (const item of items) {
    const section = (item.sectionCode || '').trim();
    const key = section ? section.toLowerCase() : '\u0000';
    let group = map.get(key);
    if (!group) {
      group = { key, sectionCode: section, items: [] };
      map.set(key, group);
    }
    group.items.push(item);
  }
  const groups = [...map.values()].sort((a, b) => {
    if (!a.sectionCode && b.sectionCode) return 1;
    if (a.sectionCode && !b.sectionCode) return -1;
    return a.sectionCode.localeCompare(b.sectionCode, 'en', { sensitivity: 'base' });
  });
  for (const group of groups) {
    group.items.sort((a, b) => {
      const rowA = a.excelRow ?? 0;
      const rowB = b.excelRow ?? 0;
      if (rowA !== rowB && rowA > 0 && rowB > 0) return rowA - rowB;
      const apt = a.apartment.localeCompare(b.apartment, undefined, {
        numeric: true,
        sensitivity: 'base',
      });
      if (apt !== 0) return apt;
      const year = a.billingYear.localeCompare(b.billingYear, undefined, { numeric: true });
      if (year !== 0) return year;
      return (a.blockCode || '').localeCompare(b.blockCode || '', 'en', { sensitivity: 'base' });
    });
  }
  return groups;
}

function resolveExcelRow(row: Record<string, string>, fallback: number): number {
  const n = Number(row.rowNumber ?? row.row ?? fallback);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Build preview from parsed XLSX rows + optional RPC dry-run row outcomes + error rows.
 * excelRowOffset: header on row 1 → first data row = 2.
 */
export function buildSupportFeeOpeningPreview(
  rows: Record<string, string>[],
  opts?: {
    rpcRows?: unknown[];
    errorRows?: FirstRunErrorRow[];
    excelRowOffset?: number;
    t?: T;
  },
): SfPreviewSummary {
  const offset = opts?.excelRowOffset ?? 2;
  const t = opts?.t;
  const rpcByRow = new Map<number, Record<string, unknown>>();
  const rpcByAptYear = new Map<string, Record<string, unknown>>();
  for (const raw of opts?.rpcRows ?? []) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const o = raw as Record<string, unknown>;
    const rowN = Number(o.row);
    if (Number.isFinite(rowN) && rowN > 0) rpcByRow.set(rowN, o);
    const apt = trim(o.apartment_number);
    const year = trim(o.billing_year);
    if (apt && year) rpcByAptYear.set(`${apt.toLowerCase()}\u0001${year}`, o);
  }

  const errorsByRow = new Map<number, FirstRunErrorRow[]>();
  const errorsByApt = new Map<string, FirstRunErrorRow[]>();
  const fileLevelErrors: string[] = [];
  const consumedErrorKeys = new Set<string>();

  for (const err of opts?.errorRows ?? []) {
    const n = Number(err.row);
    const isFileLevel = !Number.isFinite(n) || n <= 0;
    if (isFileLevel) {
      if (t) fileLevelErrors.push(formatInlineError(err, t));
      else fileLevelErrors.push(err.reason);
      consumedErrorKeys.add(`${err.row}|${err.reason}|${err.field}|${err.apartment}`);
      continue;
    }
    const list = errorsByRow.get(n) ?? [];
    list.push(err);
    errorsByRow.set(n, list);
    const apt = trim(err.apartment);
    if (apt) {
      const aptList = errorsByApt.get(apt.toLowerCase()) ?? [];
      aptList.push(err);
      errorsByApt.set(apt.toLowerCase(), aptList);
    }
  }

  const items: SfPreviewItem[] = [];
  let debtCount = 0;
  let creditCount = 0;
  let zeroCount = 0;
  let deferCount = 0;
  let debtSum = 0;
  let creditSum = 0;
  let createCount = 0;
  let skipCount = 0;
  let errorCount = 0;
  const seenExcelRows = new Set<number>();

  rows.forEach((row, idx) => {
    const excelRow = resolveExcelRow(row, offset + idx);
    seenExcelRows.add(excelRow);
    const apartment = trim(row.apartment_number);
    const sectionCode = trim(row.section_code);
    const blockCode = trim(row.block_code);
    const billingYear = trim(row.billing_year);
    const assessed = moneyOrNull(row.assessed_amount);
    const paid = moneyOrNull(row.historically_paid_amount);
    const remainingDebt = moneyOrNull(row.remaining_debt);
    const overpayment = moneyOrNull(row.opening_overpayment);
    const amountsBlank =
      assessed == null && paid == null && remainingDebt == null && overpayment == null;
    // Skip fully blank Excel rows in the preview table.
    if (
      !apartment &&
      !sectionCode &&
      !blockCode &&
      !billingYear &&
      amountsBlank &&
      !trim(row.transition_date) &&
      !trim(row.source_reference) &&
      !trim(row.notes) &&
      !trim(row._simple_kind) &&
      !trim(row.opening_balance_kind) &&
      !trim(row.opening_balance_eur)
    ) {
      return;
    }

    const simpleKind = balanceKindFromSimple(row._simple_kind);
    const kind =
      simpleKind != null
        ? simpleKind
        : balanceKind(remainingDebt, overpayment, amountsBlank);

    const rpc =
      rpcByRow.get(excelRow) ??
      (apartment && billingYear
        ? rpcByAptYear.get(`${apartment.toLowerCase()}\u0001${billingYear}`)
        : undefined);

    let outcome = mapOutcome(rpc?.outcome);
    const rowErrs = [
      ...(errorsByRow.get(excelRow) ?? []),
      ...((apartment ? errorsByApt.get(apartment.toLowerCase()) : undefined) ?? []).filter(
        (e) => !Number(e.row) || Number(e.row) === excelRow,
      ),
    ];
    const seen = new Set<string>();
    const uniqueErrs = rowErrs.filter((e) => {
      const k = `${e.row}|${e.reason}|${e.field}`;
      if (seen.has(k)) return false;
      seen.add(k);
      consumedErrorKeys.add(`${e.row}|${e.reason}|${e.field}|${e.apartment}`);
      return true;
    });

    let errorText: string | null = null;
    if (uniqueErrs.length > 0 || trim(row._client_invalid) === '1') {
      outcome = 'error';
      if (t && uniqueErrs.length > 0) {
        errorText = uniqueErrs.map((e) => formatInlineError(e, t)).join(' · ');
      } else if (uniqueErrs.length > 0) {
        errorText = uniqueErrs.map((e) => e.reason).join(' · ');
      } else {
        errorText = t ? t('admin.firstRunImportRowCheckFailed') : 'error';
      }
    } else if (outcome === 'unknown' && !rpc) {
      outcome = amountsBlank && apartment && kind === 'empty' ? 'defer' : 'create';
    }

    // For simple debt/credit, display amount from mapped remaining/over.
    const displayRemaining =
      kind === 'debt' ? remainingDebt ?? (simpleKind === 'debt' ? remainingDebt : null) : remainingDebt;
    const displayOver =
      kind === 'credit' ? overpayment ?? null : overpayment;

    if (kind === 'debt') {
      debtCount += 1;
      debtSum += displayRemaining ?? 0;
    } else if (kind === 'credit') {
      creditCount += 1;
      creditSum += displayOver ?? 0;
    } else if (kind === 'zero') {
      zeroCount += 1;
    }
    if (outcome === 'create') createCount += 1;
    else if (outcome === 'skip') skipCount += 1;
    else if (outcome === 'defer') deferCount += 1;
    else if (outcome === 'error') errorCount += 1;

    items.push({
      key: identityKey(apartment, sectionCode, blockCode, billingYear) + `\u0001${excelRow}`,
      excelRow,
      apartment,
      sectionCode,
      blockCode,
      billingYear,
      assessed,
      paid,
      remainingDebt: displayRemaining,
      overpayment: displayOver,
      balanceKind: kind,
      outcome,
      errorText,
    });
  });

  // Orphan errors (e.g. unmapped apartment) — still show once by Excel row.
  for (const err of opts?.errorRows ?? []) {
    const k = `${err.row}|${err.reason}|${err.field}|${err.apartment}`;
    if (consumedErrorKeys.has(k)) continue;
    const n = Number(err.row);
    if (!Number.isFinite(n) || n <= 0) continue;
    if (seenExcelRows.has(n)) continue;
    errorCount += 1;
    items.push({
      key: `orphan\u0001${n}\u0001${err.field}\u0001${err.reason}`,
      excelRow: n,
      apartment: trim(err.apartment) || '—',
      sectionCode: err.meta?.sectionCode ?? '',
      blockCode: err.meta?.blockCode ?? '',
      billingYear: '',
      assessed: null,
      paid: null,
      remainingDebt: null,
      overpayment: null,
      balanceKind: 'empty',
      outcome: 'error',
      errorText: t ? formatInlineError(err, t) : err.reason,
    });
  }

  const readyCount = createCount + skipCount;

  return {
    rowCount: items.length,
    debtCount,
    creditCount,
    zeroCount,
    deferCount,
    debtSum: Math.round(debtSum * 100) / 100,
    creditSum: Math.round(creditSum * 100) / 100,
    createCount,
    skipCount,
    errorCount,
    readyCount,
    fileLevelErrors,
    items,
    groups: groupByEntrance(items),
  };
}
