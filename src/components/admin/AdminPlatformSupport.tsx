'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { useI18n } from '@/i18n/I18nProvider';
import { ownerVisibleError } from '@/lib/ownerError';
import { isMissingRelation } from '@/lib/polls';
import {
  AdminEmptyState,
  AdminInlineAlert,
  AdminPageHeader,
  AdminPrimaryButton,
  adminCardClass,
  adminFieldClass,
  adminTableCellClass,
  adminTableHeadRowClass,
  adminTableRowClass,
  AdminTableShell,
} from '@/components/admin/AdminUi';
import { StatusBadge } from '@/components/account/ownerUi';
import {
  buildClientTechContext,
  canSeePlatformSupportAdmin,
  createLocalPlatformControlAdapter,
  platformAccountStatusTone,
  platformInvoiceStatusTone,
  platformSupportVisibleDuringSuspension,
  type PlatformAccount,
  type PlatformInvoice,
  type PlatformSupportConversation,
  type PlatformSupportDeliveryMode,
  type PlatformBillingSyncMode,
} from '@/lib/platformControl';
import type { BuildingModulesState } from '@/lib/modules';

type TabKey = 'support' | 'billing';

function money(amount: number | null | undefined, currency: string) {
  if (amount == null || !Number.isFinite(amount)) return '—';
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency || 'EUR',
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency || 'EUR'}`;
  }
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—';
  const d = new Date(value.length <= 10 ? `${value}T12:00:00` : value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: value.length > 10 ? '2-digit' : undefined,
    minute: value.length > 10 ? '2-digit' : undefined,
  });
}

function periodLabel(inv: PlatformInvoice) {
  if (!inv.billing_period_start && !inv.billing_period_end) return '—';
  const a = inv.billing_period_start ?? '…';
  const b = inv.billing_period_end ?? '…';
  return `${a} — ${b}`;
}

export function AdminPlatformSupport({
  supabase,
  staffRole,
  buildingModules,
}: {
  supabase: SupabaseClient<Database>;
  staffRole: string;
  buildingModules: BuildingModulesState;
}) {
  const { t } = useI18n();
  const canSee = canSeePlatformSupportAdmin(staffRole);
  const service = useMemo(() => createLocalPlatformControlAdapter(supabase), [supabase]);
  const deliveryMode: PlatformSupportDeliveryMode = service.getSupportDeliveryMode();
  const billingMode: PlatformBillingSyncMode = service.getBillingSyncMode();
  const awaitingMaster = deliveryMode === 'awaiting_master';

  const [tab, setTab] = useState<TabKey>('support');
  const [account, setAccount] = useState<PlatformAccount | null>(null);
  const [conversation, setConversation] = useState<PlatformSupportConversation | null>(null);
  const [invoices, setInvoices] = useState<PlatformInvoice[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [migrationNeeded, setMigrationNeeded] = useState(false);
  const [queuedNotice, setQueuedNotice] = useState<string | null>(null);

  const activeModules = useMemo(
    () =>
      Object.entries(buildingModules)
        .filter(([, enabled]) => enabled)
        .map(([key]) => key),
    [buildingModules],
  );

  const load = useCallback(async () => {
    if (!canSee) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [acc, conv, inv] = await Promise.all([
        service.getPlatformAccount(),
        service.getSupportConversation(),
        service.getInvoices(),
      ]);
      setAccount(acc);
      setConversation(conv);
      setInvoices(inv);
      setMigrationNeeded(false);
    } catch (e) {
      const err = e as { message?: string };
      if (
        isMissingRelation(err, 'platform_support') ||
        isMissingRelation(err, 'platform_support_get_account')
      ) {
        setMigrationNeeded(true);
        setError(t('admin.platformMigrationNeeded'));
      } else {
        setError(ownerVisibleError(e, t('admin.errGeneric')));
      }
    } finally {
      setLoading(false);
    }
  }, [canSee, service, t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (tab !== 'support' || !conversation || conversation.unread_count <= 0) return;
    let cancelled = false;
    void (async () => {
      try {
        await service.markSupportMessagesRead();
        if (cancelled) return;
        const refreshed = await service.getSupportConversation();
        if (!cancelled) setConversation(refreshed);
      } catch {
        /* non-blocking */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tab, conversation, service]);

  async function sendMessage() {
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true);
    setError(null);
    setQueuedNotice(null);
    try {
      await service.sendSupportMessage(
        body,
        buildClientTechContext({
          activeModules,
          pagePath: typeof window !== 'undefined' ? window.location.pathname : '/admin',
          installationId: account?.installation_id,
          complexName: account?.complex_name || undefined,
        }),
      );
      setDraft('');
      const conv = await service.getSupportConversation();
      setConversation(conv);
      if (awaitingMaster) {
        setQueuedNotice(t('admin.platformQueuedLocalOk'));
      }
    } catch (e) {
      setError(ownerVisibleError(e, t('admin.errGeneric')));
    } finally {
      setBusy(false);
    }
  }

  if (!canSee) {
    return <AdminEmptyState title={t('admin.platformTitle')} text={t('admin.platformAccessDenied')} />;
  }

  if (account && !platformSupportVisibleDuringSuspension(account.status)) {
    return <AdminEmptyState title={t('admin.platformTitle')} text={t('admin.platformAccessDenied')} />;
  }

  const statusLabel = (status: string) => {
    const key = `admin.platformStatus_${status}` as const;
    const v = t(key);
    return v === key ? status : v;
  };

  const invoiceStatusLabel = (status: string) => {
    const key = `admin.platformInvoice_${status}` as const;
    const v = t(key);
    return v === key ? status : v;
  };

  return (
    <div className="space-y-4">
      <AdminPageHeader
        title={t('admin.platformTitle')}
        secondary={t('admin.platformLead')}
      />

      {error ? <AdminInlineAlert tone="danger">{error}</AdminInlineAlert> : null}
      {migrationNeeded ? (
        <AdminInlineAlert tone="warning">{t('admin.platformMigrationNeeded')}</AdminInlineAlert>
      ) : null}
      {queuedNotice ? (
        <AdminInlineAlert tone="info" onDismiss={() => setQueuedNotice(null)}>
          {queuedNotice}
        </AdminInlineAlert>
      ) : null}

      <div className={`${adminCardClass} grid gap-3 p-4 sm:grid-cols-3`}>
        <div>
          <p className="text-xs text-muted">{t('admin.platformStatusLabel')}</p>
          <div className="mt-1">
            {account ? (
              <StatusBadge
                tone={platformAccountStatusTone(account.status)}
                label={statusLabel(account.status)}
              />
            ) : (
              <span className="text-sm text-muted">—</span>
            )}
          </div>
        </div>
        <div>
          <p className="text-xs text-muted">{t('admin.platformNextPayment')}</p>
          <p className="mt-1 text-sm font-semibold text-foreground">
            {formatDate(account?.next_payment_date)}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted">{t('admin.platformDebt')}</p>
          <p className="mt-1 text-sm font-semibold text-foreground">
            {money(account?.debt_amount, account?.currency ?? 'EUR')}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {(
          [
            ['support', t('admin.platformTabSupport')],
            ['billing', t('admin.platformTabBilling')],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`rounded-full px-3 py-1.5 text-sm font-medium ${
              tab === key
                ? 'bg-accent text-white'
                : 'border border-border bg-surface text-secondary hover:bg-hover'
            }`}
          >
            {label}
            {key === 'support' && (conversation?.unread_count ?? 0) > 0 ? (
              <span className="ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1 text-[11px] text-white">
                {conversation?.unread_count}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-muted">{t('admin.loading')}</p>
      ) : tab === 'support' ? (
        <section className={`${adminCardClass} space-y-4 p-4`}>
          <div>
            <h3 className="text-base font-semibold text-foreground">{t('admin.platformSupportTitle')}</h3>
            <p className="mt-1 text-sm text-secondary">{t('admin.platformSupportHint')}</p>
          </div>

          {awaitingMaster ? (
            <AdminInlineAlert tone="warning">{t('admin.platformAwaitingMasterSupport')}</AdminInlineAlert>
          ) : null}

          <div className="max-h-[420px] space-y-3 overflow-y-auto rounded-lg border border-border bg-surface-secondary/40 p-3">
            {(conversation?.messages.length ?? 0) === 0 ? (
              <p className="text-sm text-muted">
                {awaitingMaster ? t('admin.platformSupportEmptyPreMaster') : t('admin.platformSupportEmpty')}
              </p>
            ) : (
              conversation?.messages.map((msg) => {
                const mine = msg.sender_role === 'complex_admin';
                return (
                  <div
                    key={msg.id}
                    className={`max-w-[90%] rounded-xl px-3 py-2 text-sm ${
                      mine
                        ? 'ml-auto bg-accent/10 text-foreground'
                        : 'mr-auto bg-surface border border-border text-foreground'
                    }`}
                  >
                    <div className="mb-1 flex items-center justify-between gap-3 text-[11px] text-muted">
                      <span>
                        {mine ? t('admin.platformRoleAdmin') : t('admin.platformRoleOperator')}
                      </span>
                      <span>{formatDate(msg.created_at)}</span>
                    </div>
                    <p className="whitespace-pre-wrap break-words">{msg.body}</p>
                    <p className="mt-1 text-[11px] text-muted">
                      {mine
                        ? awaitingMaster
                          ? t('admin.platformQueuedLocal')
                          : msg.read_by_platform_operator
                            ? t('admin.platformReadByOperator')
                            : t('admin.platformUnreadByOperator')
                        : msg.read_by_complex_admin
                          ? t('admin.platformReadByAdmin')
                          : t('admin.platformUnreadByAdmin')}
                    </p>
                  </div>
                );
              })
            )}
          </div>

          <div className="space-y-2">
            <textarea
              className={`${adminFieldClass} min-h-[96px] resize-y`}
              value={draft}
              disabled={busy || migrationNeeded}
              placeholder={
                awaitingMaster ? t('admin.platformMessagePhPreMaster') : t('admin.platformMessagePh')
              }
              onChange={(e) => setDraft(e.target.value)}
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              {awaitingMaster ? (
                <p className="text-xs text-muted">{t('admin.platformLocalSaveHint')}</p>
              ) : (
                <span />
              )}
              <AdminPrimaryButton
                disabled={busy || migrationNeeded || !draft.trim()}
                onClick={() => void sendMessage()}
              >
                {busy
                  ? t('admin.saving')
                  : awaitingMaster
                    ? t('admin.platformSaveLocal')
                    : t('admin.platformSend')}
              </AdminPrimaryButton>
            </div>
          </div>
        </section>
      ) : (
        <section className="space-y-4">
          {billingMode === 'awaiting_master' ? (
            <AdminInlineAlert tone="info">{t('admin.platformAwaitingMasterBilling')}</AdminInlineAlert>
          ) : null}
          <div className={`${adminCardClass} grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4`}>
            <div>
              <p className="text-xs text-muted">{t('admin.platformBillingStatus')}</p>
              <p className="mt-1 text-sm font-semibold">
                {account ? statusLabel(account.status) : '—'}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted">{t('admin.platformFixedPrice')}</p>
              <p className="mt-1 text-sm font-semibold">
                {money(account?.fixed_service_price, account?.currency ?? 'EUR')}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted">{t('admin.platformNextPayment')}</p>
              <p className="mt-1 text-sm font-semibold">{formatDate(account?.next_payment_date)}</p>
            </div>
            <div>
              <p className="text-xs text-muted">{t('admin.platformAmountDue')}</p>
              <p className="mt-1 text-sm font-semibold">
                {money(account?.amount_due, account?.currency ?? 'EUR')}
              </p>
            </div>
          </div>

          <AdminTableShell>
            <table className="min-w-full text-sm">
              <thead>
                <tr className={adminTableHeadRowClass}>
                  <th className={adminTableCellClass}>{t('admin.platformInvoiceNumber')}</th>
                  <th className={adminTableCellClass}>{t('admin.platformInvoicePeriod')}</th>
                  <th className={adminTableCellClass}>{t('admin.platformInvoiceIssue')}</th>
                  <th className={adminTableCellClass}>{t('admin.platformInvoiceDue')}</th>
                  <th className={adminTableCellClass}>{t('admin.platformInvoiceAmount')}</th>
                  <th className={adminTableCellClass}>{t('admin.platformInvoiceStatus')}</th>
                  <th className={adminTableCellClass}>{t('admin.platformInvoiceDocument')}</th>
                </tr>
              </thead>
              <tbody>
                {invoices.length === 0 ? (
                  <tr className={adminTableRowClass}>
                    <td className={`${adminTableCellClass} text-muted`} colSpan={7}>
                      {t('admin.platformInvoicesEmpty')}
                    </td>
                  </tr>
                ) : (
                  invoices.map((inv) => (
                    <tr key={inv.id} className={adminTableRowClass}>
                      <td className={adminTableCellClass}>{inv.invoice_number}</td>
                      <td className={adminTableCellClass}>{periodLabel(inv)}</td>
                      <td className={adminTableCellClass}>{formatDate(inv.issue_date)}</td>
                      <td className={adminTableCellClass}>{formatDate(inv.due_date)}</td>
                      <td className={adminTableCellClass}>{money(inv.amount, inv.currency)}</td>
                      <td className={adminTableCellClass}>
                        <StatusBadge
                          tone={platformInvoiceStatusTone(inv.status)}
                          label={invoiceStatusLabel(inv.status)}
                        />
                        {inv.status === 'PAID' && inv.paid_at ? (
                          <p className="mt-1 text-[11px] text-muted">
                            {t('admin.platformPaidAt')}: {formatDate(inv.paid_at)}
                            {inv.payment_reference
                              ? ` · ${t('admin.platformPaymentRef')}: ${inv.payment_reference}`
                              : ''}
                          </p>
                        ) : null}
                      </td>
                      <td className={adminTableCellClass}>
                        {inv.document_url ? (
                          <a
                            href={inv.document_url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-accent hover:underline"
                          >
                            {t('admin.platformOpenDocument')}
                          </a>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </AdminTableShell>
        </section>
      )}
    </div>
  );
}
