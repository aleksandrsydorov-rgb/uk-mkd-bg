'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
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
  enqueueAllowlistedTestEmail,
  fetchEmailQueueSummary,
  fetchEmailSettings,
  listEmailDiagnostics,
  updateEmailSettings,
  type ComplexEmailSettings,
  type EmailDiagnosticRow,
  type EmailQueueSummary,
  type EmailTemplateLocale,
} from '@/lib/emailCore';
import { previewTransactionalEmail } from '@/lib/email/templates';
import {
  EMAIL_PREVIEW_TEMPLATE_KEYS,
  type EmailPreviewTemplateKey,
} from '@/lib/email/setupValidation';
import { isMissingRpcError } from '@/lib/ownershipChange';
import { NotificationPreferencesPanel } from '@/components/notifications/NotificationPreferencesPanel';

type Props = {
  supabase: SupabaseClient<Database>;
  canManage: boolean;
  /** Personal prefs role hint for staff vs admin. */
  personalRoleHint?: 'admin' | 'staff';
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

export function AdminEmailSettings({
  supabase,
  canManage,
  personalRoleHint = 'admin',
}: Props) {
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [queuingTest, setQueuingTest] = useState(false);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [settings, setSettings] = useState<ComplexEmailSettings | null>(null);
  const [diagnostics, setDiagnostics] = useState<EmailDiagnosticRow[]>([]);
  const [summary, setSummary] = useState<EmailQueueSummary | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [moduleFilter, setModuleFilter] = useState<string>('all');

  const [senderName, setSenderName] = useState('');
  const [senderEmail, setSenderEmail] = useState('');
  const [replyTo, setReplyTo] = useState('');
  const [locale, setLocale] = useState<EmailTemplateLocale>('bg');
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [testTo, setTestTo] = useState('');
  const [previewKey, setPreviewKey] = useState<EmailPreviewTemplateKey>('pb1_property_invite');
  const [previewLocale, setPreviewLocale] = useState<EmailTemplateLocale>('bg');
  const [previewMode, setPreviewMode] = useState<'html' | 'text'>('html');

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
      setEmailEnabled(s.email_enabled);
      setMissing(false);
      try {
        setDiagnostics(await listEmailDiagnostics(supabase, 50));
      } catch {
        setDiagnostics([]);
      }
      setSummary(await fetchEmailQueueSummary(supabase));
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

  const filteredDiagnostics = useMemo(() => {
    return diagnostics.filter((row) => {
      if (statusFilter !== 'all' && row.status !== statusFilter) return false;
      if (moduleFilter !== 'all' && row.module_key !== moduleFilter) return false;
      return true;
    });
  }, [diagnostics, statusFilter, moduleFilter]);

  const moduleOptions = useMemo(() => {
    const set = new Set(diagnostics.map((d) => d.module_key).filter(Boolean));
    return Array.from(set).sort();
  }, [diagnostics]);

  const preview = useMemo(() => {
    return previewTransactionalEmail({
      templateKey: previewKey,
      locale: previewLocale,
      complexName: senderName || settings?.sender_name || null,
      payload: {
        invite_link: 'https://example.invalid/auth/invite?token=preview',
        apartment: '12',
        event_kind: 'approved',
        reminderType: 'nudge',
      },
    });
  }, [previewKey, previewLocale, senderName, settings?.sender_name]);

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
        email_enabled: emailEnabled,
      });
      setSettings(next);
      setEmailEnabled(next.email_enabled);
      setSuccess(t('admin.emailSaved'));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function onQueueTest() {
    if (!canManage) return;
    const to = testTo.trim();
    if (!to || !to.includes('@')) {
      setError(t('admin.emailTestInvalid'));
      return;
    }
    setQueuingTest(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await enqueueAllowlistedTestEmail(supabase, {
        toEmail: to,
        locale,
        note: 'admin_ui_controlled_test',
      });
      await load();
      if (result.queued || result.honesty === 'QUEUED') {
        setSuccess(t('admin.emailTestQueued'));
      } else {
        setSuccess(t('admin.emailTestBlocked', { status: result.honesty || result.status }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setQueuingTest(false);
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
  const canEnable =
    settings?.domain_status === 'verified' &&
    Boolean(settings.sender_email) &&
    verifiedOptions.some((s) => s.email === settings.sender_email);

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
                <p className="mt-1 text-xs text-secondary">{t('admin.emailPhaseNote')}</p>
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
                    {t('admin.emailSendingFlag')}: host EMAIL_SENDING_ENABLED · DB email_enabled=
                    {String(settings.email_enabled)}
                  </li>
                  <li>{t('admin.emailCronNote')}</li>
                </ul>
              </div>

              {summary ? (
                <div className="rounded-lg border border-border px-3 py-2.5 text-xs text-secondary sm:col-span-2">
                  <p className="font-medium text-foreground">{t('admin.emailQueueSummary')}</p>
                  <p className="mt-1">
                    claimable={summary.claimable} · queued={summary.queued} · sent={summary.sent} ·
                    failed={summary.failed} · blocked={summary.blocked_not_ready} · cancelled=
                    {summary.cancelled}
                  </p>
                </div>
              ) : null}

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

              <label className="flex items-end gap-2 pb-1 text-sm text-secondary">
                <input
                  type="checkbox"
                  checked={emailEnabled}
                  disabled={!canManage || saving || (!canEnable && !emailEnabled)}
                  onChange={(e) => setEmailEnabled(e.target.checked)}
                />
                <span>
                  {t('admin.emailEnabledToggle')}
                  <span className="mt-0.5 block text-xs text-muted">{t('admin.emailEnabledHint')}</span>
                </span>
              </label>

              <div className="flex items-end sm:col-span-2">
                <AdminPrimaryButton type="submit" disabled={!canManage || saving}>
                  {saving ? t('admin.emailSaving') : t('admin.emailSave')}
                </AdminPrimaryButton>
              </div>
            </div>
          </form>
        )}
      </AdminCard>

      <AdminCard>
        <h4 className="text-sm font-semibold text-foreground">{t('admin.emailPreviewTitle')}</h4>
        <p className="mt-1 text-xs text-secondary">{t('admin.emailPreviewHint')}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <label className="space-y-1 text-xs text-muted">
            <span>{t('admin.emailPreviewTemplate')}</span>
            <select
              className={adminFieldClass}
              value={previewKey}
              onChange={(e) => setPreviewKey(e.target.value as EmailPreviewTemplateKey)}
            >
              {EMAIL_PREVIEW_TEMPLATE_KEYS.map((key) => (
                <option key={key} value={key}>
                  {key}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs text-muted">
            <span>{t('admin.emailLocale')}</span>
            <select
              className={adminFieldClass}
              value={previewLocale}
              onChange={(e) => setPreviewLocale(e.target.value as EmailTemplateLocale)}
            >
              <option value="bg">BG</option>
              <option value="ru">RU</option>
              <option value="en">EN</option>
            </select>
          </label>
          <label className="space-y-1 text-xs text-muted">
            <span>{t('admin.emailPreviewMode')}</span>
            <select
              className={adminFieldClass}
              value={previewMode}
              onChange={(e) => setPreviewMode(e.target.value as 'html' | 'text')}
            >
              <option value="html">HTML</option>
              <option value="text">Text</option>
            </select>
          </label>
        </div>
        <p className="mt-3 text-xs font-medium text-foreground">
          {t('admin.emailPreviewSubject')}: {preview.subject}
        </p>
        {previewMode === 'html' ? (
          <iframe
            title={t('admin.emailPreviewTitle')}
            className="mt-2 h-64 w-full rounded-lg border border-border bg-white"
            sandbox=""
            srcDoc={preview.html}
          />
        ) : (
          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-surface-secondary/40 p-3 text-xs text-foreground">
            {preview.text}
          </pre>
        )}
      </AdminCard>

      <AdminCard>
        <h4 className="text-sm font-semibold text-foreground">{t('admin.emailTestTitle')}</h4>
        <p className="mt-1 text-xs text-secondary">{t('admin.emailTestHint')}</p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="block flex-1 space-y-1">
            <span className="text-xs text-muted">{t('admin.emailTestTo')}</span>
            <input
              className={adminFieldClass}
              type="email"
              value={testTo}
              disabled={!canManage || queuingTest}
              onChange={(e) => setTestTo(e.target.value)}
              placeholder="you@example.com"
            />
          </label>
          <AdminPrimaryButton
            type="button"
            disabled={!canManage || queuingTest || !testTo.trim()}
            onClick={() => void onQueueTest()}
          >
            {queuingTest ? t('admin.emailTestQueuing') : t('admin.emailTestQueue')}
          </AdminPrimaryButton>
        </div>
      </AdminCard>

      <AdminCard>
        <NotificationPreferencesPanel
          supabase={supabase}
          t={t}
          roleHint={personalRoleHint}
          compact
        />
      </AdminCard>

      <AdminCard>
        <h4 className="text-sm font-semibold text-foreground">{t('admin.emailDiagnostics')}</h4>
        <p className="mt-1 text-xs text-secondary">{t('admin.emailDiagnosticsHint')}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <label className="space-y-1 text-xs text-muted">
            <span>{t('admin.emailDiagStatus')}</span>
            <select
              className={adminFieldClass}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="all">{t('admin.emailFilterAll')}</option>
              <option value="queued">queued</option>
              <option value="sent">sent</option>
              <option value="failed">failed</option>
              <option value="blocked_not_ready">blocked_not_ready</option>
              <option value="cancelled">cancelled</option>
              <option value="sending">sending</option>
            </select>
          </label>
          <label className="space-y-1 text-xs text-muted">
            <span>{t('admin.emailDiagModule')}</span>
            <select
              className={adminFieldClass}
              value={moduleFilter}
              onChange={(e) => setModuleFilter(e.target.value)}
            >
              <option value="all">{t('admin.emailFilterAll')}</option>
              {moduleOptions.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
        </div>
        {filteredDiagnostics.length === 0 ? (
          <p className="mt-3 text-sm text-muted">{t('admin.emailDiagnosticsEmpty')}</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-wide text-muted">
                  <th className="py-2 pr-3">{t('admin.emailDiagModule')}</th>
                  <th className="py-2 pr-3">{t('admin.emailDiagTo')}</th>
                  <th className="py-2 pr-3">{t('admin.emailDiagStatus')}</th>
                  <th className="py-2 pr-3">{t('admin.emailDiagEvent')}</th>
                  <th className="py-2 pr-3">{t('admin.emailDiagRetry')}</th>
                  <th className="py-2 pr-3">{t('admin.emailDiagError')}</th>
                  <th className="py-2">{t('admin.emailDiagWhen')}</th>
                </tr>
              </thead>
              <tbody>
                {filteredDiagnostics.map((row) => (
                  <tr key={row.id} className="border-b border-border/70">
                    <td className="py-2 pr-3">
                      {row.module_key}
                      <span className="mt-0.5 block font-mono text-[10px] text-muted">
                        {row.template_key} · {row.locale}
                      </span>
                    </td>
                    <td className="py-2 pr-3 font-mono text-xs">{row.to_masked ?? '—'}</td>
                    <td className="py-2 pr-3">
                      {row.status}
                      <span className="mt-0.5 block text-[10px] text-muted">
                        attempts={row.attempts}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-xs text-muted">{row.latest_event_type ?? '—'}</td>
                    <td className="py-2 pr-3 text-xs">
                      {row.retry_eligible ? t('admin.emailRetryYes') : t('admin.emailRetryNo')}
                    </td>
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
