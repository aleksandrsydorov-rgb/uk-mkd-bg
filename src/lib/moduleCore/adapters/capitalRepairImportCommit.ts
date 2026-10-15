/**
 * IS-8 Capital Repair opening commit safety.
 * Sequential import_capital_repair_opening_state; per-row outcomes; no synthetic payments/charges.
 */

import type { ImportPreviewResult } from '@/lib/moduleCore/types';
import {
  type CapitalRepairOpeningRpcPayload,
  capitalRepairOpeningPayloadsFromPreview,
} from '@/lib/moduleCore/adapters/capitalRepairOpening';

export const CR_COMMIT_OUTCOMES = [
  'CREATED',
  'SKIPPED_EXISTING',
  'CONFLICT',
  'FAILED',
  'NOT_PROCESSED',
] as const;

export type CrCommitOutcome = (typeof CR_COMMIT_OUTCOMES)[number];

export type CrCommitRowResult = {
  rowNumber: number;
  apartmentNumber: string;
  billingYear: number;
  propertyId: number;
  outcome: CrCommitOutcome;
  detail: string;
  attempted: boolean;
  remainingDebt?: number;
  assessmentId?: string;
  syntheticPayments: false;
  operationalCharges: false;
};

export type CrCommitBatchResult = {
  rows: CrCommitRowResult[];
  createdCount: number;
  skippedExistingCount: number;
  conflictCount: number;
  failedCount: number;
  notProcessedCount: number;
  fullySuccessful: boolean;
  syntheticPayments: false;
  operationalCharges: false;
  stoppedEarly: boolean;
};

export type ImportCrOpeningFn = (
  payload: CapitalRepairOpeningRpcPayload & { idempotencyKey: string; batchId: string | null },
) => Promise<
  | {
      ok: true;
      outcome: 'CREATED' | 'SKIPPED_EXISTING';
      remainingDebt: number;
      assessmentId?: string;
    }
  | { ok: false; outcome: 'CONFLICT' | 'FAILED'; message: string }
>;

export function classifyCrOpeningErrorMessage(message: string): 'CONFLICT' | 'FAILED' {
  const msg = message.toLowerCase();
  if (msg.includes('conflict') || msg.includes('23505') || msg.includes('duplicate')) {
    return 'CONFLICT';
  }
  return 'FAILED';
}

function summarize(rows: CrCommitRowResult[], stoppedEarly: boolean): CrCommitBatchResult {
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
    operationalCharges: false,
    stoppedEarly,
  };
}

export async function commitCapitalRepairOpeningBatch(args: {
  preview: ImportPreviewResult;
  importRow: ImportCrOpeningFn;
  batchId: string | null;
  idempotencyKeyForRow: (rowNumber: number) => string;
}): Promise<CrCommitBatchResult> {
  const results: CrCommitRowResult[] = [];
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
        operationalCharges: false,
      });
      continue;
    }

    if (row.operation === 'error') {
      const isConflict =
        (row.data.preview_class ?? '') === 'CONFLICT' ||
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
        operationalCharges: false,
      });
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
        operationalCharges: false,
      });
      continue;
    }

    const payloads = capitalRepairOpeningPayloadsFromPreview({
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
        operationalCharges: false,
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
        remainingDebt: res.remainingDebt,
        assessmentId: res.assessmentId,
        syntheticPayments: false,
        operationalCharges: false,
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
      operationalCharges: false,
    });
    if (res.outcome === 'FAILED') stop = true;
  }

  return summarize(results, stop);
}

export type CrOpeningImportRef = {
  propertyId: number;
  billingYear: number;
  remainingDebt: number;
  assessmentId: string;
};

export function reconcileCrCommitWithDb(
  batch: CrCommitBatchResult,
  imports: CrOpeningImportRef[],
): CrCommitBatchResult {
  const byScope = new Map(
    imports.map((o) => [`${o.propertyId}|${o.billingYear}`, o] as const),
  );
  const rows = batch.rows.map((row) => {
    if (row.outcome === 'CREATED' || row.outcome === 'SKIPPED_EXISTING') return row;
    const existing = byScope.get(`${row.propertyId}|${row.billingYear}`);
    if (!existing) return row;
    return {
      ...row,
      outcome: 'SKIPPED_EXISTING' as const,
      detail: 'reconcile_opening_present',
      remainingDebt: existing.remainingDebt,
      assessmentId: existing.assessmentId,
    };
  });
  return summarize(rows, batch.stoppedEarly);
}

export function retryCandidatesFromCrBatch(batch: CrCommitBatchResult): number[] {
  return batch.rows
    .filter((r) => r.outcome === 'FAILED' || r.outcome === 'NOT_PROCESSED')
    .map((r) => r.rowNumber);
}

export function filterPreviewForCrRetry(
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

export function mergeCrCommitBatches(
  prior: CrCommitBatchResult | null,
  next: CrCommitBatchResult,
): CrCommitBatchResult {
  if (!prior) return next;
  const byRow = new Map(prior.rows.map((r) => [r.rowNumber, r]));
  for (const r of next.rows) byRow.set(r.rowNumber, r);
  const rows = [...byRow.values()].sort((a, b) => a.rowNumber - b.rowNumber);
  return summarize(rows, next.stoppedEarly);
}

export function crCommitAuditPayload(batch: CrCommitBatchResult): Record<string, unknown> {
  return {
    atomic_transaction: false,
    synthetic_payments: false,
    operational_charges: false,
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
      remaining_debt: r.remainingDebt ?? null,
      assessment_id: r.assessmentId ?? null,
    })),
  };
}

/** Sum remaining debt from CREATED/SKIPPED opening rows (capital ledger SoT). */
export function capitalOutstandingFromCrCommit(batch: CrCommitBatchResult): number {
  let sum = 0;
  for (const r of batch.rows) {
    if (r.outcome !== 'CREATED' && r.outcome !== 'SKIPPED_EXISTING') continue;
    sum += Math.max(0, Number(r.remainingDebt ?? 0));
  }
  return Math.round(sum * 100) / 100;
}
