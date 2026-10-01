import { objectBounds, type ObjectSnapshot } from '../../shared/board-model';
import type { Point, Rect } from '../../shared/geometry';

/** Rectangles of everything an arrow can attach to (every board object except arrows), in stacking order. */
export function attachableRects(snapshot: readonly ObjectSnapshot[]): Map<string, Rect> {
  const rects = new Map<string, Rect>();
  snapshot.forEach((o) => { if (o.type !== 'connector') rects.set(o.id, objectBounds(o)); });
  return rects;
}

/** Id of the top-most rectangle containing `p` (the map is in stacking order, last wins). */
export function topRectAt(rects: ReadonlyMap<string, Rect>, p: Point): string | undefined {
  let found: string | undefined;
  rects.forEach((r, id) => {
    if (p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height) found = id;
  });
  return found;
}
