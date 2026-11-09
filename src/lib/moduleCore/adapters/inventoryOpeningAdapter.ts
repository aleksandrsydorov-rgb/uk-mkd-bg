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
 * Paths: import XLSX list, or confirm empty registry. No physical stocktake at setup.
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
      'no_auto_activation',
      'no_finance_postings',
      'estimated_value_informational',
      'data_survives_suspend',
    ],
    setup: {
      schemaVersion: INVENTORY_SETUP_SCHEMA_VERSION,
      importMethods: ['xlsx', 'manual'],
      idempotent: true,
      completionCriteria: ['preview_ok', 'admin_confirm', 'empty_ok'],
      steps: [
        {
          id: 'inventory_opening',
          titleKey: 'inv6StepVerify',
          fields: [
            {
              key: 'empty_inventory_ok',
              required: false,
              valueType: 'boolean',
              labelKey: 'inv6ChoiceEmpty',
            },
            {
              key: 'import_committed',
              required: false,
              valueType: 'boolean',
              labelKey: 'inv6ImportCommitted',
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
              ? 'оборудование'
              : key === 'item_name'
                ? 'Перфоратор'
                : key === 'ownership_kind'
                  ? 'CONDOMINIUM'
                  : key === 'inventory_number'
                    ? 'INV-TOOL-001'
                    : key === 'category_code'
                      ? 'Инструменты'
                      : key === 'location_code'
                        ? 'Склад'
                        : '',
          labelKey: `inv6Col_${key}`,
        })),
      },
    },
  },
  validateManual(draft) {
    if (inventorySetupManualComplete(draft)) return { ok: true };
    return { ok: false, errors: ['required:empty_or_import'] };
  },
};

export function downloadInventoryIs6Template(locale?: string): void {
  downloadInventoryOpeningTemplate(locale);
}
