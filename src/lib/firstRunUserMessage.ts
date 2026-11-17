/**
 * Turns first-run server phrases into user-facing copy.
 * Server checks stay unchanged. Secrets are not shown or logged in full.
 */

import { propertyBookFieldLabel } from '@/lib/propertyBookHistory';
import { propertyBookIdentityKey } from '@/lib/propertyBookIdentity';
import {
  formatBookApartmentRef,
  formatExcelRowRanges,
  formatOwnerCountLocation,
  resolveBookPreviewSheetTitle,
  type BookApartmentPreviewCard,
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
  if (basis === 'invoice') return t('admin.tcBasisInvoice');
  if (basis === 'other') return t('admin.tcBasisOther');
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
    /^(required|invalid|incomplete|duplicate_in_file|missing_apartment|unsupported|inconsistent|mutually_exclusive|conflict|duplicate_serial):(.+)$/i,
  );
  if (prefixed) {
    const kind = prefixed[1].toLowerCase();
    const field = prefixed[2].trim().toLowerCase();
    if (kind === 'incomplete') {
      const inc: Record<string, string> = {
        paid_period_end: 'importIssue_incomplete_paid_period_end',
        paid_period_start: 'importIssue_incomplete_paid_period_start',
        paid_through: 'importIssue_incomplete_paid_period_end',
      };
      return inc[field] ? `admin.${inc[field]}` : null;
    }
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
        opening_balance_kind: 'importIssue_opening_balance_kind_required',
        obligation_type: 'importIssue_obligation_type_required',
        source_reference: 'importIssue_source_reference_required',
        transition_date: 'importIssue_transition_date_required',
        assessed_amount: 'importIssue_assessed_amount_required',
        historically_paid_amount: 'importIssue_historically_paid_required',
        remaining_debt: 'importIssue_remaining_debt_required',
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
        opening_balance_eur_hyphen: 'importIssue_opening_balance_eur_hyphen',
        opening_balance_eur_nonzero_for_zero: 'importIssue_opening_balance_eur_nonzero_for_zero',
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
        existing_obligation: 'importIssue_existing_opening_obligation',
        existing_charge: 'importIssue_existing_operational_charge',
        existing_opening_import: 'importIssue_existing_opening_mismatch',
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
    owner_vote_weight_mismatch: 'bookIssue_owner_vote_weight_mismatch',
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
    ownership_type_sheet_conflict: 'bookImport_ownership_type_sheet_conflict',
    owner_count_conflict: 'bookImport_owner_count_conflict',
    owner_count_mismatch: 'bookImport_owner_count_mismatch',
    'invalid:ownership_type': 'bookImport_invalid_ownership_type',
    'invalid:entity_kind': 'bookImport_invalid_entity_kind',
    entity_kind_invalid: 'bookImport_invalid_entity_kind',
    invalid_entity_kind: 'bookImport_invalid_entity_kind',
    invalid_ownership_type: 'bookImport_invalid_ownership_type',
    unknown_apartment: 'importIssue_unknown_apartment',
    opening_balance_conflict_same_apartment: 'importIssue_opening_balance_conflict_same_apartment',
    overlapping_paid_periods: 'importIssue_overlapping_paid_periods',
    'inconsistent:connection_state': 'importIssue_inconsistent_connection_state',
    opening_correction_requires_confirm: 'importIssue_opening_correction_requires_confirm',
    conflict_existing_subscription: 'importIssue_conflict_existing_subscription',
    'incomplete:paid_period_end': 'importIssue_incomplete_paid_period_end',
    'incomplete:paid_period_start': 'importIssue_incomplete_paid_period_start',
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
    needs_initial_readings: 'importIssue_needs_initial_readings',
    needs_initial_internet_state: 'importIssue_needs_initial_internet_state',
    can_enter_later: 'importIssue_can_enter_later',
    section_block_fields_swapped: 'importIssue_section_block_fields_swapped',
    section_code_looks_like_block_number: 'importIssue_section_code_looks_like_block_number',
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
        DEFER: 'admin.firstRunInternetPreviewStateEmpty',
        DEFERRED: 'admin.firstRunInternetPreviewStateEmpty',
        NEEDS_INITIAL: 'admin.firstRunInternetPreviewStateEmpty',
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
  if (field === 'opening_balance_kind') return t('admin.firstRunSfColKind');
  if (field === 'opening_balance_eur') return t('admin.firstRunSfColAmount');
  // Owners-template column (import preview), not the Book UI “ownership type” label.
  if (field === 'ownership_type') return t('admin.bookImportFieldOwnerCount');
  if (field === 'meter_number') return t('admin.is3ColMeterNumber');
  if (field === 'initial_reading') return t('admin.is3ColInitialReading');
  if (field === 'initial_day_reading') return t('admin.is3ColInitialDay');
  if (field === 'initial_night_reading') return t('admin.is3ColInitialNight');
  if (field === 'installed_at') return t('admin.is3ColInstalledAt');
  if (field === 'apartment_number') return t('admin.is3ColApartment');
  if (field === 'section_code') return t('admin.is3ColSection');
  if (field === 'block_code') return t('admin.is3ColBlock');
  if (field === 'connection_state' || field === 'status') return t('admin.is5ColConnectionState');
  if (field === 'internet_opening') return t('admin.firstRunStageInternetOpening');
  if (field === 'paid_period_end' || field === 'paid_through') return t('admin.is5ColPaidThrough');
  if (field === 'paid_period_start') return t('admin.is5ColPaidPeriodStart');
  if (field === 'support_fee_opening') return t('admin.firstRunStageSupportFee');
  if (field === 'capital_repair_opening') return t('admin.firstRunSfColAmount');
  if (field === 'billing_year') return t('admin.firstRunSfColYear');
  if (field === 'assessment_title') return t('admin.firstRunCrColTitle');
  if (field === 'obligation_type') return t('admin.is4ColObligationType');
  if (field === 'assessed_amount') return t('admin.is4ColAssessed');
  if (field === 'historically_paid_amount') return t('admin.is4ColHistoricallyPaid');
  if (field === 'remaining_debt') return t('admin.is4ColRemainingDebt');
  if (field === 'opening_overpayment') return t('admin.is4ColOpeningOverpayment');
  if (field === 'transition_date') return t('admin.is4ColTransitionDate');
  if (field === 'source_reference') return t('admin.is4ColSourceRef');
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
    if (
      s === 'opening_balances' ||
      s === 'начальные остатки' ||
      s === 'начални салда' ||
      s === 'opening balances' ||
      s.includes('opening') ||
      f === 'capital_repair_opening' ||
      f === 'support_fee_opening' ||
      f === 'opening_balance_eur'
    ) {
      return t('admin.firstRunSfDataSheet');
    }
    if (kind === 'objects') return t('admin.bookImportSheetObjects');
    if (kind === 'owners') return t('admin.bookImportSheetOwners');
    if (s === 'meters' || s === 'счётчики' || s === 'счетчики' || s === 'уреди') {
      return t('admin.firstRunMetersStatMeters');
    }
  }
  if (kind === 'objects') return 'objects';
  if (kind === 'owners') return 'owners';
  // Keep unknown real sheet names as returned by the parser (never invent codes).
  return sheet.trim() || (t ? t('admin.bookImportSheetObjects') : 'objects');
}

export type PresentBookPreviewOptions = {
  /** Apt/sheet/row live in the card chrome — keep the body action-only. */
  inCard?: boolean;
};

function trimCell(value: unknown): string {
  return String(value ?? '').trim();
}

function joinNaturalList(items: string[], t: T): string {
  const uniq = [...new Set(items.filter(Boolean))];
  if (uniq.length === 0) return '';
  if (uniq.length === 1) return uniq[0]!;
  const join = t('admin.bookPreviewPartialFieldsJoin');
  if (uniq.length === 2) return `${uniq[0]}${join}${uniq[1]}`;
  return `${uniq.slice(0, -1).join(', ')}${join}${uniq[uniq.length - 1]}`;
}

/** Filled owner payload field names (never PII values; never middle name). */
function savedOwnerFieldLabels(row: Record<string, string>, t: T): string[] {
  const out: string[] = [];
  if (trimCell(row.first_name)) out.push(t('admin.bookPreviewSavedFieldFirstName'));
  if (trimCell(row.last_name)) out.push(t('admin.bookPreviewSavedFieldLastName'));
  if (trimCell(row.email)) out.push(t('admin.bookPreviewSavedFieldEmail'));
  if (trimCell(row.phone) || trimCell(row.phone_secondary)) {
    out.push(t('admin.bookPreviewSavedFieldPhone'));
  }
  if (trimCell(row.entity_name)) out.push(t('admin.bookPreviewSavedFieldEntityName'));
  if (trimCell(row.eik_bulstat)) out.push(t('admin.bookPreviewSavedFieldEik'));
  if (trimCell(row.entity_kind)) out.push(t('admin.bookPreviewClarifyFieldEntityKind'));
  if (trimCell(row.ownership_share_percent)) out.push(t('admin.bookPreviewSavedFieldShare'));
  return out;
}

function clarifyOwnerFieldLabels(
  row: Record<string, string>,
  softCodes: string[],
  t: T,
): string[] {
  const codes = new Set(softCodes);
  const out: string[] = [];
  const needEntity =
    !trimCell(row.entity_kind) ||
    codes.has('entity_kind_required') ||
    codes.has('entity_kind_invalid') ||
    codes.has('invalid:entity_kind') ||
    codes.has('invalid_entity_kind');
  if (needEntity && !trimCell(row.entity_kind)) {
    out.push(t('admin.bookPreviewClarifyFieldEntityKind'));
  }
  if (!trimCell(row.ownership_share_percent) || codes.has('owner_share_required')) {
    if (!trimCell(row.ownership_share_percent)) {
      out.push(t('admin.bookPreviewClarifyFieldShare'));
    }
  }
  if (!trimCell(row.email) || codes.has('owner_email_required')) {
    if (!trimCell(row.email)) out.push(t('admin.bookPreviewClarifyFieldEmail'));
  }
  if (
    codes.has('natural_name_required') ||
    codes.has('sole_trader_name_required') ||
    (!trimCell(row.first_name) && !trimCell(row.last_name) && !trimCell(row.entity_name))
  ) {
    if (!trimCell(row.first_name) || !trimCell(row.last_name)) {
      if (!trimCell(row.entity_name)) out.push(t('admin.bookPreviewClarifyFieldName'));
    }
  }
  if (codes.has('legal_name_required') && !trimCell(row.entity_name)) {
    out.push(t('admin.bookPreviewClarifyFieldLegalName'));
  }
  if (codes.has('eik_required') && !trimCell(row.eik_bulstat)) {
    out.push(t('admin.bookPreviewClarifyFieldEik'));
  }
  if (
    (codes.has('ownership_type_required') || codes.has('required:ownership_type')) &&
    !trimCell(row.ownership_type)
  ) {
    out.push(t('admin.bookPreviewClarifyFieldOwnerCount'));
  }
  if (codes.has('owner_vote_weight_mismatch')) {
    out.push(t('admin.bookPreviewClarifyFieldVoteWeight'));
  }
  return [...new Set(out)];
}

function ownersForCard(
  card: Pick<BookApartmentPreviewCard, 'apartment' | 'sectionCode' | 'blockCode'>,
  owners: Array<Record<string, string>>,
): Record<string, string>[] {
  const key = propertyBookIdentityKey({
    apartment_number: card.apartment,
    section_code: card.sectionCode,
    block_code: card.blockCode,
  });
  if (!key) return [];
  return owners.filter((row) => propertyBookIdentityKey(row) === key);
}

function ownerDisplayName(row: Record<string, string>): string {
  const person = [trimCell(row.first_name), trimCell(row.last_name)].filter(Boolean).join(' ');
  if (person) return person;
  return trimCell(row.entity_name);
}

function softCodesFromIssue(issue: BookPreviewIssue | undefined): string[] {
  if (!issue) return [];
  return String(issue.value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export type BookApartmentCardBlock = {
  key: string;
  heading?: string;
  lines: string[];
};

export type PresentBookApartmentCardIssueOptions = {
  /** Card has a blocking error — partial lead must not promise a save. */
  hasBlockingError?: boolean;
  /** Owner rows from the uploaded file (for filled/missing field inventory). */
  owners?: Array<Record<string, string>>;
  apartment?: string;
  sectionCode?: string;
  blockCode?: string;
};

/** Structured body for an apartment-card issue (no apt/sheet/row repeats). */
export function presentBookApartmentCardIssueBody(
  issue: BookPreviewIssue,
  t: T,
  options?: PresentBookApartmentCardIssueOptions,
): { lead: string; bullets: string[]; later: string | null } {
  if (issue.reason === 'owners_required' || issue.reason === 'ownership_identity_incomplete') {
    return { lead: t('admin.bookPreviewIssueOwnersMissing'), bullets: [], later: null };
  }

  if (issue.reason === 'owner_partial_saved') {
    const cardOwners =
      options?.apartment != null
        ? ownersForCard(
            {
              apartment: options.apartment,
              sectionCode: options.sectionCode || '',
              blockCode: options.blockCode || '',
            },
            options.owners ?? [],
          )
        : options?.owners ?? [];
    const softCodes = softCodesFromIssue(issue);
    const row = cardOwners[0];
    const saved = row ? savedOwnerFieldLabels(row, t) : [];
    const clarify = row
      ? clarifyOwnerFieldLabels(row, softCodes, t)
      : softCodes
          .map((code) => {
            if (code === 'entity_kind_required') return t('admin.bookPreviewClarifyFieldEntityKind');
            if (code === 'owner_share_required') return t('admin.bookPreviewClarifyFieldShare');
            if (code === 'owner_email_required') return t('admin.bookPreviewClarifyFieldEmail');
            if (code === 'natural_name_required' || code === 'sole_trader_name_required') {
              return t('admin.bookPreviewClarifyFieldName');
            }
            if (code === 'legal_name_required') return t('admin.bookPreviewClarifyFieldLegalName');
            if (code === 'eik_required') return t('admin.bookPreviewClarifyFieldEik');
            if (code === 'ownership_type_required' || code === 'required:ownership_type') {
              return t('admin.bookPreviewClarifyFieldOwnerCount');
            }
            if (code === 'owner_vote_weight_mismatch') {
              return t('admin.bookPreviewClarifyFieldVoteWeight');
            }
            return '';
          })
          .filter(Boolean);
    if (options?.hasBlockingError) {
      return {
        lead: clarify.length
          ? t('admin.bookPreviewCanClarifyAfter', { fields: joinNaturalList(clarify, t) })
          : t('admin.bookPreviewIssuePartialBlockedLead'),
        bullets: [],
        later: null,
      };
    }
    const lead =
      saved.length > 0
        ? t('admin.bookPreviewWillSave', { fields: joinNaturalList(saved, t) })
        : t('admin.bookPreviewIssuePartialSavedLead');
    return {
      lead,
      bullets: [],
      later:
        clarify.length > 0
          ? t('admin.bookPreviewCanClarifyAfter', { fields: joinNaturalList(clarify, t) })
          : null,
    };
  }

  return {
    lead: presentBookPreviewIssue(issue, t, { inCard: true }),
    bullets: [],
    later: null,
  };
}

/**
 * One apartment card → operator-facing blocks.
 * Soft/identity: no Excel sheet/row. Blocking: fix text + where once.
 */
export function presentBookApartmentCardContent(
  card: BookApartmentPreviewCard,
  owners: Array<Record<string, string>>,
  t: T,
): { blocks: BookApartmentCardBlock[]; where: string } {
  const blocks: BookApartmentCardBlock[] = [];
  const hasBlocking = card.issues.some((i) => i.severity === 'error');

  for (const issue of card.issues) {
    if (issue.severity !== 'error') continue;
    blocks.push({
      key: `error-${issue.reason}-${issue.rows.join(',')}`,
      lines: [presentBookPreviewIssue(issue, t, { inCard: true })],
    });
  }

  const identity = card.issues.find(
    (i) => i.reason === 'owners_required' || i.reason === 'ownership_identity_incomplete',
  );
  if (identity) {
    blocks.push({
      key: 'identity',
      lines: [t('admin.bookPreviewIssueOwnersMissing')],
    });
    return { blocks, where: '' };
  }

  const partial = card.issues.find((i) => i.reason === 'owner_partial_saved');
  if (partial) {
    const matched = ownersForCard(card, owners);
    const softCodes = softCodesFromIssue(partial);

    if (matched.length <= 1) {
      const row = matched[0];
      const saved = row ? savedOwnerFieldLabels(row, t) : [];
      const clarify = row
        ? clarifyOwnerFieldLabels(row, softCodes, t)
        : clarifyOwnerFieldLabels({}, softCodes, t);
      const lines: string[] = [];
      if (!hasBlocking && saved.length > 0) {
        lines.push(t('admin.bookPreviewWillSave', { fields: joinNaturalList(saved, t) }));
      }
      if (clarify.length > 0) {
        lines.push(t('admin.bookPreviewCanClarifyAfter', { fields: joinNaturalList(clarify, t) }));
      } else if (hasBlocking) {
        // Blocking already listed; nothing more.
      }
      if (lines.length > 0) {
        blocks.push({ key: 'partial', lines });
      }
    } else {
      matched.forEach((row, idx) => {
        const saved = savedOwnerFieldLabels(row, t);
        const clarify = clarifyOwnerFieldLabels(row, softCodes, t);
        const lines: string[] = [];
        if (!hasBlocking && saved.length > 0) {
          lines.push(t('admin.bookPreviewWillSave', { fields: joinNaturalList(saved, t) }));
        }
        if (clarify.length > 0) {
          lines.push(t('admin.bookPreviewCanClarifyAfter', { fields: joinNaturalList(clarify, t) }));
        }
        if (lines.length === 0) return;
        const name = ownerDisplayName(row);
        const heading = name
          ? t('admin.bookPreviewOwnerHeadingNamed', { n: idx + 1, name })
          : t('admin.bookPreviewOwnerHeading', { n: idx + 1 });
        blocks.push({
          key: `owner-${idx}-${trimCell(row._row) || idx}`,
          heading,
          lines,
        });
      });
    }
  }

  for (const issue of card.issues) {
    if (issue.severity === 'error') continue;
    if (
      issue.reason === 'owner_partial_saved' ||
      issue.reason === 'owners_required' ||
      issue.reason === 'ownership_identity_incomplete'
    ) {
      continue;
    }
    blocks.push({
      key: `other-${issue.reason}`,
      lines: [presentBookPreviewIssue(issue, t, { inCard: true })],
    });
  }

  const where = hasBlocking ? presentBookApartmentCardWhere(card.issues, t) : '';
  return { blocks, where };
}

/** Full operator sentence for a grouped Book preview issue. */
export function presentBookPreviewIssue(
  issue: BookPreviewIssue,
  t: T,
  options?: PresentBookPreviewOptions,
): string {
  const inCard = options?.inCard === true;
  const sheet = resolveBookPreviewSheetTitle(issue, t);
  const field = presentImportField(issue.field, t);
  const rowsLabel = formatExcelRowRanges(issue.rows);
  const aptRef = formatBookApartmentRef(t, {
    apartmentNumber: issue.apartment || '—',
    sectionCode: issue.sectionCode,
    blockCode: issue.blockCode,
  });
  const sectionsList = issue.candidateSections.join(', ');
  const sectionCount = issue.candidateSections.length;

  if (issue.reason === 'section_code_required_for_disambiguation' && sectionsList) {
    const row = rowsLabel || '';
    if (sectionCount > 0) {
      return row
        ? t('admin.bookPreviewIssueAmbiguousAptAction', {
            apt: issue.apartment || '—',
            count: sectionCount,
            sections: sectionsList,
            field,
            row,
            sheet,
          })
        : t('admin.bookPreviewIssueAmbiguousAptActionNoRow', {
            apt: issue.apartment || '—',
            count: sectionCount,
            sections: sectionsList,
            field,
            sheet,
          });
    }
    return t('admin.bookPreviewIssueAmbiguousApt', {
      sheet,
      apt: issue.apartment || '—',
      sections: sectionsList,
      field,
      row: row || '—',
    });
  }

  if (issue.reason === 'ownership_type_required' || issue.reason === 'required:ownership_type') {
    return inCard
      ? t('admin.bookPreviewIssueOwnershipTypeMissingCard', { field })
      : t('admin.bookPreviewIssueOwnershipTypeMissing', {
          aptRef,
          sheet,
          row: rowsLabel || '—',
          field,
        });
  }

  if (issue.reason === 'ownership_type_conflict' || issue.reason === 'owner_count_conflict') {
    return t(
      issue.reason === 'owner_count_conflict'
        ? inCard
          ? 'admin.bookPreviewIssueOwnerCountConflictCard'
          : 'admin.bookPreviewIssueOwnerCountConflict'
        : inCard
          ? 'admin.bookPreviewIssueOwnershipTypeConflictCard'
          : 'admin.bookPreviewIssueOwnershipTypeConflict',
      {
        aptRef,
        sheet,
        rows: rowsLabel || '—',
        field,
        values: issue.value || '—',
      },
    );
  }

  if (issue.reason === 'owner_count_mismatch') {
    const [declaredPart, actualPart] = issue.value.split('/');
    if (inCard) {
      return t('admin.bookPreviewIssueOwnerCountMismatchCard', {
        declared: declaredPart || '—',
        actual: actualPart || '—',
      });
    }
    const location = formatOwnerCountLocation(t, {
      apartmentNumber: issue.apartment || '—',
      sectionCode: issue.sectionCode,
      blockCode: issue.blockCode,
    });
    return t('admin.bookPreviewIssueOwnerCountMismatch', {
      location,
      declared: declaredPart || '—',
      actual: actualPart || '—',
    });
  }

  if (issue.reason === 'ownership_type_sheet_conflict') {
    return t(
      inCard
        ? 'admin.bookPreviewIssueOwnershipTypeSheetConflictCard'
        : 'admin.bookPreviewIssueOwnershipTypeSheetConflict',
      {
        aptRef,
        field,
        objectsValue: issue.value.split('/')[0] || '—',
        ownersValue: issue.value.split('/')[1] || '—',
      },
    );
  }

  if (
    issue.reason === 'ownership_type_invalid' ||
    issue.reason === 'invalid:ownership_type' ||
    issue.reason === 'invalid_ownership_type' ||
    issue.reason === 'entity_kind_invalid' ||
    issue.reason === 'invalid:entity_kind' ||
    issue.reason === 'invalid_entity_kind'
  ) {
    const isEntityKind = issue.reason.includes('entity_kind');
    const allowed = isEntityKind
      ? t('admin.bookPreviewAllowedEntityKinds')
      : t('admin.bookPreviewAllowedOwnershipTypes');
    return inCard
      ? t('admin.bookPreviewIssueInvalidEnumCard', {
          field,
          value: issue.value || '—',
          allowed,
        })
      : t('admin.bookPreviewIssueInvalidEnum', {
          aptRef,
          sheet,
          row: rowsLabel || '—',
          field,
          value: issue.value || '—',
          allowed,
        });
  }

  if (issue.reason === 'owners_required' || issue.reason === 'ownership_identity_incomplete') {
    return t('admin.bookPreviewIssueOwnersMissing');
  }

  if (issue.reason === 'owner_partial_saved') {
    const body = presentBookApartmentCardIssueBody(issue, t);
    const parts = [body.lead];
    if (body.bullets.length === 1) {
      parts.push(t('admin.bookPreviewIssuePartialNeedOne', { field: body.bullets[0]! }));
    } else if (body.bullets.length > 1) {
      parts.push(
        ...body.bullets.map((b) => t('admin.bookPreviewIssuePartialBullet', { field: b })),
      );
    }
    if (body.later) parts.push(body.later);
    return parts.join('\n');
  }

  const base = presentImportReason(issue.reason, t, {
    severity: issue.severity,
    nothingSaved: issue.severity === 'error',
  });
  if (inCard) {
    return field && field !== '—'
      ? t('admin.bookPreviewIssueGenericCard', { field, reason: base })
      : base;
  }
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

/**
 * Sheet (+ row when known) under a card message.
 * Omits the row entirely when unknown — never shows «строка —».
 * Soft/identity issues must not call this for apartment cards.
 */
export function presentBookPreviewIssueWhere(issue: BookPreviewIssue, t: T): string {
  // Ambiguous action already embeds sheet/row/column once.
  if (issue.reason === 'section_code_required_for_disambiguation') return '';
  const sheet = resolveBookPreviewSheetTitle(issue, t);
  const rowsLabel = formatExcelRowRanges(issue.rows);
  const field = presentImportField(issue.field, t);
  if (!sheet) return '';
  if (rowsLabel && field && field !== '—') {
    return t('admin.bookPreviewIssueSheetRowField', { sheet, row: rowsLabel, field });
  }
  if (rowsLabel) return t('admin.bookPreviewIssueSheetRow', { sheet, row: rowsLabel });
  return t('admin.bookPreviewIssueSheetOnly', { sheet });
}

/** Where-line for blocking apartment cards only (never soft/identity). */
export function presentBookApartmentCardWhere(issues: BookPreviewIssue[], t: T): string {
  const hard = issues.filter((i) => i.severity === 'error');
  if (hard.length === 0) return '';
  const preferred =
    hard.find((i) => i.rows.length > 0) || hard[0]!;
  return presentBookPreviewIssueWhere(preferred, t);
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

function formatOpeningNetBalanceLabel(netRaw: string | undefined, t: T): string {
  const net = Number(String(netRaw ?? '').replace(',', '.'));
  if (!Number.isFinite(net)) return String(netRaw ?? '—');
  const abs = Math.abs(net);
  const pretty = Number.isInteger(abs) ? String(abs) : abs.toFixed(2);
  if (net > 0) return t('admin.firstRunSfBalanceDebt', { amount: pretty });
  if (net < 0) return t('admin.firstRunSfBalanceCredit', { amount: pretty });
  return t('admin.firstRunSfBalanceZero', { amount: '0' });
}

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
      billingYear?: string;
      savedNet?: string;
      newNet?: string;
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
    issue.reason === 'section_block_fields_swapped' ||
    issue.reason === 'section_code_looks_like_block_number' ||
    issue.reason.includes('invalid');
  let reasonText = rich
    ? presentBookPreviewIssue(issue, t)
    : presentImportReason(row.reason, t, {
        severity,
        nothingSaved: options?.nothingSaved,
      });
  if (
    issue.reason === 'section_block_fields_swapped' ||
    issue.reason === 'section_code_looks_like_block_number' ||
    issue.reason === 'unknown_apartment' ||
    issue.reason === 'section_code_required_for_disambiguation' ||
    issue.reason === 'apartment_number_required' ||
    issue.reason === 'required:apartment_number'
  ) {
    const base = presentImportReason(issue.reason, t, { severity });
    const apt = row.apartment || '—';
    const section = row.meta?.sectionCode ? String(row.meta.sectionCode) : '';
    const excelRow = formatExcelRowRanges(issue.rows) || row.row || '—';
    const field = presentImportField(row.field || 'apartment_number', t);
    const where = t('admin.firstRunMetersErrorWhere', {
      apt,
      section: section || '—',
      row: excelRow,
      field,
    });
    reasonText = `${base} ${where}`;
  }
  if (
    /conflict:existing_opening_import_mismatch/i.test(row.reason) &&
    (row.meta?.savedNet != null || row.meta?.newNet != null)
  ) {
    const section = row.meta?.sectionCode ? String(row.meta.sectionCode).trim() : '';
    reasonText = t('admin.importIssue_existing_opening_mismatch_detail', {
      apt: row.apartment || '—',
      sectionPart: section
        ? t('admin.importIssue_existing_opening_section_part', { section })
        : '',
      year: row.meta?.billingYear || '—',
      saved: formatOpeningNetBalanceLabel(row.meta?.savedNet, t),
      new: formatOpeningNetBalanceLabel(row.meta?.newNet, t),
    });
  }
  return {
    row: formatExcelRowRanges(issue.rows) || row.row || '—',
    apartment: row.apartment || '—',
    field: presentImportField(row.field, t),
    reason: reasonText,
    sheet: presentImportSheet(row.sheet, row.field, t),
    severity,
    severityLabel: presentImportSeverity(severity, t),
  };
}
