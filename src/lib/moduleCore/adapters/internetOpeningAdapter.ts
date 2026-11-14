import type { ModuleSetupAdapter } from '@/lib/moduleCore/types';
import {
  INTERNET_MODULE_KEY,
  INTERNET_SETUP_SCHEMA_VERSION,
  downloadInternetIs5Template,
} from '@/lib/moduleCore/adapters/internetOpening';
import { PROPERTY_BOOK_MODULE_KEY } from '@/lib/moduleCore/adapters/propertyBookOpening';

/**
 * IS-5 Internet opening adapter (v1.1 first-run template).
 * Inventarisation via admin_import_internet_opening / import_internet_opening_state.
 */
export const internetOpeningAdapter: ModuleSetupAdapter = {
  registration: {
    moduleKey: INTERNET_MODULE_KEY,
    version: '1.1.0',
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
      'explicit_correction_confirm',
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
        'none_confirmed_or_imported',
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
            key: 'section_code',
            required: false,
            example: 'A',
            labelKey: 'is5ColSection',
          },
          {
            key: 'connection_state',
            required: true,
            example: 'Подключён',
            labelKey: 'is5ColConnectionState',
          },
          {
            key: 'connection_date',
            required: false,
            example: '2025-06-01',
            labelKey: 'is5ColConnectionDate',
          },
          {
            key: 'paid_period_start',
            required: false,
            example: '2026-01-01',
            labelKey: 'is5ColPaidPeriodStart',
          },
          {
            key: 'paid_period_end',
            required: false,
            example: '2026-10-31',
            labelKey: 'is5ColPaidPeriodEnd',
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
            key: 'comment',
            required: false,
            example: '',
            labelKey: 'is5ColComment',
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

export function downloadInternetOpeningTemplate(locale?: string): void {
  downloadInternetIs5Template(locale);
}
