import type { SupabaseClient } from '@supabase/supabase-js';
import { buildPaymentReceiptPdfBlob } from '@/lib/paymentReceipts/buildReceiptPdf';
import {
  PAYMENT_RECEIPTS_BUCKET,
  type PaymentReceiptModule,
  type PaymentReceiptRow,
} from '@/lib/paymentReceipts/types';
import { sha256HexOfBlob } from '@/lib/pdfDownload';

export type ReceiptIntentInput = {
  idempotencyKey: string;
  payerName?: string | null;
  paymentMethod?: string | null;
  externalRefs?: Record<string, string> | null;
  isAdvance?: boolean;
  purposeOverride?: string | null;
};

function asReceipt(data: unknown): PaymentReceiptRow | null {
  if (!data || typeof data !== 'object') return null;
  return data as PaymentReceiptRow;
}

export async function preparePaymentReceiptIntent(
  supabase: SupabaseClient,
  input: ReceiptIntentInput,
): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc('prepare_payment_receipt_intent', {
    p_idempotency_key: input.idempotencyKey,
    p_payer_name: input.payerName?.trim() || null,
    p_payment_method: input.paymentMethod?.trim() || null,
    p_external_refs: input.externalRefs ?? {},
    p_is_advance: Boolean(input.isAdvance),
    p_purpose_override: input.purposeOverride?.trim() || null,
  });
  return { error: error?.message ?? null };
}

export async function getPaymentReceiptForLedger(
  supabase: SupabaseClient,
  module: PaymentReceiptModule,
  ledgerId: string,
): Promise<{ receipt: PaymentReceiptRow | null; error: string | null }> {
  const { data, error } = await supabase.rpc('get_payment_receipt_for_ledger', {
    p_source_module: module,
    p_ledger_id: String(ledgerId),
  });
  if (error) return { receipt: null, error: error.message };
  return { receipt: asReceipt(data), error: null };
}

export async function getPaymentReceipt(
  supabase: SupabaseClient,
  receiptId: string,
): Promise<{ receipt: PaymentReceiptRow | null; error: string | null }> {
  const { data, error } = await supabase.rpc('get_payment_receipt', {
    p_receipt_id: receiptId,
  });
  if (error) return { receipt: null, error: error.message };
  return { receipt: asReceipt(data), error: null };
}

export async function issueReceiptForExistingPayment(
  supabase: SupabaseClient,
  module: PaymentReceiptModule,
  ledgerId: string,
  intent?: Omit<ReceiptIntentInput, 'idempotencyKey'>,
): Promise<{ receiptId: string | null; error: string | null }> {
  const { data, error } = await supabase.rpc('issue_payment_receipt_for_existing_payment', {
    p_source_module: module,
    p_ledger_id: String(ledgerId),
    p_payer_name: intent?.payerName?.trim() || null,
    p_payment_method: intent?.paymentMethod?.trim() || null,
    p_external_refs: intent?.externalRefs ?? {},
    p_is_advance: Boolean(intent?.isAdvance),
    p_purpose_override: intent?.purposeOverride?.trim() || null,
  });
  if (error) return { receiptId: null, error: error.message };
  return { receiptId: data ? String(data) : null, error: null };
}

export async function refreshReceiptPartySnapshot(
  supabase: SupabaseClient,
  receiptId: string,
): Promise<{ receipt: PaymentReceiptRow | null; error: string | null }> {
  const { data, error } = await supabase.rpc('refresh_payment_receipt_party_snapshot', {
    p_receipt_id: receiptId,
  });
  if (error) return { receipt: null, error: error.message };
  return { receipt: asReceipt(data), error: null };
}

async function storagePathFor(
  supabase: SupabaseClient,
  receiptId: string,
): Promise<string | null> {
  const { data, error } = await supabase.rpc('payment_receipt_storage_path', {
    p_receipt_id: receiptId,
  });
  if (error || !data) return null;
  return String(data);
}

/** Render Bulgarian PDF, upload privately, finalize. Idempotent when already ready. */
export async function ensurePaymentReceiptPdf(
  supabase: SupabaseClient,
  receiptId: string,
): Promise<{ receipt: PaymentReceiptRow | null; error: string | null; missingUk?: string[] }> {
  const loaded = await getPaymentReceipt(supabase, receiptId);
  if (loaded.error || !loaded.receipt) {
    return { receipt: null, error: loaded.error ?? 'receipt_not_found' };
  }
  let receipt = loaded.receipt;

  if (receipt.status === 'voided' && receipt.storage_path) {
    return { receipt, error: null };
  }

  if ((receipt.missing_uk_fields?.length ?? 0) > 0 || receipt.status === 'pending_details') {
    const refreshed = await refreshReceiptPartySnapshot(supabase, receiptId);
    if (refreshed.error || !refreshed.receipt) {
      return {
        receipt: receipt,
        error: refreshed.error ?? 'uk_refresh_failed',
        missingUk: receipt.missing_uk_fields ?? [],
      };
    }
    receipt = refreshed.receipt;
    if ((receipt.missing_uk_fields?.length ?? 0) > 0) {
      return {
        receipt,
        error: 'uk_details_incomplete',
        missingUk: receipt.missing_uk_fields ?? [],
      };
    }
  }

  if (receipt.status === 'ready' && receipt.storage_path) {
    return { receipt, error: null };
  }

  try {
    const path =
      (await storagePathFor(supabase, receiptId)) ||
      `payment-receipts/${receipt.property_id}/${receipt.id}.pdf`;
    const blob = await buildPaymentReceiptPdfBlob(receipt);
    const sha = await sha256HexOfBlob(blob);

    const { error: upErr } = await supabase.storage
      .from(PAYMENT_RECEIPTS_BUCKET)
      .upload(path, blob, { contentType: 'application/pdf', upsert: true });
    if (upErr) {
      await supabase.rpc('mark_payment_receipt_pdf_failed', {
        p_receipt_id: receiptId,
        p_error: upErr.message,
      });
      return { receipt, error: upErr.message };
    }

    const { data, error } = await supabase.rpc('finalize_payment_receipt_pdf', {
      p_receipt_id: receiptId,
      p_storage_path: path,
      p_pdf_sha256: sha,
    });
    if (error) {
      await supabase.rpc('mark_payment_receipt_pdf_failed', {
        p_receipt_id: receiptId,
        p_error: error.message,
      });
      return { receipt, error: error.message };
    }
    return { receipt: asReceipt(data) ?? receipt, error: null };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'pdf_failed';
    await supabase.rpc('mark_payment_receipt_pdf_failed', {
      p_receipt_id: receiptId,
      p_error: message,
    });
    return { receipt, error: message };
  }
}

export type PaymentReceiptPdfFetchError =
  | 'unauthorized'
  | 'forbidden'
  | 'file_missing'
  | 'storage_unavailable'
  | 'forming'
  | 'network'
  | 'pdf_unavailable'
  | string;

/**
 * Load the saved PDF bytes for open / download / print.
 * Prefers same-origin authenticated API (avoids browser fetch of cross-origin signed URLs).
 * Falls back to Storage download via the user session — never recreates the document
 * when status is already ready with a storage_path.
 */
export async function fetchPaymentReceiptPdfBlob(
  supabase: SupabaseClient,
  receipt: PaymentReceiptRow,
): Promise<{ blob: Blob | null; error: PaymentReceiptPdfFetchError | null }> {
  if (receipt.status === 'pending_details' || receipt.status === 'pending_pdf') {
    return { blob: null, error: 'forming' };
  }

  // Same-origin proxy — session cookie, no signed URL exposed to fetch().
  try {
    const res = await fetch(`/api/payment-receipts/${encodeURIComponent(receipt.id)}/pdf`, {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
    });
    if (res.ok) {
      const blob = await res.blob();
      if (blob.size > 0) return { blob, error: null };
      return { blob: null, error: 'file_missing' };
    }
    let code = 'pdf_unavailable';
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) code = body.error;
    } catch {
      /* non-JSON */
    }
    if (res.status === 401) return { blob: null, error: 'unauthorized' };
    if (res.status === 403) return { blob: null, error: 'forbidden' };
    if (res.status === 404) return { blob: null, error: code === 'file_missing' ? 'file_missing' : 'file_missing' };
    if (res.status === 409) return { blob: null, error: 'forming' };
    if (res.status === 503) return { blob: null, error: 'storage_unavailable' };
    // Fall through to direct storage download for transient API issues.
  } catch {
    // Network / API unavailable — try Storage API below.
  }

  let row = receipt;
  if (!(row.status === 'ready' || row.status === 'voided') || !row.storage_path) {
    const ensured = await ensurePaymentReceiptPdf(supabase, receipt.id);
    if (ensured.error === 'uk_details_incomplete') {
      return { blob: null, error: 'forming' };
    }
    if (ensured.error || !ensured.receipt?.storage_path) {
      return { blob: null, error: ensured.error ?? 'pdf_unavailable' };
    }
    row = ensured.receipt;
  }

  const { data, error } = await supabase.storage
    .from(PAYMENT_RECEIPTS_BUCKET)
    .download(row.storage_path!);
  if (error || !data) {
    const msg = error?.message ?? 'pdf_unavailable';
    if (/not found|404|object.*exist/i.test(msg)) {
      return { blob: null, error: 'file_missing' };
    }
    return { blob: null, error: 'storage_unavailable' };
  }
  return { blob: data, error: null };
}

/** @deprecated Prefer fetchPaymentReceiptPdfBlob — signed URL + browser fetch is CORS-fragile. */
export async function openPaymentReceiptPdf(
  supabase: SupabaseClient,
  receipt: PaymentReceiptRow,
): Promise<{ url: string | null; error: string | null }> {
  const res = await fetchPaymentReceiptPdfBlob(supabase, receipt);
  if (res.error || !res.blob) {
    return { url: null, error: res.error ?? 'pdf_unavailable' };
  }
  return { url: URL.createObjectURL(res.blob), error: null };
}

/** After a successful payment RPC: find receipt by ledger and try PDF. */
export async function completeReceiptAfterPayment(
  supabase: SupabaseClient,
  module: PaymentReceiptModule,
  ledgerId: string,
): Promise<{
  receipt: PaymentReceiptRow | null;
  pdfError: string | null;
  missingUk?: string[];
}> {
  // Brief retry — trigger runs in same TX, but PostgREST may return before commit visibility.
  let receipt: PaymentReceiptRow | null = null;
  let lastErr: string | null = null;
  for (let i = 0; i < 5; i += 1) {
    const res = await getPaymentReceiptForLedger(supabase, module, ledgerId);
    if (res.receipt) {
      receipt = res.receipt;
      break;
    }
    lastErr = res.error;
    await new Promise((r) => setTimeout(r, 120 * (i + 1)));
  }
  if (!receipt) {
    return { receipt: null, pdfError: lastErr ?? 'receipt_missing' };
  }
  const pdf = await ensurePaymentReceiptPdf(supabase, receipt.id);
  return {
    receipt: pdf.receipt ?? receipt,
    pdfError: pdf.error,
    missingUk: pdf.missingUk,
  };
}
