import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  bootstrapModuleSetupAdapters,
  buildApartmentLookup,
  buildExistingInternetSubMap,
  buildInternetIs5TemplateBuffer,
  classifyInternetOpeningErrorMessage,
  classifyInternetOpeningRows,
  commitInternetOpeningBatch,
  filterPreviewForInternetRetry,
  getModuleAdapter,
  internetAddOneMonth,
  internetBillingDayFromDate,
  internetCommitAuditPayload,
  internetNextChargeOn,
  internetOpeningBalanceEffect,
  internetOpeningPayloadsFromPreview,
  INTERNET_MODULE_KEY,
  mergeInternetCommitBatches,
  nextChargeAfterPaidThrough,
  reconcileInternetCommitWithDb,
  resetModuleSetupAdaptersForTests,
  retryCandidatesFromInternetBatch,
  validateInternetOpeningRow,
  type InternetCommitBatchResult,
} from '@/lib/moduleCore';
import { ownershipTransferPreservesApartmentLedger } from '@/lib/financePolicy';

const MIGRATION = path.resolve(
  process.cwd(),
  'supabase/migrations/20261024120000_is5_internet_opening_state.sql',
);

function baseCtx(overrides: Partial<Parameters<typeof classifyInternetOpeningRows>[1]> = {}) {
  return {
    apartmentsByNumber: buildApartmentLookup([
      { property_id: 10, apartment_number: '101' },
      { property_id: 11, apartment_number: '102' },
      { property_id: 12, apartment_number: '103' },
    ]),
    existingByProperty: new Map(),
    openingImportsByProperty: new Map(),
    pendingWoPropertyIds: new Set<number>(),
    internetTariffConfigured: true,
    sofiaTodayIso: '2026-03-15',
    ...overrides,
  };
}

/** billing_day=1 from connection; paid_through → next_charge_on 2026-05-01 (> sofiaToday 2026-03-15). */
function activeRow(apt: string, extras: Record<string, string> = {}) {
  return {
    apartment_number: apt,
    tariff_code: 'internet',
    status: 'active',
    connection_date: '2025-06-01',
    transition_date: '2026-01-01',
    paid_through: '2026-04-30',
    opening_debt: '0',
    opening_credit: '0',
    source_reference: 'ISP-1',
    notes: '',
    ...extras,
  };
}

describe('IS-5 · Internet opening adapter', () => {
  it('registers internet adapter under canonical module key', () => {
    resetModuleSetupAdaptersForTests();
    bootstrapModuleSetupAdapters();
    const adapter = getModuleAdapter(INTERNET_MODULE_KEY);
    expect(adapter?.registration.moduleKey).toBe('internet');
    expect(adapter?.registration.dependencies).toContain('property_book');
    expect(adapter?.registration.legalOrOperationalGates).toEqual(
      expect.arrayContaining([
        'no_synthetic_payments',
        'no_request_internet_connect',
        'no_system_work_orders_on_opening',
        'q5_pending_wo_blocked',
      ]),
    );
  });

  it('migration defines opening RPC without payment/connect/WO paths', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    expect(sql).toContain('import_internet_opening_state');
    expect(sql).toContain('opening_debit');
    expect(sql).toContain('opening_credit');
    expect(sql).toContain("has_staff_role('администрация')");
    expect(sql).toContain('internet_next_charge_after_paid_through');
    expect(sql).toContain('conflict pending internet work order');
    expect(sql).toContain('conflict existing subscription');
    expect(sql).toContain('idempotency_key');
    expect(sql).toContain('synthetic_payments');
    expect(sql).toContain('work_orders_created');
    expect(sql).toMatch(/NEVER calls request_internet_connect/i);
    // Opening path must not invoke connect workflow or create WO/payment/charge rows
    expect(sql).not.toMatch(/perform\s+request_internet_connect/i);
    expect(sql).not.toMatch(/select\s+.*request_internet_connect\s*\(/i);
    expect(sql).not.toMatch(
      /insert into public\.internet_ledger[\s\S]{0,280}'payment'/i,
    );
    expect(sql).not.toMatch(
      /insert into public\.internet_ledger[\s\S]{0,280}'charge'/i,
    );
    expect(sql).not.toMatch(/insert into public\.work_orders/i);
  });

  it('paid-through → next_charge_on month boundaries; blocks immediate cron charge', () => {
    expect(internetBillingDayFromDate('2025-06-01')).toBe(1);
    expect(internetBillingDayFromDate('2025-01-31')).toBe(28);
    expect(internetAddOneMonth('2025-01-28')).toBe('2025-02-28');
    expect(internetNextChargeOn('2025-12-31', 1)).toBe('2026-01-01');
    expect(internetNextChargeOn('2026-01-01', 1)).toBe('2026-02-01');

    const ok = nextChargeAfterPaidThrough({
      paidThrough: '2026-04-30',
      billingDay: 1,
      sofiaTodayIso: '2026-03-15',
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.nextChargeOn).toBe('2026-05-01');

    // next_charge_on would be <= today → BLOCKED (cron would fire immediately)
    const blocked = nextChargeAfterPaidThrough({
      paidThrough: '2026-01-31',
      billingDay: 1,
      sofiaTodayIso: '2026-03-15',
    });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error).toBe('blocked:next_charge_on_not_after_today');

    // Future charge preserved: paid through end of current month → next month billing day
    const future = nextChargeAfterPaidThrough({
      paidThrough: '2026-03-31',
      billingDay: 15,
      sofiaTodayIso: '2026-03-15',
    });
    expect(future.ok).toBe(true);
    if (future.ok) expect(future.nextChargeOn).toBe('2026-04-15');
  });

  it('opening debt/credit balance effect; no synthetic payments in preview', () => {
    expect(internetOpeningBalanceEffect(25, 10)).toBe(15);
    expect(internetOpeningBalanceEffect(0, 10)).toBe(-10);

    const preview = classifyInternetOpeningRows(
      [
        activeRow('101', { opening_debt: '25.00', opening_credit: '0' }),
        activeRow('102', { opening_debt: '0', opening_credit: '10.00' }),
      ],
      baseCtx(),
    );
    expect(preview.createCount).toBe(2);
    expect(preview.rows.every((r) => r.data.no_synthetic_payments === 'true')).toBe(true);
    expect(preview.rows.every((r) => r.data.no_connect_workflow === 'true')).toBe(true);
    expect(preview.rows.every((r) => r.data.no_work_orders === 'true')).toBe(true);
    expect(preview.rows[0]?.data.balance_effect).toBe('25');
    expect(preview.rows[1]?.data.balance_effect).toBe('-10');
  });

  it('validates active paid_through, tariff, status; rejects property_id spoofing', () => {
    expect(
      validateInternetOpeningRow({
        apartment_number: '101',
        tariff_code: 'fiber',
        status: 'active',
        transition_date: '2026-01-01',
        paid_through: '2026-02-28',
      }),
    ).toContain('unsupported:tariff_code');

    expect(
      validateInternetOpeningRow({
        apartment_number: '101',
        tariff_code: 'internet',
        status: 'pending_enable',
        transition_date: '2026-01-01',
        paid_through: '2026-02-28',
      }),
    ).toContain('unsupported:status');

    expect(
      validateInternetOpeningRow({
        apartment_number: '101',
        tariff_code: 'internet',
        status: 'active',
        transition_date: '2026-01-01',
      }),
    ).toContain('required:paid_through');

    const spoof = classifyInternetOpeningRows(
      [activeRow('101', { property_id: '999' })],
      baseCtx(),
    );
    expect(spoof.rows[0]?.errors).toContain('untrusted_property_id');
  });

  it('unknown apartment, invalid tariff config, duplicate apartment', () => {
    const preview = classifyInternetOpeningRows(
      [activeRow('999'), activeRow('101'), activeRow('101', { opening_debt: '5' })],
      baseCtx({ internetTariffConfigured: false }),
    );
    expect(preview.rows[0]?.errors).toEqual(
      expect.arrayContaining(['unknown_apartment', 'tariff_not_configured']),
    );
    expect(preview.rows[2]?.errors).toContain('duplicate_in_file:apartment');
  });

  it('pending internet work order → BLOCKED (Q5)', () => {
    const preview = classifyInternetOpeningRows([activeRow('101')], baseCtx({
      pendingWoPropertyIds: new Set([10]),
    }));
    expect(preview.rows[0]?.errors).toContain('blocked:pending_internet_work_order');
    expect(preview.rows[0]?.data.preview_class).toBe('ERROR');
  });

  it('existing subscription CONFLICT; identical opening → SKIP (Q4)', () => {
    const conflictPreview = classifyInternetOpeningRows([activeRow('101')], baseCtx({
      existingByProperty: buildExistingInternetSubMap([
        {
          property_id: 10,
          status: 'active',
          billing_day: 1,
          next_charge_on: '2026-05-01',
          opening_import: false,
          opening_paid_through: '2026-04-30',
          opening_debt: 0,
          opening_credit: 0,
        },
      ]),
    }));
    expect(conflictPreview.conflictCount).toBe(1);
    expect(conflictPreview.rows[0]?.data.preview_class).toBe('CONFLICT');
    expect(conflictPreview.rows[0]?.errors).toContain('conflict:existing_subscription');

    const skipPreview = classifyInternetOpeningRows([activeRow('101')], baseCtx({
      openingImportsByProperty: new Map([
        [
          10,
          {
            status: 'active',
            paidThrough: '2026-04-30',
            nextChargeOn: '2026-05-01',
            debt: 0,
            credit: 0,
          },
        ],
      ]),
    }));
    expect(skipPreview.skipCount).toBe(1);
    expect(skipPreview.rows[0]?.data.preview_class).toBe('SKIP');
  });

  it('commit outcomes: create / failed stop / retry merge; no synthetic payments or WOs', async () => {
    const preview = classifyInternetOpeningRows(
      [activeRow('101'), activeRow('102'), activeRow('103')],
      baseCtx(),
    );
    expect(preview.createCount).toBe(3);

    let calls = 0;
    const batch = await commitInternetOpeningBatch({
      preview,
      batchId: 'batch-is5',
      idempotencyKeyForRow: (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
      importRow: async (p) => {
        calls += 1;
        if (p.propertyId === 11) {
          return { ok: false, outcome: 'FAILED', message: 'not allowed' };
        }
        return {
          ok: true,
          outcome: 'CREATED',
          nextChargeOn: p.nextChargeOn,
          balanceEur: internetOpeningBalanceEffect(p.openingDebt, p.openingCredit),
        };
      },
    });

    expect(calls).toBe(2); // stops after FAILED; 103 NOT_PROCESSED
    expect(batch.createdCount).toBe(1);
    expect(batch.failedCount).toBe(1);
    expect(batch.notProcessedCount).toBe(1);
    expect(batch.syntheticPayments).toBe(false);
    expect(batch.workOrdersCreated).toBe(false);
    expect(batch.chargesGenerated).toBe(false);
    expect(batch.fullySuccessful).toBe(false);

    const retryPreview = filterPreviewForInternetRetry(
      preview,
      retryCandidatesFromInternetBatch(batch),
    );
    expect(retryPreview.rows.map((r) => r.data.apartment_number).sort()).toEqual(['102', '103']);

    const retryBatch = await commitInternetOpeningBatch({
      preview: retryPreview,
      batchId: 'batch-is5',
      idempotencyKeyForRow: (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
      importRow: async (p) => ({
        ok: true,
        outcome: 'CREATED',
        nextChargeOn: p.nextChargeOn,
        balanceEur: 0,
      }),
    });
    const merged = mergeInternetCommitBatches(batch, retryBatch);
    expect(merged.createdCount).toBe(3);
    expect(merged.fullySuccessful).toBe(true);
    expect(internetCommitAuditPayload(merged).synthetic_payments).toBe(false);
    expect(internetCommitAuditPayload(merged).work_orders_created).toBe(false);
  });

  it('classifies RPC conflict messages and reconciles DB opening presence', () => {
    expect(classifyInternetOpeningErrorMessage('conflict existing subscription')).toBe('CONFLICT');
    expect(classifyInternetOpeningErrorMessage('conflict pending internet work order')).toBe(
      'CONFLICT',
    );
    expect(classifyInternetOpeningErrorMessage('not allowed')).toBe('FAILED');

    const prior: InternetCommitBatchResult = {
      rows: [
        {
          rowNumber: 2,
          apartmentNumber: '101',
          propertyId: 10,
          outcome: 'FAILED',
          detail: 'timeout',
          attempted: true,
          syntheticPayments: false,
          workOrdersCreated: false,
        },
      ],
      createdCount: 0,
      skippedExistingCount: 0,
      conflictCount: 0,
      failedCount: 1,
      notProcessedCount: 0,
      fullySuccessful: false,
      syntheticPayments: false,
      workOrdersCreated: false,
      chargesGenerated: false,
      stoppedEarly: true,
    };
    const reconciled = reconcileInternetCommitWithDb(prior, [
      {
        propertyId: 10,
        status: 'active',
        billingDay: 1,
        nextChargeOn: '2026-05-01',
        paidThrough: '2026-04-30',
        openingImport: true,
        openingDebt: 0,
        openingCredit: 0,
        periodStart: '2025-06-01',
      },
    ]);
    expect(reconciled.rows[0]?.outcome).toBe('SKIPPED_EXISTING');
  });

  it('payloads from preview; template builds; ownership transfer policy unchanged', () => {
    const preview = classifyInternetOpeningRows(
      [activeRow('101', { opening_debt: '25', opening_credit: '5' })],
      baseCtx(),
    );
    const payloads = internetOpeningPayloadsFromPreview(preview);
    expect(payloads).toHaveLength(1);
    expect(payloads[0]?.propertyId).toBe(10);
    expect(payloads[0]?.openingDebt).toBe(25);
    expect(payloads[0]?.openingCredit).toBe(5);
    expect(payloads[0]?.nextChargeOn).toBe('2026-05-01');
    const buf = buildInternetIs5TemplateBuffer();
    expect(buf.byteLength).toBeGreaterThan(1000);
    expect(ownershipTransferPreservesApartmentLedger()).toBe(true);
  });

  it('inactive opening without paid_through is allowed; active without is ERROR', () => {
    const inactive = classifyInternetOpeningRows(
      [
        {
          apartment_number: '103',
          tariff_code: 'internet',
          status: 'inactive',
          connection_date: '',
          transition_date: '2026-01-01',
          paid_through: '',
          opening_debt: '0',
          opening_credit: '10',
        },
      ],
      baseCtx(),
    );
    expect(inactive.createCount).toBe(1);
    expect(inactive.rows[0]?.data.next_charge_on).toBe('');

    const activeMissing = classifyInternetOpeningRows(
      [
        {
          apartment_number: '101',
          tariff_code: 'internet',
          status: 'active',
          transition_date: '2026-01-01',
          paid_through: '',
          opening_debt: '0',
          opening_credit: '0',
        },
      ],
      baseCtx(),
    );
    expect(activeMissing.rows[0]?.errors).toContain('required:paid_through');
  });
});
