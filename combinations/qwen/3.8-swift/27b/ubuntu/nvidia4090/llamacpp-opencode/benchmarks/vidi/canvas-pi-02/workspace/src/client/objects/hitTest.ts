// Board object hit tests (story 10, board.click_arrow / conn.reattach):
// finding the topmost object under a world point. Rectangles use their
// world bbox; connectors (stored size 0) use distance-to-line with the
// screen-space tolerance (6px / zoom).

import { CONNECTOR_HIT_TOLERANCE_PX } from '../../shared/config';
import type { Point } from '../../shared/geometry';
import { distanceToPolyline } from '../../shared/geometry/polyline';
import { objectBounds, type ObjectSnapshot } from '../../shared/board-model';
import { connectorResolved } from '../../shared/objects/connector';
import * as Y from 'yjs';

/** True when `p` (world) is inside `obj`'s hit area. */
function hitsObject(doc: Y.Doc, o: ObjectSnapshot, p: Point, zoom: number): boolean {
  if (o.type === 'connector') {
    const line = connectorResolved(doc, o.id);
    if (line === null) return false;
    return distanceToPolyline([line.from, line.to], p) <= CONNECTOR_HIT_TOLERANCE_PX / zoom;
  }
  const b = objectBounds(o);
  return p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height;
}

/** The TOPMOST (highest z) object under a world point, or undefined. */
export function objectAtPoint(
  doc: Y.Doc,
  objects: readonly ObjectSnapshot[],
  p: Point,
  zoom: number,
): ObjectSnapshot | undefined {
  // `objects` is sorted ascending by z → iterate from the top.
  for (let i = objects.length - 1; i >= 0; i--) {
    if (hitsObject(doc, objects[i], p, zoom)) return objects[i];
  }
  return undefined;
}

/** The TOPMOST CONNECTOR under a world point (the board's empty-click
 *  arrow selection, board.click_arrow), or undefined. */
export function connectorAtPoint(
  doc: Y.Doc,
  objects: readonly ObjectSnapshot[],
  p: Point,
  zoom: number,
): ObjectSnapshot | undefined {
  for (let i = objects.length - 1; i >= 0; i--) {
    const o = objects[i];
    if (o.type !== 'connector') continue;
    if (hitsObject(doc, o, p, zoom)) return o;
  }
  return undefined;
}
