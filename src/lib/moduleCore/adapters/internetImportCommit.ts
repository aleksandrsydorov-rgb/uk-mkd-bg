/**
 * IS-5 Internet opening commit safety.
 * Sequential import_internet_opening_state; per-row outcomes; no connect/payments/WOs.
 */

import type { ImportPreviewResult } from '@/lib/moduleCore/types';
import {
  type ExistingInternetSubRef,
  type InternetOpeningRpcPayload,
  internetOpeningPayloadsFromPreview,
} from '@/lib/moduleCore/adapters/internetOpening';

export const INTERNET_COMMIT_OUTCOMES = [
  'CREATED',
  'SKIPPED_EXISTING',
  'CONFLICT',
  'FAILED',
  'NOT_PROCESSED',
] as const;

export type InternetCommitOutcome = (typeof INTERNET_COMMIT_OUTCOMES)[number];

export type InternetCommitRowResult = {
  rowNumber: number;
  apartmentNumber: string;
  propertyId: number;
  outcome: InternetCommitOutcome;
  detail: string;
  attempted: boolean;
  nextChargeOn?: string | null;
  balanceEur?: number;
  syntheticPayments: false;
  workOrdersCreated: false;
};

export type InternetCommitBatchResult = {
  rows: InternetCommitRowResult[];
  createdCount: number;
  skippedExistingCount: number;
  conflictCount: number;
  failedCount: number;
  notProcessedCount: number;
  fullySuccessful: boolean;
  syntheticPayments: false;
  workOrdersCreated: false;
  chargesGenerated: false;
  stoppedEarly: boolean;
};

export type ImportInternetOpeningFn = (
  payload: InternetOpeningRpcPayload & { idempotencyKey: string; batchId: string | null },
) => Promise<
  | {
      ok: true;
      outcome: 'CREATED' | 'SKIPPED_EXISTING';
      nextChargeOn: string | null;
      balanceEur: number;
    }
  | { ok: false; outcome: 'CONFLICT' | 'FAILED'; message: string }
>;

export function classifyInternetOpeningErrorMessage(message: string): 'CONFLICT' | 'FAILED' {
  const msg = message.toLowerCase();
  if (
    msg.includes('conflict') ||
    msg.includes('23505') ||
    msg.includes('duplicate') ||
    msg.includes('pending internet work order')
  ) {
    return 'CONFLICT';
  }
  return 'FAILED';
}

function summarize(rows: InternetCommitRowResult[], stoppedEarly: boolean): InternetCommitBatchResult {
  const createdCount = rows.filter((r) => r.outcome === 'CREATED').length;
  const skippedExistingCount = rows.filter((r) => r.outcome === 'SKIPPED_EXISTING').length;
  const conflictCount = rows.filter((r) => r.outcome === 'CONFLICT').length;
  const failedCount = rows.filter((r) => r.outcome === 'FAILED').length;
  const notProcessedCount = rows.filter((r) => r.outcome === 'NOT_PROCESSED').length;
  const fullySuccessful =
    failedCount === 0 &&
    notProcessedCount === 0 &&
    conflictCount === 0 &&
    rows.every((r) => r.outcome === 'CREATED' || r.outcome === 'SKIPPED_EXISTING');
  return {
    rows,
    createdCount,
    skippedExistingCount,
    conflictCount,
    failedCount,
    notProcessedCount,
    fullySuccessful,
    syntheticPayments: false,
    workOrdersCreated: false,
    chargesGenerated: false,
    stoppedEarly,
  };
}

export async function commitInternetOpeningBatch(args: {
  preview: ImportPreviewResult;
  importRow: ImportInternetOpeningFn;
  batchId: string | null;
  idempotencyKeyForRow: (rowNumber: number) => string;
}): Promise<InternetCommitBatchResult> {
  const results: InternetCommitRowResult[] = [];
  let stop = false;

  for (const row of args.preview.rows) {
    const apartmentNumber = String(row.data.apartment_number ?? '').trim();
    const propertyId = Number(row.data.resolved_property_id) || 0;

    if (row.operation === 'skip') {
      results.push({
        rowNumber: row.rowNumber,
        apartmentNumber,
        propertyId,
        outcome: 'SKIPPED_EXISTING',
        detail: 'preview_identical_opening',
        attempted: false,
        syntheticPayments: false,
        workOrdersCreated: false,
      });
      continue;
    }

    if (row.operation === 'error') {
      const isConflict =
        (row.data.preview_class ?? '') === 'CONFLICT' ||
        row.errors.some((e) => e.startsWith('conflict:') || e.startsWith('blocked:'));
      results.push({
        rowNumber: row.rowNumber,
        apartmentNumber,
        propertyId,
        outcome: isConflict ? 'CONFLICT' : 'FAILED',
        detail: row.errors.join('; ') || 'preview_error',
        attempted: false,
        syntheticPayments: false,
        workOrdersCreated: false,
      });
      continue;
    }

    if (row.operation !== 'create') continue;

    if (stop) {
      results.push({
        rowNumber: row.rowNumber,
        apartmentNumber,
        propertyId,
        outcome: 'NOT_PROCESSED',
        detail: 'stopped_after_prior_failure',
        attempted: false,
        syntheticPayments: false,
        workOrdersCreated: false,
      });
      continue;
    }

    const payloads = internetOpeningPayloadsFromPreview({
      ...args.preview,
      rows: [row],
    });
    const payload = payloads[0];
    if (!payload) {
      results.push({
        rowNumber: row.rowNumber,
        apartmentNumber,
        propertyId,
        outcome: 'FAILED',
        detail: 'payload_build_failed',
        attempted: false,
        syntheticPayments: false,
        workOrdersCreated: false,
      });
      stop = true;
      continue;
    }

    const res = await args.importRow({
      ...payload,
      idempotencyKey: args.idempotencyKeyForRow(row.rowNumber),
      batchId: args.batchId,
    });

    if (res.ok) {
      results.push({
        rowNumber: row.rowNumber,
        apartmentNumber,
        propertyId: payload.propertyId,
        outcome: res.outcome,
        detail: res.outcome === 'CREATED' ? 'opening_rpc_ok' : 'opening_rpc_idempotent',
        attempted: true,
        nextChargeOn: res.nextChargeOn,
        balanceEur: res.balanceEur,
        syntheticPayments: false,
        workOrdersCreated: false,
      });
      continue;
    }

    results.push({
      rowNumber: row.rowNumber,
      apartmentNumber,
      propertyId: payload.propertyId,
      outcome: res.outcome,
      detail: res.message,
      attempted: true,
      syntheticPayments: false,
      workOrdersCreated: false,
    });
    if (res.outcome === 'FAILED') stop = true;
  }

  return summarize(results, stop);
}

export function reconcileInternetCommitWithDb(
  batch: InternetCommitBatchResult,
  subs: ExistingInternetSubRef[],
): InternetCommitBatchResult {
  const byProp = new Map(subs.map((s) => [s.propertyId, s] as const));
  const rows = batch.rows.map((row) => {
    if (row.outcome === 'CREATED' || row.outcome === 'SKIPPED_EXISTING') return row;
    const existing = byProp.get(row.propertyId);
    if (!existing) return row;
    if (existing.openingImport) {
      return {
        ...row,
        outcome: 'SKIPPED_EXISTING' as const,
        detail: 'reconcile_opening_present',
        nextChargeOn: existing.nextChargeOn,
      };
    }
    return {
      ...row,
      outcome: 'CONFLICT' as const,
      detail: 'reconcile_existing_subscription',
      nextChargeOn: existing.nextChargeOn,
    };
  });
  return summarize(rows, batch.stoppedEarly);
}

export function retryCandidatesFromInternetBatch(batch: InternetCommitBatchResult): number[] {
  return batch.rows
    .filter((r) => r.outcome === 'FAILED' || r.outcome === 'NOT_PROCESSED')
    .map((r) => r.rowNumber);
}

export function filterPreviewForInternetRetry(
  preview: ImportPreviewResult,
  rowNumbers: number[],
): ImportPreviewResult {
  const allow = new Set(rowNumbers);
  const rows = preview.rows.filter((r) => r.operation === 'create' && allow.has(r.rowNumber));
  return {
    ...preview,
    rows,
    createCount: rows.length,
    updateCount: 0,
    skipCount: 0,
    errorCount: 0,
  };
}

export function mergeInternetCommitBatches(
  prior: InternetCommitBatchResult | null,
  next: InternetCommitBatchResult,
): InternetCommitBatchResult {
  if (!prior) return next;
  const byRow = new Map(prior.rows.map((r) => [r.rowNumber, r]));
  for (const r of next.rows) byRow.set(r.rowNumber, r);
  const rows = [...byRow.values()].sort((a, b) => a.rowNumber - b.rowNumber);
  return summarize(rows, next.stoppedEarly);
}

export function internetCommitAuditPayload(
  batch: InternetCommitBatchResult,
): Record<string, unknown> {
  return {
    atomic_transaction: false,
    synthetic_payments: false,
    work_orders_created: false,
    charges_generated: false,
    fully_successful: batch.fullySuccessful,
    created: batch.createdCount,
    skipped: batch.skippedExistingCount,
    conflict: batch.conflictCount,
    failed: batch.failedCount,
    not_processed: batch.notProcessedCount,
    rows: batch.rows.map((r) => ({
      row: r.rowNumber,
      apt: r.apartmentNumber,
      outcome: r.outcome,
      detail: r.detail,
      next_charge_on: r.nextChargeOn ?? null,
      balance_eur: r.balanceEur ?? null,
    })),
  };
}
