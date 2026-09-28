/**
 * Shared helpers for positioning selection UI from the current selection.
 */
import { objectBounds, type ObjectSnapshot } from '../../shared/board-model';
import { unionRects, type Rect } from '../../shared/geometry';

/** Axis-aligned union of the selected objects' world bounds, or null. */
export function selectionBounds(
  ids: ReadonlySet<string>,
  snapshot: readonly ObjectSnapshot[],
): Rect | null {
  const rects: Rect[] = [];
  for (const obj of snapshot) {
    if (ids.has(obj.id)) rects.push(objectBounds(obj));
  }
  return unionRects(rects);
}
