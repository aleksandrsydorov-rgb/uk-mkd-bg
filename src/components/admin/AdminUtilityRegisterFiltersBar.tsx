'use client';

import type { ReactNode } from 'react';
import { useI18n } from '@/i18n/I18nProvider';
import {
  AdminSecondaryButton,
  adminFieldClass,
} from '@/components/admin/AdminUi';

/**
 * Shared register filters shell for utility workplaces (Water tabs and siblings).
 * Layout / spacing / field sizes are owned here — callers only pass applicable controls.
 */

export const utilityRegisterFilterLabelClass = 'block text-xs font-medium text-secondary';
export const utilityRegisterFilterSearchClass = `mt-1 block w-56 max-w-full ${adminFieldClass}`;
export const utilityRegisterFilterSelectClass = `mt-1 block w-36 max-w-full ${adminFieldClass}`;
export const utilityRegisterFilterDateClass = `mt-1 block w-40 max-w-full ${adminFieldClass}`;
export const utilityRegisterFilterSelectWideClass = `mt-1 block w-44 max-w-full ${adminFieldClass}`;

type SelectOption = { value: string; label: string };

export function AdminUtilityRegisterFiltersBar({
  search,
  section,
  block,
  periodFrom,
  periodTo,
  extras,
  reset,
  countLabel,
  primaryAction,
  hint,
}: {
  search?: {
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
    label?: string;
  };
  section?: {
    value: string;
    onChange: (v: string) => void;
    options: SelectOption[];
    label?: string;
  };
  block?: {
    value: string;
    onChange: (v: string) => void;
    options: SelectOption[];
    label?: string;
  };
  periodFrom?: {
    value: string;
    onChange: (v: string) => void;
    label?: string;
  };
  periodTo?: {
    value: string;
    onChange: (v: string) => void;
    label?: string;
    min?: string;
  };
  /** Tab-specific controls after the shared date fields (balance, sort, …). */
  extras?: ReactNode;
  reset?: {
    disabled?: boolean;
    onClick: () => void;
  };
  countLabel?: ReactNode;
  primaryAction?: ReactNode;
  /** Collapsible range / scope help — short summary, long detail. */
  hint?: {
    summary: string;
    detail: string;
  } | null;
}) {
  const { t } = useI18n();
  const showToolbar = countLabel != null || primaryAction != null;

  return (
    <div className="space-y-2 rounded-[14px] border border-border bg-surface-secondary/40 px-3 py-3">
      {showToolbar ? (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {countLabel != null ? (
            <p className="mr-auto text-xs tabular-nums text-muted">{countLabel}</p>
          ) : null}
          {primaryAction}
        </div>
      ) : null}

      <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
        {search ? (
          <label className={utilityRegisterFilterLabelClass}>
            {search.label ?? t('admin.utilRegFilterSearch')}
            <input
              type="search"
              value={search.value}
              onChange={(e) => search.onChange(e.target.value)}
              placeholder={search.placeholder}
              className={utilityRegisterFilterSearchClass}
            />
          </label>
        ) : null}

        {section ? (
          <label className={utilityRegisterFilterLabelClass}>
            {section.label ?? t('admin.utilRegFilterSection')}
            <select
              value={section.value}
              onChange={(e) => section.onChange(e.target.value)}
              className={utilityRegisterFilterSelectClass}
            >
              <option value="">{t('admin.sfFilterAll')}</option>
              {section.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {block ? (
          <label className={utilityRegisterFilterLabelClass}>
            {block.label ?? t('admin.waterMetersFilterBlock')}
            <select
              value={block.value}
              onChange={(e) => block.onChange(e.target.value)}
              className={utilityRegisterFilterSelectClass}
            >
              <option value="">{t('admin.sfFilterAll')}</option>
              {block.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {periodFrom ? (
          <label className={utilityRegisterFilterLabelClass}>
            {periodFrom.label ?? t('admin.utilRegDateFrom')}
            <input
              type="date"
              value={periodFrom.value}
              onChange={(e) => periodFrom.onChange(e.target.value)}
              className={utilityRegisterFilterDateClass}
            />
          </label>
        ) : null}

        {periodTo ? (
          <label className={utilityRegisterFilterLabelClass}>
            {periodTo.label ?? t('admin.utilRegDateTo')}
            <input
              type="date"
              value={periodTo.value}
              min={periodTo.min}
              onChange={(e) => periodTo.onChange(e.target.value)}
              className={utilityRegisterFilterDateClass}
            />
          </label>
        ) : null}

        {extras}

        {reset ? (
          <AdminSecondaryButton type="button" disabled={reset.disabled} onClick={reset.onClick}>
            {t('admin.sfFilterReset')}
          </AdminSecondaryButton>
        ) : null}
      </div>

      {hint ? (
        <details className="group text-[11px] text-muted">
          <summary className="cursor-pointer list-none select-none text-secondary marker:content-none hover:text-foreground [&::-webkit-details-marker]:hidden">
            <span className="underline-offset-2 group-open:no-underline">
              {hint.summary}
              <span className="ml-1 text-accent group-open:hidden">{t('admin.utilRegFilterHintMore')}</span>
            </span>
          </summary>
          <p className="mt-1.5 max-w-4xl leading-relaxed">{hint.detail}</p>
        </details>
      ) : null}
    </div>
  );
}
