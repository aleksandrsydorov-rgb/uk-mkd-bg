'use client';

import type { ReactNode } from 'react';
import { useI18n } from '@/i18n/I18nProvider';
import { adminFieldClass } from '@/components/admin/AdminUi';

export type WaterFinanceKindFilter = 'all' | 'charges' | 'payments';

const controlClass = `${adminFieldClass} mt-1 block w-[11rem] min-h-10 shrink-0`;

/**
 * Shared left-aligned journal filters for apartment history shells.
 * Date fields stay in fixed slots so tab switches do not jump coordinates.
 */
export function HistoryJournalFilterBar({
  periodFrom,
  periodTo,
  onPeriodFromChange,
  onPeriodToChange,
  onClear,
  extra,
  hint,
  clearActive,
}: {
  periodFrom: string;
  periodTo: string;
  onPeriodFromChange: (value: string) => void;
  onPeriodToChange: (value: string) => void;
  onClear: () => void;
  /** Third control (e.g. operation type) — finance tab only. */
  extra?: ReactNode;
  /** Fixed-height hint slot so table top stays stable across tabs. */
  hint?: ReactNode;
  clearActive?: boolean;
}) {
  const { t } = useI18n();
  const showClear = clearActive ?? Boolean(periodFrom || periodTo || extra);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-3">
        <label className="block text-xs text-muted">
          {t('admin.meterHistPeriodFrom')}
          <input
            type="date"
            className={controlClass}
            value={periodFrom}
            max={periodTo || undefined}
            onChange={(e) => onPeriodFromChange(e.target.value)}
          />
        </label>
        <label className="block text-xs text-muted">
          {t('admin.meterHistPeriodTo')}
          <input
            type="date"
            className={controlClass}
            value={periodTo}
            min={periodFrom || undefined}
            onChange={(e) => onPeriodToChange(e.target.value)}
          />
        </label>
        {extra}
        {showClear ? (
          <button
            type="button"
            className="mb-2 text-sm text-accent hover:underline"
            onClick={onClear}
          >
            {t('admin.meterHistPeriodClear')}
          </button>
        ) : null}
      </div>
      {/* Reserved slot — same height whether hint is present or not. */}
      <div className="min-h-[2.5rem] text-xs text-muted">{hint ?? null}</div>
    </div>
  );
}

export function HistoryJournalKindFilter({
  value,
  onChange,
}: {
  value: WaterFinanceKindFilter;
  onChange: (value: WaterFinanceKindFilter) => void;
}) {
  const { t } = useI18n();
  return (
    <label className="block text-xs text-muted">
      {t('admin.waterHistoryFinanceKindFilter')}
      <select
        className={controlClass}
        value={value}
        onChange={(e) => onChange(e.target.value as WaterFinanceKindFilter)}
      >
        <option value="all">{t('admin.sfFilterAll')}</option>
        <option value="charges">{t('admin.waterHistoryFinanceCharges')}</option>
        <option value="payments">{t('admin.waterHistoryFinancePayments')}</option>
      </select>
    </label>
  );
}
