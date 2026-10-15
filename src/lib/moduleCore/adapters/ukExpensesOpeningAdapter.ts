import type { ModuleSetupAdapter } from '@/lib/moduleCore/types';
import {
  UK_EXPENSES_SETUP_KEY,
  UK_EXPENSES_SETUP_SCHEMA_VERSION,
  downloadUkExpensesIs6aTemplate,
} from '@/lib/moduleCore/adapters/ukExpensesOpening';

/**
 * IS-6a Historical UK expenses opening adapter (platform-service setup entry).
 * Inventarisation via import_uk_expense_opening_row — pending only, no AP/payments.
 * Import is optional: skip_historical_import or confirmed completes setup.
 */
export const ukExpensesOpeningAdapter: ModuleSetupAdapter = {
  registration: {
    moduleKey: UK_EXPENSES_SETUP_KEY,
    version: '1.0.0',
    nameKey: 'is6aExpensesName',
    descriptionKey: 'is6aExpensesDesc',
    dependencies: [],
    requiredRoles: ['администрация'],
    requiresInitialSetup: true,
    activationPrerequisites: ['finance_authz_ok'],
    legalOrOperationalGates: [
      'optional_import',
      'no_auto_publish',
      'no_ap_or_supplier_payments',
      'no_support_fee_or_internet_reuse',
      'opening_excluded_from_budget_execution',
      'q11_conflict_no_overwrite',
    ],
    setup: {
      schemaVersion: UK_EXPENSES_SETUP_SCHEMA_VERSION,
      importMethods: ['xlsx', 'manual'],
      idempotent: true,
      completionCriteria: [
        'preview_ok',
        'admin_confirm',
        'optional_skip',
        'conflict_manual_reconcile',
        'manual_admin_or_skip',
      ],
      steps: [
        {
          id: 'uk_expenses_opening',
          titleKey: 'is6aExpensesStepVerify',
          fields: [
            {
              key: 'confirmed',
              required: false,
              valueType: 'boolean',
              labelKey: 'is6aExpensesManualConfirm',
            },
            {
              key: 'skip_historical_import',
              required: false,
              valueType: 'boolean',
              labelKey: 'is6aExpensesSkipImport',
            },
            {
              key: 'verified_existing_readonly',
              required: false,
              valueType: 'boolean',
              labelKey: 'is6aExpensesVerifiedExisting',
            },
          ],
        },
      ],
      xlsx: {
        schemaVersion: UK_EXPENSES_SETUP_SCHEMA_VERSION,
        sheetName: 'expenses',
        instructionsKey: 'is6aExpensesXlsxInstructions',
        maxRows: 5000,
        maxBytes: 2_000_000,
        columns: [
          {
            key: 'source_ref',
            required: true,
            example: 'EXP-2025-001',
            labelKey: 'is6aColSourceRef',
          },
          {
            key: 'title',
            required: true,
            example: 'Cleaning Q4 2025',
            labelKey: 'is6aColTitle',
          },
          {
            key: 'expense_date',
            required: true,
            example: '2025-11-15',
            labelKey: 'is6aColExpenseDate',
          },
          {
            key: 'amount_eur',
            required: true,
            example: '120.00',
            labelKey: 'is6aColAmount',
          },
          {
            key: 'category_code',
            required: false,
            example: 'cleaning',
            labelKey: 'is6aColCategory',
          },
          {
            key: 'transition_date',
            required: true,
            example: '2026-01-01',
            labelKey: 'is6aColTransitionDate',
          },
          {
            key: 'source_document',
            required: false,
            example: 'INV-7788',
            labelKey: 'is6aColSourceDocument',
          },
          {
            key: 'notes',
            required: false,
            example: '',
            labelKey: 'is6aColNotes',
          },
        ],
      },
    },
  },
  validateManual(draft) {
    if (
      draft.skip_historical_import === true ||
      draft.confirmed === true ||
      draft.verified_existing_readonly === true
    ) {
      return { ok: true };
    }
    return { ok: false, errors: ['required:confirmed_or_skip_or_verified'] };
  },
};

export function downloadUkExpensesOpeningTemplate(): void {
  downloadUkExpensesIs6aTemplate();
}
