'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { useI18n } from '@/i18n/I18nProvider';
import { toUserFacingMessage } from '@/lib/userFacingError';
import {
  AdminCard,
  AdminInlineAlert,
  AdminPageHeader,
  AdminPrimaryButton,
  AdminDangerButton,
  AdminToggle,
  adminBtnSecondaryClass,
  adminFieldClass,
} from '@/components/admin/AdminUi';
import { SectionPanelTabs } from '@/components/ui/SectionPanelTabs';
import { NotificationPreferencesPanel } from '@/components/notifications/NotificationPreferencesPanel';
import {
  EMAIL_EVENT_CATALOG,
  isSecurityMandatory,
} from '@/lib/email/eventCatalog';
import {
  fetchAdminNotificationPolicy,
  setAdminNotificationEvent,
  setAdminNotificationModule,
} from '@/lib/email/notificationPrefsClient';
import {
  NOTIFY_SETTINGS_GROUPS,
  emailHistorySkipReasonFromRow,
  emailHistoryStatusLabelKey,
  emailHistoryUserStatus,
  type EmailHistoryUserStatus,
  type NotifySettingsGroupId,
} from '@/lib/email/historyStatus';
import {
  enqueueAllowlistedTestEmail,
  fetchEmailSettings,
  listEmailHistory,
  updateEmailSettings,
  type ComplexEmailSettings,
  type EmailConnectionStatus,
  type EmailHistoryRow,
  type EmailTemplateLocale,
} from '@/lib/emailCore';
import { isMissingRpcError } from '@/lib/ownershipChange';
import { LayoutDashboard, Settings2, History } from 'lucide-react';

export const NOTIFICATIONS_TABS = ['overview', 'settings', 'history'] as const;
export type NotificationsTabId = (typeof NOTIFICATIONS_TABS)[number];

export function parseNotificationsTab(raw: string | null | undefined): NotificationsTabId {
  const v = String(raw ?? '').trim();
  if ((NOTIFICATIONS_TABS as readonly string[]).includes(v)) return v as NotificationsTabId;
  return 'overview';
}

type Props = {
  supabase: SupabaseClient<Database>;
  canManage: boolean;
  activeTab: NotificationsTabId;
  onTabChange: (tab: NotificationsTabId) => void;
  onRegisterLeaveGuard?: (guard: ((nextSection: string) => boolean) | null) => void;
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

function eventSubjectLabel(
  row: EmailHistoryRow,
  t: (key: string, vars?: Record<string, string | number>) => string
) {
  const fromTpl = `notify.event.${row.template_key}`;
  const tplLabel = t(fromTpl);
  if (tplLabel !== fromTpl) return tplLabel;
  const moduleTitleKey = `notify.module.${row.module_key}`;
  const mod = t(moduleTitleKey);
  if (mod !== moduleTitleKey) return mod;
  return t('admin.emailModuleOther');
}

function formatWhen(iso: string, locale: string) {
  try {
    return new Intl.DateTimeFormat(locale === 'bg' ? 'bg-BG' : locale === 'en' ? 'en-GB' : 'ru-RU', {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function AdminNotificationsWorkplace({
  supabase,
  canManage,
  activeTab,
  onTabChange,
  onRegisterLeaveGuard,
}: Props) {
  const { t, locale } = useI18n();
  const dirtyRef = useRef(false);
  const [policyDirty, setPolicyDirty] = useState(false);

  const markDirty = useCallback((next: boolean) => {
    dirtyRef.current = next;
    setPolicyDirty(next);
  }, []);

  useEffect(() => {
    if (!onRegisterLeaveGuard) return;
    onRegisterLeaveGuard((nextSection) => {
      if (nextSection === 'уведомления') return true;
      if (!dirtyRef.current) return true;
      return window.confirm(t('common.discardChangesBody'));
    });
    return () => onRegisterLeaveGuard(null);
  }, [onRegisterLeaveGuard, t]);

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  const requestTabChange = useCallback(
    (tab: NotificationsTabId) => {
      if (tab === activeTab) return;
      if (dirtyRef.current && !window.confirm(t('common.discardChangesBody'))) return;
      if (dirtyRef.current) markDirty(false);
      onTabChange(tab);
    },
    [activeTab, markDirty, onTabChange, t]
  );

  const tabs = useMemo(
    () => [
      {
        id: 'overview' as const,
        label: t('admin.notifyTabOverview'),
        icon: LayoutDashboard,
        href: `/admin?section=${encodeURIComponent('уведомления')}&tab=overview`,
      },
      {
        id: 'settings' as const,
        label: t('admin.notifyTabSettings'),
        icon: Settings2,
        href: `/admin?section=${encodeURIComponent('уведомления')}&tab=settings`,
      },
      {
        id: 'history' as const,
        label: t('admin.notifyTabHistory'),
        icon: History,
        href: `/admin?section=${encodeURIComponent('уведомления')}&tab=history`,
      },
    ],
    [t]
  );

  return (
    <div className="min-w-0 space-y-4">
      <AdminPageHeader title={t('admin.notifySectionTitle')} secondary={t('admin.notifySectionLead')} />
      <div className="min-w-0 overflow-x-auto">
        <SectionPanelTabs
          aria-label={t('admin.notifySectionTitle')}
          value={activeTab}
          onChange={(id) => requestTabChange(parseNotificationsTab(id))}
          items={tabs}
        />
      </div>
      {activeTab === 'overview' ? (
        <NotificationsOverview
          supabase={supabase}
          canManage={canManage}
          onOpenHistory={() => requestTabChange('history')}
        />
      ) : null}
      {activeTab === 'settings' ? (
        <NotificationsSettings
          supabase={supabase}
          canManage={canManage}
          dirty={policyDirty}
          onDirtyChange={markDirty}
        />
      ) : null}
      {activeTab === 'history' ? (
        <NotificationsHistory supabase={supabase} canManage={canManage} />
      ) : null}
    </div>
  );
}

/* ─── Overview ─────────────────────────────────────────────────────────── */

function NotificationsOverview({
  supabase,
  canManage,
  onOpenHistory,
}: {
  supabase: SupabaseClient<Database>;
  canManage: boolean;
  onOpenHistory: () => void;
}) {
  const { t, locale } = useI18n();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [queuingTest, setQueuingTest] = useState(false);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [settings, setSettings] = useState<ComplexEmailSettings | null>(null);
  const [hostSendingEnabled, setHostSendingEnabled] = useState<boolean | null>(null);
  const [encryptionConfigured, setEncryptionConfigured] = useState<boolean | null>(null);
  const [recent, setRecent] = useState<EmailHistoryRow[]>([]);
  const [editing, setEditing] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const [senderEmail, setSenderEmail] = useState('');
  const [projectToken, setProjectToken] = useState('');
  const [complexName, setComplexName] = useState('AMADEUS 11');
  const [replyTo, setReplyTo] = useState('');
  const [templateLocale, setTemplateLocale] = useState<EmailTemplateLocale>('bg');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const s = await fetchEmailSettings(supabase);
      setSettings(s);
      setSenderEmail(s.sender_email ?? '');
      setReplyTo(s.reply_to_email ?? '');
      setTemplateLocale(s.template_locale ?? 'bg');
      setProjectToken('');
      setMissing(false);
      const connected = s.has_provider_token || s.email_enabled;
      setEditing(!connected);
      try {
        const nameRes = await supabase.rpc('admin_get_complex_display_name' as never);
        const name = nameRes.data as unknown;
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
        const page = await listEmailHistory(supabase, { limit: 5, offset: 0 });
        setRecent(page.rows);
      } catch {
        setRecent([]);
      }
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
      if (advancedOpen) {
        try {
          await updateEmailSettings(supabase, {
            reply_to_email: replyTo.trim() || null,
            template_locale: templateLocale,
          });
        } catch {
          /* advanced is best-effort; connection save is primary */
        }
      }
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
      };
      if (!res.ok || !body.ok) {
        if (body.error === 'host_sending_disabled') setError(t('admin.emailHostGateBlocked'));
        else if (body.error === 'encryption_key_not_configured')
          setError(t('admin.emailEncryptionMissing'));
        else if (body.error === 'invalid_sender_email') setError(t('admin.emailSenderInvalid'));
        else if (body.error === 'forbidden' || body.error === 'unauthorized')
          setError(t('admin.errForbidden'));
        else setError(t('admin.errGeneric'));
        return;
      }
      if (body.token_saved) {
        setSuccess(enable ? t('admin.emailSavedEnabledToken') : t('admin.emailTokenSavedDisabled'));
      } else if (enable) {
        setSuccess(t('admin.emailSavedEnabled'));
      } else {
        setSuccess(t('admin.emailDisabledOk'));
      }
      setProjectToken('');
      await load();
      if (enable) setEditing(false);
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

  const connected = Boolean(settings && (settings.has_provider_token || settings.email_enabled));
  const showForm = !connected || editing;

  if (missing) {
    return (
      <AdminCard>
        <h3 className="text-base font-semibold text-foreground">{t('admin.emailTitle')}</h3>
        <p className="mt-2 text-sm text-secondary">{t('admin.emailMigrationPending')}</p>
      </AdminCard>
    );
  }

  return (
    <div className="space-y-4">
      {error ? <AdminInlineAlert tone="danger">{error}</AdminInlineAlert> : null}
      {success ? <AdminInlineAlert tone="success">{success}</AdminInlineAlert> : null}

      <AdminCard>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="text-base font-semibold text-foreground">{t('admin.emailTitle')}</h3>
            <p className="mt-1 max-w-xl text-sm text-secondary">{t('admin.emailLeadLettermint')}</p>
          </div>
        </div>

        {loading || !settings ? (
          <p className="mt-3 text-sm text-muted">{t('admin.emailLoading')}</p>
        ) : (
          <div className="mt-4 space-y-3">
            <div className="rounded-lg border border-border bg-surface-secondary/40 px-3 py-2.5">
              <p className="text-xs uppercase tracking-wide text-muted">{t('admin.emailSystemStatus')}</p>
              <p className="mt-1 text-sm font-semibold text-foreground">
                {connectionStatusLabel(settings.connection_status, t)}
              </p>
              <ul className="mt-2 space-y-1 text-xs text-muted">
                <li>
                  {t('admin.emailProvider')}: {t('admin.emailProviderLettermint')}
                </li>
                {settings.sender_email ? (
                  <li>
                    {t('admin.emailSenderEmail')}: {settings.sender_email}
                  </li>
                ) : null}
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

            {showForm ? (
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  void saveConnection(true);
                }}
              >
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

                <details
                  className="rounded-lg border border-border px-3 py-2"
                  open={advancedOpen}
                  onToggle={(e) => setAdvancedOpen((e.target as HTMLDetailsElement).open)}
                >
                  <summary className="cursor-pointer text-sm font-medium text-foreground">
                    {t('admin.emailAdvancedSettings')}
                  </summary>
                  <div className="mt-3 space-y-3">
                    <label className="block space-y-1">
                      <span className="text-xs text-muted">{t('admin.emailReplyTo')}</span>
                      <input
                        className={adminFieldClass}
                        type="email"
                        value={replyTo}
                        disabled={!canManage || saving}
                        onChange={(e) => setReplyTo(e.target.value)}
                        autoComplete="off"
                      />
                    </label>
                    <label className="block space-y-1">
                      <span className="text-xs text-muted">{t('admin.emailLocale')}</span>
                      <select
                        className={adminFieldClass}
                        value={templateLocale}
                        disabled={!canManage || saving}
                        onChange={(e) => setTemplateLocale(e.target.value as EmailTemplateLocale)}
                      >
                        <option value="bg">{t('admin.emailLocaleBg')}</option>
                        <option value="ru">{t('admin.emailLocaleRu')}</option>
                        <option value="en">{t('admin.emailLocaleEn')}</option>
                      </select>
                    </label>
                  </div>
                </details>

                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                  <AdminPrimaryButton type="submit" disabled={!canSaveEnable}>
                    {saving ? t('admin.emailSaving') : t('admin.emailSaveEnable')}
                  </AdminPrimaryButton>
                  {connected ? (
                    <button
                      type="button"
                      className={adminBtnSecondaryClass}
                      disabled={saving}
                      onClick={() => {
                        setEditing(false);
                        setProjectToken('');
                        setSenderEmail(settings.sender_email ?? '');
                      }}
                    >
                      {t('common.cancel')}
                    </button>
                  ) : null}
                </div>
                <p className="text-xs text-muted">{t('admin.emailSaveDoesNotSend')}</p>
              </form>
            ) : (
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                <AdminPrimaryButton
                  type="button"
                  disabled={!canManage || queuingTest || !settings.email_enabled}
                  onClick={() => void onQueueTest()}
                >
                  {queuingTest ? t('admin.emailTestQueuing') : t('admin.emailTestSendAdmin')}
                </AdminPrimaryButton>
                <button
                  type="button"
                  className={adminBtnSecondaryClass}
                  disabled={!canManage}
                  onClick={() => setEditing(true)}
                >
                  {t('admin.emailEditConnection')}
                </button>
                <AdminDangerButton
                  type="button"
                  disabled={!canManage || saving || !settings.email_enabled}
                  onClick={() => void saveConnection(false)}
                >
                  {t('admin.emailDisableSending')}
                </AdminDangerButton>
              </div>
            )}
          </div>
        )}
      </AdminCard>

      <AdminCard>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-sm font-semibold text-foreground">{t('admin.emailRecentSends')}</h4>
          <button type="button" className="text-sm font-medium text-accent" onClick={onOpenHistory}>
            {t('admin.emailAllHistory')} →
          </button>
        </div>
        {recent.length === 0 ? (
          <p className="mt-2 text-sm text-muted">{t('admin.emailDiagnosticsEmpty')}</p>
        ) : (
          <ul className="mt-3 divide-y divide-border/70">
            {recent.map((row) => {
              const st = emailHistoryUserStatus({
                status: row.status,
                latestEventType: row.latest_event_type,
                lastErrorCode: row.last_error_code,
                userStatus: row.user_status,
              });
              return (
                <li key={row.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-foreground">
                      {row.recipient_name || row.to_email || row.to_masked || '—'}
                    </p>
                    <p className="truncate text-xs text-muted">{eventSubjectLabel(row, t)}</p>
                  </div>
                  <div className="text-right text-xs text-secondary">
                    <p>{t(emailHistoryStatusLabelKey(st))}</p>
                    <p className="text-muted">{formatWhen(row.created_at, locale)}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </AdminCard>
    </div>
  );
}

/* ─── Settings ─────────────────────────────────────────────────────────── */

function NotificationsSettings({
  supabase,
  canManage,
  dirty,
  onDirtyChange,
}: {
  supabase: SupabaseClient<Database>;
  canManage: boolean;
  dirty: boolean;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [modules, setModules] = useState<Record<string, boolean>>({});
  const [events, setEvents] = useState<Record<string, boolean>>({});
  const [baselineModules, setBaselineModules] = useState<Record<string, boolean>>({});
  const [baselineEvents, setBaselineEvents] = useState<Record<string, boolean>>({});
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const policy = await fetchAdminNotificationPolicy(supabase);
      setModules(policy.modules);
      setEvents(policy.events);
      setBaselineModules(policy.modules);
      setBaselineEvents(policy.events);
      onDirtyChange(false);
      setMissing(false);
    } catch (err) {
      if (isMissingRpcError(err)) setMissing(true);
      else setError(toUserFacingMessage(err, t, { fallback: t('admin.errGeneric') }));
    } finally {
      setLoading(false);
    }
  }, [onDirtyChange, supabase, t]);

  useEffect(() => {
    void load();
  }, [load]);

  function syncDirty(
    nextModules: Record<string, boolean>,
    nextEvents: Record<string, boolean>
  ) {
    const modDirty = JSON.stringify(nextModules) !== JSON.stringify(baselineModules);
    const evDirty = JSON.stringify(nextEvents) !== JSON.stringify(baselineEvents);
    onDirtyChange(modDirty || evDirty);
  }

  function groupState(groupId: NotifySettingsGroupId): 'on' | 'off' | 'mixed' {
    const group = NOTIFY_SETTINGS_GROUPS.find((g) => g.id === groupId);
    if (!group) return 'off';
    const relevant = EMAIL_EVENT_CATALOG.filter(
      (e) =>
        (group.moduleKeys as readonly string[]).includes(e.moduleKey) &&
        e.moduleKey !== 'email_test' &&
        !isSecurityMandatory(e.eventKey)
    );
    if (relevant.length === 0) {
      const modVals = group.moduleKeys.map((mk) => modules[mk] !== false);
      if (modVals.every(Boolean)) return 'on';
      if (modVals.every((v) => !v)) return 'off';
      return 'mixed';
    }
    const vals = relevant.map((e) => {
      if (modules[e.moduleKey] === false) return false;
      return events[e.eventKey] !== false;
    });
    if (vals.every(Boolean)) return 'on';
    if (vals.every((v) => !v)) return 'off';
    return 'mixed';
  }

  function setGroupEnabled(groupId: NotifySettingsGroupId, enabled: boolean) {
    if (!canManage) return;
    const group = NOTIFY_SETTINGS_GROUPS.find((g) => g.id === groupId);
    if (!group) return;
    const nextModules = { ...modules };
    const nextEvents = { ...events };
    for (const mk of group.moduleKeys) {
      nextModules[mk] = enabled;
    }
    for (const e of EMAIL_EVENT_CATALOG) {
      if (!(group.moduleKeys as readonly string[]).includes(e.moduleKey)) continue;
      if (isSecurityMandatory(e.eventKey)) continue;
      nextEvents[e.eventKey] = enabled;
    }
    setModules(nextModules);
    setEvents(nextEvents);
    setSuccess(null);
    syncDirty(nextModules, nextEvents);
  }

  function setEventEnabled(eventKey: string, enabled: boolean) {
    if (!canManage || isSecurityMandatory(eventKey)) return;
    const next = { ...events, [eventKey]: enabled };
    setEvents(next);
    setSuccess(null);
    syncDirty(modules, next);
  }

  async function saveAll() {
    if (!canManage || !dirty) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      let nextModules = { ...modules };
      let nextEvents = { ...events };
      for (const mk of Object.keys(modules)) {
        if ((baselineModules[mk] !== false) !== (modules[mk] !== false)) {
          const res = await setAdminNotificationModule(supabase, mk, modules[mk] !== false);
          nextModules = res.modules;
          nextEvents = { ...nextEvents, ...res.events };
        }
      }
      for (const ek of Object.keys(events)) {
        if (isSecurityMandatory(ek)) continue;
        if ((baselineEvents[ek] !== false) !== (events[ek] !== false)) {
          const res = await setAdminNotificationEvent(supabase, ek, events[ek] !== false);
          nextModules = res.modules;
          nextEvents = res.events;
        }
      }
      setModules(nextModules);
      setEvents(nextEvents);
      setBaselineModules(nextModules);
      setBaselineEvents(nextEvents);
      onDirtyChange(false);
      setSuccess(t('notify.adminSaved'));
    } catch (err) {
      setError(toUserFacingMessage(err, t, { fallback: t('admin.errGeneric') }));
    } finally {
      setSaving(false);
    }
  }

  if (missing) {
    return (
      <AdminCard>
        <h3 className="text-base font-semibold text-foreground">{t('notify.adminTitle')}</h3>
        <p className="mt-2 text-sm text-secondary">{t('notify.migrationPending')}</p>
      </AdminCard>
    );
  }

  return (
    <div className="space-y-4">
      <AdminInlineAlert tone="info">{t('admin.notifyAfterRegistrationHint')}</AdminInlineAlert>
      {error ? <AdminInlineAlert tone="danger">{error}</AdminInlineAlert> : null}
      {success ? <AdminInlineAlert tone="success">{success}</AdminInlineAlert> : null}

      <AdminCard>
        <h3 className="text-base font-semibold text-foreground">{t('admin.notifyComplexTitle')}</h3>
        <p className="mt-1 text-sm text-secondary">{t('admin.notifyComplexLead')}</p>
        <p className="mt-2 text-xs text-muted">{t('admin.notifyPersonalOptOutHint')}</p>

        {loading ? (
          <p className="mt-3 text-sm text-muted">{t('notify.loading')}</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {NOTIFY_SETTINGS_GROUPS.map((group) => {
              const st = groupState(group.id);
              const open = openGroups[group.id] === true;
              const groupEvents = EMAIL_EVENT_CATALOG.filter(
                (e) =>
                  (group.moduleKeys as readonly string[]).includes(e.moduleKey) &&
                  e.moduleKey !== 'email_test'
              );
              return (
                <li key={group.id} className="rounded-lg border border-border px-3 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      onClick={() =>
                        setOpenGroups((prev) => ({ ...prev, [group.id]: !open }))
                      }
                    >
                      <p className="text-sm font-semibold text-foreground">
                        {t(`admin.notifyGroup_${group.id}`)}
                      </p>
                      <p className="mt-0.5 text-xs text-secondary">
                        {t(`admin.notifyGroupLead_${group.id}`)}
                      </p>
                      <p className="mt-1 text-xs text-muted">
                        {t('admin.notifyChannelEmail')}
                        {st === 'mixed' ? ` · ${t('admin.notifyGroupMixed')}` : ''}
                      </p>
                    </button>
                    <div className="flex items-center gap-2">
                      {st === 'mixed' ? (
                        <span className="text-xs text-muted">{t('admin.notifyGroupMixed')}</span>
                      ) : null}
                      <AdminToggle
                        checked={st === 'on'}
                        label={t(`admin.notifyGroup_${group.id}`)}
                        disabled={!canManage}
                        onChange={(next) => setGroupEnabled(group.id, next)}
                      />
                    </div>
                  </div>
                  {open ? (
                    <ul className="mt-3 space-y-2 border-t border-border/70 pt-3">
                      {groupEvents.map((ev) => {
                        const locked = isSecurityMandatory(ev.eventKey);
                        const enabled =
                          locked ||
                          (modules[ev.moduleKey] !== false && events[ev.eventKey] !== false);
                        return (
                          <li
                            key={ev.eventKey}
                            className="flex items-center justify-between gap-3 text-sm"
                          >
                            <span className="min-w-0 text-foreground">
                              {t(`notify.event.${ev.eventKey}`)}
                              {locked ? (
                                <span className="ml-2 text-xs text-muted">
                                  ({t('notify.lockedSecurity')})
                                </span>
                              ) : null}
                            </span>
                            <input
                              type="checkbox"
                              checked={enabled}
                              disabled={!canManage || locked}
                              onChange={(e) => setEventEnabled(ev.eventKey, e.target.checked)}
                            />
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <AdminPrimaryButton
            type="button"
            disabled={!canManage || !dirty || saving}
            onClick={() => void saveAll()}
          >
            {saving ? t('notify.saving') : t('admin.notifySaveChanges')}
          </AdminPrimaryButton>
        </div>
      </AdminCard>

      <AdminCard>
        <h4 className="text-sm font-semibold text-foreground">{t('admin.notifyPersonalTitle')}</h4>
        <p className="mt-1 text-xs text-secondary">{t('admin.notifyPersonalLead')}</p>
        <div className="mt-3">
          <NotificationPreferencesPanel
            supabase={supabase}
            t={t}
            roleHint="admin"
            compact
          />
        </div>
      </AdminCard>
    </div>
  );
}

/* ─── History ──────────────────────────────────────────────────────────── */

function NotificationsHistory({
  supabase,
  canManage,
}: {
  supabase: SupabaseClient<Database>;
  canManage: boolean;
}) {
  const { t, locale } = useI18n();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<EmailHistoryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [query, setQuery] = useState('');
  const [queryDraft, setQueryDraft] = useState('');
  const [status, setStatus] = useState<'all' | EmailHistoryUserStatus>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const pageSize = 20;

  const load = useCallback(async () => {
    if (!canManage) {
      setLoading(false);
      setRows([]);
      setTotal(0);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const pageData = await listEmailHistory(supabase, {
        limit: pageSize,
        offset: page * pageSize,
        query,
        status,
        from: from ? new Date(`${from}T00:00:00`).toISOString() : null,
        to: to ? new Date(`${to}T23:59:59`).toISOString() : null,
      });
      setRows(pageData.rows);
      setTotal(pageData.total);
    } catch (err) {
      if (isMissingRpcError(err)) {
        // Fallback: empty until migration applied
        setRows([]);
        setTotal(0);
      } else {
        setError(toUserFacingMessage(err, t, { fallback: t('admin.errGeneric') }));
      }
    } finally {
      setLoading(false);
    }
  }, [canManage, from, page, query, status, supabase, t, to]);

  useEffect(() => {
    void load();
  }, [load]);

  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  if (!canManage) {
    return (
      <AdminCard>
        <p className="text-sm text-muted">{t('admin.errForbidden')}</p>
      </AdminCard>
    );
  }

  return (
    <div className="space-y-4">
      {error ? <AdminInlineAlert tone="danger">{error}</AdminInlineAlert> : null}
      <AdminCard>
        <h3 className="text-base font-semibold text-foreground">{t('admin.notifyHistoryTitle')}</h3>
        <p className="mt-1 text-sm text-secondary">{t('admin.notifyHistoryLead')}</p>

        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block space-y-1 sm:col-span-2">
            <span className="text-xs text-muted">{t('admin.emailHistSearch')}</span>
            <div className="flex gap-2">
              <input
                className={adminFieldClass}
                value={queryDraft}
                onChange={(e) => setQueryDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    setPage(0);
                    setQuery(queryDraft.trim());
                  }
                }}
                placeholder={t('admin.emailHistSearchPlaceholder')}
              />
              <button
                type="button"
                className={adminBtnSecondaryClass}
                onClick={() => {
                  setPage(0);
                  setQuery(queryDraft.trim());
                }}
              >
                {t('common.search')}
              </button>
            </div>
          </label>
          <label className="block space-y-1">
            <span className="text-xs text-muted">{t('admin.emailHistStatusFilter')}</span>
            <select
              className={adminFieldClass}
              value={status}
              onChange={(e) => {
                setPage(0);
                setStatus(e.target.value as typeof status);
              }}
            >
              <option value="all">{t('admin.emailFilterAll')}</option>
              <option value="awaiting">{t('admin.emailHistAwaiting')}</option>
              <option value="accepted">{t('admin.emailHistAccepted')}</option>
              <option value="delivered">{t('admin.emailHistDelivered')}</option>
              <option value="failed">{t('admin.emailHistFailed')}</option>
              <option value="skipped">{t('admin.emailHistSkipped')}</option>
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block space-y-1">
              <span className="text-xs text-muted">{t('admin.emailHistFrom')}</span>
              <input
                className={adminFieldClass}
                type="date"
                value={from}
                onChange={(e) => {
                  setPage(0);
                  setFrom(e.target.value);
                }}
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs text-muted">{t('admin.emailHistTo')}</span>
              <input
                className={adminFieldClass}
                type="date"
                value={to}
                onChange={(e) => {
                  setPage(0);
                  setTo(e.target.value);
                }}
              />
            </label>
          </div>
        </div>

        {loading ? (
          <p className="mt-4 text-sm text-muted">{t('notify.loading')}</p>
        ) : rows.length === 0 ? (
          <p className="mt-4 text-sm text-muted">{t('admin.emailDiagnosticsEmpty')}</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-wide text-muted">
                  <th className="py-2 pr-3">{t('admin.emailDiagWhen')}</th>
                  <th className="py-2 pr-3">{t('admin.emailHistRecipient')}</th>
                  <th className="py-2 pr-3">{t('admin.emailHistSubject')}</th>
                  <th className="py-2">{t('admin.emailDiagStatus')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const st = emailHistoryUserStatus({
                    status: row.status,
                    latestEventType: row.latest_event_type,
                    lastErrorCode: row.last_error_code,
                    userStatus: row.user_status,
                  });
                  const skipKey = emailHistorySkipReasonFromRow({
                    status: row.status,
                    lastErrorCode: row.last_error_code,
                  });
                  const open = expandedId === row.id;
                  return (
                    <Fragment key={row.id}>
                      <tr
                        className="cursor-pointer border-b border-border/70 hover:bg-hover/30"
                        onClick={() => setExpandedId(open ? null : row.id)}
                      >
                        <td className="py-2 pr-3 whitespace-nowrap text-xs text-muted">
                          {formatWhen(row.created_at, locale)}
                        </td>
                        <td className="py-2 pr-3">
                          <p className="font-medium text-foreground">
                            {row.recipient_name || '—'}
                          </p>
                          <p className="text-xs text-secondary">{row.to_email || row.to_masked || '—'}</p>
                          {row.apartment_label ? (
                            <p className="text-xs text-muted">{row.apartment_label}</p>
                          ) : null}
                        </td>
                        <td className="py-2 pr-3">{eventSubjectLabel(row, t)}</td>
                        <td className="py-2">
                          <p>{t(emailHistoryStatusLabelKey(st))}</p>
                          {st === 'skipped' && skipKey ? (
                            <p className="text-xs text-muted">{t(skipKey)}</p>
                          ) : null}
                        </td>
                      </tr>
                      {open ? (
                        <tr className="border-b border-border/70 bg-surface-secondary/30">
                          <td colSpan={4} className="px-3 py-3 text-xs text-secondary">
                            <p>
                              {t('admin.emailHistAttempts')}: {row.attempts}
                            </p>
                            {row.event_occurred_at ? (
                              <p>
                                {t('admin.emailHistEventTime')}:{' '}
                                {formatWhen(row.event_occurred_at, locale)}
                              </p>
                            ) : null}
                            <details className="mt-2">
                              <summary className="cursor-pointer font-medium text-foreground">
                                {t('admin.emailHistTechDetails')}
                              </summary>
                              <p className="mt-1 text-muted">
                                {t('admin.emailHistTechHint')}
                              </p>
                            </details>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm">
          <p className="text-muted">
            {t('admin.emailHistPage', {
              page: page + 1,
              pages: pageCount,
              total,
            })}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              className={adminBtnSecondaryClass}
              disabled={page <= 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              {t('admin.emailHistPrev')}
            </button>
            <button
              type="button"
              className={adminBtnSecondaryClass}
              disabled={page + 1 >= pageCount}
              onClick={() => setPage((p) => p + 1)}
            >
              {t('admin.emailHistNext')}
            </button>
          </div>
        </div>
      </AdminCard>
    </div>
  );
}
