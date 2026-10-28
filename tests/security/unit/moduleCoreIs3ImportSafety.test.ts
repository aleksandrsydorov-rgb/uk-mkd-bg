import { describe, expect, it, beforeEach } from 'vitest';
import {
  PROPERTY_BOOK_MODULE_KEY,
  WATER_MODULE_KEY,
  bootstrapModuleSetupAdapters,
  classifyAssignErrorMessage,
  classifyWaterMeterOpeningRows,
  commitMeterInventoryBatch,
  filterPreviewForRetry,
  getModuleAdapter,
  mergeMeterCommitBatches,
  meterCommitAuditPayload,
  reconcileMeterCommitWithDb,
  resetModuleSetupAdaptersForTests,
  retryCandidatesFromBatch,
  buildApartmentLookup,
  existingActiveSerialsFromMeters,
  existingMetersBySerialFromMeters,
  type ImportPreviewResult,
  type MeterCommitBatchResult,
} from '@/lib/moduleCore';

function waterPreview(rows: Record<string, string>[]): ImportPreviewResult {
  return classifyWaterMeterOpeningRows(rows, {
    apartmentsByNumber: buildApartmentLookup([
      { property_id: 1, apartment_number: '12' },
      { property_id: 2, apartment_number: '14' },
      { property_id: 3, apartment_number: '16' },
    ]),
    existingActiveSerials: existingActiveSerialsFromMeters([]),
    existingMetersBySerial: existingMetersBySerialFromMeters([]),
    policy: { allowReplace: false },
  });
}

const row = (apt: string, serial: string, reading = '0') => ({
  apartment_number: apt,
  meter_number: serial,
  initial_reading: reading,
  installed_at: '2026-01-15',
});

describe('IS-3 import safety · atomic feasibility', () => {
  it('documents non-atomic strategy (no bulk assign RPC)', () => {
    const audit = meterCommitAuditPayload({
      utility: 'water',
      rows: [],
      createdCount: 0,
      skippedExistingCount: 0,
      failedCount: 0,
      notProcessedCount: 0,
      fullySuccessful: true,
      chargesGenerated: false,
      stoppedEarly: false,
    });
    expect(audit.atomic_transaction).toBe(false);
    expect(audit.chargesGenerated).toBe(false);
    expect(audit.opening_reading_row_commit).toBe('ENABLED');
  });
});

describe('IS-3 import safety · per-row outcomes', () => {
  it('successful import marks all CREATE as CREATED', async () => {
    const preview = waterPreview([row('12', 'W-A'), row('14', 'W-B')]);
    const batch = await commitMeterInventoryBatch({
      utility: 'water',
      preview,
      assignWater: async () => ({ ok: true }),
      assignElectricity: async () => ({ ok: true }),
    });
    expect(batch.fullySuccessful).toBe(true);
    expect(batch.createdCount).toBe(2);
    expect(batch.chargesGenerated).toBe(false);
    expect(batch.rows.every((r) => r.outcome === 'CREATED')).toBe(true);
  });

  it('failure in the middle → FAILED then NOT_PROCESSED; not fully successful', async () => {
    const preview = waterPreview([row('12', 'W-A'), row('14', 'W-B'), row('16', 'W-C')]);
    let n = 0;
    const batch = await commitMeterInventoryBatch({
      utility: 'water',
      preview,
      assignWater: async () => {
        n += 1;
        if (n === 2) return { ok: false, message: 'Not authorized.' };
        return { ok: true };
      },
      assignElectricity: async () => ({ ok: true }),
    });
    expect(batch.fullySuccessful).toBe(false);
    expect(batch.createdCount).toBe(1);
    expect(batch.failedCount).toBe(1);
    expect(batch.notProcessedCount).toBe(1);
    expect(batch.rows.map((r) => r.outcome)).toEqual([
      'CREATED',
      'FAILED',
      'NOT_PROCESSED',
    ]);
  });

  it('already assigned mid-batch is SKIPPED_EXISTING and continues (idempotent concurrent)', async () => {
    const preview = waterPreview([row('12', 'W-A'), row('14', 'W-B')]);
    let n = 0;
    const batch = await commitMeterInventoryBatch({
      utility: 'water',
      preview,
      assignWater: async () => {
        n += 1;
        if (n === 1) {
          return { ok: false, message: 'An active water meter is already assigned.' };
        }
        return { ok: true };
      },
      assignElectricity: async () => ({ ok: true }),
    });
    expect(batch.rows[0]?.outcome).toBe('SKIPPED_EXISTING');
    expect(batch.rows[1]?.outcome).toBe('CREATED');
    expect(batch.fullySuccessful).toBe(true);
    expect(classifyAssignErrorMessage('An active electricity meter is already assigned.')).toBe(
      'SKIPPED_EXISTING',
    );
  });

  it('preview SKIP becomes SKIPPED_EXISTING without assign attempt', async () => {
    const existing = [{ propertyId: 1, meterNumber: 'W-A', retiredAt: null as string | null }];
    const preview = classifyWaterMeterOpeningRows([row('12', 'W-A')], {
      apartmentsByNumber: buildApartmentLookup([{ property_id: 1, apartment_number: '12' }]),
      existingActiveSerials: existingActiveSerialsFromMeters(existing),
      existingMetersBySerial: existingMetersBySerialFromMeters(existing),
      policy: { allowReplace: false },
    });
    let calls = 0;
    const batch = await commitMeterInventoryBatch({
      utility: 'water',
      preview,
      assignWater: async () => {
        calls += 1;
        return { ok: true };
      },
      assignElectricity: async () => ({ ok: true }),
    });
    expect(calls).toBe(0);
    expect(batch.rows[0]?.outcome).toBe('SKIPPED_EXISTING');
    expect(batch.rows[0]?.attempted).toBe(false);
  });

  it('retry after partial failure only targets FAILED/NOT_PROCESSED missing in DB', async () => {
    const preview = waterPreview([row('12', 'W-A'), row('14', 'W-B'), row('16', 'W-C')]);
    let n = 0;
    const first = await commitMeterInventoryBatch({
      utility: 'water',
      preview,
      assignWater: async () => {
        n += 1;
        if (n === 2) return { ok: false, message: 'boom' };
        return { ok: true };
      },
      assignElectricity: async () => ({ ok: true }),
    });
    // apt 12 created in DB
    const meters = [{ propertyId: 1, meterNumber: 'W-A', retiredAt: null }];
    const candidates = retryCandidatesFromBatch(first, meters);
    expect(candidates.map((c) => c.rowNumber)).toEqual([3, 4]);
    const retryPreview = filterPreviewForRetry(
      preview,
      new Set(candidates.map((c) => c.rowNumber)),
    );
    expect(retryPreview.createCount).toBe(2);

    const retry = await commitMeterInventoryBatch({
      utility: 'water',
      preview: retryPreview,
      assignWater: async () => ({ ok: true }),
      assignElectricity: async () => ({ ok: true }),
    });
    const merged = mergeMeterCommitBatches(first, retry);
    expect(merged.createdCount).toBe(3);
    expect(merged.fullySuccessful).toBe(true);
  });

  it('reconcile upgrades NOT_PROCESSED when active meter already present (no baseline overwrite)', () => {
    const partial: MeterCommitBatchResult = {
      utility: 'water',
      rows: [
        {
          rowNumber: 2,
          apartmentNumber: '12',
          meterNumber: 'W-A',
          propertyId: 1,
          outcome: 'CREATED',
          detail: 'assign_ok',
          attempted: true,
        },
        {
          rowNumber: 3,
          apartmentNumber: '14',
          meterNumber: 'W-B',
          propertyId: 2,
          outcome: 'NOT_PROCESSED',
          detail: 'stopped_after_prior_failure',
          attempted: false,
        },
      ],
      createdCount: 1,
      skippedExistingCount: 0,
      failedCount: 0,
      notProcessedCount: 1,
      fullySuccessful: false,
      chargesGenerated: false,
      stoppedEarly: true,
    };
    const reconciled = reconcileMeterCommitWithDb(partial, [
      { propertyId: 1, meterNumber: 'W-A', retiredAt: null },
      { propertyId: 2, meterNumber: 'W-B', retiredAt: null },
    ]);
    expect(reconciled.rows[1]?.outcome).toBe('SKIPPED_EXISTING');
    expect(reconciled.rows[1]?.detail).toContain('reconciled_active_present');
  });

  it('audit payload never claims charges; distinguishes outcomes', () => {
    const payload = meterCommitAuditPayload({
      utility: 'electricity',
      rows: [
        {
          rowNumber: 2,
          apartmentNumber: '12',
          meterNumber: 'E-1',
          propertyId: 1,
          outcome: 'CREATED',
          detail: 'ok',
          attempted: true,
        },
        {
          rowNumber: 3,
          apartmentNumber: '14',
          meterNumber: 'E-2',
          propertyId: 2,
          outcome: 'FAILED',
          detail: 'x',
          attempted: true,
        },
      ],
      createdCount: 1,
      skippedExistingCount: 0,
      failedCount: 1,
      notProcessedCount: 0,
      fullySuccessful: false,
      chargesGenerated: false,
      stoppedEarly: true,
    });
    expect(payload.fullySuccessful).toBe(false);
    expect(payload.chargesGenerated).toBe(false);
    expect((payload.rows as { outcome: string }[])[1]?.outcome).toBe('FAILED');
  });
});

describe('IS-3 import safety · auth contract', () => {
  beforeEach(() => {
    resetModuleSetupAdaptersForTests();
    bootstrapModuleSetupAdapters();
  });

  it('adapters remain admin-only and depend on Property Book', () => {
    const water = getModuleAdapter(WATER_MODULE_KEY)!;
    expect(water.registration.requiredRoles).toEqual(['администрация']);
    expect(water.registration.dependencies).toContain(PROPERTY_BOOK_MODULE_KEY);
    expect(water.validateManual?.({ property_id: 9, confirmed: true })).toEqual({
      ok: false,
      errors: ['untrusted_property_id'],
    });
  });
});
