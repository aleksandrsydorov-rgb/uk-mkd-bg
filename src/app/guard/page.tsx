'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient as createBrowserClient } from '@/lib/supabase/client';
import { resolveAccess } from '@/lib/access';
import { normalizeEmail } from '@/lib/email';
import { useI18n } from '@/i18n/I18nProvider';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { BrandMark } from '@/components/BrandMark';
import { formatOwnerDateTime } from '@/lib/ownerFormat';
import { ownerVisibleError } from '@/lib/ownerError';
import { isMissingRelation } from '@/lib/polls';
import {
  GUARD_QUEUE_KIND_ORDER,
  isCourierPassFlow,
  isGuardRole,
  isHoldAtPostFlow,
  isParcelGuardFlow,
  securityStatusTone,
  type GuardQueueRow,
  type GuardShiftView,
  type SecurityCompletionMode,
  type SecurityPostOption,
} from '@/lib/security';
import {
  REQUEST_PHOTOS_BUCKET,
  messageForUploadError,
  securityPhotoPath,
  uploadPrivateFile,
} from '@/lib/privateMedia';
import { StatusBadge } from '@/components/account/ownerUi';
import {
  AdminInlineAlert,
  AdminPrimaryButton,
  AdminSecondaryButton,
  adminCardClass,
  adminFieldClass,
} from '@/components/admin/AdminUi';

function GuardCabinetInner() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [supabase] = useState(() => createBrowserClient());
  const [authReady, setAuthReady] = useState(false);
  const [allowed, setAllowed] = useState(false);
  const [staffName, setStaffName] = useState('');
  const [posts, setPosts] = useState<SecurityPostOption[]>([]);
  const [shift, setShift] = useState<GuardShiftView | null>(null);
  const [queue, setQueue] = useState<GuardQueueRow[]>([]);
  const [selectedPostId, setSelectedPostId] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [photoById, setPhotoById] = useState<Record<string, File | null>>({});

  const kindLabel = (k: string) => {
    const key = `guard.kind_${k}` as const;
    const v = t(key);
    return v === key ? k : v;
  };

  const statusLabel = (row: GuardQueueRow) => {
    const { kind, status, delivery_mode: mode } = row;
    if (kind === 'guest_pass') {
      if (status === 'pending') return t('guard.statusInfoPending');
      if (status === 'seen' || status === 'accepted') return t('guard.statusInfoSeen');
      if (status === 'done' || status === 'handed_over') return t('guard.statusInfoDone');
    } else if (isCourierPassFlow(kind, mode)) {
      if (status === 'pending') return t('guard.statusPassPending');
      if (status === 'seen' || status === 'accepted') return t('guard.statusPassSeen');
      if (status === 'done' || status === 'handed_over') return t('guard.statusPassDone');
    } else if (isHoldAtPostFlow(kind, mode)) {
      if (status === 'pending') return t('guard.statusParcelPending');
      if (status === 'seen') return t('guard.statusParcelSeen');
      if (status === 'at_post' || status === 'accepted') return t('guard.statusParcelAtPost');
      if (status === 'done' || status === 'handed_over') return t('guard.statusParcelDone');
    }
    const key = `guard.status_${status}` as const;
    const v = t(key);
    return v === key ? status : v;
  };

  const flowHint = (kind: string, mode?: string | null) => {
    if (kind === 'guest_pass') return t('guard.flowInfoHint');
    if (isCourierPassFlow(kind, mode)) return t('guard.flowPassHint');
    return t('guard.flowHoldHint');
  };

  const handoverLabel = (item: string | null) => {
    if (!item) return '';
    const key = `guard.handover_${item}` as const;
    const v = t(key);
    return v === key ? item : v;
  };

  const groupedQueue = useMemo(() => {
    const map = new Map<string, GuardQueueRow[]>();
    for (const kind of GUARD_QUEUE_KIND_ORDER) map.set(kind, []);
    for (const row of queue) {
      const key = GUARD_QUEUE_KIND_ORDER.includes(row.kind as (typeof GUARD_QUEUE_KIND_ORDER)[number])
        ? row.kind
        : 'guest_pass';
      const list = map.get(key) ?? [];
      list.push(row);
      map.set(key, list);
    }
    return GUARD_QUEUE_KIND_ORDER.map((kind) => ({
      kind,
      rows: map.get(kind) ?? [],
    })).filter((g) => g.rows.length > 0);
  }, [queue]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await supabase.auth.getUser();
      const email = normalizeEmail(data.user?.email ?? '');
      if (!email) {
        router.replace('/');
        return;
      }
      try {
        const access = await resolveAccess(email, supabase);
        if (cancelled) return;
        if (!access.isStaff || !isGuardRole(access.staff?.role)) {
          router.replace(access.isStaff ? '/admin' : access.isOwner ? '/account' : '/');
          return;
        }
        setStaffName(access.staff?.name ?? '');
        setAllowed(true);
      } catch {
        if (!cancelled) router.replace('/');
      } finally {
        if (!cancelled) setAuthReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router, supabase]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [postsRes, shiftRes] = await Promise.all([
        supabase.rpc('list_active_security_posts'),
        supabase.rpc('guard_my_shift'),
      ]);
      if (postsRes.error && !isMissingRelation(postsRes.error, 'list_active_security_posts')) {
        throw postsRes.error;
      }
      const postRows = (postsRes.data as SecurityPostOption[] | null) ?? [];
      setPosts(postRows);
      if (postRows.length === 1) setSelectedPostId(postRows[0].id);

      if (shiftRes.error && !isMissingRelation(shiftRes.error, 'guard_my_shift')) {
        throw shiftRes.error;
      }
      const shiftRow = Array.isArray(shiftRes.data) ? shiftRes.data[0] ?? null : null;
      setShift(shiftRow as GuardShiftView | null);

      if (shiftRow) {
        const qRes = await supabase.rpc('guard_list_post_queue');
        if (qRes.error) throw qRes.error;
        setQueue((qRes.data as GuardQueueRow[] | null) ?? []);
      } else {
        setQueue([]);
      }
    } catch (e: unknown) {
      setError(ownerVisibleError(e, t('guard.errGeneric')));
    } finally {
      setLoading(false);
    }
  }, [supabase, t]);

  useEffect(() => {
    if (allowed) void refresh();
  }, [allowed, refresh]);

  async function openShift() {
    const post = selectedPostId || (posts.length === 1 ? posts[0].id : '');
    if (!post) {
      setError(t('guard.postRequired'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { error: rpcErr } = await supabase.rpc('guard_open_shift', { p_post_id: post });
      if (rpcErr) throw rpcErr;
      await refresh();
    } catch (e: unknown) {
      setError(ownerVisibleError(e, t('guard.errGeneric')));
    } finally {
      setBusy(false);
    }
  }

  async function closeShift() {
    if (!confirm(t('guard.closeConfirm'))) return;
    setBusy(true);
    setError(null);
    try {
      const { error: rpcErr } = await supabase.rpc('guard_close_shift');
      if (rpcErr) throw rpcErr;
      await refresh();
    } catch (e: unknown) {
      setError(ownerVisibleError(e, t('guard.errGeneric')));
    } finally {
      setBusy(false);
    }
  }

  async function uploadOptionalPhoto(row: GuardQueueRow) {
    const file = photoById[row.id];
    if (!file) return null;
    try {
      const path = securityPhotoPath(row.property_id, file.name);
      await uploadPrivateFile(supabase, REQUEST_PHOTOS_BUCKET, path, file);
      return path;
    } catch (e: unknown) {
      const mapped = messageForUploadError(e, t('guard.photoTypeErr'), t('guard.photoSizeErr'));
      throw mapped ? new Error(mapped) : e;
    }
  }

  async function markSeen(row: GuardQueueRow) {
    setBusy(true);
    setError(null);
    try {
      const { error: rpcErr } = await supabase.rpc('guard_mark_seen', {
        p_request_id: row.id,
      });
      if (rpcErr) throw rpcErr;
      await refresh();
    } catch (e: unknown) {
      setError(ownerVisibleError(e, t('guard.errGeneric')));
    } finally {
      setBusy(false);
    }
  }

  async function receiveAtPost(row: GuardQueueRow) {
    setBusy(true);
    setError(null);
    try {
      const photoPath = await uploadOptionalPhoto(row);
      const { error: rpcErr } = await supabase.rpc('guard_receive_at_post', {
        p_request_id: row.id,
        p_photo_path: photoPath,
      });
      if (rpcErr) throw rpcErr;
      setPhotoById((prev) => ({ ...prev, [row.id]: null }));
      await refresh();
    } catch (e: unknown) {
      setError(ownerVisibleError(e, t('guard.errGeneric')));
    } finally {
      setBusy(false);
    }
  }

  async function complete(row: GuardQueueRow, mode: SecurityCompletionMode) {
    setBusy(true);
    setError(null);
    try {
      const wantsPhoto =
        isHoldAtPostFlow(row.kind, row.delivery_mode) ||
        isCourierPassFlow(row.kind, row.delivery_mode);
      const photoPath = wantsPhoto ? await uploadOptionalPhoto(row) : null;
      const { error: rpcErr } = await supabase.rpc('guard_complete_request', {
        p_request_id: row.id,
        p_photo_path: photoPath,
        p_completion_mode: mode,
      });
      if (rpcErr) throw rpcErr;
      setPhotoById((prev) => ({ ...prev, [row.id]: null }));
      await refresh();
    } catch (e: unknown) {
      setError(ownerVisibleError(e, t('guard.errGeneric')));
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await supabase.auth.signOut();
    router.replace('/');
  }

  function rowDetail(row: GuardQueueRow) {
    const modeHint =
      row.kind === 'delivery'
        ? row.delivery_mode === 'courier_pass'
          ? t('guard.modeCourierPass')
          : t('guard.modeHoldAtPost')
        : null;
    if (row.kind === 'guest_pass') {
      return [row.guest_name, row.expected_at ? formatOwnerDateTime(row.expected_at, locale) : null, row.note]
        .filter(Boolean)
        .join(' · ') || '—';
    }
    if (row.kind === 'delivery') {
      return [modeHint, row.courier_name, row.delivery_note, row.note].filter(Boolean).join(' · ') || '—';
    }
    return [row.handover_item ? handoverLabel(row.handover_item) : null, row.note]
      .filter(Boolean)
      .join(' · ') || '—';
  }

  function renderActions(row: GuardQueueRow) {
    const hold = isHoldAtPostFlow(row.kind, row.delivery_mode);
    const pass = isCourierPassFlow(row.kind, row.delivery_mode);
    const guest = row.kind === 'guest_pass';

    if (row.status === 'pending') {
      return (
        <AdminPrimaryButton type="button" disabled={busy} onClick={() => void markSeen(row)}>
          {t('guard.ackSeen')}
        </AdminPrimaryButton>
      );
    }

    if (guest && (row.status === 'seen' || row.status === 'accepted')) {
      return (
        <AdminPrimaryButton type="button" disabled={busy} onClick={() => void complete(row, 'done')}>
          {t('guard.markDone')}
        </AdminPrimaryButton>
      );
    }

    if (pass && (row.status === 'seen' || row.status === 'accepted')) {
      return (
        <AdminPrimaryButton
          type="button"
          disabled={busy}
          onClick={() => void complete(row, 'courier_passed')}
        >
          {t('guard.courierPassed')}
        </AdminPrimaryButton>
      );
    }

    if (hold && row.status === 'seen') {
      return (
        <AdminPrimaryButton type="button" disabled={busy} onClick={() => void receiveAtPost(row)}>
          {t('guard.receiveAtPost')}
        </AdminPrimaryButton>
      );
    }

    if (hold && (row.status === 'at_post' || row.status === 'accepted')) {
      return (
        <>
          <AdminPrimaryButton
            type="button"
            disabled={busy}
            onClick={() => void complete(row, 'handed_to_owner')}
          >
            {t('guard.handoverParcel')}
          </AdminPrimaryButton>
          <AdminSecondaryButton
            type="button"
            disabled={busy}
            onClick={() => void complete(row, 'owner_collected')}
          >
            {t('guard.ownerCollected')}
          </AdminSecondaryButton>
        </>
      );
    }

    return null;
  }

  function showPhotoInput(row: GuardQueueRow) {
    if (!isParcelGuardFlow(row.kind, row.delivery_mode)) return false;
    if (row.status === 'pending') return false;
    if (isHoldAtPostFlow(row.kind, row.delivery_mode)) {
      return row.status === 'seen' || row.status === 'at_post' || row.status === 'accepted';
    }
    return row.status === 'seen' || row.status === 'accepted';
  }

  if (!authReady || !allowed) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted">
        {t('common.loading')}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <BrandMark />
            <div>
              <p className="text-sm font-semibold">{t('guard.title')}</p>
              <p className="text-xs text-muted">{staffName || t('guard.role')}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <LanguageSwitcher />
            <button type="button" onClick={() => void logout()} className="text-sm text-accent hover:underline">
              {t('common.logout')}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-4 px-4 py-5">
        {error ? <AdminInlineAlert tone="danger">{error}</AdminInlineAlert> : null}

        {!shift ? (
          <section className={`${adminCardClass} space-y-4 p-4 md:p-5`}>
            <div>
              <h1 className="text-lg font-semibold">{t('guard.startShift')}</h1>
              <p className="mt-1 text-sm text-secondary">{t('guard.startShiftLead')}</p>
            </div>
            {loading ? (
              <p className="text-sm text-muted">{t('common.loading')}</p>
            ) : posts.length === 0 ? (
              <p className="text-sm text-muted">{t('guard.noPosts')}</p>
            ) : (
              <>
                {posts.length > 1 ? (
                  <label className="grid gap-1 text-sm text-secondary">
                    {t('guard.post')}
                    <select
                      className={adminFieldClass}
                      value={selectedPostId}
                      onChange={(e) => setSelectedPostId(e.target.value)}
                      disabled={busy}
                    >
                      <option value="">{t('guard.postPick')}</option>
                      {posts.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <p className="text-sm text-secondary">
                    {t('guard.post')}: <span className="font-medium text-foreground">{posts[0].name}</span>
                  </p>
                )}
                <AdminPrimaryButton type="button" disabled={busy} onClick={() => void openShift()}>
                  {busy ? t('common.saving') : t('guard.openShift')}
                </AdminPrimaryButton>
              </>
            )}
          </section>
        ) : (
          <>
            <section className={`${adminCardClass} flex flex-wrap items-center justify-between gap-3 p-4`}>
              <div>
                <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted">
                  {t('guard.onShift')}
                </p>
                <p className="mt-1 text-base font-semibold text-foreground">{shift.post_name}</p>
                <p className="text-xs text-muted">{formatOwnerDateTime(shift.started_at, locale)}</p>
              </div>
              <AdminSecondaryButton type="button" disabled={busy} onClick={() => void closeShift()}>
                {t('guard.closeShift')}
              </AdminSecondaryButton>
            </section>

            <section className="space-y-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-base font-semibold">
                  {t('guard.queue')}
                  {queue.length > 0 ? (
                    <span className="ml-2 text-sm font-normal text-muted">({queue.length})</span>
                  ) : null}
                </h2>
                <button
                  type="button"
                  className="text-sm text-accent hover:underline"
                  disabled={busy || loading}
                  onClick={() => void refresh()}
                >
                  {t('guard.refresh')}
                </button>
              </div>

              {loading ? (
                <p className="text-sm text-muted">{t('common.loading')}</p>
              ) : queue.length === 0 ? (
                <div className={`${adminCardClass} p-5 text-sm text-muted`}>{t('guard.queueEmpty')}</div>
              ) : (
                groupedQueue.map((group) => {
                  const pending = group.rows.filter((r) => r.status === 'pending').length;
                  const active = group.rows.filter((r) => r.status !== 'pending').length;
                  const sampleMode = group.rows[0]?.delivery_mode;
                  return (
                    <div key={group.kind} className="space-y-2">
                      <div className="flex flex-wrap items-baseline justify-between gap-2 px-0.5">
                        <h3 className="text-sm font-semibold text-foreground">{kindLabel(group.kind)}</h3>
                        <p className="text-xs text-muted">
                          {t('guard.groupCounts', { pending, active, total: group.rows.length })}
                        </p>
                      </div>
                      <p className="px-0.5 text-xs text-secondary">{flowHint(group.kind, sampleMode)}</p>
                      <ul className="space-y-3">
                        {group.rows.map((row) => (
                          <li key={row.id} className={`${adminCardClass} space-y-3 p-4`}>
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div>
                                <p className="text-sm font-semibold text-foreground">
                                  {t('guard.apt')} {row.apartment_number}
                                </p>
                                <p className="mt-0.5 text-xs text-muted">
                                  {formatOwnerDateTime(row.created_at, locale)}
                                </p>
                              </div>
                              <StatusBadge
                                label={statusLabel(row)}
                                tone={securityStatusTone(row.status)}
                              />
                            </div>
                            <p className="text-sm text-secondary">{rowDetail(row)}</p>

                            {showPhotoInput(row) ? (
                              <label className="grid gap-1 text-xs text-secondary">
                                {t('guard.photoOptional')}
                                <input
                                  type="file"
                                  accept="image/*"
                                  capture="environment"
                                  disabled={busy}
                                  className="block w-full text-sm text-foreground file:mr-3 file:rounded-md file:border-0 file:bg-surface-secondary file:px-3 file:py-1.5 file:text-sm"
                                  onChange={(e) => {
                                    const file = e.target.files?.[0] ?? null;
                                    setPhotoById((prev) => ({ ...prev, [row.id]: file }));
                                  }}
                                />
                                {photoById[row.id] ? (
                                  <span className="text-muted">{photoById[row.id]?.name}</span>
                                ) : null}
                              </label>
                            ) : null}

                            <div className="flex flex-wrap gap-2">{renderActions(row)}</div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}

export default function GuardPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center text-sm text-muted">…</div>
      }
    >
      <GuardCabinetInner />
    </Suspense>
  );
}
