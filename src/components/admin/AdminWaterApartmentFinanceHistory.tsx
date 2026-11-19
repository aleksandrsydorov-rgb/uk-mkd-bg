'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { useI18n } from '@/i18n/I18nProvider';
import { formatOwnerDate } from '@/lib/ownerFormat';
import { isMissingRelation } from '@/lib/polls';
import { formatEur } from '@/lib/utilities';
import { toUserFacingMessage } from '@/lib/userFacingError';
import {
  presentLedgerOperationKind,
  presentLedgerOperationNote,
  presentLedgerOperationStatus,
} from '@/lib/financeLedgerPresent';
import {
  AdminEmptyState,
  AdminInlineAlert,
  AdminTableShell,
  adminFieldClass,
  adminTableCellClass,
  adminTableHeadRowClass,
  adminTableRowClass,
} from '@/components/admin/AdminUi';
import { LedgerPaymentReceiptCell } from '@/components/paymentReceipts/LedgerPaymentReceiptCell';
import type { PaymentReceiptRow } from '@/lib/paymentReceipts/types';

type LedgerRow = {
  id: string;
  kind: string;
  amount_eur: number;
  note: string | null;
  created_at: string;
  reading_id: string | null;
};

export type WaterFinanceKindFilter = 'all' | 'charges' | 'payments';

function isChargeKind(kind: string) {
  return kind === 'charge' || kind === 'adjustment_debit' || kind === 'adjustment_credit';
}

function isPaymentKind(kind: string) {
  return kind === 'payment' || kind === 'payment_reversal';
}

function inDateRange(iso: string, from: string, to: string) {
  const day = iso.slice(0, 10);
  if (from && day < from) return false;
  if (to && day > to) return false;
  return true;
}

function receiptLooksMultiService(receipt: PaymentReceiptRow | null): boolean {
  const lines = receipt?.purpose_lines;
  if (!Array.isArray(lines) || lines.length <= 1) return false;
  return true;
}

/**
 * Water ledger journal for one apartment — used inside History popup finance tab.
 * Amounts come from water_ledger (already the water share of any multi-service cash).
 */
export function AdminWaterApartmentFinanceHistory({
  supabase,
  propertyId,
  onFillUk,
}: {
  supabase: SupabaseClient<Database>;
  propertyId: number;
  onFillUk?: () => void;
}) {
  const { t, locale } = useI18n();
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [periodFrom, setPeriodFrom] = useState('');
  const [periodTo, setPeriodTo] = useState('');
  const [kindFilter, setKindFilter] = useState<WaterFinanceKindFilter>('all');
  const [receiptByLedger, setReceiptByLedger] = useState<Record<string, PaymentReceiptRow | null>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setReceiptByLedger({});
    const { data, error: qErr } = await supabase
      .from('water_ledger')
      .select('id, kind, amount_eur, note, created_at, reading_id')
      .eq('property_id', propertyId)
      .order('created_at', { ascending: false })
      .limit(200);
    setLoading(false);
    if (qErr && !isMissingRelation(qErr, 'water_ledger')) {
      setError(toUserFacingMessage(qErr, t, { context: 'load', fallback: t('common.errLoad') }));
      setRows([]);
      return;
    }
    setRows((data ?? []) as LedgerRow[]);
  }, [propertyId, supabase, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    return rows.filter((row) => {
      if (!inDateRange(row.created_at, periodFrom, periodTo)) return false;
      if (kindFilter === 'charges') return isChargeKind(row.kind);
      if (kindFilter === 'payments') return isPaymentKind(row.kind);
      return true;
    });
  }, [rows, periodFrom, periodTo, kindFilter]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="block text-xs text-muted">
          {t('admin.meterHistPeriodFrom')}
          <input
            type="date"
            className={`mt-1 block ${adminFieldClass}`}
            value={periodFrom}
            max={periodTo || undefined}
            onChange={(e) => setPeriodFrom(e.target.value)}
          />
        </label>
        <label className="block text-xs text-muted">
          {t('admin.meterHistPeriodTo')}
          <input
            type="date"
            className={`mt-1 block ${adminFieldClass}`}
            value={periodTo}
            min={periodFrom || undefined}
            onChange={(e) => setPeriodTo(e.target.value)}
          />
        </label>
        <label className="block text-xs text-muted">
          {t('admin.waterHistoryFinanceKindFilter')}
          <select
            className={`mt-1 block ${adminFieldClass}`}
            value={kindFilter}
            onChange={(e) => setKindFilter(e.target.value as WaterFinanceKindFilter)}
          >
            <option value="all">{t('admin.sfFilterAll')}</option>
            <option value="charges">{t('admin.waterHistoryFinanceCharges')}</option>
            <option value="payments">{t('admin.waterHistoryFinancePayments')}</option>
          </select>
        </label>
        {(periodFrom || periodTo || kindFilter !== 'all') && (
          <button
            type="button"
            className="text-sm text-accent hover:underline"
            onClick={() => {
              setPeriodFrom('');
              setPeriodTo('');
              setKindFilter('all');
            }}
          >
            {t('admin.meterHistPeriodClear')}
          </button>
        )}
      </div>

      <p className="text-xs text-muted">{t('admin.waterHistoryFinanceLead')}</p>

      {error ? <AdminInlineAlert tone="danger">{error}</AdminInlineAlert> : null}

      {loading ? (
        <p className="text-sm text-muted">{t('common.loading')}</p>
      ) : visible.length === 0 ? (
        <AdminEmptyState title={t('admin.utilFinNoLedger')} />
      ) : (
        <AdminTableShell>
          <table className="w-full min-w-[36rem] text-sm">
            <thead>
              <tr className={adminTableHeadRowClass}>
                <th className={adminTableCellClass}>{t('admin.date')}</th>
                <th className={adminTableCellClass}>{t('admin.kind')}</th>
                <th className={`${adminTableCellClass} text-right`}>{t('admin.amount')}</th>
                <th className={adminTableCellClass}>{t('admin.status')}</th>
                <th className={adminTableCellClass}>{t('admin.waterHistoryFinanceDocument')}</th>
                <th className={adminTableCellClass}>{t('admin.note')}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const present = { kind: row.kind, note: row.note, amountEur: row.amount_eur };
                const receipt = receiptByLedger[row.id] ?? null;
                const multi = receiptLooksMultiService(receipt);
                return (
                  <tr key={row.id} className={adminTableRowClass}>
                    <td className={`${adminTableCellClass} tabular-nums whitespace-nowrap`}>
                      {formatOwnerDate(row.created_at)}
                    </td>
                    <td className={adminTableCellClass}>
                      {presentLedgerOperationKind(present, t)}
                    </td>
                    <td
                      className={`${adminTableCellClass} text-right tabular-nums whitespace-nowrap`}
                    >
                      {formatEur(Number(row.amount_eur), locale)}
                    </td>
                    <td className={adminTableCellClass}>
                      {presentLedgerOperationStatus(present, t)}
                    </td>
                    <td className={`${adminTableCellClass} align-top`}>
                      <div className="space-y-1">
                        <LedgerPaymentReceiptCell
                          supabase={supabase}
                          module="water"
                          ledgerId={row.id}
                          kind={row.kind}
                          onFillUk={onFillUk}
                          downloadOnly
                          hideStatus
                          onReceiptLoaded={(r) => {
                            setReceiptByLedger((prev) =>
                              prev[row.id] === r ? prev : { ...prev, [row.id]: r },
                            );
                          }}
                        />
                        {multi ? (
                          <p className="text-xs text-muted">
                            {t('admin.waterHistoryFinanceMultiService')}
                          </p>
                        ) : null}
                      </div>
                    </td>
                    <td className={`${adminTableCellClass} text-secondary`}>
                      {presentLedgerOperationNote(present, t)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </AdminTableShell>
      )}
    </div>
  );
}
