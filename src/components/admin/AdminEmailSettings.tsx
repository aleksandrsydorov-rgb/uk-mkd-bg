'use client';

import { useCallback, useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { useI18n } from '@/i18n/I18nProvider';
import {
  AdminCard,
  AdminInlineAlert,
  AdminPrimaryButton,
  adminFieldClass,
} from '@/components/admin/AdminUi';
import {
  fetchEmailSettings,
  listEmailDiagnostics,
  updateEmailSettings,
  type ComplexEmailSettings,
  type EmailTemplateLocale,
} from '@/lib/emailCore';
import { isMissingRpcError } from '@/lib/ownershipChange';

type Props = {
  supabase: SupabaseClient<Database>;
  canManage: boolean;
};

function statusLabel(
  status: string,
  t: (key: string, vars?: Record<string, string | number>) => string
) {
  const map: Record<string, string> = {
    not_configured: t('admin.emailStatusNotConfigured'),
    domain_pending: t('admin.emailStatusDomainPending'),
    ready: t('admin.emailStatusReady'),
    paused: t('admin.emailStatusPaused'),
    degraded: t('admin.emailStatusDegraded'),
    disabled_by_platform: t('admin.emailStatusPlatformDisabled'),
  };
  return map[status] ?? status;
}

export function AdminEmailSettings({ supabase, canManage }: Props) {
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [settings, setSettings] = useState<ComplexEmailSettings | null>(null);
  const [diagnostics, setDiagnostics] = useState<
    Awaited<ReturnType<typeof listEmailDiagnostics>>
  >([]);

  const [senderName, setSenderName] = useState('');
  const [senderEmail, setSenderEmail] = useState('');
  const [replyTo, setReplyTo] = useState('');
  const [locale, setLocale] = useState<EmailTemplateLocale>('bg');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const s = await fetchEmailSettings(supabase);
      setSettings(s);
      setSenderName(s.sender_name);
      setSenderEmail(s.sender_email ?? '');
      setReplyTo(s.reply_to_email ?? '');
      setLocale(s.template_locale);
      setMissing(false);
      try {
        setDiagnostics(await listEmailDiagnostics(supabase, 30));
      } catch {
        setDiagnostics([]);
      }
    } catch (err) {
      if (isMissingRpcError(err)) {
        setMissing(true);
        setSettings(null);
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const next = await updateEmailSettings(supabase, {
        sender_name: senderName,
        sender_email: senderEmail || null,
        reply_to_email: replyTo,
        template_locale: locale,
        email_enabled: false,
      });
      setSettings(next);
      setSuccess(t('admin.emailSaved'));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  if (missing) {
    return (
      <AdminCard>
        <h3 className="text-base font-semibold text-foreground">{t('admin.emailTitle')}</h3>
        <p className="mt-2 text-sm text-secondary">{t('admin.emailMigrationPending')}</p>
      </AdminCard>
    );
  }

  const verifiedOptions = (settings?.verified_senders ?? []).filter((s) => s.status === 'verified');

  return (
    <section className="space-y-3">
      <div className="px-0.5">
        <h3 className="text-base font-semibold tracking-tight text-foreground">
          {t('admin.emailTitle')}
        </h3>
        <p className="mt-1 max-w-xl text-sm text-secondary">{t('admin.emailLead')}</p>
      </div>

      {error ? <AdminInlineAlert tone="danger">{error}</AdminInlineAlert> : null}
      {success ? <AdminInlineAlert tone="success">{success}</AdminInlineAlert> : null}

      <AdminCard>
        {loading || !settings ? (
          <p className="text-sm text-muted">{t('admin.emailLoading')}</p>
        ) : (
          <form className="space-y-4" onSubmit={onSave}>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-border bg-surface-secondary/40 px-3 py-2.5 sm:col-span-2">
                <p className="text-xs uppercase tracking-wide text-muted">{t('admin.emailSystemStatus')}</p>
                <p className="mt-1 text-sm font-semibold text-foreground">
                  {statusLabel(settings.delivery_status, t)}
                </p>
                <p className="mt-1 text-xs text-secondary">{t('admin.emailPhaseANote')}</p>
                <ul className="mt-2 space-y-1 text-xs text-muted">
                  <li>
                    {t('admin.emailProvider')}: {settings.mail_provider}
                  </li>
                  <li>
                    {t('admin.emailDomain')}:{' '}
                    {settings.verified_domain
                      ? `${settings.verified_domain} (${settings.domain_status})`
                      : t('admin.emailDomainNone')}
                  </li>
                  <li>{t('admin.emailSecretsNote')}</li>
                  <li>
                    {t('admin.emailSendingFlag')}: EMAIL_SENDING_ENABLED=false (host) ·
                    email_enabled={String(settings.email_enabled)}
                  </li>
                </ul>
              </div>

              <label className="block space-y-1 sm:col-span-2">
                <span className="text-xs text-muted">{t('admin.emailSenderName')}</span>
                <input
                  className={adminFieldClass}
                  value={senderName}
                  disabled={!canManage || saving}
                  onChange={(e) => setSenderName(e.target.value)}
                  maxLength={120}
                />
              </label>

              <label className="block space-y-1 sm:col-span-2">
                <span className="text-xs text-muted">{t('admin.emailSenderEmail')}</span>
                <select
                  className={adminFieldClass}
                  value={senderEmail}
                  disabled={!canManage || saving || verifiedOptions.length === 0}
                  onChange={(e) => setSenderEmail(e.target.value)}
                >
                  <option value="">{t('admin.emailSenderEmailNone')}</option>
                  {verifiedOptions.map((s) => (
                    <option key={s.id} value={s.email}>
                      {s.email}
                    </option>
                  ))}
                </select>
                {verifiedOptions.length === 0 ? (
                  <span className="block text-xs text-muted">{t('admin.emailNoVerifiedSenders')}</span>
                ) : null}
              </label>

              <label className="block space-y-1 sm:col-span-2">
                <span className="text-xs text-muted">{t('admin.emailReplyTo')}</span>
                <input
                  className={adminFieldClass}
                  type="email"
                  value={replyTo}
                  disabled={!canManage || saving}
                  onChange={(e) => setReplyTo(e.target.value)}
                  placeholder="reply@example.com"
                />
              </label>

              <label className="block space-y-1">
                <span className="text-xs text-muted">{t('admin.emailLocale')}</span>
                <select
                  className={adminFieldClass}
                  value={locale}
                  disabled={!canManage || saving}
                  onChange={(e) => setLocale(e.target.value as EmailTemplateLocale)}
                >
                  <option value="bg">BG</option>
                  <option value="ru">RU</option>
                  <option value="en">EN</option>
                </select>
              </label>

              <div className="flex items-end">
                <AdminPrimaryButton type="submit" disabled={!canManage || saving}>
                  {saving ? t('admin.emailSaving') : t('admin.emailSave')}
                </AdminPrimaryButton>
              </div>
            </div>
          </form>
        )}
      </AdminCard>

      <AdminCard>
        <h4 className="text-sm font-semibold text-foreground">{t('admin.emailDiagnostics')}</h4>
        <p className="mt-1 text-xs text-secondary">{t('admin.emailDiagnosticsHint')}</p>
        {diagnostics.length === 0 ? (
          <p className="mt-3 text-sm text-muted">{t('admin.emailDiagnosticsEmpty')}</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-wide text-muted">
                  <th className="py-2 pr-3">{t('admin.emailDiagModule')}</th>
                  <th className="py-2 pr-3">{t('admin.emailDiagTo')}</th>
                  <th className="py-2 pr-3">{t('admin.emailDiagStatus')}</th>
                  <th className="py-2 pr-3">{t('admin.emailDiagError')}</th>
                  <th className="py-2">{t('admin.emailDiagWhen')}</th>
                </tr>
              </thead>
              <tbody>
                {diagnostics.map((row) => (
                  <tr key={row.id} className="border-b border-border/70">
                    <td className="py-2 pr-3">{row.module_key}</td>
                    <td className="py-2 pr-3 font-mono text-xs">{row.to_masked ?? '—'}</td>
                    <td className="py-2 pr-3">{row.status}</td>
                    <td className="py-2 pr-3 text-xs text-muted">{row.last_error_code ?? '—'}</td>
                    <td className="py-2 text-xs text-muted">{row.created_at}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AdminCard>
    </section>
  );
}
