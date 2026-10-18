import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  bootstrapModuleSetupAdapters,
  buildApartmentLookup,
  buildCapitalAssessmentsMaps,
  buildCapitalLedgerConflictSets,
  buildCapitalRepairIs8TemplateBuffer,
  capitalOpeningBalanceEffect,
  capitalOutstandingFromCrCommit,
  capitalRepairOpeningPayloadsFromPreview,
  classifyCapitalRepairOpeningRows,
  classifyCrOpeningErrorMessage,
  commitCapitalRepairOpeningBatch,
  crCommitAuditPayload,
  defaultCapitalAssessmentTitle,
  filterPreviewForCrRetry,
  getModuleAdapter,
  mergeCrCommitBatches,
  openingAmountsConsistent,
  parseYearFromCapitalAssessmentTitle,
  reconcileCrCommitWithDb,
  resetModuleSetupAdaptersForTests,
  retryCandidatesFromCrBatch,
  validateCapitalRepairOpeningRow,
  CAPITAL_REPAIR_MODULE_KEY,
  type CrCommitBatchResult,
} from '@/lib/moduleCore';
import { ownershipTransferPreservesApartmentLedger } from '@/lib/financePolicy';
import { REMAINING_GREENFIELD_MIGRATION_GAPS } from '@/lib/moduleCore/freshInstallMeterSchema';

const MIGRATION = path.resolve(
  process.cwd(),
  'supabase/migrations/20261027120000_is8_capital_repair_opening_state.sql',
);

describe('IS-8 · Capital Repair opening adapter', () => {
  it('registers capital_repair adapter under canonical module key', () => {
    resetModuleSetupAdaptersForTests();
    bootstrapModuleSetupAdapters();
    const adapter = getModuleAdapter(CAPITAL_REPAIR_MODULE_KEY);
    expect(adapter?.registration.moduleKey).toBe('capital_repair');
    expect(adapter?.registration.dependencies).toContain('property_book');
    expect(adapter?.registration.legalOrOperationalGates).toContain('no_synthetic_payments');
    expect(adapter?.registration.legalOrOperationalGates).toContain('mandatory_assessment_id_linkage');
    expect(adapter?.registration.legalOrOperationalGates).toContain('optional_historical_import');
    expect(adapter?.validateManual?.({ skip_historical_import: true }).ok).toBe(true);
  });

  it('migration defines opening RPC without payment/charge inserts; admin-only; assessment mandatory', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    expect(sql).toContain('import_capital_repair_opening_state');
    expect(sql).toContain('opening_historical_settlement');
    expect(sql).toContain('opening_obligation');
    expect(sql).toContain('opening_credit');
    expect(sql).toContain("has_staff_role('администрация')");
    expect(sql).toMatch(/IS-8 historical settlement \(not a platform payment\)/);
    expect(sql).toContain('capital_repair_opening_or_charge_requires_assessment');
    expect(sql).toContain('idempotency_key');
    expect(sql).toContain('conflict existing operational charge');
    expect(sql).toContain('set search_path = \'\'');
    // Must not insert operational payment or charge rows in opening path
    expect(sql).not.toMatch(
      /insert into public\.capital_repair_ledger[\s\S]{0,320}'payment'/i,
    );
    expect(sql).not.toMatch(
      /insert into public\.capital_repair_ledger[\s\S]{0,320}'charge'/i,
    );
    expect(sql).not.toMatch(/charge_capital_repair/);
    expect(sql).not.toMatch(/record_capital_repair_payment/);
    expect(sql).not.toMatch(/import_support_fee_opening_state/);
    // Balance consumers updated
    expect(sql).toContain('opening_obligation');
    expect(sql).toContain('get_capital_repair_balance');
    expect(sql).toContain('get_capital_repair_fund_totals');
    expect(sql).toContain('ownership_change_overdue_debt');
  });

  it('validates assessed = historically_paid + remaining; credit/debt mutual exclusive', () => {
    expect(
      openingAmountsConsistent({ assessed: 120, historicallyPaid: 70, remainingDebt: 50 }),
    ).toBe(true);
    expect(
      openingAmountsConsistent({ assessed: 120, historicallyPaid: 70, remainingDebt: 40 }),
    ).toBe(false);
    const badArith = validateCapitalRepairOpeningRow({
      apartment_number: '101',
      billing_year: '2025',
      obligation_type: 'capital_repair',
      assessed_amount: '120',
      historically_paid_amount: '70',
      remaining_debt: '40',
      opening_overpayment: '0',
      transition_date: '2026-01-01',
    });
    expect(badArith).toContain('inconsistent:assessed_ne_paid_plus_remaining');

    const creditAndDebt = validateCapitalRepairOpeningRow({
      apartment_number: '101',
      billing_year: '2025',
      obligation_type: 'capital_repair',
      assessed_amount: '120',
      historically_paid_amount: '70',
      remaining_debt: '50',
      opening_overpayment: '10',
      transition_date: '2026-01-01',
    });
    expect(creditAndDebt).toContain('inconsistent:credit_and_debt_mutual_exclusive');
  });

  it('classifies fully paid / partial / opening debt / opening credit; rejects UUID spoofing', () => {
    const apartmentsByNumber = buildApartmentLookup([
      { property_id: 10, apartment_number: '101' },
      { property_id: 11, apartment_number: '102' },
    ]);
    const { assessmentsByTitle, assessmentsByYear } = buildCapitalAssessmentsMaps([
      { id: 'a-2023', title: 'Капитальный ремонт 2023', status: 'active' },
      { id: 'a-2024', title: 'Капитальный ремонт 2024', status: 'active' },
      { id: 'a-2025', title: 'Капитальный ремонт 2025', status: 'active' },
    ]);
    const rows: Record<string, string>[] = [
      {
        apartment_number: '101',
        billing_year: '2023',
        obligation_type: 'capital_repair',
        assessed_amount: '120',
        historically_paid_amount: '120',
        remaining_debt: '0',
        opening_overpayment: '0',
        transition_date: '2026-01-01',
      },
      {
        apartment_number: '101',
        billing_year: '2024',
        obligation_type: 'capital_repair',
        assessed_amount: '120',
        historically_paid_amount: '70',
        remaining_debt: '50',
        opening_overpayment: '0',
        transition_date: '2026-01-01',
      },
      {
        apartment_number: '101',
        billing_year: '2025',
        obligation_type: 'capital_repair',
        assessed_amount: '120',
        historically_paid_amount: '0',
        remaining_debt: '120',
        opening_overpayment: '0',
        transition_date: '2026-01-01',
      },
      {
        apartment_number: '102',
        billing_year: '2025',
        obligation_type: 'capital_repair',
        assessed_amount: '120',
        historically_paid_amount: '120',
        remaining_debt: '0',
        opening_overpayment: '15',
        transition_date: '2026-01-01',
      },
      {
        apartment_number: '101',
        billing_year: '2022',
        obligation_type: 'capital_repair',
        assessed_amount: '100',
        historically_paid_amount: '100',
        remaining_debt: '0',
        transition_date: '2026-01-01',
        property_id: '999',
        assessment_id: 'spoof',
      },
    ];
    const preview = classifyCapitalRepairOpeningRows(rows, {
      apartmentsByNumber,
      openingImportsByScope: new Map(),
      assessmentsByTitle,
      assessmentsByYear,
      operationalChargeScopes: new Set(),
      openingObligationScopes: new Set(),
    });
    expect(preview.createCount).toBe(4);
    const creates = preview.rows.filter((r) => r.operation === 'create');
    expect(creates.every((r) => r.data.no_synthetic_payments === 'true')).toBe(true);
    expect(creates.every((r) => r.data.no_operational_charges === 'true')).toBe(true);
    expect(creates.find((r) => r.data.billing_year === '2023')?.data.preview_balance_effect_eur).toBe(
      '0',
    );
    expect(creates.find((r) => r.data.billing_year === '2024')?.data.preview_balance_effect_eur).toBe(
      '50',
    );
    expect(creates.find((r) => r.data.billing_year === '2025' && r.data.apartment_number === '101')
      ?.data.preview_balance_effect_eur).toBe('120');
    expect(creates.find((r) => r.data.apartment_number === '102')?.data.preview_balance_effect_eur).toBe(
      '-15',
    );
    const spoof = preview.rows.find((r) => r.data.billing_year === '2022');
    expect(spoof?.errors).toEqual(
      expect.arrayContaining(['untrusted_property_id', 'untrusted_assessment_id']),
    );
  });

  it('operational charge → CONFLICT; identical opening → SKIP; mismatch → CONFLICT', () => {
    const apartmentsByNumber = buildApartmentLookup([
      { property_id: 10, apartment_number: '101' },
    ]);
    const { assessmentsByTitle, assessmentsByYear } = buildCapitalAssessmentsMaps([
      { id: 'a-2025', title: 'Капитальный ремонт 2025', status: 'active' },
    ]);
    const { operationalChargeScopes } = buildCapitalLedgerConflictSets([
      { property_id: 10, assessment_id: 'a-2025', kind: 'charge' },
    ]);

    const conflictPreview = classifyCapitalRepairOpeningRows(
      [
        {
          apartment_number: '101',
          billing_year: '2025',
          obligation_type: 'capital_repair',
          assessed_amount: '120',
          historically_paid_amount: '0',
          remaining_debt: '120',
          opening_overpayment: '0',
          transition_date: '2026-01-01',
        },
      ],
      {
        apartmentsByNumber,
        openingImportsByScope: new Map(),
        assessmentsByTitle,
        assessmentsByYear,
        operationalChargeScopes,
        openingObligationScopes: new Set(),
      },
    );
    expect(conflictPreview.conflictCount).toBe(1);
    expect(conflictPreview.rows[0]?.data.preview_class).toBe('CONFLICT');
    expect(conflictPreview.rows[0]?.errors).toContain('conflict:existing_operational_charge');

    const skipPreview = classifyCapitalRepairOpeningRows(
      [
        {
          apartment_number: '101',
          billing_year: '2024',
          obligation_type: 'capital_repair',
          assessed_amount: '120',
          historically_paid_amount: '120',
          remaining_debt: '0',
          opening_overpayment: '0',
          transition_date: '2026-01-01',
        },
      ],
      {
        apartmentsByNumber,
        openingImportsByScope: new Map([
          ['10|2024', { assessed: 120, paid: 120, remaining: 0, over: 0, assessmentId: 'a-2024' }],
        ]),
        assessmentsByTitle: new Map(),
        assessmentsByYear: new Map(),
        operationalChargeScopes: new Set(),
        openingObligationScopes: new Set(),
      },
    );
    expect(skipPreview.skipCount).toBe(1);

    const mismatch = classifyCapitalRepairOpeningRows(
      [
        {
          apartment_number: '101',
          billing_year: '2024',
          obligation_type: 'capital_repair',
          assessed_amount: '120',
          historically_paid_amount: '100',
          remaining_debt: '20',
          opening_overpayment: '0',
          transition_date: '2026-01-01',
        },
      ],
      {
        apartmentsByNumber,
        openingImportsByScope: new Map([
          ['10|2024', { assessed: 120, paid: 120, remaining: 0, over: 0, assessmentId: 'a-2024' }],
        ]),
        assessmentsByTitle: new Map(),
        assessmentsByYear: new Map(),
        operationalChargeScopes: new Set(),
        openingObligationScopes: new Set(),
      },
    );
    expect(mismatch.conflictCount).toBe(1);
    expect(mismatch.rows[0]?.errors).toContain('conflict:existing_opening_import_mismatch');
  });

  it('missing assessment shell is allowed (will create); wrong apartment fails', () => {
    const preview = classifyCapitalRepairOpeningRows(
      [
        {
          apartment_number: '101',
          billing_year: '2019',
          obligation_type: 'capital_repair',
          assessed_amount: '100',
          historically_paid_amount: '0',
          remaining_debt: '100',
          transition_date: '2026-01-01',
        },
        {
          apartment_number: '999',
          billing_year: '2025',
          obligation_type: 'support_fee',
          assessed_amount: '100',
          historically_paid_amount: '0',
          remaining_debt: '100',
          transition_date: '2026-01-01',
        },
      ],
      {
        apartmentsByNumber: buildApartmentLookup([{ property_id: 10, apartment_number: '101' }]),
        openingImportsByScope: new Map(),
        assessmentsByTitle: new Map(),
        assessmentsByYear: new Map(),
        operationalChargeScopes: new Set(),
        openingObligationScopes: new Set(),
      },
    );
    const shell = preview.rows.find((r) => r.data.billing_year === '2019');
    expect(shell?.operation).toBe('create');
    expect(shell?.data.assessment_will_create).toBe('true');
    expect(shell?.data.assessment_title).toBe(defaultCapitalAssessmentTitle(2019));
    const bad = preview.rows.find((r) => r.data.apartment_number === '999');
    expect(bad?.errors).toEqual(
      expect.arrayContaining(['unknown_apartment', 'unsupported:obligation_type']),
    );
  });

  it('canonical balance effect: paid / partial / debt / credit; no double-count credit', () => {
    expect(capitalOpeningBalanceEffect({ assessed: 120, historicallyPaid: 120, openingOverpayment: 0 })).toBe(
      0,
    );
    expect(capitalOpeningBalanceEffect({ assessed: 120, historicallyPaid: 70, openingOverpayment: 0 })).toBe(
      50,
    );
    expect(capitalOpeningBalanceEffect({ assessed: 120, historicallyPaid: 0, openingOverpayment: 0 })).toBe(
      120,
    );
    expect(
      capitalOpeningBalanceEffect({ assessed: 120, historicallyPaid: 120, openingOverpayment: 15 }),
    ).toBe(-15);
  });

  it('commit outcomes: create / conflict continue / failed stop / retry; no synthetic payment/charge', async () => {
    const apartmentsByNumber = buildApartmentLookup([
      { property_id: 10, apartment_number: '101' },
      { property_id: 11, apartment_number: '102' },
    ]);
    const { assessmentsByTitle, assessmentsByYear } = buildCapitalAssessmentsMaps([
      { id: 'a-2026', title: 'Капитальный ремонт 2026', status: 'active' },
    ]);
    const preview = classifyCapitalRepairOpeningRows(
      [
        {
          apartment_number: '101',
          billing_year: '2026',
          obligation_type: 'capital_repair',
          assessed_amount: '120',
          historically_paid_amount: '0',
          remaining_debt: '120',
          opening_overpayment: '0',
          transition_date: '2026-01-01',
        },
        {
          apartment_number: '102',
          billing_year: '2026',
          obligation_type: 'capital_repair',
          assessed_amount: '120',
          historically_paid_amount: '120',
          remaining_debt: '0',
          opening_overpayment: '0',
          transition_date: '2026-01-01',
        },
      ],
      {
        apartmentsByNumber,
        openingImportsByScope: new Map(),
        assessmentsByTitle,
        assessmentsByYear,
        operationalChargeScopes: new Set(),
        openingObligationScopes: new Set(),
      },
    );

    let calls = 0;
    const batch = await commitCapitalRepairOpeningBatch({
      preview,
      batchId: 'batch-cr-1',
      idempotencyKeyForRow: (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
      importRow: async (p) => {
        calls += 1;
        if (p.propertyId === 11) {
          return { ok: false, outcome: 'FAILED', message: 'not allowed' };
        }
        return {
          ok: true,
          outcome: 'CREATED',
          remainingDebt: p.remainingDebt,
          assessmentId: 'a-2026',
        };
      },
    });

    expect(calls).toBe(2);
    expect(batch.createdCount).toBe(1);
    expect(batch.failedCount).toBe(1);
    expect(batch.syntheticPayments).toBe(false);
    expect(batch.operationalCharges).toBe(false);
    expect(batch.fullySuccessful).toBe(false);
    expect(capitalOutstandingFromCrCommit(batch)).toBe(120);

    const retryPreview = filterPreviewForCrRetry(preview, retryCandidatesFromCrBatch(batch));
    expect(retryPreview.rows).toHaveLength(1);
    expect(retryPreview.rows[0]?.data.apartment_number).toBe('102');

    const retryBatch = await commitCapitalRepairOpeningBatch({
      preview: retryPreview,
      batchId: 'batch-cr-1',
      idempotencyKeyForRow: (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
      importRow: async (p) => ({
        ok: true,
        outcome: 'CREATED',
        remainingDebt: p.remainingDebt,
        assessmentId: 'a-2026',
      }),
    });
    const merged = mergeCrCommitBatches(batch, retryBatch);
    expect(merged.createdCount).toBe(2);
    expect(merged.fullySuccessful).toBe(true);
    expect(crCommitAuditPayload(merged).synthetic_payments).toBe(false);
    expect(crCommitAuditPayload(merged).operational_charges).toBe(false);
  });

  it('concurrent/idempotent retry and unauthorized/conflict classification', () => {
    expect(classifyCrOpeningErrorMessage('conflict existing operational charge')).toBe('CONFLICT');
    expect(classifyCrOpeningErrorMessage('23505')).toBe('CONFLICT');
    expect(classifyCrOpeningErrorMessage('not allowed')).toBe('FAILED');
    expect(classifyCrOpeningErrorMessage('authentication required')).toBe('FAILED');

    const prior: CrCommitBatchResult = {
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
          operationalCharges: false,
        },
      ],
      createdCount: 0,
      skippedExistingCount: 0,
      conflictCount: 0,
      failedCount: 1,
      notProcessedCount: 0,
      fullySuccessful: false,
      syntheticPayments: false,
      operationalCharges: false,
      stoppedEarly: true,
    };
    const reconciled = reconcileCrCommitWithDb(prior, [
      {
        propertyId: 10,
        billingYear: 2026,
        remainingDebt: 120,
        assessmentId: 'a-2026',
      },
    ]);
    expect(reconciled.rows[0]?.outcome).toBe('SKIPPED_EXISTING');
  });

  it('payloads resolve assessment by business title; template builds; ownership preserves ledger', () => {
    expect(parseYearFromCapitalAssessmentTitle('Капитальный ремонт 2025')).toBe(2025);
    expect(defaultCapitalAssessmentTitle(2025)).toBe('Капитальный ремонт 2025');

    const apartmentsByNumber = buildApartmentLookup([
      { property_id: 10, apartment_number: '101' },
    ]);
    const { assessmentsByTitle, assessmentsByYear } = buildCapitalAssessmentsMaps([
      { id: 'a-2025', title: 'Капитальный ремонт 2025', status: 'active' },
    ]);
    const preview = classifyCapitalRepairOpeningRows(
      [
        {
          apartment_number: '101',
          billing_year: '2025',
          obligation_type: 'capital_repair',
          assessed_amount: '120',
          historically_paid_amount: '70',
          remaining_debt: '50',
          opening_overpayment: '0',
          transition_date: '2026-01-01',
          source_reference: 'CR-REF-1',
        },
      ],
      {
        apartmentsByNumber,
        openingImportsByScope: new Map(),
        assessmentsByTitle,
        assessmentsByYear,
        operationalChargeScopes: new Set(),
        openingObligationScopes: new Set(),
      },
    );
    const payloads = capitalRepairOpeningPayloadsFromPreview(preview);
    expect(payloads).toHaveLength(1);
    expect(payloads[0]?.assessmentTitle).toBe('Капитальный ремонт 2025');
    expect(payloads[0]?.historicallyPaidAmount).toBe(70);
    expect(payloads[0]?.remainingDebt).toBe(50);
    expect(preview.rows[0]?.data.resolved_assessment_id).toBe('a-2025');

    const buf = buildCapitalRepairIs8TemplateBuffer();
    expect(buf.byteLength).toBeGreaterThan(1000);
    expect(ownershipTransferPreservesApartmentLedger()).toBe(true);
  });

  it('documents fresh-install Capital Repair DDL gaps without executing package', () => {
    // IS-9b + R1-CR: assessments/ledger + charge/payment/balance + bulk/year-bulk packaged.
    expect(REMAINING_GREENFIELD_MIGRATION_GAPS).not.toContain(
      'capital_repair_assessments_ledger_baseline',
    );
    expect(REMAINING_GREENFIELD_MIGRATION_GAPS).not.toContain(
      'capital_repair_operational_rpcs_charge_payment_balance',
    );
    expect(REMAINING_GREENFIELD_MIGRATION_GAPS).not.toContain(
      'charge_capital_repair_bulk_and_year_bulk',
    );
  });

  it('no automatic module activation: adapter does not mark ACTIVE in completion criteria', () => {
    resetModuleSetupAdaptersForTests();
    bootstrapModuleSetupAdapters();
    const adapter = getModuleAdapter(CAPITAL_REPAIR_MODULE_KEY);
    expect(adapter?.registration.setup?.completionCriteria).not.toContain('auto_activate');
    expect(adapter?.registration.activationPrerequisites).toContain('finance_authz_ok');
  });
});
