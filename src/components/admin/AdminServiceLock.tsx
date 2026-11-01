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
  isScopeLocked,
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

function ServiceCard({
  label,
  statusLabel,
  tone,
  selected,
  disabled,
  hint,
  onClick,
}: {
  label: string;
  statusLabel: string;
  tone: 'success' | 'danger' | 'warning' | 'info' | 'neutral';
  selected?: boolean;
  disabled?: boolean;
  hint?: string;
  onClick?: () => void;
}) {
  const interactive = Boolean(onClick) && !disabled;
  const className = `${adminCardClass} w-full px-3 py-3 text-left transition ${
    selected ? 'border-accent/40 ring-1 ring-accent/20 bg-accent-bg/40' : ''
  } ${interactive ? 'cursor-pointer hover:border-accent/30' : ''} ${
    disabled ? 'opacity-60' : ''
  }`;

  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold text-foreground">{label}</p>
        <StatusBadge label={statusLabel} tone={tone} />
      </div>
      {hint ? <p className="mt-1 text-[11px] text-muted">{hint}</p> : null}
    </>
  );

  if (interactive) {
    return (
      <button type="button" disabled={disabled} onClick={onClick} className={className}>
        {body}
      </button>
    );
  }
  return <div className={className}>{body}</div>;
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
    if (busy) return;
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
    if (busy) return;
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

  function renderScopeCards(mode: 'select' | 'status') {
    const allOn = selectedScopes.includes('all');
    const renderOne = (key: ServiceLockScope, future: boolean) => {
      if (mode === 'status') {
        const blocked = lock.active && isScopeLocked(lock.scopes, key);
        return (
          <ServiceCard
            key={key}
            label={scopeLabel(key)}
            statusLabel={
              blocked ? t('admin.serviceStatusBlocked') : t('admin.serviceStatusActive')
            }
            tone={blocked ? 'danger' : 'success'}
            hint={future ? t('admin.serviceLockScopeSoon') : undefined}
          />
        );
      }
      const selected = key === 'all' ? allOn : allOn || selectedScopes.includes(key);
      const disabledByAll = allOn && key !== 'all';
      return (
        <ServiceCard
          key={key}
          label={scopeLabel(key)}
          statusLabel={
            selected ? t('admin.serviceStatusSelected') : t('admin.serviceStatusActive')
          }
          tone={selected ? 'warning' : 'success'}
          selected={selected}
          disabled={disabledByAll || busy}
          hint={future ? t('admin.serviceLockScopeSoon') : undefined}
          onClick={() => toggleScope(key)}
        />
      );
    };

    return (
      <div className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {SERVICE_LOCK_LIVE_SCOPES.map((key) => renderOne(key, false))}
        </div>
        <p className="text-xs font-medium text-muted">{t('admin.serviceLockScopesFuture')}</p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {SERVICE_LOCK_FUTURE_SCOPES.map((key) => renderOne(key, true))}
        </div>
      </div>
    );
  }

  if (!canSee) {
    return (
      <div className="space-y-4">
        <AdminPageHeader title={t('admin.serviceLock')} secondary={t('admin.serviceLockLead')} />
        <AdminInlineAlert tone="warning">{t('admin.errNoAccess')}</AdminInlineAlert>
      </div>
    );
  }

  const selectedApt = sorted.find((p) => p.id === propertyId);

  return (
    <div className="space-y-4">
      <AdminPageHeader title={t('admin.serviceLock')} secondary={t('admin.serviceLockLead')} />

      {error ? <AdminInlineAlert tone="danger">{error}</AdminInlineAlert> : null}
      {success ? <AdminInlineAlert tone="success">{success}</AdminInlineAlert> : null}

      <section className={`${adminCardClass} space-y-4 p-4 md:p-5`}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-foreground">{t('admin.serviceLockManage')}</h3>
            <p className="mt-0.5 text-xs text-muted">{t('admin.serviceLockSelectAptHint')}</p>
          </div>
          {propertyId ? (
            <StatusBadge
              label={lock.active ? t('admin.serviceLockActive') : t('admin.serviceLockInactive')}
              tone={lock.active ? 'danger' : 'success'}
            />
          ) : null}
        </div>

        <label className="grid gap-1 text-sm text-secondary">
          {t('admin.serviceLockPick')}
          <ApartmentCombobox
            properties={sorted}
            value={propertyId}
            onChange={(id) => {
              setPropertyId(id);
              setSelectedScopes(['all']);
              setNote('');
              setSuccess(null);
              setError(null);
            }}
          />
        </label>

        {!propertyId ? (
          <AdminEmptyState title={t('admin.serviceLockSelectAptHint')} />
        ) : loading ? (
          <p className="text-sm text-muted">{t('common.loading')}</p>
        ) : (
          <div className="space-y-4 border-t border-border pt-4">
            <div className="rounded-xl border border-border bg-background px-3 py-2.5">
              <p className="text-sm font-semibold text-foreground">
                № {aptNumber(selectedApt?.apartment_number)}
              </p>
              <p className="text-xs text-muted">{selectedApt?.owner_name || '—'}</p>
              {lock.active && lock.locked_at ? (
                <p className="mt-1 text-xs text-secondary">
                  {formatOwnerDate(lock.locked_at, locale)}
                  {lock.admin_note ? ` · ${lock.admin_note}` : ''}
                </p>
              ) : null}
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium text-foreground">{t('admin.serviceLockScopes')}</p>
              {!lock.active ? (
                <p className="text-xs text-muted">{t('admin.serviceLockScopesHint')}</p>
              ) : null}
              {renderScopeCards(lock.active ? 'status' : 'select')}
            </div>

            {!lock.active ? (
              <>
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
              <AdminSecondaryButton
                type="button"
                disabled={busy}
                onClick={() => void handleUnlock()}
              >
                {busy ? t('common.saving') : t('admin.serviceUnlockAction')}
              </AdminSecondaryButton>
            )}
          </div>
        )}
      </section>

      <section className={`${adminCardClass} space-y-3 p-4 md:p-5`}>
        <h3 className="text-sm font-semibold text-foreground">{t('admin.serviceLockActiveList')}</h3>
        {listLoading ? (
          <p className="text-sm text-muted">{t('common.loading')}</p>
        ) : activeLocks.length === 0 ? (
          <AdminEmptyState title={t('admin.serviceLockEmpty')} />
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {activeLocks.map((row) => (
              <div key={row.lock_id} className="rounded-xl border border-border bg-background px-3 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground">
                      № {row.apartment_number}
                    </p>
                    <p className="truncate text-xs text-muted">{row.owner_name || '—'}</p>
                  </div>
                  <StatusBadge label={t('admin.serviceLockActive')} tone="danger" />
                </div>
                <p className="mt-2 text-xs text-secondary">
                  {formatServiceLockScopes(row.scopes, scopeLabel) || '—'}
                </p>
                <p className="mt-1 text-[11px] text-muted">
                  {formatOwnerDate(row.locked_at, locale)}
                  {row.admin_note ? ` · ${row.admin_note}` : ''}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="text-xs font-medium text-accent hover:underline"
                    disabled={busy}
                    onClick={() => {
                      setPropertyId(row.property_id);
                      setSuccess(null);
                      setError(null);
                    }}
                  >
                    {t('admin.serviceLockManage')}
                  </button>
                  <button
                    type="button"
                    className="text-xs font-medium text-danger hover:underline disabled:opacity-50"
                    disabled={busy}
                    onClick={() => void handleUnlock(row.property_id)}
                  >
                    {t('admin.serviceUnlockAction')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className={`${adminCardClass} p-4 md:p-5`}>
        <h3 className="text-sm font-semibold text-foreground">
          {t('admin.serviceLockHistory')}
          {typeof propertyId === 'number' ? (
            <span className="ml-2 text-xs font-normal text-muted">
              · № {aptNumber(selectedApt?.apartment_number)}
            </span>
          ) : null}
        </h3>
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
      </section>
    </div>
  );
}
