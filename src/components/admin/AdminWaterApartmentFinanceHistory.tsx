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
  adminTableHeadRowClass,
  adminTableRowClass,
} from '@/components/admin/AdminUi';
import { LedgerPaymentReceiptCell } from '@/components/paymentReceipts/LedgerPaymentReceiptCell';
import type { PaymentReceiptRow } from '@/lib/paymentReceipts/types';
import type { WaterFinanceKindFilter } from '@/components/admin/HistoryJournalFilterBar';

type LedgerRow = {
  id: string;
  kind: string;
  amount_eur: number;
  note: string | null;
  created_at: string;
  reading_id: string | null;
};

export type { WaterFinanceKindFilter };

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
 * Water ledger journal for one apartment — table only when embedded in history shell
 * (filters live in shared HistoryJournalFilterBar).
 */
export function AdminWaterApartmentFinanceHistory({
  supabase,
  propertyId,
  onFillUk,
  periodFrom = '',
  periodTo = '',
  kindFilter = 'all',
}: {
  supabase: SupabaseClient<Database>;
  propertyId: number;
  onFillUk?: () => void;
  periodFrom?: string;
  periodTo?: string;
  kindFilter?: WaterFinanceKindFilter;
}) {
  const { t, locale } = useI18n();
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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

  // Dense cells for this journal only — keep global adminTableCellClass elsewhere.
  const cell = 'py-1.5 px-2 align-middle';
  // Compact cols: w-[1%] + nowrap → size to content. Type/Note share the rest.
  const colCompact = `${cell} w-[1%] whitespace-nowrap`;
  const colFlex = `${cell} min-w-[7rem]`;

  return (
    <div className="space-y-3">
      {error ? <AdminInlineAlert tone="danger">{error}</AdminInlineAlert> : null}

      {loading ? (
        <p className="text-sm text-muted">{t('common.loading')}</p>
      ) : visible.length === 0 ? (
        <AdminEmptyState title={t('admin.utilFinNoLedger')} />
      ) : (
        <AdminTableShell>
          {/* min-width ≈ 3×44px icons + compact cols; shell already overflow-x-auto */}
          <table className="w-full min-w-[46rem] table-auto text-sm">
            <thead>
              <tr className={adminTableHeadRowClass}>
                <th className={colCompact}>{t('admin.date')}</th>
                <th className={colFlex}>{t('admin.kind')}</th>
                <th className={`${colCompact} text-right`}>{t('admin.amount')}</th>
                <th className={colCompact}>{t('admin.status')}</th>
                <th className={colCompact}>{t('admin.waterHistoryFinanceDocument')}</th>
                <th className={`${colFlex} w-[40%]`}>{t('admin.note')}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const present = { kind: row.kind, note: row.note, amountEur: row.amount_eur };
                const receipt = receiptByLedger[row.id] ?? null;
                const multi = receiptLooksMultiService(receipt);
                return (
                  <tr key={row.id} className={adminTableRowClass}>
                    <td className={`${colCompact} tabular-nums`}>
                      {formatOwnerDate(row.created_at)}
                    </td>
                    <td className={colFlex}>{presentLedgerOperationKind(present, t)}</td>
                    <td className={`${colCompact} text-right tabular-nums`}>
                      {formatEur(Number(row.amount_eur), locale)}
                    </td>
                    <td className={colCompact}>{presentLedgerOperationStatus(present, t)}</td>
                    <td className={colCompact}>
                      <div className="inline-flex max-w-none flex-col items-start gap-0.5">
                        <div className="inline-flex flex-nowrap items-center">
                          <LedgerPaymentReceiptCell
                            supabase={supabase}
                            module="water"
                            ledgerId={row.id}
                            kind={row.kind}
                            onFillUk={onFillUk}
                            downloadOnly
                            hideStatus
                            hideDocLabel
                            onReceiptLoaded={(r) => {
                              setReceiptByLedger((prev) =>
                                prev[row.id] === r ? prev : { ...prev, [row.id]: r },
                              );
                            }}
                          />
                        </div>
                        {multi ? (
                          <p className="max-w-[12rem] whitespace-normal text-xs leading-snug text-muted">
                            {t('admin.waterHistoryFinanceMultiService')}
                          </p>
                        ) : null}
                      </div>
                    </td>
                    <td className={`${colFlex} break-words text-secondary`}>
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
