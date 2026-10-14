import { describe, expect, it, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  activationBlockedReasons,
  assertSafeUpload,
  bootstrapModuleSetupAdapters,
  buildImportPreview,
  buildModuleXlsxTemplate,
  canTransitionModuleLifecycle,
  dependenciesSatisfied,
  getModuleAdapter,
  initialTargetState,
  listRegisteredModuleKeys,
  parseModuleXlsxBuffer,
  reactivationReusesSetup,
  resetModuleSetupAdaptersForTests,
  sanitizeSpreadsheetCell,
  setupCompleteFromDraft,
  setupIsOptional,
  suspensionPreservesData,
} from '@/lib/moduleCore';
import { isBuildingModuleEnabled, emptyBuildingModulesState } from '@/lib/modules';

const MIGRATION = path.resolve(
  process.cwd(),
  'supabase/migrations/20261022120000_initial_setup_module_core.sql',
);

describe('IS-1 · module registration contract', () => {
  beforeEach(() => {
    resetModuleSetupAdaptersForTests();
    bootstrapModuleSetupAdapters();
  });

  it('discovers registered adapters without a fixed 12/35 list in lifecycle', () => {
    const keys = listRegisteredModuleKeys();
    expect(keys).toContain('example_opening_roster');
    expect(keys).toContain('guest_mode');
    expect(getModuleAdapter('example_opening_roster')?.registration.version).toBe('1.0.0');
  });

  it('rejects untrusted property_id on example manual validate', () => {
    const adapter = getModuleAdapter('example_opening_roster');
    expect(adapter?.validateManual?.({ apartment_number: '101', property_id: 999 })).toEqual({
      ok: false,
      errors: ['untrusted_property_id'],
    });
    expect(adapter?.validateManual?.({ apartment_number: '101' })).toEqual({ ok: true });
  });
});

describe('IS-1 · lifecycle transitions v1.2', () => {
  it('enforces strict transitions', () => {
    expect(canTransitionModuleLifecycle('DISABLED', 'SETUP_REQUIRED')).toBe(true);
    expect(canTransitionModuleLifecycle('DISABLED', 'READY')).toBe(true);
    expect(canTransitionModuleLifecycle('DISABLED', 'ACTIVE')).toBe(false);
    expect(canTransitionModuleLifecycle('READY', 'ACTIVE')).toBe(true);
    expect(canTransitionModuleLifecycle('ACTIVE', 'SUSPENDED')).toBe(true);
    expect(canTransitionModuleLifecycle('SUSPENDED', 'ACTIVE')).toBe(true);
    expect(canTransitionModuleLifecycle('ACTIVE', 'READY')).toBe(false);
  });

  it('routes modules without setup directly toward READY', () => {
    expect(
      initialTargetState({ requiresInitialSetup: false, prerequisitesSatisfied: true }),
    ).toBe('READY');
    expect(
      initialTargetState({ requiresInitialSetup: true, prerequisitesSatisfied: true }),
    ).toBe('SETUP_REQUIRED');
  });

  it('preserves data on suspend and reuses setup on reactivate', () => {
    expect(suspensionPreservesData('ACTIVE', 'SUSPENDED')).toBe(true);
    expect(reactivationReusesSetup('SUSPENDED', 'ACTIVE')).toBe(true);
  });

  it('enforces dependencies before activation readiness', () => {
    bootstrapModuleSetupAdapters();
    const reg = getModuleAdapter('building_documents')!.registration;
    expect(dependenciesSatisfied(reg, new Set())).toBe(true);
    const blocked = activationBlockedReasons(
      { ...reg, dependencies: ['property_book'] },
      {
        lifecycleState: 'READY',
        activeOrReadyKeys: new Set(),
        setupComplete: true,
      },
    );
    expect(blocked).toContain('dependencies');
  });
});

describe('IS-1 · setup required/optional + resume draft', () => {
  beforeEach(() => {
    resetModuleSetupAdaptersForTests();
    bootstrapModuleSetupAdapters();
  });

  it('treats guest_mode as optional setup', () => {
    const reg = getModuleAdapter('guest_mode')!.registration;
    expect(setupIsOptional(reg)).toBe(true);
    expect(setupCompleteFromDraft(reg, {})).toBe(true);
  });

  it('requires draft fields for example adapter', () => {
    const reg = getModuleAdapter('example_opening_roster')!.registration;
    expect(setupCompleteFromDraft(reg, {})).toBe(false);
    expect(setupCompleteFromDraft(reg, { apartment_number: '101' })).toBe(true);
  });
});

describe('IS-1 · XLSX foundation', () => {
  beforeEach(() => {
    resetModuleSetupAdaptersForTests();
    bootstrapModuleSetupAdapters();
  });

  it('validates upload type/size and sanitizes formula injection', () => {
    expect(assertSafeUpload({ fileName: 'a.csv', byteLength: 10 }).ok).toBe(false);
    expect(assertSafeUpload({ fileName: 'a.xlsx', byteLength: 10 }).ok).toBe(true);
    expect(sanitizeSpreadsheetCell('=CMD()')).toBe("'=CMD()");
  });

  it('builds template, parses, previews, and detects duplicates', () => {
    const schema = getModuleAdapter('example_opening_roster')!.registration.setup!.xlsx!;
    const buf = buildModuleXlsxTemplate(schema, {
      is1ColApartment: 'apartment_number',
      is1ColLabel: 'label',
    });
    const parsed = parseModuleXlsxBuffer(buf, schema);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const preview = buildImportPreview(
      [
        { apartment_number: '101', label: 'a' },
        { apartment_number: '101', label: 'dup' },
        { apartment_number: '', label: 'x' },
      ],
      schema,
      (row) => {
        const apt = row.apartment_number?.trim();
        if (!apt) return { operation: 'error', errors: ['required:apartment_number'] };
        return { operation: 'create', matchKey: apt.toLowerCase() };
      },
    );
    expect(preview.errorCount).toBeGreaterThanOrEqual(2);
    expect(preview.rows.some((r) => r.errors.some((e) => e.startsWith('duplicate_in_file')))).toBe(
      true,
    );
  });
});

describe('IS-1 · compatibility with Module Core UX gates', () => {
  it('does not flip building module UX state helpers', () => {
    const state = emptyBuildingModulesState();
    state.guest_mode = true;
    expect(isBuildingModuleEnabled(state, 'guest_mode')).toBe(true);
    expect(isBuildingModuleEnabled(state, 'parking')).toBe(false);
  });
});

describe('IS-1 · migration evidence', () => {
  const sql = readFileSync(MIGRATION, 'utf8');

  it('creates lifecycle, setup progress, import batches and admin RPCs', () => {
    expect(sql).toContain('module_lifecycle');
    expect(sql).toContain('module_setup_progress');
    expect(sql).toContain('module_import_batches');
    expect(sql).toContain('admin_list_module_lifecycle');
    expect(sql).toContain('admin_transition_module_lifecycle');
    expect(sql).toContain('admin_create_module_import_batch');
    expect(sql).toContain('admin_assert_module_setup');
  });

  it('does not mutate building_modules.enabled and uses secure search_path', () => {
    expect(sql).toContain('lifecycle transitions do NOT mutate building_modules.enabled');
    expect(sql).toMatch(/set search_path = ''/);
    expect(sql).not.toMatch(/update\s+public\.building_modules/i);
    expect(sql).toContain("has_staff_role('администрация')");
  });

  it('revokes table privileges from authenticated', () => {
    expect(sql).toMatch(/revoke all on table public\.module_lifecycle from public, anon, authenticated/i);
    expect(sql).toMatch(
      /revoke all on table public\.module_import_batches from public, anon, authenticated/i,
    );
  });
});
