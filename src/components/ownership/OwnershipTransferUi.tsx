'use client';

import type { ReactNode, SyntheticEvent } from 'react';
import { StatusBadge, EmptyState } from '@/components/account/ownerUi';
import type { OwnershipTargetOwner } from '@/lib/ownership';
import type { RosterOwnerForm } from '@/lib/ownershipChange';

export function transferStatusTone(
  status: string
): 'neutral' | 'info' | 'success' | 'warning' | 'danger' {
  if (status === 'утверждена') return 'success';
  if (status === 'отклонена') return 'danger';
  if (status === 'отменена') return 'neutral';
  return 'warning';
}

export function ownerDisplayName(
  owner: Pick<
    OwnershipTargetOwner,
    | 'entity_kind'
    | 'first_name'
    | 'middle_name'
    | 'last_name'
    | 'entity_name'
    | 'email'
  >
): string {
  if (owner.entity_kind === 'legal_entity' || owner.entity_kind === 'sole_trader') {
    const name = String(owner.entity_name ?? '').trim();
    return name || owner.email;
  }
  const parts = [owner.first_name, owner.middle_name, owner.last_name]
    .map((x) => String(x ?? '').trim())
    .filter(Boolean);
  return parts.length ? parts.join(' ') : owner.email;
}

export function rosterDisplayName(owner: RosterOwnerForm): string {
  return ownerDisplayName(owner);
}

type OwnerRow = {
  name: string;
  email: string;
  share: number;
  ideal: number;
};

function toRows(
  owners: OwnershipTargetOwner[] | RosterOwnerForm[] | null | undefined
): OwnerRow[] {
  if (!owners?.length) return [];
  return owners.map((o) => {
    const share =
      typeof (o as OwnershipTargetOwner).ownership_share_percent === 'number'
        ? Number((o as OwnershipTargetOwner).ownership_share_percent)
        : Number((o as RosterOwnerForm).ownership_share_percent || 0);
    const ideal =
      typeof (o as OwnershipTargetOwner).ideal_parts_percent === 'number'
        ? Number((o as OwnershipTargetOwner).ideal_parts_percent)
        : Number((o as RosterOwnerForm).ideal_parts_percent || 0);
    return {
      name: ownerDisplayName(o as OwnershipTargetOwner),
      email: String(o.email ?? ''),
      share: Number.isFinite(share) ? share : 0,
      ideal: Number.isFinite(ideal) ? ideal : 0,
    };
  });
}

export function OwnershipProcessSteps({
  steps,
}: {
  steps: Array<{ title: string; text: string }>;
}) {
  return (
    <ol className="grid gap-2 sm:grid-cols-3">
      {steps.map((step, index) => (
        <li
          key={step.title}
          className="rounded-[14px] border border-border bg-surface px-3 py-3"
        >
          <div className="flex items-center gap-2">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-accent-bg text-xs font-semibold text-accent">
              {index + 1}
            </span>
            <span className="text-sm font-medium text-foreground">{step.title}</span>
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-secondary">{step.text}</p>
        </li>
      ))}
    </ol>
  );
}

export function OwnershipWizardSteps({
  steps,
  current,
}: {
  steps: string[];
  current: number;
}) {
  return (
    <div className="flex flex-wrap gap-2" aria-label="steps">
      {steps.map((label, index) => {
        const active = index === current;
        const done = index < current;
        return (
          <div
            key={label}
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium ${
              active
                ? 'border-accent/30 bg-accent-bg text-accent'
                : done
                  ? 'border-success/25 bg-success-bg text-success'
                  : 'border-border bg-surface-secondary text-muted'
            }`}
          >
            <span className="tabular-nums">{index + 1}</span>
            <span>{label}</span>
          </div>
        );
      })}
    </div>
  );
}

export function OwnershipHint({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-[14px] border border-accent/20 bg-accent-bg/60 px-3 py-2.5 text-xs leading-relaxed text-secondary">
      {children}
    </div>
  );
}

export function OwnershipCompare({
  beforeLabel,
  afterLabel,
  before,
  after,
  emptyBefore,
  emptyAfter,
  shareLabel,
  idealLabel,
}: {
  beforeLabel: string;
  afterLabel: string;
  before?: OwnershipTargetOwner[] | RosterOwnerForm[] | null;
  after?: OwnershipTargetOwner[] | RosterOwnerForm[] | null;
  emptyBefore: string;
  emptyAfter: string;
  shareLabel: string;
  idealLabel: string;
}) {
  const beforeRows = toRows(before);
  const afterRows = toRows(after);

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <CompareColumn
        label={beforeLabel}
        rows={beforeRows}
        empty={emptyBefore}
        shareLabel={shareLabel}
        idealLabel={idealLabel}
        tone="before"
      />
      <CompareColumn
        label={afterLabel}
        rows={afterRows}
        empty={emptyAfter}
        shareLabel={shareLabel}
        idealLabel={idealLabel}
        tone="after"
      />
    </div>
  );
}

function CompareColumn({
  label,
  rows,
  empty,
  shareLabel,
  idealLabel,
  tone,
}: {
  label: string;
  rows: OwnerRow[];
  empty: string;
  shareLabel: string;
  idealLabel: string;
  tone: 'before' | 'after';
}) {
  return (
    <div
      className={`rounded-[14px] border px-3 py-3 ${
        tone === 'after'
          ? 'border-accent/25 bg-accent-bg/40'
          : 'border-border bg-surface-secondary/50'
      }`}
    >
      <div className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</div>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-secondary">{empty}</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {rows.map((row) => (
            <li
              key={`${row.email}-${row.name}`}
              className="rounded-xl border border-border/70 bg-surface px-3 py-2"
            >
              <div className="text-sm font-medium text-foreground">{row.name}</div>
              <div className="truncate text-xs text-muted">{row.email}</div>
              <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-secondary">
                <span className="rounded-full border border-border bg-surface-secondary px-2 py-0.5">
                  {shareLabel}: {row.share.toFixed(2)}%
                </span>
                <span className="rounded-full border border-border bg-surface-secondary px-2 py-0.5">
                  {idealLabel}: {row.ideal.toFixed(3)}%
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function OwnershipTransferCard({
  title,
  subtitle,
  statusLabel,
  status,
  meta,
  note,
  rejectReason,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  statusLabel: string;
  status: string;
  meta?: ReactNode;
  note?: string | null;
  rejectReason?: string | null;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <article className="rounded-[16px] border border-border bg-surface p-4 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-foreground">{title}</div>
          {subtitle ? <p className="mt-1 text-sm text-secondary">{subtitle}</p> : null}
          {meta ? <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted">{meta}</div> : null}
          {note ? <p className="mt-2 text-sm text-secondary">{note}</p> : null}
          {rejectReason ? (
            <p className="mt-2 rounded-lg border border-danger/20 bg-danger-bg px-2.5 py-1.5 text-xs text-danger">
              {rejectReason}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <StatusBadge label={statusLabel} tone={transferStatusTone(status)} />
          {actions}
        </div>
      </div>
      {children}
    </article>
  );
}

export function OwnershipEmptyList({
  title,
  text,
}: {
  title: string;
  text?: string;
}) {
  return <EmptyState title={title} text={text} />;
}

export function OwnershipSuccessBanner({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-[14px] border border-success/25 bg-success-bg px-3 py-3 text-sm text-success">
      {children}
    </div>
  );
}

export function OwnershipWarningBanner({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-[14px] border border-warning/25 bg-warning-bg px-3 py-3 text-sm text-warning">
      {children}
    </div>
  );
}

export function OwnershipSectionCard({
  title,
  description,
  action,
  children,
  defaultOpen = false,
  open,
  onOpenChange,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children?: ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <details
      className="group rounded-[16px] border border-border bg-surface shadow-card open:pb-4"
      {...(typeof open === 'boolean'
        ? {
            open,
            onToggle: (e: SyntheticEvent<HTMLDetailsElement>) =>
              onOpenChange?.(e.currentTarget.open),
          }
        : defaultOpen
          ? { open: true }
          : {})}
    >
      <summary className="flex cursor-pointer list-none flex-wrap items-start justify-between gap-3 px-4 py-4 marker:content-none [&::-webkit-details-marker]:hidden">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-foreground">{title}</div>
          {description ? <p className="mt-1 text-xs text-secondary">{description}</p> : null}
        </div>
        <div className="flex items-center gap-2">
          {action}
          <span className="rounded-full border border-border bg-surface-secondary px-2.5 py-1 text-xs text-muted group-open:hidden">
            +
          </span>
          <span className="hidden rounded-full border border-border bg-surface-secondary px-2.5 py-1 text-xs text-muted group-open:inline">
            −
          </span>
        </div>
      </summary>
      {children ? <div className="space-y-3 px-4">{children}</div> : null}
    </details>
  );
}
