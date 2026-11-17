/**
 * Client-side preview for internet opening import (first-run).
 * Money (signed balance) + connection clarify — SF-style entrance table.
 */

import type { FirstRunErrorRow } from '@/lib/firstRun';
import { presentFirstRunErrorRow } from '@/lib/firstRunUserMessage';

export type InetPreviewOutcome = 'create' | 'update' | 'skip' | 'defer' | 'error' | 'unknown';
export type InetPreviewBalanceKind = 'debt' | 'credit' | 'zero' | 'empty';

export type InetPreviewItem = {
  key: string;
  excelRow: number | null;
  apartment: string;
  sectionCode: string;
  blockCode: string;
  balanceKind: InetPreviewBalanceKind;
  remainingDebt: number | null;
  overpayment: number | null;
  connectionNeedsClarify: boolean;
  outcome: InetPreviewOutcome;
  outcomeLabel: string;
  errorText: string | null;
};

export type InetPreviewEntranceGroup = {
  key: string;
  sectionCode: string;
  items: InetPreviewItem[];
};

export type InetPreviewSummary = {
  rowCount: number;
  debtCount: number;
  creditCount: number;
  zeroCount: number;
  debtSum: number;
  creditSum: number;
  createCount: number;
  updateCount: number;
  skipCount: number;
  deferCount: number;
  errorCount: number;
  connectionClarifyCount: number;
  groups: InetPreviewEntranceGroup[];
  items: InetPreviewItem[];
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

function mapOutcome(raw: unknown): InetPreviewOutcome {
  const o = trim(raw).toUpperCase().replace(/-/g, '_');
  if (o === 'CREATE' || o === 'CREATED') return 'create';
  if (o === 'UPDATE' || o === 'CORRECT' || o === 'CORRECTED') return 'update';
  if (o === 'SKIP' || o === 'SKIPPED' || o === 'SKIPPED_EXISTING') return 'skip';
  if (o === 'DEFER' || o === 'DEFERRED' || o === 'NEEDS_INITIAL') return 'defer';
  if (o === 'ERROR' || o === 'FAILED' || o === 'CONFLICT') return 'error';
  return 'unknown';
}

function balanceFromRow(
  file: Record<string, string>,
  rpc?: Record<string, unknown>,
): { kind: InetPreviewBalanceKind; debt: number | null; credit: number | null } {
  const simple = trim(file._simple_kind);
  if (simple === 'debt') {
    const d = moneyOrNull(file.opening_debt) ?? 0;
    return { kind: 'debt', debt: d, credit: 0 };
  }
  if (simple === 'overpayment' || simple === 'credit') {
    const c = moneyOrNull(file.opening_credit) ?? 0;
    return { kind: 'credit', debt: 0, credit: c };
  }
  if (simple === 'zero') return { kind: 'zero', debt: 0, credit: 0 };
  if (file._amount_unknown === '1' || file._deferred === '1' && !trim(file.opening_debt) && !trim(file.opening_credit) && !simple) {
    // fall through — may still have debt/credit from detailed
  }

  const debt = moneyOrNull(rpc?.opening_debt ?? rpc?.debt ?? file.opening_debt);
  const credit = moneyOrNull(rpc?.opening_credit ?? rpc?.credit ?? file.opening_credit);
  if (debt == null && credit == null) return { kind: 'empty', debt: null, credit: null };
  const d = debt ?? 0;
  const c = credit ?? 0;
  if (d > 0.0001 && c <= 0.0001) return { kind: 'debt', debt: d, credit: c };
  if (c > 0.0001 && d <= 0.0001) return { kind: 'credit', debt: d, credit: c };
  if (d <= 0.0001 && c <= 0.0001) return { kind: 'zero', debt: 0, credit: 0 };
  // Both present (legacy): show debt as primary for count, keep both sums
  return { kind: 'debt', debt: d, credit: c };
}

function groupByEntrance(items: InetPreviewItem[]): InetPreviewEntranceGroup[] {
  const map = new Map<string, InetPreviewEntranceGroup>();
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
    group.items.sort((a, b) =>
      a.apartment.localeCompare(b.apartment, undefined, { numeric: true, sensitivity: 'base' }),
    );
  }
  return groups;
}

export function presentInetPreviewOutcome(outcome: InetPreviewOutcome, t: T): string {
  if (outcome === 'defer') return t('admin.firstRunInternetPreviewActionDefer');
  if (outcome === 'create') return t('admin.internetImportOutcomeWillCreate');
  if (outcome === 'update') return t('admin.internetImportOutcomeWillUpdate');
  if (outcome === 'skip') return t('admin.firstRunSfOutcomeSkip');
  if (outcome === 'error') return t('admin.internetImportOutcomeError');
  return t('admin.internetImportOutcomeUnknown');
}

export function buildInternetOpeningPreview(
  fileRows: Record<string, string>[],
  opts?: {
    rpcRows?: unknown[];
    errorRows?: FirstRunErrorRow[];
    excelRowOffset?: number;
    t: T;
  },
): InetPreviewSummary {
  const offset = opts?.excelRowOffset ?? 2;
  const t = opts?.t;
  if (!t) {
    return {
      rowCount: 0,
      debtCount: 0,
      creditCount: 0,
      zeroCount: 0,
      debtSum: 0,
      creditSum: 0,
      createCount: 0,
      updateCount: 0,
      skipCount: 0,
      deferCount: 0,
      errorCount: 0,
      connectionClarifyCount: 0,
      items: [],
      groups: [],
    };
  }

  const rpcByRow = new Map<number, Record<string, unknown>>();
  const rpcByApt = new Map<string, Record<string, unknown>>();
  for (const raw of opts?.rpcRows ?? []) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const o = raw as Record<string, unknown>;
    const rowN = Number(o.row);
    if (Number.isFinite(rowN) && rowN > 0) rpcByRow.set(rowN, o);
    const apt = trim(o.apartment_number);
    if (apt) rpcByApt.set(apt.toLowerCase(), o);
  }

  const errorsByRow = new Map<number, FirstRunErrorRow[]>();
  for (const err of opts?.errorRows ?? []) {
    const n = Number(err.row);
    if (Number.isFinite(n) && n > 0) {
      const list = errorsByRow.get(n) ?? [];
      list.push(err);
      errorsByRow.set(n, list);
    }
  }

  const items: InetPreviewItem[] = [];
  let debtCount = 0;
  let creditCount = 0;
  let zeroCount = 0;
  let debtSum = 0;
  let creditSum = 0;
  let createCount = 0;
  let updateCount = 0;
  let skipCount = 0;
  let deferCount = 0;
  let errorCount = 0;
  let connectionClarifyCount = 0;

  fileRows.forEach((file, idx) => {
    const excelRow = Number(file.rowNumber) || offset + idx;
    const apartment = trim(file.apartment_number);
    if (!apartment && !trim(file.section_code) && !trim(file.opening_balance_eur) && !trim(file.opening_debt)) {
      return;
    }

    const rpc =
      rpcByRow.get(excelRow) ?? (apartment ? rpcByApt.get(apartment.toLowerCase()) : undefined);

    const sectionCode = trim(rpc?.section_code ?? file.section_code);
    const blockCode = trim(rpc?.block_code ?? file.block_code);
    const stateRaw = trim(rpc?.status ?? rpc?.connection_state ?? file.connection_state);
    const bal = balanceFromRow(file, rpc);

    let outcome = mapOutcome(rpc?.outcome);
    if (outcome === 'unknown' && !rpc) {
      outcome = !stateRaw ? 'defer' : 'create';
    }
    if (outcome === 'unknown' && !stateRaw) outcome = 'defer';

    const rowErrs = errorsByRow.get(excelRow) ?? [];
    let errorText: string | null = null;
    if (rowErrs.length > 0) {
      outcome = 'error';
      errorText = rowErrs
        .map((e) => {
          const presented = presentFirstRunErrorRow(e, t, { nothingSaved: true });
          const parts: string[] = [];
          if (apartment) {
            parts.push(
              sectionCode
                ? t('admin.firstRunCrErrorAptSection', { apt: apartment, section: sectionCode })
                : t('admin.firstRunSfAptHeading', { apt: apartment }),
            );
          }
          if (e.row && e.row !== '—') parts.push(t('admin.firstRunSfErrorRow', { row: e.row }));
          if (presented.field && presented.field !== '—') {
            parts.push(t('admin.firstRunCrErrorColumn', { column: presented.field }));
          }
          parts.push(presented.reason);
          return parts.join(' · ');
        })
        .join(' · ');
    }

    const connectionNeedsClarify =
      !stateRaw ||
      outcome === 'defer' ||
      (Array.isArray(rpc?.warnings) &&
        rpc.warnings.some((w) => String(w).includes('needs_initial_internet_state')));

    if (bal.kind === 'debt') {
      debtCount += 1;
      debtSum += bal.debt ?? 0;
    } else if (bal.kind === 'credit') {
      creditCount += 1;
      creditSum += bal.credit ?? 0;
    } else if (bal.kind === 'zero') {
      zeroCount += 1;
    }
    if (bal.credit && bal.credit > 0 && bal.kind === 'debt') creditSum += bal.credit;

    if (outcome === 'create') createCount += 1;
    else if (outcome === 'update') updateCount += 1;
    else if (outcome === 'skip') skipCount += 1;
    else if (outcome === 'defer') deferCount += 1;
    else if (outcome === 'error') errorCount += 1;
    if (connectionNeedsClarify) connectionClarifyCount += 1;

    items.push({
      key: `${apartment}\u0001${sectionCode}\u0001${blockCode}\u0001${excelRow}`,
      excelRow,
      apartment,
      sectionCode,
      blockCode,
      balanceKind: bal.kind,
      remainingDebt: bal.debt,
      overpayment: bal.credit,
      connectionNeedsClarify,
      outcome,
      outcomeLabel: presentInetPreviewOutcome(outcome, t),
      errorText,
    });
  });

  return {
    rowCount: items.length,
    debtCount,
    creditCount,
    zeroCount,
    debtSum,
    creditSum,
    createCount,
    updateCount,
    skipCount,
    deferCount,
    errorCount,
    connectionClarifyCount,
    items,
    groups: groupByEntrance(items),
  };
}

export function formatInetAptHeading(item: Pick<InetPreviewItem, 'apartment' | 'blockCode'>, t: T): string {
  const apt = item.apartment || '—';
  if (item.blockCode) {
    return t('admin.firstRunSfAptWithBlock', { apt, block: item.blockCode });
  }
  return t('admin.firstRunSfAptHeading', { apt });
}

export function formatInetEntranceTitle(
  group: Pick<InetPreviewEntranceGroup, 'sectionCode' | 'items'>,
  t: T,
): string {
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
