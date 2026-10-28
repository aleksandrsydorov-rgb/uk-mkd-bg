import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FIRST_RUN_SECTION,
  FIRST_RUN_STAGES,
  FIRST_RUN_WIZARD_PATH,
  apartmentCountMismatchInfo,
  complexFormToPayload,
  complexToForm,
  firstMetersStage,
  hasApartmentCountMismatch,
  isFirstRunGateRequired,
  lifecyclePathToActive,
  metersSelectedToDraft,
  nextAfterMetersStage,
  normalizeFirstRunErrors,
  parseFirstRunState,
  parseMetersSelected,
  resolveFirstRunResumeStage,
  validateComplexForm,
  validateMetersSelection,
  visibleFirstRunStages,
} from '@/lib/firstRun';
import {
  FRESH_INSTALL_ORDERED_FILES,
  FRESH_INSTALL_PACKAGE_DIR,
  buildApartmentLookup,
  classifyElectricityMeterOpeningRows,
  classifyWaterMeterOpeningRows,
  existingActiveSerialsFromMeters,
  existingMetersBySerialFromMeters,
  validateOpeningBalanceFields,
  WATER_METER_HEADERS,
  ELECTRICITY_METER_HEADERS,
} from '@/lib/moduleCore';

const MIG_WIZARD = 'supabase/migrations/20261125120000_r1_rc8_first_run_wizard.sql';
const MIG_METERS = 'supabase/migrations/20261125130000_r1_rc8_meters_multi_opening_balance.sql';
const PKG_WIZARD = '101_r1_rc8_first_run_wizard.sql';
const PKG_METERS = '102_r1_rc8_meters_multi_opening_balance.sql';

function ctx(meters: Array<{ propertyId: number; meterNumber: string; retiredAt: string | null }> = []) {
  return {
    apartmentsByNumber: buildApartmentLookup([
      { property_id: 1, apartment_number: '12' },
      { property_id: 2, apartment_number: '14' },
    ]),
    existingActiveSerials: existingActiveSerialsFromMeters(meters),
    existingMetersBySerial: existingMetersBySerialFromMeters(meters),
    policy: { allowReplace: false as const },
  };
}

const waterRow = (apt: string, serial: string, extra: Record<string, string> = {}) => ({
  apartment_number: apt,
  meter_number: serial,
  initial_reading: '0',
  installed_at: '2026-01-15',
  ...extra,
});

describe('R1-RC8 first-run · gate + resume', () => {
  it('uses a dedicated section id for the forced wizard path', () => {
    expect(FIRST_RUN_SECTION).toBe('first_run');
    expect(FIRST_RUN_WIZARD_PATH).toBe('/admin?section=first_run');
  });

  it('gate follows server gate_required only (not properties count)', () => {
    expect(isFirstRunGateRequired(null)).toBe(false);
    expect(
      isFirstRunGateRequired(parseFirstRunState({ ok: true, first_run_status: 'pending', gate_required: true })),
    ).toBe(true);
    expect(
      isFirstRunGateRequired(
        parseFirstRunState({ ok: true, first_run_status: 'complete', gate_required: false }),
      ),
    ).toBe(false);
  });

  it('parses state and resumes at first_run_stage; complete resumes at complete', () => {
    const mid = parseFirstRunState({
      ok: true,
      first_run_status: 'in_progress',
      first_run_stage: 'meters_select',
      gate_required: true,
      complex: { display_name: 'Тест', address: 'ул. 1', apartment_count: 12 },
      draft: { meters_selected: ['water'] },
      stages: [],
    });
    expect(mid?.complex.apartment_count).toBe(12);
    expect(resolveFirstRunResumeStage(mid)).toBe('meters_select');

    const done = parseFirstRunState({
      ok: true,
      first_run_status: 'complete',
      first_run_stage: 'complete',
      gate_required: false,
    });
    expect(resolveFirstRunResumeStage(done)).toBe('complete');
    expect(resolveFirstRunResumeStage(null)).toBe('welcome');
    expect(
      resolveFirstRunResumeStage(parseFirstRunState({ first_run_status: 'pending', first_run_stage: 'bogus' })),
    ).toBe('welcome');
    expect(parseFirstRunState('nope')).toBeNull();
  });

  it('stage list mirrors the SQL catalog order', () => {
    expect([...FIRST_RUN_STAGES]).toEqual([
      'welcome',
      'complex_card',
      'property_book',
      'meters_select',
      'meters_water',
      'meters_electricity',
      'support_fee_opening',
      'capital_repair_opening',
      'tariffs',
      'complete',
    ]);
  });
});

describe('R1-RC8 first-run · meters selection (≥1 required)', () => {
  it('rejects empty selection and accepts either utility', () => {
    expect(validateMetersSelection({ water: false, electricity: false })).toEqual({
      ok: false,
      error: 'at_least_one',
    });
    expect(validateMetersSelection({ water: true, electricity: false }).ok).toBe(true);
    expect(validateMetersSelection({ water: false, electricity: true }).ok).toBe(true);
  });

  it('round-trips draft meters_selected and routes stages', () => {
    const sel = { water: true, electricity: true };
    expect(metersSelectedToDraft(sel)).toEqual(['water', 'electricity']);
    expect(parseMetersSelected({ meters_selected: ['electric', 'WATER'] })).toEqual(sel);
    expect(parseMetersSelected({})).toEqual({ water: false, electricity: false });

    expect(firstMetersStage(sel)).toBe('meters_water');
    expect(firstMetersStage({ water: false, electricity: true })).toBe('meters_electricity');
    expect(nextAfterMetersStage('meters_water', sel)).toBe('meters_electricity');
    expect(nextAfterMetersStage('meters_water', { water: true, electricity: false })).toBe(
      'support_fee_opening',
    );
    expect(nextAfterMetersStage('meters_electricity', sel)).toBe('support_fee_opening');
  });

  it('hides unselected meter stages from progress', () => {
    expect(visibleFirstRunStages({ water: true, electricity: false })).not.toContain('meters_electricity');
    expect(visibleFirstRunStages({ water: false, electricity: true })).not.toContain('meters_water');
    expect(visibleFirstRunStages(null)).toContain('meters_water');
  });
});

describe('R1-RC8 first-run · complex card form', () => {
  it('requires name, address and positive integer apartment count', () => {
    expect(validateComplexForm(complexToForm(null))).toEqual(
      expect.arrayContaining(['display_name', 'address', 'apartment_count']),
    );
    const ok = {
      display_name: 'Комплекс',
      address: 'ул. Тест 1',
      apartment_count: '24',
      contact_phone: '',
      contact_email: '',
    };
    expect(validateComplexForm(ok)).toEqual([]);
    expect(validateComplexForm({ ...ok, apartment_count: '0' })).toContain('apartment_count');
    expect(validateComplexForm({ ...ok, apartment_count: '2.5' })).toContain('apartment_count');
    expect(validateComplexForm({ ...ok, contact_email: 'nope' })).toContain('contact_email');
    expect(complexFormToPayload(ok)).toMatchObject({ apartment_count: 24, display_name: 'Комплекс' });
  });
});

describe('R1-RC8 first-run · import error helpers', () => {
  it('normalizes sheet/row/field/reason and detects apartment_count_mismatch', () => {
    const errors = [
      { sheet: 'objects', row: 3, field: 'area_sqm', code: 'area_sqm_invalid', reason: 'area_sqm_invalid', apartment_number: '12' },
      { sheet: 'objects', field: 'apartment_count', code: 'apartment_count_mismatch', reason: 'apartment_count_mismatch', expected: 24, actual: 23 },
    ];
    const rows = normalizeFirstRunErrors(errors);
    expect(rows[0]).toMatchObject({ sheet: 'objects', row: '3', field: 'area_sqm', apartment: '12' });
    expect(hasApartmentCountMismatch(errors)).toBe(true);
    expect(apartmentCountMismatchInfo(errors)).toEqual({ expected: 24, actual: 23 });
    expect(hasApartmentCountMismatch([])).toBe(false);
  });
});

describe('R1-RC8 first-run · module lifecycle path', () => {
  it('walks strict transitions to ACTIVE', () => {
    expect(lifecyclePathToActive('DISABLED')).toEqual([
      'SETUP_REQUIRED',
      'SETUP_IN_PROGRESS',
      'READY',
      'ACTIVE',
    ]);
    expect(lifecyclePathToActive(undefined)[0]).toBe('SETUP_REQUIRED');
    expect(lifecyclePathToActive('SETUP_IN_PROGRESS')).toEqual(['READY', 'ACTIVE']);
    expect(lifecyclePathToActive('READY')).toEqual(['ACTIVE']);
    expect(lifecyclePathToActive('ACTIVE')).toEqual([]);
  });
});

describe('R1-RC8 meters · multi-meter classify + opening balance', () => {
  it('creates a second meter on an apartment that already has an active meter', () => {
    const preview = classifyWaterMeterOpeningRows(
      [waterRow('12', 'W-12-002')],
      ctx([{ propertyId: 1, meterNumber: 'W-12-001', retiredAt: null }]),
    );
    expect(preview.createCount).toBe(1);
    expect(preview.errorCount).toBe(0);
  });

  it('allows several rows for the same apartment (no duplicate_in_file:apartment_number)', () => {
    const preview = classifyWaterMeterOpeningRows(
      [waterRow('12', 'W-12-001'), waterRow('12', 'W-12-002')],
      ctx(),
    );
    expect(preview.createCount).toBe(2);
    expect(preview.rows.flatMap((r) => r.errors)).not.toContain('duplicate_in_file:apartment_number');
  });

  it('skips an existing serial on the same apartment; errors when serial belongs elsewhere', () => {
    const skip = classifyWaterMeterOpeningRows(
      [waterRow('12', 'W-12-001')],
      ctx([{ propertyId: 1, meterNumber: 'W-12-001', retiredAt: null }]),
    );
    expect(skip.skipCount).toBe(1);
    expect(skip.createCount).toBe(0);

    const other = classifyWaterMeterOpeningRows(
      [waterRow('12', 'W-14-001')],
      ctx([{ propertyId: 2, meterNumber: 'W-14-001', retiredAt: null }]),
    );
    expect(other.rows[0]?.errors).toContain('duplicate_serial:meter_number');
  });

  it('still rejects duplicate meter_number inside the file', () => {
    const preview = classifyWaterMeterOpeningRows(
      [waterRow('12', 'W-DUP'), waterRow('14', 'W-DUP')],
      ctx(),
    );
    expect(preview.rows.some((r) => r.errors.includes('duplicate_in_file:meter_number'))).toBe(true);
  });

  it('electricity classify is multi-meter too', () => {
    const base = {
      apartment_number: '12',
      initial_day_reading: '1',
      initial_night_reading: '1',
      installed_at: '2026-01-15',
    };
    const preview = classifyElectricityMeterOpeningRows(
      [
        { ...base, meter_number: 'E-1' },
        { ...base, meter_number: 'E-2' },
      ],
      ctx([{ propertyId: 1, meterNumber: 'E-0', retiredAt: null }]),
    );
    expect(preview.createCount).toBe(2);
  });

  it('validates opening_balance_kind / opening_balance_eur', () => {
    expect(validateOpeningBalanceFields({})).toEqual([]);
    expect(validateOpeningBalanceFields({ opening_balance_kind: 'zero' })).toEqual([]);
    expect(validateOpeningBalanceFields({ opening_balance_kind: 'bogus' })).toEqual([
      'invalid:opening_balance_kind',
    ]);
    expect(validateOpeningBalanceFields({ opening_balance_kind: 'debt' })).toEqual([
      'required:opening_balance_eur',
    ]);
    expect(
      validateOpeningBalanceFields({ opening_balance_kind: 'overpayment', opening_balance_eur: '12,50' }),
    ).toEqual([]);

    const bad = classifyWaterMeterOpeningRows(
      [waterRow('12', 'W-1', { opening_balance_kind: 'debt', opening_balance_eur: '' })],
      ctx(),
    );
    expect(bad.errorCount).toBe(1);
    expect(bad.rows[0]?.errors).toContain('required:opening_balance_eur');
  });

  it('template headers include opening balance columns', () => {
    expect([...WATER_METER_HEADERS]).toEqual(
      expect.arrayContaining(['opening_balance_kind', 'opening_balance_eur']),
    );
    expect([...ELECTRICITY_METER_HEADERS]).toEqual(
      expect.arrayContaining(['opening_balance_kind', 'opening_balance_eur']),
    );
  });
});

describe('R1-RC8 first-run · packaging', () => {
  it('package stubs exist after Book package; full SQL is chronological-only', () => {
    for (const [mig, pkg] of [
      [MIG_WIZARD, PKG_WIZARD],
      [MIG_METERS, PKG_METERS],
    ] as const) {
      const pkgPath = path.join(process.cwd(), FRESH_INSTALL_PACKAGE_DIR, pkg);
      expect(existsSync(pkgPath)).toBe(true);
      expect(existsSync(path.join(process.cwd(), mig))).toBe(true);
      const pkgSql = readFileSync(pkgPath, 'utf8');
      expect(pkgSql).toMatch(/package stub|chronological migration/i);
      expect(pkgSql.length).toBeLessThan(readFileSync(path.join(process.cwd(), mig), 'utf8').length);
      expect(FRESH_INSTALL_ORDERED_FILES).toContain(pkg);
    }
    expect(FRESH_INSTALL_ORDERED_FILES.indexOf(PKG_WIZARD)).toBeGreaterThan(
      FRESH_INSTALL_ORDERED_FILES.indexOf('100_r1_rc8_property_book_shared_mixed_owners.sql'),
    );
    expect(FRESH_INSTALL_ORDERED_FILES.indexOf(PKG_METERS)).toBeGreaterThan(
      FRESH_INSTALL_ORDERED_FILES.indexOf(PKG_WIZARD),
    );
  });

  it('MANIFEST lists 101/102/103/104/105 and chronological count 148', () => {
    const manifest = JSON.parse(
      readFileSync(path.join(process.cwd(), FRESH_INSTALL_PACKAGE_DIR, 'MANIFEST.json'), 'utf8'),
    ) as {
      orderedFiles: string[];
      chronologicalMigrationsPackaged: string[];
      chronologicalMigrationTree: string[];
      expectedChronologicalMigrationCount: number;
    };
    expect(manifest.orderedFiles).toEqual(
      expect.arrayContaining([
        PKG_WIZARD,
        PKG_METERS,
        '103_r1_rc8_first_run_support_fee_opening.sql',
        '104_r1_rc8_support_fee_opening_close.sql',
        '105_r1_rc8_first_run_capital_repair_opening.sql',
      ]),
    );
    expect(manifest.chronologicalMigrationsPackaged).toEqual(
      expect.arrayContaining([
        MIG_WIZARD,
        MIG_METERS,
        'supabase/migrations/20261125140000_r1_rc8_first_run_hardening.sql',
        'supabase/migrations/20261125150000_r1_rc8_first_run_support_fee_opening.sql',
        'supabase/migrations/20261125160000_r1_rc8_support_fee_opening_close.sql',
        'supabase/migrations/20261125170000_r1_rc8_first_run_capital_repair_opening.sql',
      ]),
    );
    expect(manifest.chronologicalMigrationTree).toEqual(
      expect.arrayContaining([
        MIG_WIZARD,
        MIG_METERS,
        'supabase/migrations/20261125140000_r1_rc8_first_run_hardening.sql',
        'supabase/migrations/20261125150000_r1_rc8_first_run_support_fee_opening.sql',
        'supabase/migrations/20261125160000_r1_rc8_support_fee_opening_close.sql',
        'supabase/migrations/20261125170000_r1_rc8_first_run_capital_repair_opening.sql',
      ]),
    );
    expect(manifest.expectedChronologicalMigrationCount).toBe(148);
  });

  it('admin gate wiring renders wizard, blocks on RPC error, reads server gate state', () => {
    const page = readFileSync(path.join(process.cwd(), 'src/app/admin/page.tsx'), 'utf8');
    expect(page).toContain('AdminFirstRunWizard');
    expect(page).toContain('isFirstRunGateRequired(firstRunState)');
    expect(page).toContain('firstRunLoadError');
    expect(page).toContain('firstRunRetry');
    const boot = readFileSync(path.join(process.cwd(), 'src/lib/firstBoot.ts'), 'utf8');
    expect(boot).toContain('fetchFirstRunState');
    expect(boot).toContain('!result.ok');
    expect(boot).not.toContain(".from('properties')");
  });
});

