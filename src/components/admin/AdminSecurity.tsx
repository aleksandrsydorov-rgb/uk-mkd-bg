'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { useI18n } from '@/i18n/I18nProvider';
import { formatOwnerDate, formatOwnerDateTime } from '@/lib/ownerFormat';
import { ownerVisibleError } from '@/lib/ownerError';
import { isMissingRelation } from '@/lib/polls';
import {
  SECURITY_DELIVERY_MODES,
  SECURITY_HANDOVER_ITEMS,
  SECURITY_REQUEST_KINDS,
  canSeeSecurityAdmin,
  securityStatusTone,
  type SecurityDeliveryMode,
  type SecurityHandoverItem,
  type SecurityPost,
  type SecurityRequestAdminRow,
  type SecurityRequestKind,
} from '@/lib/security';
import {
  AdminPageHeader,
  AdminEmptyState,
  AdminInlineAlert,
  AdminPrimaryButton,
  AdminSecondaryButton,
  AdminTableShell,
  AdminToggle,
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

export function AdminSecurity({
  supabase,
  properties,
  staffRole,
}: {
  supabase: SupabaseClient<Database>;
  properties: PropertyOption[];
  staffRole: string;
}) {
  const { t, locale } = useI18n();
  const canSee = canSeeSecurityAdmin(staffRole);

  const sorted = useMemo(
    () =>
      [...properties].sort((a, b) =>
        aptNumber(a.apartment_number).localeCompare(aptNumber(b.apartment_number), undefined, {
          numeric: true,
        }),
      ),
    [properties],
  );

  const [posts, setPosts] = useState<SecurityPost[]>([]);
  const [requests, setRequests] = useState<SecurityRequestAdminRow[]>([]);
  const [postName, setPostName] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [propertyId, setPropertyId] = useState<number | ''>('');
  const [kind, setKind] = useState<SecurityRequestKind>('guest_pass');
  const [postId, setPostId] = useState<string>('');
  const [guestName, setGuestName] = useState('');
  const [courierName, setCourierName] = useState('');
  const [deliveryNote, setDeliveryNote] = useState('');
  const [deliveryMode, setDeliveryMode] = useState<SecurityDeliveryMode>('hold_at_post');
  const [handoverItem, setHandoverItem] = useState<SecurityHandoverItem>('parcel');
  const [note, setNote] = useState('');

  const activePosts = useMemo(() => posts.filter((p) => p.active), [posts]);

  const kindLabel = useCallback(
    (k: string) => {
      const key = `admin.secKind_${k}` as const;
      const v = t(key);
      return v === key ? k : v;
    },
    [t],
  );

  const statusLabel = useCallback(
    (s: string) => {
      const key = `admin.secStatus_${s}` as const;
      const v = t(key);
      return v === key ? s : v;
    },
    [t],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [postsRes, reqRes] = await Promise.all([
        supabase.rpc('admin_list_security_posts'),
        supabase.rpc('admin_list_security_requests', { p_limit: 100 }),
      ]);
      if (postsRes.error) {
        if (isMissingRelation(postsRes.error, 'admin_list_security_posts')) {
          setPosts([]);
        } else throw postsRes.error;
      } else {
        setPosts((postsRes.data as SecurityPost[] | null) ?? []);
      }
      if (reqRes.error) {
        if (isMissingRelation(reqRes.error, 'admin_list_security_requests')) {
          setRequests([]);
        } else throw reqRes.error;
      } else {
        setRequests((reqRes.data as SecurityRequestAdminRow[] | null) ?? []);
      }
    } catch (e: unknown) {
      setError(ownerVisibleError(e, t('admin.errGeneric')));
    } finally {
      setLoading(false);
    }
  }, [supabase, t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!postId && activePosts.length === 1) {
      setPostId(activePosts[0].id);
    }
  }, [activePosts, postId]);

  async function handleCreatePost() {
    const name = postName.trim();
    if (!name) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const { error: rpcErr } = await supabase.rpc('admin_create_security_post', {
        p_name: name,
        p_sort_order: posts.length,
      });
      if (rpcErr) throw rpcErr;
      setPostName('');
      setSuccess(t('admin.secPostCreated'));
      await load();
    } catch (e: unknown) {
      setError(ownerVisibleError(e, t('admin.errGeneric')));
    } finally {
      setBusy(false);
    }
  }

  async function handleTogglePost(post: SecurityPost, active: boolean) {
    setBusy(true);
    setError(null);
    try {
      const { error: rpcErr } = await supabase.rpc('admin_update_security_post', {
        p_post_id: post.id,
        p_active: active,
      });
      if (rpcErr) throw rpcErr;
      await load();
    } catch (e: unknown) {
      setError(ownerVisibleError(e, t('admin.errGeneric')));
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateRequest() {
    if (!propertyId) return;
    if (activePosts.length > 1 && !postId) {
      setError(t('admin.secPostRequired'));
      return;
    }
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const { error: rpcErr } = await supabase.rpc('admin_create_security_request', {
        p_property_id: propertyId,
        p_kind: kind,
        p_post_id: postId || null,
        p_guest_name: kind === 'guest_pass' ? guestName.trim() || null : null,
        p_courier_name: kind === 'delivery' ? courierName.trim() || null : null,
        p_delivery_note: kind === 'delivery' ? deliveryNote.trim() || null : null,
        p_handover_item: kind === 'handover' ? handoverItem : null,
        p_note: note.trim() || null,
        p_delivery_mode: kind === 'delivery' ? deliveryMode : null,
      });
      if (rpcErr) throw rpcErr;
      setGuestName('');
      setCourierName('');
      setDeliveryNote('');
      setDeliveryMode('hold_at_post');
      setNote('');
      setSuccess(t('admin.secRequestCreated'));
      await load();
    } catch (e: unknown) {
      setError(ownerVisibleError(e, t('admin.errGeneric')));
    } finally {
      setBusy(false);
    }
  }

  if (!canSee) {
    return (
      <div className="space-y-4">
        <AdminPageHeader title={t('admin.security')} secondary={t('admin.securityLead')} />
        <AdminInlineAlert tone="warning">{t('admin.errNoAccess')}</AdminInlineAlert>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <AdminPageHeader title={t('admin.security')} secondary={t('admin.securityLead')} />
      {error ? <AdminInlineAlert tone="danger">{error}</AdminInlineAlert> : null}
      {success ? <AdminInlineAlert tone="success">{success}</AdminInlineAlert> : null}

      <section className="space-y-3">
        <div className="px-0.5">
          <h3 className="text-base font-semibold text-foreground">{t('admin.secPosts')}</h3>
          <p className="mt-1 text-sm text-secondary">{t('admin.secPostsHint')}</p>
        </div>
        <div className={`${adminCardClass} space-y-3 p-4`}>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <label className="grid min-w-0 flex-1 gap-1 text-sm text-secondary">
              {t('admin.secPostName')}
              <input
                className={adminFieldClass}
                value={postName}
                onChange={(e) => setPostName(e.target.value)}
                placeholder={t('admin.secPostNamePh')}
              />
            </label>
            <AdminPrimaryButton type="button" disabled={busy || !postName.trim()} onClick={() => void handleCreatePost()}>
              {busy ? t('common.saving') : t('admin.secPostAdd')}
            </AdminPrimaryButton>
          </div>
          {loading ? (
            <p className="text-sm text-muted">{t('common.loading')}</p>
          ) : posts.length === 0 ? (
            <AdminEmptyState title={t('admin.secPostsEmpty')} />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {posts.map((post) => (
                <div key={post.id} className="flex items-center justify-between gap-3 rounded-xl border border-border px-3.5 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground">{post.name}</p>
                    <p className="mt-0.5 text-xs text-muted">
                      {post.active ? t('admin.secPostActive') : t('admin.secPostInactive')}
                    </p>
                  </div>
                  <AdminToggle
                    checked={post.active}
                    disabled={busy}
                    label={post.name}
                    onChange={(next) => void handleTogglePost(post, next)}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <div className="px-0.5">
          <h3 className="text-base font-semibold text-foreground">{t('admin.secNewRequest')}</h3>
        </div>
        <div className={`${adminCardClass} space-y-3 p-4`}>
          <ApartmentCombobox properties={sorted} value={propertyId} onChange={(id) => setPropertyId(id)} />
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-sm text-secondary">
              {t('admin.secKind')}
              <select
                className={adminFieldClass}
                value={kind}
                onChange={(e) => setKind(e.target.value as SecurityRequestKind)}
              >
                {SECURITY_REQUEST_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {kindLabel(k)}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm text-secondary">
              {t('admin.secPost')}
              <select
                className={adminFieldClass}
                value={postId}
                onChange={(e) => setPostId(e.target.value)}
                disabled={activePosts.length === 0}
              >
                {activePosts.length !== 1 ? (
                  <option value="">{t('admin.secPostPick')}</option>
                ) : null}
                {activePosts.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {kind === 'guest_pass' ? (
            <label className="grid gap-1 text-sm text-secondary">
              {t('admin.secGuestName')}
              <input className={adminFieldClass} value={guestName} onChange={(e) => setGuestName(e.target.value)} />
            </label>
          ) : null}
          {kind === 'delivery' ? (
            <>
              <fieldset className="grid gap-2">
                <legend className="text-sm text-secondary">{t('admin.secDeliveryMode')}</legend>
                {SECURITY_DELIVERY_MODES.map((mode) => (
                  <label key={mode} className="flex items-start gap-2 text-sm text-foreground">
                    <input
                      type="radio"
                      name="admin_delivery_mode"
                      className="mt-1"
                      checked={deliveryMode === mode}
                      onChange={() => setDeliveryMode(mode)}
                      disabled={busy}
                    />
                    <span>
                      <span className="font-medium">{t(`admin.secDeliveryMode_${mode}`)}</span>
                      <span className="mt-0.5 block text-xs text-muted">
                        {t(`admin.secDeliveryModeHint_${mode}`)}
                      </span>
                    </span>
                  </label>
                ))}
              </fieldset>
              <label className="grid gap-1 text-sm text-secondary">
                {t('admin.secCourier')}
                <input className={adminFieldClass} value={courierName} onChange={(e) => setCourierName(e.target.value)} />
              </label>
              <label className="grid gap-1 text-sm text-secondary">
                {t('admin.secDeliveryNote')}
                <input className={adminFieldClass} value={deliveryNote} onChange={(e) => setDeliveryNote(e.target.value)} />
              </label>
            </>
          ) : null}
          {kind === 'handover' ? (
            <label className="grid gap-1 text-sm text-secondary">
              {t('admin.secHandoverItem')}
              <select
                className={adminFieldClass}
                value={handoverItem}
                onChange={(e) => setHandoverItem(e.target.value as SecurityHandoverItem)}
              >
                {SECURITY_HANDOVER_ITEMS.map((item) => (
                  <option key={item} value={item}>
                    {t(`admin.secHandover_${item}`)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="grid gap-1 text-sm text-secondary">
            {t('admin.noteOptional')}
            <input className={adminFieldClass} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <AdminPrimaryButton
            type="button"
            disabled={busy || !propertyId || activePosts.length === 0}
            onClick={() => void handleCreateRequest()}
          >
            {busy ? t('common.saving') : t('admin.secRequestCreate')}
          </AdminPrimaryButton>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3 px-0.5">
          <h3 className="text-base font-semibold text-foreground">{t('admin.secRequests')}</h3>
          <AdminSecondaryButton type="button" disabled={busy || loading} onClick={() => void load()}>
            {t('admin.secRefresh')}
          </AdminSecondaryButton>
        </div>
        {loading ? (
          <p className="text-sm text-muted">{t('common.loading')}</p>
        ) : requests.length === 0 ? (
          <AdminEmptyState title={t('admin.secRequestsEmpty')} />
        ) : (
          <AdminTableShell>
            <table className="w-full min-w-[40rem] text-sm">
              <thead>
                <tr className={adminTableHeadRowClass}>
                  <th className={adminTableCellClass}>{t('admin.date')}</th>
                  <th className={adminTableCellClass}>{t('admin.apartments')}</th>
                  <th className={adminTableCellClass}>{t('admin.secPost')}</th>
                  <th className={adminTableCellClass}>{t('admin.secKind')}</th>
                  <th className={adminTableCellClass}>{t('admin.status')}</th>
                  <th className={adminTableCellClass}>{t('admin.note')}</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((row) => (
                  <tr key={row.id} className={adminTableRowClass}>
                    <td className={adminTableCellClass}>{formatOwnerDateTime(row.created_at, locale)}</td>
                    <td className={adminTableCellClass}>{row.apartment_number}</td>
                    <td className={adminTableCellClass}>{row.post_name}</td>
                    <td className={adminTableCellClass}>{kindLabel(row.kind)}</td>
                    <td className={adminTableCellClass}>
                      <StatusBadge
                        label={statusLabel(row.status)}
                        tone={securityStatusTone(row.status)}
                      />
                      {row.kind === 'delivery' && row.delivery_mode ? (
                        <p className="mt-1 text-xs text-muted">
                          {t(`admin.secDeliveryMode_${row.delivery_mode}`)}
                        </p>
                      ) : null}
                    </td>
                    <td className={adminTableCellClass}>
                      {row.guest_name || row.courier_name || row.note || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </AdminTableShell>
        )}
      </section>
    </div>
  );
}
