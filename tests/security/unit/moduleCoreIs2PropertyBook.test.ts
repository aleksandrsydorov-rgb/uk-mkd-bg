import { describe, expect, it, beforeEach } from 'vitest';
import * as XLSX from 'xlsx';
import {
  PROPERTY_BOOK_MODULE_KEY,
  PROPERTY_BOOK_SETUP_SCHEMA_VERSION,
  bootstrapModuleSetupAdapters,
  buildPropertyBookIs2TemplateBuffer,
  classifyPropertyBookOpeningRows,
  getModuleAdapter,
  listRegisteredModuleKeys,
  previewFromPropertyBookDryRun,
  resetModuleSetupAdaptersForTests,
  setupCompleteFromDraft,
  setupSupportsManual,
  setupSupportsXlsx,
  validatePropertyBookObjectProps,
  validatePropertyBookOwnerRow,
} from '@/lib/moduleCore';
import { parsePropertyBookWorkbookBuffer } from '@/lib/propertyBookAdmin';
import { isBuildingModuleEnabled, emptyBuildingModulesState } from '@/lib/modules';

describe('IS-2 · Property Book adapter registration', () => {
  beforeEach(() => {
    resetModuleSetupAdaptersForTests();
    bootstrapModuleSetupAdapters();
  });

  it('registers property_book outside catalog hardcoding', () => {
    const keys = listRegisteredModuleKeys();
    expect(keys).toContain(PROPERTY_BOOK_MODULE_KEY);
    const adapter = getModuleAdapter(PROPERTY_BOOK_MODULE_KEY);
    expect(adapter?.registration.requiresInitialSetup).toBe(true);
    expect(adapter?.registration.setup?.schemaVersion).toBe(PROPERTY_BOOK_SETUP_SCHEMA_VERSION);
    expect(adapter?.registration.setup?.idempotent).toBe(true);
    expect(setupSupportsXlsx(adapter?.registration.setup)).toBe(true);
    expect(setupSupportsManual(adapter?.registration.setup)).toBe(true);
    expect(adapter?.registration.legalOrOperationalGates).toContain('no_overwrite_existing_ownership');
  });

  it('rejects untrusted property_id and requires confirm or verified-existing', () => {
    const adapter = getModuleAdapter(PROPERTY_BOOK_MODULE_KEY)!;
    expect(adapter.validateManual?.({ property_id: 1, confirmed: true })).toEqual({
      ok: false,
      errors: ['untrusted_property_id'],
    });
    expect(adapter.validateManual?.({})).toEqual({
      ok: false,
      errors: ['required:confirmed_or_verified_existing'],
    });
    expect(adapter.validateManual?.({ confirmed: true })).toEqual({ ok: true });
    expect(adapter.validateManual?.({ verified_existing_readonly: true })).toEqual({ ok: true });
  });

  it('setup complete when confirmed', () => {
    const reg = getModuleAdapter(PROPERTY_BOOK_MODULE_KEY)!.registration;
    expect(setupCompleteFromDraft(reg, {})).toBe(false);
    expect(setupCompleteFromDraft(reg, { confirmed: true })).toBe(true);
  });
});

describe('IS-2 · validation + CREATE/UPDATE/SKIP/ERROR', () => {
  const soleObject: Record<string, string> = {
    apartment_number: '12',
    purpose: 'апартамент',
    area_sqm: '78',
    ideal_parts_percent: '1.2',
    ownership_type: 'sole',
  };
  const soleOwner: Record<string, string> = {
    apartment_number: '12',
    entity_kind: 'natural_person',
    ownership_share_percent: '100',
    ideal_parts_percent: '1.2',
    first_name: 'Иван',
    last_name: 'Иванов',
  };
  const sharedObjects: Record<string, string> = {
    apartment_number: '14',
    purpose: 'апартамент',
    area_sqm: '90',
    ideal_parts_percent: '2',
    ownership_type: 'shared',
  };
  const legalOwner: Record<string, string> = {
    apartment_number: '14',
    entity_kind: 'legal_entity',
    ownership_share_percent: '40',
    ideal_parts_percent: '0.8',
    entity_name: 'EXAMPLE EOOD',
    eik_bulstat: '123456789',
  };
  const naturalCoOwner: Record<string, string> = {
    apartment_number: '14',
    entity_kind: 'natural_person',
    ownership_share_percent: '60',
    ideal_parts_percent: '1.2',
    first_name: 'Анна',
    last_name: 'Петрова',
  };
  const multiOwners = [naturalCoOwner, legalOwner];

  it('validates object and owner rows including legal entity', () => {
    expect(validatePropertyBookObjectProps(soleObject)).toEqual([]);
    expect(validatePropertyBookOwnerRow(soleOwner)).toEqual([]);
    expect(validatePropertyBookOwnerRow(legalOwner)).toEqual([]);
    expect(validatePropertyBookOwnerRow({ ...soleOwner, property_id: '9' })).toContain(
      'untrusted_property_id',
    );
  });

  it('new empty install: CREATE when allowCreateMissing', () => {
    const preview = classifyPropertyBookOpeningRows(
      { objects: [soleObject, sharedObjects], owners: [soleOwner, ...multiOwners] },
      [],
      { allowOverwrite: false, allowCreateMissing: true },
    );
    expect(preview.errorCount).toBe(0);
    expect(preview.createCount).toBeGreaterThan(0);
    expect(preview.updateCount).toBe(0);
  });

  it('populated install: existing apartments SKIP (preserve ownership)', () => {
    const preview = classifyPropertyBookOpeningRows(
      { objects: [soleObject], owners: [soleOwner] },
      ['12'],
      { allowOverwrite: false, allowCreateMissing: false },
    );
    expect(preview.skipCount).toBeGreaterThan(0);
    expect(preview.updateCount).toBe(0);
    expect(preview.createCount).toBe(0);
    expect(preview.rows.every((r) => r.operation === 'skip' || r.operation === 'error')).toBe(true);
  });

  it('missing apartments without allowCreate → ERROR', () => {
    const preview = classifyPropertyBookOpeningRows(
      { objects: [soleObject], owners: [soleOwner] },
      [],
      { allowOverwrite: false, allowCreateMissing: false },
    );
    expect(preview.errorCount).toBeGreaterThan(0);
    expect(
      preview.rows.some((r) => r.errors.includes('missing_apartment:confirm_create_required')),
    ).toBe(true);
  });

  it('duplicate apartment in file → ERROR', () => {
    const preview = classifyPropertyBookOpeningRows(
      {
        objects: [soleObject, { ...soleObject }],
        owners: [soleOwner],
      },
      [],
      { allowOverwrite: false, allowCreateMissing: true },
    );
    expect(preview.rows.some((r) => r.errors.includes('duplicate_in_file:apartment_number'))).toBe(
      true,
    );
  });

  it('overwrite policy maps existing to UPDATE only when allowed', () => {
    const skip = classifyPropertyBookOpeningRows(
      { objects: [soleObject], owners: [soleOwner] },
      ['12'],
      { allowOverwrite: false, allowCreateMissing: true },
    );
    const upd = classifyPropertyBookOpeningRows(
      { objects: [soleObject], owners: [soleOwner] },
      ['12'],
      { allowOverwrite: true, allowCreateMissing: true },
    );
    expect(skip.updateCount).toBe(0);
    expect(upd.updateCount).toBeGreaterThan(0);
  });

  it('maps RPC dry-run payload into CREATE/UPDATE/SKIP/ERROR counters', () => {
    const mapped = previewFromPropertyBookDryRun({
      existing_properties: [{ apartment_number: '1' }],
      new_properties: [{ apartment_number: '2' }],
      changes: [{ apartment_number: '3' }],
      duplicates: [{ apartment_number: '4' }],
      errors: ['x'],
    });
    expect(mapped.skipCount).toBe(1);
    expect(mapped.createCount).toBe(1);
    expect(mapped.updateCount).toBe(1);
    expect(mapped.errorCount).toBe(2);
  });
});

describe('IS-2 · XLSX template BG/RU/EN', () => {
  it('builds multi-sheet template with instruction locales', () => {
    const buf = buildPropertyBookIs2TemplateBuffer();
    expect(buf.byteLength).toBeGreaterThan(500);
    const parsed = parsePropertyBookWorkbookBuffer(buf);
    expect(parsed.objects.length).toBeGreaterThanOrEqual(1);
    expect(parsed.owners.length).toBeGreaterThanOrEqual(1);
    const wb = XLSX.read(buf, { type: 'array' });
    expect(wb.SheetNames).toContain('objects');
    expect(wb.SheetNames).toContain('owners');
    expect(wb.SheetNames).toContain('instructions_bg');
    expect(wb.SheetNames).toContain('instructions_ru');
    expect(wb.SheetNames).toContain('instructions_en');
  });
});

describe('IS-2 · module UX compatibility', () => {
  it('does not flip building module UX helpers', () => {
    const state = emptyBuildingModulesState();
    expect(isBuildingModuleEnabled(state, 'guest_mode')).toBe(false);
  });
});
