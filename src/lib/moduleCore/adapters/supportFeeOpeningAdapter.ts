import type { ModuleSetupAdapter } from '@/lib/moduleCore/types';
import {
  SUPPORT_FEE_MODULE_KEY,
  SUPPORT_FEE_SETUP_SCHEMA_VERSION,
  downloadSupportFeeIs4Template,
} from '@/lib/moduleCore/adapters/supportFeeOpening';
import { PROPERTY_BOOK_MODULE_KEY } from '@/lib/moduleCore/adapters/propertyBookOpening';

/**
 * IS-4 Support Fee opening adapter.
 * Inventarisation via import_support_fee_opening_state — no synthetic payments.
 */
export const supportFeeOpeningAdapter: ModuleSetupAdapter = {
  registration: {
    moduleKey: SUPPORT_FEE_MODULE_KEY,
    version: '1.0.0',
    nameKey: 'is4SupportFeeName',
    descriptionKey: 'is4SupportFeeDesc',
    dependencies: [PROPERTY_BOOK_MODULE_KEY],
    requiredRoles: ['администрация'],
    requiresInitialSetup: true,
    activationPrerequisites: [
      'property_book_ready_or_verified',
      'tariff_core_support_fee_configured',
      'finance_authz_ok',
    ],
    legalOrOperationalGates: [
      'no_synthetic_payments',
      'no_early_late_recalc_on_opening',
      'no_overwrite_existing_obligations',
      'q1_per_apartment_year_obligation',
      'd1_remaining_due_sot',
    ],
    setup: {
      schemaVersion: SUPPORT_FEE_SETUP_SCHEMA_VERSION,
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
          id: 'support_fee_opening',
          titleKey: 'is4SupportFeeStepVerify',
          fields: [
            {
              key: 'confirmed',
              required: true,
              valueType: 'boolean',
              labelKey: 'is4SupportFeeManualConfirm',
            },
            {
              key: 'verified_existing_readonly',
              required: false,
              valueType: 'boolean',
              labelKey: 'is4SupportFeeVerifiedExisting',
            },
          ],
        },
      ],
      xlsx: {
        schemaVersion: SUPPORT_FEE_SETUP_SCHEMA_VERSION,
        sheetName: 'opening_balances',
        instructionsKey: 'is4SupportFeeXlsxInstructions',
        maxRows: 5000,
        maxBytes: 2_000_000,
        columns: [
          {
            key: 'apartment_number',
            required: true,
            example: '101',
            labelKey: 'is4ColApartment',
          },
          {
            key: 'billing_year',
            required: true,
            example: '2025',
            labelKey: 'is4ColBillingYear',
          },
          {
            key: 'obligation_type',
            required: true,
            example: 'support_fee',
            labelKey: 'is4ColObligationType',
          },
          {
            key: 'assessed_amount',
            required: true,
            example: '400',
            labelKey: 'is4ColAssessed',
          },
          {
            key: 'historically_paid_amount',
            required: true,
            example: '250',
            labelKey: 'is4ColHistoricallyPaid',
          },
          {
            key: 'remaining_debt',
            required: true,
            example: '150',
            labelKey: 'is4ColRemainingDebt',
          },
          {
            key: 'opening_overpayment',
            required: false,
            example: '0',
            labelKey: 'is4ColOpeningOverpayment',
          },
          {
            key: 'transition_date',
            required: true,
            example: '2026-01-01',
            labelKey: 'is4ColTransitionDate',
          },
          {
            key: 'source_reference',
            required: false,
            example: 'OPENING-LEDGER-2026',
            labelKey: 'is4ColSourceRef',
          },
          {
            key: 'notes',
            required: false,
            example: '',
            labelKey: 'is4ColNotes',
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

export function downloadSupportFeeOpeningTemplate(): void {
  downloadSupportFeeIs4Template();
}
