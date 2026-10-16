import type { ModuleSetupAdapter } from '@/lib/moduleCore/types';
import {
  ELECTRICITY_MODULE_KEY,
  METERS_SETUP_SCHEMA_VERSION,
  OPENING_READING_ROW_COMMIT,
  downloadElectricityMeterIs3Template,
} from '@/lib/moduleCore/adapters/metersOpening';
import { PROPERTY_BOOK_MODULE_KEY } from '@/lib/moduleCore/adapters/propertyBookOpening';

/**
 * IS-3 / MTR-3 Electricity meters opening adapter.
 * Inventory via assign_electricity_meter + register_electricity_opening_reading (charge-free).
 */
export const electricityOpeningAdapter: ModuleSetupAdapter = {
  registration: {
    moduleKey: ELECTRICITY_MODULE_KEY,
    version: '1.0.0',
    nameKey: 'is3ElectricityName',
    descriptionKey: 'is3ElectricityDesc',
    dependencies: [PROPERTY_BOOK_MODULE_KEY],
    requiredRoles: ['администрация'],
    requiresInitialSetup: true,
    activationPrerequisites: ['property_book_ready_or_verified', 'meters_inventory_ok'],
    legalOrOperationalGates: [
      'no_replace_existing_active_meter',
      'no_submit_reading_charges_on_setup',
      `opening_reading_row_commit_${OPENING_READING_ROW_COMMIT}`,
    ],
    setup: {
      schemaVersion: METERS_SETUP_SCHEMA_VERSION,
      importMethods: ['xlsx', 'manual'],
      idempotent: true,
      completionCriteria: [
        'preview_ok',
        'admin_confirm',
        'skip_existing_active',
        'manual_admin_or_verified',
      ],
      steps: [
        {
          id: 'electricity_meters',
          titleKey: 'is3ElectricityStepVerify',
          fields: [
            {
              key: 'confirmed',
              required: true,
              valueType: 'boolean',
              labelKey: 'is3ElectricityManualConfirm',
            },
            {
              key: 'verified_existing_readonly',
              required: false,
              valueType: 'boolean',
              labelKey: 'is3MetersVerifiedExisting',
            },
          ],
        },
      ],
      xlsx: {
        schemaVersion: METERS_SETUP_SCHEMA_VERSION,
        sheetName: 'meters',
        instructionsKey: 'is3ElectricityXlsxInstructions',
        maxRows: 5000,
        maxBytes: 2_000_000,
        columns: [
          {
            key: 'apartment_number',
            required: true,
            example: '12',
            labelKey: 'is3ColApartment',
          },
          {
            key: 'meter_number',
            required: true,
            example: 'E-12-001',
            labelKey: 'is3ColMeterNumber',
          },
          {
            key: 'initial_day_reading',
            required: true,
            example: '0',
            labelKey: 'is3ColInitialDay',
          },
          {
            key: 'initial_night_reading',
            required: true,
            example: '0',
            labelKey: 'is3ColInitialNight',
          },
          {
            key: 'installed_at',
            required: true,
            example: '2026-01-15',
            labelKey: 'is3ColInstalledAt',
          },
        ],
      },
    },
  },
  validateManual(draft) {
    if (draft.property_id != null) {
      return { ok: false, errors: ['untrusted_property_id'] };
    }
    if (draft.confirmed === true || draft.verified_existing_readonly === true) {
      return { ok: true };
    }
    return { ok: false, errors: ['required:confirmed_or_verified_existing'] };
  },
};

export function downloadElectricityOpeningTemplate(): void {
  downloadElectricityMeterIs3Template();
}
