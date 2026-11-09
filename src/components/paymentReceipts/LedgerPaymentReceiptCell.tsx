'use client';

import { useCallback, useEffect, useState } from 'react';
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
}: {
  supabase: SupabaseClient;
  module: PaymentReceiptModule;
  ledgerId: string;
  kind: string;
  onFillUk?: () => void;
}) {
  const { t } = useI18n();
  const [receipt, setReceipt] = useState<PaymentReceiptRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (kind !== 'payment') return;
    const res = await getPaymentReceiptForLedger(supabase, module, ledgerId);
    if (!res.error) setReceipt(res.receipt);
  }, [supabase, module, ledgerId, kind]);

  useEffect(() => {
    void load();
  }, [load]);

  if (kind !== 'payment') return <span className="text-muted">—</span>;

  async function issue() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const issued = await issueReceiptForExistingPayment(supabase, module, ledgerId);
      if (issued.error || !issued.receiptId) {
        setError(issued.error ?? t('receipt.pdfFailed'));
        return;
      }
      const pdf = await ensurePaymentReceiptPdf(supabase, issued.receiptId);
      if (pdf.receipt) setReceipt(pdf.receipt);
      if (pdf.error && pdf.error !== 'uk_details_incomplete') {
        setError(t('receipt.pdfFailed'));
      }
    } finally {
      setBusy(false);
    }
  }

  if (!receipt) {
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
      onReceiptChange={setReceipt}
      onFillUk={onFillUk}
      compact
    />
  );
}
