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
  filterWaterReadingRegisterRows,
  waterReadingFiltersActive,
  type WaterReadingRegisterFilters,
  type WaterReadingRegisterRow,
} from '@/lib/waterReadingsRegister';
import type { MeterReadingStatusCode } from '@/lib/meterReadingHistory';
import {
  AdminEmptyState,
  AdminInlineAlert,
  AdminPrimaryButton,
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

function statusLabel(code: MeterReadingStatusCode | null, t: (k: string) => string): string {
  if (code === 'opening') return t('admin.meterHistStatusOpening');
  if (code === 'pending_review') return t('admin.meterHistStatusPending');
  if (code === 'accepted') return t('admin.meterHistStatusAccepted');
  if (code === 'rejected') return t('admin.meterHistStatusRejected');
  return '—';
}

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
  const filtersActive = waterReadingFiltersActive(filters);

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
      className="space-y-3"
    >
      <div className="flex flex-wrap items-end justify-between gap-2 border-b border-border pb-2">
        <div>
          <h2 className="text-base font-semibold tracking-tight text-foreground">
            {t('admin.waterReadingsTitle')}
          </h2>
          <p className="mt-0.5 text-xs text-muted">{t('admin.waterReadingsLead')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs tabular-nums text-muted">
            {t('admin.utilFinRegisterCount', { n: String(visible.length) })}
          </p>
          {canSubmit ? (
            <AdminPrimaryButton type="button" onClick={onOpenSubmit}>
              {t('admin.waterReadingsSubmit')}
            </AdminPrimaryButton>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs font-medium text-secondary">
          {t('admin.waterReadingsSearch')}
          <input
            type="search"
            value={filters.query}
            onChange={(e) => patchFilters({ query: e.target.value })}
            placeholder={t('admin.waterReadingsSearchPh')}
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
            min={filters.periodFrom || undefined}
            onChange={(e) => patchFilters({ periodTo: e.target.value })}
            className={`mt-1 block w-40 ${adminFieldClass}`}
          />
        </label>
        <AdminSecondaryButton
          type="button"
          disabled={!filtersActive}
          onClick={() => {
            userEditRef.current = true;
            setFilters(EMPTY_WATER_READING_FILTERS);
          }}
        >
          {t('admin.sfFilterReset')}
        </AdminSecondaryButton>
      </div>
      <p className="text-[11px] text-muted">{t('admin.waterReadingsRangeHint')}</p>

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
                  <th className={adminTableCellClass}>{t('admin.waterReadingsColStatus')}</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => {
                  const selected =
                    (focusReadingId && row.readingId === focusReadingId) ||
                    (!focusReadingId && focusMeterId === row.meterId);
                  return (
                    <tr
                      key={row.meterId}
                      data-meter-id={row.meterId}
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
                      <td className={adminTableCellClass}>{statusLabel(row.statusCode, t)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </AdminTableShell>

          <ul className="space-y-2 md:hidden">
            {visible.map((row) => (
              <li key={row.meterId}>
                <button
                  type="button"
                  data-meter-id={row.meterId}
                  className="w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-left hover:bg-hover/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
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
                    {row.readingDate ? formatOwnerDate(row.readingDate) : '—'} ·{' '}
                    {statusLabel(row.statusCode, t)}
                  </p>
                </button>
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
