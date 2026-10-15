import type { ModuleSetupAdapter } from '@/lib/moduleCore/types';
import {
  INTERNET_MODULE_KEY,
  INTERNET_SETUP_SCHEMA_VERSION,
  downloadInternetIs5Template,
} from '@/lib/moduleCore/adapters/internetOpening';
import { PROPERTY_BOOK_MODULE_KEY } from '@/lib/moduleCore/adapters/propertyBookOpening';

/**
 * IS-5 Internet opening adapter.
 * Inventarisation via import_internet_opening_state — no connect WO / payments.
 */
export const internetOpeningAdapter: ModuleSetupAdapter = {
  registration: {
    moduleKey: INTERNET_MODULE_KEY,
    version: '1.0.0',
    nameKey: 'is5InternetName',
    descriptionKey: 'is5InternetDesc',
    dependencies: [PROPERTY_BOOK_MODULE_KEY],
    requiredRoles: ['администрация'],
    requiresInitialSetup: true,
    activationPrerequisites: [
      'property_book_ready_or_verified',
      'tariff_core_internet_configured',
      'internet_module_available',
      'finance_authz_ok',
    ],
    legalOrOperationalGates: [
      'no_synthetic_payments',
      'no_request_internet_connect',
      'no_system_work_orders_on_opening',
      'no_overwrite_existing_subscriptions',
      'q2_paid_through_next_charge_safe',
      'q5_pending_wo_blocked',
    ],
    setup: {
      schemaVersion: INTERNET_SETUP_SCHEMA_VERSION,
      importMethods: ['xlsx', 'manual'],
      idempotent: true,
      completionCriteria: [
        'preview_ok',
        'admin_confirm',
        'conflict_manual_reconcile',
        'manual_admin_or_verified',
      ],
      steps: [
        {
          id: 'internet_opening',
          titleKey: 'is5InternetStepVerify',
          fields: [
            {
              key: 'confirmed',
              required: true,
              valueType: 'boolean',
              labelKey: 'is5InternetManualConfirm',
            },
            {
              key: 'verified_existing_readonly',
              required: false,
              valueType: 'boolean',
              labelKey: 'is5InternetVerifiedExisting',
            },
          ],
        },
      ],
      xlsx: {
        schemaVersion: INTERNET_SETUP_SCHEMA_VERSION,
        sheetName: 'subscriptions',
        instructionsKey: 'is5InternetXlsxInstructions',
        maxRows: 5000,
        maxBytes: 2_000_000,
        columns: [
          {
            key: 'apartment_number',
            required: true,
            example: '101',
            labelKey: 'is5ColApartment',
          },
          {
            key: 'tariff_code',
            required: true,
            example: 'internet',
            labelKey: 'is5ColTariffCode',
          },
          {
            key: 'status',
            required: true,
            example: 'active',
            labelKey: 'is5ColStatus',
          },
          {
            key: 'connection_date',
            required: false,
            example: '2025-06-01',
            labelKey: 'is5ColConnectionDate',
          },
          {
            key: 'transition_date',
            required: true,
            example: '2026-01-01',
            labelKey: 'is5ColTransitionDate',
          },
          {
            key: 'paid_through',
            required: false,
            example: '2025-12-31',
            labelKey: 'is5ColPaidThrough',
          },
          {
            key: 'opening_debt',
            required: false,
            example: '0',
            labelKey: 'is5ColOpeningDebt',
          },
          {
            key: 'opening_credit',
            required: false,
            example: '0',
            labelKey: 'is5ColOpeningCredit',
          },
          {
            key: 'source_reference',
            required: false,
            example: 'ISP-LEDGER-2026',
            labelKey: 'is5ColSourceRef',
          },
          {
            key: 'notes',
            required: false,
            example: '',
            labelKey: 'is5ColNotes',
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

export function downloadInternetOpeningTemplate(): void {
  downloadInternetIs5Template();
}
