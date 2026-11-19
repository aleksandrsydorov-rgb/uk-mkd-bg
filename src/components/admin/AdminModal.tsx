'use client';

import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { createPortal } from 'react-dom';
import {
  adminModalHeaderClass,
  adminModalOverlayClass,
  adminModalPanelClass,
  adminBtnSecondaryClass,
} from '@/components/admin/AdminUi';
import { WorkplaceCardShell } from '@/components/ui/WorkplaceCardShell';
import {
  isTopmostOverlay,
  modalLayerStack,
  overlayZ,
  syncBackgroundInert,
  workplaceLayerStack,
} from '@/components/ui/overlayLayers';

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

type AdminModalProps = {
  open: boolean;
  title: string;
  /** Optional meta under the title (area, floor, badges). */
  titleMeta?: ReactNode;
  /** Actions in the header (e.g. Edit), left of the close button. */
  headerActions?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** Sticky strip under the title (e.g. in-modal tabs). */
  subheader?: ReactNode;
  /**
   * Panel size. Use `workplace` for large stable workplace cards (shared shell).
   * Keep md/lg/xl for compact dialogs; 2xl only when workplace geometry is not desired.
   */
  size?: 'md' | 'lg' | 'xl' | '2xl' | 'workplace';
  /** Stable entity key for workplace shell (avoids remount flicker across content swaps). */
  entityKey?: string | number;
  /** Optional element to restore focus to after close. */
  returnFocusRef?: React.RefObject<HTMLElement | null> | React.MutableRefObject<HTMLElement | null>;
  /** Called instead of onClose when Escape / overlay / X — parent may confirm. */
  onRequestClose?: () => void;
  closeLabel?: string;
};

const sizeClass: Record<Exclude<NonNullable<AdminModalProps['size']>, 'workplace'>, string> = {
  md: 'max-w-lg',
  lg: 'max-w-3xl',
  xl: 'max-w-5xl',
  '2xl': 'max-w-6xl md:w-[min(70vw,64rem)]',
};

/** Compact / confirm-style dialogs. Large workplace surfaces use WorkplaceCardShell. */
export function AdminModal({
  open,
  title,
  titleMeta,
  headerActions,
  onClose,
  children,
  footer,
  subheader,
  size = 'md',
  entityKey,
  returnFocusRef,
  onRequestClose,
  closeLabel = '×',
}: AdminModalProps) {
  if (size === 'workplace') {
    return (
      <WorkplaceCardShell
        open={open}
        title={title}
        titleMeta={titleMeta}
        headerActions={headerActions}
        subheader={subheader}
        footer={footer}
        onClose={onClose}
        onRequestClose={onRequestClose}
        closeLabel={closeLabel}
        returnFocusRef={returnFocusRef}
        entityKey={entityKey}
      >
        {children}
      </WorkplaceCardShell>
    );
  }

  return (
    <CompactAdminModal
      open={open}
      title={title}
      titleMeta={titleMeta}
      headerActions={headerActions}
      onClose={onClose}
      footer={footer}
      subheader={subheader}
      size={size}
      returnFocusRef={returnFocusRef}
      onRequestClose={onRequestClose}
      closeLabel={closeLabel}
    >
      {children}
    </CompactAdminModal>
  );
}

function CompactAdminModal({
  open,
  title,
  titleMeta,
  headerActions,
  onClose,
  children,
  footer,
  subheader,
  size = 'md',
  returnFocusRef,
  onRequestClose,
  closeLabel = '×',
}: Omit<AdminModalProps, 'size' | 'entityKey'> & {
  size: Exclude<NonNullable<AdminModalProps['size']>, 'workplace'>;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const [layerZ, setLayerZ] = useState(() => overlayZ('modal', 1));
  const [mounted, setMounted] = useState(false);
  const requestClose = onRequestClose ?? onClose;
  const requestCloseRef = useRef(requestClose);
  requestCloseRef.current = requestClose;

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const layerId = Symbol('admin-modal');
    modalLayerStack.push(layerId);
    setLayerZ(overlayZ('modal', modalLayerStack.length));
    syncBackgroundInert();

    previouslyFocused.current =
      returnFocusRef?.current ??
      (document.activeElement instanceof HTMLElement ? document.activeElement : null);

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const panel = panelRef.current;
    const focusFirst = () => {
      if (!panel) return;
      const nodes = panel.querySelectorAll<HTMLElement>(FOCUSABLE);
      const target = nodes[0] ?? panel;
      target.focus();
    };
    const t = window.setTimeout(focusFirst, 0);

    const onKeyDown = (e: KeyboardEvent) => {
      if (!isTopmostOverlay('modal', layerId)) return;
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
      const idx = modalLayerStack.indexOf(layerId);
      if (idx >= 0) modalLayerStack.splice(idx, 1);
      syncBackgroundInert();
      if (modalLayerStack.length === 0 && workplaceLayerStack.length === 0) {
        document.body.style.overflow = prevOverflow;
      } else {
        document.body.style.overflow = 'hidden';
      }
      const restore = returnFocusRef?.current ?? previouslyFocused.current;
      if (restore && typeof restore.focus === 'function') {
        window.setTimeout(() => restore.focus(), 0);
      }
    };
  }, [open, returnFocusRef]);

  if (!open || !mounted) return null;

  function onOverlayClick(e: ReactMouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) requestCloseRef.current();
  }

  return createPortal(
    <div
      className={`${adminModalOverlayClass} items-stretch justify-stretch p-0 md:items-center md:justify-center md:p-4`}
      style={{ zIndex: layerZ }}
      onClick={onOverlayClick}
      role="presentation"
      data-admin-modal-overlay="true"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`${adminModalPanelClass} ${sizeClass[size]} h-dvh max-h-dvh rounded-none md:h-auto md:max-h-[90vh] md:rounded-2xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={adminModalHeaderClass}>
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-semibold text-foreground md:text-lg">
              {title}
            </h2>
            {titleMeta ? <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">{titleMeta}</div> : null}
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            {headerActions}
            <button
              type="button"
              className={`${adminBtnSecondaryClass} shrink-0 px-2.5 py-1.5`}
              onClick={requestClose}
              aria-label={closeLabel}
            >
              ✕
            </button>
          </div>
        </div>
        {subheader ? (
          <div className="shrink-0 border-b border-border px-5 pb-3 pt-1">{subheader}</div>
        ) : null}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer ? (
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border px-5 py-3">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
