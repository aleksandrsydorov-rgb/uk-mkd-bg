export type PaymentReceiptModule =
  | 'water'
  | 'electricity'
  | 'internet'
  | 'support_fee'
  | 'capital_repair';

export type PaymentReceiptStatus =
  | 'pending_details'
  | 'pending_pdf'
  | 'ready'
  | 'failed'
  | 'voided';

export type PaymentReceiptPurposeLine = {
  service_code?: string;
  service_label_bg?: string;
  description_bg?: string;
  period?: string | null;
  amount_eur?: number;
  is_advance?: boolean;
};

export type PaymentReceiptRow = {
  id: string;
  series: string;
  number: number;
  number_display: string;
  status: PaymentReceiptStatus;
  source_module: PaymentReceiptModule;
  ledger_id: string;
  property_id: number;
  amount_eur: number;
  currency: string;
  payment_at: string;
  payment_date: string;
  issued_at: string;
  voided_at: string | null;
  void_reason: string | null;
  payer_name: string;
  payer_details: Record<string, unknown> | null;
  payment_method: string | null;
  external_refs: Record<string, unknown> | null;
  purpose_lines: PaymentReceiptPurposeLine[] | null;
  note: string | null;
  is_advance: boolean;
  recorded_by_email: string;
  recorded_by_name: string | null;
  owner_email_at_issue: string | null;
  apartment_number: string;
  party_snapshot: {
    complex?: Record<string, unknown>;
    management_company?: Record<string, unknown>;
    bank_accounts?: unknown[];
  } | null;
  missing_uk_fields: string[] | null;
  storage_path: string | null;
  pdf_sha256: string | null;
  pdf_error: string | null;
};

export const PAYMENT_RECEIPTS_BUCKET = 'payment-receipts';
