'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import {
  EMAIL_EVENT_CATALOG,
  NOTIFICATION_MODES,
  SUGGESTED_ADMIN_NOTIFICATION_MODE,
  isSecurityMandatory,
  type NotificationMode,
} from '@/lib/email/eventCatalog';
import { previewEffectiveEvent } from '@/lib/email/notificationPolicy';
import {
  fetchMyNotificationPrefs,
  saveMyNotificationPrefs,
} from '@/lib/email/notificationPrefsClient';
import { isMissingRpcError } from '@/lib/ownershipChange';

type Props = {
  supabase: SupabaseClient<Database>;
  t: (key: string, vars?: Record<string, string | number>) => string;
  roleHint?: 'admin' | 'staff' | 'owner';
  compact?: boolean;
};

export function NotificationPreferencesPanel({
  supabase,
  t,
  roleHint = 'owner',
  compact = false,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [mode, setMode] = useState<NotificationMode>('ALL');
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [complexModules, setComplexModules] = useState<Record<string, boolean>>({});
  const [complexEvents, setComplexEvents] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const prefs = await fetchMyNotificationPrefs(supabase);
      setMode(prefs.personal.mode);
      setOverrides(prefs.personal.eventOverrides);
      setComplexModules(prefs.complex.modules);
      setComplexEvents(prefs.complex.events);
      setMissing(false);
    } catch (err) {
      if (isMissingRpcError(err)) {
        setMissing(true);
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

  const visibleEvents = useMemo(
    () =>
      EMAIL_EVENT_CATALOG.filter(
        (e) => e.producerStatus === 'wired' || e.producerStatus === 'informational_meeting'
      ),
    []
  );

  const previews = useMemo(() => {
    return visibleEvents.map((ev) =>
      previewEffectiveEvent({
        eventKey: ev.eventKey,
        complex: { modules: complexModules, events: complexEvents },
        personal: { mode, eventOverrides: overrides, role: roleHint },
      })
    );
  }, [visibleEvents, complexModules, complexEvents, mode, overrides, roleHint]);

  async function onSave() {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const next = await saveMyNotificationPrefs(supabase, {
        mode,
        roleHint,
        eventOverrides: mode === 'CUSTOM' ? overrides : undefined,
      });
      setMode(next.personal.mode);
      setOverrides(next.personal.eventOverrides);
      setComplexModules(next.complex.modules);
      setComplexEvents(next.complex.events);
      setSuccess(t('notify.prefsSaved'));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  if (missing) {
    return (
      <div className="rounded-lg border border-border p-4 text-sm text-secondary">
        {t('notify.migrationPending')}
      </div>
    );
  }

  return (
    <div className={`space-y-4 ${compact ? '' : ''}`}>
      <div>
        <h3 className="text-base font-semibold text-foreground">{t('notify.prefsTitle')}</h3>
        <p className="mt-1 text-sm text-secondary">{t('notify.prefsLead')}</p>
        {roleHint === 'admin' ? (
          <p className="mt-1 text-xs text-muted">
            {t('notify.adminModeHint', { mode: SUGGESTED_ADMIN_NOTIFICATION_MODE })}
          </p>
        ) : null}
      </div>

      {error ? (
        <p className="rounded-lg border border-danger/30 bg-danger-bg px-3 py-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
      {success ? (
        <p className="rounded-lg border border-border px-3 py-2 text-sm text-foreground">{success}</p>
      ) : null}

      {loading ? (
        <p className="text-sm text-muted">{t('notify.loading')}</p>
      ) : (
        <>
          <label className="block space-y-1">
            <span className="text-xs text-muted">{t('notify.modeLabel')}</span>
            <select
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
              value={mode}
              disabled={saving}
              onChange={(e) => setMode(e.target.value as NotificationMode)}
            >
              {NOTIFICATION_MODES.map((m) => (
                <option key={m} value={m}>
                  {t(`notify.mode.${m}` as 'notify.mode.ALL')}
                </option>
              ))}
            </select>
          </label>

          {mode === 'CUSTOM' ? (
            <div className="space-y-2 rounded-lg border border-border p-3">
              <p className="text-xs font-medium text-foreground">{t('notify.customEvents')}</p>
              {visibleEvents.map((ev) => {
                const locked = isSecurityMandatory(ev.eventKey);
                const complexOff =
                  complexModules[ev.moduleKey] === false || complexEvents[ev.eventKey] === false;
                return (
                  <label
                    key={ev.eventKey}
                    className="flex items-start gap-2 text-sm text-secondary"
                  >
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={locked ? true : overrides[ev.eventKey] !== false}
                      disabled={saving || locked || complexOff}
                      onChange={(e) =>
                        setOverrides((prev) => ({
                          ...prev,
                          [ev.eventKey]: e.target.checked,
                        }))
                      }
                    />
                    <span>
                      <span className="font-mono text-xs text-foreground">{ev.eventKey}</span>
                      {locked ? (
                        <span className="ml-2 text-xs text-muted">{t('notify.lockedSecurity')}</span>
                      ) : null}
                      {complexOff ? (
                        <span className="ml-2 text-xs text-danger">{t('notify.disabledByAdmin')}</span>
                      ) : null}
                    </span>
                  </label>
                );
              })}
            </div>
          ) : null}

          <div className="space-y-2 rounded-lg border border-border p-3">
            <p className="text-xs font-medium text-foreground">{t('notify.effectivePreview')}</p>
            <ul className="max-h-56 space-y-1 overflow-auto text-xs text-secondary">
              {previews.map((p) => (
                <li key={p.eventKey} className="flex flex-wrap gap-x-2">
                  <code className="text-foreground">{p.eventKey}</code>
                  <span>{p.effective}</span>
                  {p.lockedSecurity ? <span>({t('notify.lockedSecurity')})</span> : null}
                  {p.blockedByComplex ? <span className="text-danger">{t('notify.disabledByAdmin')}</span> : null}
                </li>
              ))}
            </ul>
          </div>

          <button
            type="button"
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg disabled:opacity-50"
            disabled={saving}
            onClick={() => void onSave()}
          >
            {saving ? t('notify.saving') : t('notify.save')}
          </button>
        </>
      )}
    </div>
  );
}
