import type { SupabaseClient } from '@supabase/supabase-js';
import {
  completeReceiptAfterPayment,
  preparePaymentReceiptIntent,
} from '@/lib/paymentReceipts/client';
import type { PaymentReceiptModule, PaymentReceiptRow } from '@/lib/paymentReceipts/types';
import type { PaymentReceiptPayFieldValues } from '@/components/paymentReceipts/PaymentReceiptPayFields';

export function ledgerIdFromPaymentRpc(data: unknown): string | null {
  if (Array.isArray(data) && data[0] && typeof data[0] === 'object') {
    const row = data[0] as Record<string, unknown>;
    if (row.ledger_id != null) return String(row.ledger_id);
    if (row.id != null) return String(row.id);
  }
  if (data && typeof data === 'object') {
    const row = data as Record<string, unknown>;
    if (row.ledger_id != null) return String(row.ledger_id);
    if (row.id != null) return String(row.id);
  }
  return null;
}

export async function prepareReceiptIntentFromFields(
  supabase: SupabaseClient,
  idempotencyKey: string,
  fields: PaymentReceiptPayFieldValues,
): Promise<string | null> {
  const { error } = await preparePaymentReceiptIntent(supabase, {
    idempotencyKey,
    payerName: fields.payerName,
    paymentMethod: fields.paymentMethod || null,
    isAdvance: fields.isAdvance,
    externalRefs: fields.externalRef.trim()
      ? { bank_reference: fields.externalRef.trim() }
      : {},
  });
  return error;
}

export async function finishReceiptForPayment(
  supabase: SupabaseClient,
  module: PaymentReceiptModule,
  ledgerId: string | null,
): Promise<{ receipt: PaymentReceiptRow | null; pdfError: string | null; missingUk?: string[] }> {
  if (!ledgerId) return { receipt: null, pdfError: 'ledger_missing' };
  return completeReceiptAfterPayment(supabase, module, ledgerId);
}
