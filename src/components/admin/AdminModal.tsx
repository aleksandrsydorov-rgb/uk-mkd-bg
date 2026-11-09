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
  adminModalHeaderClass,
  adminModalOverlayClass,
  adminModalPanelClass,
  adminBtnSecondaryClass,
} from '@/components/admin/AdminUi';

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Open modal layers (topmost handles Escape / focus trap). */
const modalLayerStack: symbol[] = [];
const BASE_Z = 50;

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
  /** Wider panel for previews (default max-w-lg). 2xl ≈ 1152px. */
  size?: 'md' | 'lg' | 'xl' | '2xl';
  /** Optional element to restore focus to after close. */
  returnFocusRef?: React.RefObject<HTMLElement | null> | React.MutableRefObject<HTMLElement | null>;
  /** Called instead of onClose when Escape / overlay / X — parent may confirm. */
  onRequestClose?: () => void;
  closeLabel?: string;
};

const sizeClass: Record<NonNullable<AdminModalProps['size']>, string> = {
  md: 'max-w-lg',
  lg: 'max-w-3xl',
  xl: 'max-w-5xl',
  '2xl': 'max-w-6xl',
};

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
  returnFocusRef,
  onRequestClose,
  closeLabel = '×',
}: AdminModalProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const layerIdRef = useRef<symbol | null>(null);
  const [layerZ, setLayerZ] = useState(BASE_Z);
  const requestClose = onRequestClose ?? onClose;
  const requestCloseRef = useRef(requestClose);
  requestCloseRef.current = requestClose;

  useEffect(() => {
    if (!open) return;
    const layerId = Symbol('admin-modal');
    layerIdRef.current = layerId;
    modalLayerStack.push(layerId);
    setLayerZ(BASE_Z + modalLayerStack.length);

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

    const isTopLayer = () => modalLayerStack[modalLayerStack.length - 1] === layerId;

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
      const idx = modalLayerStack.indexOf(layerId);
      if (idx >= 0) modalLayerStack.splice(idx, 1);
      layerIdRef.current = null;
      document.body.style.overflow = modalLayerStack.length === 0 ? prevOverflow : 'hidden';
      const restore = returnFocusRef?.current ?? previouslyFocused.current;
      if (restore && typeof restore.focus === 'function') {
        window.setTimeout(() => restore.focus(), 0);
      }
    };
  }, [open, returnFocusRef]);

  if (!open) return null;

  function onOverlayClick(e: ReactMouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) requestCloseRef.current();
  }

  return (
    <div
      className={`${adminModalOverlayClass} items-stretch justify-stretch p-0 md:items-center md:justify-center md:p-4`}
      style={{ zIndex: layerZ }}
      onClick={onOverlayClick}
      role="presentation"
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
    </div>
  );
}
