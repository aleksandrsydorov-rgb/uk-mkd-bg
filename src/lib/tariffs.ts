/** Tariff Core helpers. UX only — RPCs are the security boundary.
 *  Package 2: Water/Electricity billing resolves from Core. Support Fee still legacy.
 */

export const TARIFF_KEYS = ['support_fee', 'water', 'electricity'] as const;
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

/** Package 2: Support + Water + Electricity future published versions are cancellable in UI. */
export function canCancelTariffVersionInUi(row: {
  module_key: string;
  status: string;
  valid_from: string;
}, sofiaTodayIso: string) {
  if (!['support_fee', 'water', 'electricity'].includes(row.module_key)) return false;
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
