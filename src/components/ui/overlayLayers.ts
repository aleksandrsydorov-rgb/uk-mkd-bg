/**
 * Shared overlay stacking — keep numbers modest and ordered.
 *
 * Visual / interaction order:
 *   page + SectionPanelTabs
 *   → dimming + WorkplaceCardShell
 *   → nested AdminModal / AppConfirm
 *
 * Nav drawer sits below workplace overlays so an open card dims the whole
 * viewport (including sidebar) and blocks clicks/focus behind it.
 */
export const OVERLAY_LAYER = {
  /** Sticky chrome inside the work area (not a modal). */
  pageSticky: 10,
  /** Mobile sidebar scrim. */
  navScrim: 20,
  /** Sidebar drawer (mobile fixed / desktop flex item). */
  navDrawer: 25,
  /** Workplace card: dimming + shell. Stack as base + depth. */
  workplace: 40,
  /** Compact modal / confirm above workplace cards. */
  modal: 50,
} as const;

export type OverlayKind = 'workplace' | 'modal';

/** Open workplace card layers (topmost handles Escape / focus trap). */
export const workplaceLayerStack: symbol[] = [];

/** Open compact modal layers (topmost handles Escape / focus trap). */
export const modalLayerStack: symbol[] = [];

export function overlayZ(kind: OverlayKind, depth: number): number {
  const base = kind === 'workplace' ? OVERLAY_LAYER.workplace : OVERLAY_LAYER.modal;
  return base + Math.max(1, depth);
}

/**
 * True when this layer should receive Escape / focus-trap events.
 * Modal stack always wins over workplace so nested confirms work.
 */
export function isTopmostOverlay(kind: OverlayKind, layerId: symbol): boolean {
  if (modalLayerStack.length > 0) {
    return kind === 'modal' && modalLayerStack[modalLayerStack.length - 1] === layerId;
  }
  if (workplaceLayerStack.length > 0) {
    return kind === 'workplace' && workplaceLayerStack[workplaceLayerStack.length - 1] === layerId;
  }
  return false;
}

const INERT_SELECTOR =
  '[data-workplace-work-area="true"], [data-workplace-sidebar="true"]';

/** Mark page chrome inert while any overlay is open (blocks click + keyboard). */
export function syncBackgroundInert(): void {
  if (typeof document === 'undefined') return;
  const active = workplaceLayerStack.length > 0 || modalLayerStack.length > 0;
  document.querySelectorAll<HTMLElement>(INERT_SELECTOR).forEach((el) => {
    if (active) {
      el.setAttribute('inert', '');
      el.setAttribute('aria-hidden', 'true');
    } else {
      el.removeAttribute('inert');
      el.removeAttribute('aria-hidden');
    }
  });
}
