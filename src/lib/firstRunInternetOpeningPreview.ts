/**
 * Client-side preview for internet opening import (first-run).
 * Reuses entrance grouping from meters/support-fee patterns.
 * Import rules stay in SQL — this only shapes the operator table.
 */

import type { FirstRunErrorRow } from '@/lib/firstRun';
import { presentFirstRunErrorRow } from '@/lib/firstRunUserMessage';
import {
  presentImportCommitOutcome,
  presentInternetConnectionState,
} from '@/lib/firstRunUserMessage';
import { formatSfAptHeading, formatSfEntranceTitle } from '@/lib/firstRunSupportFeePreview';

export type InetPreviewOutcome = 'create' | 'update' | 'skip' | 'defer' | 'error' | 'unknown';

export type InetPreviewItem = {
  key: string;
  excelRow: number | null;
  apartment: string;
  sectionCode: string;
  blockCode: string;
  connectionStateRaw: string;
  connectionStateLabel: string;
  connectionDate: string;
  paidPeriod: string;
  tariffOrPeriod: string;
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
  createCount: number;
  updateCount: number;
  skipCount: number;
  deferCount: number;
  errorCount: number;
  groups: InetPreviewEntranceGroup[];
  items: InetPreviewItem[];
};

type T = (key: string, params?: Record<string, string | number>) => string;

function trim(v: unknown): string {
  return v == null ? '' : String(v).trim();
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

function isExplicitInactive(raw: string): boolean {
  const v = raw.trim().toLowerCase();
  return (
    v === 'inactive' ||
    v === 'disconnected' ||
    v === 'не подключён' ||
    v === 'не подключен' ||
    v === 'не е свързан' ||
    v === 'not connected' ||
    v === 'off'
  );
}

/** Preview-facing connection label: empty → defer copy; inactive → «Не подключён». */
export function presentInternetPreviewConnectionState(raw: string, t: T): string {
  const v = trim(raw);
  if (!v) return t('admin.firstRunInternetPreviewStateEmpty');
  if (isExplicitInactive(v)) return t('admin.firstRunInternetPreviewStateInactive');
  if (v.toLowerCase() === 'active' || v === 'подключён' || v === 'подключен' || v === 'connected') {
    return presentInternetConnectionState('active', t);
  }
  return presentInternetConnectionState(v, t);
}

export function presentInetPreviewOutcome(outcome: InetPreviewOutcome, t: T): string {
  if (outcome === 'defer') return t('admin.firstRunInternetPreviewStateEmpty');
  if (outcome === 'create') return t('admin.internetImportOutcomeWillCreate');
  if (outcome === 'update') return t('admin.internetImportOutcomeWillUpdate');
  if (outcome === 'skip') return t('admin.internetImportOutcomeWillSkip');
  if (outcome === 'error') return t('admin.internetImportOutcomeError');
  return t('admin.internetImportOutcomeUnknown');
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

function paidPeriodLabel(rpc: Record<string, unknown> | undefined, file: Record<string, string>): string {
  const start = trim(rpc?.paid_period_start ?? file.paid_period_start);
  const end = trim(rpc?.paid_period_end ?? rpc?.paid_through ?? file.paid_period_end);
  if (start && end) return `${start} → ${end}`;
  if (end) return end;
  if (start) return start;
  return '—';
}

/**
 * Build internet opening preview from file rows + RPC dry-run rows.
 * Prefer RPC identity; fill section/block from file when RPC omits them.
 */
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
      createCount: 0,
      updateCount: 0,
      skipCount: 0,
      deferCount: 0,
      errorCount: 0,
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
  let createCount = 0;
  let updateCount = 0;
  let skipCount = 0;
  let deferCount = 0;
  let errorCount = 0;

  fileRows.forEach((file, idx) => {
    const excelRow = offset + idx;
    const apartment = trim(file.apartment_number);
    if (!apartment && !trim(file.section_code) && !trim(file.connection_state)) return;

    const rpc =
      rpcByRow.get(excelRow) ?? (apartment ? rpcByApt.get(apartment.toLowerCase()) : undefined);

    const sectionCode = trim(rpc?.section_code ?? file.section_code);
    const blockCode = trim(rpc?.block_code ?? file.block_code);
    const stateRaw = trim(rpc?.status ?? rpc?.connection_state ?? file.connection_state);
    const connectionDate = trim(rpc?.connection_date ?? file.connection_date) || '—';
    const paidPeriod = paidPeriodLabel(rpc, file);
    const tariffOrPeriod = paidPeriod !== '—' ? paidPeriod : '—';

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

    if (outcome === 'create') createCount += 1;
    else if (outcome === 'update') updateCount += 1;
    else if (outcome === 'skip') skipCount += 1;
    else if (outcome === 'defer') deferCount += 1;
    else if (outcome === 'error') errorCount += 1;

    const connectionStateLabel =
      outcome === 'defer' || !stateRaw
        ? t('admin.firstRunInternetPreviewStateEmpty')
        : presentInternetPreviewConnectionState(stateRaw, t);

    items.push({
      key: `${apartment}\u0001${sectionCode}\u0001${blockCode}\u0001${excelRow}`,
      excelRow,
      apartment,
      sectionCode,
      blockCode,
      connectionStateRaw: stateRaw,
      connectionStateLabel,
      connectionDate,
      paidPeriod,
      tariffOrPeriod,
      outcome,
      outcomeLabel: presentInetPreviewOutcome(outcome, t),
      errorText,
    });
  });

  return {
    rowCount: items.length,
    createCount,
    updateCount,
    skipCount,
    deferCount,
    errorCount,
    items,
    groups: groupByEntrance(items),
  };
}

export { formatSfAptHeading as formatInetAptHeading, formatSfEntranceTitle as formatInetEntranceTitle };

/** Fallback outcome label via shared dictionary (committed path). */
export function presentInetRpcOutcome(raw: string, t: T, committed?: boolean): string {
  const mapped = mapOutcome(raw);
  if (mapped === 'defer') return t('admin.firstRunInternetPreviewStateEmpty');
  return presentImportCommitOutcome(raw, t, { committed });
}
