'use client';

import {
  useEffect,
  useId,
  useRef,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from 'react';
import type { LucideIcon } from 'lucide-react';

export type SectionPanelTabItem = {
  id: string;
  label: ReactNode;
  /** Compact outline icon (lucide). Decorative — label remains required. */
  icon?: LucideIcon;
  badge?: boolean;
  badgeLabel?: string;
  count?: number;
  disabled?: boolean;
  /** When set, renders a link (URL nav) instead of a tab button. */
  href?: string;
};

type Props = {
  items: SectionPanelTabItem[];
  value: string;
  onChange: (id: string) => void;
  /** Accessible name for the control. */
  'aria-label'?: string;
  className?: string;
};

const iconStroke = 1.75;
const iconClass = 'h-4 w-4 shrink-0';

/**
 * Unified section switcher — «Единая панель».
 * Use for horizontal section menus (settings hubs, workplace tabs, owner cabinets).
 * Not for action buttons, filters, sidebar, or wizard steps.
 */
export function SectionPanelTabs({
  items,
  value,
  onChange,
  'aria-label': ariaLabel,
  className = '',
}: Props) {
  const listId = useId();
  const activeRef = useRef<HTMLElement | null>(null);
  const useLinks = items.some((item) => Boolean(item.href));

  useEffect(() => {
    const el = activeRef.current;
    if (!el) return;
    el.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' });
  }, [value, items]);

  const enabledItems = items.filter((item) => !item.disabled);

  function move(fromId: string, delta: number) {
    if (enabledItems.length === 0) return;
    const i = enabledItems.findIndex((x) => x.id === fromId);
    const base = i < 0 ? 0 : i;
    const next = enabledItems[(base + delta + enabledItems.length) % enabledItems.length];
    if (!next) return;
    onChange(next.id);
  }

  function onKeyDown(e: KeyboardEvent, id: string) {
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      move(id, 1);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      move(id, -1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      if (enabledItems[0]) onChange(enabledItems[0].id);
    } else if (e.key === 'End') {
      e.preventDefault();
      const last = enabledItems[enabledItems.length - 1];
      if (last) onChange(last.id);
    }
  }

  const shellClass =
    `rounded-[14px] border border-border bg-surface p-1 shadow-[0_1px_0_rgba(15,23,42,0.03)] ${className}`.trim();

  const track = (
    <div className="flex min-w-min gap-0.5">
      {items.map((item) => {
        const selected = item.id === value;
        const Icon = item.icon;
        const labelText =
          typeof item.label === 'string' ? item.label : item.badgeLabel || item.id;
        const commonClass = [
          'inline-flex h-12 shrink-0 items-center gap-2 rounded-[10px] px-3.5 text-sm whitespace-nowrap',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-1',
          'transition-colors disabled:cursor-not-allowed disabled:opacity-45',
          selected
            ? 'bg-accent font-semibold text-white shadow-[0_1px_3px_rgba(62,98,113,0.35)]'
            : 'bg-transparent font-medium text-foreground hover:bg-accent-bg',
        ].join(' ');

        const content = (
          <>
            {Icon ? (
              <Icon
                aria-hidden
                className={iconClass}
                strokeWidth={iconStroke}
              />
            ) : null}
            <span>{item.label}</span>
            {typeof item.count === 'number' ? (
              <span
                className={`tabular-nums text-xs ${
                  selected ? 'text-white/85' : 'text-muted'
                }`}
              >
                {item.count}
              </span>
            ) : null}
            {item.badge ? (
              <span
                className={`inline-block h-1.5 w-1.5 rounded-full ${
                  selected ? 'bg-white' : 'bg-warning'
                }`}
                aria-hidden
              />
            ) : null}
          </>
        );

        if (useLinks && item.href) {
          return (
            <a
              key={item.id}
              ref={selected ? (activeRef as Ref<HTMLAnchorElement>) : undefined}
              href={item.disabled ? undefined : item.href}
              aria-current={selected ? 'page' : undefined}
              aria-disabled={item.disabled || undefined}
              aria-label={item.badgeLabel || labelText}
              tabIndex={item.disabled ? -1 : selected ? 0 : -1}
              onClick={(e) => {
                if (item.disabled) {
                  e.preventDefault();
                  return;
                }
                // Allow SPA handlers via onChange while keeping href for open-in-new / copy link.
                if (!e.metaKey && !e.ctrlKey && !e.shiftKey && e.button === 0) {
                  e.preventDefault();
                  onChange(item.id);
                }
              }}
              onKeyDown={(e) => onKeyDown(e, item.id)}
              className={commonClass}
            >
              {content}
            </a>
          );
        }

        return (
          <button
            key={item.id}
            ref={selected ? (activeRef as Ref<HTMLButtonElement>) : undefined}
            type="button"
            role="tab"
            id={`${listId}-tab-${item.id}`}
            aria-selected={selected}
            aria-controls={useLinks ? undefined : `${listId}-panel`}
            aria-label={item.badgeLabel || (typeof item.label === 'string' ? item.label : undefined)}
            disabled={item.disabled}
            tabIndex={selected ? 0 : -1}
            onClick={() => {
              if (!item.disabled) onChange(item.id);
            }}
            onKeyDown={(e) => onKeyDown(e, item.id)}
            className={commonClass}
          >
            {content}
          </button>
        );
      })}
    </div>
  );

  if (useLinks) {
    return (
      <nav aria-label={ariaLabel} className={`section-panel-tabs-scroll ${shellClass}`}>
        {track}
      </nav>
    );
  }

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={`section-panel-tabs-scroll ${shellClass}`}
    >
      {track}
    </div>
  );
}
