'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { useI18n } from '@/i18n/I18nProvider';
import { ownerVisibleError } from '@/lib/ownerError';
import { isMissingRelation } from '@/lib/polls';
import {
  budgetStatusTone,
  moneyEur,
  type OwnerBudgetPayload,
} from '@/lib/budget';
import { StatusBadge } from '@/components/account/ownerUi';

export function OwnerBudget({
  supabase,
}: {
  supabase: SupabaseClient<Database>;
}) {
  const { t, locale } = useI18n();
  const [yearPick, setYearPick] = useState(new Date().getFullYear());
  const [payload, setPayload] = useState<OwnerBudgetPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const statusLabel = useCallback(
    (s: string) => {
      const key = `account.budgetStatus_${s}` as const;
      const v = t(key);
      return v === key ? s : v;
    },
    [t],
  );

  const catName = useCallback(
    (row: {
      category_name_ru: string;
      category_name_en?: string;
      category_name_bg?: string;
    }) => {
      if (locale.startsWith('en')) return row.category_name_en || row.category_name_ru;
      if (locale.startsWith('bg')) return row.category_name_bg || row.category_name_ru;
      return row.category_name_ru;
    },
    [locale],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcErr } = await supabase.rpc('owner_get_budget_year', {
        p_calendar_year: yearPick,
      });
      if (rpcErr) {
        if (isMissingRelation(rpcErr, 'owner_get_budget_year')) {
          setPayload(null);
          setError(t('account.budgetUnavailable'));
          return;
        }
        throw rpcErr;
      }
      setPayload((data as OwnerBudgetPayload | null) ?? null);
    } catch (e: unknown) {
      setError(ownerVisibleError(e, t('err.loadApt')));
    } finally {
      setLoading(false);
    }
  }, [supabase, t, yearPick]);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = useMemo(() => {
    const rows = payload?.execution ?? [];
    const planned = rows.reduce((s, r) => s + Number(r.planned_amount_eur), 0);
    const actual = rows.reduce((s, r) => s + Number(r.actual_amount_eur), 0);
    return { planned, actual, remaining: planned - actual };
  }, [payload]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">{t('account.budget')}</h2>
          <p className="mt-1 text-sm text-secondary">{t('account.budgetLead')}</p>
        </div>
        <label className="grid gap-1 text-xs text-secondary">
          {t('account.budgetYear')}
          <input
            type="number"
            className="min-h-10 rounded-lg border border-border bg-surface px-3 py-2 text-sm"
            value={yearPick}
            onChange={(e) => setYearPick(Number(e.target.value) || new Date().getFullYear())}
          />
        </label>
      </div>

      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {loading ? (
        <p className="text-sm text-muted">{t('common.loading')}</p>
      ) : !payload?.year ? (
        <p className="text-sm text-muted">{t('account.budgetEmpty')}</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge
              label={statusLabel(payload.year.status)}
              tone={budgetStatusTone(payload.year.status)}
            />
            {payload.year.decision_note ? (
              <span className="text-xs text-secondary">
                {t('account.budgetDecision')}: {payload.year.decision_note}
              </span>
            ) : null}
          </div>

          <p className="text-sm text-secondary">
            {t('account.budgetTotals', {
              p: moneyEur(totals.planned),
              a: moneyEur(totals.actual),
              r: moneyEur(totals.remaining),
            })}
          </p>

          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[32rem] text-sm">
              <thead>
                <tr className="border-b border-border bg-background text-left text-xs text-muted">
                  <th className="px-3 py-2">{t('account.budgetCategory')}</th>
                  <th className="px-3 py-2">{t('account.budgetPlanned')}</th>
                  <th className="px-3 py-2">{t('account.budgetActual')}</th>
                  <th className="px-3 py-2">{t('account.budgetRemaining')}</th>
                </tr>
              </thead>
              <tbody>
                {(payload.execution ?? []).map((row) => (
                  <tr key={row.category_id} className="border-b border-border last:border-0">
                    <td className="px-3 py-2 text-foreground">{catName(row)}</td>
                    <td className="px-3 py-2">{moneyEur(row.planned_amount_eur)}</td>
                    <td className="px-3 py-2">{moneyEur(row.actual_amount_eur)}</td>
                    <td className="px-3 py-2">{moneyEur(row.remaining_amount_eur)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
