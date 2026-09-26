'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { useI18n } from '@/i18n/I18nProvider';
import { formatOwnerDate } from '@/lib/ownerFormat';
import { ownerVisibleError } from '@/lib/ownerError';
import { isMissingRelation } from '@/lib/polls';
import {
  SERVICE_LOCK_FUTURE_SCOPES,
  SERVICE_LOCK_LIVE_SCOPES,
  canSeeServiceLockAdmin,
  firstServiceLock,
  formatServiceLockScopes,
  type PropertyServiceLockEventRow,
  type PropertyServiceLockListRow,
  type PropertyServiceLockView,
  type ServiceLockScope,
} from '@/lib/serviceLock';
import { mapAdminRpcError } from '@/lib/utilities';
import {
  AdminPageHeader,
  AdminEmptyState,
  AdminInlineAlert,
  AdminPrimaryButton,
  AdminSecondaryButton,
  AdminTableShell,
  adminCardClass,
  adminFieldClass,
  adminTableCellClass,
  adminTableHeadRowClass,
  adminTableRowClass,
} from '@/components/admin/AdminUi';
import { ApartmentCombobox } from '@/components/admin/ApartmentCombobox';
import { StatusBadge } from '@/components/account/ownerUi';

type PropertyOption = {
  id: number;
  apartment_number: string | number | null;
  owner_name: string | null;
};

function aptNumber(value: string | number | null | undefined) {
  return String(value ?? '');
}

export function AdminServiceLock({
  supabase,
  properties,
  staffRole,
}: {
  supabase: SupabaseClient<Database>;
  properties: PropertyOption[];
  staffRole: string;
}) {
  const { t, locale } = useI18n();
  const canSee = canSeeServiceLockAdmin(staffRole);

  const sorted = useMemo(
    () =>
      [...properties].sort((a, b) =>
        aptNumber(a.apartment_number).localeCompare(aptNumber(b.apartment_number), undefined, { numeric: true }),
      ),
    [properties],
  );

  const [propertyId, setPropertyId] = useState<number | ''>('');
  const [lock, setLock] = useState<PropertyServiceLockView>({
    active: false,
    reason_code: null,
    locked_at: null,
    admin_note: null,
    scopes: [],
  });
  const [activeLocks, setActiveLocks] = useState<PropertyServiceLockListRow[]>([]);
  const [history, setHistory] = useState<PropertyServiceLockEventRow[]>([]);
  const [note, setNote] = useState('');
  const [selectedScopes, setSelectedScopes] = useState<ServiceLockScope[]>(['all']);
  const [loading, setLoading] = useState(false);
  const [listLoading, setListLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const scopeLabel = useCallback(
    (key: string) => {
      const i18nKey = `admin.serviceLockScope_${key}` as const;
      const translated = t(i18nKey);
      return translated === i18nKey ? key : translated;
    },
    [t],
  );

  function toggleScope(key: ServiceLockScope) {
    setSelectedScopes((prev) => {
      if (key === 'all') {
        return prev.includes('all') ? [] : ['all'];
      }
      const withoutAll = prev.filter((s) => s !== 'all');
      if (withoutAll.includes(key)) {
        return withoutAll.filter((s) => s !== key);
      }
      return [...withoutAll, key];
    });
  }

  const loadList = useCallback(async () => {
    setListLoading(true);
    try {
      const { data, error: rpcErr } = await supabase.rpc('list_property_service_locks');
      if (rpcErr) {
        if (isMissingRelation(rpcErr, 'list_property_service_locks')) {
          setActiveLocks([]);
          return;
        }
        throw rpcErr;
      }
      setActiveLocks((data as PropertyServiceLockListRow[] | null) ?? []);
    } catch (e: unknown) {
      setError(ownerVisibleError(e, t('admin.errGeneric')));
      setActiveLocks([]);
    } finally {
      setListLoading(false);
    }
  }, [supabase, t]);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const { data, error: rpcErr } = await supabase.rpc('list_property_service_lock_events', {
        p_property_id: typeof propertyId === 'number' ? propertyId : null,
        p_limit: 100,
      });
      if (rpcErr) {
        if (isMissingRelation(rpcErr, 'list_property_service_lock_events')) {
          setHistory([]);
          return;
        }
        throw rpcErr;
      }
      setHistory((data as PropertyServiceLockEventRow[] | null) ?? []);
    } catch (e: unknown) {
      setError(ownerVisibleError(e, t('admin.errGeneric')));
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, [propertyId, supabase, t]);

  const loadProperty = useCallback(async () => {
    if (!propertyId) {
      setLock({ active: false, reason_code: null, locked_at: null, admin_note: null, scopes: [] });
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcErr } = await supabase.rpc('get_property_service_lock', {
        p_property_id: propertyId,
      });
      if (rpcErr) throw rpcErr;
      setLock(firstServiceLock(data as PropertyServiceLockView[] | null));
    } catch (e: unknown) {
      setError(ownerVisibleError(e, t('admin.errGeneric')));
      setLock({ active: false, reason_code: null, locked_at: null, admin_note: null, scopes: [] });
    } finally {
      setLoading(false);
    }
  }, [propertyId, supabase, t]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    void loadProperty();
  }, [loadProperty]);

  async function refreshAfterMutation() {
    await Promise.all([loadProperty(), loadList(), loadHistory()]);
  }

  async function handleLock() {
    if (!propertyId) return;
    if (selectedScopes.length === 0) {
      setError(t('admin.serviceLockScopesRequired'));
      return;
    }
    if (!confirm(t('admin.serviceLockConfirm'))) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const { error: rpcErr } = await supabase.rpc('admin_lock_property_services', {
        p_property_id: propertyId,
        p_note: note.trim() || null,
        p_scopes: selectedScopes,
      });
      if (rpcErr) throw new Error(t(mapAdminRpcError(rpcErr.message)));
      setSuccess(t('admin.serviceLockDone'));
      setNote('');
      setSelectedScopes(['all']);
      await refreshAfterMutation();
    } catch (e: unknown) {
      setError(ownerVisibleError(e, t('admin.errGeneric')));
    } finally {
      setBusy(false);
    }
  }

  async function handleUnlock(pid?: number) {
    const target = pid ?? (typeof propertyId === 'number' ? propertyId : null);
    if (!target) return;
    if (!confirm(t('admin.serviceUnlockConfirm'))) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const { error: rpcErr } = await supabase.rpc('admin_unlock_property_services', {
        p_property_id: target,
      });
      if (rpcErr) throw new Error(t(mapAdminRpcError(rpcErr.message)));
      setSuccess(t('admin.serviceUnlockDone'));
      await refreshAfterMutation();
    } catch (e: unknown) {
      setError(ownerVisibleError(e, t('admin.errGeneric')));
    } finally {
      setBusy(false);
    }
  }

  if (!canSee) {
    return (
      <div className="space-y-4">
        <AdminPageHeader title={t('admin.serviceLock')} secondary={t('admin.serviceLockLead')} />
        <AdminInlineAlert tone="warning">{t('admin.errNoAccess')}</AdminInlineAlert>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <AdminPageHeader title={t('admin.serviceLock')} secondary={t('admin.serviceLockLead')} />

      {error ? <AdminInlineAlert tone="danger">{error}</AdminInlineAlert> : null}
      {success ? <AdminInlineAlert tone="success">{success}</AdminInlineAlert> : null}

      <div className={`${adminCardClass} space-y-4 p-4 md:p-5`}>
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
          {t('admin.serviceLockPick')}
        </p>
        <ApartmentCombobox
          properties={sorted}
          value={propertyId}
          onChange={(id) => setPropertyId(id)}
        />
        {propertyId ? (
          <div className="space-y-3 border-t border-border pt-4">
            {loading ? (
              <p className="text-sm text-muted">{t('common.loading')}</p>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge
                    label={lock.active ? t('admin.serviceLockActive') : t('admin.serviceLockInactive')}
                    tone={lock.active ? 'danger' : 'success'}
                  />
                  {lock.active && lock.locked_at ? (
                    <span className="text-xs text-muted">
                      {formatOwnerDate(lock.locked_at, locale)}
                    </span>
                  ) : null}
                </div>
                {lock.active && lock.scopes.length > 0 ? (
                  <p className="text-sm text-secondary">
                    {t('admin.serviceLockScopes')}: {formatServiceLockScopes(lock.scopes, scopeLabel)}
                  </p>
                ) : null}
                {lock.active && lock.admin_note ? (
                  <p className="text-sm text-secondary">{lock.admin_note}</p>
                ) : null}
                {!lock.active ? (
                  <>
                    <fieldset className="space-y-2">
                      <legend className="text-sm font-medium text-secondary">
                        {t('admin.serviceLockScopes')}
                      </legend>
                      <p className="text-xs text-muted">{t('admin.serviceLockScopesHint')}</p>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {SERVICE_LOCK_LIVE_SCOPES.map((key) => {
                          const allOn = selectedScopes.includes('all');
                          const checked =
                            key === 'all' ? allOn : allOn || selectedScopes.includes(key);
                          const disabledByAll = allOn && key !== 'all';
                          return (
                            <label
                              key={key}
                              className={`flex cursor-pointer items-start gap-2 rounded-lg border border-border px-3 py-2 text-sm ${
                                disabledByAll ? 'opacity-60' : ''
                              }`}
                            >
                              <input
                                type="checkbox"
                                className="mt-0.5"
                                checked={checked}
                                disabled={disabledByAll}
                                onChange={() => toggleScope(key)}
                              />
                              <span>{scopeLabel(key)}</span>
                            </label>
                          );
                        })}
                      </div>
                      <p className="pt-1 text-[11px] font-medium uppercase tracking-[0.14em] text-muted">
                        {t('admin.serviceLockScopesFuture')}
                      </p>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {SERVICE_LOCK_FUTURE_SCOPES.map((key) => {
                          const allOn = selectedScopes.includes('all');
                          const checked = allOn || selectedScopes.includes(key);
                          return (
                            <label
                              key={key}
                              className={`flex cursor-pointer items-start gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-sm ${
                                allOn ? 'opacity-60' : ''
                              }`}
                            >
                              <input
                                type="checkbox"
                                className="mt-0.5"
                                checked={checked}
                                disabled={allOn}
                                onChange={() => toggleScope(key)}
                              />
                              <span>
                                {scopeLabel(key)}
                                <span className="ml-1 text-xs text-muted">
                                  ({t('admin.serviceLockScopeSoon')})
                                </span>
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </fieldset>
                    <label className="grid gap-1 text-sm text-secondary">
                      {t('admin.serviceLockNote')}
                      <input
                        className={adminFieldClass}
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder={t('admin.noteOptional')}
                      />
                    </label>
                    <AdminPrimaryButton
                      type="button"
                      disabled={busy || selectedScopes.length === 0}
                      onClick={() => void handleLock()}
                    >
                      {busy ? t('common.saving') : t('admin.serviceLockAction')}
                    </AdminPrimaryButton>
                  </>
                ) : (
                  <AdminSecondaryButton type="button" disabled={busy} onClick={() => void handleUnlock()}>
                    {busy ? t('common.saving') : t('admin.serviceUnlockAction')}
                  </AdminSecondaryButton>
                )}
              </>
            )}
          </div>
        ) : null}
      </div>

      <div className={`${adminCardClass} p-4 md:p-5`}>
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
          {t('admin.serviceLockActiveList')}
        </p>
        {listLoading ? (
          <p className="mt-3 text-sm text-muted">{t('common.loading')}</p>
        ) : activeLocks.length === 0 ? (
          <div className="mt-3">
            <AdminEmptyState title={t('admin.serviceLockEmpty')} />
          </div>
        ) : (
          <div className="mt-3">
            <AdminTableShell>
              <table className="w-full min-w-[28rem] text-sm">
                <thead>
                  <tr className={adminTableHeadRowClass}>
                    <th className={adminTableCellClass}>{t('admin.apartments')}</th>
                    <th className={adminTableCellClass}>{t('admin.owner')}</th>
                    <th className={adminTableCellClass}>{t('admin.serviceLockScopes')}</th>
                    <th className={adminTableCellClass}>{t('admin.date')}</th>
                    <th className={adminTableCellClass}>{t('admin.note')}</th>
                    <th className={adminTableCellClass} />
                  </tr>
                </thead>
                <tbody>
                  {activeLocks.map((row) => (
                    <tr key={row.lock_id} className={adminTableRowClass}>
                      <td className={adminTableCellClass}>{row.apartment_number}</td>
                      <td className={adminTableCellClass}>{row.owner_name || '—'}</td>
                      <td className={adminTableCellClass}>
                        {formatServiceLockScopes(row.scopes, scopeLabel) || '—'}
                      </td>
                      <td className={adminTableCellClass}>{formatOwnerDate(row.locked_at, locale)}</td>
                      <td className={adminTableCellClass}>{row.admin_note || '—'}</td>
                      <td className={adminTableCellClass}>
                        <button
                          type="button"
                          disabled={busy}
                          className="text-sm font-medium text-accent hover:underline disabled:opacity-50"
                          onClick={() => void handleUnlock(row.property_id)}
                        >
                          {t('admin.serviceUnlockAction')}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </AdminTableShell>
          </div>
        )}
      </div>

      <div className={`${adminCardClass} p-4 md:p-5`}>
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
          {t('admin.serviceLockHistory')}
          {typeof propertyId === 'number' ? (
            <span className="ml-2 font-normal normal-case tracking-normal text-muted">
              · {t('admin.apartments')} {aptNumber(
                sorted.find((p) => p.id === propertyId)?.apartment_number,
              )}
            </span>
          ) : null}
        </p>
        {historyLoading ? (
          <p className="mt-3 text-sm text-muted">{t('common.loading')}</p>
        ) : history.length === 0 ? (
          <div className="mt-3">
            <AdminEmptyState title={t('admin.serviceLockHistoryEmpty')} />
          </div>
        ) : (
          <div className="mt-3">
            <AdminTableShell>
              <table className="w-full min-w-[32rem] text-sm">
                <thead>
                  <tr className={adminTableHeadRowClass}>
                    <th className={adminTableCellClass}>{t('admin.date')}</th>
                    <th className={adminTableCellClass}>{t('admin.apartments')}</th>
                    <th className={adminTableCellClass}>{t('admin.serviceLockEvent')}</th>
                    <th className={adminTableCellClass}>{t('admin.serviceLockScopes')}</th>
                    <th className={adminTableCellClass}>{t('admin.note')}</th>
                    <th className={adminTableCellClass}>{t('admin.serviceLockActor')}</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((row) => (
                    <tr key={row.event_id} className={adminTableRowClass}>
                      <td className={adminTableCellClass}>{formatOwnerDate(row.created_at, locale)}</td>
                      <td className={adminTableCellClass}>{row.apartment_number}</td>
                      <td className={adminTableCellClass}>
                        <StatusBadge
                          label={
                            row.event_type === 'unlock'
                              ? t('admin.serviceLockEventUnlock')
                              : t('admin.serviceLockEventLock')
                          }
                          tone={row.event_type === 'unlock' ? 'success' : 'danger'}
                        />
                      </td>
                      <td className={adminTableCellClass}>
                        {formatServiceLockScopes(row.scopes, scopeLabel) || '—'}
                      </td>
                      <td className={adminTableCellClass}>{row.admin_note || '—'}</td>
                      <td className={adminTableCellClass}>{row.actor_email || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </AdminTableShell>
          </div>
        )}
      </div>
    </div>
  );
}
