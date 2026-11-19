'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { useI18n } from '@/i18n/I18nProvider';
import { formatOwnerDate } from '@/lib/ownerFormat';
import { isMissingRelation } from '@/lib/polls';
import { toUserFacingMessage } from '@/lib/userFacingError';
import { formatPropertyIdentity } from '@/lib/propertyIdentity';
import { formatM3 } from '@/lib/utilities';
import {
  clampWaterPeriodRange,
  formatSectionBlock,
  listSectionsFromProperties,
} from '@/lib/utilityModuleRegister';
import { listBlocksFromProperties } from '@/lib/waterMetersRegister';
import {
  EMPTY_WATER_READING_FILTERS,
  buildWaterReadingRegisterRows,
  countWaterReadingRegisterStats,
  filterWaterReadingRegisterRows,
  waterReadingFiltersActive,
  type WaterReadingRegisterFilters,
  type WaterReadingRegisterRow,
} from '@/lib/waterReadingsRegister';
import {
  AdminEmptyState,
  AdminInlineAlert,
  AdminPrimaryButton,
  AdminTableShell,
  adminBtnSecondaryClass,
  adminTableCellClass,
  adminTableHeadRowClass,
  adminTableRowClass,
} from '@/components/admin/AdminUi';
import { AdminUtilityRegisterFiltersBar } from '@/components/admin/AdminUtilityRegisterFiltersBar';

type PropertyOption = {
  id: number;
  apartment_number: string | number | null;
  section_code?: string | null;
  block_code?: string | null;
  owner_name?: string | null;
};

function formatVolume(v: number | null, locale: string): string {
  if (v == null) return '—';
  return formatM3(v, locale);
}

export function AdminWaterReadingsRegister({
  supabase,
  properties,
  canOperate,
  canSubmit,
  refreshSignal = 0,
  focusReadingId,
  focusMeterId,
  onOpenReading,
  onOpenSubmit,
  onSubmitReading,
  listScrollRef,
}: {
  supabase: SupabaseClient<Database>;
  properties: PropertyOption[];
  canOperate: boolean;
  canSubmit: boolean;
  refreshSignal?: number;
  focusReadingId?: string | null;
  focusMeterId?: string | null;
  onOpenReading: (row: WaterReadingRegisterRow, rowEl: HTMLElement | null) => void;
  onOpenSubmit: () => void;
  onSubmitReading: (row: WaterReadingRegisterRow, rowEl: HTMLElement | null) => void;
  listScrollRef?: React.MutableRefObject<HTMLDivElement | null>;
}) {
  const { t, locale } = useI18n();
  const [filters, setFilters] = useState<WaterReadingRegisterFilters>(() => {
    if (typeof window === 'undefined') return EMPTY_WATER_READING_FILTERS;
    return readReadingFiltersFromSearch(window.location.search);
  });
  const userEditRef = useRef(false);
  const [rows, setRows] = useState<WaterReadingRegisterRow[]>([]);
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
      supabase
        .from('water_meters')
        .select('id, property_id, meter_number, retired_at')
        .is('retired_at', null)
        .limit(5000),
      supabase
        .from('water_readings')
        .select(
          'id, property_id, meter_id, reading_date, previous_value, current_value, submitted_by_email, submitted_via, status, reversed_at, created_at, reading_kind',
        )
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
      setError(toUserFacingMessage(readingsRes.error, t, { context: 'load', fallback: t('common.errLoad') }));
    }
    setRows(
      buildWaterReadingRegisterRows(
        (metersRes.data ?? []) as Parameters<typeof buildWaterReadingRegisterRows>[0],
        // reading_kind exists in DB but is not yet in generated database.types.
        (readingsRes.data as unknown as Parameters<typeof buildWaterReadingRegisterRows>[1]) ?? [],
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
      const next = readReadingFiltersFromSearch(window.location.search);
      setFilters((prev) => (readingFiltersEqual(prev, next) ? prev : next));
    };
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);

  useEffect(() => {
    if (!userEditRef.current || typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const q = filters.query.trim();
    if (q) params.set('wrQ', q);
    else params.delete('wrQ');
    if (filters.section) params.set('wrSection', filters.section);
    else params.delete('wrSection');
    if (filters.block) params.set('wrBlock', filters.block);
    else params.delete('wrBlock');
    if (filters.periodFrom) params.set('wrFrom', filters.periodFrom);
    else params.delete('wrFrom');
    if (filters.periodTo) params.set('wrTo', filters.periodTo);
    else params.delete('wrTo');
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
  const visible = useMemo(() => filterWaterReadingRegisterRows(rows, filters), [rows, filters]);
  const stats = useMemo(() => countWaterReadingRegisterStats(visible), [visible]);
  const filtersActive = waterReadingFiltersActive(filters);
  const countLabel =
    stats.meters !== stats.apartments
      ? t('admin.waterRegCountAptsMeters', {
          a: String(stats.apartments),
          m: String(stats.meters),
        })
      : t('admin.waterRegCountApts', { a: String(stats.apartments) });

  function patchFilters(patch: Partial<WaterReadingRegisterFilters>) {
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
      className="space-y-4"
    >
      <AdminUtilityRegisterFiltersBar
        countLabel={countLabel}
        primaryAction={
          canSubmit ? (
            <AdminPrimaryButton type="button" onClick={onOpenSubmit}>
              {t('admin.waterReadingsSubmit')}
            </AdminPrimaryButton>
          ) : null
        }
        search={{
          value: filters.query,
          onChange: (query) => patchFilters({ query }),
          placeholder: t('admin.waterReadingsSearchPh'),
        }}
        section={{
          value: filters.section,
          onChange: (section) => patchFilters({ section }),
          options: sections.map((s) => ({ value: s, label: s })),
        }}
        block={{
          value: filters.block,
          onChange: (block) => patchFilters({ block }),
          options: blocks.map((b) => ({ value: b, label: b })),
        }}
        periodFrom={{
          value: filters.periodFrom,
          onChange: (periodFrom) => patchFilters({ periodFrom }),
        }}
        periodTo={{
          value: filters.periodTo,
          onChange: (periodTo) => patchFilters({ periodTo }),
          min: filters.periodFrom || undefined,
        }}
        reset={{
          disabled: !filtersActive,
          onClick: () => {
            userEditRef.current = true;
            setFilters(EMPTY_WATER_READING_FILTERS);
          },
        }}
        hint={{
          summary: t('admin.waterReadingsRangeHintShort'),
          detail: t('admin.waterReadingsRangeHint'),
        }}
      />

      {error ? <AdminInlineAlert tone="danger">{error}</AdminInlineAlert> : null}
      {loading ? (
        <p className="text-sm text-muted">{t('common.loading')}</p>
      ) : visible.length === 0 ? (
        <AdminEmptyState
          title={filtersActive ? t('admin.utilFinEmptyFilter') : t('admin.waterReadingsEmpty')}
        />
      ) : (
        <>
          <AdminTableShell className="hidden md:block">
            <table className="w-full min-w-[64rem] text-sm">
              <thead>
                <tr className={adminTableHeadRowClass}>
                  <th className={adminTableCellClass}>{t('admin.utilRegColApt')}</th>
                  <th className={adminTableCellClass}>{t('admin.utilRegColSection')}</th>
                  <th className={adminTableCellClass}>{t('admin.meterNumber')}</th>
                  <th className={adminTableCellClass}>{t('admin.utilRegColPrevM3')}</th>
                  <th className={adminTableCellClass}>{t('admin.utilRegColCurrM3')}</th>
                  <th className={adminTableCellClass}>{t('admin.waterReadingsColDate')}</th>
                  <th className={adminTableCellClass}>{t('admin.waterReadingsColWho')}</th>
                  {canSubmit ? (
                    <th className={adminTableCellClass}>
                      <span className="sr-only">{t('admin.waterReadingsSubmit')}</span>
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => {
                  const rowKey = row.meterId ?? `apt-${row.propertyId}`;
                  const selected =
                    (focusReadingId && row.readingId === focusReadingId) ||
                    (!focusReadingId && Boolean(focusMeterId) && focusMeterId === row.meterId);
                  return (
                    <tr
                      key={rowKey}
                      data-meter-id={row.meterId ?? ''}
                      data-property-id={row.propertyId}
                      data-reading-id={row.readingId ?? ''}
                      tabIndex={0}
                      className={`${adminTableRowClass} cursor-pointer focus-visible:bg-hover/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40 ${
                        selected ? 'bg-accent-bg/60' : ''
                      }`}
                      onClick={(e) => onOpenReading(row, e.currentTarget)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onOpenReading(row, e.currentTarget);
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
                        {row.meterNumber.trim() ? row.meterNumber : '—'}
                      </td>
                      <td className={`${adminTableCellClass} tabular-nums`}>
                        {formatVolume(row.previousValue, locale)}
                      </td>
                      <td className={`${adminTableCellClass} tabular-nums`}>
                        {formatVolume(row.currentValue, locale)}
                      </td>
                      <td className={`${adminTableCellClass} tabular-nums`}>
                        {row.readingDate ? formatOwnerDate(row.readingDate) : '—'}
                      </td>
                      <td className={adminTableCellClass}>
                        {row.submittedByEmail?.trim() ? row.submittedByEmail : '—'}
                      </td>
                      {canSubmit ? (
                        <td className={`${adminTableCellClass} whitespace-nowrap`}>
                          <button
                            type="button"
                            className={`${adminBtnSecondaryClass} px-2.5 py-1.5 text-xs`}
                            onClick={(e) => {
                              e.stopPropagation();
                              onSubmitReading(row, e.currentTarget);
                            }}
                            onKeyDown={(e) => e.stopPropagation()}
                          >
                            {t('admin.waterReadingsSubmit')}
                          </button>
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </AdminTableShell>

          <ul className="space-y-2 md:hidden">
            {visible.map((row) => (
              <li key={row.meterId ?? `apt-${row.propertyId}`}>
                <div className="rounded-xl border border-border bg-surface px-3 py-2.5">
                  <button
                    type="button"
                    data-meter-id={row.meterId ?? ''}
                    data-property-id={row.propertyId}
                    className="w-full text-left hover:bg-hover/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                    onClick={(e) => onOpenReading(row, e.currentTarget)}
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
                      {formatSectionBlock(row.sectionCode, row.blockCode)} ·{' '}
                      {row.meterNumber.trim() ? row.meterNumber : '—'}
                    </p>
                    <p className="mt-1 text-sm tabular-nums text-foreground">
                      {formatVolume(row.previousValue, locale)} → {formatVolume(row.currentValue, locale)}
                    </p>
                    <p className="mt-0.5 text-xs text-secondary">
                      {row.readingDate ? formatOwnerDate(row.readingDate) : '—'}
                    </p>
                  </button>
                  {canSubmit ? (
                    <button
                      type="button"
                      className={`mt-2 w-full ${adminBtnSecondaryClass} px-2.5 py-1.5 text-xs`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSubmitReading(row, e.currentTarget);
                      }}
                    >
                      {t('admin.waterReadingsSubmit')}
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function readReadingFiltersFromSearch(search: string): WaterReadingRegisterFilters {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const clamped = clampWaterPeriodRange(
    (params.get('wrFrom') ?? '').trim(),
    (params.get('wrTo') ?? '').trim(),
  );
  return {
    query: (params.get('wrQ') ?? '').trim(),
    section: (params.get('wrSection') ?? '').trim(),
    block: (params.get('wrBlock') ?? '').trim(),
    periodFrom: clamped.periodFrom,
    periodTo: clamped.periodTo,
  };
}

function readingFiltersEqual(a: WaterReadingRegisterFilters, b: WaterReadingRegisterFilters): boolean {
  return (
    a.query === b.query &&
    a.section === b.section &&
    a.block === b.block &&
    a.periodFrom === b.periodFrom &&
    a.periodTo === b.periodTo
  );
}
