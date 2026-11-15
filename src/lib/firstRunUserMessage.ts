/**
 * Turns first-run server phrases into user-facing copy.
 * Server checks stay unchanged. Secrets are not shown or logged in full.
 */

import { propertyBookFieldLabel } from '@/lib/propertyBookHistory';
import {
  formatBookApartmentRef,
  formatExcelRowRanges,
  type BookPreviewIssue,
} from '@/lib/propertyBookImportPreview';

const STAGE_LABEL: Record<string, string> = {
  welcome: 'admin.firstRunStageWelcome',
  modules_select: 'admin.firstRunStageModules',
  complex_card: 'admin.firstRunStageComplex',
  property_book: 'admin.firstRunStagePropertyBook',
  property_book_objects: 'admin.firstRunStagePropertyBook',
  property_book_owners: 'admin.firstRunStagePropertyBook',
  meters_select: 'admin.firstRunStageMetersSelect',
  meters_water: 'admin.firstRunStageMetersWater',
  meters_electricity: 'admin.firstRunStageMetersElectricity',
  support_fee_opening: 'admin.firstRunStageSupportFee',
  capital_repair_opening: 'admin.firstRunStageCapitalRepair',
  tariffs: 'admin.firstRunStageTariffs',
  budget: 'admin.firstRunStageBudget',
  uk_expenses_opening: 'admin.firstRunStageOpeningExpenses',
  complete: 'admin.firstRunStageComplete',
  water: 'admin.firstRunTariffWater',
  electricity: 'admin.firstRunTariffElectricity',
  internet: 'admin.firstRunTariffInternet',
  support_fee: 'admin.firstRunTariffSupportFee',
  capital_repair: 'admin.firstRunTariffCapitalRepair',
  internet_opening: 'admin.firstRunStageInternetOpening',
};

const BUDGET_STATUSES = new Set(['draft', 'published', 'adopted', 'closed']);

export type FirstRunErrorView = {
  message: string;
  /** Redacted technical phrase for diagnosis. Absent when it would expose a secret. */
  detail: string | null;
};

type T = (key: string, params?: Record<string, string | number>) => string;

export function firstRunFailureText(raw: unknown): string {
  if (typeof raw === 'string') return raw.trim();
  if (raw instanceof Error) return raw.message.trim();
  if (raw && typeof raw === 'object' && 'message' in raw) {
    const message = (raw as { message: unknown }).message;
    if (typeof message === 'string') return message.trim();
  }
  return '';
}

export function redactDiagnostic(text: string): string {
  return text
    .replace(/bearer\s+\S+/gi, 'bearer [redacted]')
    .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '[redacted]')
    .replace(
      /(api[_-]?key|password|secret|token|service_role|smtp)\s*[:=]\s*\S+/gi,
      '$1=[redacted]',
    );
}

function isSecret(text: string): boolean {
  return /PGRST|PostgREST|invalid api key|\bjwt\b|permission denied|schema cache|42P01|42703|could not find the function|row-level security|violates row-level|service_role|\bsmtp\b|lettermint|bearer\s+\S+|eyJ[A-Za-z0-9_-]{8,}\./i.test(
    text,
  );
}

function label(code: string, t: T): string {
  const key = STAGE_LABEL[code];
  return key ? t(key) : code;
}

function stageRetry(code: string, t: T): string {
  if (code === 'tariffs') return t('admin.firstRunErrTariffsIncomplete');
  return t('admin.firstRunErrStageRetry').replace('{name}', label(code, t));
}

function knownMessage(text: string, t: T): string | null {
  const stage = text.match(/^first_run: stage ([a-z0-9_]+) not complete$/i);
  if (stage) return stageRetry(stage[1], t);

  const meterStage = text.match(/^first_run: (meters_water|meters_electricity) stage not complete$/i);
  if (meterStage) return stageRetry(meterStage[1], t);

  if (/^first_run: installation missing$/i.test(text)) return t('admin.firstRunErrInstallMissing');
  if (/^first_run: unknown stage/i.test(text) || /^first_run: stage required$/i.test(text)) {
    return t('admin.firstRunErrUnknownStage');
  }
  if (/^first_run: at least one meter utility required$/i.test(text)) {
    return t('admin.firstRunErrMetersRequired');
  }
  if (/^first_run: modules_selected required$/i.test(text) || /^first_run: required module /i.test(text)) {
    return t('admin.firstRunErrModulesRequired');
  }
  if (/^first_run: module .+ is not available$/i.test(text) || /^first_run: module .+ is not optional$/i.test(text)) {
    return t('admin.firstRunErrModuleUnavailable');
  }
  if (/cannot be turned off here$/i.test(text)) {
    return t('admin.firstRunErrModuleLocked');
  }
  if (
    /^first_run: complex card incomplete \(name\)$/i.test(text) ||
    /^first_run: complex name required$/i.test(text)
  ) {
    return t('admin.firstRunErrComplexName');
  }
  if (
    /^first_run: complex card incomplete \(address\)$/i.test(text) ||
    /^first_run: address required$/i.test(text)
  ) {
    return t('admin.firstRunErrComplexAddress');
  }
  if (
    /^first_run: complex card incomplete \(apartment_count\)$/i.test(text) ||
    /^first_run: apartment_count required$/i.test(text) ||
    /^first_run: apartment_count invalid$/i.test(text)
  ) {
    return t('admin.firstRunErrComplexCount');
  }
  if (/^first_run: complex address incomplete$/i.test(text)) {
    return t('admin.firstRunErrComplexAddress');
  }
  if (
    /^first_run: management company name required$/i.test(text) ||
    /^first_run: management registration country required$/i.test(text) ||
    /^first_run: management registration number required$/i.test(text) ||
    /^first_run: management registered address required$/i.test(text) ||
    /^first_run: management representative required$/i.test(text) ||
    /^first_run: management phone required$/i.test(text) ||
    /^first_run: management email required$/i.test(text)
  ) {
    return t('admin.firstRunErrMgmt');
  }
  if (/^first_run: management VAT number required$/i.test(text)) {
    return t('admin.firstRunErrMgmtVat');
  }
  if (/^first_run: bank account incomplete$/i.test(text) || /^first_run: bank_accounts must be an array$/i.test(text)) {
    return t('admin.firstRunErrBankIncomplete');
  }
  if (/^first_run: iban invalid$/i.test(text) || /^first_run: bank currency invalid$/i.test(text)) {
    return t('admin.firstRunErrIban');
  }

  const active = text.match(
    /^first_run: (property_book|water|electricity|support_fee|capital_repair|budget) must be ACTIVE\b/i,
  );
  if (active) return t('admin.firstRunErrModuleInactive').replace('{name}', label(active[1], t));

  if (/^first_run: support_fee opening inventarisation missing$/i.test(text)) {
    return t('admin.firstRunErrOpeningMissing').replace('{name}', t('admin.firstRunStageSupportFee'));
  }
  if (/^first_run: capital_repair fund cash opening required$/i.test(text)) {
    return t('admin.firstRunErrFundRequired');
  }
  if (
    /^first_run: capital_repair opening/i.test(text) ||
    /^first_run: capital_repair must be ACTIVE before stage complete$/i.test(text)
  ) {
    return t('admin.firstRunErrOpeningMissing').replace('{name}', t('admin.firstRunStageCapitalRepair'));
  }

  const yearMissing = text.match(/^first_run: budget year (\d+) missing$/i);
  if (yearMissing) return t('admin.firstRunErrBudgetMissing').replace('{year}', yearMissing[1]);
  const yearClosed = text.match(/^first_run: budget year (\d+) is closed$/i);
  if (yearClosed) return t('admin.firstRunErrBudgetClosed').replace('{year}', yearClosed[1]);
  if (/^first_run: budget calendar year required$/i.test(text)) return t('admin.firstRunErrBudgetYear');
  // admin_save/list_first_run_opening_totals raises opening_import:* (not first_run:*)
  if (/^opening_import:\s*budget year missing$/i.test(text)) return t('admin.firstRunErrBudgetYear');
  if (/^opening_import:\s*budget year (\d+) missing$/i.test(text)) {
    return t('admin.firstRunErrBudgetMissing').replace('{year}', text.match(/(\d+)/)?.[1] ?? '');
  }
  if (/^first_run: budget year .+ must be published or adopted/i.test(text)) {
    return t('admin.firstRunErrBudgetNotPublished');
  }
  if (/^first_run: budget lines missing/i.test(text)) return t('admin.firstRunErrBudgetLines');
  // Budget Core publish guard — same user action as filling every active category.
  if (/^admin_set_budget_year_status:\s*no lines$/i.test(text)) {
    return t('admin.firstRunErrBudgetLines');
  }
  if (/^first_run: zero budget plan requires confirmation$/i.test(text)) return t('admin.firstRunErrBudgetZero');
  if (/^first_run: opening expenses confirmation required$/i.test(text)) {
    return t('admin.firstRunErrOpeningConfirm');
  }
  if (/^first_run: opening expenses still present$/i.test(text)) return t('admin.firstRunErrOpeningStill');
  if (/^first_run: budget module must be enabled$/i.test(text)) return t('admin.firstRunErrBudgetModule');

  const tariff = text.match(
    /^first_run: published (water|electricity|internet|support_fee|capital_repair) tariff/i,
  );
  if (tariff) return t('admin.firstRunErrTariffRequired').replace('{name}', label(tariff[1], t));
  const prepMissingColon = text.match(
    /^first_run: tariff_prep_missing:(water|electricity|internet|support_fee|capital_repair)/i,
  );
  if (prepMissingColon) {
    return t('admin.firstRunErrTariffPrepMissing').replace('{name}', label(prepMissingColon[1], t));
  }
  const prepMissing = text.match(
    /^first_run: tariff prep missing (water|electricity|internet|support_fee|capital_repair)/i,
  );
  if (prepMissing) return t('admin.firstRunErrTariffPrepMissing').replace('{name}', label(prepMissing[1], t));
  const tariffConflict = text.match(
    /^first_run: tariff conflict (water|electricity|internet|support_fee|capital_repair)/i,
  );
  if (tariffConflict) return t('admin.firstRunErrTariffConflict').replace('{name}', label(tariffConflict[1], t));

  // Already-localized conflict text (e.g. re-explained client message) — keep it.
  if (
    /опубликованная ставка, которая не совпадает с подготовкой/i.test(text) ||
    /published rate that does not match the preparation/i.test(text) ||
    /публикувана ставка, която не съвпада с подготовката/i.test(text)
  ) {
    return text;
  }

  return null;
}

export function explainFirstRunFailure(raw: unknown, t: T): FirstRunErrorView {
  const text = firstRunFailureText(raw);
  if (!text) return { message: t('admin.firstRunErrUnknown'), detail: null };
  if (isSecret(text)) {
    console.error('[first-run]', redactDiagnostic(text));
    return { message: t('admin.firstRunErrUnknown'), detail: null };
  }
  const known = knownMessage(text, t);
  if (known) {
    // Known codes stay user-facing only; no technical dump in the UI.
    return { message: known, detail: null };
  }
  if (/^first_run:/i.test(text)) {
    console.error('[first-run]', redactDiagnostic(text));
    return { message: t('admin.firstRunErrUnknown'), detail: null };
  }
  if (isSecret(text) || /PGRST|rpc_|relation |column |SQLSTATE|[0-9a-f]{8}-[0-9a-f]{4}-/i.test(text)) {
    console.error('[first-run]', redactDiagnostic(text));
    return { message: t('admin.firstRunErrUnknown'), detail: null };
  }
  // Already user-facing copy (complex form actions, localized banners) — keep it.
  // Do not console.error: that floods the console when Continue fails client-side validation.
  if (
    /[А-Яа-яЁёІіЇїЄєҐґ]/.test(text) ||
    /[«»""]/.test(text) ||
    /\b(Continue|Fix|enter|Enter|press|Press)\b/.test(text) ||
    /Продължи|Продолжить|Исправьте|Поправете/.test(text)
  ) {
    return { message: text, detail: null };
  }
  console.error('[first-run]', redactDiagnostic(text));
  return { message: t('admin.firstRunErrUnknown'), detail: null };
}

export function budgetYearStatusLabel(status: string, t: T): string {
  if (!BUDGET_STATUSES.has(status)) return t('admin.firstRunErrUnknown');
  return t(`admin.budgetStatus_${status}`);
}

export function tariffBasisLabel(basis: string | null | undefined, t: T): string | null {
  if (basis === 'general_meeting') return t('admin.tcBasisGm');
  if (basis === 'external_decision') return t('admin.tcBasisExternal');
  if (basis === 'supplier_notice') return t('admin.tcBasisSupplier');
  if (basis === 'legacy_import') return t('admin.tcBasisLegacy');
  return null;
}

// ---------------------------------------------------------------------------
// Property Book / meters import row presentation (codes → ru/en/bg labels)
// ---------------------------------------------------------------------------

function tryLabel(t: T, key: string): string | null {
  const v = t(key);
  return v && v !== key ? v : null;
}

/** Map import reason/code to a stable i18n key under admin.* when known. */
export function importReasonI18nKey(raw: string): string | null {
  const code = raw.trim();
  if (!code) return null;

  if (/^duplicate_rows:/i.test(code)) return null;

  const prefixed = code.match(
    /^(required|invalid|duplicate_in_file|missing_apartment|unsupported|inconsistent|mutually_exclusive|conflict|duplicate_serial):(.+)$/i,
  );
  if (prefixed) {
    const kind = prefixed[1].toLowerCase();
    const field = prefixed[2].trim().toLowerCase();
    if (kind === 'required') {
      const soft: Record<string, string> = {
        purpose: 'bookIssue_purpose_required',
        area_sqm: 'bookIssue_area_required',
        ideal_parts_percent: 'bookIssue_object_ideal_parts_required',
        ownership_type: 'bookIssue_ownership_type_required',
        entity_kind: 'bookIssue_entity_kind_required',
        first_name: 'bookIssue_natural_name_required',
        last_name: 'bookIssue_natural_name_required',
        entity_name: 'bookIssue_legal_name_required',
        eik_bulstat: 'bookIssue_eik_required',
        email: 'bookIssue_owner_email_required',
        ownership_share_percent: 'bookIssue_owner_share_required',
        apartment_number: 'bookImport_apartment_required',
        owners: 'bookIssue_owners_required',
        meter_number: 'importIssue_meter_number_required',
        installed_at: 'importIssue_installed_at_required',
        opening_balance_eur: 'importIssue_opening_balance_eur_required',
        obligation_type: 'importIssue_obligation_type_required',
        source_reference: 'importIssue_source_reference_required',
        transition_date: 'importIssue_transition_date_required',
      };
      return soft[field] ? `admin.${soft[field]}` : null;
    }
    if (kind === 'invalid') {
      const inv: Record<string, string> = {
        ownership_type: 'bookImport_invalid_ownership_type',
        area_sqm: 'bookImport_invalid_area',
        living_area_sqm: 'bookImport_invalid_living_area',
        ideal_parts_percent: 'bookImport_invalid_ideal_parts',
        entity_kind: 'bookImport_invalid_entity_kind',
        ownership_share_percent: 'bookImport_invalid_share',
        opening_balance_kind: 'importIssue_opening_balance_kind_invalid',
        opening_balance_eur: 'importIssue_opening_balance_eur_invalid',
        initial_reading: 'importIssue_initial_reading_invalid',
        initial_day_reading: 'importIssue_initial_day_reading_invalid',
        initial_night_reading: 'importIssue_initial_night_reading_invalid',
        installed_at: 'importIssue_installed_at_invalid',
        installed_at_future: 'importIssue_installed_at_future',
        billing_year: 'importIssue_billing_year_invalid',
        assessed_amount: 'importIssue_assessed_amount_invalid',
        historically_paid_amount: 'importIssue_historically_paid_invalid',
        remaining_debt: 'importIssue_remaining_debt_invalid',
        opening_overpayment: 'importIssue_opening_overpayment_invalid',
        transition_date: 'importIssue_transition_date_invalid',
        transition_date_future: 'importIssue_transition_date_future',
      };
      return inv[field] ? `admin.${inv[field]}` : null;
    }
    if (kind === 'duplicate_in_file') {
      const dup: Record<string, string> = {
        meter_number: 'importIssue_duplicate_meter_in_file',
        apartment_year: 'importIssue_duplicate_apartment_year',
        opening_overpayment_per_apartment: 'importIssue_duplicate_overpayment',
      };
      return `admin.${dup[field] ?? 'bookImport_duplicate_in_file'}`;
    }
    if (kind === 'duplicate_serial') return 'admin.importIssue_duplicate_serial';
    if (kind === 'missing_apartment') return 'admin.bookImport_create_confirm_required';
    if (kind === 'unsupported') {
      if (field === 'obligation_type') return 'admin.importIssue_obligation_type_unsupported';
    }
    if (kind === 'inconsistent') {
      const inc: Record<string, string> = {
        assessed_ne_paid_plus_remaining: 'importIssue_amounts_inconsistent',
        credit_and_debt_mutual_exclusive: 'importIssue_debt_credit_xor',
      };
      return inc[field] ? `admin.${inc[field]}` : null;
    }
    if (kind === 'mutually_exclusive' && field === 'debt_and_overpayment') {
      return 'admin.importIssue_debt_credit_xor';
    }
    if (kind === 'conflict') {
      const conf: Record<string, string> = {
        existing_opening_import_mismatch: 'importIssue_existing_opening_mismatch',
        existing_operational_charge: 'importIssue_existing_operational_charge',
        existing_opening_obligation: 'importIssue_existing_opening_obligation',
      };
      return conf[field] ? `admin.${conf[field]}` : null;
    }
  }

  const direct: Record<string, string> = {
    purpose_required: 'bookIssue_purpose_required',
    area_required: 'bookIssue_area_required',
    object_ideal_parts_required: 'bookIssue_object_ideal_parts_required',
    ownership_type_required: 'bookIssue_ownership_type_required',
    'required:ownership_type': 'bookIssue_ownership_type_required',
    owner_email_required: 'bookIssue_owner_email_required',
    owners_required: 'bookIssue_owners_required',
    natural_name_required: 'bookIssue_natural_name_required',
    legal_name_required: 'bookIssue_legal_name_required',
    eik_required: 'bookIssue_eik_required',
    owner_share_required: 'bookIssue_owner_share_required',
    owner_ideal_parts_required: 'bookIssue_owner_ideal_parts_required',
    entity_kind_required: 'bookIssue_entity_kind_required',
    sole_trader_name_required: 'bookIssue_sole_trader_name_required',
    ownership_identity_incomplete: 'bookIssue_ownership_identity_incomplete',
    mixed_natural_legal_forbidden: 'errMixedOwnership',
    shares_must_sum_100: 'bookImport_shares_sum_100',
    sole_requires_one_owner: 'bookImport_sole_one_owner',
    shared_requires_two_owners: 'bookImport_shared_two_owners',
    owner_ideal_parts_sum_mismatch: 'bookImport_ideal_parts_sum',
    apartment_count_mismatch: 'bookImport_apartment_count_mismatch',
    owner_without_object_row: 'bookImport_owner_without_object',
    object_row_missing: 'bookImport_owner_without_object',
    section_code_required_for_disambiguation: 'bookImport_section_required',
    duplicate_apartment: 'bookImport_duplicate_in_file',
    untrusted_property_id: 'bookImport_untrusted_property_id',
    untrusted_assessment_id: 'importIssue_untrusted_assessment_id',
    overwrite_requires_confirmation: 'bookImport_overwrite_required',
    area_sqm_invalid: 'bookImport_invalid_area',
    living_area_sqm_invalid: 'bookImport_invalid_living_area',
    ownership_share_invalid: 'bookImport_invalid_share',
    ownership_type_invalid: 'bookImport_invalid_ownership_type',
    ownership_type_conflict: 'bookImport_ownership_type_conflict',
    'invalid:ownership_type': 'bookImport_invalid_ownership_type',
    'invalid:entity_kind': 'bookImport_invalid_entity_kind',
    entity_kind_invalid: 'bookImport_invalid_entity_kind',
    unknown_apartment: 'importIssue_unknown_apartment',
    opening_balance_conflict_same_apartment: 'importIssue_opening_balance_conflict_same_apartment',
    overlapping_paid_periods: 'importIssue_overlapping_paid_periods',
    'inconsistent:connection_state': 'importIssue_inconsistent_connection_state',
    opening_correction_requires_confirm: 'importIssue_opening_correction_requires_confirm',
    connection_date_unknown: 'importIssue_connection_date_unknown',
    // Internet opening preview warnings / soft notes
    paid_through_only_no_period_start: 'importIssue_paid_through_only_no_period_start',
    paid_period_gap: 'importIssue_paid_period_gap',
    paid_period_gap_today: 'importIssue_paid_period_gap_today',
    payment_unknown: 'importIssue_payment_unknown',
    next_charge_not_scheduled_paid_through_not_after_today:
      'importIssue_next_charge_not_scheduled_paid_through_not_after_today',
    next_charge_not_scheduled_paid_period_expired: 'importIssue_next_charge_not_scheduled_paid_period_expired',
    next_charge_not_scheduled_paid_through_today: 'importIssue_next_charge_not_scheduled_paid_through_today',
    inactive_with_active_paid_period: 'importIssue_inactive_with_active_paid_period',
  };
  const hit = direct[code.toLowerCase()];
  return hit ? `admin.${hit}` : null;
}

/** Preview / result action for internet (and similar) opening imports. */
export function presentInternetImportOutcome(
  raw: string,
  t: T,
  opts?: { committed?: boolean },
): string {
  return presentImportCommitOutcome(raw, t, opts);
}

/** Commit / preview outcome codes → operator language (never show CREATED/FAILED raw). */
export function presentImportCommitOutcome(
  raw: string,
  t: T,
  opts?: { committed?: boolean },
): string {
  const code = raw.trim().toUpperCase().replace(/-/g, '_');
  if (!code) return '—';
  const committed = opts?.committed === true;
  const map: Record<string, string> = committed
    ? {
        CREATE: 'admin.internetImportOutcomeCreated',
        CREATED: 'admin.internetImportOutcomeCreated',
        UPDATE: 'admin.internetImportOutcomeUpdated',
        CORRECT: 'admin.internetImportOutcomeUpdated',
        CORRECTED: 'admin.internetImportOutcomeUpdated',
        SKIP: 'admin.internetImportOutcomeUnchanged',
        SKIPPED: 'admin.internetImportOutcomeUnchanged',
        SKIPPED_EXISTING: 'admin.internetImportOutcomeUnchanged',
        CONFLICT: 'admin.internetImportOutcomeConflict',
        ERROR: 'admin.internetImportOutcomeError',
        FAILED: 'admin.internetImportOutcomeError',
        NOT_PROCESSED: 'admin.internetImportOutcomeNotProcessed',
      }
    : {
        CREATE: 'admin.internetImportOutcomeWillCreate',
        CREATED: 'admin.internetImportOutcomeWillCreate',
        UPDATE: 'admin.internetImportOutcomeWillUpdate',
        CORRECT: 'admin.internetImportOutcomeWillUpdate',
        CORRECTED: 'admin.internetImportOutcomeWillUpdate',
        SKIP: 'admin.internetImportOutcomeWillSkip',
        SKIPPED: 'admin.internetImportOutcomeWillSkip',
        SKIPPED_EXISTING: 'admin.internetImportOutcomeWillSkip',
        CONFLICT: 'admin.internetImportOutcomeConflict',
        ERROR: 'admin.internetImportOutcomeError',
        FAILED: 'admin.internetImportOutcomeError',
        NOT_PROCESSED: 'admin.internetImportOutcomeNotProcessed',
      };
  const key = map[code];
  if (key) {
    const label = tryLabel(t, key);
    if (label) return label;
  }
  return t('admin.internetImportOutcomeUnknown');
}

/**
 * Internet opening warning codes → user copy via presentImportReason dictionary.
 * Unknown codes never appear as raw snake_case in the UI.
 * Returns null when the warning should be omitted from the row (e.g. prepaid noise).
 */
export function presentInternetImportWarning(
  raw: string,
  t: T,
  opts?: { billingMode?: string | null },
): string | null {
  const code = raw.trim();
  if (!code) return null;
  const mode = String(opts?.billingMode ?? '')
    .trim()
    .toLowerCase();
  // prepaid_period never schedules monthly charges — not a user-facing problem.
  if (
    mode === 'prepaid_period' &&
    (code === 'next_charge_not_scheduled_paid_through_not_after_today' ||
      code === 'next_charge_not_scheduled_paid_period_expired' ||
      code === 'next_charge_not_scheduled_paid_through_today')
  ) {
    return null;
  }
  const label = presentImportReason(code, t, { severity: 'warning' });
  // presentImportReason falls back to generic check-failed for unknowns — use soft warning copy.
  if (label === t('admin.firstRunImportRowCheckFailed')) {
    return t('admin.internetImportWarningUnknown');
  }
  return label;
}

export function presentInternetConnectionState(raw: string, t: T): string {
  const v = raw.trim().toLowerCase();
  if (v === 'active') return t('admin.internetConnectionStateActive');
  if (v === 'inactive') return t('admin.internetConnectionStateInactive');
  if (!v) return '—';
  return t('admin.internetConnectionStateUnknown');
}

export type PresentImportReasonOptions = {
  /** Blocking unknown codes append “import not performed” only when nothing was saved. */
  severity?: 'error' | 'warning';
  nothingSaved?: boolean;
};

export function presentImportReason(raw: string, t: T, options?: PresentImportReasonOptions): string {
  const key = importReasonI18nKey(raw);
  if (key) {
    const label = tryLabel(t, key);
    if (label) return label;
  }
  // Unknown codes: never auto-map to “needs clarification”. Explicit dictionary only.
  const checkFailed = t('admin.firstRunImportRowCheckFailed');
  if (options?.severity === 'error' && options.nothingSaved === true) {
    return `${checkFailed} ${t('admin.firstRunImportNotSaved')}`;
  }
  return checkFailed;
}

export function presentImportField(raw: string, t: T): string {
  const field = raw.trim();
  if (!field || field === '—' || field === '-') return '—';
  if (field === 'owners' || field === 'validation') return t('admin.bookImportFieldOwners');
  if (field === 'objects') return t('admin.bookImportFieldObjects');
  if (field === 'opening_balance_kind') return t('admin.is3ColOpeningBalanceKind');
  if (field === 'opening_balance_eur') return t('admin.is3ColOpeningBalanceEur');
  return propertyBookFieldLabel(field, t);
}

/**
 * Localized workbook sheet title for the UI.
 * Pseudo-sheet `validation` is mapped to objects/owners by field.
 */
export function presentImportSheet(sheet: string, field: string, t?: T): string {
  const s = sheet.trim().toLowerCase();
  const f = field.trim().toLowerCase();
  const ownersFields = new Set([
    'email',
    'first_name',
    'last_name',
    'middle_name',
    'entity_kind',
    'entity_name',
    'eik_bulstat',
    'ownership_share_percent',
    'ownership_type',
    'owners',
  ]);
  let kind: 'objects' | 'owners' | 'other' = 'other';
  if (s === 'objects' || s === 'объекты' || s === 'обекти') kind = 'objects';
  else if (s === 'owners' || s === 'собственники' || s === 'собственици') kind = 'owners';
  else if (ownersFields.has(f)) kind = 'owners';
  else if (s === 'validation' || !s) kind = 'objects';

  if (t) {
    if (kind === 'objects') return t('admin.bookImportSheetObjects');
    if (kind === 'owners') return t('admin.bookImportSheetOwners');
  }
  if (kind === 'objects') return 'objects';
  if (kind === 'owners') return 'owners';
  // Keep unknown real sheet names as returned by the parser (never invent codes).
  return sheet.trim() || (t ? t('admin.bookImportSheetObjects') : 'objects');
}

/** Full operator sentence for a grouped Book preview issue. */
export function presentBookPreviewIssue(issue: BookPreviewIssue, t: T): string {
  const sheet = presentImportSheet(issue.sheet, issue.field, t);
  const field = presentImportField(issue.field, t);
  const rowsLabel = formatExcelRowRanges(issue.rows);
  const aptRef = formatBookApartmentRef(t, {
    apartmentNumber: issue.apartment || '—',
    sectionCode: issue.sectionCode,
    blockCode: issue.blockCode,
  });
  const sectionsList = issue.candidateSections.join(', ');

  if (issue.reason === 'section_code_required_for_disambiguation' && sectionsList) {
    if (rowsLabel) {
      return t('admin.bookPreviewIssueAmbiguousAptRows', {
        sheet,
        rows: rowsLabel,
        apt: issue.apartment || '—',
        sections: sectionsList,
        field,
      });
    }
    return t('admin.bookPreviewIssueAmbiguousApt', {
      sheet,
      apt: issue.apartment || '—',
      sections: sectionsList,
      field,
    });
  }

  if (issue.reason === 'ownership_type_required' || issue.reason === 'required:ownership_type') {
    return t('admin.bookPreviewIssueOwnershipTypeMissing', {
      aptRef,
      sheet,
      row: rowsLabel || '—',
      field,
    });
  }

  if (
    issue.reason === 'ownership_type_invalid' ||
    issue.reason === 'invalid:ownership_type' ||
    issue.reason === 'entity_kind_invalid' ||
    issue.reason === 'invalid:entity_kind'
  ) {
    const allowed =
      issue.reason.includes('entity_kind')
        ? t('admin.bookPreviewAllowedEntityKinds')
        : t('admin.bookPreviewAllowedOwnershipTypes');
    return t('admin.bookPreviewIssueInvalidEnum', {
      aptRef,
      sheet,
      row: rowsLabel || '—',
      field,
      value: issue.value || '—',
      allowed,
    });
  }

  if (issue.reason === 'owners_required') {
    return t('admin.bookPreviewIssueOwnersMissing', {
      aptRef,
      sheet: presentImportSheet('owners', 'owners', t),
    });
  }

  const base = presentImportReason(issue.reason, t, {
    severity: issue.severity,
    nothingSaved: issue.severity === 'error',
  });
  if (rowsLabel) {
    return t('admin.bookPreviewIssueGenericRows', {
      sheet,
      rows: rowsLabel,
      aptRef,
      field,
      reason: base,
    });
  }
  return t('admin.bookPreviewIssueGeneric', {
    sheet,
    aptRef,
    field,
    reason: base,
  });
}

export function presentImportSeverity(severity: string | undefined, t: T): string {
  return severity === 'warning' ? t('admin.bookImportSeverityWarning') : t('admin.bookImportSeverityError');
}

export type PresentedImportErrorRow = {
  row: string;
  apartment: string;
  field: string;
  reason: string;
  sheet: string;
  severity: 'error' | 'warning';
  severityLabel: string;
};

export function presentFirstRunErrorRow(
  row: {
    sheet: string;
    row: string;
    field: string;
    reason: string;
    apartment: string;
    severity?: 'error' | 'warning';
    meta?: {
      candidateSections?: string[];
      sourceRows?: number[];
      sectionCode?: string;
      blockCode?: string;
      value?: string;
    };
  },
  t: T,
  options?: { nothingSaved?: boolean },
): PresentedImportErrorRow {
  const severity = row.severity === 'warning' ? 'warning' : 'error';
  const issue: BookPreviewIssue = {
    severity,
    reason: row.reason,
    sheet: row.sheet,
    field: row.field,
    apartment: row.apartment,
    sectionCode: row.meta?.sectionCode ?? '',
    blockCode: row.meta?.blockCode ?? '',
    rows:
      row.meta?.sourceRows?.length
        ? row.meta.sourceRows
        : row.row && Number(row.row) > 0
          ? [Number(row.row)]
          : [],
    candidateSections: row.meta?.candidateSections ?? [],
    value: row.meta?.value ?? '',
  };
  const rich =
    issue.candidateSections.length > 0 ||
    issue.reason === 'ownership_type_required' ||
    issue.reason === 'required:ownership_type' ||
    issue.reason === 'owners_required' ||
    issue.reason.includes('invalid');
  return {
    row: formatExcelRowRanges(issue.rows) || row.row || '—',
    apartment: row.apartment || '—',
    field: presentImportField(row.field, t),
    reason: rich
      ? presentBookPreviewIssue(issue, t)
      : presentImportReason(row.reason, t, {
          severity,
          nothingSaved: options?.nothingSaved,
        }),
    sheet: presentImportSheet(row.sheet, row.field, t),
    severity,
    severityLabel: presentImportSeverity(severity, t),
  };
}
