// Pure connector geometry (see spec: connector.model — geometry half).
//
// No DOM, no React, no Yjs: everything operates on plain rects/points so
// both the document model (snapshot) and the renderer (ConnectorObject)
// resolve the same anchors from the same live rectangles.
//
// Key decision: an attached endpoint stores no side. The side is recomputed
// from current rectangles on every resolve (nearestSide), which is what makes
// arrows switch sides as objects move and follow remote moves without writes.
// `fallback` is the anchor at attach time, used only when the target vanished
// concurrently (connector.target_deleted race).

import type { Point, Rect } from '../geometry';

/** Where a connector meets one of its (possibly absent) objects. */
export type Endpoint =
  | { kind: 'attached'; objectId: string; fallback: Point }
  | { kind: 'free'; x: number; y: number };

/** The four sides of an object's bounding rect. */
export type Side = 'top' | 'right' | 'bottom' | 'left';

/** The two resolved anchor points of a connector. */
export interface ResolvedEndpoints {
  from: Point;
  to: Point;
}

/** A connector-shaped value (the two endpoints; enough to resolve). */
export interface ConnectorShape {
  from: Endpoint;
  to: Endpoint;
}

function finitePoint(p: Point): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y);
}

/** The midpoint of `side` of `rect` (on the boundary of rect, ellipse, diamond). */
export function sideAnchor(r: Rect, s: Side): Point {
  switch (s) {
    case 'top':
      return { x: r.x + r.width / 2, y: r.y };
    case 'right':
      return { x: r.x + r.width, y: r.y + r.height / 2 };
    case 'bottom':
      return { x: r.x + r.width / 2, y: r.y + r.height };
    case 'left':
      return { x: r.x, y: r.y + r.height / 2 };
  }
}

/**
 * The side of `rect` whose midpoint is nearest to `toward`: the direction
 * from the rect centre is compared with the rect's diagonals. The horizontal
 * side wins exactly on the diagonal (|dx| * h == |dy| * w), so a point on
 * the diagonal resolves to 'right'/'left' (the horizontal pair).
 */
export function nearestSide(r: Rect, toward: Point): Side {
  const dx = toward.x - (r.x + r.width / 2);
  const dy = toward.y - (r.y + r.height / 2);
  if (Math.abs(dx) * r.height >= Math.abs(dy) * r.width) {
    return dx >= 0 ? 'right' : 'left';
  }
  return dy >= 0 ? 'bottom' : 'top';
}

/** The anchor point an endpoint resolves to: its stored point when free;
 *  the fallback when the target object is absent (orphaned); the nearest
 *  side midpoint toward the other end's anchor when present. */
function endpointPoint(e: Endpoint, rects: ReadonlyMap<string, Rect>, other: Point): Point {
  if (e.kind === 'free') return { x: e.x, y: e.y };
  const rect = rects.get(e.objectId);
  if (rect === undefined) return { x: e.fallback.x, y: e.fallback.y };
  return sideAnchor(rect, nearestSide(rect, other));
}

/** A non-attached (or orphaned) endpoint's anchor for "toward" purposes. */
function endAnchorPoint(e: Endpoint, rects: ReadonlyMap<string, Rect>): Point {
  if (e.kind === 'free') return { x: e.x, y: e.y };
  const rect = rects.get(e.objectId);
  if (rect === undefined) return { x: e.fallback.x, y: e.fallback.y };
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/**
 * The anchor a target rect presents to `other`: its nearest side midpoint
 * (toward the other end's anchor point). `fallback` is used when the target
 * rect is absent (e.g. it was deleted in the same transaction).
 */
export function endpointAnchorFor(
  rect: Rect | undefined,
  other: Endpoint,
  rects: ReadonlyMap<string, Rect>,
  fallback: Point,
): Point {
  if (rect === undefined) return { x: fallback.x, y: fallback.y };
  return sideAnchor(rect, nearestSide(rect, endAnchorPoint(other, rects)));
}

/**
 * Resolve both endpoints to anchor points from the current object rects.
 * A missing target renders at its stored fallback (orphaned); no writes.
 */
export function resolveEndpoints(c: ConnectorShape, rects: ReadonlyMap<string, Rect>): ResolvedEndpoints {
  const toAnchor = endAnchorPoint(c.to, rects);
  const fromAnchor = endAnchorPoint(c.from, rects);
  return {
    from: endpointPoint(c.from, rects, toAnchor),
    to: endpointPoint(c.to, rects, fromAnchor),
  };
}

/** The axis-aligned rect spanning the two anchor points. */
export function connectorBBox(from: Point, to: Point): Rect {
  return {
    x: Math.min(from.x, to.x),
    y: Math.min(from.y, to.y),
    width: Math.abs(from.x - to.x),
    height: Math.abs(from.y - to.y),
  };
}

/** Validate a stored (decoded) endpoint value; null when malformed. */
export function parseEndpoint(v: unknown): Endpoint | null {
  if (v === null || typeof v !== 'object') return null;
  const e = v as Record<string, unknown>;
  if (e.kind === 'attached') {
    const objectId = e.objectId;
    const fallback = e.fallback;
    if (typeof objectId !== 'string') return null;
    if (fallback === null || typeof fallback !== 'object') return null;
    const f = fallback as Point;
    if (!finitePoint(f)) return null;
    return { kind: 'attached', objectId, fallback: { x: f.x, y: f.y } };
  }
  if (e.kind === 'free') {
    if (typeof e.x !== 'number' || typeof e.y !== 'number') return null;
    if (!Number.isFinite(e.x) || !Number.isFinite(e.y)) return null;
    return { kind: 'free', x: e.x, y: e.y };
  }
  return null;
}

/** True for a well-formed endpoint value. */
export function isEndpoint(v: unknown): v is Endpoint {
  return parseEndpoint(v) !== null;
}
