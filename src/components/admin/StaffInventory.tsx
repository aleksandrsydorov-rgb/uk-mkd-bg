'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { useI18n } from '@/i18n/I18nProvider';
import { ownerVisibleError } from '@/lib/ownerError';
import { formatOwnerDateTime } from '@/lib/ownerFormat';
import {
  categoryDisplayName,
  inventoryRpc,
  inventorySelect,
  inventorySessionStatusTone,
  type InventoryCategoryRow,
  type InventoryDocumentRow,
  type InventoryLocationRow,
  type InventorySessionItemRow,
  type InventorySessionRow,
} from '@/lib/inventory';
import {
  computeStaffSessionStats,
  filterAssignedSessions,
  isStaleRowVersionError,
  parseInventoryStaffCapabilities,
  resolveStaffStaleConflict,
  sessionAcceptsNewFindings,
  staffFindingEditable,
  type InventoryParticipantAssignment,
  type InventoryStaffCapabilityFlags,
  type InventoryStaffView,
} from '@/lib/inventory/staff';
import {
  InventoryDocumentValidationError,
  uploadAndRegisterInventoryDocument,
} from '@/lib/inventory/documentsClient';
import { SignedStorageImage, SignedStorageLink } from '@/components/SignedStorageMedia';
import {
  AdminPageHeader,
  AdminEmptyState,
  AdminInlineAlert,
  AdminPrimaryButton,
  AdminSecondaryButton,
  AdminMetricCard,
  adminCardClass,
  adminFieldClass,
  adminFormPanelClass,
} from '@/components/admin/AdminUi';
import { StatusBadge } from '@/components/account/ownerUi';

const OWNERSHIP = ['CONDOMINIUM', 'MANAGEMENT_COMPANY', 'THIRD_PARTY'] as const;
const CONDITIONS = ['new', 'good', 'fair', 'poor', 'unserviceable'] as const;

function mapItem(r: InventorySessionItemRow): InventorySessionItemRow {
  return {
    ...r,
    id: String(r.id),
    session_id: String(r.session_id),
    draft_category_id: r.draft_category_id ? String(r.draft_category_id) : null,
    draft_location_id: r.draft_location_id ? String(r.draft_location_id) : null,
    counted_qty: r.counted_qty == null ? null : Number(r.counted_qty),
    expected_qty: r.expected_qty == null ? null : Number(r.expected_qty),
    row_version: Number(r.row_version),
  };
}

export function StaffInventory({
  supabase,
  staffId,
  staffRole,
  caps,
}: {
  supabase: SupabaseClient<Database>;
  staffId: number | null;
  staffRole: string;
  caps: InventoryStaffCapabilityFlags;
}) {
  const { t, locale } = useI18n();
  const isAdmin = String(staffRole).trim() === 'администрация';

  const [view, setView] = useState<InventoryStaffView>('dashboard');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [conflictReloadOffer, setConflictReloadOffer] = useState(false);

  const [sessions, setSessions] = useState<InventorySessionRow[]>([]);
  const [assignments, setAssignments] = useState<InventoryParticipantAssignment[]>([]);
  const [itemsBySession, setItemsBySession] = useState<Record<string, InventorySessionItemRow[]>>({});
  const [categories, setCategories] = useState<InventoryCategoryRow[]>([]);
  const [locations, setLocations] = useState<InventoryLocationRow[]>([]);

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [editingItem, setEditingItem] = useState<InventorySessionItemRow | null>(null);
  const [itemDocs, setItemDocs] = useState<InventoryDocumentRow[]>([]);

  const [trackingType, setTrackingType] = useState<'INDIVIDUAL_ASSET' | 'QUANTITY_STOCK'>(
    'INDIVIDUAL_ASSET',
  );
  const [draftName, setDraftName] = useState('');
  const [draftNumber, setDraftNumber] = useState('');
  const [draftSku, setDraftSku] = useState('');
  const [draftCategoryId, setDraftCategoryId] = useState('');
  const [draftLocationId, setDraftLocationId] = useState('');
  const [draftOwnership, setDraftOwnership] = useState<string>('CONDOMINIUM');
  const [draftCondition, setDraftCondition] = useState('good');
  const [countedQty, setCountedQty] = useState('');
  const [unitCode, setUnitCode] = useState('pcs');
  const [note, setNote] = useState('');

  const selectedSession = useMemo(
    () => sessions.find((s) => s.id === sessionId) ?? null,
    [sessions, sessionId],
  );
  const sessionItems = useMemo(
    () => (sessionId ? itemsBySession[sessionId] ?? [] : []),
    [itemsBySession, sessionId],
  );
  const assignment = useMemo(
    () =>
      assignments.find((a) => a.session_id === sessionId && a.staff_id === staffId) ?? null,
    [assignments, sessionId, staffId],
  );

  const dashboardRows = useMemo(() => {
    if (staffId == null) return [];
    const assigned = filterAssignedSessions(sessions, assignments, staffId);
    return assigned.map((session) =>
      computeStaffSessionStats({
        session,
        assignment: assignments.find((a) => a.session_id === session.id && a.staff_id === staffId) ?? null,
        items: itemsBySession[session.id] ?? [],
        staffId,
      }),
    );
  }, [sessions, assignments, itemsBySession, staffId]);

  const load = useCallback(async () => {
    if (staffId == null) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [part, sess, cats, locs] = await Promise.all([
        inventorySelect<InventoryParticipantAssignment>(
          supabase,
          'inventory_session_participants',
          '*',
          { eq: { staff_id: staffId, active: true } },
        ),
        inventorySelect<InventorySessionRow>(supabase, 'inventory_sessions', '*', {
          order: { column: 'created_at', ascending: false },
        }),
        inventorySelect<InventoryCategoryRow>(supabase, 'inventory_categories', '*', {
          eq: { active: true },
          order: { column: 'sort_order' },
        }),
        inventorySelect<InventoryLocationRow>(supabase, 'inventory_locations', '*', {
          eq: { active: true },
          order: { column: 'name' },
        }),
      ]);
      if (part.error && !/relation|schema cache|does not exist/i.test(part.error.message)) {
        throw new Error(part.error.message);
      }
      if (sess.error && !/relation|schema cache|does not exist/i.test(sess.error.message)) {
        throw new Error(sess.error.message);
      }
      const parts = (part.data ?? []).map((p) => ({
        ...p,
        session_id: String(p.session_id),
        assigned_zone_location_id: p.assigned_zone_location_id
          ? String(p.assigned_zone_location_id)
          : null,
        assigned_category_id: p.assigned_category_id ? String(p.assigned_category_id) : null,
      }));
      setAssignments(parts);
      const sessRows = (sess.data ?? []).map((s) => ({ ...s, id: String(s.id) }));
      setSessions(sessRows);
      setCategories((cats.data ?? []).map((c) => ({ ...c, id: String(c.id) })));
      setLocations((locs.data ?? []).map((l) => ({ ...l, id: String(l.id) })));

      const assignedIds = filterAssignedSessions(sessRows, parts, staffId).map((s) => s.id);
      const nextItems: Record<string, InventorySessionItemRow[]> = {};
      await Promise.all(
        assignedIds.map(async (id) => {
          const items = await inventorySelect<InventorySessionItemRow>(
            supabase,
            'inventory_session_items',
            '*',
            { eq: { session_id: id }, order: { column: 'updated_at', ascending: false } },
          );
          nextItems[id] = (items.data ?? []).map(mapItem);
        }),
      );
      setItemsBySession(nextItems);
    } catch (e: unknown) {
      setError(ownerVisibleError(e, t('admin.errGeneric')));
    } finally {
      setLoading(false);
    }
  }, [supabase, staffId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const reloadSessionItems = useCallback(
    async (id: string) => {
      const items = await inventorySelect<InventorySessionItemRow>(
        supabase,
        'inventory_session_items',
        '*',
        { eq: { session_id: id }, order: { column: 'updated_at', ascending: false } },
      );
      setItemsBySession((prev) => ({ ...prev, [id]: (items.data ?? []).map(mapItem) }));
    },
    [supabase],
  );

  const loadFindingDocs = useCallback(
    async (itemId: string) => {
      const { data, error: err } = await inventoryRpc<InventoryDocumentRow[]>(
        supabase,
        'inventory_list_documents_for_session_item',
        { p_session_item_id: itemId },
      );
      if (err) {
        setItemDocs([]);
        return;
      }
      setItemDocs((data ?? []).map((d) => ({ ...d, id: String(d.id) })));
    },
    [supabase],
  );

  function resetForm(from?: InventorySessionItemRow | null) {
    if (from) {
      setTrackingType(
        from.tracking_type === 'QUANTITY_STOCK' ? 'QUANTITY_STOCK' : 'INDIVIDUAL_ASSET',
      );
      setDraftName(from.draft_name);
      setDraftNumber(from.draft_inventory_number ?? '');
      setDraftSku(from.draft_sku_code ?? '');
      setDraftCategoryId(from.draft_category_id ?? '');
      setDraftLocationId(from.draft_location_id ?? '');
      setDraftOwnership(from.draft_ownership_kind ?? 'CONDOMINIUM');
      setDraftCondition(from.draft_condition ?? 'good');
      setCountedQty(from.counted_qty != null ? String(from.counted_qty) : '');
      setUnitCode(from.unit_code ?? 'pcs');
      setNote(from.discrepancy_note ?? '');
      return;
    }
    setTrackingType('INDIVIDUAL_ASSET');
    setDraftName('');
    setDraftNumber('');
    setDraftSku('');
    setDraftCategoryId(assignment?.assigned_category_id ?? '');
    setDraftLocationId(assignment?.assigned_zone_location_id ?? '');
    setDraftOwnership('CONDOMINIUM');
    setDraftCondition('good');
    setCountedQty('');
    setUnitCode('pcs');
    setNote('');
  }

  async function applyLatestFindingFromServer() {
    if (!sessionId || !editingItem) return;
    const items = await inventorySelect<InventorySessionItemRow>(
      supabase,
      'inventory_session_items',
      '*',
      { eq: { session_id: sessionId } },
    );
    const mapped = (items.data ?? []).map(mapItem);
    setItemsBySession((prev) => ({ ...prev, [sessionId]: mapped }));
    const resolved = resolveStaffStaleConflict({
      errorMessage: 'stale row_version',
      editingItemId: editingItem.id,
      latestItems: mapped,
    });
    if (resolved.latestItem) {
      setEditingItem(resolved.latestItem);
      resetForm(resolved.latestItem);
    }
    setConflictReloadOffer(false);
  }

  async function run(action: () => Promise<void>, okMsg: string) {
    setBusy(true);
    setError(null);
    setSuccess(null);
    setConflictReloadOffer(false);
    try {
      await action();
      setSuccess(okMsg);
    } catch (e: unknown) {
      const msg = ownerVisibleError(e, t('admin.errGeneric'));
      if (isStaleRowVersionError(msg) && sessionId) {
        // Never silently overwrite another participant's draft — reload server truth.
        await reloadSessionItems(sessionId);
        const items = await inventorySelect<InventorySessionItemRow>(
          supabase,
          'inventory_session_items',
          '*',
          { eq: { session_id: sessionId } },
        );
        const mapped = (items.data ?? []).map(mapItem);
        setItemsBySession((prev) => ({ ...prev, [sessionId]: mapped }));
        const resolved = resolveStaffStaleConflict({
          errorMessage: msg,
          editingItemId: editingItem?.id ?? null,
          latestItems: mapped,
        });
        setError(t('admin.invStaffConflict'));
        setConflictReloadOffer(resolved.offerReload);
        if (resolved.discardLocalDraft && resolved.latestItem) {
          setEditingItem(resolved.latestItem);
          resetForm(resolved.latestItem);
        }
      } else {
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  }

  function openSession(id: string) {
    setSessionId(id);
    setEditingItem(null);
    setView('session');
    void reloadSessionItems(id);
  }

  function openNewFinding() {
    setEditingItem(null);
    resetForm(null);
    setView('finding_form');
  }

  function openEditFinding(item: InventorySessionItemRow) {
    setEditingItem(item);
    resetForm(item);
    setView('finding_form');
    void loadFindingDocs(item.id);
  }

  async function saveFinding(asSubmit: boolean) {
    if (!sessionId || !selectedSession) return;
    if (!draftName.trim()) {
      setError(t('admin.invStaffNameRequired'));
      return;
    }
    await run(async () => {
      const qty =
        trackingType === 'QUANTITY_STOCK' && countedQty.trim()
          ? Number(countedQty)
          : null;
      if (trackingType === 'QUANTITY_STOCK' && (qty == null || Number.isNaN(qty) || qty < 0)) {
        throw new Error(t('admin.invStaffQtyInvalid'));
      }
      if (editingItem) {
        const { data, error: err } = await inventoryRpc<InventorySessionItemRow>(
          supabase,
          'inventory_update_session_item',
          {
            p_item_id: editingItem.id,
            p_row_version: editingItem.row_version,
            p_draft_name: draftName.trim(),
            p_draft_inventory_number: draftNumber.trim() || null,
            p_draft_sku_code: draftSku.trim() || null,
            p_draft_category_id: draftCategoryId || null,
            p_draft_ownership_kind: draftOwnership,
            p_draft_location_id: draftLocationId || null,
            p_draft_condition: draftCondition,
            p_counted_qty: qty,
            p_unit_code: trackingType === 'QUANTITY_STOCK' ? unitCode : null,
            p_discrepancy_note: note.trim() || null,
          },
        );
        if (err) throw new Error(err.message);
        let itemId = editingItem.id;
        let rowVersion = data ? Number((data as InventorySessionItemRow).row_version) : editingItem.row_version + 1;
        if (asSubmit) {
          const sub = await inventoryRpc(supabase, 'inventory_submit_session_item', {
            p_item_id: itemId,
          });
          if (sub.error) throw new Error(sub.error.message);
          void rowVersion;
        }
      } else {
        const { data, error: err } = await inventoryRpc<InventorySessionItemRow>(
          supabase,
          'inventory_add_session_item',
          {
            p_session_id: sessionId,
            p_tracking_type: trackingType,
            p_draft_name: draftName.trim(),
            p_draft_inventory_number: draftNumber.trim() || null,
            p_draft_sku_code: draftSku.trim() || null,
            p_draft_category_id: draftCategoryId || null,
            p_draft_ownership_kind: draftOwnership,
            p_draft_location_id: draftLocationId || null,
            p_draft_condition: draftCondition,
            p_counted_qty: qty,
            p_unit_code: trackingType === 'QUANTITY_STOCK' ? unitCode : null,
            p_discrepancy_note: note.trim() || null,
          },
        );
        if (err) throw new Error(err.message);
        const created = data as InventorySessionItemRow | null;
        if (asSubmit && created?.id) {
          const sub = await inventoryRpc(supabase, 'inventory_submit_session_item', {
            p_item_id: String(created.id),
          });
          if (sub.error) throw new Error(sub.error.message);
        }
        if (created?.id) {
          setEditingItem(mapItem({ ...created, id: String(created.id) }));
        }
      }
      await reloadSessionItems(sessionId);
      setView('session');
    }, asSubmit ? t('admin.invStaffSubmitted') : t('admin.invStaffSaved'));
  }

  if (staffId == null) {
    return (
      <div className="space-y-4">
        <AdminPageHeader title={t('admin.invStaff')} secondary={t('admin.invStaffDenied')} />
        <AdminInlineAlert tone="danger">{t('admin.invStaffDenied')}</AdminInlineAlert>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <AdminPageHeader
        title={t('admin.invStaff')}
        secondary={t('admin.invStaffLead')}
        action={
          <AdminSecondaryButton type="button" disabled={busy || loading} onClick={() => void load()}>
            {t('admin.invStaffRefresh')}
          </AdminSecondaryButton>
        }
      />
      {error ? (
        <AdminInlineAlert tone="danger">
          <div className="flex flex-wrap items-center gap-3">
            <span>{error}</span>
            {conflictReloadOffer ? (
              <AdminSecondaryButton
                type="button"
                disabled={busy}
                onClick={() => void applyLatestFindingFromServer()}
              >
                {t('admin.invStaffReloadLatest')}
              </AdminSecondaryButton>
            ) : null}
          </div>
        </AdminInlineAlert>
      ) : null}
      {success ? <AdminInlineAlert tone="success">{success}</AdminInlineAlert> : null}

      {loading ? <p className="text-sm text-secondary">{t('admin.loading')}</p> : null}

      {!loading && view === 'dashboard' ? (
        <div className="space-y-4">
          {dashboardRows.length === 0 ? (
            <AdminEmptyState title={t('admin.invStaffNoSessions')} />
          ) : (
            dashboardRows.map((row) => (
              <div key={row.session.id} className={adminCardClass + ' space-y-3 p-4'}>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-base font-semibold">{row.session.title}</h3>
                  <StatusBadge
                    label={row.session.status}
                    tone={inventorySessionStatusTone(row.session.status)}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <AdminMetricCard label={t('admin.invStaffMyFindings')} value={String(row.myFindings)} />
                  <AdminMetricCard label={t('admin.invStaffDrafts')} value={String(row.myDrafts)} />
                  <AdminMetricCard label={t('admin.invStaffPending')} value={String(row.pendingReview)} />
                  <AdminMetricCard
                    label={t('admin.invStaffDiscrepancies')}
                    value={String(row.discrepancies)}
                    alert={row.discrepancies > 0}
                  />
                </div>
                {row.assignment?.assigned_zone_location_id || row.assignment?.assigned_category_id ? (
                  <p className="text-xs text-muted">
                    {t('admin.invStaffScope')}:{' '}
                    {row.assignment.assigned_zone_location_id
                      ? locations.find((l) => l.id === row.assignment?.assigned_zone_location_id)?.name ??
                        '—'
                      : '—'}
                    {' / '}
                    {row.assignment.assigned_category_id
                      ? categoryDisplayName(
                          categories.find((c) => c.id === row.assignment?.assigned_category_id) ?? {
                            name_bg: '—',
                            name_ru: '—',
                            name_en: '—',
                          },
                          locale,
                        )
                      : '—'}
                  </p>
                ) : null}
                {row.lastSavedAt ? (
                  <p className="text-xs text-muted">
                    {t('admin.invStaffLastSaved')}: {formatOwnerDateTime(row.lastSavedAt, locale)}
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <AdminPrimaryButton
                    type="button"
                    className="min-h-11 min-w-[8rem]"
                    onClick={() => openSession(row.session.id)}
                  >
                    {sessionAcceptsNewFindings(row.session.status)
                      ? t('admin.invStaffContinue')
                      : t('admin.invStaffOpen')}
                  </AdminPrimaryButton>
                </div>
              </div>
            ))
          )}
        </div>
      ) : null}

      {!loading && view === 'session' && selectedSession ? (
        <div className="space-y-4">
          <AdminSecondaryButton type="button" onClick={() => setView('dashboard')}>
            ← {t('admin.invStaffBack')}
          </AdminSecondaryButton>
          <div className={adminCardClass + ' space-y-2 p-4'}>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-semibold">{selectedSession.title}</h3>
              <StatusBadge
                label={selectedSession.status}
                tone={inventorySessionStatusTone(selectedSession.status)}
              />
            </div>
            {sessionAcceptsNewFindings(selectedSession.status) ? (
              <AdminPrimaryButton
                type="button"
                className="min-h-12 w-full sm:w-auto"
                disabled={busy}
                onClick={openNewFinding}
              >
                {t('admin.invStaffAddFinding')}
              </AdminPrimaryButton>
            ) : (
              <p className="text-sm text-muted">{t('admin.invStaffSessionLocked')}</p>
            )}
          </div>

          {sessionItems.length === 0 ? (
            <AdminEmptyState title={t('admin.invStaffNoFindings')} />
          ) : (
            <ul className="space-y-3">
              {sessionItems.map((it) => {
                const mine = staffId != null && it.entered_by_staff_id === staffId;
                const canEdit = staffFindingEditable({
                  item: it,
                  staffId,
                  isAdmin,
                  canReview: caps.canSessionReview,
                });
                return (
                  <li key={it.id} className={adminCardClass + ' space-y-2 p-4'}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{it.draft_name}</span>
                      <StatusBadge label={it.finding_status} tone={it.finding_status === 'draft' ? 'warning' : 'info'} />
                      {mine ? (
                        <span className="text-xs text-muted">{t('admin.invStaffMine')}</span>
                      ) : null}
                    </div>
                    <p className="text-xs text-secondary">
                      {it.tracking_type}
                      {it.draft_inventory_number ? ` · ${it.draft_inventory_number}` : ''}
                      {it.counted_qty != null ? ` · ${it.counted_qty} ${it.unit_code ?? ''}` : ''}
                    </p>
                    {it.discrepancy_note ? (
                      <p className="text-sm text-warning">{it.discrepancy_note}</p>
                    ) : null}
                    <div className="flex flex-wrap gap-2">
                      {canEdit ? (
                        <AdminSecondaryButton
                          type="button"
                          className="min-h-11"
                          disabled={busy}
                          onClick={() => openEditFinding(it)}
                        >
                          {t('admin.invStaffEdit')}
                        </AdminSecondaryButton>
                      ) : (
                        <AdminSecondaryButton
                          type="button"
                          className="min-h-11"
                          onClick={() => {
                            setEditingItem(it);
                            setView('finding_detail');
                            void loadFindingDocs(it.id);
                          }}
                        >
                          {t('admin.invStaffView')}
                        </AdminSecondaryButton>
                      )}
                      {canEdit && it.finding_status === 'draft' ? (
                        <AdminSecondaryButton
                          type="button"
                          className="min-h-11"
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              const { error: err } = await inventoryRpc(
                                supabase,
                                'inventory_submit_session_item',
                                { p_item_id: it.id },
                              );
                              if (err) throw new Error(err.message);
                              if (sessionId) await reloadSessionItems(sessionId);
                            }, t('admin.invStaffSubmitted'))
                          }
                        >
                          {t('admin.invStaffSubmitItem')}
                        </AdminSecondaryButton>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}

      {!loading && (view === 'finding_form' || view === 'finding_detail') && selectedSession ? (
        <div className="space-y-4">
          <AdminSecondaryButton
            type="button"
            onClick={() => {
              setView('session');
              setEditingItem(null);
            }}
          >
            ← {t('admin.invStaffBack')}
          </AdminSecondaryButton>

          {view === 'finding_form' ? (
            <form
              className={adminFormPanelClass + ' space-y-3 p-4'}
              onSubmit={(e) => {
                e.preventDefault();
                void saveFinding(false);
              }}
            >
              <h3 className="text-base font-semibold">
                {editingItem ? t('admin.invStaffEditFinding') : t('admin.invStaffAddFinding')}
              </h3>
              <label className="block space-y-1 text-sm">
                <span>{t('admin.invStaffTracking')}</span>
                <select
                  className={adminFieldClass + ' min-h-11'}
                  value={trackingType}
                  disabled={Boolean(editingItem)}
                  onChange={(e) =>
                    setTrackingType(e.target.value as 'INDIVIDUAL_ASSET' | 'QUANTITY_STOCK')
                  }
                >
                  <option value="INDIVIDUAL_ASSET">{t('admin.invStaffAsset')}</option>
                  <option value="QUANTITY_STOCK">{t('admin.invStaffStock')}</option>
                </select>
              </label>
              <input
                className={adminFieldClass + ' min-h-11'}
                placeholder={t('admin.invStaffName')}
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                required
              />
              <select
                className={adminFieldClass + ' min-h-11'}
                value={draftCategoryId}
                onChange={(e) => setDraftCategoryId(e.target.value)}
              >
                <option value="">{t('admin.invStaffCategory')}</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {categoryDisplayName(c, locale)}
                  </option>
                ))}
              </select>
              <select
                className={adminFieldClass + ' min-h-11'}
                value={draftLocationId}
                onChange={(e) => setDraftLocationId(e.target.value)}
              >
                <option value="">{t('admin.invStaffLocation')}</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
              <select
                className={adminFieldClass + ' min-h-11'}
                value={draftOwnership}
                onChange={(e) => setDraftOwnership(e.target.value)}
              >
                {OWNERSHIP.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
              {trackingType === 'INDIVIDUAL_ASSET' ? (
                <>
                  <input
                    className={adminFieldClass + ' min-h-11'}
                    placeholder={t('admin.invStaffInvNumber')}
                    value={draftNumber}
                    onChange={(e) => setDraftNumber(e.target.value)}
                  />
                  <select
                    className={adminFieldClass + ' min-h-11'}
                    value={draftCondition}
                    onChange={(e) => setDraftCondition(e.target.value)}
                  >
                    {CONDITIONS.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <input
                    className={adminFieldClass + ' min-h-11 min-w-[8rem] flex-1'}
                    placeholder={t('admin.invStaffSku')}
                    value={draftSku}
                    onChange={(e) => setDraftSku(e.target.value)}
                  />
                  <input
                    className={adminFieldClass + ' min-h-11 w-28'}
                    type="number"
                    min="0"
                    step="any"
                    placeholder={t('admin.invStaffQty')}
                    value={countedQty}
                    onChange={(e) => setCountedQty(e.target.value)}
                    required
                  />
                  <input
                    className={adminFieldClass + ' min-h-11 w-24'}
                    placeholder={t('admin.invStaffUnit')}
                    value={unitCode}
                    onChange={(e) => setUnitCode(e.target.value)}
                  />
                </div>
              )}
              <textarea
                className={adminFieldClass + ' min-h-20'}
                placeholder={t('admin.invStaffNote')}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <div className="flex flex-col gap-2 sm:flex-row">
                <AdminPrimaryButton type="submit" className="min-h-12 flex-1" disabled={busy}>
                  {t('admin.invStaffSaveDraft')}
                </AdminPrimaryButton>
                <AdminSecondaryButton
                  type="button"
                  className="min-h-12 flex-1"
                  disabled={busy}
                  onClick={() => void saveFinding(true)}
                >
                  {t('admin.invStaffSaveSubmit')}
                </AdminSecondaryButton>
              </div>
            </form>
          ) : null}

          {editingItem ? (
            <div className={adminFormPanelClass + ' space-y-3 p-4'}>
              <h4 className="text-sm font-semibold">{t('admin.invStaffPhotos')}</h4>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                disabled={busy || view === 'finding_detail'}
                className="min-h-11 w-full text-sm"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (!file || !editingItem) return;
                  void run(async () => {
                    try {
                      await uploadAndRegisterInventoryDocument({
                        supabase,
                        file,
                        scope: 'session-item',
                        targetId: editingItem.id,
                        title: file.name,
                        docKind: 'finding_photo',
                        sessionItemRowVersion: editingItem.row_version,
                      });
                      await loadFindingDocs(editingItem.id);
                      if (sessionId) await reloadSessionItems(sessionId);
                    } catch (err) {
                      if (err instanceof InventoryDocumentValidationError) {
                        throw new Error(
                          err.reason === 'size'
                            ? t('admin.invFileTooLarge')
                            : t('admin.invFileType'),
                        );
                      }
                      throw err;
                    }
                  }, t('admin.invStaffPhotoUploaded'));
                }}
              />
              <ul className="flex flex-wrap gap-3">
                {itemDocs.map((d) =>
                  d.mime_type?.startsWith('image/') ? (
                    <li key={d.id}>
                      <SignedStorageImage
                        stored={d.storage_path}
                        alt={d.title}
                        className="h-24 w-24 rounded object-cover"
                      />
                    </li>
                  ) : (
                    <li key={d.id}>
                      <SignedStorageLink stored={d.storage_path} className="text-accent underline">
                        {d.title}
                      </SignedStorageLink>
                    </li>
                  ),
                )}
                {itemDocs.length === 0 ? (
                  <li className="text-sm text-muted">{t('admin.invStaffNoPhotos')}</li>
                ) : null}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Re-export for tests that probe capability parsing without UI mount. */
export { parseInventoryStaffCapabilities };
