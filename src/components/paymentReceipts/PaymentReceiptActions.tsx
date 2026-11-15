'use client';

import { useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { useI18n } from '@/i18n/I18nProvider';
import {
  ensurePaymentReceiptPdf,
  fetchPaymentReceiptPdfBlob,
} from '@/lib/paymentReceipts/client';
import {
  formatReceiptSeriesNumber,
  receiptBlockingMissingFields,
} from '@/lib/paymentReceipts/receiptFormat';
import type { PaymentReceiptRow } from '@/lib/paymentReceipts/types';

const UK_FIELD_LABEL_KEYS: Record<string, string> = {
  mgmt_legal_name: 'receipt.missingUkLegalName',
  mgmt_registration_number: 'receipt.missingUkEik',
  mgmt_registered_address: 'receipt.missingUkAddress',
  complex_display_name: 'receipt.missingComplexName',
  complex_address: 'receipt.missingComplexAddress',
  bank_iban: 'receipt.missingUkBankIban',
};

function messageForPdfError(
  code: string | null | undefined,
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  switch (code) {
    case 'unauthorized':
    case 'forbidden':
      return t('receipt.pdfForbidden');
    case 'file_missing':
      return t('receipt.pdfMissing');
    case 'storage_unavailable':
    case 'network':
      return t('receipt.pdfStorageUnavailable');
    case 'forming':
    case 'uk_details_incomplete':
      return t('receipt.pdfForming');
    default:
      return t('receipt.pdfFailed');
  }
}

export function PaymentReceiptActions({
  supabase,
  receipt,
  onReceiptChange,
  onFillUk,
  compact,
}: {
  supabase: SupabaseClient;
  receipt: PaymentReceiptRow | null;
  onReceiptChange?: (row: PaymentReceiptRow) => void;
  onFillUk?: () => void;
  compact?: boolean;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  if (!receipt) return null;

  const missing = receiptBlockingMissingFields(receipt);
  const voided = receipt.status === 'voided';
  const needsUk = missing.length > 0 || receipt.status === 'pending_details';
  const failed = receipt.status === 'failed' || Boolean(receipt.pdf_error);
  const canRetryOpen =
    errorCode === 'storage_unavailable' ||
    errorCode === 'network' ||
    errorCode === 'pdf_unavailable';

  async function withBusy(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setErrorCode(null);
    try {
      await fn();
    } catch {
      setErrorCode('network');
      setError(t('receipt.pdfStorageUnavailable'));
    } finally {
      setBusy(false);
    }
  }

  async function retryPdf() {
    await withBusy(async () => {
      const res = await ensurePaymentReceiptPdf(supabase, receipt!.id);
      if (res.receipt) onReceiptChange?.(res.receipt);
      if (res.error === 'uk_details_incomplete') {
        setErrorCode('forming');
        setError(t('receipt.needUkDetails'));
        return;
      }
      if (res.error) {
        setErrorCode(res.error);
        setError(t('receipt.pdfFailed'));
      }
    });
  }

  async function fetchReceiptBlob(): Promise<Blob | null> {
    try {
      const res = await fetchPaymentReceiptPdfBlob(supabase, receipt!);
      if (res.error || !res.blob) {
        setErrorCode(res.error ?? 'pdf_unavailable');
        setError(messageForPdfError(res.error, t));
        return null;
      }
      return res.blob;
    } catch {
      setErrorCode('network');
      setError(t('receipt.pdfStorageUnavailable'));
      return null;
    }
  }

  async function openPdf() {
    // Open placeholder synchronously so the popup is not blocked after await.
    const pending = window.open('about:blank', '_blank');
    await withBusy(async () => {
      const blob = await fetchReceiptBlob();
      if (!blob) {
        pending?.close();
        return;
      }
      const url = URL.createObjectURL(blob);
      if (pending && !pending.closed) {
        pending.location.href = url;
      } else {
        const opened = window.open(url, '_blank', 'noopener,noreferrer');
        if (!opened) {
          setErrorCode('popup_blocked');
          setError(t('receipt.pdfPopupBlocked'));
        }
      }
      setTimeout(() => URL.revokeObjectURL(url), 120_000);
    });
  }

  async function downloadPdf() {
    await withBusy(async () => {
      const blob = await fetchReceiptBlob();
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${receipt!.series}-${String(receipt!.number).padStart(6, '0')}.pdf`;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    });
  }

  async function printPdf() {
    await withBusy(async () => {
      const blob = await fetchReceiptBlob();
      if (!blob) return;
      // Print the stored PDF bytes only — not the app chrome / HTML preview.
      const url = URL.createObjectURL(blob);
      const frame = document.createElement('iframe');
      frame.setAttribute('aria-hidden', 'true');
      frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
      frame.src = url;
      document.body.appendChild(frame);
      const cleanup = () => {
        frame.remove();
        URL.revokeObjectURL(url);
      };
      frame.onload = () => {
        try {
          frame.contentWindow?.focus();
          frame.contentWindow?.print();
        } catch {
          window.open(url, '_blank', 'noopener,noreferrer');
        }
        setTimeout(cleanup, 60_000);
      };
    });
  }

  const statusLabel =
    voided
      ? t('receipt.statusVoided')
      : needsUk
        ? t('receipt.statusNeedUk')
        : receipt.status === 'ready'
          ? t('receipt.statusReady')
          : failed
            ? t('receipt.statusFailed')
            : busy
              ? t('receipt.forming')
              : t('receipt.statusPending');

  return (
    <div className={compact ? 'space-y-2' : 'mt-3 space-y-2 rounded-xl border border-border bg-background px-3 py-3'}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium text-foreground">
          {t('receipt.docLabel', { label: formatReceiptSeriesNumber(receipt) })}
        </span>
        <span className="text-xs text-muted">{statusLabel}</span>
      </div>

      {needsUk ? (
        <div className="space-y-1 text-sm text-secondary">
          <p>{t('receipt.needUkDetails')}</p>
          <ul className="list-disc pl-5 text-xs">
            {missing.map((key) => (
              <li key={key}>{t(UK_FIELD_LABEL_KEYS[key] ?? 'receipt.missingUkGeneric')}</li>
            ))}
          </ul>
          {onFillUk ? (
            <button type="button" className="text-sm text-accent hover:underline" onClick={onFillUk}>
              {t('receipt.fillUk')}
            </button>
          ) : null}
        </div>
      ) : null}

      {failed && !needsUk ? (
        <p className="text-sm text-danger">{t('receipt.paySavedPdfFailed')}</p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {!needsUk ? (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => void openPdf()}
              className="rounded-lg border border-border px-3 py-1.5 text-sm text-foreground hover:bg-hover disabled:opacity-50"
            >
              {busy ? t('receipt.forming') : t('receipt.open')}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void downloadPdf()}
              className="rounded-lg border border-border px-3 py-1.5 text-sm text-foreground hover:bg-hover disabled:opacity-50"
            >
              {t('receipt.download')}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void printPdf()}
              className="rounded-lg border border-border px-3 py-1.5 text-sm text-foreground hover:bg-hover disabled:opacity-50"
            >
              {t('receipt.print')}
            </button>
          </>
        ) : null}
        {canRetryOpen && !voided ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void openPdf()}
            className="rounded-lg border border-border px-3 py-1.5 text-sm text-foreground hover:bg-hover disabled:opacity-50"
          >
            {t('receipt.retryOpen')}
          </button>
        ) : null}
        {(failed || needsUk || receipt.status === 'pending_pdf') && !voided ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void retryPdf()}
            className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
          >
            {t('receipt.retry')}
          </button>
        ) : null}
      </div>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
    </div>
  );
}

export function PaymentSuccessBanner({
  amountLabel,
  receipt,
  supabase,
  onFillUk,
  onReceiptChange,
}: {
  amountLabel: string;
  receipt: PaymentReceiptRow | null;
  supabase: SupabaseClient;
  onFillUk?: () => void;
  onReceiptChange?: (row: PaymentReceiptRow) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="rounded-xl border border-success/30 bg-success-bg px-3 py-3 text-sm text-foreground">
      <p className="font-semibold">{t('receipt.payRegistered', { amount: amountLabel })}</p>
      {receipt ? (
        <PaymentReceiptActions
          supabase={supabase}
          receipt={receipt}
          onFillUk={onFillUk}
          onReceiptChange={onReceiptChange}
          compact
        />
      ) : (
        <p className="mt-1 text-secondary">{t('receipt.forming')}</p>
      )}
    </div>
  );
}
