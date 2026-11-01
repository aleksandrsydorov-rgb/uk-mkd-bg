/** Tariff Core helpers. UX only — RPCs are the security boundary.
 *  Live tariff_keys: support_fee, capital_repair, water, electricity, internet.
 *  See docs/architecture-cores.md.
 */

export const TARIFF_KEYS = ['support_fee', 'capital_repair', 'water', 'electricity', 'internet'] as const;
export type TariffKey = (typeof TARIFF_KEYS)[number];

export const TARIFF_TABS = ['current', 'scheduled', 'history'] as const;
export type TariffTab = (typeof TARIFF_TABS)[number];

export type TariffListRow = {
  tariff_id: string;
  tariff_key: string;
  module_key: string;
  default_name: string;
  unit_code: string;
  currency: string;
  calculation_type: string;
  billing_period: string | null;
  application_basis: string;
  governance_type: string;
  component_keys: string[];
  active: boolean;
  current_version_id: string | null;
  current_valid_from: string | null;
  current_rates: Record<string, number> | null;
  current_basis_type: string | null;
  current_basis_note: string | null;
  current_basis_date: string | null;
  current_published_at: string | null;
  current_legacy_author: string | null;
  nearest_future_version_id: string | null;
  nearest_future_valid_from: string | null;
  nearest_future_rates: Record<string, number> | null;
  nearest_future_basis_type: string | null;
  nearest_future_basis_note: string | null;
  nearest_future_basis_date: string | null;
  nearest_future_published_at: string | null;
};

export type TariffHistoryRow = {
  version_id: string;
  tariff_id: string;
  valid_from: string;
  status: string;
  rates: Record<string, number> | null;
  basis_type: string;
  basis_reference: string | null;
  basis_date: string | null;
  basis_note: string;
  decision_id: string | null;
  published_at: string;
  published_by: string | null;
  legacy_author: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
};

export function canViewTariffCore(role?: string | null, active?: boolean | null) {
  if (active !== true) return false;
  return role === 'администрация' || role === 'бухгалтер';
}

export function canPublishSupportTariff(role?: string | null, active?: boolean | null) {
  return active === true && role === 'администрация';
}

export function canPublishUtilityTariff(role?: string | null, active?: boolean | null) {
  if (active !== true) return false;
  return role === 'администрация' || role === 'бухгалтер';
}

/** Package 2+: future published versions are cancellable in UI. */
export function canCancelTariffVersionInUi(row: {
  module_key: string;
  status: string;
  valid_from: string;
}, sofiaTodayIso: string) {
  if (!['support_fee', 'capital_repair', 'water', 'electricity', 'internet'].includes(row.module_key)) return false;
  if (row.status !== 'published') return false;
  return row.valid_from > sofiaTodayIso;
}

export type ApplicableUtilityTariff = {
  tariff_version_id: string;
  tariff_key: string;
  valid_from: string;
  rates: Record<string, number>;
};

export function normalizeApplicableUtilityTariff(
  row: Record<string, unknown> | null | undefined,
): ApplicableUtilityTariff | null {
  if (!row) return null;
  const rates = parseRatesJson(row.rates);
  if (!rates) return null;
  const id = String(row.tariff_version_id ?? '');
  const key = String(row.tariff_key ?? '');
  const validFrom = String(row.valid_from ?? '');
  if (!id || !key || !validFrom) return null;
  return {
    tariff_version_id: id,
    tariff_key: key,
    valid_from: validFrom,
    rates,
  };
}

export function waterRateFromApplicable(t: ApplicableUtilityTariff | null | undefined): number | null {
  if (!t) return null;
  const n = Number(t.rates.base);
  return Number.isFinite(n) ? n : null;
}

export function electricityRatesFromApplicable(t: ApplicableUtilityTariff | null | undefined): {
  day: number;
  night: number;
} | null {
  if (!t) return null;
  const day = Number(t.rates.day);
  const night = Number(t.rates.night);
  if (!Number.isFinite(day) || !Number.isFinite(night)) return null;
  return { day, night };
}

export function sofiaTodayIsoDate(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Sofia',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function sofiaCurrentYear(now = new Date()): number {
  return Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Europe/Sofia',
      year: 'numeric',
    }).format(now),
  );
}

export function formatTariffRate(value: number | null | undefined, locale: string): string {
  if (value == null || Number.isNaN(Number(value))) return '—';
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(Number(value));
}

export function parseRatesJson(raw: unknown): Record<string, number> | null {
  if (raw == null) return null;
  if (typeof raw === 'string') {
    try {
      return parseRatesJson(JSON.parse(raw));
    } catch {
      return null;
    }
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    out[k] = n;
  }
  return out;
}

export function normalizeTariffListRow(row: Record<string, unknown>): TariffListRow {
  return {
    ...(row as unknown as TariffListRow),
    current_rates: parseRatesJson(row.current_rates),
    nearest_future_rates: parseRatesJson(row.nearest_future_rates),
    component_keys: Array.isArray(row.component_keys)
      ? (row.component_keys as string[])
      : [],
  };
}

export function normalizeTariffHistoryRow(row: Record<string, unknown>): TariffHistoryRow {
  return {
    ...(row as unknown as TariffHistoryRow),
    rates: parseRatesJson(row.rates),
  };
}

export function applicationYearFromValidFrom(validFrom: string | null | undefined): number | null {
  if (!validFrom) return null;
  const y = Number(String(validFrom).slice(0, 4));
  return Number.isFinite(y) ? y : null;
}

/** Support Fee publish intents — Task 07 annual policy. */
export type SupportFeePublishIntent = 'activation' | 'next_year' | 'amend';

export function supportFeeHasCurrentTariff(row: Pick<TariffListRow, 'current_version_id'> | null | undefined): boolean {
  return Boolean(row?.current_version_id);
}

export function defaultSupportFeePublishIntent(
  row: Pick<TariffListRow, 'current_version_id'> | null | undefined,
): SupportFeePublishIntent {
  return supportFeeHasCurrentTariff(row) ? 'next_year' : 'activation';
}

/** Planned Support Fee years: only the next calendar year (not +2/+3…). */
export function supportFeePlannedApplicationYear(now = new Date()): number {
  return sofiaCurrentYear(now) + 1;
}

export function supportFeeAllowedApplicationYears(
  intent: SupportFeePublishIntent,
  now = new Date(),
): number[] {
  const current = sofiaCurrentYear(now);
  const next = current + 1;
  if (intent === 'activation') return [current, next];
  if (intent === 'amend') return [current];
  return [next];
}

export function validateSupportFeePublishInput(args: {
  intent: SupportFeePublishIntent;
  applicationYear: number;
  validFrom: string | null | undefined;
  hasCurrentTariff: boolean;
  todayIso?: string;
}): { ok: true } | { ok: false; errorKey: string } {
  const today = args.todayIso ?? sofiaTodayIsoDate();
  const current = Number(today.slice(0, 4));
  const next = current + 1;
  const year = args.applicationYear;

  if (!Number.isFinite(year)) {
    return { ok: false, errorKey: 'admin.tcErrSupportYear' };
  }

  if (args.intent === 'activation') {
    if (args.hasCurrentTariff) {
      return { ok: false, errorKey: 'admin.tcErrSupportActivationDone' };
    }
    if (year !== current && year !== next) {
      return { ok: false, errorKey: 'admin.tcErrSupportActivationYear' };
    }
    return { ok: true };
  }

  if (args.intent === 'next_year') {
    if (year !== next) {
      return { ok: false, errorKey: 'admin.tcErrSupportNextYearOnly' };
    }
    return { ok: true };
  }

  // amend in-force rate from publication date — does not rewrite old assessments
  if (!args.hasCurrentTariff) {
    return { ok: false, errorKey: 'admin.tcErrSupportAmendNeedsCurrent' };
  }
  if (year !== current) {
    return { ok: false, errorKey: 'admin.tcErrSupportAmendYear' };
  }
  const vf = String(args.validFrom ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(vf) || vf < today) {
    return { ok: false, errorKey: 'admin.tcErrValidFrom' };
  }
  return { ok: true };
}

export function supportFeePublishValidFrom(args: {
  intent: SupportFeePublishIntent;
  applicationYear: number;
  amendValidFrom: string | null | undefined;
}): string | null {
  if (args.intent === 'amend') {
    return String(args.amendValidFrom ?? '').trim() || null;
  }
  return null;
}

/** Capital Repair publish intents — Task 11 (same lifecycle as Support Fee). */
export type CapitalRepairPublishIntent = SupportFeePublishIntent;

export const capitalRepairHasCurrentTariff = supportFeeHasCurrentTariff;
export const defaultCapitalRepairPublishIntent = defaultSupportFeePublishIntent;
export const capitalRepairPlannedApplicationYear = supportFeePlannedApplicationYear;
export const capitalRepairAllowedApplicationYears = supportFeeAllowedApplicationYears;
export const capitalRepairPublishValidFrom = supportFeePublishValidFrom;

export function validateCapitalRepairPublishInput(args: {
  intent: CapitalRepairPublishIntent;
  applicationYear: number;
  validFrom: string | null | undefined;
  hasCurrentTariff: boolean;
  todayIso?: string;
}): { ok: true } | { ok: false; errorKey: string } {
  const result = validateSupportFeePublishInput(args);
  if (result.ok) return result;
  const map: Record<string, string> = {
    'admin.tcErrSupportYear': 'admin.tcErrCapitalYear',
    'admin.tcErrSupportActivationDone': 'admin.tcErrCapitalActivationDone',
    'admin.tcErrSupportActivationYear': 'admin.tcErrCapitalActivationYear',
    'admin.tcErrSupportNextYearOnly': 'admin.tcErrCapitalNextYearOnly',
    'admin.tcErrSupportAmendNeedsCurrent': 'admin.tcErrCapitalAmendNeedsCurrent',
    'admin.tcErrSupportAmendYear': 'admin.tcErrCapitalAmendYear',
  };
  return { ok: false, errorKey: map[result.errorKey] ?? result.errorKey };
}
