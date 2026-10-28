import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  bootstrapModuleSetupAdapters,
  buildApartmentLookup,
  buildExistingSfScopeMap,
  buildSupportFeeIs4TemplateBuffer,
  classifySfOpeningErrorMessage,
  classifySupportFeeOpeningRows,
  commitSupportFeeOpeningBatch,
  d1OutstandingFromSfCommit,
  filterPreviewForSfRetry,
  getModuleAdapter,
  mergeSfCommitBatches,
  openingAmountsConsistent,
  reconcileSfCommitWithDb,
  resetModuleSetupAdaptersForTests,
  retryCandidatesFromSfBatch,
  sfCommitAuditPayload,
  supportFeeOpeningPayloadsFromPreview,
  SUPPORT_FEE_MODULE_KEY,
  validateSupportFeeOpeningRow,
  type SfCommitBatchResult,
} from '@/lib/moduleCore';
import { supportLedgerNet, canonicalSupportOutstanding } from '@/lib/supportFeeBalance';
import { ownershipTransferPreservesApartmentLedger } from '@/lib/financePolicy';

const MIGRATION = path.resolve(
  process.cwd(),
  'supabase/migrations/20261023120000_is4_support_fee_opening_state.sql',
);

const SRC = 'SF-OPENING-TEST';

describe('IS-4 · Support Fee opening adapter', () => {
  it('registers support_fee adapter under canonical module key', () => {
    resetModuleSetupAdaptersForTests();
    bootstrapModuleSetupAdapters();
    const adapter = getModuleAdapter(SUPPORT_FEE_MODULE_KEY);
    expect(adapter?.registration.moduleKey).toBe('support_fee');
    expect(adapter?.registration.dependencies).toContain('property_book');
    expect(adapter?.registration.legalOrOperationalGates).toContain('no_synthetic_payments');
  });

  it('migration defines opening RPC without payment kind inserts for historical settlement', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    expect(sql).toContain('import_support_fee_opening_state');
    expect(sql).toContain('opening_historical_settlement');
    expect(sql).toContain('opening_obligation');
    expect(sql).toContain('opening_credit');
    expect(sql).toContain("has_staff_role('администрация')");
    expect(sql).toContain("'opening_historical_settlement'");
    expect(sql).toMatch(/IS-4 historical settlement \(not a platform payment\)/);
    // Must not insert operational payment rows in opening path
    expect(sql).not.toMatch(
      /insert into public\.support_fee_ledger[\s\S]{0,280}'payment'/i,
    );
    expect(sql).not.toMatch(/support_fee_allocations/);
    expect(sql).toContain('conflict existing assessment');
    expect(sql).toContain('idempotency_key');
  });

  it('validates assessed = historically_paid + remaining (Q3)', () => {
    expect(
      openingAmountsConsistent({ assessed: 400, historicallyPaid: 250, remainingDebt: 150 }),
    ).toBe(true);
    expect(
      openingAmountsConsistent({ assessed: 400, historicallyPaid: 250, remainingDebt: 100 }),
    ).toBe(false);
    const errors = validateSupportFeeOpeningRow({
      apartment_number: '101',
      billing_year: '2025',
      obligation_type: 'support_fee',
      assessed_amount: '400',
      historically_paid_amount: '250',
      remaining_debt: '100',
      opening_overpayment: '0',
      transition_date: '2026-01-01',
      source_reference: SRC,
    });
    expect(errors).toContain('inconsistent:assessed_ne_paid_plus_remaining');
  });

  it('classifies fully paid / partial / unpaid years and rejects property_id spoofing', () => {
    const apartmentsByNumber = buildApartmentLookup([
      { property_id: 10, apartment_number: '101' },
    ]);
    const rows: Record<string, string>[] = [
      {
        apartment_number: '101',
        billing_year: '2024',
        obligation_type: 'support_fee',
        assessed_amount: '400',
        historically_paid_amount: '400',
        remaining_debt: '0',
        opening_overpayment: '0',
        transition_date: '2026-01-01',
        source_reference: SRC,
      },
      {
        apartment_number: '101',
        billing_year: '2025',
        obligation_type: 'support_fee',
        assessed_amount: '400',
        historically_paid_amount: '250',
        remaining_debt: '150',
        opening_overpayment: '0',
        transition_date: '2026-01-01',
        source_reference: SRC,
      },
      {
        apartment_number: '101',
        billing_year: '2026',
        obligation_type: 'support_fee',
        assessed_amount: '400',
        historically_paid_amount: '0',
        remaining_debt: '400',
        opening_overpayment: '0',
        transition_date: '2026-01-01',
        source_reference: SRC,
      },
      {
        apartment_number: '101',
        billing_year: '2023',
        obligation_type: 'support_fee',
        assessed_amount: '100',
        historically_paid_amount: '100',
        remaining_debt: '0',
        transition_date: '2026-01-01',
        source_reference: SRC,
        property_id: '999',
      },
    ];
    const preview = classifySupportFeeOpeningRows(rows, {
      apartmentsByNumber,
      existingByScope: new Map(),
      openingImportsByScope: new Map(),
    });
    expect(preview.createCount).toBe(3);
    expect(preview.rows.filter((r) => r.operation === 'create').every((r) => r.data.no_synthetic_payments === 'true')).toBe(
      true,
    );
    expect(preview.rows.find((r) => r.data.billing_year === '2023')?.errors).toContain(
      'untrusted_property_id',
    );
  });

  it('existing obligation → CONFLICT (Q5); identical opening → SKIP', () => {
    const apartmentsByNumber = buildApartmentLookup([
      { property_id: 10, apartment_number: '101' },
    ]);
    const existingByScope = buildExistingSfScopeMap([
      {
        property_id: 10,
        billing_year: 2025,
        remaining_due: 150,
        final_amount: 400,
        status: 'open',
        opening_import: false,
      },
    ]);
    const conflictPreview = classifySupportFeeOpeningRows(
      [
        {
          apartment_number: '101',
          billing_year: '2025',
          obligation_type: 'support_fee',
          assessed_amount: '400',
          historically_paid_amount: '250',
          remaining_debt: '150',
          opening_overpayment: '0',
          transition_date: '2026-01-01',
          source_reference: SRC,
        },
      ],
      { apartmentsByNumber, existingByScope, openingImportsByScope: new Map() },
    );
    expect(conflictPreview.conflictCount).toBe(1);
    expect(conflictPreview.rows[0]?.data.preview_class).toBe('CONFLICT');

    const skipPreview = classifySupportFeeOpeningRows(
      [
        {
          apartment_number: '101',
          billing_year: '2024',
          obligation_type: 'support_fee',
          assessed_amount: '400',
          historically_paid_amount: '400',
          remaining_debt: '0',
          opening_overpayment: '0',
          transition_date: '2026-01-01',
          source_reference: SRC,
        },
      ],
      {
        apartmentsByNumber,
        existingByScope: new Map(),
        openingImportsByScope: new Map([
          ['10|2024', { assessed: 400, paid: 400, remaining: 0, over: 0 }],
        ]),
      },
    );
    expect(skipPreview.skipCount).toBe(1);
  });

  it('unknown apartment and wrong obligation type fail validation', () => {
    const preview = classifySupportFeeOpeningRows(
      [
        {
          apartment_number: '999',
          billing_year: '2026',
          obligation_type: 'capital_repair',
          assessed_amount: '100',
          historically_paid_amount: '0',
          remaining_debt: '100',
          transition_date: '2026-01-01',
          source_reference: SRC,
        },
      ],
      {
        apartmentsByNumber: buildApartmentLookup([{ property_id: 1, apartment_number: '101' }]),
        existingByScope: new Map(),
        openingImportsByScope: new Map(),
      },
    );
    expect(preview.errorCount).toBeGreaterThan(0);
    expect(preview.rows[0]?.errors).toEqual(
      expect.arrayContaining(['unknown_apartment', 'unsupported:obligation_type']),
    );
  });

  it('commit outcomes: create / conflict / failed stop / retry merge; no synthetic payments', async () => {
    const apartmentsByNumber = buildApartmentLookup([
      { property_id: 10, apartment_number: '101' },
      { property_id: 11, apartment_number: '102' },
    ]);
    const preview = classifySupportFeeOpeningRows(
      [
        {
          apartment_number: '101',
          billing_year: '2026',
          obligation_type: 'support_fee',
          assessed_amount: '400',
          historically_paid_amount: '0',
          remaining_debt: '400',
          opening_overpayment: '0',
          transition_date: '2026-01-01',
          source_reference: SRC,
        },
        {
          apartment_number: '102',
          billing_year: '2026',
          obligation_type: 'support_fee',
          assessed_amount: '480',
          historically_paid_amount: '480',
          remaining_debt: '0',
          opening_overpayment: '0',
          transition_date: '2026-01-01',
          source_reference: SRC,
        },
      ],
      { apartmentsByNumber, existingByScope: new Map(), openingImportsByScope: new Map() },
    );

    let calls = 0;
    const batch = await commitSupportFeeOpeningBatch({
      preview,
      batchId: 'batch-1',
      idempotencyKeyForRow: (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
      importRow: async (p) => {
        calls += 1;
        if (p.propertyId === 11) {
          return { ok: false, outcome: 'FAILED', message: 'not authorized' };
        }
        return { ok: true, outcome: 'CREATED', remainingDue: p.remainingDebt };
      },
    });

    expect(calls).toBe(2);
    expect(batch.createdCount).toBe(1);
    expect(batch.failedCount).toBe(1);
    expect(batch.syntheticPayments).toBe(false);
    expect(batch.chargesGenerated).toBe(false);
    expect(batch.fullySuccessful).toBe(false);
    expect(d1OutstandingFromSfCommit(batch)).toBe(400);

    const retryPreview = filterPreviewForSfRetry(preview, retryCandidatesFromSfBatch(batch));
    expect(retryPreview.rows).toHaveLength(1);
    expect(retryPreview.rows[0]?.data.apartment_number).toBe('102');

    const retryBatch = await commitSupportFeeOpeningBatch({
      preview: retryPreview,
      batchId: 'batch-1',
      idempotencyKeyForRow: (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
      importRow: async (p) => ({ ok: true, outcome: 'CREATED', remainingDue: p.remainingDebt }),
    });
    const merged = mergeSfCommitBatches(batch, retryBatch);
    expect(merged.createdCount).toBe(2);
    expect(merged.fullySuccessful).toBe(true);
    expect(sfCommitAuditPayload(merged).synthetic_payments).toBe(false);
  });

  it('classifies RPC conflict messages and reconciles DB opening presence', () => {
    expect(classifySfOpeningErrorMessage('conflict existing assessment')).toBe('CONFLICT');
    expect(classifySfOpeningErrorMessage('not allowed')).toBe('FAILED');

    const prior: SfCommitBatchResult = {
      rows: [
        {
          rowNumber: 2,
          apartmentNumber: '101',
          billingYear: 2026,
          propertyId: 10,
          outcome: 'FAILED',
          detail: 'timeout',
          attempted: true,
          syntheticPayments: false,
        },
      ],
      createdCount: 0,
      skippedExistingCount: 0,
      conflictCount: 0,
      failedCount: 1,
      notProcessedCount: 0,
      fullySuccessful: false,
      syntheticPayments: false,
      chargesGenerated: false,
      stoppedEarly: true,
    };
    const reconciled = reconcileSfCommitWithDb(prior, [
      {
        propertyId: 10,
        billingYear: 2026,
        openingImport: true,
        remainingDue: 400,
        assessedAmount: 400,
        historicallyPaid: 0,
        status: 'open',
      },
    ]);
    expect(reconciled.rows[0]?.outcome).toBe('SKIPPED_EXISTING');
  });

  it('D1 remaining_due and opening ledger kinds stay consistent; ownership transfer preserves apt ledger', () => {
    expect(
      canonicalSupportOutstanding([
        { property_id: 1, remaining_due: 150, status: 'open', billing_year: 2025 },
        { property_id: 1, remaining_due: 400, status: 'open', billing_year: 2026 },
        { property_id: 1, remaining_due: 0, status: 'paid', billing_year: 2024 },
        { property_id: 1, remaining_due: 99, status: 'void', billing_year: 2023 },
      ]),
    ).toBe(550);

    expect(
      supportLedgerNet([
        { property_id: 1, kind: 'opening_obligation', amount: 400 },
        { property_id: 1, kind: 'opening_historical_settlement', amount: 250 },
        { property_id: 1, kind: 'opening_credit', amount: 10 },
      ]),
    ).toBe(140);

    expect(ownershipTransferPreservesApartmentLedger()).toBe(true);
  });

  it('payloads from preview never include payment fabrication flags; template builds', () => {
    const apartmentsByNumber = buildApartmentLookup([
      { property_id: 10, apartment_number: '101' },
    ]);
    const preview = classifySupportFeeOpeningRows(
      [
        {
          apartment_number: '101',
          billing_year: '2025',
          obligation_type: 'support_fee',
          assessed_amount: '400',
          historically_paid_amount: '250',
          remaining_debt: '150',
          opening_overpayment: '0',
          transition_date: '2026-01-01',
          source_reference: 'REF-1',
        },
      ],
      { apartmentsByNumber, existingByScope: new Map(), openingImportsByScope: new Map() },
    );
    const payloads = supportFeeOpeningPayloadsFromPreview(preview);
    expect(payloads).toHaveLength(1);
    expect(payloads[0]?.historicallyPaidAmount).toBe(250);
    expect(payloads[0]?.remainingDebt).toBe(150);
    const buf = buildSupportFeeIs4TemplateBuffer();
    expect(buf.byteLength).toBeGreaterThan(1000);
  });

  it('double overpayment in same apartment file is rejected', () => {
    const preview = classifySupportFeeOpeningRows(
      [
        {
          apartment_number: '101',
          billing_year: '2025',
          obligation_type: 'support_fee',
          assessed_amount: '100',
          historically_paid_amount: '100',
          remaining_debt: '0',
          opening_overpayment: '10',
          transition_date: '2026-01-01',
          source_reference: SRC,
        },
        {
          apartment_number: '101',
          billing_year: '2026',
          obligation_type: 'support_fee',
          assessed_amount: '100',
          historically_paid_amount: '100',
          remaining_debt: '0',
          opening_overpayment: '5',
          transition_date: '2026-01-01',
          source_reference: SRC,
        },
      ],
      {
        apartmentsByNumber: buildApartmentLookup([{ property_id: 10, apartment_number: '101' }]),
        existingByScope: new Map(),
        openingImportsByScope: new Map(),
      },
    );
    expect(
      preview.rows.some((r) => r.errors.includes('duplicate_in_file:opening_overpayment_per_apartment')),
    ).toBe(true);
  });
});
