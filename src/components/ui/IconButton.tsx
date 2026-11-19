'use client';

import type { ButtonHTMLAttributes, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Tooltip } from '@/components/ui/Tooltip';

type Props = {
  icon: LucideIcon;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  busy?: boolean;
  className?: string;
  /** Extra content instead of Lucide icon (rare). */
  children?: ReactNode;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'aria-label' | 'title' | 'onClick'>;

/**
 * Compact icon control with ≥44×44 hit area, hover/focus ring, and Tooltip.
 * `label` is used for aria-label and tooltip (localized by the caller).
 */
export function IconButton({
  icon: Icon,
  label,
  onClick,
  disabled = false,
  busy = false,
  className = '',
  children,
  type = 'button',
  ...rest
}: Props) {
  const isDisabled = disabled || busy;
  return (
    <Tooltip content={label} disabled={isDisabled && !busy}>
      <button
        type={type}
        aria-label={label}
        aria-busy={busy || undefined}
        disabled={isDisabled}
        onClick={onClick}
        className={[
          'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg',
          'text-foreground transition-colors',
          'hover:bg-hover',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
          'disabled:cursor-not-allowed disabled:opacity-45',
          className,
        ].join(' ')}
        {...rest}
      >
        {children ?? <Icon className="h-5 w-5" strokeWidth={1.75} aria-hidden />}
      </button>
    </Tooltip>
  );
}
