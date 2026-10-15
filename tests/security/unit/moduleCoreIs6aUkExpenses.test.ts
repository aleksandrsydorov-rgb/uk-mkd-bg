import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  bootstrapModuleSetupAdapters,
  buildCategoryCodeMap,
  buildExistingUkExpenseOpeningMap,
  buildUkExpensesIs6aTemplateBuffer,
  classifyUkExpenseOpeningErrorMessage,
  classifyUkExpenseOpeningRows,
  commitUkExpenseOpeningBatch,
  expenseCountsInOperationalBudgetExecution,
  filterPreviewForUkExpenseRetry,
  getModuleAdapter,
  mergeUkExpenseCommitBatches,
  openingExpenseIdentical,
  parsePositiveMoney,
  resetModuleSetupAdaptersForTests,
  retryCandidatesFromUkExpenseBatch,
  ukExpenseCommitAuditPayload,
  ukExpenseOpeningPayloadsFromPreview,
  validateUkExpenseOpeningRow,
  UK_EXPENSES_SETUP_KEY,
  type UkExpenseCommitBatchResult,
} from '@/lib/moduleCore';
import { EXPENSE_PENDING } from '@/lib/expenses';

const MIGRATION = path.resolve(
  process.cwd(),
  'supabase/migrations/20261025120000_is6a_uk_expense_opening.sql',
);

function baseCtx(overrides: Partial<Parameters<typeof classifyUkExpenseOpeningRows>[1]> = {}) {
  return {
    existingBySourceRef: new Map(),
    categoriesByCode: buildCategoryCodeMap([
      { id: 'cat-clean', code: 'cleaning', active: true },
      { id: 'cat-main', code: 'maintenance', active: true },
    ]),
    sofiaTodayIso: '2026-03-15',
    ...overrides,
  };
}

function validRow(extras: Record<string, string> = {}) {
  return {
    source_ref: 'EXP-2025-001',
    title: 'Cleaning Q4',
    expense_date: '2025-11-15',
    amount_eur: '120.00',
    category_code: 'cleaning',
    transition_date: '2026-01-01',
    source_document: 'INV-1',
    notes: '',
    ...extras,
  };
}

describe('IS-6a · UK expenses opening adapter', () => {
  it('registers platform-service uk_expenses adapter (optional skip)', () => {
    resetModuleSetupAdaptersForTests();
    bootstrapModuleSetupAdapters();
    const adapter = getModuleAdapter(UK_EXPENSES_SETUP_KEY);
    expect(adapter?.registration.moduleKey).toBe('uk_expenses');
    expect(adapter?.registration.requiresInitialSetup).toBe(true);
    expect(adapter?.registration.legalOrOperationalGates).toEqual(
      expect.arrayContaining([
        'optional_import',
        'no_auto_publish',
        'no_ap_or_supplier_payments',
        'opening_excluded_from_budget_execution',
      ]),
    );
    expect(adapter?.validateManual?.({ skip_historical_import: true })).toEqual({ ok: true });
    expect(adapter?.validateManual?.({})).toEqual({
      ok: false,
      errors: ['required:confirmed_or_skip_or_verified'],
    });
  });

  it('migration defines opening RPC without AP/payment/SF/Internet reuse', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    expect(sql).toContain('import_uk_expense_opening_row');
    expect(sql).toContain('opening_import');
    expect(sql).toContain('source_ref');
    expect(sql).toContain("has_staff_role('администрация')");
    expect(sql).toContain("'на проверке'");
    expect(sql).toContain('budget_expense_counts_in_operational_execution');
    expect(sql).toContain('uk_expense_opening_imports');
    expect(sql).toMatch(/NEVER publishes/i);
    expect(sql).toMatch(/NEVER creates supplier invoices/i);
    expect(sql).not.toMatch(/import_support_fee_opening_state/i);
    expect(sql).not.toMatch(/import_internet_opening_state/i);
    expect(sql).not.toMatch(/record_support_payment/i);
    expect(sql).not.toMatch(/record_internet_payment/i);
    expect(sql).not.toMatch(/insert into public\.support_fee/i);
    expect(sql).not.toMatch(/insert into public\.internet_ledger/i);
  });

  it('budget execution isolation: opening rows never count operationally', () => {
    expect(expenseCountsInOperationalBudgetExecution(false)).toBe(true);
    expect(expenseCountsInOperationalBudgetExecution(true)).toBe(false);
    const sql = readFileSync(MIGRATION, 'utf8');
    expect(sql).toContain(
      'and public.budget_expense_counts_in_operational_execution(e.opening_import)',
    );
  });

  it('validates required fields, positive amount, dates', () => {
    expect(validateUkExpenseOpeningRow(validRow())).toEqual([]);
    expect(validateUkExpenseOpeningRow(validRow({ source_ref: '' }))).toContain('required:source_ref');
    expect(validateUkExpenseOpeningRow(validRow({ amount_eur: '0' }))).toContain('invalid:amount_eur');
    expect(validateUkExpenseOpeningRow(validRow({ amount_eur: '-1' }))).toContain('invalid:amount_eur');
    expect(
      validateUkExpenseOpeningRow(
        validRow({ expense_date: '2026-02-01', transition_date: '2026-01-01' }),
      ),
    ).toContain('invalid:expense_date_after_transition');
    expect(parsePositiveMoney('12,5')).toBe(12.5);
  });

  it('CREATE / SKIP identical / CONFLICT mismatch / unknown category', () => {
    const create = classifyUkExpenseOpeningRows([validRow()], baseCtx());
    expect(create.createCount).toBe(1);
    expect(create.rows[0]?.data.pending_status).toBe(EXPENSE_PENDING);
    expect(create.rows[0]?.data.no_auto_publish).toBe('true');
    expect(create.rows[0]?.data.budget_execution_excluded).toBe('true');

    const existing = buildExistingUkExpenseOpeningMap([
      {
        id: 9,
        source_ref: 'EXP-2025-001',
        title: 'Cleaning Q4',
        expense_date: '2025-11-15',
        amount: 120,
        opening_transition_date: '2026-01-01',
        budget_category_id: 'cat-clean',
        status: EXPENSE_PENDING,
        opening_import: true,
      },
    ]);
    const skip = classifyUkExpenseOpeningRows(
      [validRow()],
      baseCtx({ existingBySourceRef: existing }),
    );
    expect(skip.skipCount).toBe(1);
    expect(skip.rows[0]?.operation).toBe('skip');

    const conflict = classifyUkExpenseOpeningRows(
      [validRow({ amount_eur: '200.00' })],
      baseCtx({ existingBySourceRef: existing }),
    );
    expect(conflict.conflictCount).toBe(1);
    expect(conflict.rows[0]?.errors).toContain('conflict:existing_source_ref_mismatch');

    const badCat = classifyUkExpenseOpeningRows(
      [validRow({ category_code: 'nope' })],
      baseCtx(),
    );
    expect(badCat.errorCount).toBeGreaterThan(0);
    expect(badCat.rows[0]?.errors).toContain('unknown:category_code');
  });

  it('duplicate source_ref in file → ERROR', () => {
    const result = classifyUkExpenseOpeningRows(
      [validRow(), validRow({ title: 'Other' })],
      baseCtx(),
    );
    expect(result.rows[1]?.errors).toContain('duplicate_in_file:source_ref');
  });

  it('optional category and missing receipts allowed', () => {
    const result = classifyUkExpenseOpeningRows(
      [validRow({ category_code: '', source_document: '' })],
      baseCtx(),
    );
    expect(result.createCount).toBe(1);
    expect(result.rows[0]?.data.resolved_category_id).toBe('');
  });

  it('template buffer includes expenses sheet + instructions', () => {
    const buf = buildUkExpensesIs6aTemplateBuffer();
    expect(buf.byteLength).toBeGreaterThan(500);
  });

  it('commit batch CREATE / SKIP / CONFLICT / partial retry; never publish/AP', async () => {
    const preview = classifyUkExpenseOpeningRows(
      [
        validRow(),
        validRow({ source_ref: 'EXP-2025-002', title: 'Elevator' }),
        validRow({ source_ref: 'EXP-BAD', amount_eur: '-1' }),
      ],
      baseCtx(),
    );
    // Force one skip/conflict via preview ops for commit path
    const skipRow = {
      ...preview.rows[0]!,
      operation: 'skip' as const,
      data: { ...preview.rows[0]!.data, preview_class: 'SKIP' },
      errors: [],
    };
    const conflictRow = {
      ...preview.rows[1]!,
      operation: 'error' as const,
      data: { ...preview.rows[1]!.data, preview_class: 'CONFLICT' },
      errors: ['conflict:existing_source_ref_mismatch'],
    };
    const createPreview = classifyUkExpenseOpeningRows([validRow({ source_ref: 'EXP-NEW' })], baseCtx());

    const mixed = {
      ...preview,
      rows: [skipRow, conflictRow, ...createPreview.rows],
      createCount: 1,
      skipCount: 1,
      errorCount: 1,
    };

    const calls: string[] = [];
    const batch = await commitUkExpenseOpeningBatch({
      preview: mixed,
      batchId: '11111111-1111-4111-8111-111111111111',
      idempotencyKeyForRow: (n) => `22222222-2222-4222-8222-22222222${String(n).padStart(4, '0')}`,
      importRow: async (p) => {
        calls.push(p.sourceRef);
        return { ok: true, outcome: 'CREATED', expenseId: 42 };
      },
    });

    expect(batch.skippedExistingCount).toBe(1);
    expect(batch.conflictCount).toBe(1);
    expect(batch.createdCount).toBe(1);
    expect(batch.published).toBe(false);
    expect(batch.apCreated).toBe(false);
    expect(batch.paymentCreated).toBe(false);
    expect(calls).toEqual(['EXP-NEW']);
    expect(ukExpenseCommitAuditPayload(batch).published).toBe(false);

    const payloads = ukExpenseOpeningPayloadsFromPreview(createPreview);
    expect(payloads[0]?.sourceRef).toBe('EXP-NEW');
  });

  it('idempotent retry helpers and error classification', () => {
    const failed: UkExpenseCommitBatchResult = {
      rows: [
        {
          rowNumber: 2,
          sourceRef: 'A',
          outcome: 'FAILED',
          detail: 'boom',
          attempted: true,
          published: false,
          apCreated: false,
          paymentCreated: false,
        },
        {
          rowNumber: 3,
          sourceRef: 'B',
          outcome: 'NOT_PROCESSED',
          detail: 'stopped',
          attempted: false,
          published: false,
          apCreated: false,
          paymentCreated: false,
        },
      ],
      createdCount: 0,
      skippedExistingCount: 0,
      conflictCount: 0,
      failedCount: 1,
      notProcessedCount: 1,
      fullySuccessful: false,
      published: false,
      apCreated: false,
      paymentCreated: false,
      stoppedEarly: true,
    };
    expect(retryCandidatesFromUkExpenseBatch(failed)).toEqual([2, 3]);
    const preview = classifyUkExpenseOpeningRows(
      [validRow({ source_ref: 'A' }), validRow({ source_ref: 'B' })],
      baseCtx(),
    );
    const retry = filterPreviewForUkExpenseRetry(preview, [2]);
    expect(retry.rows).toHaveLength(1);
    expect(classifyUkExpenseOpeningErrorMessage('conflict existing source_ref mismatch')).toBe(
      'CONFLICT',
    );
    expect(classifyUkExpenseOpeningErrorMessage('amount must be positive')).toBe('FAILED');
    const merged = mergeUkExpenseCommitBatches(failed, {
      ...failed,
      rows: [
        {
          rowNumber: 2,
          sourceRef: 'A',
          outcome: 'CREATED',
          detail: 'ok',
          attempted: true,
          expenseId: 1,
          published: false,
          apCreated: false,
          paymentCreated: false,
        },
      ],
      createdCount: 1,
      failedCount: 0,
      fullySuccessful: false,
      stoppedEarly: false,
    });
    expect(merged.rows.find((r) => r.rowNumber === 2)?.outcome).toBe('CREATED');
  });

  it('openingExpenseIdentical never treats mismatch as skip', () => {
    const existing = {
      id: 1,
      sourceRef: 'EXP-1',
      title: 'A',
      expenseDate: '2025-01-01',
      amount: 10,
      transitionDate: '2026-01-01',
      budgetCategoryId: null,
      categoryCode: null,
      status: EXPENSE_PENDING,
      openingImport: true,
    };
    expect(
      openingExpenseIdentical(existing, {
        title: 'A',
        expenseDate: '2025-01-01',
        amount: 10,
        transitionDate: '2026-01-01',
        categoryId: null,
      }),
    ).toBe(true);
    expect(
      openingExpenseIdentical(existing, {
        title: 'B',
        expenseDate: '2025-01-01',
        amount: 10,
        transitionDate: '2026-01-01',
        categoryId: null,
      }),
    ).toBe(false);
  });
});
