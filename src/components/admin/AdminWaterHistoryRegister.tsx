'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { useI18n } from '@/i18n/I18nProvider';
import { formatOwnerDate } from '@/lib/ownerFormat';
import { isMissingRelation } from '@/lib/polls';
import { toUserFacingMessage } from '@/lib/userFacingError';
import { formatPropertyIdentity } from '@/lib/propertyIdentity';
import {
  EMPTY_WATER_HISTORY_FILTERS,
  buildWaterHistoryRegisterRows,
  clampWaterPeriodRange,
  filterWaterHistoryRegisterRows,
  formatSectionBlock,
  listBlocksFromProperties,
  listSectionsFromProperties,
  waterHistoryFiltersActive,
  type WaterHistoryRegisterFilters,
  type WaterHistoryRegisterRow,
} from '@/lib/waterHistoryRegister';
import {
  AdminEmptyState,
  AdminInlineAlert,
  AdminSecondaryButton,
  AdminTableShell,
  adminFieldClass,
  adminTableCellClass,
  adminTableHeadRowClass,
  adminTableRowClass,
} from '@/components/admin/AdminUi';

type PropertyOption = {
  id: number;
  apartment_number: string | number | null;
  section_code?: string | null;
  block_code?: string | null;
  owner_name?: string | null;
};

export function AdminWaterHistoryRegister({
  supabase,
  properties,
  canOperate,
  refreshSignal = 0,
  focusPropertyId,
  onOpenHistory,
  listScrollRef,
}: {
  supabase: SupabaseClient<Database>;
  properties: PropertyOption[];
  canOperate: boolean;
  refreshSignal?: number;
  focusPropertyId?: number | '';
  onOpenHistory: (row: WaterHistoryRegisterRow, rowEl: HTMLElement | null) => void;
  listScrollRef?: React.MutableRefObject<HTMLDivElement | null>;
}) {
  const { t } = useI18n();
  const [filters, setFilters] = useState<WaterHistoryRegisterFilters>(() => {
    if (typeof window === 'undefined') return EMPTY_WATER_HISTORY_FILTERS;
    return readHistoryFiltersFromSearch(window.location.search);
  });
  const userEditRef = useRef(false);
  const [rows, setRows] = useState<WaterHistoryRegisterRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!canOperate) {
      setRows([]);
      return;
    }
    setLoading(true);
    setError(null);
    const [metersRes, readingsRes] = await Promise.all([
      supabase.from('water_meters').select('property_id, meter_number').limit(8000),
      supabase
        .from('water_readings')
        .select('property_id, reading_date')
        .order('reading_date', { ascending: false })
        .limit(8000),
    ]);
    setLoading(false);
    if (metersRes.error && !isMissingRelation(metersRes.error, 'water_meters')) {
      setError(toUserFacingMessage(metersRes.error, t, { context: 'load', fallback: t('common.errLoad') }));
      setRows([]);
      return;
    }
    if (readingsRes.error && !isMissingRelation(readingsRes.error, 'water_readings')) {
      setError(
        toUserFacingMessage(readingsRes.error, t, { context: 'load', fallback: t('common.errLoad') }),
      );
    }
    setRows(
      buildWaterHistoryRegisterRows(
        (metersRes.data ?? []) as Parameters<typeof buildWaterHistoryRegisterRows>[0],
        (readingsRes.data ?? []) as Parameters<typeof buildWaterHistoryRegisterRows>[1],
        properties,
        filters.periodFrom,
        filters.periodTo,
      ),
    );
  }, [canOperate, filters.periodFrom, filters.periodTo, properties, supabase, t]);

  useEffect(() => {
    void load();
  }, [load, refreshSignal]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const sync = () => {
      if (userEditRef.current) return;
      const next = readHistoryFiltersFromSearch(window.location.search);
      setFilters((prev) => (historyFiltersEqual(prev, next) ? prev : next));
    };
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);

  useEffect(() => {
    if (!userEditRef.current || typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const q = filters.query.trim();
    if (q) params.set('whQ', q);
    else params.delete('whQ');
    if (filters.section) params.set('whSection', filters.section);
    else params.delete('whSection');
    if (filters.block) params.set('whBlock', filters.block);
    else params.delete('whBlock');
    if (filters.periodFrom) params.set('whFrom', filters.periodFrom);
    else params.delete('whFrom');
    if (filters.periodTo) params.set('whTo', filters.periodTo);
    else params.delete('whTo');
    const qs = params.toString();
    const current = window.location.search.replace(/^\?/, '');
    if (qs === current) {
      userEditRef.current = false;
      return;
    }
    const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
    window.history.replaceState(window.history.state, '', url);
    userEditRef.current = false;
  }, [filters.query, filters.section, filters.block, filters.periodFrom, filters.periodTo]);

  const sections = useMemo(() => listSectionsFromProperties(properties), [properties]);
  const blocks = useMemo(
    () => listBlocksFromProperties(properties, filters.section),
    [properties, filters.section],
  );
  const visible = useMemo(() => filterWaterHistoryRegisterRows(rows, filters), [rows, filters]);
  const filtersActive = waterHistoryFiltersActive(filters);
  const countLabel = t('admin.waterRegCountApts', { a: String(visible.length) });

  function patchFilters(patch: Partial<WaterHistoryRegisterFilters>) {
    userEditRef.current = true;
    setFilters((f) => {
      let next = { ...f, ...patch };
      if (patch.section !== undefined && patch.section !== f.section) next = { ...next, block: '' };
      if (patch.periodFrom !== undefined || patch.periodTo !== undefined) {
        const clamped = clampWaterPeriodRange(
          patch.periodFrom !== undefined ? patch.periodFrom : next.periodFrom,
          patch.periodTo !== undefined ? patch.periodTo : next.periodTo,
        );
        next = { ...next, periodFrom: clamped.periodFrom, periodTo: clamped.periodTo };
      }
      return next;
    });
  }

  return (
    <div
      ref={(node) => {
        if (listScrollRef) listScrollRef.current = node;
      }}
      className="space-y-3"
    >
      <div className="flex flex-wrap items-end justify-between gap-2 border-b border-border pb-2">
        <div>
          <h2 className="text-base font-semibold tracking-tight text-foreground">
            {t('admin.waterHistoryTitle')}
          </h2>
          <p className="mt-0.5 text-xs text-muted">{t('admin.waterHistoryLead')}</p>
        </div>
        <p className="text-xs tabular-nums text-muted">{countLabel}</p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs font-medium text-secondary">
          {t('admin.waterHistorySearch')}
          <input
            type="search"
            value={filters.query}
            onChange={(e) => patchFilters({ query: e.target.value })}
            placeholder={t('admin.waterHistorySearchPh')}
            className={`mt-1 block w-56 ${adminFieldClass}`}
          />
        </label>
        <label className="text-xs font-medium text-secondary">
          {t('admin.utilRegFilterSection')}
          <select
            value={filters.section}
            onChange={(e) => patchFilters({ section: e.target.value })}
            className={`mt-1 block w-36 ${adminFieldClass}`}
          >
            <option value="">{t('admin.sfFilterAll')}</option>
            {sections.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-medium text-secondary">
          {t('admin.waterMetersFilterBlock')}
          <select
            value={filters.block}
            onChange={(e) => patchFilters({ block: e.target.value })}
            className={`mt-1 block w-36 ${adminFieldClass}`}
          >
            <option value="">{t('admin.sfFilterAll')}</option>
            {blocks.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-medium text-secondary">
          {t('admin.utilRegDateFrom')}
          <input
            type="date"
            value={filters.periodFrom}
            onChange={(e) => patchFilters({ periodFrom: e.target.value })}
            className={`mt-1 block w-40 ${adminFieldClass}`}
          />
        </label>
        <label className="text-xs font-medium text-secondary">
          {t('admin.utilRegDateTo')}
          <input
            type="date"
            value={filters.periodTo}
            onChange={(e) => patchFilters({ periodTo: e.target.value })}
            className={`mt-1 block w-40 ${adminFieldClass}`}
          />
        </label>
        <AdminSecondaryButton
          type="button"
          disabled={!filtersActive}
          onClick={() => {
            userEditRef.current = true;
            setFilters(EMPTY_WATER_HISTORY_FILTERS);
          }}
        >
          {t('admin.sfFilterReset')}
        </AdminSecondaryButton>
      </div>
      <p className="text-[11px] text-muted">{t('admin.waterHistoryRangeHint')}</p>

      {error ? <AdminInlineAlert tone="danger">{error}</AdminInlineAlert> : null}
      {loading ? (
        <p className="text-sm text-muted">{t('common.loading')}</p>
      ) : visible.length === 0 ? (
        <AdminEmptyState
          title={filtersActive ? t('admin.utilFinEmptyFilter') : t('admin.waterHistoryEmpty')}
        />
      ) : (
        <>
          <AdminTableShell className="hidden md:block">
            <table className="w-full min-w-[48rem] text-sm">
              <thead>
                <tr className={adminTableHeadRowClass}>
                  <th className={adminTableCellClass}>{t('admin.utilRegColApt')}</th>
                  <th className={adminTableCellClass}>{t('admin.utilRegColSection')}</th>
                  <th className={adminTableCellClass}>{t('admin.colOwner')}</th>
                  <th className={adminTableCellClass}>{t('admin.waterHistoryColLast')}</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => {
                  const selected =
                    focusPropertyId !== '' &&
                    focusPropertyId != null &&
                    Number(focusPropertyId) === row.propertyId;
                  return (
                    <tr
                      key={row.propertyId}
                      data-property-id={row.propertyId}
                      tabIndex={0}
                      className={`${adminTableRowClass} cursor-pointer focus-visible:bg-hover/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40 ${
                        selected ? 'bg-accent-bg/60' : ''
                      }`}
                      onClick={(e) => onOpenHistory(row, e.currentTarget)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onOpenHistory(row, e.currentTarget);
                        }
                      }}
                    >
                      <td className={adminTableCellClass}>
                        {formatPropertyIdentity(
                          {
                            apartment_number: row.apartmentNumber || null,
                            section_code: row.sectionCode || null,
                            block_code: row.blockCode || null,
                          },
                          t,
                        )}
                      </td>
                      <td className={adminTableCellClass}>
                        {formatSectionBlock(row.sectionCode, row.blockCode)}
                      </td>
                      <td className={adminTableCellClass}>
                        {row.ownerName?.trim() ? row.ownerName : '—'}
                      </td>
                      <td className={`${adminTableCellClass} tabular-nums`}>
                        {row.lastEventDate
                          ? formatOwnerDate(row.lastEventDate)
                          : t('admin.waterHistoryNoEntries')}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </AdminTableShell>

          <ul className="space-y-2 md:hidden">
            {visible.map((row) => {
              const selected =
                focusPropertyId !== '' &&
                focusPropertyId != null &&
                Number(focusPropertyId) === row.propertyId;
              return (
                <li key={row.propertyId}>
                  <button
                    type="button"
                    data-property-id={row.propertyId}
                    className={`w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-left hover:bg-hover/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${
                      selected ? 'border-accent/40 bg-accent-bg/40' : ''
                    }`}
                    onClick={(e) => onOpenHistory(row, e.currentTarget)}
                  >
                    <p className="text-sm font-medium text-foreground">
                      {formatPropertyIdentity(
                        {
                          apartment_number: row.apartmentNumber || null,
                          section_code: row.sectionCode || null,
                          block_code: row.blockCode || null,
                        },
                        t,
                      )}
                    </p>
                    <p className="mt-0.5 text-xs text-muted">
                      {formatSectionBlock(row.sectionCode, row.blockCode)}
                      {row.ownerName?.trim() ? ` · ${row.ownerName}` : ''}
                    </p>
                    <p className="mt-1 text-sm tabular-nums text-foreground">
                      {row.lastEventDate
                        ? formatOwnerDate(row.lastEventDate)
                        : t('admin.waterHistoryNoEntries')}
                    </p>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

/** Current filter snapshot for opening the journal with the same date range. */
export function readWaterHistoryFiltersFromSearch(search: string): WaterHistoryRegisterFilters {
  return readHistoryFiltersFromSearch(search);
}

function readHistoryFiltersFromSearch(search: string): WaterHistoryRegisterFilters {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const clamped = clampWaterPeriodRange(
    (params.get('whFrom') ?? '').trim(),
    (params.get('whTo') ?? '').trim(),
  );
  return {
    query: (params.get('whQ') ?? '').trim(),
    section: (params.get('whSection') ?? '').trim(),
    block: (params.get('whBlock') ?? '').trim(),
    periodFrom: clamped.periodFrom,
    periodTo: clamped.periodTo,
  };
}

function historyFiltersEqual(a: WaterHistoryRegisterFilters, b: WaterHistoryRegisterFilters): boolean {
  return (
    a.query === b.query &&
    a.section === b.section &&
    a.block === b.block &&
    a.periodFrom === b.periodFrom &&
    a.periodTo === b.periodTo
  );
}
