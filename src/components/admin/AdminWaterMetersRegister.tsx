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
  EMPTY_WATER_METER_FILTERS,
  buildWaterMeterRegisterRows,
  countWaterMeterRegisterStats,
  filterWaterMeterRegisterRows,
  formatSectionBlock,
  listBlocksFromProperties,
  listSectionsFromProperties,
  waterMeterFiltersActive,
  type WaterMeterRegisterFilters,
  type WaterMeterRegisterRow,
} from '@/lib/waterMetersRegister';
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

export function AdminWaterMetersRegister({
  supabase,
  properties,
  canOperate,
  focusMeterId,
  onOpenMeter,
  listScrollRef,
}: {
  supabase: SupabaseClient<Database>;
  properties: PropertyOption[];
  canOperate: boolean;
  focusMeterId?: string | null;
  onOpenMeter: (row: WaterMeterRegisterRow, rowEl: HTMLElement | null) => void;
  listScrollRef?: React.MutableRefObject<HTMLDivElement | null>;
}) {
  const { t } = useI18n();
  const [filters, setFilters] = useState<WaterMeterRegisterFilters>(() => {
    if (typeof window === 'undefined') return EMPTY_WATER_METER_FILTERS;
    return readMeterFiltersFromSearch(window.location.search);
  });
  const userEditRef = useRef(false);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  const [rows, setRows] = useState<WaterMeterRegisterRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const load = useCallback(async () => {
    if (!canOperate) {
      setRows([]);
      return;
    }
    setLoading(true);
    setError(null);
    const { data, error: qErr } = await supabase
      .from('water_meters')
      .select('id, property_id, meter_number, installed_at, retired_at')
      .is('retired_at', null)
      .order('installed_at', { ascending: false })
      .limit(5000);
    setLoading(false);
    if (qErr && !isMissingRelation(qErr, 'water_meters')) {
      setError(toUserFacingMessage(qErr, t, { context: 'load', fallback: t('common.errLoad') }));
      setRows([]);
      return;
    }
    setRows(buildWaterMeterRegisterRows((data ?? []) as Parameters<typeof buildWaterMeterRegisterRows>[0], properties));
  }, [canOperate, properties, supabase, t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const sync = () => {
      if (userEditRef.current) return;
      const next = readMeterFiltersFromSearch(window.location.search);
      setFilters((prev) => (meterFiltersEqual(prev, next) ? prev : next));
    };
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);

  useEffect(() => {
    if (!userEditRef.current || typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const q = filters.query.trim();
    if (q) params.set('wmQ', q);
    else params.delete('wmQ');
    if (filters.section) params.set('wmSection', filters.section);
    else params.delete('wmSection');
    if (filters.block) params.set('wmBlock', filters.block);
    else params.delete('wmBlock');
    const qs = params.toString();
    const current = window.location.search.replace(/^\?/, '');
    if (qs === current) {
      userEditRef.current = false;
      return;
    }
    const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
    window.history.replaceState(window.history.state, '', url);
    userEditRef.current = false;
  }, [filters.query, filters.section, filters.block]);

  const sections = useMemo(() => listSectionsFromProperties(properties), [properties]);
  const blocks = useMemo(
    () => listBlocksFromProperties(properties, filters.section),
    [properties, filters.section],
  );
  const visible = useMemo(() => filterWaterMeterRegisterRows(rows, filters), [rows, filters]);
  const stats = useMemo(() => countWaterMeterRegisterStats(visible), [visible]);
  const filtersActive = waterMeterFiltersActive(filters);
  const countLabel =
    stats.meters !== stats.apartments
      ? t('admin.waterRegCountAptsMeters', {
          a: String(stats.apartments),
          m: String(stats.meters),
        })
      : t('admin.waterRegCountApts', { a: String(stats.apartments) });

  function patchFilters(patch: Partial<WaterMeterRegisterFilters>) {
    userEditRef.current = true;
    setFilters((f) => {
      const next = { ...f, ...patch };
      if (patch.section !== undefined && patch.section !== f.section) {
        next.block = '';
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
            {t('admin.waterMetersTitle')}
          </h2>
          <p className="mt-0.5 text-xs text-muted">{t('admin.waterMetersLead')}</p>
        </div>
        <p className="text-xs tabular-nums text-muted">{countLabel}</p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs font-medium text-secondary">
          {t('admin.waterMetersSearch')}
          <input
            type="search"
            value={filters.query}
            onChange={(e) => patchFilters({ query: e.target.value })}
            placeholder={t('admin.waterMetersSearchPh')}
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
        <AdminSecondaryButton
          type="button"
          disabled={!filtersActive}
          onClick={() => {
            userEditRef.current = true;
            setFilters(EMPTY_WATER_METER_FILTERS);
          }}
        >
          {t('admin.sfFilterReset')}
        </AdminSecondaryButton>
      </div>

      {error ? <AdminInlineAlert tone="danger">{error}</AdminInlineAlert> : null}
      {loading ? (
        <p className="text-sm text-muted">{t('common.loading')}</p>
      ) : visible.length === 0 ? (
        <AdminEmptyState
          title={filtersActive ? t('admin.utilFinEmptyFilter') : t('admin.waterMetersEmpty')}
        />
      ) : (
        <>
          <AdminTableShell className="hidden md:block">
            <table className="w-full min-w-[40rem] text-sm">
              <thead>
                <tr className={adminTableHeadRowClass}>
                  <th className={adminTableCellClass}>{t('admin.utilRegColApt')}</th>
                  <th className={adminTableCellClass}>{t('admin.utilRegColSection')}</th>
                  <th className={adminTableCellClass}>{t('admin.meterNumber')}</th>
                  <th className={adminTableCellClass}>{t('admin.installedAt')}</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => {
                  const rowKey = row.meterId ?? `apt-${row.propertyId}`;
                  const selected = Boolean(focusMeterId) && focusMeterId === row.meterId;
                  return (
                    <tr
                      key={rowKey}
                      data-meter-id={row.meterId ?? ''}
                      data-property-id={row.propertyId}
                      tabIndex={0}
                      className={`${adminTableRowClass} cursor-pointer focus-visible:bg-hover/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40 ${
                        selected ? 'bg-accent-bg/60' : ''
                      }`}
                      onClick={(e) => {
                        returnFocusRef.current = e.currentTarget;
                        onOpenMeter(row, e.currentTarget);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          returnFocusRef.current = e.currentTarget;
                          onOpenMeter(row, e.currentTarget);
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
                        <button
                          type="button"
                          className="font-medium text-accent underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                          onClick={(e) => {
                            e.stopPropagation();
                            returnFocusRef.current = e.currentTarget;
                            onOpenMeter(row, e.currentTarget);
                          }}
                        >
                          {row.meterNumber.trim() ? row.meterNumber : '—'}
                        </button>
                      </td>
                      <td className={`${adminTableCellClass} tabular-nums`}>
                        {row.installedAt ? formatOwnerDate(row.installedAt) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </AdminTableShell>

          <ul className="space-y-2 md:hidden">
            {visible.map((row) => {
              const rowKey = row.meterId ?? `apt-${row.propertyId}`;
              const selected = Boolean(focusMeterId) && focusMeterId === row.meterId;
              return (
                <li key={rowKey}>
                  <button
                    type="button"
                    data-meter-id={row.meterId ?? ''}
                    data-property-id={row.propertyId}
                    className={`w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-left hover:bg-hover/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${
                      selected ? 'border-accent/40 bg-accent-bg/40' : ''
                    }`}
                    onClick={(e) => {
                      returnFocusRef.current = e.currentTarget;
                      onOpenMeter(row, e.currentTarget);
                    }}
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
                    </p>
                    <p className="mt-1 text-sm font-medium text-accent">
                      {row.meterNumber.trim() ? row.meterNumber : '—'}
                    </p>
                    <p className="mt-0.5 text-xs tabular-nums text-secondary">
                      {t('admin.installedAt')}:{' '}
                      {row.installedAt ? formatOwnerDate(row.installedAt) : '—'}
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

function readMeterFiltersFromSearch(search: string): WaterMeterRegisterFilters {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  return {
    query: (params.get('wmQ') ?? '').trim(),
    section: (params.get('wmSection') ?? '').trim(),
    block: (params.get('wmBlock') ?? '').trim(),
  };
}

function meterFiltersEqual(a: WaterMeterRegisterFilters, b: WaterMeterRegisterFilters): boolean {
  return a.query === b.query && a.section === b.section && a.block === b.block;
}
