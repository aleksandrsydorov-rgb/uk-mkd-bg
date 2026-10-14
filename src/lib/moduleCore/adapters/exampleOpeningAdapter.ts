import type { ModuleSetupAdapter } from '@/lib/moduleCore/types';

/**
 * Example adapter for IS-1 tests / documentation.
 * Does NOT map to a production business table writer.
 * moduleKey is intentionally outside building_modules catalog.
 */
export const exampleOpeningAdapter: ModuleSetupAdapter = {
  registration: {
    moduleKey: 'example_opening_roster',
    version: '1.0.0',
    nameKey: 'is1ExampleModuleName',
    descriptionKey: 'is1ExampleModuleDesc',
    dependencies: [],
    requiredRoles: ['администрация'],
    requiresInitialSetup: true,
    activationPrerequisites: [],
    setup: {
      schemaVersion: '1.0',
      importMethods: ['xlsx', 'manual'],
      idempotent: true,
      completionCriteria: ['preview_ok', 'admin_confirm'],
      steps: [
        {
          id: 'roster',
          titleKey: 'is1ExampleStepRoster',
          fields: [
            { key: 'apartment_number', required: true, valueType: 'string' },
            { key: 'label', required: false, valueType: 'string' },
          ],
        },
      ],
      xlsx: {
        schemaVersion: '1.0',
        sheetName: 'roster',
        maxRows: 1000,
        maxBytes: 1_000_000,
        columns: [
          {
            key: 'apartment_number',
            required: true,
            example: '101',
            labelKey: 'is1ColApartment',
          },
          {
            key: 'label',
            required: false,
            example: 'demo',
            labelKey: 'is1ColLabel',
          },
        ],
      },
    },
  },
  validateManual(draft) {
    const apt = String(draft.apartment_number ?? '').trim();
    if (!apt) return { ok: false, errors: ['required:apartment_number'] };
    // Never trust a client-supplied property_id — adapters must resolve via apartment_number.
    if (draft.property_id != null) {
      return { ok: false, errors: ['untrusted_property_id'] };
    }
    return { ok: true };
  },
};
