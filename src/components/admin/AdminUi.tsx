'use client';

import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { EmptyState, SectionHeader, StatusBadge } from '@/components/account/ownerUi';

export { EmptyState as AdminEmptyState, StatusBadge };

/** Shared admin surface tokens (operational density). */
export const adminCardClass = 'rounded-[14px] border border-border bg-surface shadow-card';
export const adminCardPad = 'p-4 md:p-5';
export const adminFormPanelClass = `${adminCardClass} border-accent/20 p-4 space-y-3`;

export const adminFieldClass =
  'w-full min-h-10 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-placeholder focus:outline-none focus:ring-2 focus:ring-accent/30 disabled:opacity-50';

export const adminTableHeadRowClass =
  'text-left text-xs font-medium uppercase tracking-wide text-muted border-b border-border bg-surface-secondary/70';
export const adminTableRowClass = 'border-b border-border hover:bg-hover/40';
export const adminTableCellClass = 'py-2 px-3 align-middle';

export const adminBtnPrimaryClass =
  'inline-flex items-center justify-center rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed';
export const adminBtnSecondaryClass =
  'inline-flex items-center justify-center rounded-lg border border-border bg-surface px-3 py-2 text-sm text-secondary hover:bg-hover disabled:opacity-50 disabled:cursor-not-allowed';
export const adminBtnDangerClass =
  'inline-flex items-center justify-center rounded-lg border border-danger/25 bg-danger-bg px-3 py-2 text-sm text-danger hover:bg-danger-bg/80 disabled:opacity-50';
export const adminBtnTertiaryClass =
  'inline-flex items-center justify-center text-sm text-accent hover:underline disabled:opacity-50';

export const adminModalOverlayClass = 'fixed inset-0 z-50 flex items-center justify-center bg-[rgba(20,25,30,0.25)] p-4';
export const adminModalPanelClass =
  'w-full max-h-[90vh] flex flex-col rounded-2xl border border-border bg-surface shadow-[0_4px_16px_rgba(0,0,0,0.06)]';
export const adminModalHeaderClass = 'flex shrink-0 items-start justify-between gap-3 border-b border-border px-5 py-4';

export function AdminPageHeader({
  title,
  secondary,
  action,
}: {
  title: string;
  secondary?: string;
  action?: ReactNode;
}) {
  return <SectionHeader title={title} secondary={secondary} action={action} />;
}

export function AdminMetricCard({
  label,
  value,
  secondary,
  onClick,
  alert = false,
  align = 'left',
}: {
  label: string;
  value: string;
  secondary?: string;
  onClick?: () => void;
  alert?: boolean;
  align?: 'left' | 'center';
}) {
  const centered = align === 'center';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${adminCardClass} flex w-full flex-col px-3 py-2.5 hover:bg-hover/50 ${
        centered ? 'items-center text-center' : 'text-left'
      }`}
    >
      <span className="text-xs text-muted">{label}</span>
      <span className={`mt-1 text-xl font-semibold tabular-nums leading-none ${alert ? 'text-danger' : 'text-foreground'}`}>
        {value}
      </span>
      {secondary ? <span className="mt-1 text-xs text-secondary">{secondary}</span> : null}
    </button>
  );
}

export function AdminCard({
  children,
  className = '',
  pad = true,
}: {
  children: ReactNode;
  className?: string;
  pad?: boolean;
}) {
  return (
    <div className={`${adminCardClass} ${pad ? adminCardPad : ''} ${className}`.trim()}>{children}</div>
  );
}

export function AdminFilterBar({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-[14px] border border-border bg-surface px-3 py-3 space-y-3 md:p-4 ${className}`.trim()}>
      {children}
    </div>
  );
}

export function AdminTableShell({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`overflow-x-auto rounded-[14px] border border-border bg-surface shadow-card ${className}`.trim()}>
      {children}
    </div>
  );
}

export function AdminPrimaryButton({
  children,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={`${adminBtnPrimaryClass} ${className}`.trim()} {...props}>
      {children}
    </button>
  );
}

export function AdminSecondaryButton({
  children,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={`${adminBtnSecondaryClass} ${className}`.trim()} {...props}>
      {children}
    </button>
  );
}

export function AdminDangerButton({
  children,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={`${adminBtnDangerClass} ${className}`.trim()} {...props}>
      {children}
    </button>
  );
}

export function AdminInlineAlert({
  tone,
  children,
  onDismiss,
}: {
  tone: 'danger' | 'warning' | 'success';
  children: ReactNode;
  onDismiss?: () => void;
}) {
  const cls =
    tone === 'danger'
      ? 'border-danger/25 bg-danger-bg text-danger'
      : tone === 'warning'
        ? 'border-warning/25 bg-warning-bg text-warning'
        : 'border-success/25 bg-success-bg text-success';
  return (
    <div className={`flex items-start justify-between gap-2 rounded-lg border px-3 py-2 text-sm ${cls}`}>
      <div className="min-w-0 flex-1">{children}</div>
      {onDismiss ? (
        <button type="button" onClick={onDismiss} className="shrink-0 text-xs opacity-80 hover:opacity-100">
          ✕
        </button>
      ) : null}
    </div>
  );
}

export function AdminSectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted">{children}</p>
  );
}

export const ADMIN_UTILITY_TABS = ['overview', 'meter', 'readings', 'tariff', 'finance'] as const;
export type AdminUtilityTab = (typeof ADMIN_UTILITY_TABS)[number];

export function parseAdminUtilityTab(
  value: string | null | undefined,
  allowed?: readonly AdminUtilityTab[],
): AdminUtilityTab {
  const ok = allowed ?? ADMIN_UTILITY_TABS;
  if (value && (ok as readonly string[]).includes(value)) return value as AdminUtilityTab;
  return 'overview';
}

export function AdminTabBar({
  tabs,
  active,
  onChange,
}: {
  tabs: { id: string; label: string }[];
  active: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1" role="tablist">
      {tabs.map((tab) => {
        const on = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(tab.id)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-sm ${
              on ? 'bg-accent text-white' : 'border border-border bg-surface text-secondary hover:bg-hover'
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
