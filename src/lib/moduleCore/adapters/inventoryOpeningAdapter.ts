import type { ModuleSetupAdapter } from '@/lib/moduleCore/types';
import {
  INVENTORY_MODULE_KEY,
  INVENTORY_OPENING_HEADERS,
  INVENTORY_OPENING_SHEET,
  INVENTORY_SETUP_SCHEMA_VERSION,
  downloadInventoryOpeningTemplate,
  inventorySetupManualComplete,
} from '@/lib/inventory/opening';

/**
 * INV-6 Inventory Initial Setup adapter.
 * Empty inventory valid; XLSX optional; physical inventory optional.
 * Sessions may run during SETUP_* without requiring ACTIVE (canonical INV-2).
 */
export const inventoryOpeningAdapter: ModuleSetupAdapter = {
  registration: {
    moduleKey: INVENTORY_MODULE_KEY,
    version: '1.0.0',
    nameKey: 'inv6Name',
    descriptionKey: 'inv6Desc',
    dependencies: [],
    requiredRoles: ['администрация'],
    requiresInitialSetup: true,
    activationPrerequisites: ['admin_confirm'],
    legalOrOperationalGates: [
      'empty_inventory_valid',
      'optional_import',
      'optional_physical_inventory',
      'no_auto_activation',
      'no_finance_postings',
      'estimated_value_informational',
      'setup_sessions_before_active_ok',
      'data_survives_suspend',
    ],
    setup: {
      schemaVersion: INVENTORY_SETUP_SCHEMA_VERSION,
      importMethods: ['xlsx', 'manual'],
      idempotent: true,
      completionCriteria: [
        'preview_ok',
        'admin_confirm',
        'optional_skip',
        'empty_ok',
        'physical_inventory_optional',
      ],
      steps: [
        {
          id: 'inventory_opening',
          titleKey: 'inv6StepVerify',
          fields: [
            {
              key: 'empty_inventory_ok',
              required: false,
              valueType: 'boolean',
              labelKey: 'inv6EmptyOk',
            },
            {
              key: 'skip_import',
              required: false,
              valueType: 'boolean',
              labelKey: 'inv6SkipImport',
            },
            {
              key: 'confirmed',
              required: false,
              valueType: 'boolean',
              labelKey: 'inv6ManualConfirm',
            },
            {
              key: 'start_physical_inventory',
              required: false,
              valueType: 'boolean',
              labelKey: 'inv6StartPhysical',
            },
          ],
        },
      ],
      xlsx: {
        schemaVersion: INVENTORY_SETUP_SCHEMA_VERSION,
        sheetName: INVENTORY_OPENING_SHEET,
        instructionsKey: 'inv6XlsxInstructions',
        maxRows: 5000,
        maxBytes: 2_000_000,
        columns: INVENTORY_OPENING_HEADERS.map((key) => ({
          key,
          required: ['tracking_type', 'item_name', 'ownership_kind'].includes(key),
          example:
            key === 'tracking_type'
              ? 'INDIVIDUAL_ASSET'
              : key === 'item_name'
                ? 'Hammer drill'
                : key === 'ownership_kind'
                  ? 'CONDOMINIUM'
                  : key === 'inventory_number'
                    ? 'INV-TOOL-001'
                    : '',
          labelKey: `inv6Col_${key}`,
        })),
      },
    },
  },
  validateManual(draft) {
    if (inventorySetupManualComplete(draft)) return { ok: true };
    return { ok: false, errors: ['required:confirmed_or_skip_or_empty_or_physical'] };
  },
};

export function downloadInventoryIs6Template(): void {
  downloadInventoryOpeningTemplate();
}
