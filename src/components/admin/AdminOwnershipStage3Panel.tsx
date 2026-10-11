'use client';

import { useCallback, useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { useI18n } from '@/i18n/I18nProvider';
import {
  AdminCard,
  AdminInlineAlert,
  AdminPrimaryButton,
  AdminSecondaryButton,
  adminFieldClass,
} from '@/components/admin/AdminUi';
import {
  BUILDING_DOCUMENTS_BUCKET,
  MAX_BUILDING_DOCUMENT_BYTES,
  buildPrivateStoragePath,
} from '@/lib/buildingDocuments';
import { isMissingRpcError } from '@/lib/ownershipChange';

type PropertyOpt = {
  id: number;
  apartment_number: string | number | null;
};

type BookOwner = {
  id: number;
  property_id: number;
  entity_kind: string;
  first_name: string | null;
  last_name: string | null;
  entity_name: string | null;
  email: string | null;
  admin_status: string;
  voting_eligible: boolean;
  ownership_share_percent: number | null;
};

type Liability = {
  id: number;
  property_id: number;
  heir_email: string | null;
  heir_name: string | null;
  amount_eur: number;
  accepted_status: string;
  inventory_limited: boolean;
  obligation_ref: string | null;
  decision_document_ref: string | null;
  confirmed_at: string | null;
};

type GuestAccess = {
  id: string;
  property_id: number;
  email: string;
  status: string;
  valid_until: string | null;
};

type DebtStatus = {
  overdue_unpaid_eur?: number;
  future_due_eur?: number;
  blocks_ordinary?: boolean;
  ordinary_debt_gate_enabled?: boolean;
  reason?: string | null;
};

type Props = {
  supabase: SupabaseClient<Database>;
  properties: PropertyOpt[];
  canManage: boolean;
  sessionEmail: string | null;
  onError: (message: string) => void;
  onChanged: () => Promise<void>;
};

function ownerLabel(o: BookOwner) {
  if (o.entity_kind === 'legal_entity' || o.entity_kind === 'sole_trader') {
    return o.entity_name || o.email || `#${o.id}`;
  }
  return [o.first_name, o.last_name].filter(Boolean).join(' ') || o.email || `#${o.id}`;
}

export function AdminOwnershipStage3Panel({
  supabase,
  properties,
  canManage,
  sessionEmail,
  onError,
  onChanged,
}: Props) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [propertyId, setPropertyId] = useState('');
  const [owners, setOwners] = useState<BookOwner[]>([]);
  const [liabilities, setLiabilities] = useState<Liability[]>([]);
  const [guests, setGuests] = useState<GuestAccess[]>([]);
  const [debt, setDebt] = useState<DebtStatus | null>(null);
  const [gateEnabled, setGateEnabled] = useState(false);
  const [busy, setBusy] = useState(false);

  const [pendingOwnerId, setPendingOwnerId] = useState('');
  const [markDeceased, setMarkDeceased] = useState(false);
  const [deathDocType, setDeathDocType] = useState('');
  const [deathDocNumber, setDeathDocNumber] = useState('');
  const [deathDocDate, setDeathDocDate] = useState('');
  const [deathFile, setDeathFile] = useState<File | null>(null);

  const [guestEmail, setGuestEmail] = useState('');
  const [guestUntil, setGuestUntil] = useState('');

  const [liabHeirEmail, setLiabHeirEmail] = useState('');
  const [liabHeirName, setLiabHeirName] = useState('');
  const [liabAmount, setLiabAmount] = useState('');
  const [liabObligationRef, setLiabObligationRef] = useState('');
  const [liabBasisType, setLiabBasisType] = useState('');
  const [liabBasisNumber, setLiabBasisNumber] = useState('');
  const [liabBasisDate, setLiabBasisDate] = useState('');
  const [liabInventory, setLiabInventory] = useState(false);

  const [repOwnerId, setRepOwnerId] = useState('');
  const [repName, setRepName] = useState('');
  const [repEmail, setRepEmail] = useState('');
  const [repDocType, setRepDocType] = useState('');
  const [repDocNumber, setRepDocNumber] = useState('');
  const [repDocDate, setRepDocDate] = useState('');
  const [repFile, setRepFile] = useState<File | null>(null);

  const pid = Number(propertyId) || 0;

  async function uploadDoc(file: File, titlePrefix: string): Promise<string> {
    if (file.size > MAX_BUILDING_DOCUMENT_BYTES) {
      throw new Error(t('docs.fileTooLarge'));
    }
    const built = buildPrivateStoragePath({
      scopeId: crypto.randomUUID(),
      file,
      folder: 'documents',
    });
    if (!built.ok) throw new Error(t('docs.uploadFailed'));
    const up = await supabase.storage
      .from(BUILDING_DOCUMENTS_BUCKET)
      .upload(built.storagePath, file, { upsert: false });
    if (up.error) throw new Error(up.error.message);
    const { error: docErr } = await supabase.from('building_documents').insert({
      id: built.objectId,
      category: 'other',
      title: `${titlePrefix}: ${built.originalName}`,
      storage_path: built.storagePath,
      mime_type: file.type || null,
      file_size: file.size,
      status: 'draft',
      created_by_email: sessionEmail,
    });
    if (docErr) {
      await supabase.storage.from(BUILDING_DOCUMENTS_BUCKET).remove([built.storagePath]);
      throw new Error(docErr.message);
    }
    return built.storagePath;
  }

  const reload = useCallback(async () => {
    if (!pid) {
      setOwners([]);
      setLiabilities([]);
      setGuests([]);
      setDebt(null);
      return;
    }
    const [ownersRes, debtRes, settingsRes, liabRes, guestRes] = await Promise.all([
      supabase
        .from('property_registry_people')
        .select(
          'id, property_id, entity_kind, first_name, last_name, entity_name, email, admin_status, voting_eligible, ownership_share_percent'
        )
        .eq('property_id', pid)
        .eq('relation_type', 'owner')
        .is('deregistered_at', null)
        .order('id', { ascending: true }),
      supabase.rpc('admin_get_ownership_debt_status', { p_property_id: pid }),
      supabase.rpc('admin_get_ownership_change_settings'),
      supabase
        .from('ownership_inherited_liabilities')
        .select(
          'id, property_id, heir_email, heir_name, amount_eur, accepted_status, inventory_limited, obligation_ref, decision_document_ref, confirmed_at'
        )
        .eq('property_id', pid)
        .order('id', { ascending: false }),
      supabase
        .from('property_guest_accesses')
        .select('id, property_id, email, status, valid_until')
        .eq('property_id', pid)
        .in('status', ['active', 'pending'])
        .order('created_at', { ascending: false }),
    ]);

    if (ownersRes.error) onError(ownersRes.error.message);
    else setOwners((ownersRes.data ?? []) as BookOwner[]);

    if (!debtRes.error && debtRes.data && typeof debtRes.data === 'object') {
      setDebt(debtRes.data as DebtStatus);
    } else if (debtRes.error && !isMissingRpcError(debtRes.error)) {
      onError(debtRes.error.message);
    }

    if (!settingsRes.error && settingsRes.data) {
      const row = settingsRes.data as { ordinary_debt_gate_enabled?: boolean };
      setGateEnabled(Boolean(row.ordinary_debt_gate_enabled));
    }

    if (!liabRes.error) setLiabilities((liabRes.data ?? []) as Liability[]);
    if (!guestRes.error) setGuests((guestRes.data ?? []) as GuestAccess[]);
  }, [pid, supabase, onError]);

  useEffect(() => {
    if (open && pid) void reload();
  }, [open, pid, reload]);

  async function handlePendingInheritance(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage || !pendingOwnerId) return;
    setBusy(true);
    try {
      let deathPath: string | null = null;
      if (markDeceased) {
        if (!deathDocType.trim() || !deathDocNumber.trim() || !deathDocDate || !deathFile) {
          onError(t('xfer.errDeathDocsRequired'));
          return;
        }
        deathPath = await uploadDoc(deathFile, `Death ${pendingOwnerId}`);
      }
      const { error } = await supabase.rpc('admin_set_inheritance_pending', {
        p_registry_people_id: Number(pendingOwnerId),
        p_mark_deceased: markDeceased,
        p_note: null,
        p_death_document_type: markDeceased ? deathDocType.trim() : null,
        p_death_document_number: markDeceased ? deathDocNumber.trim() : null,
        p_death_document_date: markDeceased ? deathDocDate : null,
        p_death_document_path: deathPath,
      });
      if (error) throw error;
      await reload();
      await onChanged();
    } catch (err: unknown) {
      if (isMissingRpcError(err)) onError(t('xfer.errMigrationRequired'));
      else onError(err instanceof Error ? err.message : t('xfer.errPendingInheritance'));
    } finally {
      setBusy(false);
    }
  }

  async function handleGrantGuest(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage || !pid || !guestEmail.trim()) return;
    setBusy(true);
    try {
      const { error } = await supabase.rpc('admin_grant_inheritance_guest_access', {
        p_property_id: pid,
        p_email: guestEmail.trim().toLowerCase(),
        p_valid_until: guestUntil ? new Date(guestUntil).toISOString() : null,
        p_note: 'inheritance_temporary_occupant',
      });
      if (error) throw error;
      setGuestEmail('');
      await reload();
    } catch (err: unknown) {
      if (isMissingRpcError(err)) onError(t('xfer.errMigrationRequired'));
      else onError(err instanceof Error ? err.message : t('xfer.errGuestGrant'));
    } finally {
      setBusy(false);
    }
  }

  async function handleRevokeGuest(accessId: string) {
    if (!canManage) return;
    setBusy(true);
    try {
      const { error } = await supabase.rpc('admin_revoke_inheritance_guest_access', {
        p_access_id: accessId,
      });
      if (error) throw error;
      await reload();
    } catch (err: unknown) {
      if (isMissingRpcError(err)) onError(t('xfer.errMigrationRequired'));
      else onError(err instanceof Error ? err.message : t('xfer.errGuestRevoke'));
    } finally {
      setBusy(false);
    }
  }

  async function handleRecordLiability(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage || !pid) return;
    if (!liabAmount || !liabBasisType.trim() || !liabBasisNumber.trim() || !liabBasisDate) {
      onError(t('xfer.errLiabilityFields'));
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.rpc('admin_record_inherited_liability', {
        p_property_id: pid,
        p_heir_email: liabHeirEmail.trim() || null,
        p_heir_name: liabHeirName.trim() || null,
        p_amount_eur: Number(liabAmount),
        p_basis_document_type: liabBasisType.trim(),
        p_basis_document_number: liabBasisNumber.trim(),
        p_basis_document_date: liabBasisDate,
        p_obligation_ref: liabObligationRef.trim() || null,
        p_accepted_status: 'recorded',
        p_inventory_limited: liabInventory,
        p_decision_document_ref: null,
        p_transfer_id: null,
        p_note: null,
      });
      if (error) throw error;
      setLiabAmount('');
      setLiabObligationRef('');
      await reload();
    } catch (err: unknown) {
      if (isMissingRpcError(err)) onError(t('xfer.errMigrationRequired'));
      else onError(err instanceof Error ? err.message : t('xfer.errLiabilityConfirm'));
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirmLiability(id: number, status: string) {
    if (!canManage) return;
    setBusy(true);
    try {
      const { error } = await supabase.rpc('admin_confirm_inherited_liability', {
        p_liability_id: id,
        p_accepted_status: status,
        p_confirmed_amount_eur: null,
        p_decision_document_ref: null,
        p_inventory_limited: status === 'inventory_limited' ? true : null,
        p_note: null,
      });
      if (error) throw error;
      await reload();
    } catch (err: unknown) {
      if (isMissingRpcError(err)) onError(t('xfer.errMigrationRequired'));
      else onError(err instanceof Error ? err.message : t('xfer.errLiabilityConfirm'));
    } finally {
      setBusy(false);
    }
  }

  async function handleRepresentative(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage || !repOwnerId) return;
    if (
      !repName.trim() ||
      !repEmail.trim() ||
      !repDocType.trim() ||
      !repDocNumber.trim() ||
      !repDocDate ||
      !repFile
    ) {
      onError(t('xfer.errRepDocsRequired'));
      return;
    }
    setBusy(true);
    try {
      const path = await uploadDoc(repFile, `Representative ${repOwnerId}`);
      const { error } = await supabase.rpc('admin_update_legal_entity_representative', {
        p_registry_people_id: Number(repOwnerId),
        p_representative_name: repName.trim(),
        p_representative_email: repEmail.trim().toLowerCase(),
        p_document_type: repDocType.trim(),
        p_document_number: repDocNumber.trim(),
        p_document_date: repDocDate,
        p_supporting_document_path: path,
        p_note: null,
      });
      if (error) throw error;
      setRepName('');
      setRepEmail('');
      setRepFile(null);
      await reload();
      await onChanged();
    } catch (err: unknown) {
      if (isMissingRpcError(err)) onError(t('xfer.errMigrationRequired'));
      else onError(err instanceof Error ? err.message : t('xfer.errRepresentative'));
    } finally {
      setBusy(false);
    }
  }

  const legalOwners = owners.filter((o) => o.entity_kind === 'legal_entity');
  const pendingOwners = owners.filter(
    (o) => o.admin_status === 'pending_inheritance' || o.admin_status === 'deceased_recorded'
  );

  if (!canManage) return null;

  return (
    <AdminCard>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-secondary">{t('xfer.stage3Title')}</div>
        <AdminSecondaryButton type="button" onClick={() => setOpen((v) => !v)}>
          {open ? t('xfer.hide') : t('xfer.show')}
        </AdminSecondaryButton>
      </div>
      <p className="mt-2 text-xs text-muted">{t('xfer.stage3Lead')}</p>

      {open && (
        <div className="mt-3 space-y-4">
          <select
            className={adminFieldClass}
            value={propertyId}
            onChange={(e) => setPropertyId(e.target.value)}
          >
            <option value="">{t('xfer.pickProperty')}</option>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {t('picker.apt', { n: p.apartment_number ?? p.id })} (#{p.id})
              </option>
            ))}
          </select>

          {pid > 0 && (
            <>
              <AdminInlineAlert tone={gateEnabled ? 'warning' : 'info'}>
                {gateEnabled ? t('xfer.debtGateOn') : t('xfer.debtGateOff')}
              </AdminInlineAlert>

              {debt && Number(debt.overdue_unpaid_eur ?? 0) > 0 ? (
                <AdminInlineAlert tone="warning">
                  {t('xfer.debtOverdueWarning', {
                    amount: String(debt.overdue_unpaid_eur ?? 0),
                    reason: String(debt.reason ?? 'overdue_unpaid_obligations'),
                  })}
                  {Number(debt.future_due_eur ?? 0) > 0
                    ? ` ${t('xfer.debtFutureNote', { amount: String(debt.future_due_eur) })}`
                    : ''}
                </AdminInlineAlert>
              ) : (
                <div className="text-xs text-muted">{t('xfer.debtClear')}</div>
              )}

              <div className="text-sm font-medium text-foreground">{t('xfer.bookOwners')}</div>
              <ul className="space-y-1 text-xs text-secondary">
                {owners.map((o) => (
                  <li key={o.id}>
                    {ownerLabel(o)} · {o.admin_status}
                    {!o.voting_eligible ? ` · ${t('xfer.votingIneligible')}` : ''}
                    {o.ownership_share_percent != null ? ` · ${o.ownership_share_percent}%` : ''}
                  </li>
                ))}
              </ul>

              <form
                onSubmit={(e) => void handlePendingInheritance(e)}
                className="space-y-2 border-t border-border pt-3"
              >
                <div className="text-sm font-medium text-foreground">{t('xfer.pendingInheritance')}</div>
                <p className="text-xs text-muted">{t('xfer.pendingInheritanceLead')}</p>
                <select
                  className={adminFieldClass}
                  value={pendingOwnerId}
                  onChange={(e) => setPendingOwnerId(e.target.value)}
                  required
                >
                  <option value="">{t('xfer.pickOwner')}</option>
                  {owners.map((o) => (
                    <option key={o.id} value={o.id}>
                      {ownerLabel(o)}
                    </option>
                  ))}
                </select>
                <label className="flex items-center gap-2 text-xs text-secondary">
                  <input
                    type="checkbox"
                    checked={markDeceased}
                    onChange={(e) => setMarkDeceased(e.target.checked)}
                  />
                  {t('xfer.markDeceased')}
                </label>
                {markDeceased && (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input
                      className={adminFieldClass}
                      placeholder={t('xfer.docType')}
                      value={deathDocType}
                      onChange={(e) => setDeathDocType(e.target.value)}
                    />
                    <input
                      className={adminFieldClass}
                      placeholder={t('xfer.docNumber')}
                      value={deathDocNumber}
                      onChange={(e) => setDeathDocNumber(e.target.value)}
                    />
                    <input
                      className={adminFieldClass}
                      type="date"
                      value={deathDocDate}
                      onChange={(e) => setDeathDocDate(e.target.value)}
                    />
                    <input
                      className={adminFieldClass}
                      type="file"
                      accept=".pdf,image/*"
                      onChange={(e) => setDeathFile(e.target.files?.[0] ?? null)}
                    />
                  </div>
                )}
                <AdminPrimaryButton type="submit" disabled={busy}>
                  {t('xfer.setPendingInheritance')}
                </AdminPrimaryButton>
              </form>

              {(pendingOwners.length > 0 || guests.length > 0) && (
                <form
                  onSubmit={(e) => void handleGrantGuest(e)}
                  className="space-y-2 border-t border-border pt-3"
                >
                  <div className="text-sm font-medium text-foreground">{t('xfer.tempGuest')}</div>
                  <p className="text-xs text-muted">{t('xfer.tempGuestLead')}</p>
                  <input
                    className={adminFieldClass}
                    type="email"
                    placeholder="email@example.com"
                    value={guestEmail}
                    onChange={(e) => setGuestEmail(e.target.value)}
                    required
                  />
                  <input
                    className={adminFieldClass}
                    type="datetime-local"
                    value={guestUntil}
                    onChange={(e) => setGuestUntil(e.target.value)}
                    title={t('xfer.guestValidUntil')}
                  />
                  <AdminPrimaryButton type="submit" disabled={busy}>
                    {t('xfer.grantGuest')}
                  </AdminPrimaryButton>
                  {guests.map((g) => (
                    <div
                      key={g.id}
                      className="flex flex-wrap items-center justify-between gap-2 text-xs text-secondary"
                    >
                      <span>
                        {g.email} · {g.status}
                        {g.valid_until ? ` · ${g.valid_until}` : ''}
                      </span>
                      <AdminSecondaryButton
                        type="button"
                        disabled={busy}
                        onClick={() => void handleRevokeGuest(g.id)}
                      >
                        {t('xfer.revokeGuest')}
                      </AdminSecondaryButton>
                    </div>
                  ))}
                </form>
              )}

              <form
                onSubmit={(e) => void handleRecordLiability(e)}
                className="space-y-2 border-t border-border pt-3"
              >
                <div className="text-sm font-medium text-foreground">
                  {t('xfer.inheritedLiabilities')}
                </div>
                <p className="text-xs text-muted">{t('xfer.inheritedLiabilitiesLead')}</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <input
                    className={adminFieldClass}
                    placeholder={t('xfer.heirName')}
                    value={liabHeirName}
                    onChange={(e) => setLiabHeirName(e.target.value)}
                  />
                  <input
                    className={adminFieldClass}
                    type="email"
                    placeholder={t('xfer.heirEmail')}
                    value={liabHeirEmail}
                    onChange={(e) => setLiabHeirEmail(e.target.value)}
                  />
                  <input
                    className={adminFieldClass}
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder={t('xfer.liabilityAmount')}
                    value={liabAmount}
                    onChange={(e) => setLiabAmount(e.target.value)}
                    required
                  />
                  <input
                    className={adminFieldClass}
                    placeholder={t('xfer.obligationRef')}
                    value={liabObligationRef}
                    onChange={(e) => setLiabObligationRef(e.target.value)}
                  />
                  <input
                    className={adminFieldClass}
                    placeholder={t('xfer.docType')}
                    value={liabBasisType}
                    onChange={(e) => setLiabBasisType(e.target.value)}
                    required
                  />
                  <input
                    className={adminFieldClass}
                    placeholder={t('xfer.docNumber')}
                    value={liabBasisNumber}
                    onChange={(e) => setLiabBasisNumber(e.target.value)}
                    required
                  />
                  <input
                    className={adminFieldClass}
                    type="date"
                    value={liabBasisDate}
                    onChange={(e) => setLiabBasisDate(e.target.value)}
                    required
                  />
                  <label className="flex items-center gap-2 text-xs text-secondary">
                    <input
                      type="checkbox"
                      checked={liabInventory}
                      onChange={(e) => setLiabInventory(e.target.checked)}
                    />
                    {t('xfer.inventoryLimited')}
                  </label>
                </div>
                <AdminPrimaryButton type="submit" disabled={busy}>
                  {t('xfer.recordLiability')}
                </AdminPrimaryButton>
                {liabilities.length === 0 ? (
                  <div className="text-xs text-muted">{t('xfer.noLiabilities')}</div>
                ) : (
                  liabilities.map((l) => (
                    <div
                      key={l.id}
                      className="flex flex-wrap items-center justify-between gap-2 text-xs text-secondary"
                    >
                      <span>
                        {l.heir_name || l.heir_email || '—'} · {l.amount_eur} EUR ·{' '}
                        {l.accepted_status}
                        {l.inventory_limited ? ` · ${t('xfer.inventoryLimited')}` : ''}
                      </span>
                      {l.accepted_status === 'recorded' && (
                        <div className="flex gap-1">
                          <AdminSecondaryButton
                            type="button"
                            disabled={busy}
                            onClick={() => void handleConfirmLiability(l.id, 'accepted')}
                          >
                            {t('xfer.confirmAccepted')}
                          </AdminSecondaryButton>
                          <AdminSecondaryButton
                            type="button"
                            disabled={busy}
                            onClick={() => void handleConfirmLiability(l.id, 'inventory_limited')}
                          >
                            {t('xfer.confirmInventory')}
                          </AdminSecondaryButton>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </form>

              {legalOwners.length > 0 && (
                <form
                  onSubmit={(e) => void handleRepresentative(e)}
                  className="space-y-2 border-t border-border pt-3"
                >
                  <div className="text-sm font-medium text-foreground">{t('xfer.legalEntityRep')}</div>
                  <p className="text-xs text-muted">{t('xfer.legalEntityRepLead')}</p>
                  <select
                    className={adminFieldClass}
                    value={repOwnerId}
                    onChange={(e) => setRepOwnerId(e.target.value)}
                    required
                  >
                    <option value="">{t('xfer.pickOwner')}</option>
                    {legalOwners.map((o) => (
                      <option key={o.id} value={o.id}>
                        {ownerLabel(o)}
                      </option>
                    ))}
                  </select>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input
                      className={adminFieldClass}
                      placeholder={t('xfer.repName')}
                      value={repName}
                      onChange={(e) => setRepName(e.target.value)}
                      required
                    />
                    <input
                      className={adminFieldClass}
                      type="email"
                      placeholder={t('xfer.repEmail')}
                      value={repEmail}
                      onChange={(e) => setRepEmail(e.target.value)}
                      required
                    />
                    <input
                      className={adminFieldClass}
                      placeholder={t('xfer.docType')}
                      value={repDocType}
                      onChange={(e) => setRepDocType(e.target.value)}
                      required
                    />
                    <input
                      className={adminFieldClass}
                      placeholder={t('xfer.docNumber')}
                      value={repDocNumber}
                      onChange={(e) => setRepDocNumber(e.target.value)}
                      required
                    />
                    <input
                      className={adminFieldClass}
                      type="date"
                      value={repDocDate}
                      onChange={(e) => setRepDocDate(e.target.value)}
                      required
                    />
                    <input
                      className={adminFieldClass}
                      type="file"
                      accept=".pdf,image/*"
                      onChange={(e) => setRepFile(e.target.files?.[0] ?? null)}
                      required
                    />
                  </div>
                  <AdminPrimaryButton type="submit" disabled={busy}>
                    {t('xfer.updateRepresentative')}
                  </AdminPrimaryButton>
                </form>
              )}
            </>
          )}
        </div>
      )}
    </AdminCard>
  );
}
