'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { useI18n } from '@/i18n/I18nProvider';
import { formatOwnerDate } from '@/lib/ownerFormat';
import { ownerVisibleError } from '@/lib/ownerError';
import { isMissingRelation } from '@/lib/polls';
import {
  CompactCard,
  EmptyState,
  PrimaryButton,
  SectionHeader,
  StatusBadge,
  TextLinkButton,
} from '@/components/account/ownerUi';
import {
  GUEST_RELATION_TYPES,
  requiresValidUntil,
  type GuestRelationType,
} from '@/lib/guestMode';
import {
  emptyGuestPermissions,
  filterGrantableActions,
  guestPermissionsNonempty,
  guestPermissionsSelected,
  parseGuestPermissions,
  permissionsPayload,
  toggleGuestPermission,
  type GrantableGuestAction,
  type GuestActionCategory,
  type GuestActionKey,
  type GuestPermissions,
} from '@/lib/guestPermissions';
import { type BuildingModulesState } from '@/lib/modules';

type GuestAccessRow = Database['public']['Tables']['property_guest_accesses']['Row'] & {
  permissions?: unknown;
};

type UntypedRpc = {
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{
    data: unknown;
    error: { message: string } | null;
  }>;
};

function statusTone(status: string): 'neutral' | 'info' | 'success' | 'warning' | 'danger' {
  if (status === 'active') return 'success';
  if (status === 'pending') return 'warning';
  if (status === 'revoked') return 'danger';
  if (status === 'expired') return 'neutral';
  return 'neutral';
}

const CATEGORY_ORDER: GuestActionCategory[] = [
  'meters',
  'communication',
  'requests',
  'info',
  'services',
];

export function OwnerGuestMode({
  supabase,
  propertyId,
  apartmentLabel,
  buildingModules,
}: {
  supabase: SupabaseClient<Database>;
  propertyId: number;
  apartmentLabel?: string;
  buildingModules: BuildingModulesState;
}) {
  const { t, dateLocale } = useI18n();
  const [rows, setRows] = useState<GuestAccessRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [grantable, setGrantable] = useState<GrantableGuestAction[]>([]);

  const [email, setEmail] = useState('');
  const [relationType, setRelationType] = useState<GuestRelationType>('living_with_owner');
  const [validFrom, setValidFrom] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [perms, setPerms] = useState<GuestPermissions>(() => emptyGuestPermissions());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editPerms, setEditPerms] = useState<GuestPermissions>({});

  const fieldClass =
    'w-full min-h-10 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent/30';

  const activeCount = useMemo(
    () => rows.filter((r) => r.status === 'active').length,
    [rows],
  );

  const enabledModules = useMemo(() => {
    const set = new Set<string>();
    for (const [key, on] of Object.entries(buildingModules)) {
      if (on) set.add(key);
    }
    return set;
  }, [buildingModules]);

  const relationLabel = useCallback(
    (rel: string) => {
      const key = `account.guestRelation_${rel}` as const;
      const v = t(key);
      return v === key ? rel : v;
    },
    [t],
  );

  const statusLabel = useCallback(
    (status: string) => {
      const key = `account.guestStatus_${status}` as const;
      const v = t(key);
      return v === key ? status : v;
    },
    [t],
  );

  const actionLabel = useCallback(
    (action: GuestActionKey) => {
      const key = `account.guestPerm_${action.replace(/\./g, '_')}` as const;
      const v = t(key);
      return v === key ? action : v;
    },
    [t],
  );

  const actionHint = useCallback(
    (action: GuestActionKey) => {
      const key = `account.guestPermHint_${action.replace(/\./g, '_')}` as const;
      const v = t(key);
      return v === key ? '' : v;
    },
    [t],
  );

  const categoryLabel = useCallback(
    (cat: GuestActionCategory) => {
      const key = `account.guestPermCat_${cat}` as const;
      const v = t(key);
      return v === key ? cat : v;
    },
    [t],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rpc = supabase as unknown as UntypedRpc;
      const { data, error: rpcErr } = await supabase.rpc('owner_list_guest_accesses', {
        p_property_id: propertyId,
      });
      if (rpcErr && !isMissingRelation(rpcErr, 'owner_list_guest_accesses')) {
        throw rpcErr;
      }
      setRows((data as GuestAccessRow[] | null) ?? []);

      const grantRes = await rpc.rpc('owner_list_grantable_guest_actions', {
        p_property_id: propertyId,
      });
      if (!grantRes.error && Array.isArray(grantRes.data)) {
        setGrantable(
          (grantRes.data as GrantableGuestAction[]).filter((row) =>
            enabledModules.size === 0
              ? true
              : row.module_key == null || enabledModules.has(row.module_key),
          ),
        );
      } else {
        setGrantable(filterGrantableActions(enabledModules));
      }
    } catch (e: unknown) {
      setError(ownerVisibleError(e, t('err.loadApt'), t));
      setGrantable(filterGrantableActions(enabledModules));
    } finally {
      setLoading(false);
    }
  }, [propertyId, supabase, t, enabledModules]);

  useEffect(() => {
    void load();
  }, [load]);

  const grouped = useMemo(() => {
    const map = new Map<GuestActionCategory, GrantableGuestAction[]>();
    for (const cat of CATEGORY_ORDER) map.set(cat, []);
    for (const row of grantable) {
      const list = map.get(row.category) ?? [];
      list.push(row);
      map.set(row.category, list);
    }
    return CATEGORY_ORDER.map((cat) => ({ cat, items: map.get(cat) ?? [] })).filter(
      (g) => g.items.length > 0,
    );
  }, [grantable]);

  function renderPermissionGroups(
    value: GuestPermissions,
    onToggle: (action: GuestActionKey, on: boolean) => void,
    disabled: boolean,
  ) {
    return (
      <div className="space-y-3">
        {grouped.map(({ cat, items }) => (
          <div key={cat} className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-secondary">
              {categoryLabel(cat)}
            </p>
            {items.map((item) => {
              const checked = value[item.action] === true;
              const hint = actionHint(item.action);
              return (
                <label
                  key={item.action}
                  className="flex cursor-pointer items-start gap-2 rounded-lg border border-border/70 px-3 py-2"
                >
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={checked}
                    disabled={disabled}
                    onChange={(e) => onToggle(item.action, e.target.checked)}
                  />
                  <span className="min-w-0">
                    <span className="block text-sm text-foreground">{actionLabel(item.action)}</span>
                    {hint ? <span className="mt-0.5 block text-xs text-muted">{hint}</span> : null}
                  </span>
                </label>
              );
            })}
          </div>
        ))}
        <p className="text-xs text-muted">{t('account.guestPermPaidClosed')}</p>
      </div>
    );
  }

  async function handleCreateConfirmed() {
    if (activeCount >= 2) {
      setError(t('account.guestModeActiveLimit'));
      return;
    }
    if (requiresValidUntil(relationType) && !validUntil) {
      setError(t('account.guestModeShortTermUntilRequired'));
      return;
    }
    if (!guestPermissionsNonempty(perms)) {
      setError(t('account.guestPermRequired'));
      return;
    }
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const rpc = supabase as unknown as UntypedRpc;
      const { error: rpcErr } = await rpc.rpc('owner_create_guest_access', {
        p_property_id: propertyId,
        p_email: email.trim(),
        p_relation_type: relationType,
        p_valid_from: validFrom ? new Date(validFrom).toISOString() : undefined,
        p_valid_until: validUntil ? new Date(validUntil).toISOString() : undefined,
        p_permissions: permissionsPayload(perms),
      });
      if (rpcErr) throw rpcErr;
      setEmail('');
      setValidFrom('');
      setValidUntil('');
      setPerms(emptyGuestPermissions());
      setConfirmOpen(false);
      setOk(t('account.guestModeCreated'));
      await load();
    } catch (err: unknown) {
      setError(ownerVisibleError(err, t('err.save'), t));
    } finally {
      setBusy(false);
    }
  }

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!guestPermissionsNonempty(perms)) {
      setError(t('account.guestPermRequired'));
      return;
    }
    setError(null);
    setConfirmOpen(true);
  }

  async function handleRevoke(id: string) {
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const { error: rpcErr } = await supabase.rpc('owner_revoke_guest_access', {
        p_access_id: id,
      });
      if (rpcErr) throw rpcErr;
      setOk(t('account.guestModeRevoked'));
      await load();
    } catch (err: unknown) {
      setError(ownerVisibleError(err, t('err.save'), t));
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveEdit() {
    if (!editingId) return;
    if (!guestPermissionsNonempty(editPerms)) {
      setError(t('account.guestPermRequired'));
      return;
    }
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const rpc = supabase as unknown as UntypedRpc;
      const { error: rpcErr } = await rpc.rpc('owner_update_guest_permissions', {
        p_access_id: editingId,
        p_permissions: permissionsPayload(editPerms),
      });
      if (rpcErr) throw rpcErr;
      setEditingId(null);
      setOk(t('account.guestPermUpdated'));
      await load();
    } catch (err: unknown) {
      setError(ownerVisibleError(err, t('err.save'), t));
    } finally {
      setBusy(false);
    }
  }

  function permissionSummary(row: GuestAccessRow): string {
    const selected = guestPermissionsSelected(parseGuestPermissions(row.permissions));
    if (selected.length === 0) return t('account.guestPermNoneLegacy');
    return selected.map((a) => actionLabel(a)).join(' · ');
  }

  return (
    <div className="space-y-4">
      <SectionHeader
        title={t('account.guestModeTitle')}
        secondary={t('account.guestModeLead', { n: String(activeCount) })}
      />

      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {ok ? <p className="text-sm text-success">{ok}</p> : null}

      <form onSubmit={handleCreate} className="space-y-3 rounded-[14px] border border-border bg-surface px-4 py-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="mb-1 block text-sm text-secondary">{t('account.guestModeEmail')}</label>
            <input
              type="email"
              required
              className={fieldClass}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={busy || activeCount >= 2}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-secondary">{t('account.guestModeRelation')}</label>
            <select
              className={fieldClass}
              value={relationType}
              onChange={(e) => setRelationType(e.target.value as GuestRelationType)}
              disabled={busy || activeCount >= 2}
            >
              {GUEST_RELATION_TYPES.map((rel) => (
                <option key={rel} value={rel}>
                  {relationLabel(rel)}
                </option>
              ))}
            </select>
          </div>
          <div />
          <div>
            <label className="mb-1 block text-sm text-secondary">{t('account.guestModeValidFrom')}</label>
            <input
              type="date"
              className={fieldClass}
              value={validFrom}
              onChange={(e) => setValidFrom(e.target.value)}
              disabled={busy || activeCount >= 2}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-secondary">
              {t('account.guestModeValidUntil')}
              {requiresValidUntil(relationType) ? ' *' : ''}
            </label>
            <input
              type="date"
              className={fieldClass}
              value={validUntil}
              onChange={(e) => setValidUntil(e.target.value)}
              disabled={busy || activeCount >= 2}
              required={requiresValidUntil(relationType)}
            />
          </div>
        </div>

        <div className="space-y-2 border-t border-border/60 pt-3">
          <p className="text-sm font-medium text-foreground">{t('account.guestPermTitle')}</p>
          <p className="text-xs text-muted">{t('account.guestPermLead')}</p>
          {grantable.length === 0 ? (
            <p className="text-xs text-warning">{t('account.guestPermNoModules')}</p>
          ) : (
            renderPermissionGroups(
              perms,
              (action, on) => setPerms((prev) => toggleGuestPermission(prev, action, on)),
              busy || activeCount >= 2,
            )
          )}
        </div>

        <PrimaryButton type="submit" disabled={busy || activeCount >= 2 || !email.trim()}>
          {busy ? t('common.saving') : t('account.guestModeAdd')}
        </PrimaryButton>
        {activeCount >= 2 ? (
          <p className="text-xs text-warning">{t('account.guestModeActiveLimit')}</p>
        ) : null}
      </form>

      {confirmOpen ? (
        <div className="space-y-3 rounded-[14px] border border-accent/40 bg-surface px-4 py-3">
          <p className="text-sm font-semibold text-foreground">{t('account.guestPermConfirmTitle')}</p>
          <ul className="space-y-1 text-sm text-secondary">
            <li>
              {t('account.guestPermConfirmApt')}: {apartmentLabel || t('picker.apt', { n: String(propertyId) })}
            </li>
            <li>
              {t('account.guestModeEmail')}: {email.trim()}
            </li>
            <li>
              {t('account.guestModeValidUntil')}:{' '}
              {validUntil
                ? formatOwnerDate(new Date(validUntil).toISOString(), dateLocale)
                : t('account.guestModeOpenEnded')}
            </li>
            <li>
              {t('account.guestPermConfirmActions')}:{' '}
              {guestPermissionsSelected(perms).map((a) => actionLabel(a)).join(' · ')}
            </li>
          </ul>
          <div className="flex flex-wrap gap-2">
            <PrimaryButton type="button" disabled={busy} onClick={() => void handleCreateConfirmed()}>
              {t('account.guestPermConfirmSend')}
            </PrimaryButton>
            <TextLinkButton onClick={() => setConfirmOpen(false)}>{t('common.cancel')}</TextLinkButton>
          </div>
        </div>
      ) : null}

      {loading ? (
        <p className="text-sm text-muted">{t('common.loading')}</p>
      ) : rows.length === 0 ? (
        <EmptyState title={t('account.guestModeEmpty')} />
      ) : (
        <div className="space-y-2">
          {rows.map((row) => {
            const rowPerms = parseGuestPermissions(row.permissions);
            const isEditing = editingId === row.id;
            return (
              <CompactCard key={row.id} className="space-y-2">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">{row.email}</p>
                    <p className="mt-0.5 text-xs text-secondary">{relationLabel(row.relation_type)}</p>
                    <p className="mt-1 text-xs text-muted">
                      {formatOwnerDate(row.valid_from, dateLocale)}
                      {row.valid_until
                        ? ` — ${formatOwnerDate(row.valid_until, dateLocale)}`
                        : ` · ${t('account.guestModeOpenEnded')}`}
                    </p>
                    <p className="mt-1 text-xs text-secondary">{permissionSummary(row)}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <StatusBadge label={statusLabel(row.status)} tone={statusTone(row.status)} />
                    {row.status === 'active' || row.status === 'pending' ? (
                      <>
                        <TextLinkButton
                          onClick={() => {
                            setEditingId(row.id);
                            setEditPerms(rowPerms);
                          }}
                        >
                          {t('account.guestPermEdit')}
                        </TextLinkButton>
                        <TextLinkButton onClick={() => void handleRevoke(row.id)}>
                          {t('account.guestModeRevoke')}
                        </TextLinkButton>
                      </>
                    ) : null}
                  </div>
                </div>
                {isEditing ? (
                  <div className="space-y-2 border-t border-border/60 pt-2">
                    {renderPermissionGroups(
                      editPerms,
                      (action, on) => setEditPerms((prev) => toggleGuestPermission(prev, action, on)),
                      busy,
                    )}
                    <div className="flex flex-wrap gap-2">
                      <PrimaryButton type="button" disabled={busy} onClick={() => void handleSaveEdit()}>
                        {t('account.guestPermSave')}
                      </PrimaryButton>
                      <TextLinkButton onClick={() => setEditingId(null)}>{t('common.cancel')}</TextLinkButton>
                    </div>
                  </div>
                ) : null}
              </CompactCard>
            );
          })}
        </div>
      )}
    </div>
  );
}
