/**
 * Client-side preview for capital-repair opening import (first-run).
 * Reuses support-fee grouping / balance / outcome helpers.
 * Import/billing rules stay in SQL — this only shapes the operator table.
 */

import type { FirstRunErrorRow } from '@/lib/firstRun';
import { presentFirstRunErrorRow, presentImportSheet } from '@/lib/firstRunUserMessage';
import {
  formatSfAptHeading,
  formatSfBalanceLabel,
  formatSfEntranceTitle,
  presentSfOutcome,
  type SfPreviewBalanceKind,
  type SfPreviewEntranceGroup,
  type SfPreviewOutcome,
} from '@/lib/firstRunSupportFeePreview';

export type CrPreviewItem = {
  key: string;
  excelRow: number | null;
  apartment: string;
  sectionCode: string;
  blockCode: string;
  billingYear: string;
  assessmentTitle: string;
  assessed: number | null;
  paid: number | null;
  remainingDebt: number | null;
  overpayment: number | null;
  balanceKind: SfPreviewBalanceKind;
  outcome: SfPreviewOutcome;
  errorText: string | null;
};

export type CrPreviewEntranceGroup = {
  key: string;
  sectionCode: string;
  items: CrPreviewItem[];
};

export type CrPreviewSummary = {
  rowCount: number;
  debtCount: number;
  creditCount: number;
  zeroCount: number;
  debtSum: number;
  creditSum: number;
  createCount: number;
  skipCount: number;
  deferCount: number;
  errorCount: number;
  groups: CrPreviewEntranceGroup[];
  items: CrPreviewItem[];
};

type T = (key: string, params?: Record<string, string | number>) => string;

function trim(v: unknown): string {
  return v == null ? '' : String(v).trim();
}

function moneyOrNull(raw: unknown): number | null {
  const s = trim(raw).replace(',', '.');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

function balanceKind(
  remaining: number | null,
  over: number | null,
  amountsBlank: boolean,
  simpleKind: string,
): SfPreviewBalanceKind {
  if (simpleKind === 'debt') return 'debt';
  if (simpleKind === 'overpayment' || simpleKind === 'credit') return 'credit';
  if (simpleKind === 'zero') return 'zero';
  if (amountsBlank || simpleKind === '') return 'empty';
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

function identityKey(
  apartment: string,
  section: string,
  block: string,
  year: string,
  title: string,
): string {
  return [apartment, section, block, year, title]
    .map((s) => s.toLowerCase())
    .join('\u0001');
}

function groupByEntrance(items: CrPreviewItem[]): CrPreviewEntranceGroup[] {
  const map = new Map<string, CrPreviewEntranceGroup>();
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
      const apt = a.apartment.localeCompare(b.apartment, undefined, {
        numeric: true,
        sensitivity: 'base',
      });
      if (apt !== 0) return apt;
      const year = a.billingYear.localeCompare(b.billingYear, undefined, { numeric: true });
      if (year !== 0) return year;
      const title = a.assessmentTitle.localeCompare(b.assessmentTitle, undefined, {
        sensitivity: 'base',
      });
      if (title !== 0) return title;
      return (a.blockCode || '').localeCompare(b.blockCode || '', 'en', { sensitivity: 'base' });
    });
  }
  return groups;
}

export {
  formatSfAptHeading as formatCrAptHeading,
  formatSfBalanceLabel as formatCrBalanceLabel,
  formatSfEntranceTitle as formatCrEntranceTitle,
  presentSfOutcome as presentCrOutcome,
};

export type { SfPreviewBalanceKind as CrPreviewBalanceKind, SfPreviewOutcome as CrPreviewOutcome };
export type { SfPreviewEntranceGroup };

/**
 * Build CR opening preview from parsed XLSX rows + optional RPC dry-run outcomes.
 * excelRowOffset: header on row 1 → first data row = 2.
 */
export function buildCapitalRepairOpeningPreview(
  rows: Record<string, string>[],
  opts?: {
    rpcRows?: unknown[];
    errorRows?: FirstRunErrorRow[];
    excelRowOffset?: number;
    t?: T;
  },
): CrPreviewSummary {
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
  for (const err of opts?.errorRows ?? []) {
    const n = Number(err.row);
    if (Number.isFinite(n) && n > 0) {
      const list = errorsByRow.get(n) ?? [];
      list.push(err);
      errorsByRow.set(n, list);
    }
    const apt = trim(err.apartment);
    if (apt) {
      const list = errorsByApt.get(apt.toLowerCase()) ?? [];
      list.push(err);
      errorsByApt.set(apt.toLowerCase(), list);
    }
  }

  const items: CrPreviewItem[] = [];
  let debtCount = 0;
  let creditCount = 0;
  let zeroCount = 0;
  let debtSum = 0;
  let creditSum = 0;
  let createCount = 0;
  let skipCount = 0;
  let deferCount = 0;
  let errorCount = 0;

  rows.forEach((row, idx) => {
    const excelRow = Number(row.rowNumber) || offset + idx;
    const apartment = trim(row.apartment_number);
    const sectionCode = trim(row.section_code);
    const blockCode = trim(row.block_code);
    const billingYear = trim(row.billing_year);
    const assessmentTitle = trim(row.assessment_title);
    const assessed = moneyOrNull(row.assessed_amount);
    const paid = moneyOrNull(row.historically_paid_amount);
    const remainingDebt = moneyOrNull(row.remaining_debt);
    const overpayment = moneyOrNull(row.opening_overpayment);
    const simpleKind = trim(row._simple_kind);
    const deferredFlag = trim(row._deferred) === '1';
    const amountsBlank =
      assessed == null &&
      paid == null &&
      remainingDebt == null &&
      overpayment == null &&
      !simpleKind;
    if (
      !apartment &&
      !sectionCode &&
      !blockCode &&
      !billingYear &&
      !assessmentTitle &&
      amountsBlank &&
      !trim(row.transition_date) &&
      !trim(row.source_reference) &&
      !trim(row.notes) &&
      !deferredFlag
    ) {
      return;
    }
    const kind = balanceKind(remainingDebt, overpayment, amountsBlank || deferredFlag, simpleKind);

    const rpc =
      rpcByRow.get(excelRow) ??
      (apartment && billingYear
        ? rpcByAptYear.get(`${apartment.toLowerCase()}\u0001${billingYear}`)
        : undefined);

    let outcome = mapOutcome(rpc?.outcome);
    if (deferredFlag && outcome === 'unknown') outcome = 'defer';

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
      return true;
    });

    let errorText: string | null = null;
    if (uniqueErrs.length > 0) {
      outcome = 'error';
      if (t) {
        errorText = uniqueErrs
          .map((e) => {
            const presented = presentFirstRunErrorRow(e, t, { nothingSaved: true });
            const parts: string[] = [];
            const sheetLabel = presentImportSheet(e.sheet || 'Начальные остатки', e.field || '', t);
            if (sheetLabel && sheetLabel !== '—') {
              parts.push(t('admin.firstRunSfErrorSheet', { sheet: sheetLabel }));
            }
            if (e.row && e.row !== '—') {
              parts.push(t('admin.firstRunSfErrorRow', { row: e.row }));
            }
            if (presented.field && presented.field !== '—') {
              parts.push(t('admin.firstRunCrErrorColumn', { column: presented.field }));
            }
            parts.push(presented.reason);
            return parts.join(' · ');
          })
          .join(' · ');
      } else {
        errorText = uniqueErrs.map((e) => e.reason).join(' · ');
      }
    } else if (outcome === 'unknown' && !rpc) {
      outcome = deferredFlag || kind === 'empty' ? 'defer' : 'create';
    }

    if (kind === 'debt') {
      debtCount += 1;
      debtSum += remainingDebt ?? 0;
    } else if (kind === 'credit') {
      creditCount += 1;
      creditSum += overpayment ?? 0;
    } else if (kind === 'zero') {
      zeroCount += 1;
    }
    if (outcome === 'create') createCount += 1;
    else if (outcome === 'skip') skipCount += 1;
    else if (outcome === 'defer') deferCount += 1;
    else if (outcome === 'error') errorCount += 1;

    items.push({
      key:
        identityKey(apartment, sectionCode, blockCode, billingYear, assessmentTitle) +
        `\u0001${excelRow}`,
      excelRow,
      apartment,
      sectionCode,
      blockCode,
      billingYear,
      assessmentTitle,
      assessed,
      paid,
      remainingDebt,
      overpayment,
      balanceKind: kind,
      outcome,
      errorText,
    });
  });

  return {
    rowCount: items.length,
    debtCount,
    creditCount,
    zeroCount,
    debtSum: Math.round(debtSum * 100) / 100,
    creditSum: Math.round(creditSum * 100) / 100,
    createCount,
    skipCount,
    deferCount,
    errorCount,
    items,
    groups: groupByEntrance(items),
  };
}
