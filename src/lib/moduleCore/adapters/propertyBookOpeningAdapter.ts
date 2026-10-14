import type { ModuleSetupAdapter } from '@/lib/moduleCore/types';
import {
  PROPERTY_BOOK_MODULE_KEY,
  PROPERTY_BOOK_SETUP_SCHEMA_VERSION,
  downloadPropertyBookIs2Template,
} from '@/lib/moduleCore/adapters/propertyBookOpening';

/**
 * IS-2 Property Book opening adapter.
 * Canonical SSOT remains properties + property_registry_people via admin_import_property_book
 * and AdminPropertyBook manual RPCs — no parallel tables.
 */
export const propertyBookOpeningAdapter: ModuleSetupAdapter = {
  registration: {
    moduleKey: PROPERTY_BOOK_MODULE_KEY,
    version: '1.0.0',
    nameKey: 'is2PropertyBookName',
    descriptionKey: 'is2PropertyBookDesc',
    dependencies: [],
    requiredRoles: ['администрация'],
    requiresInitialSetup: true,
    activationPrerequisites: ['book_complete_or_verified'],
    legalOrOperationalGates: [
      'no_overwrite_existing_ownership',
      'lawful_transfer_for_corrections',
      'meeting_core_reads_book_ssot',
    ],
    setup: {
      schemaVersion: PROPERTY_BOOK_SETUP_SCHEMA_VERSION,
      importMethods: ['xlsx', 'manual'],
      idempotent: true,
      completionCriteria: [
        'preview_ok',
        'admin_confirm',
        'no_overwrite_unless_lawful',
        'manual_book_admin_or_verified',
      ],
      steps: [
        {
          id: 'book_verify',
          titleKey: 'is2PropertyBookStepVerify',
          fields: [
            {
              key: 'confirmed',
              required: true,
              valueType: 'boolean',
              labelKey: 'is2PropertyBookManualConfirm',
            },
            {
              key: 'verified_existing_readonly',
              required: false,
              valueType: 'boolean',
              labelKey: 'is2PropertyBookVerifiedExisting',
            },
          ],
        },
      ],
      // Multi-sheet Book template is served by downloadTemplate(); schema marks XLSX support.
      xlsx: {
        schemaVersion: PROPERTY_BOOK_SETUP_SCHEMA_VERSION,
        sheetName: 'objects',
        instructionsKey: 'is2PropertyBookXlsxInstructions',
        maxRows: 5000,
        maxBytes: 2_000_000,
        columns: [
          {
            key: 'apartment_number',
            required: true,
            example: '12',
            labelKey: 'is2ColApartment',
          },
          {
            key: 'purpose',
            required: true,
            example: 'апартамент',
            labelKey: 'is2ColPurpose',
          },
          {
            key: 'ownership_type',
            required: true,
            example: 'sole',
            labelKey: 'is2ColOwnershipType',
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

/** Browser download of canonical multi-sheet Book template + BG/RU/EN instructions. */
export function downloadPropertyBookOpeningTemplate(): void {
  downloadPropertyBookIs2Template('property_book_opening_template.xlsx');
}
