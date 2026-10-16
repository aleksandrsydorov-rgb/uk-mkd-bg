'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { useI18n } from '@/i18n/I18nProvider';
import { ownerVisibleError } from '@/lib/ownerError';
import {
  canSeeInventoryAdmin,
  categoryDisplayName,
  computeInventoryOverview,
  filterAssets,
  inventoryAssetStatusTone,
  inventoryRpc,
  inventorySelect,
  inventorySessionStatusTone,
  type InventoryAdminView,
  type InventoryAssetRow,
  type InventoryCategoryRow,
  type InventoryDocumentRow,
  type InventoryLocationRow,
  type InventorySessionItemRow,
  type InventorySessionRow,
  type InventoryStockBalanceRow,
} from '@/lib/inventory';
import {
  InventoryDocumentValidationError,
  uploadAndRegisterInventoryDocument,
} from '@/lib/inventory/documentsClient';
import { SignedStorageLink, SignedStorageImage } from '@/components/SignedStorageMedia';
import {
  AdminPageHeader,
  AdminEmptyState,
  AdminInlineAlert,
  AdminPrimaryButton,
  AdminSecondaryButton,
  AdminMetricCard,
  AdminTableShell,
  AdminTabBar,
  adminCardClass,
  adminFieldClass,
  adminFormPanelClass,
  adminTableCellClass,
  adminTableHeadRowClass,
  adminTableRowClass,
} from '@/components/admin/AdminUi';
import { StatusBadge } from '@/components/account/ownerUi';

type StaffOpt = { id: number; name: string; email: string | null };

export function AdminInventory({
  supabase,
  staffRole,
}: {
  supabase: SupabaseClient<Database>;
  staffRole: string;
}) {
  const { t, locale } = useI18n();
  const canSee = canSeeInventoryAdmin(staffRole);

  const [view, setView] = useState<InventoryAdminView>('overview');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [assets, setAssets] = useState<InventoryAssetRow[]>([]);
  const [balances, setBalances] = useState<InventoryStockBalanceRow[]>([]);
  const [categories, setCategories] = useState<InventoryCategoryRow[]>([]);
  const [locations, setLocations] = useState<InventoryLocationRow[]>([]);
  const [sessions, setSessions] = useState<InventorySessionRow[]>([]);
  const [staff, setStaff] = useState<StaffOpt[]>([]);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [sessionItems, setSessionItems] = useState<InventorySessionItemRow[]>([]);
  const [assetDocs, setAssetDocs] = useState<InventoryDocumentRow[]>([]);
  const [assetEvents, setAssetEvents] = useState<
    Array<{ id: number; event_kind: string; event_at: string; note: string | null }>
  >([]);

  const [assetSearch, setAssetSearch] = useState('');
  const [assetFilterOwnership, setAssetFilterOwnership] = useState('');
  const [assetFilterStatus, setAssetFilterStatus] = useState('');

  const [draftNumber, setDraftNumber] = useState('');
  const [draftName, setDraftName] = useState('');
  const [draftOwnership, setDraftOwnership] = useState('CONDOMINIUM');
  const [draftCategoryId, setDraftCategoryId] = useState('');

  const [stockSku, setStockSku] = useState('');
  const [stockName, setStockName] = useState('');
  const [stockUnit, setStockUnit] = useState('pcs');
  const [stockMoveId, setStockMoveId] = useState('');
  const [stockMoveType, setStockMoveType] = useState('RECEIPT');
  const [stockMoveQty, setStockMoveQty] = useState('1');

  const [catCode, setCatCode] = useState('');
  const [catBg, setCatBg] = useState('');
  const [catRu, setCatRu] = useState('');
  const [catEn, setCatEn] = useState('');
  const [catParent, setCatParent] = useState('');

  const [locCode, setLocCode] = useState('');
  const [locName, setLocName] = useState('');
  const [locKind, setLocKind] = useState('storage');

  const [sessTitle, setSessTitle] = useState('');
  const [assignStaffId, setAssignStaffId] = useState('');
  const [editName, setEditName] = useState('');
  const [transferLocationId, setTransferLocationId] = useState('');
  const [maintSummary, setMaintSummary] = useState('');
  const [maintKind, setMaintKind] = useState('service');

  const categoryNameById = useMemo(() => {
    const m: Record<string, string> = {};
    for (const c of categories) m[c.id] = categoryDisplayName(c, locale);
    return m;
  }, [categories, locale]);

  const overview = useMemo(
    () =>
      computeInventoryOverview({
        assets,
        balances,
        sessions,
        categoryNameById,
      }),
    [assets, balances, sessions, categoryNameById],
  );

  const filteredAssets = useMemo(
    () =>
      filterAssets(assets, {
        search: assetSearch,
        ownership: assetFilterOwnership || undefined,
        status: assetFilterStatus || undefined,
      }),
    [assets, assetSearch, assetFilterOwnership, assetFilterStatus],
  );

  const selectedAsset = useMemo(
    () => assets.find((a) => a.id === selectedAssetId) ?? null,
    [assets, selectedAssetId],
  );

  useEffect(() => {
    if (selectedAsset) setEditName(selectedAsset.name);
  }, [selectedAsset]);
  const selectedSession = useMemo(
    () => sessions.find((s) => s.id === selectedSessionId) ?? null,
    [sessions, selectedSessionId],
  );

  const tabs = useMemo(
    () => [
      { id: 'overview', label: t('admin.invTabOverview') },
      { id: 'assets', label: t('admin.invTabAssets') },
      { id: 'stock', label: t('admin.invTabStock') },
      { id: 'categories', label: t('admin.invTabCategories') },
      { id: 'locations', label: t('admin.invTabLocations') },
      { id: 'sessions', label: t('admin.invTabSessions') },
    ],
    [t],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [a, b, c, l, s, st] = await Promise.all([
        inventorySelect<InventoryAssetRow>(supabase, 'inventory_assets', '*', {
          order: { column: 'inventory_number' },
        }),
        inventorySelect<InventoryStockBalanceRow>(supabase, 'inventory_stock_balances'),
        inventorySelect<InventoryCategoryRow>(supabase, 'inventory_categories', '*', {
          order: { column: 'sort_order' },
        }),
        inventorySelect<InventoryLocationRow>(supabase, 'inventory_locations', '*', {
          order: { column: 'code' },
        }),
        inventorySelect<InventorySessionRow>(supabase, 'inventory_sessions', '*', {
          order: { column: 'created_at', ascending: false },
        }),
        inventorySelect<StaffOpt>(supabase, 'staff', 'id, name, email', {
          eq: { active: true },
          order: { column: 'name' },
        }),
      ]);
      const firstErr = a.error || b.error || c.error || l.error || s.error;
      if (firstErr) {
        setError(
          firstErr.message.includes('permission') || firstErr.message.includes('does not exist')
            ? t('admin.invMigrationNeeded')
            : ownerVisibleError(firstErr, t('admin.errGeneric')),
        );
      }
      setAssets(a.data.map((r) => ({ ...r, id: String(r.id) })));
      setBalances(
        b.data.map((r) => ({
          ...r,
          stock_item_id: String(r.stock_item_id),
          qty_on_hand: Number(r.qty_on_hand),
          min_qty: r.min_qty == null ? null : Number(r.min_qty),
        })),
      );
      setCategories(c.data.map((r) => ({ ...r, id: String(r.id) })));
      setLocations(l.data.map((r) => ({ ...r, id: String(r.id) })));
      setSessions(s.data.map((r) => ({ ...r, id: String(r.id) })));
      setStaff(st.data);
    } catch (e: unknown) {
      setError(ownerVisibleError(e, t('admin.errGeneric')));
    } finally {
      setLoading(false);
    }
  }, [supabase, t]);

  useEffect(() => {
    if (canSee) void load();
  }, [canSee, load]);

  const loadAssetDetail = useCallback(
    async (assetId: string) => {
      const [docs, ev] = await Promise.all([
        inventoryRpc<InventoryDocumentRow[]>(supabase, 'inventory_list_documents_for_asset', {
          p_asset_id: assetId,
        }),
        inventorySelect<{ id: number; event_kind: string; event_at: string; note: string | null }>(
          supabase,
          'inventory_asset_events',
          'id, event_kind, event_at, note',
          { eq: { asset_id: assetId }, order: { column: 'event_at', ascending: false } },
        ),
      ]);
      setAssetDocs((docs.data ?? []).map((d) => ({ ...d, id: String(d.id) })));
      setAssetEvents(ev.data.slice(0, 40));
    },
    [supabase],
  );

  const loadSessionDetail = useCallback(
    async (sessionId: string) => {
      const items = await inventorySelect<InventorySessionItemRow>(
        supabase,
        'inventory_session_items',
        '*',
        { eq: { session_id: sessionId }, order: { column: 'created_at' } },
      );
      setSessionItems(items.data.map((r) => ({ ...r, id: String(r.id) })));
    },
    [supabase],
  );

  useEffect(() => {
    if (selectedAssetId) void loadAssetDetail(selectedAssetId);
  }, [selectedAssetId, loadAssetDetail]);

  useEffect(() => {
    if (selectedSessionId) void loadSessionDetail(selectedSessionId);
  }, [selectedSessionId, loadSessionDetail]);

  async function run(action: () => Promise<void>, okMsg: string) {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await action();
      setSuccess(okMsg);
      await load();
    } catch (e: unknown) {
      setError(ownerVisibleError(e, t('admin.errGeneric')));
    } finally {
      setBusy(false);
    }
  }

  if (!canSee) {
    return (
      <div className="space-y-4">
        <AdminPageHeader title={t('admin.inventory')} secondary={t('admin.invDenied')} />
        <AdminInlineAlert tone="danger">{t('admin.invDenied')}</AdminInlineAlert>
      </div>
    );
  }

  const mainTab =
    view === 'asset_detail' || view === 'session_detail'
      ? view === 'asset_detail'
        ? 'assets'
        : 'sessions'
      : view;

  return (
    <div className="space-y-4">
      <AdminPageHeader
        title={t('admin.inventory')}
        secondary={t('admin.invLead')}
        action={
          <AdminSecondaryButton type="button" disabled={busy || loading} onClick={() => void load()}>
            {t('admin.invRefresh')}
          </AdminSecondaryButton>
        }
      />
      <AdminInlineAlert tone="info">{t('admin.invNoFinance')}</AdminInlineAlert>
      {error ? <AdminInlineAlert tone="danger">{error}</AdminInlineAlert> : null}
      {success ? <AdminInlineAlert tone="success">{success}</AdminInlineAlert> : null}

      <AdminTabBar
        tabs={tabs}
        active={mainTab}
        onChange={(key) => {
          setView(key as InventoryAdminView);
          setSelectedAssetId(null);
          setSelectedSessionId(null);
        }}
      />

      {loading ? (
        <p className="text-sm text-secondary">{t('admin.loading')}</p>
      ) : null}

      {!loading && view === 'overview' ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <AdminMetricCard label={t('admin.invMetricActive')} value={String(overview.activeAssets)} />
            <AdminMetricCard label={t('admin.invMetricStock')} value={String(overview.stockSkuCount)} />
            <AdminMetricCard
              label={t('admin.invMetricLowStock')}
              value={String(overview.lowStockCount)}
              alert={overview.lowStockCount > 0}
            />
            <AdminMetricCard
              label={t('admin.invMetricSessions')}
              value={String(overview.activeSessions)}
              secondary={t('admin.invMetricReview', { n: String(overview.pendingReview) })}
            />
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <div className={adminCardClass + ' p-4'}>
              <h3 className="text-sm font-semibold">{t('admin.invByOwnership')}</h3>
              <ul className="mt-2 space-y-1 text-sm">
                {Object.entries(overview.byOwnership).map(([k, n]) => (
                  <li key={k} className="flex justify-between gap-2">
                    <span className="text-secondary">{k}</span>
                    <span className="tabular-nums">{n}</span>
                  </li>
                ))}
                {Object.keys(overview.byOwnership).length === 0 ? (
                  <li className="text-muted">{t('admin.invEmpty')}</li>
                ) : null}
              </ul>
            </div>
            <div className={adminCardClass + ' p-4'}>
              <h3 className="text-sm font-semibold">{t('admin.invByCondition')}</h3>
              <ul className="mt-2 space-y-1 text-sm">
                {Object.entries(overview.byCondition).map(([k, n]) => (
                  <li key={k} className="flex justify-between gap-2">
                    <span className="text-secondary">{k}</span>
                    <span className="tabular-nums">{n}</span>
                  </li>
                ))}
                {Object.keys(overview.byCondition).length === 0 ? (
                  <li className="text-muted">{t('admin.invEmpty')}</li>
                ) : null}
              </ul>
            </div>
            <div className={adminCardClass + ' p-4'}>
              <h3 className="text-sm font-semibold">{t('admin.invByCategory')}</h3>
              <ul className="mt-2 space-y-1 text-sm">
                {Object.entries(overview.byCategory)
                  .slice(0, 8)
                  .map(([k, n]) => (
                    <li key={k} className="flex justify-between gap-2">
                      <span className="text-secondary truncate">{k}</span>
                      <span className="tabular-nums">{n}</span>
                    </li>
                  ))}
                {Object.keys(overview.byCategory).length === 0 ? (
                  <li className="text-muted">{t('admin.invEmpty')}</li>
                ) : null}
              </ul>
            </div>
          </div>
        </div>
      ) : null}

      {!loading && (view === 'assets' || view === 'asset_detail') ? (
        <div className="space-y-4">
          {view === 'assets' ? (
            <>
              <form
                className={adminFormPanelClass}
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(async () => {
                    const { error: err } = await inventoryRpc(supabase, 'inventory_create_draft_asset', {
                      p_inventory_number: draftNumber.trim(),
                      p_name: draftName.trim(),
                      p_ownership_kind: draftOwnership,
                      p_category_id: draftCategoryId || null,
                    });
                    if (err) throw err;
                    setDraftNumber('');
                    setDraftName('');
                  }, t('admin.invAssetCreated'));
                }}
              >
                <h3 className="text-sm font-semibold">{t('admin.invCreateAsset')}</h3>
                <div className="grid gap-2 md:grid-cols-4">
                  <input
                    className={adminFieldClass}
                    placeholder={t('admin.invNumber')}
                    value={draftNumber}
                    onChange={(e) => setDraftNumber(e.target.value)}
                    required
                  />
                  <input
                    className={adminFieldClass}
                    placeholder={t('admin.invName')}
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    required
                  />
                  <select
                    className={adminFieldClass}
                    value={draftOwnership}
                    onChange={(e) => setDraftOwnership(e.target.value)}
                  >
                    <option value="CONDOMINIUM">CONDOMINIUM</option>
                    <option value="MANAGEMENT_COMPANY">MANAGEMENT_COMPANY</option>
                    <option value="THIRD_PARTY">THIRD_PARTY</option>
                  </select>
                  <select
                    className={adminFieldClass}
                    value={draftCategoryId}
                    onChange={(e) => setDraftCategoryId(e.target.value)}
                  >
                    <option value="">{t('admin.invCategory')}</option>
                    {categories
                      .filter((c) => c.active)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {categoryDisplayName(c, locale)}
                        </option>
                      ))}
                  </select>
                </div>
                <AdminPrimaryButton type="submit" disabled={busy}>
                  {t('admin.invCreateDraft')}
                </AdminPrimaryButton>
              </form>

              <div className="grid gap-2 md:grid-cols-3">
                <input
                  className={adminFieldClass}
                  placeholder={t('admin.invSearch')}
                  value={assetSearch}
                  onChange={(e) => setAssetSearch(e.target.value)}
                />
                <select
                  className={adminFieldClass}
                  value={assetFilterOwnership}
                  onChange={(e) => setAssetFilterOwnership(e.target.value)}
                >
                  <option value="">{t('admin.invAllOwnership')}</option>
                  <option value="CONDOMINIUM">CONDOMINIUM</option>
                  <option value="MANAGEMENT_COMPANY">MANAGEMENT_COMPANY</option>
                  <option value="THIRD_PARTY">THIRD_PARTY</option>
                </select>
                <select
                  className={adminFieldClass}
                  value={assetFilterStatus}
                  onChange={(e) => setAssetFilterStatus(e.target.value)}
                >
                  <option value="">{t('admin.invAllStatus')}</option>
                  {['draft', 'active', 'assigned', 'maintenance', 'written_off', 'archived'].map(
                    (s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ),
                  )}
                </select>
              </div>

              {filteredAssets.length === 0 ? (
                <AdminEmptyState title={t('admin.invEmptyAssets')} />
              ) : (
                <AdminTableShell>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className={adminTableHeadRowClass}>
                        <th className={adminTableCellClass}>{t('admin.invNumber')}</th>
                        <th className={adminTableCellClass}>{t('admin.invName')}</th>
                        <th className={adminTableCellClass}>{t('admin.invOwnership')}</th>
                        <th className={adminTableCellClass}>{t('admin.invStatus')}</th>
                        <th className={adminTableCellClass} />
                      </tr>
                    </thead>
                    <tbody>
                      {filteredAssets.map((a) => (
                        <tr key={a.id} className={adminTableRowClass}>
                          <td className={adminTableCellClass}>{a.inventory_number}</td>
                          <td className={adminTableCellClass}>{a.name}</td>
                          <td className={adminTableCellClass}>{a.ownership_kind}</td>
                          <td className={adminTableCellClass}>
                            <StatusBadge
                              label={a.operational_status}
                              tone={inventoryAssetStatusTone(a.operational_status)}
                            />
                          </td>
                          <td className={adminTableCellClass}>
                            <AdminSecondaryButton
                              type="button"
                              onClick={() => {
                                setSelectedAssetId(a.id);
                                setView('asset_detail');
                              }}
                            >
                              {t('admin.invOpen')}
                            </AdminSecondaryButton>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </AdminTableShell>
              )}
            </>
          ) : null}

          {view === 'asset_detail' && selectedAsset ? (
            <div className="space-y-4">
              <AdminSecondaryButton type="button" onClick={() => setView('assets')}>
                ← {t('admin.invBack')}
              </AdminSecondaryButton>
              <div className={adminCardClass + ' space-y-2 p-4'}>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-lg font-semibold">{selectedAsset.name}</h3>
                  <StatusBadge
                    label={selectedAsset.operational_status}
                    tone={inventoryAssetStatusTone(selectedAsset.operational_status)}
                  />
                </div>
                <p className="text-sm text-secondary">
                  {selectedAsset.inventory_number} · {selectedAsset.ownership_kind} ·{' '}
                  {selectedAsset.condition}
                </p>
                {selectedAsset.estimated_value_eur != null ? (
                  <p className="text-xs text-muted">
                    {t('admin.invEstValueInfo')}: {selectedAsset.estimated_value_eur} EUR
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-2 pt-2">
                  {selectedAsset.operational_status === 'draft' ? (
                    <AdminPrimaryButton
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          const { error: err } = await inventoryRpc(supabase, 'inventory_activate_asset', {
                            p_asset_id: selectedAsset.id,
                          });
                          if (err) throw err;
                        }, t('admin.invActivated'))
                      }
                    >
                      {t('admin.invActivate')}
                    </AdminPrimaryButton>
                  ) : null}
                  {['active', 'assigned', 'maintenance'].includes(selectedAsset.operational_status) ? (
                    <>
                      <select
                        className={adminFieldClass + ' max-w-xs'}
                        value={assignStaffId}
                        onChange={(e) => setAssignStaffId(e.target.value)}
                      >
                        <option value="">{t('admin.invAssignStaff')}</option>
                        {staff.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                      <AdminSecondaryButton
                        type="button"
                        disabled={busy || !assignStaffId}
                        onClick={() =>
                          void run(async () => {
                            const { error: err } = await inventoryRpc(supabase, 'inventory_assign_asset', {
                              p_asset_id: selectedAsset.id,
                              p_staff_id: Number(assignStaffId),
                            });
                            if (err) throw err;
                          }, t('admin.invAssigned'))
                        }
                      >
                        {t('admin.invAssign')}
                      </AdminSecondaryButton>
                      <AdminSecondaryButton
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          if (!confirm(t('admin.invWriteOffConfirm'))) return;
                          void run(async () => {
                            const { error: e1 } = await inventoryRpc(
                              supabase,
                              'inventory_propose_asset_write_off',
                              { p_asset_id: selectedAsset.id, p_reason: 'admin UI' },
                            );
                            if (e1) throw e1;
                            const { error: e2 } = await inventoryRpc(
                              supabase,
                              'inventory_approve_asset_write_off',
                              { p_asset_id: selectedAsset.id },
                            );
                            if (e2) throw e2;
                          }, t('admin.invWrittenOff'));
                        }}
                      >
                        {t('admin.invWriteOff')}
                      </AdminSecondaryButton>
                    </>
                  ) : null}
                  {selectedAsset.operational_status === 'written_off' ? (
                    <AdminSecondaryButton
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          const { error: err } = await inventoryRpc(supabase, 'inventory_archive_asset', {
                            p_asset_id: selectedAsset.id,
                          });
                          if (err) throw err;
                        }, t('admin.invArchived'))
                      }
                    >
                      {t('admin.invArchive')}
                    </AdminSecondaryButton>
                  ) : null}
                </div>
              </div>

              {!['written_off', 'archived'].includes(selectedAsset.operational_status) ? (
                <form
                  className={adminFormPanelClass + ' space-y-2'}
                  onSubmit={(e) => {
                    e.preventDefault();
                    void run(async () => {
                      const { error: err } = await inventoryRpc(supabase, 'inventory_update_asset', {
                        p_asset_id: selectedAsset.id,
                        p_name: editName.trim(),
                      });
                      if (err) throw err;
                    }, t('admin.invAssetUpdated'));
                  }}
                >
                  <h4 className="text-sm font-semibold">{t('admin.invEditAsset')}</h4>
                  <input
                    className={adminFieldClass}
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    placeholder={t('admin.invName')}
                    required
                  />
                  <AdminPrimaryButton type="submit" disabled={busy}>
                    {t('admin.invSave')}
                  </AdminPrimaryButton>
                </form>
              ) : null}

              {['active', 'assigned', 'maintenance'].includes(selectedAsset.operational_status) ? (
                <div className={adminFormPanelClass + ' space-y-2'}>
                  <h4 className="text-sm font-semibold">{t('admin.invTransfer')}</h4>
                  <div className="flex flex-wrap gap-2">
                    <select
                      className={adminFieldClass + ' max-w-xs'}
                      value={transferLocationId}
                      onChange={(e) => setTransferLocationId(e.target.value)}
                    >
                      <option value="">{t('admin.invPickLocation')}</option>
                      {locations.map((loc) => (
                        <option key={loc.id} value={loc.id}>
                          {loc.name}
                        </option>
                      ))}
                    </select>
                    <AdminSecondaryButton
                      type="button"
                      disabled={busy || !transferLocationId}
                      onClick={() =>
                        void run(async () => {
                          const { error: err } = await inventoryRpc(supabase, 'inventory_transfer_asset', {
                            p_asset_id: selectedAsset.id,
                            p_to_location_id: transferLocationId,
                          });
                          if (err) throw err;
                          setTransferLocationId('');
                        }, t('admin.invTransferred'))
                      }
                    >
                      {t('admin.invTransfer')}
                    </AdminSecondaryButton>
                  </div>
                  <h4 className="pt-2 text-sm font-semibold">{t('admin.invMaintenance')}</h4>
                  <div className="flex flex-wrap gap-2">
                    <select
                      className={adminFieldClass + ' max-w-xs'}
                      value={maintKind}
                      onChange={(e) => setMaintKind(e.target.value)}
                    >
                      <option value="inspection">inspection</option>
                      <option value="repair">repair</option>
                      <option value="service">service</option>
                      <option value="calibration">calibration</option>
                      <option value="other">other</option>
                    </select>
                    <input
                      className={adminFieldClass + ' min-w-[12rem] flex-1'}
                      value={maintSummary}
                      onChange={(e) => setMaintSummary(e.target.value)}
                      placeholder={t('admin.invMaintSummary')}
                    />
                    <AdminSecondaryButton
                      type="button"
                      disabled={busy || !maintSummary.trim()}
                      onClick={() =>
                        void run(async () => {
                          const { error: err } = await inventoryRpc(
                            supabase,
                            'inventory_record_maintenance',
                            {
                              p_asset_id: selectedAsset.id,
                              p_event_kind: maintKind,
                              p_summary: maintSummary.trim(),
                            },
                          );
                          if (err) throw err;
                          setMaintSummary('');
                        }, t('admin.invMaintenanceSaved'))
                      }
                    >
                      {t('admin.invRecordMaintenance')}
                    </AdminSecondaryButton>
                  </div>
                </div>
              ) : null}

              <div className={adminFormPanelClass}>
                <h4 className="text-sm font-semibold">{t('admin.invDocuments')}</h4>
                <input
                  type="file"
                  accept="image/*,.pdf,.doc,.docx"
                  disabled={busy}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (!file) return;
                    void run(async () => {
                      try {
                        await uploadAndRegisterInventoryDocument({
                          supabase,
                          file,
                          scope: 'asset',
                          targetId: selectedAsset.id,
                          title: file.name,
                          docKind: file.type.startsWith('image/') ? 'photo' : 'other',
                        });
                        await loadAssetDetail(selectedAsset.id);
                      } catch (err) {
                        if (err instanceof InventoryDocumentValidationError) {
                          throw new Error(
                            err.reason === 'size' ? t('admin.invFileTooLarge') : t('admin.invFileType'),
                          );
                        }
                        throw err;
                      }
                    }, t('admin.invDocUploaded'));
                  }}
                />
                <ul className="mt-2 space-y-2 text-sm">
                  {assetDocs.map((d) => (
                    <li key={d.id} className="flex flex-wrap items-center gap-2">
                      <span>{d.title}</span>
                      <span className="text-xs text-muted">{d.doc_kind}</span>
                      {d.mime_type?.startsWith('image/') ? (
                        <SignedStorageImage
                          stored={d.storage_path}
                          alt={d.title}
                          className="h-16 w-16 rounded object-cover"
                        />
                      ) : (
                        <SignedStorageLink stored={d.storage_path} className="text-accent underline">
                          {t('admin.invOpenDoc')}
                        </SignedStorageLink>
                      )}
                    </li>
                  ))}
                  {assetDocs.length === 0 ? <li className="text-muted">{t('admin.invNoDocs')}</li> : null}
                </ul>
              </div>

              <div className={adminCardClass + ' p-4'}>
                <h4 className="text-sm font-semibold">{t('admin.invAudit')}</h4>
                <ul className="mt-2 max-h-64 space-y-1 overflow-auto text-xs">
                  {assetEvents.map((ev) => (
                    <li key={ev.id} className="border-b border-border py-1">
                      <span className="text-muted">{ev.event_at}</span> · {ev.event_kind}
                      {ev.note ? ` — ${ev.note}` : ''}
                    </li>
                  ))}
                  {assetEvents.length === 0 ? <li className="text-muted">{t('admin.invEmpty')}</li> : null}
                </ul>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {!loading && view === 'stock' ? (
        <div className="space-y-4">
          <form
            className={adminFormPanelClass}
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                const { error: err } = await inventoryRpc(supabase, 'inventory_register_stock_item', {
                  p_sku_code: stockSku.trim(),
                  p_name: stockName.trim(),
                  p_ownership_kind: 'CONDOMINIUM',
                  p_unit_code: stockUnit,
                });
                if (err) throw err;
                setStockSku('');
                setStockName('');
              }, t('admin.invStockCreated'));
            }}
          >
            <h3 className="text-sm font-semibold">{t('admin.invRegisterSku')}</h3>
            <div className="grid gap-2 md:grid-cols-3">
              <input
                className={adminFieldClass}
                placeholder="SKU"
                value={stockSku}
                onChange={(e) => setStockSku(e.target.value)}
                required
              />
              <input
                className={adminFieldClass}
                placeholder={t('admin.invName')}
                value={stockName}
                onChange={(e) => setStockName(e.target.value)}
                required
              />
              <select className={adminFieldClass} value={stockUnit} onChange={(e) => setStockUnit(e.target.value)}>
                {['pcs', 'l', 'ml', 'kg', 'g', 'm', 'pack', 'box'].map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </div>
            <AdminPrimaryButton type="submit" disabled={busy}>
              {t('admin.invCreateSku')}
            </AdminPrimaryButton>
          </form>

          <form
            className={adminFormPanelClass}
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                const { error: err } = await inventoryRpc(supabase, 'inventory_stock_move', {
                  p_stock_item_id: stockMoveId,
                  p_movement_type: stockMoveType,
                  p_qty: Number(stockMoveQty),
                  p_idempotency_key: crypto.randomUUID(),
                });
                if (err) throw err;
              }, t('admin.invMoveDone'));
            }}
          >
            <h3 className="text-sm font-semibold">{t('admin.invStockMove')}</h3>
            <div className="grid gap-2 md:grid-cols-3">
              <select
                className={adminFieldClass}
                value={stockMoveId}
                onChange={(e) => setStockMoveId(e.target.value)}
                required
              >
                <option value="">{t('admin.invPickSku')}</option>
                {balances.map((b) => (
                  <option key={b.stock_item_id} value={b.stock_item_id}>
                    {b.sku_code} — {b.name}
                  </option>
                ))}
              </select>
              <select
                className={adminFieldClass}
                value={stockMoveType}
                onChange={(e) => setStockMoveType(e.target.value)}
              >
                {['OPENING', 'RECEIPT', 'ISSUE', 'TRANSFER', 'ADJUSTMENT', 'WRITE_OFF'].map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <input
                className={adminFieldClass}
                type="number"
                step="any"
                value={stockMoveQty}
                onChange={(e) => setStockMoveQty(e.target.value)}
                required
              />
            </div>
            <AdminPrimaryButton type="submit" disabled={busy || !stockMoveId}>
              {t('admin.invPostMove')}
            </AdminPrimaryButton>
          </form>

          {balances.length === 0 ? (
            <AdminEmptyState title={t('admin.invEmptyStock')} />
          ) : (
            <AdminTableShell>
              <table className="w-full text-sm">
                <thead>
                  <tr className={adminTableHeadRowClass}>
                    <th className={adminTableCellClass}>SKU</th>
                    <th className={adminTableCellClass}>{t('admin.invName')}</th>
                    <th className={adminTableCellClass}>{t('admin.invQty')}</th>
                    <th className={adminTableCellClass}>{t('admin.invUnit')}</th>
                    <th className={adminTableCellClass}>{t('admin.invMin')}</th>
                  </tr>
                </thead>
                <tbody>
                  {balances.map((b) => {
                    const low = b.min_qty != null && b.qty_on_hand < b.min_qty;
                    return (
                      <tr key={b.stock_item_id} className={adminTableRowClass}>
                        <td className={adminTableCellClass}>{b.sku_code}</td>
                        <td className={adminTableCellClass}>{b.name}</td>
                        <td className={`${adminTableCellClass} tabular-nums ${low ? 'text-danger' : ''}`}>
                          {b.qty_on_hand}
                        </td>
                        <td className={adminTableCellClass}>{b.unit_code}</td>
                        <td className={adminTableCellClass}>{b.min_qty ?? '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </AdminTableShell>
          )}
        </div>
      ) : null}

      {!loading && view === 'categories' ? (
        <div className="space-y-4">
          <form
            className={adminFormPanelClass}
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                const { error: err } = await inventoryRpc(supabase, 'inventory_upsert_category', {
                  p_code: catCode.trim(),
                  p_name_bg: catBg.trim(),
                  p_name_ru: catRu.trim(),
                  p_name_en: catEn.trim(),
                  p_parent_id: catParent || null,
                });
                if (err) throw err;
                setCatCode('');
                setCatBg('');
                setCatRu('');
                setCatEn('');
              }, t('admin.invCategorySaved'));
            }}
          >
            <h3 className="text-sm font-semibold">{t('admin.invUpsertCategory')}</h3>
            <div className="grid gap-2 md:grid-cols-2">
              <input className={adminFieldClass} placeholder="code" value={catCode} onChange={(e) => setCatCode(e.target.value)} required />
              <select className={adminFieldClass} value={catParent} onChange={(e) => setCatParent(e.target.value)}>
                <option value="">{t('admin.invNoParent')}</option>
                {categories.filter((c) => c.active).map((c) => (
                  <option key={c.id} value={c.id}>
                    {categoryDisplayName(c, locale)}
                  </option>
                ))}
              </select>
              <input className={adminFieldClass} placeholder="BG" value={catBg} onChange={(e) => setCatBg(e.target.value)} required />
              <input className={adminFieldClass} placeholder="RU" value={catRu} onChange={(e) => setCatRu(e.target.value)} required />
              <input className={adminFieldClass} placeholder="EN" value={catEn} onChange={(e) => setCatEn(e.target.value)} required />
            </div>
            <AdminPrimaryButton type="submit" disabled={busy}>
              {t('admin.invSave')}
            </AdminPrimaryButton>
          </form>
          <AdminTableShell>
            <table className="w-full text-sm">
              <thead>
                <tr className={adminTableHeadRowClass}>
                  <th className={adminTableCellClass}>code</th>
                  <th className={adminTableCellClass}>BG/RU/EN</th>
                  <th className={adminTableCellClass} />
                </tr>
              </thead>
              <tbody>
                {categories.map((c) => (
                  <tr key={c.id} className={adminTableRowClass}>
                    <td className={adminTableCellClass}>{c.code}</td>
                    <td className={adminTableCellClass}>
                      {c.name_bg} / {c.name_ru} / {c.name_en}
                      {!c.active ? ` (${t('admin.invArchivedLabel')})` : ''}
                    </td>
                    <td className={adminTableCellClass}>
                      {c.active ? (
                        <AdminSecondaryButton
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              const { error: err } = await inventoryRpc(supabase, 'inventory_archive_category', {
                                p_id: c.id,
                              });
                              if (err) throw err;
                            }, t('admin.invCategoryArchived'))
                          }
                        >
                          {t('admin.invArchive')}
                        </AdminSecondaryButton>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </AdminTableShell>
        </div>
      ) : null}

      {!loading && view === 'locations' ? (
        <div className="space-y-4">
          <form
            className={adminFormPanelClass}
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                const { error: err } = await inventoryRpc(supabase, 'inventory_upsert_location', {
                  p_code: locCode.trim(),
                  p_name: locName.trim(),
                  p_location_kind: locKind,
                });
                if (err) throw err;
                setLocCode('');
                setLocName('');
              }, t('admin.invLocationSaved'));
            }}
          >
            <h3 className="text-sm font-semibold">{t('admin.invUpsertLocation')}</h3>
            <div className="grid gap-2 md:grid-cols-3">
              <input className={adminFieldClass} placeholder="code" value={locCode} onChange={(e) => setLocCode(e.target.value)} required />
              <input className={adminFieldClass} placeholder={t('admin.invName')} value={locName} onChange={(e) => setLocName(e.target.value)} required />
              <select className={adminFieldClass} value={locKind} onChange={(e) => setLocKind(e.target.value)}>
                {['common_area', 'technical_room', 'office', 'storage', 'apartment', 'offsite', 'other'].map(
                  (k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ),
                )}
              </select>
            </div>
            <AdminPrimaryButton type="submit" disabled={busy}>
              {t('admin.invSave')}
            </AdminPrimaryButton>
          </form>
          <AdminTableShell>
            <table className="w-full text-sm">
              <thead>
                <tr className={adminTableHeadRowClass}>
                  <th className={adminTableCellClass}>code</th>
                  <th className={adminTableCellClass}>{t('admin.invName')}</th>
                  <th className={adminTableCellClass}>{t('admin.invKind')}</th>
                </tr>
              </thead>
              <tbody>
                {locations.map((l) => (
                  <tr key={l.id} className={adminTableRowClass}>
                    <td className={adminTableCellClass}>{l.code}</td>
                    <td className={adminTableCellClass}>{l.name}</td>
                    <td className={adminTableCellClass}>{l.location_kind}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </AdminTableShell>
        </div>
      ) : null}

      {!loading && (view === 'sessions' || view === 'session_detail') ? (
        <div className="space-y-4">
          {view === 'sessions' ? (
            <>
              <form
                className={adminFormPanelClass}
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(async () => {
                    const { error: err } = await inventoryRpc(supabase, 'inventory_create_session', {
                      p_title: sessTitle.trim(),
                    });
                    if (err) throw err;
                    setSessTitle('');
                  }, t('admin.invSessionCreated'));
                }}
              >
                <h3 className="text-sm font-semibold">{t('admin.invCreateSession')}</h3>
                <input
                  className={adminFieldClass}
                  value={sessTitle}
                  onChange={(e) => setSessTitle(e.target.value)}
                  placeholder={t('admin.invSessionTitle')}
                  required
                />
                <AdminPrimaryButton type="submit" disabled={busy}>
                  {t('admin.invCreateSession')}
                </AdminPrimaryButton>
              </form>
              {sessions.length === 0 ? (
                <AdminEmptyState title={t('admin.invEmptySessions')} />
              ) : (
                <AdminTableShell>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className={adminTableHeadRowClass}>
                        <th className={adminTableCellClass}>{t('admin.invSessionTitle')}</th>
                        <th className={adminTableCellClass}>{t('admin.invStatus')}</th>
                        <th className={adminTableCellClass} />
                      </tr>
                    </thead>
                    <tbody>
                      {sessions.map((s) => (
                        <tr key={s.id} className={adminTableRowClass}>
                          <td className={adminTableCellClass}>{s.title}</td>
                          <td className={adminTableCellClass}>
                            <StatusBadge
                              label={s.status}
                              tone={inventorySessionStatusTone(s.status)}
                            />
                          </td>
                          <td className={adminTableCellClass}>
                            <AdminSecondaryButton
                              type="button"
                              onClick={() => {
                                setSelectedSessionId(s.id);
                                setView('session_detail');
                              }}
                            >
                              {t('admin.invOpen')}
                            </AdminSecondaryButton>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </AdminTableShell>
              )}
            </>
          ) : null}

          {view === 'session_detail' && selectedSession ? (
            <div className="space-y-4">
              <AdminSecondaryButton type="button" onClick={() => setView('sessions')}>
                ← {t('admin.invBack')}
              </AdminSecondaryButton>
              <div className={adminCardClass + ' space-y-3 p-4'}>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-lg font-semibold">{selectedSession.title}</h3>
                  <StatusBadge
                    label={selectedSession.status}
                    tone={inventorySessionStatusTone(selectedSession.status)}
                  />
                  <span className="text-xs text-muted">v{selectedSession.row_version}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {selectedSession.status === 'DRAFT' || selectedSession.status === 'IN_PROGRESS' ? (
                    <AdminPrimaryButton
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          const { error: err } = await inventoryRpc(supabase, 'inventory_start_session', {
                            p_session_id: selectedSession.id,
                            p_row_version: selectedSession.row_version,
                          });
                          if (err) throw err;
                        }, t('admin.invSessionStarted'))
                      }
                    >
                      {t('admin.invStartSession')}
                    </AdminPrimaryButton>
                  ) : null}
                  {selectedSession.status === 'IN_PROGRESS' ? (
                    <AdminSecondaryButton
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          const { error: err } = await inventoryRpc(
                            supabase,
                            'inventory_submit_session_for_review',
                            {
                              p_session_id: selectedSession.id,
                              p_row_version: selectedSession.row_version,
                            },
                          );
                          if (err) throw err;
                        }, t('admin.invSubmittedReview'))
                      }
                    >
                      {t('admin.invSubmitReview')}
                    </AdminSecondaryButton>
                  ) : null}
                  {selectedSession.status === 'REVIEW' || selectedSession.status === 'IN_PROGRESS' ? (
                    <AdminPrimaryButton
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        if (!confirm(t('admin.invApproveConfirm'))) return;
                        void run(async () => {
                          const { error: err } = await inventoryRpc(
                            supabase,
                            'inventory_approve_and_post_session',
                            {
                              p_session_id: selectedSession.id,
                              p_row_version: selectedSession.row_version,
                              p_approval_note: 'admin UI',
                            },
                          );
                          if (err) throw err;
                        }, t('admin.invApprovedPosted'));
                      }}
                    >
                      {t('admin.invApprovePost')}
                    </AdminPrimaryButton>
                  ) : null}
                  {selectedSession.status === 'APPROVED' ? (
                    <AdminSecondaryButton
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          const { error: err } = await inventoryRpc(supabase, 'inventory_close_session', {
                            p_session_id: selectedSession.id,
                            p_row_version: selectedSession.row_version,
                          });
                          if (err) throw err;
                        }, t('admin.invSessionClosed'))
                      }
                    >
                      {t('admin.invCloseSession')}
                    </AdminSecondaryButton>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  <select
                    className={adminFieldClass + ' max-w-xs'}
                    value={assignStaffId}
                    onChange={(e) => setAssignStaffId(e.target.value)}
                  >
                    <option value="">{t('admin.invAddParticipant')}</option>
                    {staff.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                  <AdminSecondaryButton
                    type="button"
                    disabled={busy || !assignStaffId}
                    onClick={() =>
                      void run(async () => {
                        const { error: err } = await inventoryRpc(
                          supabase,
                          'inventory_add_session_participant',
                          {
                            p_session_id: selectedSession.id,
                            p_staff_id: Number(assignStaffId),
                            p_role_in_session: 'counter',
                          },
                        );
                        if (err) throw err;
                      }, t('admin.invParticipantAdded'))
                    }
                  >
                    {t('admin.invAddParticipant')}
                  </AdminSecondaryButton>
                </div>
              </div>

              <AdminTableShell>
                <table className="w-full text-sm">
                  <thead>
                    <tr className={adminTableHeadRowClass}>
                      <th className={adminTableCellClass}>{t('admin.invName')}</th>
                      <th className={adminTableCellClass}>{t('admin.invTracking')}</th>
                      <th className={adminTableCellClass}>{t('admin.invStatus')}</th>
                      <th className={adminTableCellClass}>{t('admin.invQty')}</th>
                      <th className={adminTableCellClass} />
                    </tr>
                  </thead>
                  <tbody>
                    {sessionItems.map((it) => (
                      <tr key={it.id} className={adminTableRowClass}>
                        <td className={adminTableCellClass}>{it.draft_name}</td>
                        <td className={adminTableCellClass}>{it.tracking_type}</td>
                        <td className={adminTableCellClass}>{it.finding_status}</td>
                        <td className={adminTableCellClass}>{it.counted_qty ?? '—'}</td>
                        <td className={adminTableCellClass}>
                          {['draft', 'submitted'].includes(it.finding_status) &&
                          ['REVIEW', 'IN_PROGRESS'].includes(selectedSession.status) ? (
                            <div className="flex gap-1">
                              <AdminSecondaryButton
                                type="button"
                                disabled={busy}
                                onClick={() =>
                                  void run(async () => {
                                    const { error: err } = await inventoryRpc(
                                      supabase,
                                      'inventory_review_session_item',
                                      { p_item_id: it.id, p_decision: 'accepted' },
                                    );
                                    if (err) throw err;
                                    await loadSessionDetail(selectedSession.id);
                                  }, t('admin.invItemAccepted'))
                                }
                              >
                                ✓
                              </AdminSecondaryButton>
                              <AdminSecondaryButton
                                type="button"
                                disabled={busy}
                                onClick={() =>
                                  void run(async () => {
                                    const { error: err } = await inventoryRpc(
                                      supabase,
                                      'inventory_review_session_item',
                                      { p_item_id: it.id, p_decision: 'rejected' },
                                    );
                                    if (err) throw err;
                                    await loadSessionDetail(selectedSession.id);
                                  }, t('admin.invItemRejected'))
                                }
                              >
                                ✕
                              </AdminSecondaryButton>
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </AdminTableShell>
              {sessionItems.length === 0 ? (
                <p className="text-sm text-muted">{t('admin.invNoFindings')}</p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
