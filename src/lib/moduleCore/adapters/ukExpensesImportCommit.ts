/**
 * IS-6a UK expenses opening commit safety.
 * Sequential import_uk_expense_opening_row; per-row outcomes; no publish/AP/payments.
 */

import type { ImportPreviewResult } from '@/lib/moduleCore/types';
import {
  type ExistingUkExpenseOpeningRef,
  type UkExpenseOpeningRpcPayload,
  ukExpenseOpeningPayloadsFromPreview,
} from '@/lib/moduleCore/adapters/ukExpensesOpening';

export const UK_EXPENSE_COMMIT_OUTCOMES = [
  'CREATED',
  'SKIPPED_EXISTING',
  'CONFLICT',
  'FAILED',
  'NOT_PROCESSED',
] as const;

export type UkExpenseCommitOutcome = (typeof UK_EXPENSE_COMMIT_OUTCOMES)[number];

export type UkExpenseCommitRowResult = {
  rowNumber: number;
  sourceRef: string;
  outcome: UkExpenseCommitOutcome;
  detail: string;
  attempted: boolean;
  expenseId?: number | null;
  published: false;
  apCreated: false;
  paymentCreated: false;
};

export type UkExpenseCommitBatchResult = {
  rows: UkExpenseCommitRowResult[];
  createdCount: number;
  skippedExistingCount: number;
  conflictCount: number;
  failedCount: number;
  notProcessedCount: number;
  fullySuccessful: boolean;
  published: false;
  apCreated: false;
  paymentCreated: false;
  stoppedEarly: boolean;
};

export type ImportUkExpenseOpeningFn = (
  payload: UkExpenseOpeningRpcPayload & { idempotencyKey: string; batchId: string | null },
) => Promise<
  | {
      ok: true;
      outcome: 'CREATED' | 'SKIPPED_EXISTING';
      expenseId: number | null;
    }
  | { ok: false; outcome: 'CONFLICT' | 'FAILED'; message: string }
>;

export function classifyUkExpenseOpeningErrorMessage(message: string): 'CONFLICT' | 'FAILED' {
  const msg = message.toLowerCase();
  if (
    msg.includes('conflict') ||
    msg.includes('23505') ||
    msg.includes('duplicate') ||
    msg.includes('source_ref mismatch')
  ) {
    return 'CONFLICT';
  }
  return 'FAILED';
}

function summarize(rows: UkExpenseCommitRowResult[], stoppedEarly: boolean): UkExpenseCommitBatchResult {
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
    published: false,
    apCreated: false,
    paymentCreated: false,
    stoppedEarly,
  };
}

export async function commitUkExpenseOpeningBatch(args: {
  preview: ImportPreviewResult;
  importRow: ImportUkExpenseOpeningFn;
  batchId: string | null;
  idempotencyKeyForRow: (rowNumber: number) => string;
}): Promise<UkExpenseCommitBatchResult> {
  const results: UkExpenseCommitRowResult[] = [];
  let stop = false;

  for (const row of args.preview.rows) {
    const sourceRef = String(row.data.source_ref ?? '').trim();

    if (row.operation === 'skip') {
      results.push({
        rowNumber: row.rowNumber,
        sourceRef,
        outcome: 'SKIPPED_EXISTING',
        detail: 'preview_identical_opening',
        attempted: false,
        published: false,
        apCreated: false,
        paymentCreated: false,
      });
      continue;
    }

    if (row.operation === 'error') {
      const isConflict =
        (row.data.preview_class ?? '') === 'CONFLICT' ||
        row.errors.some((e) => e.startsWith('conflict:') || e.startsWith('blocked:'));
      results.push({
        rowNumber: row.rowNumber,
        sourceRef,
        outcome: isConflict ? 'CONFLICT' : 'FAILED',
        detail: row.errors.join('; ') || 'preview_error',
        attempted: false,
        published: false,
        apCreated: false,
        paymentCreated: false,
      });
      continue;
    }

    if (row.operation !== 'create') continue;

    if (stop) {
      results.push({
        rowNumber: row.rowNumber,
        sourceRef,
        outcome: 'NOT_PROCESSED',
        detail: 'stopped_after_prior_failure',
        attempted: false,
        published: false,
        apCreated: false,
        paymentCreated: false,
      });
      continue;
    }

    const payloads = ukExpenseOpeningPayloadsFromPreview({
      ...args.preview,
      rows: [row],
    });
    const payload = payloads[0];
    if (!payload) {
      results.push({
        rowNumber: row.rowNumber,
        sourceRef,
        outcome: 'FAILED',
        detail: 'payload_build_failed',
        attempted: false,
        published: false,
        apCreated: false,
        paymentCreated: false,
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
        sourceRef: payload.sourceRef,
        outcome: res.outcome,
        detail: res.outcome === 'CREATED' ? 'opening_rpc_ok' : 'opening_rpc_idempotent',
        attempted: true,
        expenseId: res.expenseId,
        published: false,
        apCreated: false,
        paymentCreated: false,
      });
      continue;
    }

    results.push({
      rowNumber: row.rowNumber,
      sourceRef: payload.sourceRef,
      outcome: res.outcome,
      detail: res.message,
      attempted: true,
      published: false,
      apCreated: false,
      paymentCreated: false,
    });
    if (res.outcome === 'FAILED') stop = true;
  }

  return summarize(results, stop);
}

export function reconcileUkExpenseCommitWithDb(
  batch: UkExpenseCommitBatchResult,
  expenses: ExistingUkExpenseOpeningRef[],
): UkExpenseCommitBatchResult {
  const byRef = new Map(
    expenses.map((e) => [e.sourceRef.trim().toLowerCase(), e] as const),
  );
  const rows = batch.rows.map((row) => {
    if (row.outcome === 'CREATED' || row.outcome === 'SKIPPED_EXISTING') return row;
    const existing = byRef.get(row.sourceRef.trim().toLowerCase());
    if (!existing) return row;
    if (existing.openingImport) {
      return {
        ...row,
        outcome: 'SKIPPED_EXISTING' as const,
        detail: 'reconcile_opening_present',
        expenseId: existing.id,
      };
    }
    return {
      ...row,
      outcome: 'CONFLICT' as const,
      detail: 'reconcile_unexpected_non_opening',
    };
  });
  return summarize(rows, batch.stoppedEarly);
}

export function retryCandidatesFromUkExpenseBatch(batch: UkExpenseCommitBatchResult): number[] {
  return batch.rows
    .filter((r) => r.outcome === 'FAILED' || r.outcome === 'NOT_PROCESSED')
    .map((r) => r.rowNumber);
}

export function filterPreviewForUkExpenseRetry(
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

export function mergeUkExpenseCommitBatches(
  prior: UkExpenseCommitBatchResult | null,
  next: UkExpenseCommitBatchResult,
): UkExpenseCommitBatchResult {
  if (!prior) return next;
  const byRow = new Map(prior.rows.map((r) => [r.rowNumber, r]));
  for (const r of next.rows) byRow.set(r.rowNumber, r);
  const rows = [...byRow.values()].sort((a, b) => a.rowNumber - b.rowNumber);
  return summarize(rows, next.stoppedEarly);
}

export function ukExpenseCommitAuditPayload(
  batch: UkExpenseCommitBatchResult,
): Record<string, unknown> {
  return {
    atomic_transaction: false,
    published: false,
    ap_created: false,
    payment_created: false,
    synthetic_payments: false,
    fully_successful: batch.fullySuccessful,
    created: batch.createdCount,
    skipped: batch.skippedExistingCount,
    conflict: batch.conflictCount,
    failed: batch.failedCount,
    not_processed: batch.notProcessedCount,
    rows: batch.rows.map((r) => ({
      row: r.rowNumber,
      source_ref: r.sourceRef,
      outcome: r.outcome,
      detail: r.detail,
      expense_id: r.expenseId ?? null,
    })),
  };
}
