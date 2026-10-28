import type { ModuleSetupAdapter } from '@/lib/moduleCore/types';
import {
  CAPITAL_REPAIR_MODULE_KEY,
  CAPITAL_REPAIR_SETUP_SCHEMA_VERSION,
  downloadCapitalRepairIs8Template,
} from '@/lib/moduleCore/adapters/capitalRepairOpening';
import { PROPERTY_BOOK_MODULE_KEY } from '@/lib/moduleCore/adapters/propertyBookOpening';

/**
 * IS-8 Capital Repair opening adapter.
 * Inventarisation via import_capital_repair_opening_state — no synthetic payments/charges.
 * Historical import is optional for empty complexes (skip / verified / confirmed).
 */
export const capitalRepairOpeningAdapter: ModuleSetupAdapter = {
  registration: {
    moduleKey: CAPITAL_REPAIR_MODULE_KEY,
    version: '1.0.0',
    nameKey: 'is8CapitalRepairName',
    descriptionKey: 'is8CapitalRepairDesc',
    dependencies: [PROPERTY_BOOK_MODULE_KEY],
    requiredRoles: ['администрация'],
    requiresInitialSetup: true,
    activationPrerequisites: [
      'property_book_ready_or_verified',
      'finance_authz_ok',
      'canonical_capital_assessment_or_shell',
    ],
    legalOrOperationalGates: [
      'no_synthetic_payments',
      'no_operational_charges_on_opening',
      'mandatory_assessment_id_linkage',
      'no_overwrite_existing_ledger',
      'q_cr_1_inventarisation',
      'q_cr_2_declared_historical_amounts',
      'q_cr_3_assessment_linkage',
      'fund_obligation_not_bank_cash',
      'optional_historical_import',
    ],
    setup: {
      schemaVersion: CAPITAL_REPAIR_SETUP_SCHEMA_VERSION,
      importMethods: ['xlsx', 'manual'],
      idempotent: true,
      completionCriteria: [
        'preview_ok',
        'admin_confirm',
        'optional_skip',
        'conflict_manual_reconcile',
        'manual_admin_or_verified',
      ],
      steps: [
        {
          id: 'capital_repair_opening',
          titleKey: 'is8CapitalRepairStepVerify',
          fields: [
            {
              key: 'confirmed',
              required: false,
              valueType: 'boolean',
              labelKey: 'is8CapitalRepairManualConfirm',
            },
            {
              key: 'verified_existing_readonly',
              required: false,
              valueType: 'boolean',
              labelKey: 'is8CapitalRepairVerifiedExisting',
            },
            {
              key: 'skip_historical_import',
              required: false,
              valueType: 'boolean',
              labelKey: 'is8CapitalRepairSkipImport',
            },
          ],
        },
      ],
      xlsx: {
        schemaVersion: CAPITAL_REPAIR_SETUP_SCHEMA_VERSION,
        sheetName: 'opening_balances',
        instructionsKey: 'is8CapitalRepairXlsxInstructions',
        maxRows: 5000,
        maxBytes: 2_000_000,
        columns: [
          {
            key: 'apartment_number',
            required: true,
            example: '101',
            labelKey: 'is8ColApartment',
          },
          {
            key: 'billing_year',
            required: true,
            example: '2025',
            labelKey: 'is8ColBillingYear',
          },
          {
            key: 'obligation_type',
            required: true,
            example: 'capital_repair',
            labelKey: 'is8ColObligationType',
          },
          {
            key: 'assessment_title',
            required: false,
            example: 'Капитальный ремонт 2025',
            labelKey: 'is8ColAssessmentTitle',
          },
          {
            key: 'assessed_amount',
            required: true,
            example: '120',
            labelKey: 'is8ColAssessed',
          },
          {
            key: 'historically_paid_amount',
            required: true,
            example: '70',
            labelKey: 'is8ColHistoricallyPaid',
          },
          {
            key: 'remaining_debt',
            required: true,
            example: '50',
            labelKey: 'is8ColRemainingDebt',
          },
          {
            key: 'opening_overpayment',
            required: false,
            example: '0',
            labelKey: 'is8ColOpeningOverpayment',
          },
          {
            key: 'transition_date',
            required: true,
            example: '2026-01-01',
            labelKey: 'is8ColTransitionDate',
          },
          {
            key: 'source_reference',
            required: true,
            example: 'CR-OPENING-2026',
            labelKey: 'is8ColSourceRef',
          },
          {
            key: 'notes',
            required: false,
            example: '',
            labelKey: 'is8ColNotes',
          },
        ],
      },
    },
  },
  validateManual(draft) {
    if (draft.property_id != null) {
      return { ok: false, errors: ['untrusted_property_id'] };
    }
    if (
      draft.confirmed === true ||
      draft.verified_existing_readonly === true ||
      draft.skip_historical_import === true
    ) {
      return { ok: true };
    }
    return { ok: false, errors: ['required:confirmed_or_verified_or_skip'] };
  },
};

export function downloadCapitalRepairOpeningTemplate(): void {
  downloadCapitalRepairIs8Template();
}
