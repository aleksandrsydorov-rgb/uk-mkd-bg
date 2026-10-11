'use client';

import { useEffect, useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@/lib/database.types';
import { useI18n } from '@/i18n/I18nProvider';
import { labelTransfer } from '@/i18n/labels';
import { type OwnerTransfer, type OwnershipTargetOwner } from '@/lib/ownership';
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
import { CompactCard, PrimaryButton, SectionHeader } from '@/components/account/ownerUi';
import {
  OwnershipCompare,
  OwnershipEmptyList,
  OwnershipHint,
  OwnershipProcessSteps,
  OwnershipSuccessBanner,
  OwnershipTransferCard,
  OwnershipWarningBanner,
  OwnershipWizardSteps,
  ownerDisplayName,
} from '@/components/ownership/OwnershipTransferUi';

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

function reasonTitle(reason: OwnershipChangeReason, t: (k: string) => string) {
  if (reason === 'sale') return t('xfer.reasonSale');
  if (reason === 'donation') return t('xfer.reasonDonation');
  if (reason === 'partial_transfer') return t('xfer.reasonPartial');
  if (reason === 'inheritance') return t('xfer.reasonInheritance');
  return t('xfer.reasonOther');
}

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
  const [step, setStep] = useState(0);
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
  const [justSubmitted, setJustSubmitted] = useState(false);

  const validation = useMemo(
    () => validateRosterForms(roster, idealPartsPercent),
    [roster, idealPartsPercent]
  );

  const currentOwners = useMemo(() => {
    const pending = pendingTransfer?.baseline_owners;
    if (Array.isArray(pending) && pending.length) return pending as OwnershipTargetOwner[];
    const approved = transfers.find(
      (tr) => tr.status === 'утверждена' && Array.isArray(tr.target_owners) && tr.target_owners.length
    );
    return (approved?.target_owners as OwnershipTargetOwner[] | undefined) ?? null;
  }, [pendingTransfer, transfers]);

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
      setStep(0);
      setJustSubmitted(true);
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
      setJustSubmitted(false);
    } catch (err: unknown) {
      if (isMissingRpcError(err)) onError(t('xfer.errMigrationRequired'));
      else onError(ownerVisibleError(err, t('xfer.errCancel')));
    } finally {
      setSubmitting(false);
    }
  }

  const mine = transfers.filter((tr) => tr.property_id === propertyId);
  const wizardLabels = [
    t('xfer.stepReason'),
    t('xfer.stepOwners'),
    t('xfer.stepDetails'),
    t('xfer.stepReview'),
  ];

  const fieldClass =
    'w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-placeholder focus:outline-none focus:ring-2 focus:ring-accent/30';

  return (
    <div className="space-y-4">
      <CompactCard className="space-y-3">
        <SectionHeader title={t('xfer.ownerTitle')} secondary={t('account.transferLead')} />
        <OwnershipProcessSteps
          steps={[
            { title: t('xfer.processStep1Title'), text: t('xfer.processStep1Text') },
            { title: t('xfer.processStep2Title'), text: t('xfer.processStep2Text') },
            { title: t('xfer.processStep3Title'), text: t('xfer.processStep3Text') },
          ]}
        />
        <OwnershipHint>{t('xfer.ownerProposeLead')}</OwnershipHint>
        <OwnershipHint>{t('xfer.idealPartsHint')}</OwnershipHint>
      </CompactCard>

      {rpcMissing ? (
        <OwnershipWarningBanner>{t('xfer.migrationPending')}</OwnershipWarningBanner>
      ) : null}

      {pendingTransfer ? (
        <OwnershipWarningBanner>
          <div className="space-y-2">
            <div className="font-medium">{t('account.transferPending')}</div>
            <div className="text-sm opacity-90">
              {t('account.newOwner')}:{' '}
              {Array.isArray(pendingTransfer.target_owners) && pendingTransfer.target_owners.length
                ? pendingTransfer.target_owners
                    .map((o) => ownerDisplayName(o as OwnershipTargetOwner))
                    .join(', ')
                : `${pendingTransfer.to_owner_name} (${pendingTransfer.to_owner_email})`}
            </div>
            <OwnershipCompare
              beforeLabel={t('xfer.compareBefore')}
              afterLabel={t('xfer.compareAfter')}
              before={pendingTransfer.baseline_owners as OwnershipTargetOwner[] | null}
              after={
                (pendingTransfer.target_owners as OwnershipTargetOwner[] | null) ??
                ([
                  {
                    entity_kind: 'natural_person',
                    first_name: pendingTransfer.to_owner_name,
                    email: pendingTransfer.to_owner_email,
                    ownership_share_percent: 100,
                    ideal_parts_percent: idealPartsPercent,
                  },
                ] as OwnershipTargetOwner[])
              }
              emptyBefore={t('xfer.compareEmptyBefore')}
              emptyAfter={t('xfer.compareEmptyAfter')}
              shareLabel={t('xfer.sharePercent')}
              idealLabel={t('xfer.idealParts')}
            />
            {sessionEmail &&
              (pendingTransfer.submitted_by_email ?? pendingTransfer.from_owner_email)?.toLowerCase() ===
                sessionEmail.toLowerCase() && (
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => void handleCancel(pendingTransfer)}
                  className="mt-1 rounded-full border border-border bg-surface px-4 py-2 text-xs font-medium text-foreground"
                >
                  {t('xfer.cancelRequest')}
                </button>
              )}
          </div>
        </OwnershipWarningBanner>
      ) : (
        <CompactCard className="space-y-4">
          {justSubmitted ? (
            <OwnershipSuccessBanner>{t('xfer.submitSuccess')}</OwnershipSuccessBanner>
          ) : null}
          <OwnershipWizardSteps steps={wizardLabels} current={step} />

          <form
            onSubmit={(e) => {
              if (step < 3) {
                e.preventDefault();
                return;
              }
              void handleSubmit(e);
            }}
            className="space-y-4"
          >
            {step === 0 && (
              <div className="space-y-3">
                <label className="block text-sm font-medium text-foreground">{t('xfer.stepReason')}</label>
                <select
                  className={fieldClass}
                  value={changeReason}
                  onChange={(e) => setChangeReason(e.target.value as OwnershipChangeReason)}
                >
                  {OWNERSHIP_CHANGE_REASONS.filter((r) => r !== 'correction').map((r) => (
                    <option key={r} value={r}>
                      {reasonTitle(r, t)}
                    </option>
                  ))}
                </select>
                <OwnershipHint>{t('xfer.reasonHint')}</OwnershipHint>
              </div>
            )}

            {step === 1 && (
              <div className="space-y-3">
                <label className="block text-sm font-medium text-foreground">{t('xfer.stepOwners')}</label>
                <OwnershipHint>{t('xfer.shareHint')}</OwnershipHint>
                <OwnershipRosterEditor
                  owners={roster}
                  onChange={setRoster}
                  propertyIdealParts={idealPartsPercent}
                  compact
                />
              </div>
            )}

            {step === 2 && (
              <div className="space-y-3">
                <label className="block text-sm font-medium text-foreground">{t('xfer.stepDetails')}</label>
                <input
                  className={fieldClass}
                  placeholder={t('account.phPhoneOpt')}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
                <textarea
                  className={fieldClass}
                  placeholder={t('account.phCommentUk')}
                  rows={3}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
                <OwnershipHint>{t('xfer.docsHintOwner')}</OwnershipHint>
              </div>
            )}

            {step === 3 && (
              <div className="space-y-3">
                <div className="rounded-[14px] border border-border bg-surface-secondary/40 px-3 py-3 text-sm">
                  <div className="font-medium text-foreground">{reasonTitle(changeReason, t)}</div>
                  {note ? <p className="mt-1 text-secondary">{note}</p> : null}
                  {phone ? <p className="mt-1 text-xs text-muted">{phone}</p> : null}
                </div>
                <OwnershipCompare
                  beforeLabel={t('xfer.compareBefore')}
                  afterLabel={t('xfer.compareAfter')}
                  before={currentOwners}
                  after={roster}
                  emptyBefore={t('xfer.compareEmptyBefore')}
                  emptyAfter={t('xfer.compareEmptyAfter')}
                  shareLabel={t('xfer.sharePercent')}
                  idealLabel={t('xfer.idealParts')}
                />
                {!validation.ok ? (
                  <OwnershipWarningBanner>{t('xfer.errRosterInvalid')}</OwnershipWarningBanner>
                ) : (
                  <OwnershipHint>{t('xfer.reviewHint')}</OwnershipHint>
                )}
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                disabled={step === 0 || submitting}
                onClick={() => setStep((s) => Math.max(0, s - 1))}
                className="rounded-full border border-border bg-surface px-4 py-2 text-sm text-secondary disabled:opacity-40"
              >
                {t('common.back')}
              </button>
              {step < 3 ? (
                <PrimaryButton
                  type="button"
                  disabled={step === 1 && !validation.ok}
                  onClick={() => setStep((s) => Math.min(3, s + 1))}
                >
                  {t('xfer.nextStep')}
                </PrimaryButton>
              ) : (
                <PrimaryButton type="submit" disabled={submitting || !validation.ok || scopeLocked}>
                  {submitting ? t('account.sending') : t('account.submitTransfer')}
                </PrimaryButton>
              )}
            </div>
          </form>
        </CompactCard>
      )}

      <CompactCard className="space-y-3">
        <div className="text-sm font-semibold text-foreground">{t('account.transferHistory')}</div>
        {mine.length === 0 ? (
          <OwnershipEmptyList title={t('xfer.emptyOwnerHistory')} text={t('xfer.emptyOwnerHistoryText')} />
        ) : (
          <div className="space-y-2">
            {mine.slice(0, 8).map((tr) => (
              <OwnershipTransferCard
                key={tr.id}
                title={
                  Array.isArray(tr.target_owners) && tr.target_owners.length
                    ? tr.target_owners
                        .map((o) => ownerDisplayName(o as OwnershipTargetOwner))
                        .join(', ')
                    : tr.to_owner_name
                }
                subtitle={tr.to_owner_email}
                status={tr.status}
                statusLabel={labelTransfer(tr.status, t)}
                note={tr.note}
                rejectReason={tr.reject_reason}
                meta={
                  <>
                    <span className="rounded-full border border-border bg-surface-secondary px-2 py-0.5">
                      {reasonTitle((tr.change_reason as OwnershipChangeReason) || 'sale', t)}
                    </span>
                  </>
                }
              />
            ))}
          </div>
        )}
      </CompactCard>

      <OwnerOwnershipExtractsPanel
        supabase={supabase}
        propertyId={propertyId}
        sessionEmail={sessionEmail}
        onError={onError}
      />
    </div>
  );
}
