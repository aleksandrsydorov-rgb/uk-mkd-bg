'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import {
  AdminCard,
  AdminInlineAlert,
  adminFieldClass,
} from '@/components/admin/AdminUi';
import { NotificationPreferencesPanel } from '@/components/notifications/NotificationPreferencesPanel';
import {
  EMAIL_EVENT_CATALOG,
  catalogModuleKeys,
  isSecurityMandatory,
} from '@/lib/email/eventCatalog';
import {
  fetchAdminNotificationPolicy,
  setAdminNotificationEvent,
  setAdminNotificationModule,
} from '@/lib/email/notificationPrefsClient';
import { isMissingRpcError } from '@/lib/ownershipChange';

type Props = {
  supabase: SupabaseClient<Database>;
  t: (key: string, vars?: Record<string, string | number>) => string;
  canManage: boolean;
};

export function AdminNotificationPolicyPanel({ supabase, t, canManage }: Props) {
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [modules, setModules] = useState<Record<string, boolean>>({});
  const [events, setEvents] = useState<Record<string, boolean>>({});
  const [filterModule, setFilterModule] = useState<string>('all');

  const moduleKeys = useMemo(() => catalogModuleKeys().filter((k) => k !== 'email_test'), []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const policy = await fetchAdminNotificationPolicy(supabase);
      setModules(policy.modules);
      setEvents(policy.events);
      setMissing(false);
    } catch (err) {
      if (isMissingRpcError(err)) setMissing(true);
      else setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredEvents = useMemo(() => {
    return EMAIL_EVENT_CATALOG.filter((e) => {
      if (e.moduleKey === 'email_test') return false;
      if (filterModule !== 'all' && e.moduleKey !== filterModule) return false;
      return true;
    });
  }, [filterModule]);

  async function toggleModule(moduleKey: string, enabled: boolean) {
    if (!canManage) return;
    setError(null);
    setSuccess(null);
    try {
      const next = await setAdminNotificationModule(supabase, moduleKey, enabled);
      setModules(next.modules);
      setEvents(next.events);
      setSuccess(t('notify.adminSaved'));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function toggleEvent(eventKey: string, enabled: boolean) {
    if (!canManage) return;
    setError(null);
    setSuccess(null);
    try {
      const next = await setAdminNotificationEvent(supabase, eventKey, enabled);
      setModules(next.modules);
      setEvents(next.events);
      setSuccess(t('notify.adminSaved'));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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
    <section className="space-y-4">
      <div className="px-0.5">
        <h3 className="text-base font-semibold tracking-tight text-foreground">
          {t('notify.adminTitle')}
        </h3>
        <p className="mt-1 max-w-xl text-sm text-secondary">{t('notify.adminLead')}</p>
      </div>

      {error ? <AdminInlineAlert tone="danger">{error}</AdminInlineAlert> : null}
      {success ? <AdminInlineAlert tone="success">{success}</AdminInlineAlert> : null}

      <AdminCard>
        <h4 className="text-sm font-semibold text-foreground">{t('notify.complexModules')}</h4>
        <p className="mt-1 text-xs text-secondary">{t('notify.complexModulesHint')}</p>
        {loading ? (
          <p className="mt-3 text-sm text-muted">{t('notify.loading')}</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {moduleKeys.map((mk) => (
              <li key={mk} className="flex items-center justify-between gap-3 text-sm">
                <code className="text-foreground">{mk}</code>
                <label className="flex items-center gap-2 text-secondary">
                  <input
                    type="checkbox"
                    checked={modules[mk] !== false}
                    disabled={!canManage}
                    onChange={(e) => void toggleModule(mk, e.target.checked)}
                  />
                  {t('notify.enabled')}
                </label>
              </li>
            ))}
          </ul>
        )}
      </AdminCard>

      <AdminCard>
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h4 className="text-sm font-semibold text-foreground">{t('notify.complexEvents')}</h4>
            <p className="mt-1 text-xs text-secondary">{t('notify.complexEventsHint')}</p>
          </div>
          <label className="space-y-1 text-xs text-muted">
            <span>{t('notify.filterModule')}</span>
            <select
              className={adminFieldClass}
              value={filterModule}
              onChange={(e) => setFilterModule(e.target.value)}
            >
              <option value="all">{t('notify.allModules')}</option>
              {moduleKeys.map((mk) => (
                <option key={mk} value={mk}>
                  {mk}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="mt-3 max-h-80 overflow-auto">
          <table className="min-w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-muted">
                <th className="py-2 pr-2">{t('notify.colEvent')}</th>
                <th className="py-2 pr-2">{t('notify.colImportance')}</th>
                <th className="py-2 pr-2">{t('notify.colProducer')}</th>
                <th className="py-2">{t('notify.enabled')}</th>
              </tr>
            </thead>
            <tbody>
              {filteredEvents.map((ev) => {
                const locked = isSecurityMandatory(ev.eventKey);
                const enabled = locked ? true : events[ev.eventKey] !== false;
                return (
                  <tr key={ev.eventKey} className="border-b border-border/70">
                    <td className="py-2 pr-2">
                      <code className="text-xs">{ev.eventKey}</code>
                      <span className="mt-0.5 block text-[10px] text-muted">{ev.moduleKey}</span>
                    </td>
                    <td className="py-2 pr-2 text-xs">{ev.importance}</td>
                    <td className="py-2 pr-2 text-xs text-muted">{ev.producerStatus}</td>
                    <td className="py-2">
                      <input
                        type="checkbox"
                        checked={enabled}
                        disabled={!canManage || locked}
                        onChange={(e) => void toggleEvent(ev.eventKey, e.target.checked)}
                        title={locked ? t('notify.lockedSecurity') : undefined}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </AdminCard>

      <AdminCard>
        <NotificationPreferencesPanel
          supabase={supabase}
          t={t}
          roleHint="admin"
          compact
        />
      </AdminCard>
    </section>
  );
}
