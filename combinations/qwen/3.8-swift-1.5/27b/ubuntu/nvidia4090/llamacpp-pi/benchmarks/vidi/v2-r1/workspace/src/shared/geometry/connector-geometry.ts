/**
 * Story 10: pure geometry for connector arrows.
 * All values are in world units.
 */
import type { Point, Rect } from '../geometry';

export type Side = 'top' | 'right' | 'bottom' | 'left';

/**
 * The midpoint of a side of a rect (or the inscribed boundary point for
 * ellipse/diamond — same midpoint on the bounding box).
 */
export function sideAnchor(r: Rect, s: Side): Point {
  switch (s) {
    case 'top': return { x: r.x + r.width / 2, y: r.y };
    case 'right': return { x: r.x + r.width, y: r.y + r.height / 2 };
    case 'bottom': return { x: r.x + r.width / 2, y: r.y + r.height };
    case 'left': return { x: r.x, y: r.y + r.height / 2 };
  }
}

/**
 * Determine which side of rect `r` is nearest to point `toward`.
 *
 * The side is determined by the direction from the rect centre to `toward`:
 * - If the direction is more horizontal than vertical (|dx| >= |dy|), the
 *   side is right or left.
 * - Otherwise the side is top or bottom.
 *
 * This creates a 45° diagonal switch (TC-10: at 44° → right, at 46° → top).
 */
export function nearestSide(r: Rect, toward: Point): Side {
  const cx = r.x + r.width / 2;
  const cy = r.y + r.height / 2;
  const dx = toward.x - cx;
  const dy = toward.y - cy;

  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? 'right' : 'left';
  } else {
    return dy >= 0 ? 'bottom' : 'top';
  }
}
