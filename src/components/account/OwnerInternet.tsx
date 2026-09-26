'use client';

import { useCallback, useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { useI18n } from '@/i18n/I18nProvider';
import { formatOwnerDate } from '@/lib/ownerFormat';
import { ownerVisibleError } from '@/lib/ownerError';
import { isMissingRelation } from '@/lib/polls';
import {
  internetStatusMessageKey,
  type InternetLedger,
  type InternetSubscription,
} from '@/lib/internet';
import { formatEur, mapAdminRpcError } from '@/lib/utilities';
import { StatusBadge } from '@/components/account/ownerUi';

function statusTone(status: string): 'warning' | 'info' | 'success' | 'danger' | 'neutral' {
  if (status === 'pending_enable' || status === 'pending_disable') return 'warning';
  if (status === 'active') return 'success';
  if (status === 'inactive') return 'neutral';
  return 'info';
}

function eventLabel(row: InternetLedger, t: (key: string) => string) {
  const note = (row.note ?? '').toLowerCase();
  if (note.includes('отмена')) return t('account.internetEventCancel');
  if (note.includes('подключ') || note.includes('connect') || note.includes('подписк')) {
    return t('account.internetEventConnect');
  }
  if (row.kind === 'payment') return t('account.internetEventPayment');
  if (row.kind === 'charge') return t('account.internetEventCharge');
  if (row.kind === 'adjustment_credit') return t('account.internetEventCredit');
  if (row.kind === 'adjustment_debit') return t('account.internetEventDebit');
  return row.kind;
}

/** Owner technical surface — status, connect/disconnect, history. Money → Финансы. */
export function OwnerInternet({
  supabase,
  propertyId,
}: {
  supabase: SupabaseClient<Database>;
  propertyId: number;
}) {
  const { t, locale } = useI18n();
  const [subscription, setSubscription] = useState<InternetSubscription | null>(null);
  const [history, setHistory] = useState<InternetLedger[]>([]);
  const [monthRate, setMonthRate] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [subRes, histRes, tariffRes] = await Promise.all([
        supabase.from('internet_subscriptions').select('*').eq('property_id', propertyId).maybeSingle(),
        supabase
          .from('internet_ledger')
          .select('*')
          .eq('property_id', propertyId)
          .order('created_at', { ascending: false })
          .limit(30),
        supabase.rpc('compute_internet_monthly_amount'),
      ]);
      if (subRes.error && !isMissingRelation(subRes.error, 'internet_subscriptions')) throw subRes.error;
      setSubscription((subRes.data as InternetSubscription | null) ?? null);
      if (histRes.error && !isMissingRelation(histRes.error, 'internet_ledger')) throw histRes.error;
      setHistory((histRes.data as InternetLedger[] | null) ?? []);
      if (tariffRes.error) {
        setMonthRate(null);
      } else {
        const row = Array.isArray(tariffRes.data) ? tariffRes.data[0] : tariffRes.data;
        setMonthRate(row ? Number(row.amount_eur) : null);
      }
    } catch (e: unknown) {
      setError(ownerVisibleError(e, t('admin.errGeneric')));
    } finally {
      setLoading(false);
    }
  }, [propertyId, supabase, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const status = subscription?.status ?? 'inactive';
  const canConnect = !subscription || status === 'inactive';
  const canDisconnect = status === 'active';

  async function runConnect() {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const key = crypto.randomUUID();
      const { error: rpcErr } = await supabase.rpc('request_internet_connect', {
        p_property_id: propertyId,
        p_idempotency_key: key,
      });
      if (rpcErr) throw new Error(t(mapAdminRpcError(rpcErr.message)));
      setSuccess(t('account.internetPendingHint'));
      await load();
    } catch (e: unknown) {
      setError(ownerVisibleError(e, t('admin.errGeneric')));
    } finally {
      setBusy(false);
    }
  }

  async function runCancelConnect() {
    if (!confirm(t('account.internetCancelConfirm'))) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const { error: rpcErr } = await supabase.rpc('cancel_internet_connect_request', {
        p_property_id: propertyId,
      });
      if (rpcErr) throw new Error(t(mapAdminRpcError(rpcErr.message)));
      setSuccess(t('account.internetCancelled'));
      await load();
    } catch (e: unknown) {
      setError(ownerVisibleError(e, t('admin.errGeneric')));
    } finally {
      setBusy(false);
    }
  }

  async function runDisconnect() {
    if (!confirm(t('account.internetDisconnectConfirm'))) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const { error: rpcErr } = await supabase.rpc('request_internet_disconnect', {
        p_property_id: propertyId,
      });
      if (rpcErr) throw new Error(t(mapAdminRpcError(rpcErr.message)));
      setSuccess(t('account.internetDisconnectPending'));
      await load();
    } catch (e: unknown) {
      setError(ownerVisibleError(e, t('admin.errGeneric')));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-foreground">{t('account.internetTitle')}</h2>
        <p className="mt-1 text-sm text-secondary">{t('account.internetLeadTech')}</p>
      </div>

      {error ? (
        <div className="rounded-xl border border-danger/25 bg-danger-bg px-4 py-3 text-sm text-danger">{error}</div>
      ) : null}
      {success ? (
        <div className="rounded-xl border border-success/25 bg-success-bg px-4 py-3 text-sm text-success">{success}</div>
      ) : null}

      {loading ? (
        <p className="text-sm text-muted">{t('common.loading')}</p>
      ) : (
        <>
          <div className="rounded-2xl border border-border bg-surface px-4 py-4 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge label={t(internetStatusMessageKey(status))} tone={statusTone(status)} />
            </div>
            {subscription?.period_start ? (
              <p className="text-sm text-secondary">
                {t('account.internetConnectedSince')}: {formatOwnerDate(subscription.period_start, locale)}
              </p>
            ) : (
              <p className="text-sm text-muted">{t('account.internetNoPeriod')}</p>
            )}
            {subscription?.billing_day != null ? (
              <p className="text-sm text-secondary">
                {t('account.internetBillingDay', { n: String(subscription.billing_day) })}
                {subscription.next_charge_on
                  ? ` · ${t('account.internetNextCharge')}: ${formatOwnerDate(subscription.next_charge_on, locale)}`
                  : ''}
              </p>
            ) : null}
            <p className="text-xs text-muted">{t('account.internetFinanceHint')}</p>
          </div>

          {status === 'pending_enable' ? (
            <div className="rounded-2xl border border-border bg-surface px-4 py-4 space-y-3">
              <p className="text-sm text-secondary">{t('account.internetPendingHint')}</p>
              <p className="text-xs text-muted">{t('account.internetCancelHint')}</p>
              <button
                type="button"
                disabled={busy}
                onClick={() => void runCancelConnect()}
                className="rounded-xl border border-danger/30 px-4 py-2 text-sm font-semibold text-danger hover:bg-danger-bg disabled:opacity-50"
              >
                {busy ? t('common.saving') : t('account.internetCancel')}
              </button>
            </div>
          ) : null}

          {canConnect ? (
            <div className="rounded-2xl border border-border bg-surface px-4 py-4 space-y-3">
              <p className="text-sm font-medium text-foreground">{t('account.internetMonthlyPlan')}</p>
              {monthRate != null ? (
                <p className="text-sm text-secondary">
                  {t('account.internetMonthlyRate')}: {formatEur(monthRate)}
                </p>
              ) : (
                <p className="text-sm text-muted">{t('account.internetNoTariff')}</p>
              )}
              <p className="text-xs text-muted">{t('account.internetMonthlyHint')}</p>
              <button
                type="button"
                disabled={busy || monthRate == null}
                onClick={() => void runConnect()}
                className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
              >
                {busy ? t('common.saving') : t('account.internetConnect')}
              </button>
            </div>
          ) : null}

          {canDisconnect ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void runDisconnect()}
              className="rounded-xl border border-danger/30 px-4 py-2 text-sm font-semibold text-danger hover:bg-danger-bg disabled:opacity-50"
            >
              {t('account.internetDisconnect')}
            </button>
          ) : null}

          <div className="rounded-2xl border border-border bg-surface px-4 py-4">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
              {t('account.internetHistory')}
            </p>
            {history.length === 0 ? (
              <p className="mt-3 text-sm text-muted">{t('account.internetHistoryEmpty')}</p>
            ) : (
              <ul className="mt-3 divide-y divide-border">
                {history.map((row) => (
                  <li key={row.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-sm">
                    <span className="text-foreground">{eventLabel(row, t)}</span>
                    <span className="text-xs text-muted tabular-nums">
                      {formatOwnerDate(row.created_at, locale)}
                    </span>
                    {row.note ? <p className="w-full text-xs text-secondary">{row.note}</p> : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
