/**
 * IS-4 Support Fee opening commit safety.
 * Sequential import_support_fee_opening_state; per-row outcomes; no synthetic payments.
 */

import type { ImportPreviewResult } from '@/lib/moduleCore/types';
import {
  type ExistingSfObligationRef,
  type SupportFeeOpeningRpcPayload,
  supportFeeOpeningPayloadsFromPreview,
} from '@/lib/moduleCore/adapters/supportFeeOpening';

export const SF_COMMIT_OUTCOMES = [
  'CREATED',
  'SKIPPED_EXISTING',
  'CONFLICT',
  'FAILED',
  'NOT_PROCESSED',
] as const;

export type SfCommitOutcome = (typeof SF_COMMIT_OUTCOMES)[number];

export type SfCommitRowResult = {
  rowNumber: number;
  apartmentNumber: string;
  billingYear: number;
  propertyId: number;
  outcome: SfCommitOutcome;
  detail: string;
  attempted: boolean;
  remainingDue?: number;
  syntheticPayments: false;
};

export type SfCommitBatchResult = {
  rows: SfCommitRowResult[];
  createdCount: number;
  skippedExistingCount: number;
  conflictCount: number;
  failedCount: number;
  notProcessedCount: number;
  fullySuccessful: boolean;
  syntheticPayments: false;
  chargesGenerated: false;
  stoppedEarly: boolean;
};

export type ImportSfOpeningFn = (
  payload: SupportFeeOpeningRpcPayload & { idempotencyKey: string; batchId: string | null },
) => Promise<
  | { ok: true; outcome: 'CREATED' | 'SKIPPED_EXISTING'; remainingDue: number }
  | { ok: false; outcome: 'CONFLICT' | 'FAILED'; message: string }
>;

export function classifySfOpeningErrorMessage(message: string): 'CONFLICT' | 'FAILED' {
  const msg = message.toLowerCase();
  if (msg.includes('conflict') || msg.includes('23505') || msg.includes('duplicate')) {
    return 'CONFLICT';
  }
  return 'FAILED';
}

function summarize(rows: SfCommitRowResult[], stoppedEarly: boolean): SfCommitBatchResult {
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
    chargesGenerated: false,
    stoppedEarly,
  };
}

export async function commitSupportFeeOpeningBatch(args: {
  preview: ImportPreviewResult;
  importRow: ImportSfOpeningFn;
  batchId: string | null;
  /** Deterministic idempotency seed per row (e.g. batchId+rowNumber). */
  idempotencyKeyForRow: (rowNumber: number) => string;
}): Promise<SfCommitBatchResult> {
  const results: SfCommitRowResult[] = [];
  let stop = false;

  for (const row of args.preview.rows) {
    const apartmentNumber = String(row.data.apartment_number ?? '').trim();
    const billingYear = Number(row.data.billing_year);
    const propertyId = Number(row.data.resolved_property_id) || 0;

    if (row.operation === 'skip') {
      results.push({
        rowNumber: row.rowNumber,
        apartmentNumber,
        billingYear,
        propertyId,
        outcome: 'SKIPPED_EXISTING',
        detail: 'preview_identical_opening',
        attempted: false,
        syntheticPayments: false,
      });
      continue;
    }

    if (row.operation === 'error') {
      const isConflict = (row.data.preview_class ?? '') === 'CONFLICT' ||
        row.errors.some((e) => e.startsWith('conflict:'));
      results.push({
        rowNumber: row.rowNumber,
        apartmentNumber,
        billingYear,
        propertyId,
        outcome: isConflict ? 'CONFLICT' : 'FAILED',
        detail: row.errors.join('; ') || 'preview_error',
        attempted: false,
        syntheticPayments: false,
      });
      if (isConflict || row.errors.length) {
        // Conflicts do not stop the batch; hard validation FAILED in preview shouldn't be committed.
      }
      continue;
    }

    if (row.operation !== 'create') continue;

    if (stop) {
      results.push({
        rowNumber: row.rowNumber,
        apartmentNumber,
        billingYear,
        propertyId,
        outcome: 'NOT_PROCESSED',
        detail: 'stopped_after_prior_failure',
        attempted: false,
        syntheticPayments: false,
      });
      continue;
    }

    const payloads = supportFeeOpeningPayloadsFromPreview({
      ...args.preview,
      rows: [row],
    });
    const payload = payloads[0];
    if (!payload) {
      results.push({
        rowNumber: row.rowNumber,
        apartmentNumber,
        billingYear,
        propertyId,
        outcome: 'FAILED',
        detail: 'payload_build_failed',
        attempted: false,
        syntheticPayments: false,
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
        billingYear: payload.billingYear,
        propertyId: payload.propertyId,
        outcome: res.outcome,
        detail: res.outcome === 'CREATED' ? 'opening_rpc_ok' : 'opening_rpc_idempotent',
        attempted: true,
        remainingDue: res.remainingDue,
        syntheticPayments: false,
      });
      continue;
    }

    results.push({
      rowNumber: row.rowNumber,
      apartmentNumber,
      billingYear: payload.billingYear,
      propertyId: payload.propertyId,
      outcome: res.outcome,
      detail: res.message,
      attempted: true,
      syntheticPayments: false,
    });
    if (res.outcome === 'FAILED') stop = true;
    // CONFLICT continues — other apartments may still import
  }

  return summarize(results, stop);
}

export function reconcileSfCommitWithDb(
  batch: SfCommitBatchResult,
  obligations: ExistingSfObligationRef[],
): SfCommitBatchResult {
  const byScope = new Map(
    obligations.map((o) => [`${o.propertyId}|${o.billingYear}`, o] as const),
  );
  const rows = batch.rows.map((row) => {
    if (row.outcome === 'CREATED' || row.outcome === 'SKIPPED_EXISTING') return row;
    const existing = byScope.get(`${row.propertyId}|${row.billingYear}`);
    if (!existing) return row;
    if (existing.openingImport) {
      return {
        ...row,
        outcome: 'SKIPPED_EXISTING' as const,
        detail: 'reconcile_opening_present',
        remainingDue: existing.remainingDue,
      };
    }
    return {
      ...row,
      outcome: 'CONFLICT' as const,
      detail: 'reconcile_existing_obligation',
      remainingDue: existing.remainingDue,
    };
  });
  return summarize(rows, batch.stoppedEarly);
}

export function retryCandidatesFromSfBatch(batch: SfCommitBatchResult): number[] {
  return batch.rows
    .filter((r) => r.outcome === 'FAILED' || r.outcome === 'NOT_PROCESSED')
    .map((r) => r.rowNumber);
}

export function filterPreviewForSfRetry(
  preview: ImportPreviewResult,
  rowNumbers: number[],
): ImportPreviewResult {
  const allow = new Set(rowNumbers);
  const rows = preview.rows.filter(
    (r) => r.operation === 'create' && allow.has(r.rowNumber),
  );
  return {
    ...preview,
    rows,
    createCount: rows.length,
    updateCount: 0,
    skipCount: 0,
    errorCount: 0,
  };
}

export function mergeSfCommitBatches(
  prior: SfCommitBatchResult | null,
  next: SfCommitBatchResult,
): SfCommitBatchResult {
  if (!prior) return next;
  const byRow = new Map(prior.rows.map((r) => [r.rowNumber, r]));
  for (const r of next.rows) byRow.set(r.rowNumber, r);
  const rows = [...byRow.values()].sort((a, b) => a.rowNumber - b.rowNumber);
  return summarize(rows, next.stoppedEarly);
}

export function sfCommitAuditPayload(batch: SfCommitBatchResult): Record<string, unknown> {
  return {
    atomic_transaction: false,
    synthetic_payments: false,
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
      year: r.billingYear,
      outcome: r.outcome,
      detail: r.detail,
      remaining_due: r.remainingDue ?? null,
    })),
  };
}

/** D1: sum remaining_due from CREATED/SKIPPED opening rows. */
export function d1OutstandingFromSfCommit(batch: SfCommitBatchResult): number {
  let sum = 0;
  for (const r of batch.rows) {
    if (r.outcome !== 'CREATED' && r.outcome !== 'SKIPPED_EXISTING') continue;
    sum += Math.max(0, Number(r.remainingDue ?? 0));
  }
  return Math.round(sum * 100) / 100;
}
