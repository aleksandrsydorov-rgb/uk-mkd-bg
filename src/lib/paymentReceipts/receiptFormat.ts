import type { PaymentReceiptPurposeLine, PaymentReceiptRow } from '@/lib/paymentReceipts/types';

/** Safe print margin on every A4 edge (mm). Single source of truth for PDF generator. */
export const RECEIPT_MARGIN_MM = 18;
export const RECEIPT_PAGE_W_MM = 210;
export const RECEIPT_PAGE_H_MM = 297;
export const RECEIPT_CONTENT_W_MM = RECEIPT_PAGE_W_MM - RECEIPT_MARGIN_MM * 2;

export function formatReceiptSeriesNumber(row: Pick<PaymentReceiptRow, 'series' | 'number' | 'number_display'>): string {
  const series = String(row.series || 'KP').trim() || 'KP';
  const n = Number(row.number);
  if (Number.isFinite(n) && n > 0) {
    return `Серия ${series} · № ${String(Math.trunc(n)).padStart(6, '0')}`;
  }
  const raw = String(row.number_display || '').trim();
  const m = raw.match(/^([A-Za-zА-Яа-я]+)-(\d+)$/);
  if (m) return `Серия ${m[1]} · № ${m[2]}`;
  return raw || `Серия ${series}`;
}

export function formatReceiptDateBg(isoDate: string | null | undefined): string {
  if (!isoDate) return '—';
  const d = String(isoDate).slice(0, 10);
  const [y, m, day] = d.split('-');
  if (!y || !m || !day) return String(isoDate);
  return `${day}.${m}.${y}`;
}

export function formatReceiptMoney(amount: number, currency: string): string {
  const n = Number(amount);
  const formatted = Number.isFinite(n)
    ? n.toLocaleString('bg-BG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '—';
  return `${formatted} ${currency || 'EUR'}`;
}

export function receiptPaymentMethodLabel(method: string | null | undefined): string {
  const m = (method || '').toLowerCase();
  if (m === 'cash' || m === 'в брой' || m === 'cash_bg') return 'В брой';
  if (m === 'bank' || m === 'transfer' || m === 'банков превод') return 'Банков превод';
  if (m === 'card' || m === 'карта') return 'Карта';
  if (!method) return '—';
  return method;
}

export function isBankPaymentMethod(method: string | null | undefined): boolean {
  const m = (method || '').toLowerCase();
  return m === 'bank' || m === 'transfer' || m === 'банков превод';
}

/** Primary (or first) IBAN from the frozen party snapshot. */
export function receiptSnapshotPrimaryIban(
  snapshot: PaymentReceiptRow['party_snapshot'] | null | undefined,
): string {
  const banks = Array.isArray(snapshot?.bank_accounts) ? snapshot!.bank_accounts! : [];
  const rows = banks as Array<Record<string, unknown>>;
  const primary = rows.find((b) => b.is_primary === true) ?? rows[0] ?? null;
  return String(primary?.iban ?? '').trim();
}

/**
 * UK / payment-method gaps that block PDF finalize.
 * Bank transfer requires a primary IBAN from the complex card bank list.
 */
export function receiptBlockingMissingFields(row: Pick<PaymentReceiptRow, 'missing_uk_fields' | 'payment_method' | 'party_snapshot'>): string[] {
  const missing = [...(row.missing_uk_fields ?? [])];
  if (isBankPaymentMethod(row.payment_method) && !receiptSnapshotPrimaryIban(row.party_snapshot)) {
    if (!missing.includes('bank_iban')) missing.push('bank_iban');
  }
  return missing;
}

export function receiptPurposeLines(row: PaymentReceiptRow): PaymentReceiptPurposeLine[] {
  if (Array.isArray(row.purpose_lines) && row.purpose_lines.length > 0) {
    return row.purpose_lines;
  }
  return [
    {
      description_bg: row.is_advance ? 'Авансово плащане' : 'Получено плащане',
      amount_eur: Number(row.amount_eur),
      is_advance: row.is_advance,
    },
  ];
}

export function receiptLineAmount(line: PaymentReceiptPurposeLine): number {
  const n = Number(line.amount_eur);
  return Number.isFinite(n) ? n : 0;
}

export function receiptLineDescription(line: PaymentReceiptPurposeLine): string {
  const base = String(line.description_bg || line.service_label_bg || '—').trim() || '—';
  const parts = [base];
  if (line.is_advance) parts.push('Авансово плащане');
  if (line.period) parts.push(`период ${line.period}`);
  return parts.join(' · ');
}
