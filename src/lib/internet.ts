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

export function canSeeInternetAdmin(role?: string | null) {
  return role === 'администрация' || role === 'бухгалтер';
}

export function internetStatusMessageKey(status: string): string {
  if (status === 'pending_enable') return 'admin.internetStatusPendingEnable';
  if (status === 'active') return 'admin.internetStatusActive';
  if (status === 'pending_disable') return 'admin.internetStatusPendingDisable';
  return 'admin.internetStatusInactive';
}
