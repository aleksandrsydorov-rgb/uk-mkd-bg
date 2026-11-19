'use client';

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { OVERLAY_LAYER } from '@/components/ui/overlayLayers';

type Placement = 'top' | 'bottom';

/**
 * Accessible tooltip — portals above overlays so table overflow cannot clip it.
 * Shows on hover and keyboard focus; on touch, press reveals it (no hover needed).
 * Does not use the native HTML `title` attribute.
 */
export function Tooltip({
  content,
  children,
  placement = 'top',
  disabled = false,
}: {
  content: string;
  children: ReactNode;
  placement?: Placement;
  disabled?: boolean;
}) {
  const tipId = useId();
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);

  const clearHide = useCallback(() => {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  }, []);

  const show = useCallback(() => {
    if (disabled || !content.trim()) return;
    clearHide();
    setOpen(true);
  }, [clearHide, content, disabled]);

  const hide = useCallback(() => {
    clearHide();
    setOpen(false);
  }, [clearHide]);

  const scheduleHide = useCallback(
    (ms = 120) => {
      clearHide();
      hideTimer.current = setTimeout(() => setOpen(false), ms);
    },
    [clearHide],
  );

  const updatePosition = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const gap = 8;
    const tipH = tipRef.current?.offsetHeight ?? 28;
    const tipW = tipRef.current?.offsetWidth ?? 120;
    let top = placement === 'bottom' ? r.bottom + gap : r.top - tipH - gap;
    let left = r.left + r.width / 2 - tipW / 2;
    const pad = 8;
    left = Math.max(pad, Math.min(left, window.innerWidth - tipW - pad));
    top = Math.max(pad, Math.min(top, window.innerHeight - tipH - pad));
    setCoords({ top, left });
  }, [placement]);

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
  }, [open, content, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const onScroll = () => updatePosition();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hide();
    };
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      if (anchorRef.current?.contains(t) || tipRef.current?.contains(t)) return;
      hide();
    };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [open, hide, updatePosition]);

  useEffect(() => () => clearHide(), [clearHide]);

  function onPointerEnter(e: ReactPointerEvent) {
    if (e.pointerType === 'touch') return;
    show();
  }

  function onPointerLeave(e: ReactPointerEvent) {
    if (e.pointerType === 'touch') return;
    scheduleHide();
  }

  function onFocus() {
    show();
  }

  function onBlur() {
    scheduleHide(150);
  }

  function onPointerDown(e: ReactPointerEvent) {
    if (e.pointerType !== 'touch') return;
    // Touch path without hover: reveal label while pressing / shortly after.
    show();
  }

  function onPointerUp(e: ReactPointerEvent) {
    if (e.pointerType !== 'touch') return;
    scheduleHide(2000);
  }

  const tooltip =
    open && coords && typeof document !== 'undefined'
      ? createPortal(
          <div
            ref={tipRef}
            id={tipId}
            role="tooltip"
            className="pointer-events-none max-w-[16rem] rounded-md bg-foreground px-2 py-1 text-xs font-medium text-background shadow-md"
            style={{
              position: 'fixed',
              top: coords.top,
              left: coords.left,
              zIndex: OVERLAY_LAYER.modal + 20,
            }}
          >
            {content}
          </div>,
          document.body,
        )
      : null;

  return (
    <span
      ref={anchorRef}
      className="inline-flex"
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onFocus={onFocus}
      onBlur={onBlur}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <span className="inline-flex" aria-describedby={open ? tipId : undefined}>
        {children}
      </span>
      {tooltip}
    </span>
  );
}
