'use client';

import { useCallback, useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import {
  AdminCard,
  AdminInlineAlert,
  AdminPrimaryButton,
  adminFieldClass,
} from '@/components/admin/AdminUi';
import {
  fetchEmailSettings,
  updateEmailSettings,
  type ComplexEmailSettings,
  type EmailTemplateLocale,
} from '@/lib/emailCore';
import { validateEmailSetupDraft } from '@/lib/email/setupValidation';
import { isMissingRpcError } from '@/lib/ownershipChange';

type Props = {
  supabase: SupabaseClient<Database>;
  t: (key: string, vars?: Record<string, string | number>) => string;
  canManage?: boolean;
};

/**
 * Initial Setup — Email Core identity (sender name, Reply-To, locale).
 * Does not enable sending. Verified From address remains ops-gated.
 */
export function AdminEmailInitialSetupCard({ supabase, t, canManage = true }: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [settings, setSettings] = useState<ComplexEmailSettings | null>(null);
  const [senderName, setSenderName] = useState('');
  const [replyTo, setReplyTo] = useState('');
  const [locale, setLocale] = useState<EmailTemplateLocale>('bg');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const s = await fetchEmailSettings(supabase);
      setSettings(s);
      setSenderName(s.sender_name);
      setReplyTo(s.reply_to_email ?? '');
      setLocale(s.template_locale);
      setMissing(false);
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

  const validation = validateEmailSetupDraft(
    {
      senderName,
      replyToEmail: replyTo,
      templateLocale: locale,
      senderEmail: settings?.sender_email ?? null,
    },
    {
      verifiedSenderEmails: (settings?.verified_senders ?? [])
        .filter((s) => s.status === 'verified')
        .map((s) => s.email),
      domainStatus: settings?.domain_status,
      verifiedDomain: settings?.verified_domain,
      emailEnabled: settings?.email_enabled,
    }
  );

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage || !validation.canSaveIdentity) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const next = await updateEmailSettings(supabase, {
        sender_name: senderName.trim(),
        reply_to_email: replyTo.trim() || null,
        template_locale: locale,
        // Never flip enable from Initial Setup.
      });
      setSettings(next);
      setSenderName(next.sender_name);
      setReplyTo(next.reply_to_email ?? '');
      setLocale(next.template_locale);
      setSuccess(t('admin.emailIsSaved'));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  if (missing) {
    return (
      <AdminCard>
        <h3 className="text-sm font-semibold text-foreground">{t('admin.emailIsTitle')}</h3>
        <p className="mt-2 text-xs text-secondary">{t('admin.emailMigrationPending')}</p>
      </AdminCard>
    );
  }

  return (
    <AdminCard>
      <h3 className="mb-1 text-sm font-semibold text-foreground">{t('admin.emailIsTitle')}</h3>
      <p className="mb-3 text-xs text-secondary">{t('admin.emailIsLead')}</p>
      {error ? <AdminInlineAlert tone="danger">{error}</AdminInlineAlert> : null}
      {success ? <AdminInlineAlert tone="success">{success}</AdminInlineAlert> : null}
      {loading || !settings ? (
        <p className="text-sm text-muted">{t('admin.emailLoading')}</p>
      ) : (
        <form className="space-y-3" onSubmit={onSave}>
          <label className="block space-y-1">
            <span className="text-xs text-muted">{t('admin.emailSenderName')}</span>
            <input
              className={adminFieldClass}
              value={senderName}
              disabled={!canManage || saving}
              onChange={(e) => setSenderName(e.target.value)}
              maxLength={120}
              required
            />
          </label>
          <label className="block space-y-1">
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
          <p className="text-xs text-muted">{t('admin.emailIsVerifiedNote')}</p>
          <p className="text-xs text-muted">
            {t('admin.emailSendingFlag')}: email_enabled={String(settings.email_enabled)} ·
            sending_ready={String(settings.sending_ready)}
          </p>
          {!validation.ok ? (
            <p className="text-xs text-danger">{t('admin.emailIsValidationFailed')}</p>
          ) : null}
          <AdminPrimaryButton type="submit" disabled={!canManage || saving || !validation.canSaveIdentity}>
            {saving ? t('admin.emailSaving') : t('admin.emailIsSave')}
          </AdminPrimaryButton>
        </form>
      )}
    </AdminCard>
  );
}
