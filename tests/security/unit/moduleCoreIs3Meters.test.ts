import { describe, expect, it, beforeEach } from 'vitest';
import * as XLSX from 'xlsx';
import {
  ELECTRICITY_MODULE_KEY,
  OPENING_READING_ROW_COMMIT,
  PROPERTY_BOOK_MODULE_KEY,
  WATER_MODULE_KEY,
  activePropertyIdsFromMeters,
  bootstrapModuleSetupAdapters,
  buildApartmentLookup,
  buildElectricityMeterIs3TemplateBuffer,
  buildWaterMeterIs3TemplateBuffer,
  classifyElectricityMeterOpeningRows,
  classifyWaterMeterOpeningRows,
  electricityAssignPayloadsFromPreview,
  getModuleAdapter,
  isOpeningReadingRowCommitBlocked,
  listRegisteredModuleKeys,
  parseInstalledAtDate,
  resetModuleSetupAdaptersForTests,
  serialSetFromMeters,
  setupCompleteFromDraft,
  validateElectricityMeterRow,
  validateWaterMeterRow,
  waterAssignPayloadsFromPreview,
  activationBlockedReasons,
  dependenciesSatisfied,
} from '@/lib/moduleCore';
import { parseModuleXlsxBuffer } from '@/lib/moduleCore/xlsxEngine';

function waterCtx(args?: {
  apts?: Array<{ property_id: number; apartment_number: string }>;
  meters?: Array<{ propertyId: number; meterNumber: string; retiredAt: string | null }>;
}) {
  const apts = args?.apts ?? [
    { property_id: 1, apartment_number: '12' },
    { property_id: 2, apartment_number: '14' },
  ];
  const meters = args?.meters ?? [];
  return {
    apartmentsByNumber: buildApartmentLookup(apts),
    activePropertyIds: activePropertyIdsFromMeters(meters),
    existingSerials: serialSetFromMeters(meters),
    policy: { allowReplace: false as const },
  };
}

describe('IS-3 · adapter registration', () => {
  beforeEach(() => {
    resetModuleSetupAdaptersForTests();
    bootstrapModuleSetupAdapters();
  });

  it('registers water and electricity with Property Book dependency', () => {
    const keys = listRegisteredModuleKeys();
    expect(keys).toContain(WATER_MODULE_KEY);
    expect(keys).toContain(ELECTRICITY_MODULE_KEY);
    const water = getModuleAdapter(WATER_MODULE_KEY)!;
    const el = getModuleAdapter(ELECTRICITY_MODULE_KEY)!;
    expect(water.registration.dependencies).toContain(PROPERTY_BOOK_MODULE_KEY);
    expect(el.registration.dependencies).toContain(PROPERTY_BOOK_MODULE_KEY);
    expect(dependenciesSatisfied(water.registration, new Set([PROPERTY_BOOK_MODULE_KEY]))).toBe(
      true,
    );
    expect(
      activationBlockedReasons(water.registration, {
        lifecycleState: 'READY',
        activeOrReadyKeys: new Set(),
        setupComplete: true,
      }),
    ).toContain('dependencies');
  });

  it('rejects untrusted property_id and requires confirm', () => {
    const adapter = getModuleAdapter(WATER_MODULE_KEY)!;
    expect(adapter.validateManual?.({ property_id: 1, confirmed: true })).toEqual({
      ok: false,
      errors: ['untrusted_property_id'],
    });
    expect(adapter.validateManual?.({ confirmed: true })).toEqual({ ok: true });
    expect(setupCompleteFromDraft(adapter.registration, { confirmed: true })).toBe(true);
  });

  it('marks opening reading row commit BLOCKED', () => {
    expect(OPENING_READING_ROW_COMMIT).toBe('BLOCKED');
    expect(isOpeningReadingRowCommitBlocked()).toBe(true);
    expect(
      getModuleAdapter(WATER_MODULE_KEY)?.registration.legalOrOperationalGates,
    ).toContain('opening_reading_row_commit_BLOCKED');
  });
});

describe('IS-3 · water validation and classify', () => {
  const valid: Record<string, string> = {
    apartment_number: '12',
    meter_number: 'W-12-001',
    initial_reading: '0',
    installed_at: '2026-01-15',
  };

  it('accepts valid water row and rejects invalid reading/date', () => {
    expect(validateWaterMeterRow(valid)).toEqual([]);
    expect(validateWaterMeterRow({ ...valid, initial_reading: '-1' })).toContain(
      'invalid:initial_reading',
    );
    expect(validateWaterMeterRow({ ...valid, installed_at: 'not-a-date' })).toContain(
      'invalid:installed_at',
    );
    expect(parseInstalledAtDate('2099-01-01').ok).toBe(false);
  });

  it('CREATE for new apartment meter; SKIP existing active; unknown apartment ERROR', () => {
    const create = classifyWaterMeterOpeningRows([valid], waterCtx());
    expect(create.errorCount).toBe(0);
    expect(create.createCount).toBe(1);

    const skip = classifyWaterMeterOpeningRows(
      [valid],
      waterCtx({
        meters: [{ propertyId: 1, meterNumber: 'W-OLD', retiredAt: null }],
      }),
    );
    expect(skip.skipCount).toBe(1);
    expect(skip.createCount).toBe(0);

    const unknown = classifyWaterMeterOpeningRows(
      [{ ...valid, apartment_number: '999' }],
      waterCtx(),
    );
    expect(unknown.errorCount).toBe(1);
    expect(unknown.rows[0]?.errors).toContain('unknown_apartment');
  });

  it('detects duplicate serial in file and against existing', () => {
    const dupFile = classifyWaterMeterOpeningRows(
      [valid, { ...valid, apartment_number: '14', meter_number: 'W-12-001' }],
      waterCtx(),
    );
    expect(dupFile.rows.some((r) => r.errors.includes('duplicate_in_file:meter_number'))).toBe(
      true,
    );

    const dupDb = classifyWaterMeterOpeningRows(
      [valid],
      waterCtx({
        meters: [{ propertyId: 2, meterNumber: 'W-12-001', retiredAt: '2020-01-01' }],
      }),
    );
    expect(dupDb.rows[0]?.errors).toContain('duplicate_serial:meter_number');
  });

  it('builds assign payloads only for CREATE and never implies submit reading', () => {
    const preview = classifyWaterMeterOpeningRows(
      [
        valid,
        {
          apartment_number: '14',
          meter_number: 'W-14-001',
          initial_reading: '1',
          installed_at: '2026-01-15',
        },
      ],
      waterCtx({
        meters: [{ propertyId: 2, meterNumber: 'W-X', retiredAt: null }],
      }),
    );
    // apt 14 SKIP; apt 12 CREATE
    const payloads = waterAssignPayloadsFromPreview(preview);
    expect(payloads).toHaveLength(1);
    expect(payloads[0]?.propertyId).toBe(1);
    expect(preview.rows.every((r) => r.data.opening_reading_row_commit === 'BLOCKED')).toBe(true);
  });
});

describe('IS-3 · electricity validation and classify', () => {
  const valid: Record<string, string> = {
    apartment_number: '12',
    meter_number: 'E-12-001',
    initial_day_reading: '10',
    initial_night_reading: '5',
    installed_at: '2026-01-15',
  };

  it('valid electricity import CREATE and invalid night reading', () => {
    expect(validateElectricityMeterRow(valid)).toEqual([]);
    expect(validateElectricityMeterRow({ ...valid, initial_night_reading: '' })).toContain(
      'invalid:initial_night_reading',
    );
    const preview = classifyElectricityMeterOpeningRows([valid], waterCtx());
    expect(preview.createCount).toBe(1);
    const payloads = electricityAssignPayloadsFromPreview(preview);
    expect(payloads[0]).toMatchObject({
      propertyId: 1,
      initialDayReading: 10,
      initialNightReading: 5,
    });
  });

  it('preserves existing active electricity meter as SKIP (no replace)', () => {
    const preview = classifyElectricityMeterOpeningRows(
      [valid],
      waterCtx({
        meters: [{ propertyId: 1, meterNumber: 'E-OLD', retiredAt: null }],
      }),
    );
    expect(preview.skipCount).toBe(1);
    expect(electricityAssignPayloadsFromPreview(preview)).toHaveLength(0);
  });
});

describe('IS-3 · XLSX templates', () => {
  it('builds water and electricity templates with instruction sheets', () => {
    const waterBuf = buildWaterMeterIs3TemplateBuffer();
    const elBuf = buildElectricityMeterIs3TemplateBuffer();
    const waterWb = XLSX.read(waterBuf, { type: 'array' });
    const elWb = XLSX.read(elBuf, { type: 'array' });
    expect(waterWb.SheetNames).toEqual(
      expect.arrayContaining(['meters', 'instructions_bg', 'instructions_ru', 'instructions_en']),
    );
    expect(elWb.SheetNames).toEqual(
      expect.arrayContaining(['meters', 'instructions_bg', 'instructions_ru', 'instructions_en']),
    );

    bootstrapModuleSetupAdapters();
    const waterSchema = getModuleAdapter(WATER_MODULE_KEY)!.registration.setup!.xlsx!;
    const parsed = parseModuleXlsxBuffer(waterBuf, waterSchema);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.rows.length).toBeGreaterThanOrEqual(1);
  });
});

describe('IS-3 · unauthorized / isolation contract (client mirrors)', () => {
  beforeEach(() => {
    resetModuleSetupAdaptersForTests();
    bootstrapModuleSetupAdapters();
  });

  it('requires администрация role on adapters', () => {
    expect(getModuleAdapter(WATER_MODULE_KEY)?.registration.requiredRoles).toEqual([
      'администрация',
    ]);
    expect(getModuleAdapter(ELECTRICITY_MODULE_KEY)?.registration.requiredRoles).toEqual([
      'администрация',
    ]);
  });

  it('preview classification does not mutate meter lists (pure function)', () => {
    const meters = [{ propertyId: 1, meterNumber: 'W-1', retiredAt: null }];
    const before = JSON.stringify(meters);
    classifyWaterMeterOpeningRows(
      [
        {
          apartment_number: '12',
          meter_number: 'W-NEW',
          initial_reading: '0',
          installed_at: '2026-01-15',
        },
      ],
      waterCtx({ meters }),
    );
    expect(JSON.stringify(meters)).toBe(before);
  });
});
