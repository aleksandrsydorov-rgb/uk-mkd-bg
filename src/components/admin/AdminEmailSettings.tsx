'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { useI18n } from '@/i18n/I18nProvider';
import { toUserFacingMessage } from '@/lib/userFacingError';
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
  emailOutboxOperatorLabelKey,
  type ComplexEmailSettings,
  type EmailConnectionStatus,
  type EmailDiagnosticRow,
  type EmailQueueSummary,
  type EmailTemplateLocale,
} from '@/lib/emailCore';
import { isMissingRpcError } from '@/lib/ownershipChange';
import { NotificationPreferencesPanel } from '@/components/notifications/NotificationPreferencesPanel';

type Props = {
  supabase: SupabaseClient<Database>;
  canManage: boolean;
  personalRoleHint?: 'admin' | 'staff';
};

function connectionStatusLabel(
  status: EmailConnectionStatus | string,
  t: (key: string, vars?: Record<string, string | number>) => string
) {
  const map: Record<string, string> = {
    not_configured: t('admin.emailConnNotConfigured'),
    enabled_untested: t('admin.emailConnEnabledUntested'),
    accepted: t('admin.emailConnAccepted'),
    disabled: t('admin.emailConnDisabled'),
    error: t('admin.emailConnError'),
  };
  return map[status] ?? t('admin.emailConnNotConfigured');
}

function outboxRowLabel(
  row: EmailDiagnosticRow,
  t: (key: string, vars?: Record<string, string | number>) => string
) {
  const key = emailOutboxOperatorLabelKey({
    status: row.status,
    latestEventType: row.latest_event_type,
    lastErrorCode: row.last_error_code,
  });
  return key ? t(key) : t('admin.emailDiagStatusUnknown');
}

function emailModuleTitle(
  moduleKey: string,
  t: (key: string, vars?: Record<string, string | number>) => string
) {
  const map: Record<string, string> = {
    ownership: t('admin.emailModuleOwnership'),
    polls: t('admin.emailModulePolls'),
    announcements: t('admin.emailModuleAnnouncements'),
    support_fee: t('admin.emailModuleSupportFee'),
    water: t('admin.emailModuleWater'),
    electricity: t('admin.emailModuleElectricity'),
    internet: t('account.navInternet'),
    capital_repair: t('admin.emailModuleCapital'),
    platform: t('admin.emailModulePlatform'),
    email_test: t('admin.emailTplTest'),
  };
  return map[moduleKey] ?? t('admin.emailModuleOther');
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
  const [hostSendingEnabled, setHostSendingEnabled] = useState<boolean | null>(null);
  const [encryptionConfigured, setEncryptionConfigured] = useState<boolean | null>(null);
  const [diagnostics, setDiagnostics] = useState<EmailDiagnosticRow[]>([]);
  const [summary, setSummary] = useState<EmailQueueSummary | null>(null);

  const [senderEmail, setSenderEmail] = useState('');
  const [projectToken, setProjectToken] = useState('');
  const [complexName, setComplexName] = useState('AMADEUS 11');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const s = await fetchEmailSettings(supabase);
      setSettings(s);
      setSenderEmail(s.sender_email ?? '');
      setProjectToken('');
      setMissing(false);
      try {
        const { data: name } = await supabase.rpc('admin_get_complex_display_name' as never);
        if (typeof name === 'string' && name.trim()) setComplexName(name.trim());
        else if (s.sender_name) setComplexName(s.sender_name);
      } catch {
        if (s.sender_name) setComplexName(s.sender_name);
      }
      try {
        const healthRes = await fetch('/api/email/settings');
        const health = (await healthRes.json()) as {
          host_sending_enabled?: unknown;
          encryption_configured?: unknown;
        };
        setHostSendingEnabled(
          typeof health.host_sending_enabled === 'boolean' ? health.host_sending_enabled : null
        );
        setEncryptionConfigured(
          typeof health.encryption_configured === 'boolean' ? health.encryption_configured : null
        );
      } catch {
        setHostSendingEnabled(null);
        setEncryptionConfigured(null);
      }
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
        setError(toUserFacingMessage(err, t, { fallback: t('admin.errGeneric') }));
      }
    } finally {
      setLoading(false);
    }
  }, [supabase, t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveConnection(enable: boolean) {
    if (!canManage) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch('/api/email/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: enable ? 'save_enable' : 'disable',
          enable,
          sender_email: senderEmail,
          project_token: projectToken.trim() ? projectToken.trim() : null,
        }),
      });
      const body = (await res.json()) as {
        ok?: boolean;
        error?: string;
        token_saved?: boolean;
        host_sending_enabled?: boolean;
      };
      if (!res.ok || !body.ok) {
        if (body.error === 'host_sending_disabled') {
          setError(t('admin.emailHostGateBlocked'));
        } else if (body.error === 'encryption_key_not_configured') {
          setError(t('admin.emailEncryptionMissing'));
        } else if (body.error === 'invalid_sender_email') {
          setError(t('admin.emailSenderInvalid'));
        } else if (body.error === 'forbidden' || body.error === 'unauthorized') {
          setError(t('admin.errForbidden'));
        } else {
          setError(t('admin.errGeneric'));
        }
        return;
      }
      if (body.token_saved) {
        setSuccess(
          enable ? t('admin.emailSavedEnabledToken') : t('admin.emailTokenSavedDisabled')
        );
      } else if (enable) {
        setSuccess(t('admin.emailSavedEnabled'));
      } else {
        setSuccess(t('admin.emailDisabledOk'));
      }
      setProjectToken('');
      await load();
    } catch (err) {
      setError(toUserFacingMessage(err, t, { fallback: t('admin.errGeneric') }));
    } finally {
      setSaving(false);
    }
  }

  async function onQueueTest() {
    if (!canManage) return;
    setQueuingTest(true);
    setError(null);
    setSuccess(null);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const to = String(user?.email ?? '').trim();
      if (!to || !to.includes('@')) {
        setError(t('admin.emailTestNoAdminEmail'));
        return;
      }
      const result = await enqueueAllowlistedTestEmail(supabase, {
        toEmail: to,
        locale: (settings?.template_locale ?? 'bg') as EmailTemplateLocale,
        note: 'admin_ui_controlled_test',
      });
      await load();
      if (result.queued || result.honesty === 'QUEUED') {
        setSuccess(t('admin.emailTestQueued'));
      } else {
        setSuccess(t('admin.emailTestBlocked', { status: t('admin.emailHonestyNotReady') }));
      }
    } catch (err) {
      setError(toUserFacingMessage(err, t, { fallback: t('admin.errGeneric') }));
    } finally {
      setQueuingTest(false);
    }
  }

  const canSaveEnable = useMemo(() => {
    if (!canManage || saving) return false;
    if (!senderEmail.trim().includes('@')) return false;
    if (!settings?.has_provider_token && !projectToken.trim()) return false;
    return true;
  }, [canManage, saving, senderEmail, settings?.has_provider_token, projectToken]);

  if (missing) {
    return (
      <AdminCard>
        <h3 className="text-base font-semibold text-foreground">{t('admin.emailTitle')}</h3>
        <p className="mt-2 text-sm text-secondary">{t('admin.emailMigrationPending')}</p>
      </AdminCard>
    );
  }

  return (
    <section className="space-y-3">
      <div className="px-0.5">
        <h3 className="text-base font-semibold tracking-tight text-foreground">
          {t('admin.emailTitle')}
        </h3>
        <p className="mt-1 max-w-xl text-sm text-secondary">{t('admin.emailLeadLettermint')}</p>
      </div>

      {error ? <AdminInlineAlert tone="danger">{error}</AdminInlineAlert> : null}
      {success ? <AdminInlineAlert tone="success">{success}</AdminInlineAlert> : null}

      <AdminCard>
        {loading || !settings ? (
          <p className="text-sm text-muted">{t('admin.emailLoading')}</p>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void saveConnection(true);
            }}
          >
            <div className="rounded-lg border border-border bg-surface-secondary/40 px-3 py-2.5">
              <p className="text-xs uppercase tracking-wide text-muted">{t('admin.emailSystemStatus')}</p>
              <p className="mt-1 text-sm font-semibold text-foreground">
                {connectionStatusLabel(settings.connection_status, t)}
              </p>
              <ul className="mt-2 space-y-1 text-xs text-muted">
                <li>
                  {t('admin.emailProvider')}: {t('admin.emailProviderLettermint')}
                </li>
                <li>
                  {t('admin.emailSendingHost', {
                    state:
                      hostSendingEnabled === null
                        ? t('admin.emailFlagUnknown')
                        : hostSendingEnabled
                          ? t('admin.emailFlagOn')
                          : t('admin.emailFlagOff'),
                  })}
                </li>
                <li>
                  {settings.has_provider_token
                    ? t('admin.emailKeyStored')
                    : t('admin.emailKeyMissing')}
                </li>
                {hostSendingEnabled === false ? (
                  <li className="text-danger">{t('admin.emailHostGateHint')}</li>
                ) : null}
                {encryptionConfigured === false ? (
                  <li className="text-danger">{t('admin.emailEncryptionMissing')}</li>
                ) : null}
              </ul>
            </div>

            {summary ? (
              <div className="rounded-lg border border-border px-3 py-2.5 text-xs text-secondary">
                <p className="font-medium text-foreground">{t('admin.emailQueueSummary')}</p>
                <p className="mt-1">
                  {t('admin.emailQueueLine', {
                    claimable: summary.claimable,
                    queued: summary.queued,
                    sent: summary.sent,
                    failed: summary.failed,
                    blocked: summary.blocked_not_ready,
                    cancelled: summary.cancelled,
                  })}
                </p>
              </div>
            ) : null}

            <label className="block space-y-1">
              <span className="text-xs text-muted">{t('admin.emailSenderNameFromComplex')}</span>
              <input className={adminFieldClass} value={complexName} disabled readOnly />
            </label>

            <label className="block space-y-1">
              <span className="text-xs text-muted">{t('admin.emailSenderEmail')}</span>
              <input
                className={adminFieldClass}
                type="email"
                value={senderEmail}
                disabled={!canManage || saving}
                onChange={(e) => setSenderEmail(e.target.value)}
                placeholder="noreply@amadeus11.online"
                autoComplete="off"
              />
              <span className="block text-xs text-muted">{t('admin.emailSenderDomainHint')}</span>
            </label>

            <label className="block space-y-1">
              <span className="text-xs text-muted">{t('admin.emailLettermintToken')}</span>
              <input
                className={adminFieldClass}
                type="password"
                value={projectToken}
                disabled={!canManage || saving}
                onChange={(e) => setProjectToken(e.target.value)}
                placeholder={
                  settings.has_provider_token
                    ? t('admin.emailTokenKeepPlaceholder')
                    : t('admin.emailTokenPlaceholder')
                }
                autoComplete="new-password"
              />
              <span className="block text-xs text-muted">{t('admin.emailTokenHint')}</span>
            </label>

            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <AdminPrimaryButton type="submit" disabled={!canSaveEnable}>
                {saving ? t('admin.emailSaving') : t('admin.emailSaveEnable')}
              </AdminPrimaryButton>
              <AdminPrimaryButton
                type="button"
                disabled={!canManage || queuingTest || !settings.email_enabled}
                onClick={() => void onQueueTest()}
              >
                {queuingTest ? t('admin.emailTestQueuing') : t('admin.emailTestSendAdmin')}
              </AdminPrimaryButton>
              <button
                type="button"
                className="rounded-lg border border-border px-3 py-2 text-sm text-secondary disabled:opacity-50"
                disabled={!canManage || saving || !settings.email_enabled}
                onClick={() => void saveConnection(false)}
              >
                {t('admin.emailDisableSending')}
              </button>
            </div>
            <p className="text-xs text-muted">{t('admin.emailSaveDoesNotSend')}</p>
          </form>
        )}
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
                    <td className="py-2 pr-3">{emailModuleTitle(row.module_key, t)}</td>
                    <td className="py-2 pr-3 text-xs">{row.to_masked ?? '—'}</td>
                    <td className="py-2 pr-3">{outboxRowLabel(row, t)}</td>
                    <td className="py-2 pr-3 text-xs text-muted">
                      {row.last_error_code ? t('admin.emailDiagDeliveryIssue') : '—'}
                    </td>
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
