import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { translate } from '@/i18n/translate';
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
  moduleChoiceToDraft,
  parseMetersSelected,
  parseModuleChoice,
  budgetPlanRequiresZeroConfirmation,
  firstRunBudgetDraftPayload,
  firstRunTariffSetupStage,
  firstRunTariffStepReady,
  formatFirstRunTariffPrepSummary,
  isAnnualTariffPrep,
  isElectricityTariffPrep,
  isFirstRunTariffPrepared,
  isFirstRunTariffPublished,
  isWaterTariffPrep,
  missingFirstRunTariffs,
  parseFirstRunBudgetDraft,
  readTariffPrep,
  requiredFirstRunTariffKeys,
  requiredFirstRunTariffKeysFromDraft,
  tariffFlagsFromModulesSelected,
  resolveFirstRunResumeStage,
  stageAfterCapitalRepairOpening,
  stageAfterModuleSave,
  tariffKeysForModules,
  validateComplexForm,
  validateMetersSelection,
  previousVisibleStage,
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
const MIG_TARIFFS_BUDGET = 'supabase/migrations/20261125180000_r1_rc8_first_run_tariffs_budget.sql';
const MIG_BUDGET_WIZARD = 'supabase/migrations/20261125190000_r1_rc8_first_run_budget_wizard.sql';
const MIG_TARIFF_PERIOD =
  'supabase/migrations/20261125200000_r1_rc8_first_run_tariff_period_ready.sql';
const PKG_WIZARD = '101_r1_rc8_first_run_wizard.sql';
const PKG_METERS = '102_r1_rc8_meters_multi_opening_balance.sql';
const PKG_TARIFFS_BUDGET = '106_r1_rc8_first_run_tariffs_budget.sql';
const PKG_BUDGET_WIZARD = '107_r1_rc8_first_run_budget_wizard.sql';
const PKG_TARIFF_PERIOD = '108_r1_rc8_first_run_tariff_period_ready.sql';

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
      'modules_select',
      'complex_card',
      'property_book',
      'meters_select',
      'meters_water',
      'meters_electricity',
      'support_fee_opening',
      'capital_repair_opening',
      'internet_opening',
      'tariffs',
      'budget',
      'uk_expenses_opening',
      'complete',
    ]);
  });
});

describe('R1-RC8 first-run · required published tariffs', () => {
  it('derives tariff blocks from persisted modules_selected (locked SF+CR always included)', () => {
    expect(requiredFirstRunTariffKeys({ water: true, electricity: false })).toEqual([
      'water',
      'support_fee',
      'capital_repair',
    ]);
    expect(requiredFirstRunTariffKeys({ water: false, electricity: true })).toEqual([
      'electricity',
      'support_fee',
      'capital_repair',
    ]);
    expect(
      requiredFirstRunTariffKeys({ water: true, electricity: true, internet: true }),
    ).toEqual(['water', 'electricity', 'internet', 'support_fee', 'capital_repair']);
    expect(
      tariffFlagsFromModulesSelected([
        'property_book',
        'water',
        'electricity',
        'internet',
        'support_fee',
        'capital_repair',
        'budget',
      ]),
    ).toEqual({
      water: true,
      electricity: true,
      internet: true,
      support_fee: true,
      capital_repair: true,
    });
    expect(
      requiredFirstRunTariffKeysFromDraft({
        modules_selected: ['water', 'electricity', 'internet'],
      }),
    ).toEqual(['water', 'electricity', 'internet']);
    expect(
      requiredFirstRunTariffKeysFromDraft({
        modules_selected: [
          'property_book',
          'support_fee',
          'capital_repair',
          'budget',
          'uk_expenses',
          'guest_mode',
          'water',
          'electricity',
          'internet',
        ],
      }),
    ).toEqual(['water', 'electricity', 'internet', 'support_fee', 'capital_repair']);
  });

  it('detects missing published versions without treating catalog rows as enough', () => {
    expect(isFirstRunTariffPublished(null)).toBe(false);
    expect(isFirstRunTariffPublished({ current_version_id: null })).toBe(false);
    expect(isFirstRunTariffPublished({ current_version_id: 'v1' })).toBe(true);
    expect(
      isFirstRunTariffPublished({
        current_version_id: null,
        nearest_future_version_id: 'future-v1',
      }),
    ).toBe(true);
    expect(
      missingFirstRunTariffs(
        ['water', 'support_fee', 'capital_repair'],
        [
          { tariff_key: 'water', current_version_id: 'w1' },
          { tariff_key: 'support_fee', current_version_id: null },
          { tariff_key: 'capital_repair', current_version_id: 'c1' },
        ],
      ),
    ).toEqual(['support_fee']);
  });

  it('accepts a prepared current rate and ignores a future-only version', () => {
    const annual = {
      rate_natural: 1.2,
      rate_legal: 1.4,
      basis_type: 'external_decision' as const,
      basis_reference: 'Решение 14',
      basis_date: '2024-03-01',
      basis_note: 'Протокол',
      decision_id: null,
    };
    expect(isAnnualTariffPrep(annual)).toBe(true);
    expect(isAnnualTariffPrep({ ...annual, basis_date: '' })).toBe(false);
    expect(isWaterTariffPrep({
      rate: 0,
      basis_type: 'supplier_notice',
      basis_reference: 'Счет 1',
      basis_date: null,
      basis_note: 'Вода',
    })).toBe(true);
    expect(isElectricityTariffPrep({
      day: 0.2,
      night: 0.1,
      basis_type: 'invoice',
      basis_reference: 'Фактура',
      basis_date: '2020-01-01',
      basis_note: 'Электро',
    })).toBe(true);
    expect(firstRunTariffStepReady('support_fee', { current_version_id: null }, { support_fee: annual })).toBe(true);
    expect(firstRunTariffStepReady('support_fee', { current_version_id: null }, {})).toBe(false);
    expect(firstRunTariffStepReady('water', { current_version_id: 'w1' }, {})).toBe(true);
  });

  it('maps each tariff to its service setup stage and restores one draft', () => {
    expect(firstRunTariffSetupStage('water')).toBe('meters_water');
    expect(firstRunTariffSetupStage('electricity')).toBe('meters_electricity');
    expect(firstRunTariffSetupStage('support_fee')).toBe('support_fee_opening');
    expect(firstRunTariffSetupStage('capital_repair')).toBe('capital_repair_opening');
    expect(firstRunTariffSetupStage('internet')).toBe('internet_opening');

    const draft = {
      tariff_prep: {
        water: {
          rate: 2.5,
          basis_type: 'supplier_notice',
          basis_reference: 'Счет',
          basis_date: '2026-01-01',
          basis_note: 'Вода',
        },
        electricity: {
          day: 0.22,
          night: 0.11,
          basis_type: 'invoice',
          basis_reference: 'Фактура',
          basis_date: '2026-01-01',
          basis_note: 'Электро',
        },
      },
    };
    const prep = readTariffPrep(draft);
    expect(isFirstRunTariffPrepared('water', prep)).toBe(true);
    expect(isFirstRunTariffPrepared('electricity', prep)).toBe(true);
    expect(isFirstRunTariffPrepared('support_fee', prep)).toBe(false);
    expect(formatFirstRunTariffPrepSummary('water', prep, (k) => k)).toContain('2.50 €/');
    expect(formatFirstRunTariffPrepSummary('electricity', prep, (k) => k)).toContain('0.22 €/');
    const sfPrep = {
      support_fee: {
        rate_natural: 8,
        rate_legal: 8,
        basis_type: 'external_decision' as const,
        decision_id: null,
        basis_reference: 'doc',
        basis_date: '2026-01-01',
        basis_note: 'SF',
      },
      capital_repair: {
        rate_natural: 2,
        rate_legal: 2,
        basis_type: 'external_decision' as const,
        decision_id: null,
        basis_reference: 'doc',
        basis_date: '2026-01-01',
        basis_note: 'CR',
      },
    };
    const unitT = (k: string) =>
      k === 'admin.perSqmYear'
        ? '€/м² в год'
        : k === 'admin.tcSubjectNatural'
          ? 'Физ. лица / ЕТ'
          : k === 'admin.tcSubjectLegal'
            ? 'Юр. лица'
            : k;
    const sfSummary = formatFirstRunTariffPrepSummary('support_fee', sfPrep, unitT);
    expect(sfSummary).toContain('€/м² в год');
    expect(sfSummary).not.toContain('апартамент');
    const crSummary = formatFirstRunTariffPrepSummary('capital_repair', sfPrep, unitT);
    expect(crSummary).toContain('€/м² в год');
    expect(crSummary).not.toContain('апартамент');
    expect(requiredFirstRunTariffKeys({ water: false, electricity: false, internet: false })).toEqual([
      'support_fee',
      'capital_repair',
    ]);
  });
});

describe('R1-RC8 first-run · budget draft helpers', () => {
  it('round-trips draft and requires zero confirmation only for empty plan', () => {
    expect(budgetPlanRequiresZeroConfirmation(0)).toBe(true);
    expect(budgetPlanRequiresZeroConfirmation(0.01)).toBe(false);
    const parsed = parseFirstRunBudgetDraft({
      budget_calendar_year: 2027,
      budget_year_id: 'y1',
      budget_decision_note: 'note',
      budget_zero_confirmed: 'true',
      budget_ui_step: 'review',
    });
    expect(parsed).toMatchObject({
      calendarYear: 2027,
      yearId: 'y1',
      decisionNote: 'note',
      zeroConfirmed: true,
      step: 'review',
    });
    expect(firstRunBudgetDraftPayload(parsed)).toMatchObject({
      budget_calendar_year: 2027,
      budget_zero_confirmed: true,
      budget_ui_step: 'review',
    });
  });
});

describe('R1-RC8 first-run · meters selection (optional)', () => {
  it('accepts an empty meter selection and either utility', () => {
    expect(validateMetersSelection({ water: false, electricity: false })).toEqual({ ok: true });
    expect(validateMetersSelection({ water: true, electricity: false }).ok).toBe(true);
    expect(validateMetersSelection({ water: false, electricity: true }).ok).toBe(true);
    expect(firstMetersStage({ water: false, electricity: false })).toBe('support_fee_opening');
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
    expect(visibleFirstRunStages({ water: true, electricity: false, budget: false })).toContain('budget');
    expect(visibleFirstRunStages({ water: false, electricity: true })).toContain('budget');
    expect(visibleFirstRunStages({ water: false, electricity: true })).not.toContain('meters_water');
    expect(visibleFirstRunStages(null)).not.toContain('meters_water');
    expect(visibleFirstRunStages(null)).toContain('budget');
    expect(visibleFirstRunStages(null)).toContain('modules_select');
    expect(visibleFirstRunStages(null)).not.toContain('meters_select');
  });

  it('previousVisibleStage follows the visible route and skips disabled stages', () => {
    const minimal = visibleFirstRunStages({ water: false, electricity: false, internet: false });
    expect(previousVisibleStage(minimal, 'welcome')).toBeNull();
    expect(previousVisibleStage(minimal, 'modules_select')).toBe('welcome');
    expect(previousVisibleStage(minimal, 'complex_card')).toBe('modules_select');
    expect(previousVisibleStage(minimal, 'property_book')).toBe('complex_card');
    expect(previousVisibleStage(minimal, 'support_fee_opening')).toBe('property_book');
    expect(previousVisibleStage(minimal, 'complete')).toBe('uk_expenses_opening');
    expect(previousVisibleStage(minimal, 'meters_select')).toBe('property_book');

    const full = visibleFirstRunStages({ water: true, electricity: true, internet: true });
    expect(previousVisibleStage(full, 'meters_electricity')).toBe('meters_water');
    expect(previousVisibleStage(full, 'support_fee_opening')).toBe('meters_electricity');
    expect(previousVisibleStage(full, 'internet_opening')).toBe('capital_repair_opening');
    expect(previousVisibleStage(full, 'tariffs')).toBe('internet_opening');
    expect(previousVisibleStage(full, 'budget')).toBe('tariffs');
  });

  it('routes capital repair to internet inventarisation before the tariffs checklist', () => {
    expect(stageAfterCapitalRepairOpening({ internet: true })).toBe('internet_opening');
    expect(stageAfterCapitalRepairOpening({ internet: false })).toBe('tariffs');
    expect(stageAfterCapitalRepairOpening(parseModuleChoice({ modules_selected: ['internet'] }))).toBe(
      'internet_opening',
    );
    const wizardSrc = readFileSync(path.join(process.cwd(), 'src/components/admin/AdminFirstRunWizard.tsx'), 'utf8');
    const crContinue = wizardSrc.match(/async function onCrContinue\(\)[\s\S]*?\n  \}/)?.[0] ?? '';
    expect(crContinue).toMatch(/stageAfterCapitalRepairOpening\(parseModuleChoice\(state\?\.draft\)\)/);
    expect(crContinue).toMatch(/nextStage:\s*next/);
    expect(crContinue).not.toMatch(/nextStage:\s*'tariffs'/);
    const financeSrc = readFileSync(path.join(process.cwd(), 'src/components/admin/FirstRunFinance.tsx'), 'utf8');
    expect(financeSrc).toMatch(/t\('admin\.firstRunCrContinue'\)/);
    const messagesSrc = readFileSync(path.join(process.cwd(), 'src/i18n/messages.ts'), 'utf8');
    expect(messagesSrc).toMatch(/firstRunCrContinue:\s*'Далее'/);
    expect(messagesSrc).toMatch(/firstRunSfContinue:\s*'Далее'/);
    // Budget/tariffs continue may name the next stage (em dash), but never use a colon suffix.
    expect(messagesSrc).toMatch(/firstRunBudgetContinue:\s*'Далее(?: — [^']+)?'/);
    expect(messagesSrc).toMatch(/firstRunOpeningContinue:\s*'Далее'/);
    expect(messagesSrc).not.toMatch(
      /firstRun(?:Sf|Cr|Tariffs|Budget|Opening)Continue:\s*'(?:Далее|Next|Напред):/,
    );
    expect(messagesSrc).toMatch(/firstRunCompleteFinish:\s*'Перейти в администрирование'/);
    expect(
      resolveFirstRunResumeStage({
        first_run_status: 'in_progress',
        first_run_stage: 'tariffs',
        draft: { modules_selected: ['internet', 'support_fee', 'capital_repair', 'budget'] },
        stages: [
          { stage_key: 'capital_repair_opening', status: 'complete' },
          { stage_key: 'tariffs', status: 'in_progress' },
        ],
        gate_required: true,
        complex: null,
      } as never),
    ).toBe('internet_opening');
    expect(
      tariffKeysForModules({
        water: true,
        electricity: false,
        internet: false,
        support_fee: true,
        capital_repair: true,
      }),
    ).toEqual(['water', 'support_fee', 'capital_repair']);
  });

  it('keeps a saved module choice and always keeps the budget selected', () => {
    expect(parseModuleChoice({})).toEqual({
      water: false,
      electricity: false,
      internet: false,
      budget: true,
      extra: [],
    });
    expect(parseModuleChoice({ meters_selected: ['water'], modules_selected: ['property_book'] })).toMatchObject({
      water: false,
      electricity: false,
      budget: true,
    });
    expect(
      moduleChoiceToDraft({
        water: false,
        electricity: true,
        internet: false,
        budget: false,
        extra: ['requests'],
      }),
    ).toEqual({
      modules_selected: ['property_book', 'support_fee', 'capital_repair', 'budget', 'uk_expenses', 'guest_mode', 'electricity', 'requests'],
      meters_selected: ['electricity'],
    });
    expect(requiredFirstRunTariffKeys({ water: false, electricity: true })).toEqual([
      'electricity',
      'support_fee',
      'capital_repair',
    ]);
    expect(
      stageAfterModuleSave(
        { water: true, electricity: false, internet: false, budget: false, extra: [] },
        [],
      ),
    ).toBe('complex_card');
    expect(
      stageAfterModuleSave(
        { water: true, electricity: false, internet: false, budget: true, extra: [] },
        [
          { stage_key: 'complex_card', status: 'complete' },
          { stage_key: 'property_book', status: 'complete' },
        ],
      ),
    ).toBe('meters_water');
  });
});

describe('R1-RC8 first-run · complex information form', () => {
  it('requires complex address, UK fields; optional empty bank rows', () => {
    expect(validateComplexForm(complexToForm(null))).toEqual(
      expect.arrayContaining([
        'display_name',
        'address_country',
        'address_city',
        'address_street',
        'address_building_number',
        'apartment_count',
        'mgmt_legal_name',
      ]),
    );
    const ok = complexToForm(null);
    Object.assign(ok, {
      display_name: 'Комплекс',
      address_country: 'България',
      address_city: 'София',
      address_postal_code: '1000',
      address_street: 'ул. Тест',
      address_building_number: '1',
      apartment_count: '24',
      contact_phone: '',
      contact_email: '',
      mgmt_legal_name: 'УК Пример ООД',
      mgmt_legal_form: 'ООД',
      mgmt_registration_country: 'България',
      mgmt_registration_number: '123456789',
      mgmt_vat_registered: false,
      mgmt_vat_number: '',
      mgmt_registered_address: 'София, ул. Юридическа 2',
      mgmt_correspondence_address: '',
      mgmt_representative_name: 'Иван Иванов',
      mgmt_representative_title: 'Управител',
      mgmt_phone: '+359888000000',
      mgmt_email: 'uk@example.test',
      bank_accounts: [
        {
          purpose: '',
          account_holder: '',
          bank_name: '',
          iban: '',
          bic_swift: '',
          currency: 'EUR',
          is_primary: true,
        },
      ],
    });
    expect(validateComplexForm(ok)).toEqual([]);
    expect(validateComplexForm({ ...ok, apartment_count: '0' })).toContain('apartment_count');
    expect(validateComplexForm({ ...ok, mgmt_vat_registered: true })).toContain('mgmt_vat_number');
    expect(complexFormToPayload(ok)).toMatchObject({
      apartment_count: 24,
      display_name: 'Комплекс',
      bank_accounts: [],
    });
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
      [MIG_TARIFFS_BUDGET, PKG_TARIFFS_BUDGET],
      [MIG_BUDGET_WIZARD, PKG_BUDGET_WIZARD],
      [MIG_TARIFF_PERIOD, PKG_TARIFF_PERIOD],
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
    expect(FRESH_INSTALL_ORDERED_FILES.indexOf(PKG_TARIFFS_BUDGET)).toBeGreaterThan(
      FRESH_INSTALL_ORDERED_FILES.indexOf('105_r1_rc8_first_run_capital_repair_opening.sql'),
    );
    expect(FRESH_INSTALL_ORDERED_FILES.indexOf(PKG_BUDGET_WIZARD)).toBeGreaterThan(
      FRESH_INSTALL_ORDERED_FILES.indexOf(PKG_TARIFFS_BUDGET),
    );
    expect(FRESH_INSTALL_ORDERED_FILES.indexOf(PKG_TARIFF_PERIOD)).toBeGreaterThan(
      FRESH_INSTALL_ORDERED_FILES.indexOf(PKG_BUDGET_WIZARD),
    );
  });

  it('MANIFEST lists 101–108 and chronological count matches disk', () => {
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
        PKG_TARIFFS_BUDGET,
        PKG_BUDGET_WIZARD,
        PKG_TARIFF_PERIOD,
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
        MIG_TARIFFS_BUDGET,
        MIG_BUDGET_WIZARD,
        MIG_TARIFF_PERIOD,
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
        MIG_TARIFFS_BUDGET,
        MIG_BUDGET_WIZARD,
        MIG_TARIFF_PERIOD,
      ]),
    );
    expect(manifest.expectedChronologicalMigrationCount).toBe(221);
    expect(manifest.chronologicalMigrationTree).toEqual(
      expect.arrayContaining([
        'supabase/migrations/20261130324000_r1_rc8_first_run_internet_before_tariffs_advance.sql',
        'supabase/migrations/20261130325000_r1_rc8_budget_plan_round_cents.sql',
      ]),
    );
  });

  it('tariffs + budget wizard use Core RPCs; assert requires published plan', () => {
    const tariffsUi = readFileSync(
      path.join(process.cwd(), 'src/components/admin/AdminFirstRunTariffs.tsx'),
      'utf8',
    );
    const tariffPrepUi = readFileSync(
      path.join(process.cwd(), 'src/components/admin/FirstRunTariffPrepBlock.tsx'),
      'utf8',
    );
    expect(tariffsUi).toContain('onSavePrep');
    expect(tariffsUi).not.toContain('publish_tariff_version');
    expect(tariffsUi).toContain('list_tariffs');
    expect(tariffsUi).toContain('FirstRunTariffPrepBlock');
    expect(tariffsUi).toContain('firstRunTariffGoToSetup');
    expect(tariffPrepUi).toContain('external_decision');
    expect(tariffPrepUi).toContain('tariff_prep');
    expect(tariffsUi).not.toContain('charge');
    const budgetUi = readFileSync(
      path.join(process.cwd(), 'src/components/admin/AdminFirstRunBudget.tsx'),
      'utf8',
    );
    expect(budgetUi).toContain('admin_commit_budget_plan');
    // Amounts + publish go through one atomic commit (all active categories),
    // not per-line upserts that could leave a partial draft.
    expect(budgetUi).toContain('commitPlanFromAmounts');
    expect(budgetUi).not.toContain('admin_upsert_budget_line');
    expect(budgetUi).toContain('admin_set_budget_year_status');
    expect(budgetUi).toContain("p_status: 'published'");
    expect(budgetUi).not.toContain("p_status: 'adopted'");
    expect(budgetUi).toContain('set_building_module_enabled');
    expect(budgetUi).toContain('zeroConfirmed');
    expect(budgetUi).toContain('firstRunBudgetDraftPayload');
    const wizard = readFileSync(
      path.join(process.cwd(), 'src/components/admin/AdminFirstRunWizard.tsx'),
      'utf8',
    );
    expect(wizard).toContain('AdminFirstRunTariffs');
    expect(wizard).toContain('AdminFirstRunBudget');
    expect(wizard).toContain('saveTariffPrep');
    expect(wizard).toContain("draft: { tariff_prep: next }");
    expect(wizard).toContain('FirstRunTariffPrepHandle');
    expect(wizard).toContain("nextStage: 'budget'");
    expect(wizard).toContain('activateModule(BUDGET_MODULE_KEY)');
    const metersUi = readFileSync(
      path.join(process.cwd(), 'src/components/admin/FirstRunSteps.tsx'),
      'utf8',
    );
    expect(metersUi).toContain('FirstRunTariffPrepBlock');
    expect(metersUi).toContain('firstRunSectionOpeningData');
    const financeUi = readFileSync(
      path.join(process.cwd(), 'src/components/admin/FirstRunFinance.tsx'),
      'utf8',
    );
    expect(financeUi).toContain('tariffKey="support_fee"');
    expect(financeUi).toContain('tariffKey="capital_repair"');
    const internetUi = readFileSync(
      path.join(process.cwd(), 'src/components/admin/AdminFirstRunInternetOpening.tsx'),
      'utf8',
    );
    expect(internetUi).toContain('tariffKey="internet"');
    const mig = readFileSync(path.join(process.cwd(), MIG_BUDGET_WIZARD), 'utf8');
    expect(mig).toContain('first_run_assert_budget_ready');
    expect(mig).toContain('zero budget plan requires confirmation');
    expect(mig).toContain('budget year % is closed');
    expect(mig).toContain('first_run_assert_tariffs_ready');
    expect(mig).not.toContain('budget stage not implemented');
    const activationMig = readFileSync(
      path.join(process.cwd(), 'supabase/migrations/20261130160000_r1_rc8_first_run_activation_tariffs.sql'),
      'utf8',
    );
    expect(activationMig).toContain('first_run_publish_activation_tariffs');
    expect(activationMig).toContain("at time zone 'Europe/Sofia'");
    expect(activationMig).toContain('first_run_activation_tariff_key');
    expect(activationMig).toContain('first_run_completed_at = coalesce(i.first_run_completed_at, v_activated_at)');
    expect(activationMig).not.toContain('insert into public.support_fee_assessments');
    expect(activationMig).not.toContain('insert into public.capital_repair_assessments');
    expect(activationMig).not.toContain('create or replace function public.first_run_tariff_has_published');
    const periodMig = readFileSync(path.join(process.cwd(), MIG_TARIFF_PERIOD), 'utf8');
    expect(periodMig).toContain('first_run_tariff_has_published');
    expect(periodMig).toContain('make_date(v_year, 1, 1)');
    expect(periodMig).toContain('published support_fee tariff for year % required');
    expect(periodMig).toContain('published capital_repair tariff for year % required');
    const legalMig = readFileSync(
      path.join(process.cwd(), 'supabase/migrations/20261130180000_r1_rc8_legal_entity_electricity.sql'),
      'utf8',
    );
    expect(legalMig).toContain('confirm_electricity_legal_charge');
    expect(legalMig).toContain('p_day_rate');
    expect(legalMig).toContain('legal-entity calculation does not apply');
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

  it('oneshot migration freezes first-run and locks completed module setup', () => {
    const oneshot = readFileSync(
      path.join(process.cwd(), 'supabase/migrations/20261130320600_r1_rc8_initial_setup_oneshot.sql'),
      'utf8',
    );
    expect(oneshot).toContain('module_initial_setup_completed');
    expect(oneshot).toContain('admin_assert_module_initial_setup_writable');
    expect(oneshot).toContain('initial_setup_already_complete');
    expect(oneshot).toContain("first_run_status = 'complete'");
    expect(oneshot).toContain('return public.admin_get_first_run_state()');
    expect(oneshot).toContain("v_to in ('SETUP_REQUIRED', 'SETUP_IN_PROGRESS')");
    expect(oneshot).toContain('admin_save_module_setup_progress');
    expect(oneshot).toContain('admin_create_module_import_batch');
    const setupUi = readFileSync(
      path.join(process.cwd(), 'src/components/admin/AdminInitialSetup.tsx'),
      'utf8',
    );
    expect(setupUi).toContain("row?.status === 'complete'");
    expect(setupUi).toContain('MODULE_SETUP_SELECTED_KEY');
  });

  it('returns to welcome via the wizard route without completing that stage again', () => {
    const wizard = readFileSync(
      path.join(process.cwd(), 'src/components/admin/AdminFirstRunWizard.tsx'),
      'utf8',
    );
    expect(wizard).toContain('handleWizardBack');
    expect(wizard).toContain('previousVisibleStage');
    expect(wizard).toContain('setWelcomePassed(true)');
    expect(wizard).toContain("prev === 'welcome'");
    expect(wizard).toContain('resume={welcomePassed}');
    expect(wizard).toContain('if (welcomePassed)');
    expect(wizard).toContain('persistDraftBeforeBack');
    expect(wizard).not.toContain('history.back');
    const frame = readFileSync(path.join(process.cwd(), 'src/components/admin/FirstRunFrame.tsx'), 'utf8');
    expect(frame).toContain('FirstRunStageActions');
    expect(frame).toContain('admin.firstRunWelcomeResume');
    expect(frame).toContain('admin.firstRunBack');
    expect(translate('ru', 'admin.firstRunWelcomeResume')).toBe('Продолжить настройку');
    expect(translate('en', 'admin.firstRunWelcomeResume')).toBe('Continue setup');
    expect(translate('bg', 'admin.firstRunWelcomeResume')).toBe('Продължи настройката');
    expect(translate('ru', 'admin.firstRunBack')).toBe('Назад');
    expect(translate('en', 'admin.firstRunFileReselectHint')).toContain('confirmed import');
    expect(translate('ru', 'admin.firstRunLeaveWithoutSave')).toContain('черновик');
    expect(translate('bg', 'admin.firstRunStay')).toBe('Остани');
  });
});


