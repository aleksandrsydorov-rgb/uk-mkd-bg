'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@/lib/database.types';
import { useI18n } from '@/i18n/I18nProvider';
import { labelTransfer } from '@/i18n/labels';
import {
  transferStatusClass,
  type OwnerTransfer,
  type OwnershipTargetOwner,
} from '@/lib/ownership';
import { formatOwnerDateTime } from '@/lib/ownerFormat';
import {
  OWNERSHIP_CHANGE_REASONS,
  emptyRosterOwner,
  formsToTargetOwners,
  isMissingRpcError,
  targetOwnersToForms,
  validateRosterForms,
  type OwnershipChangeReason,
  type RosterOwnerForm,
} from '@/lib/ownershipChange';
import { OwnershipRosterEditor } from '@/components/ownership/OwnershipRosterEditor';
import { AdminOwnershipStage3Panel } from '@/components/admin/AdminOwnershipStage3Panel';
import { AdminCertifiedExtracts } from '@/components/admin/AdminCertifiedExtracts';
import {
  BUILDING_DOCUMENTS_BUCKET,
  MAX_BUILDING_DOCUMENT_BYTES,
  buildPrivateStoragePath,
} from '@/lib/buildingDocuments';
import {
  AdminCard,
  AdminEmptyState,
  AdminInlineAlert,
  AdminPageHeader,
  AdminPrimaryButton,
  AdminSecondaryButton,
  adminFieldClass,
} from '@/components/admin/AdminUi';

type DebtStatus = {
  overdue_unpaid_eur?: number;
  future_due_eur?: number;
  ordinary_debt_gate_enabled?: boolean;
  reason?: string | null;
};

type PropertyOpt = {
  id: number;
  apartment_number: string | number | null;
  ideal_parts_percent: number | null;
};

type Props = {
  supabase: SupabaseClient<Database>;
  transfers: OwnerTransfer[];
  properties: PropertyOpt[];
  canManage: boolean;
  propertyLabel: (id: number) => string;
  propertyIdealParts: (id: number) => number;
  sessionEmail: string | null;
  onChanged: () => Promise<void>;
  onError: (message: string) => void;
};

function asTargetOwners(raw: OwnerTransfer['target_owners']): OwnershipTargetOwner[] | null {
  if (!raw || !Array.isArray(raw)) return null;
  return raw as OwnershipTargetOwner[];
}

function reasonLabel(reason: string, t: (k: string) => string) {
  const map: Record<string, string> = {
    sale: t('xfer.reasonSale'),
    donation: t('xfer.reasonDonation'),
    partial_transfer: t('xfer.reasonPartial'),
    inheritance: t('xfer.reasonInheritance'),
    correction: t('xfer.reasonCorrection'),
    other: t('xfer.reasonOther'),
  };
  return map[reason] ?? reason;
}

export function AdminOwnershipTransfers({
  supabase,
  transfers,
  properties,
  canManage,
  propertyLabel,
  propertyIdealParts,
  sessionEmail,
  onChanged,
  onError,
}: Props) {
  const { t, locale } = useI18n();
  const [busyId, setBusyId] = useState<number | null>(null);
  const [approveId, setApproveId] = useState<number | null>(null);
  const [roster, setRoster] = useState<RosterOwnerForm[]>([emptyRosterOwner()]);
  const [legalDate, setLegalDate] = useState('');
  const [changeReason, setChangeReason] = useState<OwnershipChangeReason>('sale');
  const [docType, setDocType] = useState('');
  const [docNumber, setDocNumber] = useState('');
  const [docDate, setDocDate] = useState('');
  const [docFile, setDocFile] = useState<File | null>(null);
  const [uploadedPath, setUploadedPath] = useState<string | null>(null);
  const [adminInitOpen, setAdminInitOpen] = useState(false);
  const [initPropertyId, setInitPropertyId] = useState('');
  const [initRoster, setInitRoster] = useState<RosterOwnerForm[]>([emptyRosterOwner()]);
  const [initReason, setInitReason] = useState<OwnershipChangeReason>('sale');
  const [initNote, setInitNote] = useState('');
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [corrPropertyId, setCorrPropertyId] = useState('');
  const [corrRoster, setCorrRoster] = useState<RosterOwnerForm[]>([emptyRosterOwner()]);
  const [corrReason, setCorrReason] = useState('');
  const [corrEvidenceNote, setCorrEvidenceNote] = useState('');
  const [corrFile, setCorrFile] = useState<File | null>(null);
  const [linkedOpen, setLinkedOpen] = useState(false);
  const [linkedSourceId, setLinkedSourceId] = useState('');
  const [linkedRoster, setLinkedRoster] = useState<RosterOwnerForm[]>([emptyRosterOwner()]);
  const [linkedNote, setLinkedNote] = useState('');
  const [linkedLegalDate, setLinkedLegalDate] = useState('');
  const [linkedDocType, setLinkedDocType] = useState('');
  const [linkedDocNumber, setLinkedDocNumber] = useState('');
  const [linkedDocDate, setLinkedDocDate] = useState('');
  const [linkedFile, setLinkedFile] = useState<File | null>(null);
  const [approveDebt, setApproveDebt] = useState<DebtStatus | null>(null);
  const [approveDebtLoading, setApproveDebtLoading] = useState(false);
  /** Transfer id whose approve form was last hydrated from server — blocks refresh overwrites. */
  const hydratedApproveIdRef = useRef<number | null>(null);

  const approvedTransfers = useMemo(
    () => transfers.filter((tr) => tr.status === 'утверждена'),
    [transfers]
  );

  const [rpcPendingCount, setRpcPendingCount] = useState<number | null>(null);
  const [rpcMissing, setRpcMissing] = useState(false);

  const pendingCount = useMemo(
    () => transfers.filter((tr) => tr.status === 'ожидает').length,
    [transfers]
  );

  const approvePropertyId = useMemo(() => {
    if (approveId == null) return null;
    return transfers.find((x) => x.id === approveId)?.property_id ?? null;
  }, [approveId, transfers]);

  useEffect(() => {
    if (!canManage) return;
    void (async () => {
      const { data, error } = await supabase.rpc('admin_pending_ownership_change_count');
      if (!error && typeof data === 'number') {
        setRpcPendingCount(data);
        setRpcMissing(false);
        return;
      }
      // Show migration banner only for verified missing-RPC; other errors stay in action handlers.
      setRpcMissing(isMissingRpcError(error));
    })();
  }, [canManage, supabase, transfers]);

  // Hydrate approve form only when opening a different transfer (not on list refresh).
  useEffect(() => {
    if (approveId == null) {
      hydratedApproveIdRef.current = null;
      return;
    }

    const tr = transfers.find((x) => x.id === approveId);
    if (!tr) {
      // Already-open transfer disappeared from the list — close form; do not wipe mid-edit otherwise.
      if (hydratedApproveIdRef.current === approveId) {
        hydratedApproveIdRef.current = null;
        setApproveId(null);
      }
      return;
    }

    if (hydratedApproveIdRef.current === approveId) {
      return;
    }

    hydratedApproveIdRef.current = approveId;
    const existing = asTargetOwners(tr.target_owners);
    setRoster(
      existing?.length
        ? targetOwnersToForms(existing)
        : [
            emptyRosterOwner(String(propertyIdealParts(tr.property_id) || '')),
          ].map((o) => ({
            ...o,
            first_name: tr.to_owner_name.split(/\s+/)[0] ?? '',
            last_name: tr.to_owner_name.split(/\s+/).slice(1).join(' ') || tr.to_owner_name,
            email: tr.to_owner_email,
            ownership_share_percent: '100',
            ideal_parts_percent: String(propertyIdealParts(tr.property_id) || ''),
          }))
    );
    setLegalDate(tr.legal_effective_date ?? '');
    setChangeReason((tr.change_reason as OwnershipChangeReason) || 'sale');
    setDocType(tr.document_type ?? '');
    setDocNumber(tr.document_number ?? '');
    setDocDate(tr.document_date ?? '');
    setDocFile(null);
    setUploadedPath(tr.supporting_document_path ?? null);
  }, [approveId, transfers, propertyIdealParts]);

  // Debt status may refresh independently; never touches document/roster fields.
  useEffect(() => {
    if (approveId == null || approvePropertyId == null) {
      setApproveDebt(null);
      setApproveDebtLoading(false);
      return;
    }
    let cancelled = false;
    setApproveDebtLoading(true);
    void (async () => {
      const { data, error } = await supabase.rpc('admin_get_ownership_debt_status', {
        p_property_id: approvePropertyId,
      });
      if (cancelled) return;
      if (!error && data && typeof data === 'object') {
        setApproveDebt(data as DebtStatus);
      } else {
        setApproveDebt(null);
      }
      setApproveDebtLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [approveId, approvePropertyId, supabase]);

  async function uploadSupportingDoc(file: File, titlePrefix: string): Promise<string> {
    if (file.size > MAX_BUILDING_DOCUMENT_BYTES) {
      throw new Error(t('docs.fileTooLarge'));
    }
    const built = buildPrivateStoragePath({
      scopeId: crypto.randomUUID(),
      file,
      folder: 'documents',
    });
    if (!built.ok) {
      throw new Error(t('docs.uploadFailed'));
    }
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
      document_date: docDate || null,
      created_by_email: sessionEmail,
    });
    if (docErr) {
      await supabase.storage.from(BUILDING_DOCUMENTS_BUCKET).remove([built.storagePath]);
      throw new Error(docErr.message);
    }
    return built.storagePath;
  }

  async function handleApprove(tr: OwnerTransfer) {
    if (!canManage) {
      onError(t('xfer.errAdminOnly'));
      return;
    }
    const ideal = propertyIdealParts(tr.property_id);
    const validation = validateRosterForms(roster, ideal);
    if (!validation.ok) {
      onError(t('xfer.errRosterInvalid'));
      return;
    }
    if (!docType.trim() || !docNumber.trim() || !docDate) {
      onError(t('xfer.errDocsRequired'));
      return;
    }
    if (!docFile && !uploadedPath) {
      onError(t('xfer.errDocUploadRequired'));
      return;
    }
    setBusyId(tr.id);
    try {
      let path = uploadedPath;
      if (docFile) {
        path = await uploadSupportingDoc(docFile, `Ownership ${tr.id}`);
        setUploadedPath(path);
      }
      if (!path) {
        onError(t('xfer.errDocUploadRequired'));
        return;
      }
      const targets = formsToTargetOwners(roster);
      const { error } = await supabase.rpc('admin_approve_owner_transfer', {
        p_transfer_id: tr.id,
        p_target_owners: targets as unknown as Json,
        p_document_type: docType.trim(),
        p_document_number: docNumber.trim(),
        p_document_date: docDate,
        p_supporting_document_path: path,
        p_legal_effective_date: legalDate || null,
        p_record_inherited_liabilities: null,
      });
      if (error) throw error;
      setApproveId(null);
      await onChanged();
    } catch (e: unknown) {
      if (isMissingRpcError(e)) onError(t('xfer.errMigrationRequired'));
      else onError(e instanceof Error ? e.message : t('xfer.errApprove'));
    } finally {
      setBusyId(null);
    }
  }

  async function handleSavePendingRoster(tr: OwnerTransfer) {
    if (!canManage) return;
    const ideal = propertyIdealParts(tr.property_id);
    if (!validateRosterForms(roster, ideal).ok) {
      onError(t('xfer.errRosterInvalid'));
      return;
    }
    setBusyId(tr.id);
    try {
      const { error } = await supabase.rpc('admin_update_pending_ownership_targets', {
        p_transfer_id: tr.id,
        p_target_owners: formsToTargetOwners(roster) as unknown as Json,
        p_legal_effective_date: legalDate || null,
        p_change_reason: changeReason,
        p_note: null,
      });
      if (error) throw error;
      await onChanged();
    } catch (e: unknown) {
      if (isMissingRpcError(e)) onError(t('xfer.errMigrationRequired'));
      else onError(e instanceof Error ? e.message : t('xfer.errSubmit'));
    } finally {
      setBusyId(null);
    }
  }

  async function handleReject(tr: OwnerTransfer) {
    if (!canManage) {
      onError(t('xfer.errAdminOnly'));
      return;
    }
    const reason = window.prompt(t('xfer.rejectReasonPrompt'));
    if (reason == null) return;
    if (!reason.trim()) {
      onError(t('xfer.errRejectReason'));
      return;
    }
    setBusyId(tr.id);
    try {
      const { error } = await supabase.rpc('admin_reject_owner_transfer', {
        p_transfer_id: tr.id,
        p_reason: reason.trim(),
      });
      if (error) throw error;
      await onChanged();
    } catch (e: unknown) {
      if (isMissingRpcError(e)) onError(t('xfer.errMigrationRequired'));
      else onError(e instanceof Error ? e.message : t('xfer.errReject'));
    } finally {
      setBusyId(null);
    }
  }

  async function handleAdminInitiate(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage) return;
    const propertyId = Number(initPropertyId);
    if (!propertyId) return;
    const ideal = propertyIdealParts(propertyId);
    if (!validateRosterForms(initRoster, ideal).ok) {
      onError(t('xfer.errRosterInvalid'));
      return;
    }
    setBusyId(-1);
    try {
      const { error } = await supabase.rpc('submit_ownership_change', {
        p_property_id: propertyId,
        p_target_owners: formsToTargetOwners(initRoster) as unknown as Json,
        p_change_kind: initReason === 'inheritance' ? 'inheritance' : 'admin_initiated',
        p_change_reason: initReason,
        p_note: initNote.trim() || null,
        p_as_admin: true,
      });
      if (error) throw error;
      setAdminInitOpen(false);
      await onChanged();
    } catch (err: unknown) {
      if (isMissingRpcError(err)) onError(t('xfer.errMigrationRequired'));
      else onError(err instanceof Error ? err.message : t('xfer.errSubmit'));
    } finally {
      setBusyId(null);
    }
  }

  async function loadBookIntoCorrection(propertyId: number) {
    const { data, error } = await supabase
      .from('property_registry_people')
      .select(
        'entity_kind, first_name, middle_name, last_name, entity_name, eik_bulstat, email, ownership_share_percent, ideal_parts_percent'
      )
      .eq('property_id', propertyId)
      .eq('relation_type', 'owner')
      .is('deregistered_at', null)
      .order('id', { ascending: true });
    if (error) {
      onError(error.message);
      return;
    }
    const owners = (data ?? []).map((r) => ({
      entity_kind: (r.entity_kind as OwnershipTargetOwner['entity_kind']) || 'natural_person',
      first_name: r.first_name,
      middle_name: r.middle_name,
      last_name: r.last_name,
      entity_name: r.entity_name,
      eik_bulstat: r.eik_bulstat,
      email: String(r.email ?? ''),
      ownership_share_percent: Number(r.ownership_share_percent ?? 0),
      ideal_parts_percent: Number(r.ideal_parts_percent ?? 0),
    }));
    setCorrRoster(targetOwnersToForms(owners));
  }

  async function handleCorrection(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage) return;
    const propertyId = Number(corrPropertyId);
    if (!propertyId || !corrReason.trim()) {
      onError(t('xfer.errCorrectionReason'));
      return;
    }
    if (!corrFile) {
      onError(t('xfer.errCorrectionEvidence'));
      return;
    }
    const ideal = propertyIdealParts(propertyId);
    if (!validateRosterForms(corrRoster, ideal).ok) {
      onError(t('xfer.errRosterInvalid'));
      return;
    }
    setBusyId(-2);
    try {
      const evidencePath = await uploadSupportingDoc(corrFile, `Book correction ${propertyId}`);
      const { error } = await supabase.rpc('admin_record_ownership_correction', {
        p_property_id: propertyId,
        p_after_owners: formsToTargetOwners(corrRoster) as unknown as Json,
        p_reason: corrReason.trim(),
        p_evidence_document_path: evidencePath,
        p_evidence_note: corrEvidenceNote.trim() || null,
      });
      if (error) throw error;
      setCorrectionOpen(false);
      setCorrFile(null);
      await onChanged();
    } catch (err: unknown) {
      if (isMissingRpcError(err)) onError(t('xfer.errMigrationRequired'));
      else onError(err instanceof Error ? err.message : t('xfer.errCorrection'));
    } finally {
      setBusyId(null);
    }
  }

  function loadApprovedIntoLinked(transferId: number) {
    const tr = approvedTransfers.find((x) => x.id === transferId);
    if (!tr) return;
    const owners = asTargetOwners(tr.target_owners);
    setLinkedRoster(
      owners?.length
        ? targetOwnersToForms(owners)
        : [
            {
              ...emptyRosterOwner(String(propertyIdealParts(tr.property_id) || '')),
              first_name: tr.to_owner_name.split(/\s+/)[0] ?? '',
              last_name: tr.to_owner_name.split(/\s+/).slice(1).join(' ') || tr.to_owner_name,
              email: tr.to_owner_email,
              ownership_share_percent: '100',
              ideal_parts_percent: String(propertyIdealParts(tr.property_id) || ''),
            },
          ]
    );
    setLinkedLegalDate(tr.legal_effective_date ?? '');
    setLinkedDocType(tr.document_type ?? '');
    setLinkedDocNumber(tr.document_number ?? '');
    setLinkedDocDate(tr.document_date ?? '');
    setLinkedNote('');
    setLinkedFile(null);
  }

  async function handleLinkedCorrection(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage) return;
    const sourceId = Number(linkedSourceId);
    const source = approvedTransfers.find((x) => x.id === sourceId);
    if (!sourceId || !source) {
      onError(t('xfer.errLinkedSource'));
      return;
    }
    if (!linkedNote.trim()) {
      onError(t('xfer.errCorrectionReason'));
      return;
    }
    if (!linkedDocType.trim() || !linkedDocNumber.trim() || !linkedDocDate || !linkedFile) {
      onError(t('xfer.errLinkedDocs'));
      return;
    }
    const ideal = propertyIdealParts(source.property_id);
    if (!validateRosterForms(linkedRoster, ideal).ok) {
      onError(t('xfer.errRosterInvalid'));
      return;
    }
    setBusyId(-3);
    try {
      const evidencePath = await uploadSupportingDoc(
        linkedFile,
        `Linked correction of #${sourceId}`
      );
      const { error } = await supabase.rpc('admin_submit_linked_ownership_correction', {
        p_approved_transfer_id: sourceId,
        p_target_owners: formsToTargetOwners(linkedRoster) as unknown as Json,
        p_document_type: linkedDocType.trim(),
        p_document_number: linkedDocNumber.trim(),
        p_document_date: linkedDocDate,
        p_supporting_document_path: evidencePath,
        p_legal_effective_date: linkedLegalDate || null,
        p_note: linkedNote.trim(),
      });
      if (error) throw error;
      setLinkedOpen(false);
      setLinkedSourceId('');
      setLinkedFile(null);
      await onChanged();
    } catch (err: unknown) {
      if (isMissingRpcError(err)) onError(t('xfer.errMigrationRequired'));
      else onError(err instanceof Error ? err.message : t('xfer.errLinkedCorrection'));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      <AdminPageHeader
        title={t('admin.transfers')}
        secondary={t('xfer.adminLead', {
          n: rpcPendingCount ?? pendingCount,
        })}
      />

      <AdminInlineAlert tone="info">{t('xfer.debtGateNote')}</AdminInlineAlert>
      {rpcMissing ? (
        <AdminInlineAlert tone="warning">{t('xfer.migrationPending')}</AdminInlineAlert>
      ) : null}

      <AdminOwnershipStage3Panel
        supabase={supabase}
        properties={properties}
        canManage={canManage}
        sessionEmail={sessionEmail}
        onError={onError}
        onChanged={onChanged}
      />

      <AdminCertifiedExtracts
        supabase={supabase}
        canManage={canManage}
        propertyLabel={propertyLabel}
        onError={onError}
      />

      {canManage && (
        <AdminCard>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm text-secondary">{t('xfer.adminInitiate')}</div>
            <AdminSecondaryButton type="button" onClick={() => setAdminInitOpen((v) => !v)}>
              {adminInitOpen ? t('xfer.hide') : t('xfer.show')}
            </AdminSecondaryButton>
          </div>
          {adminInitOpen && (
            <form onSubmit={handleAdminInitiate} className="mt-3 space-y-3">
              <select
                className={adminFieldClass}
                value={initPropertyId}
                onChange={(e) => {
                  setInitPropertyId(e.target.value);
                  const ideal = propertyIdealParts(Number(e.target.value));
                  setInitRoster([
                    {
                      ...emptyRosterOwner(String(ideal || '')),
                      ownership_share_percent: '100',
                      ideal_parts_percent: String(ideal || ''),
                    },
                  ]);
                }}
                required
              >
                <option value="">{t('xfer.pickProperty')}</option>
                {properties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {t('picker.apt', { n: p.apartment_number ?? p.id })} (#{p.id})
                  </option>
                ))}
              </select>
              <select
                className={adminFieldClass}
                value={initReason}
                onChange={(e) => setInitReason(e.target.value as OwnershipChangeReason)}
              >
                {OWNERSHIP_CHANGE_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {reasonLabel(r, t)}
                  </option>
                ))}
              </select>
              <OwnershipRosterEditor
                owners={initRoster}
                onChange={setInitRoster}
                propertyIdealParts={propertyIdealParts(Number(initPropertyId) || 0)}
              />
              <textarea
                className={adminFieldClass}
                placeholder={t('account.phCommentUk')}
                rows={2}
                value={initNote}
                onChange={(e) => setInitNote(e.target.value)}
              />
              <AdminPrimaryButton type="submit" disabled={busyId === -1}>
                {t('xfer.submitAdmin')}
              </AdminPrimaryButton>
            </form>
          )}
        </AdminCard>
      )}

      {canManage && (
        <AdminCard>
          <div className="text-sm font-medium text-foreground">{t('xfer.modesTitle')}</div>
          <p className="mt-1 text-xs text-muted">{t('xfer.modesLead')}</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted">
            <li>{t('xfer.modeNewTransfer')}</li>
            <li>{t('xfer.modeBookCorrection')}</li>
            <li>{t('xfer.modeLinkedCorrection')}</li>
          </ul>
        </AdminCard>
      )}

      {canManage && (
        <AdminCard>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm text-secondary">{t('xfer.correctionTitle')}</div>
            <AdminSecondaryButton type="button" onClick={() => setCorrectionOpen((v) => !v)}>
              {correctionOpen ? t('xfer.hide') : t('xfer.show')}
            </AdminSecondaryButton>
          </div>
          <p className="mt-2 text-xs text-muted">{t('xfer.correctionLead')}</p>
          {correctionOpen && (
            <form onSubmit={handleCorrection} className="mt-3 space-y-3">
              <select
                className={adminFieldClass}
                value={corrPropertyId}
                onChange={(e) => {
                  setCorrPropertyId(e.target.value);
                  const id = Number(e.target.value);
                  if (id) void loadBookIntoCorrection(id);
                }}
                required
              >
                <option value="">{t('xfer.pickProperty')}</option>
                {properties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {t('picker.apt', { n: p.apartment_number ?? p.id })} (#{p.id})
                  </option>
                ))}
              </select>
              <input
                className={adminFieldClass}
                placeholder={t('xfer.correctionReason')}
                value={corrReason}
                onChange={(e) => setCorrReason(e.target.value)}
                required
              />
              <OwnershipRosterEditor
                owners={corrRoster}
                onChange={setCorrRoster}
                propertyIdealParts={propertyIdealParts(Number(corrPropertyId) || 0)}
              />
              <input
                className={adminFieldClass}
                type="file"
                accept=".pdf,image/*"
                onChange={(e) => setCorrFile(e.target.files?.[0] ?? null)}
                required
              />
              <textarea
                className={adminFieldClass}
                placeholder={t('xfer.evidenceNote')}
                rows={2}
                value={corrEvidenceNote}
                onChange={(e) => setCorrEvidenceNote(e.target.value)}
              />
              <AdminPrimaryButton type="submit" disabled={busyId === -2}>
                {t('xfer.applyCorrection')}
              </AdminPrimaryButton>
            </form>
          )}
        </AdminCard>
      )}

      {canManage && (
        <AdminCard>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm text-secondary">{t('xfer.linkedTitle')}</div>
            <AdminSecondaryButton type="button" onClick={() => setLinkedOpen((v) => !v)}>
              {linkedOpen ? t('xfer.hide') : t('xfer.show')}
            </AdminSecondaryButton>
          </div>
          <p className="mt-2 text-xs text-muted">{t('xfer.linkedLead')}</p>
          {linkedOpen && (
            <form onSubmit={handleLinkedCorrection} className="mt-3 space-y-3">
              <select
                className={adminFieldClass}
                value={linkedSourceId}
                onChange={(e) => {
                  setLinkedSourceId(e.target.value);
                  const id = Number(e.target.value);
                  if (id) loadApprovedIntoLinked(id);
                }}
                required
              >
                <option value="">{t('xfer.pickApprovedTransfer')}</option>
                {approvedTransfers.map((tr) => (
                  <option key={tr.id} value={tr.id}>
                    #{tr.id} · {propertyLabel(tr.property_id)} · {tr.to_owner_name}
                    {tr.legal_effective_date ? ` · ${tr.legal_effective_date}` : ''}
                  </option>
                ))}
              </select>
              {approvedTransfers.length === 0 && (
                <AdminInlineAlert tone="info">{t('xfer.noApprovedForLink')}</AdminInlineAlert>
              )}
              <textarea
                className={adminFieldClass}
                placeholder={t('xfer.linkedReason')}
                rows={2}
                value={linkedNote}
                onChange={(e) => setLinkedNote(e.target.value)}
                required
              />
              <OwnershipRosterEditor
                owners={linkedRoster}
                onChange={setLinkedRoster}
                propertyIdealParts={
                  propertyIdealParts(
                    approvedTransfers.find((x) => x.id === Number(linkedSourceId))?.property_id ?? 0
                  )
                }
              />
              <div className="grid gap-2 sm:grid-cols-2">
                <input
                  className={adminFieldClass}
                  type="date"
                  value={linkedLegalDate}
                  onChange={(e) => setLinkedLegalDate(e.target.value)}
                  title={t('xfer.legalDate')}
                />
                <input
                  className={adminFieldClass}
                  placeholder={t('xfer.docType')}
                  value={linkedDocType}
                  onChange={(e) => setLinkedDocType(e.target.value)}
                  required
                />
                <input
                  className={adminFieldClass}
                  placeholder={t('xfer.docNumber')}
                  value={linkedDocNumber}
                  onChange={(e) => setLinkedDocNumber(e.target.value)}
                  required
                />
                <input
                  className={adminFieldClass}
                  type="date"
                  value={linkedDocDate}
                  onChange={(e) => setLinkedDocDate(e.target.value)}
                  required
                />
              </div>
              <input
                className={adminFieldClass}
                type="file"
                accept=".pdf,image/*"
                onChange={(e) => setLinkedFile(e.target.files?.[0] ?? null)}
                required
              />
              <AdminInlineAlert tone="warning">{t('xfer.linkedImmutableNote')}</AdminInlineAlert>
              <AdminPrimaryButton type="submit" disabled={busyId === -3 || !linkedSourceId}>
                {t('xfer.submitLinkedCorrection')}
              </AdminPrimaryButton>
            </form>
          )}
        </AdminCard>
      )}

      <AdminCard>
        {transfers.length === 0 ? (
          <AdminEmptyState title={t('admin.noTransfers')} />
        ) : (
          <div className="space-y-3">
            {transfers.map((tr) => (
              <div key={tr.id} className="rounded-[14px] border border-border bg-surface p-4 shadow-card">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-sm text-secondary">{propertyLabel(tr.property_id)}</div>
                    <div className="mt-1 text-sm text-secondary">
                      {tr.from_owner_name} ({tr.from_owner_email}) → {tr.to_owner_name} ({tr.to_owner_email})
                    </div>
                    <div className="mt-1 text-xs text-muted">
                      {t('xfer.kind')}: {tr.change_kind ?? 'ordinary'}
                      {tr.change_reason ? ` · ${reasonLabel(tr.change_reason, t)}` : ''}
                      {tr.corrects_transfer_id
                        ? ` · ${t('xfer.correctsLink', { id: String(tr.corrects_transfer_id) })}`
                        : ''}
                    </div>
                    {Array.isArray(tr.target_owners) && tr.target_owners.length > 1 && (
                      <div className="mt-1 text-xs text-muted">
                        {t('xfer.multiOwners', { n: tr.target_owners.length })}
                      </div>
                    )}
                    {tr.note && <div className="mt-2 text-sm text-secondary">{tr.note}</div>}
                    {tr.reject_reason && (
                      <div className="mt-1 text-xs text-danger">{t('form.reason', { n: tr.reject_reason })}</div>
                    )}
                    <div className="mt-2 text-xs text-muted">
                      {formatOwnerDateTime(tr.created_at, locale)}
                      {tr.decided_by ? ` · ${tr.decided_by}` : ''}
                    </div>
                    {tr.decided_at ? (
                      <div className="mt-1 text-xs text-muted">
                        {t('xfer.approvalDate')}: {formatOwnerDateTime(tr.decided_at, locale)}
                      </div>
                    ) : null}
                  </div>
                  <div className="text-right">
                    <div className={`text-sm font-medium ${transferStatusClass(tr.status)}`}>
                      {labelTransfer(tr.status, t)}
                    </div>
                    {tr.status === 'ожидает' && canManage && (
                      <div className="mt-2 flex flex-wrap justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setApproveId(tr.id === approveId ? null : tr.id)}
                          className="rounded-lg border border-accent/25 bg-accent-bg px-3 py-1.5 text-xs text-accent"
                        >
                          {t('admin.approve')}
                        </button>
                        <button
                          type="button"
                          disabled={busyId === tr.id}
                          onClick={() => void handleReject(tr)}
                          className="rounded-lg border border-danger/25 bg-danger-bg px-3 py-1.5 text-xs text-danger"
                        >
                          {t('admin.reject')}
                        </button>
                      </div>
                    )}
                    {tr.status === 'утверждена' && canManage && (
                      <div className="mt-2 flex flex-wrap justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setLinkedOpen(true);
                            setLinkedSourceId(String(tr.id));
                            loadApprovedIntoLinked(tr.id);
                          }}
                          className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs text-secondary"
                        >
                          {t('xfer.correctThisTransfer')}
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {approveId === tr.id && (
                  <div className="mt-3 space-y-3 border-t border-border pt-3">
                    {approveDebtLoading ? (
                      <div className="text-xs text-muted">{t('common.loading')}</div>
                    ) : null}
                    {approveDebt && Number(approveDebt.overdue_unpaid_eur ?? 0) > 0 && (
                      <AdminInlineAlert tone="warning">
                        {t('xfer.debtOverdueWarning', {
                          amount: String(approveDebt.overdue_unpaid_eur ?? 0),
                          reason: String(approveDebt.reason ?? 'overdue_unpaid_obligations'),
                        })}
                        {tr.change_kind === 'inheritance' || tr.change_reason === 'inheritance'
                          ? ` ${t('xfer.debtInheritanceExempt')}`
                          : approveDebt.ordinary_debt_gate_enabled
                            ? ` ${t('xfer.debtGateWillBlock')}`
                            : ` ${t('xfer.debtGateDisabledWarn')}`}
                      </AdminInlineAlert>
                    )}
                    <div className="text-sm font-medium text-foreground">{t('xfer.rosterEditor')}</div>
                    <select
                      className={adminFieldClass}
                      value={changeReason}
                      onChange={(e) => setChangeReason(e.target.value as OwnershipChangeReason)}
                    >
                      {OWNERSHIP_CHANGE_REASONS.map((r) => (
                        <option key={r} value={r}>
                          {reasonLabel(r, t)}
                        </option>
                      ))}
                    </select>
                    <OwnershipRosterEditor
                      owners={roster}
                      onChange={setRoster}
                      propertyIdealParts={propertyIdealParts(tr.property_id)}
                    />
                    <div className="space-y-1">
                      <label htmlFor={`xfer-legal-date-${tr.id}`} className="block text-xs font-medium text-foreground">
                        {t('xfer.legalDate')}
                      </label>
                      <p id={`xfer-legal-date-help-${tr.id}`} className="text-xs text-muted">
                        {t('xfer.legalDateHelp')}
                      </p>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <input
                          id={`xfer-legal-date-${tr.id}`}
                          className={adminFieldClass}
                          type="date"
                          value={legalDate}
                          onChange={(e) => setLegalDate(e.target.value)}
                          aria-describedby={`xfer-legal-date-help-${tr.id}`}
                        />
                        <AdminSecondaryButton
                          type="button"
                          disabled={busyId === tr.id}
                          onClick={() => void handleSavePendingRoster(tr)}
                        >
                          {busyId === tr.id ? t('common.saving') : t('xfer.savePendingRoster')}
                        </AdminSecondaryButton>
                      </div>
                    </div>
                    <div className="text-sm font-medium text-foreground">{t('xfer.docSection')}</div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div className="space-y-1">
                        <label htmlFor={`xfer-doc-type-${tr.id}`} className="block text-xs font-medium text-foreground">
                          {t('xfer.docType')}
                        </label>
                        <input
                          id={`xfer-doc-type-${tr.id}`}
                          className={adminFieldClass}
                          placeholder={t('xfer.docType')}
                          value={docType}
                          onChange={(e) => setDocType(e.target.value)}
                        />
                      </div>
                      <div className="space-y-1">
                        <label htmlFor={`xfer-doc-number-${tr.id}`} className="block text-xs font-medium text-foreground">
                          {t('xfer.docNumber')}
                        </label>
                        <input
                          id={`xfer-doc-number-${tr.id}`}
                          className={adminFieldClass}
                          placeholder={t('xfer.docNumber')}
                          value={docNumber}
                          onChange={(e) => setDocNumber(e.target.value)}
                        />
                      </div>
                      <div className="space-y-1">
                        <label htmlFor={`xfer-doc-date-${tr.id}`} className="block text-xs font-medium text-foreground">
                          {t('xfer.docDate')}
                        </label>
                        <input
                          id={`xfer-doc-date-${tr.id}`}
                          className={adminFieldClass}
                          type="date"
                          value={docDate}
                          onChange={(e) => setDocDate(e.target.value)}
                        />
                      </div>
                      <div className="space-y-1">
                        <label htmlFor={`xfer-doc-file-${tr.id}`} className="block text-xs font-medium text-foreground">
                          {t('xfer.supportingFile')}
                        </label>
                        <input
                          id={`xfer-doc-file-${tr.id}`}
                          className={adminFieldClass}
                          type="file"
                          accept=".pdf,image/*"
                          onChange={(e) => {
                            setDocFile(e.target.files?.[0] ?? null);
                            setUploadedPath(null);
                          }}
                        />
                      </div>
                    </div>
                    {docFile ? (
                      <div className="text-xs text-muted">{docFile.name}</div>
                    ) : null}
                    {!docFile && !uploadedPath ? (
                      <AdminInlineAlert tone="warning">{t('xfer.docUploadBlocked')}</AdminInlineAlert>
                    ) : (
                      <div className="text-xs text-success">
                        {uploadedPath ? t('xfer.docAttached') : t('xfer.docReady')}
                      </div>
                    )}
                    <div className="flex gap-2">
                      <AdminPrimaryButton
                        type="button"
                        disabled={busyId === tr.id || (!docFile && !uploadedPath)}
                        onClick={() => void handleApprove(tr)}
                      >
                        {busyId === tr.id ? t('common.saving') : t('xfer.confirmApprove')}
                      </AdminPrimaryButton>
                      <AdminSecondaryButton type="button" onClick={() => setApproveId(null)}>
                        {t('xfer.hide')}
                      </AdminSecondaryButton>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </AdminCard>
    </div>
  );
}
