'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { useI18n } from '@/i18n/I18nProvider';
import { PaymentReceiptActions } from '@/components/paymentReceipts/PaymentReceiptActions';
import {
  getPaymentReceiptForLedger,
  issueReceiptForExistingPayment,
  ensurePaymentReceiptPdf,
} from '@/lib/paymentReceipts/client';
import type { PaymentReceiptModule, PaymentReceiptRow } from '@/lib/paymentReceipts/types';

export function LedgerPaymentReceiptCell({
  supabase,
  module,
  ledgerId,
  kind,
  onFillUk,
  /** History surfaces: only download when a receipt already exists — no «issue» stub. */
  downloadOnly = false,
  onReceiptLoaded,
}: {
  supabase: SupabaseClient;
  module: PaymentReceiptModule;
  ledgerId: string;
  kind: string;
  onFillUk?: () => void;
  downloadOnly?: boolean;
  onReceiptLoaded?: (receipt: PaymentReceiptRow | null) => void;
}) {
  const { t } = useI18n();
  const [receipt, setReceipt] = useState<PaymentReceiptRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const onReceiptLoadedRef = useRef(onReceiptLoaded);
  onReceiptLoadedRef.current = onReceiptLoaded;

  const load = useCallback(async () => {
    if (kind !== 'payment') {
      setLoaded(true);
      onReceiptLoadedRef.current?.(null);
      return;
    }
    const res = await getPaymentReceiptForLedger(supabase, module, ledgerId);
    if (!res.error) {
      setReceipt(res.receipt);
      onReceiptLoadedRef.current?.(res.receipt);
    } else {
      onReceiptLoadedRef.current?.(null);
    }
    setLoaded(true);
  }, [supabase, module, ledgerId, kind]);

  useEffect(() => {
    void load();
  }, [load]);

  if (kind !== 'payment') return <span className="text-muted">—</span>;

  async function issue() {
    if (busy || downloadOnly) return;
    setBusy(true);
    setError(null);
    try {
      const issued = await issueReceiptForExistingPayment(supabase, module, ledgerId);
      if (issued.error || !issued.receiptId) {
        setError(issued.error ?? t('receipt.pdfFailed'));
        return;
      }
      const pdf = await ensurePaymentReceiptPdf(supabase, issued.receiptId);
      if (pdf.receipt) {
        setReceipt(pdf.receipt);
        onReceiptLoaded?.(pdf.receipt);
      }
      if (pdf.error && pdf.error !== 'uk_details_incomplete') {
        setError(t('receipt.pdfFailed'));
      }
    } finally {
      setBusy(false);
    }
  }

  if (!receipt) {
    if (downloadOnly) {
      return <span className="text-muted">{loaded ? '—' : '…'}</span>;
    }
    return (
      <div className="space-y-1">
        <button
          type="button"
          disabled={busy}
          onClick={() => void issue()}
          className="text-sm text-accent hover:underline disabled:opacity-50"
        >
          {busy ? t('receipt.forming') : t('receipt.issue')}
        </button>
        {error ? <p className="text-xs text-danger">{error}</p> : null}
      </div>
    );
  }

  return (
    <PaymentReceiptActions
      supabase={supabase}
      receipt={receipt}
      onReceiptChange={(row) => {
        setReceipt(row);
        onReceiptLoaded?.(row);
      }}
      onFillUk={onFillUk}
      compact
    />
  );
}
