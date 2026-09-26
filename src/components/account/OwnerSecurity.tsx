'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { useI18n } from '@/i18n/I18nProvider';
import { formatOwnerDateTime } from '@/lib/ownerFormat';
import { ownerVisibleError } from '@/lib/ownerError';
import { isMissingRelation } from '@/lib/polls';
import {
  SECURITY_HANDOVER_ITEMS,
  SECURITY_REQUEST_KINDS,
  type SecurityHandoverItem,
  type SecurityPostOption,
  type SecurityRequest,
  type SecurityRequestKind,
} from '@/lib/security';
import { StatusBadge } from '@/components/account/ownerUi';

export function OwnerSecurity({
  supabase,
  propertyId,
  serviceLocked = false,
}: {
  supabase: SupabaseClient<Database>;
  propertyId: number;
  serviceLocked?: boolean;
}) {
  const { t, locale } = useI18n();
  const [posts, setPosts] = useState<SecurityPostOption[]>([]);
  const [rows, setRows] = useState<SecurityRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const [kind, setKind] = useState<SecurityRequestKind>('guest_pass');
  const [postId, setPostId] = useState('');
  const [guestName, setGuestName] = useState('');
  const [courierName, setCourierName] = useState('');
  const [deliveryNote, setDeliveryNote] = useState('');
  const [handoverItem, setHandoverItem] = useState<SecurityHandoverItem>('parcel');
  const [note, setNote] = useState('');

  const fieldClass =
    'w-full min-h-10 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent/30';

  const kindLabel = useCallback(
    (k: string) => {
      const key = `account.secKind_${k}` as const;
      const v = t(key);
      return v === key ? k : v;
    },
    [t],
  );

  const statusLabel = useCallback(
    (s: string) => {
      const key = `account.secStatus_${s}` as const;
      const v = t(key);
      return v === key ? s : v;
    },
    [t],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [postsRes, listRes] = await Promise.all([
        supabase.rpc('list_active_security_posts'),
        supabase.rpc('owner_list_my_security_requests', { p_property_id: propertyId }),
      ]);
      if (postsRes.error && !isMissingRelation(postsRes.error, 'list_active_security_posts')) {
        throw postsRes.error;
      }
      setPosts((postsRes.data as SecurityPostOption[] | null) ?? []);
      if (listRes.error && !isMissingRelation(listRes.error, 'owner_list_my_security_requests')) {
        throw listRes.error;
      }
      setRows(((listRes.data as SecurityRequest[] | null) ?? []).map((r) => ({
        ...r,
        id: String(r.id),
        post_id: String(r.post_id),
      })));
    } catch (e: unknown) {
      setError(ownerVisibleError(e, t('err.loadApt')));
    } finally {
      setLoading(false);
    }
  }, [propertyId, supabase, t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!postId && posts.length === 1) setPostId(posts[0].id);
  }, [posts, postId]);

  const postNameById = useMemo(() => {
    const m = new Map(posts.map((p) => [p.id, p.name]));
    return m;
  }, [posts]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (serviceLocked) {
      setError(t('account.serviceLockBanner'));
      return;
    }
    if (posts.length > 1 && !postId) {
      setError(t('account.secPostRequired'));
      return;
    }
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const { error: rpcErr } = await supabase.rpc('owner_create_security_request', {
        p_property_id: propertyId,
        p_kind: kind,
        p_post_id: postId || null,
        p_guest_name: kind === 'guest_pass' ? guestName.trim() || null : null,
        p_courier_name: kind === 'delivery' ? courierName.trim() || null : null,
        p_delivery_note: kind === 'delivery' ? deliveryNote.trim() || null : null,
        p_handover_item: kind === 'handover' ? handoverItem : null,
        p_note: note.trim() || null,
      });
      if (rpcErr) throw rpcErr;
      setGuestName('');
      setCourierName('');
      setDeliveryNote('');
      setNote('');
      setOk(t('account.secRequestCreated'));
      await load();
    } catch (err: unknown) {
      setError(ownerVisibleError(err, t('err.save')));
    } finally {
      setBusy(false);
    }
  }

  async function handleCancel(id: string) {
    if (!confirm(t('account.secCancelConfirm'))) return;
    setBusy(true);
    setError(null);
    try {
      const { error: rpcErr } = await supabase.rpc('owner_cancel_security_request', {
        p_request_id: id,
      });
      if (rpcErr) throw rpcErr;
      await load();
    } catch (err: unknown) {
      setError(ownerVisibleError(err, t('err.save')));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-foreground">{t('account.security')}</h2>
        <p className="mt-1 text-sm text-secondary">{t('account.securityLead')}</p>
      </div>

      {error ? (
        <div className="rounded-xl border border-danger/25 bg-danger-bg px-4 py-3 text-sm text-danger">{error}</div>
      ) : null}
      {ok ? (
        <div className="rounded-xl border border-success/25 bg-success-bg px-4 py-3 text-sm text-foreground">{ok}</div>
      ) : null}

      <form
        onSubmit={(e) => void handleCreate(e)}
        className="space-y-3 rounded-[14px] border border-border bg-surface p-4 shadow-card"
      >
        <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted">
          {t('account.secNewRequest')}
        </p>
        <label className="grid gap-1 text-sm text-secondary">
          {t('account.secKind')}
          <select
            className={fieldClass}
            value={kind}
            onChange={(e) => setKind(e.target.value as SecurityRequestKind)}
            disabled={busy || serviceLocked}
          >
            {SECURITY_REQUEST_KINDS.map((k) => (
              <option key={k} value={k}>
                {kindLabel(k)}
              </option>
            ))}
          </select>
        </label>
        {posts.length > 1 ? (
          <label className="grid gap-1 text-sm text-secondary">
            {t('account.secPost')}
            <select
              className={fieldClass}
              value={postId}
              onChange={(e) => setPostId(e.target.value)}
              disabled={busy || serviceLocked}
            >
              <option value="">{t('account.secPostPick')}</option>
              {posts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {kind === 'guest_pass' ? (
          <label className="grid gap-1 text-sm text-secondary">
            {t('account.secGuestName')}
            <input
              className={fieldClass}
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
              disabled={busy || serviceLocked}
              required
            />
          </label>
        ) : null}
        {kind === 'delivery' ? (
          <>
            <label className="grid gap-1 text-sm text-secondary">
              {t('account.secCourier')}
              <input
                className={fieldClass}
                value={courierName}
                onChange={(e) => setCourierName(e.target.value)}
                disabled={busy || serviceLocked}
              />
            </label>
            <label className="grid gap-1 text-sm text-secondary">
              {t('account.secDeliveryNote')}
              <input
                className={fieldClass}
                value={deliveryNote}
                onChange={(e) => setDeliveryNote(e.target.value)}
                disabled={busy || serviceLocked}
              />
            </label>
          </>
        ) : null}
        {kind === 'handover' ? (
          <label className="grid gap-1 text-sm text-secondary">
            {t('account.secHandoverItem')}
            <select
              className={fieldClass}
              value={handoverItem}
              onChange={(e) => setHandoverItem(e.target.value as SecurityHandoverItem)}
              disabled={busy || serviceLocked}
            >
              {SECURITY_HANDOVER_ITEMS.map((item) => (
                <option key={item} value={item}>
                  {t(`account.secHandover_${item}`)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="grid gap-1 text-sm text-secondary">
          {t('account.secNote')}
          <input
            className={fieldClass}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={busy || serviceLocked}
          />
        </label>
        <button
          type="submit"
          disabled={busy || serviceLocked || posts.length === 0}
          className="inline-flex items-center justify-center rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
        >
          {busy ? t('common.saving') : t('account.secRequestCreate')}
        </button>
        {posts.length === 0 && !loading ? (
          <p className="text-xs text-muted">{t('account.secNoPosts')}</p>
        ) : null}
      </form>

      <div className="rounded-[14px] border border-border bg-surface p-4 shadow-card">
        <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted">
          {t('account.secHistory')}
        </p>
        {loading ? (
          <p className="mt-3 text-sm text-muted">{t('common.loading')}</p>
        ) : rows.length === 0 ? (
          <p className="mt-3 text-sm text-muted">{t('account.secHistoryEmpty')}</p>
        ) : (
          <ul className="mt-3 divide-y divide-border">
            {rows.map((row) => (
              <li key={row.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium text-foreground">{kindLabel(row.kind)}</p>
                    <StatusBadge
                      label={statusLabel(row.status)}
                      tone={
                        row.status === 'pending'
                          ? 'warning'
                          : row.status === 'accepted'
                            ? 'info'
                            : row.status === 'handed_over'
                              ? 'success'
                              : 'neutral'
                      }
                    />
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    {formatOwnerDateTime(row.created_at, locale)}
                    {postNameById.get(row.post_id) ? ` · ${postNameById.get(row.post_id)}` : ''}
                  </p>
                  <p className="mt-1 text-sm text-secondary">
                    {row.guest_name || row.courier_name || row.note || '—'}
                  </p>
                </div>
                {row.status === 'pending' ? (
                  <button
                    type="button"
                    disabled={busy || serviceLocked}
                    className="text-sm font-medium text-danger hover:underline disabled:opacity-50"
                    onClick={() => void handleCancel(row.id)}
                  >
                    {t('account.secCancel')}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
