import { describe, expect, it } from 'vitest';
import {
  isTopmostOverlay,
  modalLayerStack,
  overlayZ,
  OVERLAY_LAYER,
  workplaceLayerStack,
} from '@/components/ui/overlayLayers';

describe('overlayLayers', () => {
  it('keeps workplace below modal and nav below workplace', () => {
    expect(OVERLAY_LAYER.navScrim).toBeLessThan(OVERLAY_LAYER.navDrawer);
    expect(OVERLAY_LAYER.navDrawer).toBeLessThan(OVERLAY_LAYER.workplace);
    expect(OVERLAY_LAYER.workplace).toBeLessThan(OVERLAY_LAYER.modal);
    expect(overlayZ('workplace', 1)).toBe(OVERLAY_LAYER.workplace + 1);
    expect(overlayZ('modal', 1)).toBe(OVERLAY_LAYER.modal + 1);
    expect(overlayZ('workplace', 3)).toBeLessThan(overlayZ('modal', 1));
  });

  it('gives Escape priority to nested modal over workplace card', () => {
    workplaceLayerStack.length = 0;
    modalLayerStack.length = 0;
    const card = Symbol('card');
    const confirm = Symbol('confirm');
    workplaceLayerStack.push(card);
    expect(isTopmostOverlay('workplace', card)).toBe(true);
    modalLayerStack.push(confirm);
    expect(isTopmostOverlay('workplace', card)).toBe(false);
    expect(isTopmostOverlay('modal', confirm)).toBe(true);
    modalLayerStack.pop();
    expect(isTopmostOverlay('workplace', card)).toBe(true);
    workplaceLayerStack.pop();
  });
});
