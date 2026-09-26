'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
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
  isGuardRole,
  type GuardQueueRow,
  type GuardShiftView,
  type SecurityPostOption,
} from '@/lib/security';
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

  const kindLabel = (k: string) => {
    const key = `guard.kind_${k}` as const;
    const v = t(key);
    return v === key ? k : v;
  };

  const statusLabel = (s: string) => {
    const key = `guard.status_${s}` as const;
    const v = t(key);
    return v === key ? s : v;
  };

  const handoverLabel = (item: string | null) => {
    if (!item) return '';
    const key = `guard.handover_${item}` as const;
    const v = t(key);
    return v === key ? item : v;
  };

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

  async function accept(id: string) {
    setBusy(true);
    setError(null);
    try {
      const { error: rpcErr } = await supabase.rpc('guard_accept_request', { p_request_id: id });
      if (rpcErr) throw rpcErr;
      await refresh();
    } catch (e: unknown) {
      setError(ownerVisibleError(e, t('guard.errGeneric')));
    } finally {
      setBusy(false);
    }
  }

  async function handover(id: string) {
    setBusy(true);
    setError(null);
    try {
      const { error: rpcErr } = await supabase.rpc('guard_handover_request', { p_request_id: id });
      if (rpcErr) throw rpcErr;
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

            <section className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-base font-semibold">{t('guard.queue')}</h2>
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
                <ul className="space-y-3">
                  {queue.map((row) => (
                    <li key={row.id} className={`${adminCardClass} space-y-3 p-4`}>
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold text-foreground">
                            {kindLabel(row.kind)} · {t('guard.apt')} {row.apartment_number}
                          </p>
                          <p className="mt-0.5 text-xs text-muted">
                            {formatOwnerDateTime(row.created_at, locale)}
                          </p>
                        </div>
                        <StatusBadge
                          label={statusLabel(row.status)}
                          tone={row.status === 'pending' ? 'warning' : 'info'}
                        />
                      </div>
                      <p className="text-sm text-secondary">
                        {row.guest_name ||
                          row.courier_name ||
                          (row.handover_item ? handoverLabel(row.handover_item) : null) ||
                          row.note ||
                          row.delivery_note ||
                          '—'}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {row.status === 'pending' ? (
                          <AdminPrimaryButton
                            type="button"
                            disabled={busy}
                            onClick={() => void accept(row.id)}
                          >
                            {t('guard.accept')}
                          </AdminPrimaryButton>
                        ) : null}
                        <AdminSecondaryButton
                          type="button"
                          disabled={busy}
                          onClick={() => void handover(row.id)}
                        >
                          {t('guard.handover')}
                        </AdminSecondaryButton>
                      </div>
                    </li>
                  ))}
                </ul>
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
