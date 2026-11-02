/**
 * Turns first-run server phrases into user-facing copy.
 * Server checks stay unchanged. Secrets are not shown or logged in full.
 */

const STAGE_LABEL: Record<string, string> = {
  welcome: 'admin.firstRunStageWelcome',
  complex_card: 'admin.firstRunStageComplex',
  property_book: 'admin.firstRunStagePropertyBook',
  meters_select: 'admin.firstRunStageMetersSelect',
  meters_water: 'admin.firstRunStageMetersWater',
  meters_electricity: 'admin.firstRunStageMetersElectricity',
  support_fee_opening: 'admin.firstRunStageSupportFee',
  capital_repair_opening: 'admin.firstRunStageCapitalRepair',
  tariffs: 'admin.firstRunStageTariffs',
  budget: 'admin.firstRunStageBudget',
  complete: 'admin.firstRunStageComplete',
  water: 'admin.firstRunTariffWater',
  electricity: 'admin.firstRunTariffElectricity',
  support_fee: 'admin.firstRunTariffSupportFee',
  capital_repair: 'admin.firstRunTariffCapitalRepair',
};

const BUDGET_STATUSES = new Set(['draft', 'published', 'adopted', 'closed']);

export type FirstRunErrorView = {
  message: string;
  /** Redacted technical phrase for diagnosis. Absent when it would expose a secret. */
  detail: string | null;
};

type T = (key: string) => string;

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
  if (/^first_run: budget year .+ must be published or adopted/i.test(text)) {
    return t('admin.firstRunErrBudgetNotPublished');
  }
  if (/^first_run: budget lines missing/i.test(text)) return t('admin.firstRunErrBudgetLines');
  if (/^first_run: zero budget plan requires confirmation$/i.test(text)) return t('admin.firstRunErrBudgetZero');
  if (/^first_run: budget module must be enabled$/i.test(text)) return t('admin.firstRunErrBudgetModule');

  const tariff = text.match(/^first_run: published (water|electricity|support_fee|capital_repair) tariff/i);
  if (tariff) return t('admin.firstRunErrTariffRequired').replace('{name}', label(tariff[1], t));

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
  if (known) return { message: known, detail: text };
  if (/^first_run:/i.test(text)) {
    console.error('[first-run]', redactDiagnostic(text));
    return { message: t('admin.firstRunErrUnknown'), detail: redactDiagnostic(text) };
  }
  return { message: text, detail: null };
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
