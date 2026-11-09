/** Internet module helpers. UX only — RPCs are the security boundary. */

export const INTERNET_STATUSES = [
  'pending_enable',
  'active',
  'pending_disable',
  'inactive',
] as const;

export type InternetStatus = (typeof INTERNET_STATUSES)[number];

export type InternetSubscription = {
  id: string;
  property_id: number;
  status: InternetStatus | string;
  period_start: string | null;
  period_end: string | null;
  pending_days: number | null;
  disable_reason: string | null;
  enable_work_order_id: string | null;
  disable_work_order_id: string | null;
  billing_day: number | null;
  billing_anchor_date: string | null;
  next_charge_on: string | null;
  created_at: string;
  updated_at: string;
};

export type InternetLedger = {
  id: string;
  property_id: number;
  kind: string;
  amount_eur: number;
  period_days: number | null;
  tariff_version_id: string | null;
  note: string | null;
  recorded_by_email: string | null;
  idempotency_key: string;
  created_at: string;
};

export type InternetMonthlyPreview = {
  month_rate_eur: number;
  amount_eur: number;
  tariff_version_id: string;
};

export type ClaimableSystemWorkOrder = {
  id: string;
  title: string;
  instructions: string | null;
  status: string;
  priority: string;
  apartment_number: string | null;
  internet_action: string | null;
  created_at: string;
};

export type InternetWorkOrderRow = {
  id: string;
  title: string;
  instructions: string | null;
  status: string;
  priority: string;
  internet_action: string | null;
  assigned_staff_id: number | null;
  assignee_name: string | null;
  apartment_number: string | null;
  property_id: number | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  completion_note: string | null;
};

export const INTERNET_BILLING_METHODS = ['package_plus_days', 'daily'] as const;

export type InternetBillingMethod = (typeof INTERNET_BILLING_METHODS)[number];

/** @deprecated Prefer InternetBillingMethod */
export type InternetCalcMethod = InternetBillingMethod;

export type InternetPeriodQuote = {
  calendar_days: number;
  package_count: number;
  extra_days: number;
  package_rate_eur: number;
  day_rate_eur: number;
  amount_eur: number;
  tariff_version_id: string;
  billing_method: InternetBillingMethod;
};

export function internetBillingMethodLabelKey(method: InternetBillingMethod): string {
  if (method === 'daily') return 'admin.internetBillingDaily';
  return 'admin.internetBillingPackagePlusDays';
}

/** Client preview only — server quote is authoritative. */
export function previewInternetPeriodAmount(
  calendarDays: number,
  method: InternetBillingMethod,
  packageRateEur: number,
  dayRateEur: number,
): { package_count: number; extra_days: number; amount_eur: number } {
  if (!(calendarDays > 0) || !Number.isFinite(calendarDays)) {
    return { package_count: 0, extra_days: 0, amount_eur: 0 };
  }
  if (method === 'daily') {
    return {
      package_count: 0,
      extra_days: calendarDays,
      amount_eur: Math.round(calendarDays * dayRateEur * 100) / 100,
    };
  }
  const packageCount = Math.floor(calendarDays / 30);
  const extraDays = calendarDays % 30;
  return {
    package_count: packageCount,
    extra_days: extraDays,
    amount_eur: Math.round((packageCount * packageRateEur + extraDays * dayRateEur) * 100) / 100,
  };
}

/** Inclusive Sofia calendar days: end − start + 1. */
export function internetCalendarDays(periodStart: string, periodEnd: string): number | null {
  const start = String(periodStart ?? '').trim();
  const end = String(periodEnd ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return null;
  if (end < start) return null;
  const a = Date.UTC(Number(start.slice(0, 4)), Number(start.slice(5, 7)) - 1, Number(start.slice(8, 10)));
  const b = Date.UTC(Number(end.slice(0, 4)), Number(end.slice(5, 7)) - 1, Number(end.slice(8, 10)));
  return Math.round((b - a) / 86_400_000) + 1;
}

export function canSeeInternetAdmin(role?: string | null) {
  return role === 'администрация' || role === 'бухгалтер';
}

export function canConfirmInternetPeriod(role?: string | null, active?: boolean | null) {
  if (active !== true) return false;
  const r = (role ?? '').trim().toLowerCase();
  return r === 'администрация' || r === 'инженер';
}

export function internetStatusMessageKey(status: string): string {
  if (status === 'pending_enable') return 'admin.internetStatusPendingEnable';
  if (status === 'active') return 'admin.internetStatusActive';
  if (status === 'pending_disable') return 'admin.internetStatusPendingDisable';
  return 'admin.internetStatusInactive';
}
