import { useCallback } from 'react';
import type { Point } from '@/client/canvas/camera';
import type { ObjectSnapshot } from '@/client/objects/registry';
import { rectContains, unionRects } from '@/shared/geometry';
import { STICKY_SIZE_WORLD, STICKY_COLORS, DEFAULT_STICKY_COLOR } from '@/shared/config';
import type { StickySnapshot } from '@/shared/board-model';

/** Check whether the given DOM target is a sticky note child element (not empty board space). */
export function isTargetOnChild(
  e: React.PointerEvent | React.MouseEvent,
  target: EventTarget,
): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const worldLayer = document.querySelector('[data-layer="world"]');
  return worldLayer?.contains(target) ?? false;
}

/** Get sticky snapshot from object data for use in UI. */
export function toStickySnap(obj: unknown): StickySnapshot {
  return obj as StickySnapshot;
}
