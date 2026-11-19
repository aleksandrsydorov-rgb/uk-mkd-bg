'use client';

import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import {
  adminBtnSecondaryClass,
  adminModalHeaderClass,
} from '@/components/admin/AdminUi';

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Workplace cards sit below AppConfirmDialog / AdminModal (BASE_Z 50+).
 * A separate stack at 50 caused confirms to render under the card body — dirty cancel clicks missed.
 */
const workplaceLayerStack: symbol[] = [];
const BASE_Z = 40;

export type WorkplaceCardShellProps = {
  open: boolean;
  title: string;
  titleMeta?: ReactNode;
  headerActions?: ReactNode;
  /** Persistent tab strip / SectionPanelTabs — stays mounted across content changes. */
  subheader?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  onClose: () => void;
  /** Prefer this for dirty-guard; falls back to onClose. */
  onRequestClose?: () => void;
  closeLabel?: string;
  /** Optional restore focus target after close. */
  returnFocusRef?: React.RefObject<HTMLElement | null> | React.MutableRefObject<HTMLElement | null>;
  /** Stable key for the workplace entity (e.g. property id) — does not remount on tab. */
  entityKey?: string | number;
  /** Optional ref to the scrollable body (tab scroll restore). */
  bodyRef?: React.RefObject<HTMLDivElement | null> | React.MutableRefObject<HTMLDivElement | null>;
  className?: string;
};

/**
 * Large workplace card — fixed shell size, internal scroll only.
 * Desktop ≈ 70% width × 82% height, centered. Tablet/phone use near-full viewport with safe-area.
 * Tab/content swaps must not change shell geometry or replay open animation.
 */
export function WorkplaceCardShell({
  open,
  title,
  titleMeta,
  headerActions,
  subheader,
  footer,
  children,
  onClose,
  onRequestClose,
  closeLabel = '×',
  returnFocusRef,
  entityKey,
  bodyRef: bodyRefProp,
  className = '',
}: WorkplaceCardShellProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const bodyRefInner = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const [layerZ, setLayerZ] = useState(BASE_Z);
  const requestClose = onRequestClose ?? onClose;
  const requestCloseRef = useRef(requestClose);
  requestCloseRef.current = requestClose;

  useEffect(() => {
    if (!open) return;
    const layerId = Symbol('workplace-card');
    workplaceLayerStack.push(layerId);
    setLayerZ(BASE_Z + workplaceLayerStack.length);

    previouslyFocused.current =
      returnFocusRef?.current ??
      (document.activeElement instanceof HTMLElement ? document.activeElement : null);

    const prevOverflow = document.body.style.overflow;
    const prevPaddingRight = document.body.style.paddingRight;
    const scrollbar = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = 'hidden';
    if (scrollbar > 0) document.body.style.paddingRight = `${scrollbar}px`;

    const panel = panelRef.current;
    const t = window.setTimeout(() => {
      if (!panel) return;
      const nodes = panel.querySelectorAll<HTMLElement>(FOCUSABLE);
      (nodes[0] ?? panel).focus();
    }, 0);

    const isTopLayer = () => workplaceLayerStack[workplaceLayerStack.length - 1] === layerId;

    const onKeyDown = (e: KeyboardEvent) => {
      if (!isTopLayer()) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        requestCloseRef.current();
        return;
      }
      if (e.key !== 'Tab' || !panel) return;
      const nodes = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => !el.hasAttribute('disabled') && el.tabIndex !== -1,
      );
      if (nodes.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (active === first || !panel.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener('keydown', onKeyDown, true);
      const idx = workplaceLayerStack.indexOf(layerId);
      if (idx >= 0) workplaceLayerStack.splice(idx, 1);
      if (workplaceLayerStack.length === 0) {
        document.body.style.overflow = prevOverflow;
        document.body.style.paddingRight = prevPaddingRight;
      }
      const restore = returnFocusRef?.current ?? previouslyFocused.current;
      if (restore && typeof restore.focus === 'function') {
        window.setTimeout(() => restore.focus(), 0);
      }
    };
  }, [open, returnFocusRef]);

  // Reset body scroll only when the workplace entity changes — not on tab switches.
  useEffect(() => {
    const el = bodyRefProp?.current ?? bodyRefInner.current;
    if (!open || el == null) return;
    el.scrollTop = 0;
  }, [open, entityKey, bodyRefProp]);

  if (!open) return null;

  function onOverlayClick(e: ReactMouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) requestCloseRef.current();
  }

  return (
    <div
      className="fixed inset-0 flex items-stretch justify-stretch bg-[rgba(20,25,30,0.28)] p-0 sm:items-center sm:justify-center sm:p-3 md:p-5"
      style={{ zIndex: layerZ }}
      onClick={onOverlayClick}
      role="presentation"
      data-workplace-overlay="true"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-workplace-shell="true"
        data-entity-key={entityKey != null ? String(entityKey) : undefined}
        className={[
          'flex w-full flex-col overflow-hidden border border-border bg-surface shadow-[0_8px_28px_rgba(15,23,42,0.12)]',
          // Phone: full viewport + safe area. Tablet/desktop: stable fraction of viewport.
          'h-[100dvh] max-h-[100dvh] rounded-none',
          'pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]',
          'sm:h-[min(90dvh,calc(100dvh-1.5rem))] sm:max-h-[min(90dvh,calc(100dvh-1.5rem))] sm:w-[min(94vw,56rem)] sm:rounded-2xl',
          'md:h-[min(82dvh,calc(100dvh-2.5rem))] md:max-h-[min(82dvh,calc(100dvh-2.5rem))] md:w-[min(70vw,64rem)]',
          className,
        ].join(' ')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={adminModalHeaderClass}>
          <div className="min-w-0">
            <h2 id={titleId} className="break-words text-base font-semibold text-foreground md:text-lg">
              {title}
            </h2>
            {titleMeta ? (
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">{titleMeta}</div>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            {headerActions}
            <button
              type="button"
              className={`${adminBtnSecondaryClass} shrink-0 px-2.5 py-1.5`}
              onClick={() => requestCloseRef.current()}
              aria-label={closeLabel}
              data-workplace-close="true"
            >
              ✕
            </button>
          </div>
        </div>
        {subheader ? (
          <div className="shrink-0 border-b border-border px-4 pb-3 pt-1 md:px-5">{subheader}</div>
        ) : null}
        <div
          ref={(node) => {
            bodyRefInner.current = node;
            if (bodyRefProp) bodyRefProp.current = node;
          }}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 md:px-5"
          data-workplace-body="true"
        >
          {children}
        </div>
        {footer ? (
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3 md:px-5">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
