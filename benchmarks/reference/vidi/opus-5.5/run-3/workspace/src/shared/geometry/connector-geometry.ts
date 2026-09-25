// Pure geometry for connectors (story 10): side anchors, nearest-side choice and endpoint resolution.
// World units throughout; no DOM or Yjs.
import type { Point, Rect } from '../geometry';
import type { ConnectorSnap, Endpoint } from '../objects/connector';

export type Side = 'top' | 'right' | 'bottom' | 'left';
export const SIDES: readonly Side[] = ['top', 'right', 'bottom', 'left'];

/** The midpoint of side `s` of `r`. It lies on the outline of a rectangle, ellipse and diamond drawn in `r` alike. */
export function sideAnchor(r: Rect, s: Side): Point {
  const cx = r.x + r.width / 2;
  const cy = r.y + r.height / 2;
  switch (s) {
    case 'top':
      return { x: cx, y: r.y };
    case 'bottom':
      return { x: cx, y: r.y + r.height };
    case 'left':
      return { x: r.x, y: cy };
    case 'right':
      return { x: r.x + r.width, y: cy };
  }
}

export function rectCentre(r: Rect): Point {
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

/**
 * The side of `r` facing `toward`: the direction from the centre is compared with the rect's diagonals, so the
 * choice switches exactly on a diagonal (on the diagonal itself the horizontal side wins). `toward` at the
 * centre gives 'right'.
 */
export function nearestSide(r: Rect, toward: Point): Side {
  const c = rectCentre(r);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (Math.abs(dx) * r.height >= Math.abs(dy) * r.width) return dx >= 0 ? 'right' : 'left';
  return dy >= 0 ? 'bottom' : 'top';
}

/** Where an end points from when the other end looks at it: an object's centre, else the stored point. */
function referencePoint(e: Endpoint, rects: ReadonlyMap<string, Rect>): Point {
  if (e.kind === 'free') return { x: e.x, y: e.y };
  const r = rects.get(e.objectId);
  return r ? rectCentre(r) : e.fallback;
}

/** An end's point given where the other end is: the facing side's midpoint, the fallback if its object is gone. */
export function resolveEndpoint(e: Endpoint, other: Point, rects: ReadonlyMap<string, Rect>): Point {
  if (e.kind === 'free') return { x: e.x, y: e.y };
  const r = rects.get(e.objectId);
  return r ? sideAnchor(r, nearestSide(r, other)) : e.fallback;
}

/**
 * Both ends of a connector from the objects' current rects. Recomputed on every snapshot, so the ends follow
 * moves and resizes by anyone and switch sides as objects pass each other. A missing object (deleted
 * concurrently) gives its end's fallback; nothing here throws.
 */
export function resolveEndpoints(
  c: Pick<ConnectorSnap, 'from' | 'to'>,
  rects: ReadonlyMap<string, Rect>,
): { from: Point; to: Point } {
  const fromRef = referencePoint(c.from, rects);
  const toRef = referencePoint(c.to, rects);
  return { from: resolveEndpoint(c.from, toRef, rects), to: resolveEndpoint(c.to, fromRef, rects) };
}

/** The rect spanned by a connector's two ends (width or height may be 0). */
export function connectorBBox(from: Point, to: Point): Rect {
  return {
    x: Math.min(from.x, to.x),
    y: Math.min(from.y, to.y),
    width: Math.abs(to.x - from.x),
    height: Math.abs(to.y - from.y),
  };
}
