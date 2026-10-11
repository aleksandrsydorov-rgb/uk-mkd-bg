'use client';

import { useCallback, useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { useI18n } from '@/i18n/I18nProvider';
import { formatOwnerDateTime } from '@/lib/ownerFormat';
import { isMissingRpcError } from '@/lib/ownershipChange';
import {
  AdminCard,
  AdminEmptyState,
  AdminInlineAlert,
  AdminPrimaryButton,
  AdminSecondaryButton,
} from '@/components/admin/AdminUi';

type ExtractRow = Database['public']['Tables']['property_book_extracts']['Row'];

type Props = {
  supabase: SupabaseClient<Database>;
  canManage: boolean;
  propertyLabel: (id: number) => string;
  onError: (message: string) => void;
};

export function AdminCertifiedExtracts({
  supabase,
  canManage,
  propertyLabel,
  onError,
}: Props) {
  const { t, locale } = useI18n();
  const [rows, setRows] = useState<ExtractRow[]>([]);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [open, setOpen] = useState(false);

  const reload = useCallback(async () => {
    if (!canManage) return;
    const { data, error } = await supabase.rpc('admin_list_certified_extract_requests');
    if (error) {
      if (!isMissingRpcError(error)) onError(error.message);
      return;
    }
    setRows((data as ExtractRow[]) ?? []);
  }, [supabase, canManage, onError]);

  useEffect(() => {
    if (open) void reload();
  }, [open, reload]);

  async function fulfill(id: number) {
    setBusyId(id);
    try {
      const { error } = await supabase.rpc('admin_fulfill_certified_extract', {
        p_extract_id: id,
        p_note: null,
      });
      if (error) throw error;
      await reload();
    } catch (err: unknown) {
      if (isMissingRpcError(err)) onError(t('xfer.errMigrationRequired'));
      else onError(err instanceof Error ? err.message : t('xfer.errExtract'));
    } finally {
      setBusyId(null);
    }
  }

  async function reject(id: number) {
    const reason = window.prompt(t('xfer.rejectReasonPrompt'));
    if (reason == null) return;
    if (!reason.trim()) {
      onError(t('xfer.errRejectReason'));
      return;
    }
    setBusyId(id);
    try {
      const { error } = await supabase.rpc('admin_reject_certified_extract', {
        p_extract_id: id,
        p_reason: reason.trim(),
      });
      if (error) throw error;
      await reload();
    } catch (err: unknown) {
      if (isMissingRpcError(err)) onError(t('xfer.errMigrationRequired'));
      else onError(err instanceof Error ? err.message : t('xfer.errExtract'));
    } finally {
      setBusyId(null);
    }
  }

  if (!canManage) return null;

  const pending = rows.filter((r) => r.certified_request_status === 'requested').length;

  return (
    <AdminCard>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-secondary">
          {t('xfer.certifiedAdminTitle')} ({pending})
        </div>
        <AdminSecondaryButton type="button" onClick={() => setOpen((v) => !v)}>
          {open ? t('xfer.hide') : t('xfer.show')}
        </AdminSecondaryButton>
      </div>
      <p className="mt-2 text-xs text-muted">{t('xfer.certifiedAdminLead')}</p>
      <AdminInlineAlert tone="info">{t('xfer.certifiedNoFakeSign')}</AdminInlineAlert>

      {open && (
        <div className="mt-3 space-y-2">
          {rows.length === 0 ? (
            <AdminEmptyState title={t('xfer.noCertifiedRequests')} />
          ) : (
            rows.map((r) => (
              <div
                key={r.id}
                className="flex flex-wrap items-start justify-between gap-2 rounded-[14px] border border-border bg-surface p-3"
              >
                <div className="text-xs text-secondary">
                  <div className="text-sm text-foreground">{propertyLabel(r.property_id)}</div>
                  <div>{r.extract_number}</div>
                  <div>
                    {r.certified_request_status} ·{' '}
                    {r.is_signed ? t('xfer.signed') : t('xfer.unsigned')}
                    {r.has_pdf ? ` · ${t('xfer.pdfReady')}` : ` · ${t('xfer.pdfNotAttached')}`}
                  </div>
                  <div className="text-muted">
                    {r.generated_by_email} · {formatOwnerDateTime(r.generated_at, locale)}
                  </div>
                  {r.note && <div className="mt-1">{r.note}</div>}
                </div>
                {r.certified_request_status === 'requested' && (
                  <div className="flex gap-2">
                    <AdminPrimaryButton
                      type="button"
                      disabled={busyId === r.id}
                      onClick={() => void fulfill(r.id)}
                    >
                      {t('xfer.fulfillCertified')}
                    </AdminPrimaryButton>
                    <AdminSecondaryButton
                      type="button"
                      disabled={busyId === r.id}
                      onClick={() => void reject(r.id)}
                    >
                      {t('admin.reject')}
                    </AdminSecondaryButton>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </AdminCard>
  );
}
