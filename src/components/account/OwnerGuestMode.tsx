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

export const GUEST_RELATION_TYPES = [
  'living_with_owner',
  'co_owner',
  'long_term_tenant',
  'short_term_tenant',
] as const;

export type GuestRelationType = (typeof GUEST_RELATION_TYPES)[number];

type GuestAccessRow = Database['public']['Tables']['property_guest_accesses']['Row'];

function statusTone(status: string): 'neutral' | 'info' | 'success' | 'warning' | 'danger' {
  if (status === 'active') return 'success';
  if (status === 'pending') return 'warning';
  if (status === 'revoked') return 'danger';
  if (status === 'expired') return 'neutral';
  return 'neutral';
}

export function OwnerGuestMode({
  supabase,
  propertyId,
}: {
  supabase: SupabaseClient<Database>;
  propertyId: number;
}) {
  const { t, dateLocale } = useI18n();
  const [rows, setRows] = useState<GuestAccessRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const [email, setEmail] = useState('');
  const [relationType, setRelationType] = useState<GuestRelationType>('living_with_owner');
  const [validFrom, setValidFrom] = useState('');
  const [validUntil, setValidUntil] = useState('');

  const fieldClass =
    'w-full min-h-10 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent/30';

  const activeCount = useMemo(
    () => rows.filter((r) => r.status === 'active').length,
    [rows],
  );

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

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcErr } = await supabase.rpc('owner_list_guest_accesses', {
        p_property_id: propertyId,
      });
      if (rpcErr && !isMissingRelation(rpcErr, 'owner_list_guest_accesses')) {
        throw rpcErr;
      }
      setRows((data as GuestAccessRow[] | null) ?? []);
    } catch (e: unknown) {
      setError(ownerVisibleError(e, t('err.loadApt')));
    } finally {
      setLoading(false);
    }
  }, [propertyId, supabase, t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (activeCount >= 2) {
      setError(t('account.guestModeActiveLimit'));
      return;
    }
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const { error: rpcErr } = await supabase.rpc('owner_create_guest_access', {
        p_property_id: propertyId,
        p_email: email.trim(),
        p_relation_type: relationType,
        p_valid_from: validFrom ? new Date(validFrom).toISOString() : undefined,
        p_valid_until: validUntil ? new Date(validUntil).toISOString() : undefined,
      });
      if (rpcErr) throw rpcErr;
      setEmail('');
      setValidFrom('');
      setValidUntil('');
      setOk(t('account.guestModeCreated'));
      await load();
    } catch (err: unknown) {
      setError(ownerVisibleError(err, t('err.save')));
    } finally {
      setBusy(false);
    }
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
      setError(ownerVisibleError(err, t('err.save')));
    } finally {
      setBusy(false);
    }
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
            <label className="mb-1 block text-sm text-secondary">{t('account.guestModeValidUntil')}</label>
            <input
              type="date"
              className={fieldClass}
              value={validUntil}
              onChange={(e) => setValidUntil(e.target.value)}
              disabled={busy || activeCount >= 2}
            />
          </div>
        </div>
        <PrimaryButton type="submit" disabled={busy || activeCount >= 2 || !email.trim()}>
          {busy ? t('common.saving') : t('account.guestModeAdd')}
        </PrimaryButton>
        {activeCount >= 2 ? (
          <p className="text-xs text-warning">{t('account.guestModeActiveLimit')}</p>
        ) : null}
      </form>

      {loading ? (
        <p className="text-sm text-muted">{t('common.loading')}</p>
      ) : rows.length === 0 ? (
        <EmptyState title={t('account.guestModeEmpty')} />
      ) : (
        <div className="space-y-2">
          {rows.map((row) => (
            <CompactCard key={row.id} className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">{row.email}</p>
                <p className="mt-0.5 text-xs text-secondary">{relationLabel(row.relation_type)}</p>
                <p className="mt-1 text-xs text-muted">
                  {formatOwnerDate(row.valid_from, dateLocale)}
                  {row.valid_until
                    ? ` — ${formatOwnerDate(row.valid_until, dateLocale)}`
                    : ` · ${t('account.guestModeOpenEnded')}`}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-2">
                <StatusBadge label={statusLabel(row.status)} tone={statusTone(row.status)} />
                {row.status === 'active' || row.status === 'pending' ? (
                  <TextLinkButton onClick={() => void handleRevoke(row.id)}>
                    {t('account.guestModeRevoke')}
                  </TextLinkButton>
                ) : null}
              </div>
            </CompactCard>
          ))}
        </div>
      )}
    </div>
  );
}
