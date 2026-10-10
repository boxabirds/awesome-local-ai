// Pure geometry for connectors: side anchors, nearest-side selection,
// endpoint resolution and bounding boxes. No board-model imports; the
// Endpoint shape lives here so both the model layer and the snapshot reader
// can depend on it without an import cycle. Framework-free (the Durable
// Object may reach it through the board model).

import type { Point, Rect } from '../geometry';

export type Side = 'top' | 'right' | 'bottom' | 'left';

// An end either follows an object (recomputed from its current rect every
// render) or is pinned to a board point. `fallback` is the anchor captured at
// attach time and used only when the target is concurrently gone (orphaned).
export type Endpoint =
  | { kind: 'attached'; objectId: string; fallback: Point }
  | { kind: 'free'; x: number; y: number };

export function sideAnchor(r: Rect, s: Side): Point {
  switch (s) {
    case 'top':
      return { x: r.x + r.width / 2, y: r.y };
    case 'bottom':
      return { x: r.x + r.width / 2, y: r.y + r.height };
    case 'left':
      return { x: r.x, y: r.y + r.height / 2 };
    case 'right':
      return { x: r.x + r.width, y: r.y + r.height / 2 };
  }
}

// Which side a connector should leave `r` toward `toward`. The direction from
// the rect centre is split by the diagonals (|dx| == |dy|): the dominant axis
// decides left/right vs top/bottom, matching the boundary of rect, ellipse and
// diamond at their side midpoints. Screen orientation: negative y is "top".
export function nearestSide(r: Rect, toward: Point): Side {
  const dx = toward.x - (r.x + r.width / 2);
  const dy = toward.y - (r.y + r.height / 2);
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left';
  return dy >= 0 ? 'bottom' : 'top';
}

function rectCenter(r: Rect): Point {
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

// The point the *other* end aims at: the centre of its object when attached and
// present, else the stored fallback / free point.
export function aimReference(e: Endpoint, rects: ReadonlyMap<string, Rect>): Point {
  if (e.kind === 'free') return { x: e.x, y: e.y };
  const r = rects.get(e.objectId);
  return r ? rectCenter(r) : e.fallback;
}

function resolveOne(
  e: Endpoint,
  rects: ReadonlyMap<string, Rect>,
  aim: Point,
): Point {
  if (e.kind === 'free') return { x: e.x, y: e.y };
  const r = rects.get(e.objectId);
  if (!r) return e.fallback; // orphaned: target absent, draw at fallback
  return sideAnchor(r, nearestSide(r, aim));
}

// Resolves both ends from the current rect map. Attached ends have no stored
// side: it is recomputed here every call, which is what lets arrows switch
// sides and follow moves (local or remote) with no writes.
export function resolveEndpoints(
  c: { from: Endpoint; to: Endpoint },
  rects: ReadonlyMap<string, Rect>,
): { from: Point; to: Point } {
  return {
    from: resolveOne(c.from, rects, aimReference(c.to, rects)),
    to: resolveOne(c.to, rects, aimReference(c.from, rects)),
  };
}

// Axis-aligned box spanned by the two resolved points; degenerate edges are
// allowed (a zero-length box is fine for a selection bounds).
export function connectorBBox(from: Point, to: Point): Rect {
  const x = Math.min(from.x, to.x);
  const y = Math.min(from.y, to.y);
  return { x, y, width: Math.abs(from.x - to.x), height: Math.abs(from.y - to.y) };
}
