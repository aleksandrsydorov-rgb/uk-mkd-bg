'use client';

import { useEffect, useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@/lib/database.types';
import { useI18n } from '@/i18n/I18nProvider';
import { labelTransfer } from '@/i18n/labels';
import { transferStatusClass, type OwnerTransfer } from '@/lib/ownership';
import { ownerVisibleError } from '@/lib/ownerError';
import {
  OWNERSHIP_CHANGE_REASONS,
  emptyRosterOwner,
  formsToTargetOwners,
  isMissingRpcError,
  probePkgXferRpcAvailability,
  validateRosterForms,
  type OwnershipChangeReason,
  type RosterOwnerForm,
} from '@/lib/ownershipChange';
import { OwnershipRosterEditor } from '@/components/ownership/OwnershipRosterEditor';
import { OwnerOwnershipExtractsPanel } from '@/components/account/OwnerOwnershipExtractsPanel';

type Props = {
  supabase: SupabaseClient<Database>;
  propertyId: number;
  idealPartsPercent: number;
  transfers: OwnerTransfer[];
  pendingTransfer: OwnerTransfer | null;
  sessionEmail: string | null;
  scopeLocked: boolean;
  onTransfersChanged: (rows: OwnerTransfer[]) => void;
  onError: (message: string) => void;
};

export function OwnerOwnershipPanel({
  supabase,
  propertyId,
  idealPartsPercent,
  transfers,
  pendingTransfer,
  sessionEmail,
  scopeLocked,
  onTransfersChanged,
  onError,
}: Props) {
  const { t } = useI18n();
  const [roster, setRoster] = useState<RosterOwnerForm[]>([
    {
      ...emptyRosterOwner(String(idealPartsPercent || '')),
      ownership_share_percent: '100',
      ideal_parts_percent: String(idealPartsPercent || ''),
    },
  ]);
  const [changeReason, setChangeReason] = useState<OwnershipChangeReason>('sale');
  const [note, setNote] = useState('');
  const [phone, setPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [rpcMissing, setRpcMissing] = useState(false);

  const validation = useMemo(
    () => validateRosterForms(roster, idealPartsPercent),
    [roster, idealPartsPercent]
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const status = await probePkgXferRpcAvailability(supabase, {
        role: 'owner',
        propertyId,
      });
      if (!cancelled) setRpcMissing(status === 'missing');
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, propertyId]);

  // Keep blank proposal ideals aligned with the Book object after cancel/submit reset.
  useEffect(() => {
    if (pendingTransfer) return;
    setRoster((prev) => {
      if (prev.length !== 1) return prev;
      const only = prev[0];
      const nextIdeal = String(idealPartsPercent || '');
      if (only.ideal_parts_percent === nextIdeal) return prev;
      return [{ ...only, ideal_parts_percent: nextIdeal }];
    });
  }, [idealPartsPercent, pendingTransfer]);

  async function reloadTransfers() {
    const { data } = await supabase
      .from('owner_transfers')
      .select('*')
      .eq('property_id', propertyId)
      .order('created_at', { ascending: false });
    onTransfersChanged((data as OwnerTransfer[]) ?? []);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (scopeLocked) {
      onError(t('account.serviceLockBanner'));
      return;
    }
    if (!validation.ok) {
      onError(t('xfer.errRosterInvalid'));
      return;
    }
    setSubmitting(true);
    try {
      const targets = formsToTargetOwners(roster);
      const { error } = await supabase.rpc('submit_ownership_change', {
        p_property_id: propertyId,
        p_target_owners: targets as unknown as Json,
        p_change_kind: changeReason === 'inheritance' ? 'inheritance' : 'ordinary',
        p_change_reason: changeReason,
        p_note: note.trim() || null,
        p_to_owner_phone: phone.trim() || null,
        p_as_admin: false,
      });
      if (error) throw error;
      await reloadTransfers();
      setRoster([
        {
          ...emptyRosterOwner(String(idealPartsPercent || '')),
          ownership_share_percent: '100',
          ideal_parts_percent: String(idealPartsPercent || ''),
        },
      ]);
      setNote('');
      setPhone('');
      setChangeReason('sale');
    } catch (err: unknown) {
      if (isMissingRpcError(err)) onError(t('xfer.errMigrationRequired'));
      else onError(ownerVisibleError(err, t('err.transfer')));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCancel(tr: OwnerTransfer) {
    if (!sessionEmail) return;
    setSubmitting(true);
    try {
      const { error } = await supabase.rpc('cancel_ownership_change', {
        p_transfer_id: tr.id,
      });
      if (error) throw error;
      await reloadTransfers();
    } catch (err: unknown) {
      if (isMissingRpcError(err)) onError(t('xfer.errMigrationRequired'));
      else onError(ownerVisibleError(err, t('xfer.errCancel')));
    } finally {
      setSubmitting(false);
    }
  }

  const mine = transfers.filter((tr) => tr.property_id === propertyId);

  return (
    <div className="rounded-xl border border-border bg-background px-3 py-3 space-y-4">
      <p className="text-sm text-secondary">{t('account.transferLead')}</p>
      <p className="text-xs text-muted">{t('xfer.ownerProposeLead')}</p>
      {rpcMissing ? (
        <div className="rounded-lg border border-warning/25 bg-warning-bg px-3 py-2 text-xs text-warning">
          {t('xfer.migrationPending')}
        </div>
      ) : null}

      {pendingTransfer ? (
        <div className="rounded-xl border border-warning/25 bg-warning-bg p-3 text-sm text-warning">
          {t('account.transferPending')}
          <div className="mt-2 text-secondary">
            {t('account.newOwner')}: {pendingTransfer.to_owner_name} ({pendingTransfer.to_owner_email})
          </div>
          {Array.isArray(pendingTransfer.target_owners) && pendingTransfer.target_owners.length > 1 && (
            <div className="mt-1 text-xs text-muted">
              {t('xfer.multiOwners', { n: pendingTransfer.target_owners.length })}
            </div>
          )}
          {sessionEmail &&
            (pendingTransfer.submitted_by_email ?? pendingTransfer.from_owner_email)?.toLowerCase() ===
              sessionEmail.toLowerCase() && (
              <button
                type="button"
                disabled={submitting}
                onClick={() => void handleCancel(pendingTransfer)}
                className="mt-3 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs text-foreground"
              >
                {t('xfer.cancelRequest')}
              </button>
            )}
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-3">
          <select
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
            value={changeReason}
            onChange={(e) => setChangeReason(e.target.value as OwnershipChangeReason)}
          >
            {OWNERSHIP_CHANGE_REASONS.filter((r) => r !== 'correction').map((r) => (
              <option key={r} value={r}>
                {r === 'sale'
                  ? t('xfer.reasonSale')
                  : r === 'donation'
                    ? t('xfer.reasonDonation')
                    : r === 'partial_transfer'
                      ? t('xfer.reasonPartial')
                      : r === 'inheritance'
                        ? t('xfer.reasonInheritance')
                        : t('xfer.reasonOther')}
              </option>
            ))}
          </select>

          <OwnershipRosterEditor
            owners={roster}
            onChange={setRoster}
            propertyIdealParts={idealPartsPercent}
            compact
          />

          <input
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
            placeholder={t('account.phPhoneOpt')}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          <textarea
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
            placeholder={t('account.phCommentUk')}
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <button
            type="submit"
            disabled={submitting || !validation.ok}
            className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
          >
            {submitting ? t('account.sending') : t('account.submitTransfer')}
          </button>
        </form>
      )}

      {mine.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs text-muted">{t('account.transferHistory')}</div>
          {mine.slice(0, 8).map((tr) => (
            <div key={tr.id} className="rounded-lg border border-border bg-surface px-3 py-2 text-xs">
              <span className={transferStatusClass(tr.status)}>{labelTransfer(tr.status, t)}</span>
              {' · '}
              {tr.to_owner_name} ({tr.to_owner_email})
              {tr.reject_reason ? ` · ${tr.reject_reason}` : ''}
            </div>
          ))}
        </div>
      )}

      <OwnerOwnershipExtractsPanel
        supabase={supabase}
        propertyId={propertyId}
        sessionEmail={sessionEmail}
        onError={onError}
      />
    </div>
  );
}
