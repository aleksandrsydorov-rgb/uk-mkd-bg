'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { useI18n } from '@/i18n/I18nProvider';
import { ownerVisibleError } from '@/lib/ownerError';
import { errorTextForMapper } from '@/lib/userFacingError';
import {
  canSeeInventoryAdmin,
  categoryDisplayName,
  computeInventoryOverview,
  filterAssets,
  inventoryAssetStatusTone,
  inventoryRpc,
  inventorySelect,
  inventorySessionStatusTone,
  presentInventoryAssetStatus,
  presentInventoryCondition,
  presentInventoryEventKind,
  presentInventoryFindingStatus,
  presentInventoryLocationKind,
  presentInventoryMaintenanceKind,
  presentInventoryMoveAction,
  presentInventoryMovement,
  presentInventoryOwnership,
  presentInventorySessionStatus,
  presentInventoryTracking,
  presentInventoryUnit,
  slugifyInventoryCatalogCode,
  INV1_ASSET_STATUSES,
  INVENTORY_LOCATION_KINDS,
  INVENTORY_MAINT_KINDS,
  INVENTORY_MOVEMENT_TYPES,
  INVENTORY_OWNERSHIP,
  INVENTORY_UNIT_CODES,
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
  INV3_MAX_BYTES,
  uploadAndRegisterInventoryDocument,
} from '@/lib/inventory/documentsClient';
import { SignedStorageLink, SignedStorageImage } from '@/components/SignedStorageMedia';
import { AppFilePicker, formatAcceptHint, formatFileSizeMb } from '@/components/ui/AppFilePicker';
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
import { useAppConfirm } from '@/components/ui/AppConfirmDialog';

type StaffOpt = { id: number; name: string; email: string | null };

const labelClass = 'block space-y-1 text-sm';
const labelTextClass = 'text-xs font-medium text-secondary';

/** Auto-generate a unique catalog code (never reuses an existing one: upsert is keyed by code). */
function uniqueCatalogCode(name: string, fallback: string, existing: string[]): string {
  const taken = new Set(existing.map((c) => c.trim().toLowerCase()));
  const base = slugifyInventoryCatalogCode(name, fallback).toLowerCase();
  if (!taken.has(base)) return base;
  for (let i = 0; i < 50; i += 1) {
    const suffix = Math.random().toString(36).slice(2, 6);
    const candidate = `${base.slice(0, 35)}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base.slice(0, 25)}-${Date.now().toString(36)}`;
}

export function AdminInventory({
  supabase,
  staffRole,
}: {
  supabase: SupabaseClient<Database>;
  staffRole: string;
}) {
  const { t, locale } = useI18n();
  const { confirm, dialog } = useAppConfirm(t('common.close'));
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

  const [showAssetForm, setShowAssetForm] = useState(false);
  const [showStockForm, setShowStockForm] = useState(false);
  const [showCategoryForm, setShowCategoryForm] = useState(false);
  const [showLocationForm, setShowLocationForm] = useState(false);
  const [showSessionForm, setShowSessionForm] = useState(false);

  const [catBg, setCatBg] = useState('');
  const [catRu, setCatRu] = useState('');
  const [catEn, setCatEn] = useState('');
  const [catParent, setCatParent] = useState('');

  const [locName, setLocName] = useState('');
  const [locKind, setLocKind] = useState('storage');

  const [sessTitle, setSessTitle] = useState('');
  const [assignStaffId, setAssignStaffId] = useState('');
  const [editName, setEditName] = useState('');
  const [transferLocationId, setTransferLocationId] = useState('');
  const [maintSummary, setMaintSummary] = useState('');
  const [maintKind, setMaintKind] = useState('service');

  const catPrimaryLang: 'bg' | 'ru' | 'en' = locale === 'bg' ? 'bg' : locale === 'en' ? 'en' : 'ru';
  const catPrimaryValue = catPrimaryLang === 'bg' ? catBg : catPrimaryLang === 'en' ? catEn : catRu;
  const setCatPrimaryValue = (v: string) => {
    if (catPrimaryLang === 'bg') setCatBg(v);
    else if (catPrimaryLang === 'en') setCatEn(v);
    else setCatRu(v);
  };
  const selectedMoveBalance = balances.find((b) => b.stock_item_id === stockMoveId) ?? null;

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

  const selectedAssetLocation = useMemo(
    () =>
      selectedAsset?.location_id
        ? (locations.find((l) => l.id === String(selectedAsset.location_id)) ?? null)
        : null,
    [locations, selectedAsset],
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
            : ownerVisibleError(firstErr, t('admin.errGeneric'), t),
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
      setError(ownerVisibleError(e, t('admin.errGeneric'), t));
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
      setError(ownerVisibleError(e, t('admin.errGeneric'), t));
    } finally {
      setBusy(false);
    }
  }

  async function archiveCategory(c: InventoryCategoryRow) {
    const ok = await confirm({
      title: t('common.confirmAction'),
      description: t('admin.invArchiveCategoryConfirm'),
      confirmLabel: t('admin.invArchive'),
      cancelLabel: t('common.cancel'),
      tone: 'danger',
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const { error: err } = await inventoryRpc(supabase, 'inventory_archive_category', {
        p_id: c.id,
      });
      if (err) throw err;
      setSuccess(t('admin.invCategoryArchived'));
      await load();
    } catch (e: unknown) {
      const probe = `${errorTextForMapper(e)} ${(e as { code?: string } | null)?.code ?? ''}`;
      if (/active references|23503|referenc/i.test(probe)) {
        setError(t('admin.invCategoryInUse'));
      } else {
        setError(ownerVisibleError(e, t('admin.errGeneric'), t));
      }
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
      {dialog}
      <AdminPageHeader
        title={t('admin.inventory')}
        secondary={t('admin.invLead')}
        action={
          <AdminSecondaryButton type="button" disabled={busy || loading} onClick={() => void load()}>
            {t('admin.invRefresh')}
          </AdminSecondaryButton>
        }
      />
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
            <AdminMetricCard
              label={t('admin.invMetricStock')}
              value={String(overview.stockSkuCount)}
              secondary={t('admin.invStockNamesHint')}
            />
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
              <p className="text-xs text-muted">{t('admin.invByOwnershipHint')}</p>
              <ul className="mt-2 space-y-1 text-sm">
                {Object.entries(overview.byOwnership).map(([k, n]) => (
                  <li key={k} className="flex justify-between gap-2">
                    <span className="text-secondary">{presentInventoryOwnership(k, t)}</span>
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
              <p className="text-xs text-muted">{t('admin.invByConditionHint')}</p>
              <ul className="mt-2 space-y-1 text-sm">
                {Object.entries(overview.byCondition).map(([k, n]) => (
                  <li key={k} className="flex justify-between gap-2">
                    <span className="text-secondary">{presentInventoryCondition(k, t)}</span>
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
              <p className="text-xs text-muted">{t('admin.invByCategoryHint')}</p>
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
              <div className="flex flex-wrap items-end gap-2">
                <label className={labelClass + ' min-w-[12rem] flex-1'}>
                  <span className={labelTextClass}>{t('admin.invSearch')}</span>
                  <input
                    className={adminFieldClass}
                    value={assetSearch}
                    onChange={(e) => setAssetSearch(e.target.value)}
                  />
                </label>
                <label className={labelClass + ' w-full sm:w-52'}>
                  <span className={labelTextClass}>{t('admin.invOwnership')}</span>
                  <select
                    className={adminFieldClass}
                    value={assetFilterOwnership}
                    onChange={(e) => setAssetFilterOwnership(e.target.value)}
                  >
                    <option value="">{t('admin.invAllOwnership')}</option>
                    {INVENTORY_OWNERSHIP.map((o) => (
                      <option key={o} value={o}>
                        {presentInventoryOwnership(o, t)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={labelClass + ' w-full sm:w-52'}>
                  <span className={labelTextClass}>{t('admin.invStatus')}</span>
                  <select
                    className={adminFieldClass}
                    value={assetFilterStatus}
                    onChange={(e) => setAssetFilterStatus(e.target.value)}
                  >
                    <option value="">{t('admin.invAllStatus')}</option>
                    {INV1_ASSET_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {presentInventoryAssetStatus(s, t)}
                      </option>
                    ))}
                  </select>
                </label>
                <AdminPrimaryButton
                  type="button"
                  aria-expanded={showAssetForm}
                  onClick={() => setShowAssetForm((v) => !v)}
                >
                  {showAssetForm ? t('admin.invHideForm') : t('admin.invAddAsset')}
                </AdminPrimaryButton>
              </div>

              {showAssetForm ? (
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
                      setShowAssetForm(false);
                    }, t('admin.invAssetCreated'));
                  }}
                >
                  <h3 className="text-sm font-semibold">{t('admin.invCreateAsset')}</h3>
                  <div className="grid gap-2 md:grid-cols-4">
                    <label className={labelClass}>
                      <span className={labelTextClass}>{t('admin.invNumber')}</span>
                      <input
                        className={adminFieldClass}
                        value={draftNumber}
                        onChange={(e) => setDraftNumber(e.target.value)}
                        required
                      />
                    </label>
                    <label className={labelClass}>
                      <span className={labelTextClass}>{t('admin.invName')}</span>
                      <input
                        className={adminFieldClass}
                        value={draftName}
                        onChange={(e) => setDraftName(e.target.value)}
                        required
                      />
                    </label>
                    <label className={labelClass}>
                      <span className={labelTextClass}>{t('admin.invOwnership')}</span>
                      <select
                        className={adminFieldClass}
                        value={draftOwnership}
                        onChange={(e) => setDraftOwnership(e.target.value)}
                      >
                        {INVENTORY_OWNERSHIP.map((o) => (
                          <option key={o} value={o}>
                            {presentInventoryOwnership(o, t)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className={labelClass}>
                      <span className={labelTextClass}>{t('admin.invCategory')}</span>
                      <select
                        className={adminFieldClass}
                        value={draftCategoryId}
                        onChange={(e) => setDraftCategoryId(e.target.value)}
                      >
                        <option value="">—</option>
                        {categories
                          .filter((c) => c.active)
                          .map((c) => (
                            <option key={c.id} value={c.id}>
                              {categoryDisplayName(c, locale)}
                            </option>
                          ))}
                      </select>
                    </label>
                  </div>
                  <AdminPrimaryButton type="submit" disabled={busy}>
                    {t('admin.invCreateDraft')}
                  </AdminPrimaryButton>
                </form>
              ) : null}

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
                      </tr>
                    </thead>
                    <tbody>
                      {filteredAssets.map((a) => (
                        <tr
                          key={a.id}
                          className={adminTableRowClass + ' cursor-pointer hover:bg-hover/50'}
                          tabIndex={0}
                          onClick={() => {
                            setSelectedAssetId(a.id);
                            setView('asset_detail');
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              setSelectedAssetId(a.id);
                              setView('asset_detail');
                            }
                          }}
                        >
                          <td className={adminTableCellClass}>{a.inventory_number}</td>
                          <td className={adminTableCellClass}>{a.name}</td>
                          <td className={adminTableCellClass}>
                            {presentInventoryOwnership(a.ownership_kind, t)}
                          </td>
                          <td className={adminTableCellClass}>
                            <StatusBadge
                              label={presentInventoryAssetStatus(a.operational_status, t)}
                              tone={inventoryAssetStatusTone(a.operational_status)}
                            />
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
                    label={presentInventoryAssetStatus(selectedAsset.operational_status, t)}
                    tone={inventoryAssetStatusTone(selectedAsset.operational_status)}
                  />
                </div>
                <p className="text-sm text-secondary">
                  {selectedAsset.inventory_number} ·{' '}
                  {presentInventoryOwnership(selectedAsset.ownership_kind, t)} ·{' '}
                  {presentInventoryCondition(selectedAsset.condition, t)}
                  {selectedAssetLocation
                    ? ` · ${selectedAssetLocation.name} (${presentInventoryLocationKind(selectedAssetLocation.location_kind, t)})`
                    : ''}
                </p>
                {selectedAsset.estimated_value_eur != null ? (
                  <div>
                    <p className="text-sm tabular-nums">{selectedAsset.estimated_value_eur} EUR</p>
                    <p className="text-xs text-muted">{t('admin.invEstValueInfo')}</p>
                  </div>
                ) : null}
                <div className="flex flex-wrap items-end gap-2 pt-2">
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
                      <label className={labelClass + ' max-w-xs'}>
                        <span className={labelTextClass}>{t('admin.invAssignStaff')}</span>
                        <select
                          className={adminFieldClass}
                          value={assignStaffId}
                          onChange={(e) => setAssignStaffId(e.target.value)}
                        >
                          <option value="">—</option>
                          {staff.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                      </label>
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
                            const assignee = staff.find((s) => String(s.id) === String(assignStaffId));
                            const email = String(assignee?.email ?? '').trim();
                            if (email) {
                              void import('@/lib/email/eventProducers')
                                .then(({ notifyStaffAssignee }) =>
                                  notifyStaffAssignee(supabase, {
                                    eventKey: 'inventory_assignment_changed',
                                    staffEmail: email,
                                    entityId: `inv_assign:${selectedAsset.id}:${assignStaffId}`,
                                    payload: { asset_id: selectedAsset.id, staff_id: Number(assignStaffId) },
                                  })
                                )
                                .catch(() => undefined);
                            }
                          }, t('admin.invAssigned'))
                        }
                      >
                        {t('admin.invAssign')}
                      </AdminSecondaryButton>
                      <AdminSecondaryButton
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          void (async () => {
                            const ok = await confirm({
                              title: t('common.confirmAction'),
                              description: t('admin.invWriteOffConfirm'),
                              confirmLabel: t('admin.invWriteOff'),
                              cancelLabel: t('common.cancel'),
                              tone: 'danger',
                            });
                            if (!ok) return;
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
                          })();
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
                  <label className={labelClass}>
                    <span className={labelTextClass}>{t('admin.invName')}</span>
                    <input
                      className={adminFieldClass}
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      required
                    />
                  </label>
                  <AdminPrimaryButton type="submit" disabled={busy}>
                    {t('admin.invSave')}
                  </AdminPrimaryButton>
                </form>
              ) : null}

              {['active', 'assigned', 'maintenance'].includes(selectedAsset.operational_status) ? (
                <div className={adminFormPanelClass + ' space-y-2'}>
                  <h4 className="text-sm font-semibold">{t('admin.invTransfer')}</h4>
                  <div className="flex flex-wrap items-end gap-2">
                    <label className={labelClass + ' w-full max-w-xs'}>
                      <span className={labelTextClass}>{t('admin.invPickLocation')}</span>
                      <select
                        className={adminFieldClass}
                        value={transferLocationId}
                        onChange={(e) => setTransferLocationId(e.target.value)}
                      >
                        <option value="">—</option>
                        {locations.map((loc) => (
                          <option key={loc.id} value={loc.id}>
                            {loc.name} ({presentInventoryLocationKind(loc.location_kind, t)})
                          </option>
                        ))}
                      </select>
                    </label>
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
                  <div className="flex flex-wrap items-end gap-2">
                    <label className={labelClass + ' w-full max-w-[12rem]'}>
                      <span className={labelTextClass}>{t('admin.invMaintenance')}</span>
                      <select
                        className={adminFieldClass}
                        value={maintKind}
                        onChange={(e) => setMaintKind(e.target.value)}
                      >
                        {INVENTORY_MAINT_KINDS.map((k) => (
                          <option key={k} value={k}>
                            {presentInventoryMaintenanceKind(k, t)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className={labelClass + ' min-w-[12rem] flex-1'}>
                      <span className={labelTextClass}>{t('admin.invMaintSummary')}</span>
                      <input
                        className={adminFieldClass}
                        value={maintSummary}
                        onChange={(e) => setMaintSummary(e.target.value)}
                      />
                    </label>
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
                <AppFilePicker
                  accept="image/*,.pdf,.doc,.docx"
                  disabled={busy}
                  resetInputAfterChange
                  hint={t('common.fileHintFormatsSize', {
                    formats: formatAcceptHint('image/*,.pdf,.doc,.docx'),
                    size: formatFileSizeMb(INV3_MAX_BYTES),
                  })}
                  onChange={(picked) => {
                    const file = picked[0];
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
                      <span className="text-muted">{ev.event_at}</span> ·{' '}
                      {presentInventoryEventKind(ev.event_kind, t)}
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
          <div className="flex justify-end">
            <AdminPrimaryButton
              type="button"
              aria-expanded={showStockForm}
              onClick={() => setShowStockForm((v) => !v)}
            >
              {showStockForm ? t('admin.invHideForm') : t('admin.invAddMaterial')}
            </AdminPrimaryButton>
          </div>

          {showStockForm ? (
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
                  setShowStockForm(false);
                }, t('admin.invStockCreated'));
              }}
            >
              <h3 className="text-sm font-semibold">{t('admin.invRegisterSku')}</h3>
              <div className="grid gap-2 md:grid-cols-3">
                <label className={labelClass}>
                  <span className={labelTextClass}>{t('admin.invSku')}</span>
                  <input
                    className={adminFieldClass}
                    value={stockSku}
                    onChange={(e) => setStockSku(e.target.value)}
                    required
                  />
                </label>
                <label className={labelClass}>
                  <span className={labelTextClass}>{t('admin.invName')}</span>
                  <input
                    className={adminFieldClass}
                    value={stockName}
                    onChange={(e) => setStockName(e.target.value)}
                    required
                  />
                </label>
                <label className={labelClass}>
                  <span className={labelTextClass}>{t('admin.invUnit')}</span>
                  <select
                    className={adminFieldClass}
                    value={stockUnit}
                    onChange={(e) => setStockUnit(e.target.value)}
                  >
                    {INVENTORY_UNIT_CODES.map((u) => (
                      <option key={u} value={u}>
                        {presentInventoryUnit(u, t)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <AdminPrimaryButton type="submit" disabled={busy}>
                {t('admin.invCreateSku')}
              </AdminPrimaryButton>
            </form>
          ) : null}

          {balances.length === 0 ? (
            <AdminEmptyState title={t('admin.invEmptyStock')} />
          ) : (
            <AdminTableShell>
              <table className="w-full text-sm">
                <thead>
                  <tr className={adminTableHeadRowClass}>
                    <th className={adminTableCellClass}>{t('admin.invSku')}</th>
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
                        <td className={adminTableCellClass}>{presentInventoryUnit(b.unit_code, t)}</td>
                        <td className={adminTableCellClass}>
                          {b.min_qty != null ? (
                            <span className="tabular-nums">{b.min_qty}</span>
                          ) : (
                            <span className="text-muted">— {t('admin.invMinNotSet')}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </AdminTableShell>
          )}

          {balances.length > 0 ? (
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
              <div className="grid gap-2 md:grid-cols-4">
                <label className={labelClass}>
                  <span className={labelTextClass}>{t('admin.invPickSku')}</span>
                  <select
                    className={adminFieldClass}
                    value={stockMoveId}
                    onChange={(e) => setStockMoveId(e.target.value)}
                    required
                  >
                    <option value="">—</option>
                    {balances.map((b) => (
                      <option key={b.stock_item_id} value={b.stock_item_id}>
                        {b.name} ({b.sku_code})
                      </option>
                    ))}
                  </select>
                </label>
                <label className={labelClass}>
                  <span className={labelTextClass}>{t('admin.invMoveType')}</span>
                  <select
                    className={adminFieldClass}
                    value={stockMoveType}
                    onChange={(e) => setStockMoveType(e.target.value)}
                  >
                    {INVENTORY_MOVEMENT_TYPES.map((m) => (
                      <option key={m} value={m}>
                        {presentInventoryMovement(m, t)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={labelClass}>
                  <span className={labelTextClass}>{t('admin.invQty')}</span>
                  <input
                    className={adminFieldClass}
                    type="number"
                    step="any"
                    value={stockMoveQty}
                    onChange={(e) => setStockMoveQty(e.target.value)}
                    required
                  />
                </label>
                <div className={labelClass}>
                  <span className={labelTextClass}>{t('admin.invUnit')}</span>
                  <p className={adminFieldClass + ' bg-transparent text-secondary'}>
                    {selectedMoveBalance ? presentInventoryUnit(selectedMoveBalance.unit_code, t) : '—'}
                  </p>
                </div>
              </div>
              <AdminPrimaryButton type="submit" disabled={busy || !stockMoveId}>
                {presentInventoryMoveAction(stockMoveType, t)}
              </AdminPrimaryButton>
            </form>
          ) : null}
        </div>
      ) : null}

      {!loading && view === 'categories' ? (
        <div className="space-y-4">
          <div className="flex justify-end">
            <AdminPrimaryButton
              type="button"
              aria-expanded={showCategoryForm}
              onClick={() => setShowCategoryForm((v) => !v)}
            >
              {showCategoryForm ? t('admin.invHideForm') : t('admin.invAddCategory')}
            </AdminPrimaryButton>
          </div>

          {showCategoryForm ? (
            <form
              className={adminFormPanelClass}
              onSubmit={(e) => {
                e.preventDefault();
                const primary = catPrimaryValue.trim();
                if (!primary) return;
                void run(async () => {
                  const { error: err } = await inventoryRpc(supabase, 'inventory_upsert_category', {
                    p_code: uniqueCatalogCode(
                      primary,
                      'cat',
                      categories.map((c) => c.code),
                    ),
                    p_name_bg: catBg.trim() || primary,
                    p_name_ru: catRu.trim() || primary,
                    p_name_en: catEn.trim() || primary,
                    p_parent_id: catParent || null,
                  });
                  if (err) throw err;
                  setCatBg('');
                  setCatRu('');
                  setCatEn('');
                  setCatParent('');
                  setShowCategoryForm(false);
                }, t('admin.invCategorySaved'));
              }}
            >
              <h3 className="text-sm font-semibold">{t('admin.invUpsertCategory')}</h3>
              <div className="grid gap-2 md:grid-cols-2">
                <label className={labelClass}>
                  <span className={labelTextClass}>{t('admin.invPrimaryName')}</span>
                  <input
                    className={adminFieldClass}
                    value={catPrimaryValue}
                    onChange={(e) => setCatPrimaryValue(e.target.value)}
                    required
                  />
                </label>
                <label className={labelClass}>
                  <span className={labelTextClass}>{t('admin.invParentCategory')}</span>
                  <select
                    className={adminFieldClass}
                    value={catParent}
                    onChange={(e) => setCatParent(e.target.value)}
                  >
                    <option value="">{t('admin.invNoParent')}</option>
                    {categories
                      .filter((c) => c.active)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {categoryDisplayName(c, locale)}
                        </option>
                      ))}
                  </select>
                </label>
              </div>
              <details className="rounded-lg border border-border px-3 py-2 text-sm">
                <summary className="cursor-pointer text-secondary">{t('admin.invOtherLangNames')}</summary>
                <div className="mt-2 grid gap-2 md:grid-cols-3">
                  {catPrimaryLang !== 'bg' ? (
                    <label className={labelClass}>
                      <span className={labelTextClass}>{t('admin.invLangBg')}</span>
                      <input
                        className={adminFieldClass}
                        value={catBg}
                        onChange={(e) => setCatBg(e.target.value)}
                      />
                    </label>
                  ) : null}
                  {catPrimaryLang !== 'ru' ? (
                    <label className={labelClass}>
                      <span className={labelTextClass}>{t('admin.invLangRu')}</span>
                      <input
                        className={adminFieldClass}
                        value={catRu}
                        onChange={(e) => setCatRu(e.target.value)}
                      />
                    </label>
                  ) : null}
                  {catPrimaryLang !== 'en' ? (
                    <label className={labelClass}>
                      <span className={labelTextClass}>{t('admin.invLangEn')}</span>
                      <input
                        className={adminFieldClass}
                        value={catEn}
                        onChange={(e) => setCatEn(e.target.value)}
                      />
                    </label>
                  ) : null}
                </div>
              </details>
              <p className="text-xs text-muted">{t('admin.invCodeAutoHint')}</p>
              <AdminPrimaryButton type="submit" disabled={busy}>
                {t('admin.invSave')}
              </AdminPrimaryButton>
            </form>
          ) : null}

          <AdminTableShell>
            <table className="w-full text-sm">
              <thead>
                <tr className={adminTableHeadRowClass}>
                  <th className={adminTableCellClass}>{t('admin.invName')}</th>
                  <th className={adminTableCellClass}>{t('admin.invParentCategory')}</th>
                  <th className={adminTableCellClass}>{t('admin.invStatus')}</th>
                  <th className={adminTableCellClass} />
                </tr>
              </thead>
              <tbody>
                {categories.map((c) => (
                  <tr key={c.id} className={adminTableRowClass}>
                    <td className={adminTableCellClass}>
                      {categoryDisplayName(c, locale)}
                      <span className="block text-xs text-muted">{c.code}</span>
                    </td>
                    <td className={adminTableCellClass}>
                      {c.parent_id ? (categoryNameById[String(c.parent_id)] ?? '—') : '—'}
                    </td>
                    <td className={adminTableCellClass}>
                      {c.active ? t('admin.invCategoryActive') : t('admin.invCategoryInactive')}
                    </td>
                    <td className={adminTableCellClass}>
                      {c.active ? (
                        <AdminSecondaryButton
                          type="button"
                          disabled={busy}
                          onClick={() => void archiveCategory(c)}
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
          <div className="flex justify-end">
            <AdminPrimaryButton
              type="button"
              aria-expanded={showLocationForm}
              onClick={() => setShowLocationForm((v) => !v)}
            >
              {showLocationForm ? t('admin.invHideForm') : t('admin.invAddLocation')}
            </AdminPrimaryButton>
          </div>

          {showLocationForm ? (
            <form
              className={adminFormPanelClass}
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  const { error: err } = await inventoryRpc(supabase, 'inventory_upsert_location', {
                    p_code: uniqueCatalogCode(
                      locName,
                      'loc',
                      locations.map((l) => l.code),
                    ),
                    p_name: locName.trim(),
                    p_location_kind: locKind,
                  });
                  if (err) throw err;
                  setLocName('');
                  setShowLocationForm(false);
                }, t('admin.invLocationSaved'));
              }}
            >
              <h3 className="text-sm font-semibold">{t('admin.invUpsertLocation')}</h3>
              <div className="grid gap-2 md:grid-cols-2">
                <label className={labelClass}>
                  <span className={labelTextClass}>{t('admin.invName')}</span>
                  <input
                    className={adminFieldClass}
                    value={locName}
                    onChange={(e) => setLocName(e.target.value)}
                    required
                  />
                </label>
                <label className={labelClass}>
                  <span className={labelTextClass}>{t('admin.invKind')}</span>
                  <select
                    className={adminFieldClass}
                    value={locKind}
                    onChange={(e) => setLocKind(e.target.value)}
                  >
                    {INVENTORY_LOCATION_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {presentInventoryLocationKind(k, t)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <p className="text-xs text-muted">{t('admin.invCodeAutoHint')}</p>
              <AdminPrimaryButton type="submit" disabled={busy}>
                {t('admin.invSave')}
              </AdminPrimaryButton>
            </form>
          ) : null}

          <AdminTableShell>
            <table className="w-full text-sm">
              <thead>
                <tr className={adminTableHeadRowClass}>
                  <th className={adminTableCellClass}>{t('admin.invName')}</th>
                  <th className={adminTableCellClass}>{t('admin.invKind')}</th>
                </tr>
              </thead>
              <tbody>
                {locations.map((l) => (
                  <tr key={l.id} className={adminTableRowClass}>
                    <td className={adminTableCellClass}>
                      {l.name}
                      <span className="block text-xs text-muted">{l.code}</span>
                    </td>
                    <td className={adminTableCellClass}>
                      {presentInventoryLocationKind(l.location_kind, t)}
                    </td>
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
              <div className="flex flex-wrap items-center justify-end gap-2">
                <AdminPrimaryButton
                  type="button"
                  aria-expanded={showSessionForm}
                  onClick={() => setShowSessionForm((v) => !v)}
                >
                  {showSessionForm ? t('admin.invHideForm') : t('admin.invCreateSession')}
                </AdminPrimaryButton>
              </div>
              {showSessionForm ? (
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
                      setShowSessionForm(false);
                    }, t('admin.invSessionCreated'));
                  }}
                >
                  <h3 className="text-sm font-semibold">{t('admin.invCreateSession')}</h3>
                  <label className={labelClass}>
                    <span className={labelTextClass}>{t('admin.invSessionTitle')}</span>
                    <input
                      className={adminFieldClass}
                      value={sessTitle}
                      onChange={(e) => setSessTitle(e.target.value)}
                      required
                    />
                  </label>
                  <AdminPrimaryButton type="submit" disabled={busy}>
                    {t('admin.invCreateSession')}
                  </AdminPrimaryButton>
                </form>
              ) : null}
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
                              label={presentInventorySessionStatus(s.status, t)}
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
                    label={presentInventorySessionStatus(selectedSession.status, t)}
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
                        void (async () => {
                          const ok = await confirm({
                            title: t('common.confirmAction'),
                            description: t('admin.invApproveConfirm'),
                            confirmLabel: t('admin.invApprovePost'),
                            cancelLabel: t('common.cancel'),
                            tone: 'danger',
                          });
                          if (!ok) return;
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
                        })();
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
                <div className="flex flex-wrap items-end gap-2">
                  <label className={labelClass + ' w-full max-w-xs'}>
                    <span className={labelTextClass}>{t('admin.invAddParticipant')}</span>
                    <select
                      className={adminFieldClass}
                      value={assignStaffId}
                      onChange={(e) => setAssignStaffId(e.target.value)}
                    >
                      <option value="">—</option>
                      {staff.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </label>
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
                        <td className={adminTableCellClass}>
                          {presentInventoryTracking(it.tracking_type, t)}
                        </td>
                        <td className={adminTableCellClass}>
                          {presentInventoryFindingStatus(it.finding_status, t)}
                        </td>
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
