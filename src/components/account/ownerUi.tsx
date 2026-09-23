'use client';

import type { ReactNode } from 'react';

export function SectionHeader({
  title,
  secondary,
  action,
}: {
  title: string;
  secondary?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-lg font-semibold tracking-tight text-foreground">{title}</h2>
        {secondary ? <p className="mt-1 max-w-xl text-sm text-secondary">{secondary}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function StatusBadge({
  label,
  tone = 'neutral',
}: {
  label: string;
  tone?: 'neutral' | 'info' | 'success' | 'warning' | 'danger';
}) {
  const cls =
    tone === 'success'
      ? 'border-success/25 bg-success-bg text-success'
      : tone === 'danger'
        ? 'border-danger/25 bg-danger-bg text-danger'
        : tone === 'warning'
          ? 'border-warning/25 bg-warning-bg text-warning'
          : tone === 'info'
            ? 'border-accent/25 bg-accent-bg text-accent'
            : 'border-border bg-surface-secondary text-secondary';
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${cls}`}>{label}</span>
  );
}

export function EmptyState({
  title,
  text,
  action,
}: {
  title: string;
  text?: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-[14px] border border-border bg-surface px-4 py-6 text-center">
      <p className="text-sm font-medium text-foreground">{title}</p>
      {text ? <p className="mx-auto mt-1 max-w-sm text-sm text-secondary">{text}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

export function CompactCard({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-[14px] border border-border bg-surface px-4 py-3 ${className}`}>{children}</div>
  );
}

export function PillTabs<T extends string>({
  items,
  value,
  onChange,
}: {
  items: Array<{ id: T; label: string; count?: number }>;
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="-mx-1 overflow-x-auto pb-1" role="tablist">
      <div className="flex min-w-min gap-2 px-1">
        {items.map((item) => {
          const selected = item.id === value;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              onKeyDown={(e) => {
                if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
                e.preventDefault();
                const i = items.findIndex((x) => x.id === value);
                const next = e.key === 'ArrowRight'
                  ? items[(i + 1) % items.length]
                  : items[(i - 1 + items.length) % items.length];
                if (next) onChange(next.id);
              }}
              onClick={() => onChange(item.id)}
              className={`shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium whitespace-nowrap ${
                selected
                  ? 'border-accent/25 bg-accent-bg text-accent'
                  : 'border-border bg-surface text-secondary hover:bg-hover'
              }`}
            >
              {item.label}
              {typeof item.count === 'number' ? <span className="ml-1.5 tabular-nums opacity-80">{item.count}</span> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function PrimaryButton({
  children,
  onClick,
  disabled,
  type = 'button',
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: 'button' | 'submit';
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
    >
      {children}
    </button>
  );
}

export function TextLinkButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="text-sm text-accent hover:underline">
      {children}
    </button>
  );
}
