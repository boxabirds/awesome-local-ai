/**
 * Story 10: connector endpoint geometry (connector.follow /
 * connector.create_attached / connector.target_deleted).
 *
 * Key decision: an attached endpoint stores NO side. The side is recomputed
 * from the live rectangles on every `resolveEndpoints` call, which is what
 * makes arrows switch to the nearer side as objects move (by anyone) and
 * follow remote moves without writes. `fallback` is the anchor point at
 * attach time, used only when the target vanished concurrently.
 *
 * Side anchors are the midpoints of the four sides — on the boundary of a
 * rect, an ellipse and a diamond alike. `nearestSide` compares the direction
 * vector (object centre → target point) against the rect's diagonals: the
 * switch happens exactly on the 45° diagonal (TC-10).
 *
 * Pure world-unit math — no doc, no DOM.
 */
import type { Point, Rect } from '../geometry';

export type Side = 'top' | 'right' | 'bottom' | 'left';

/** An endpoint as stored in the doc (see objects/connector.ts). */
export type Endpoint =
  | { kind: 'attached'; objectId: string; fallback: Point }
  | { kind: 'free'; x: number; y: number };

/** The midpoint of a rect's side (on its boundary). */
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
 * The side of `r` nearest to `toward`. The direction vector from the rect's
 * centre is compared with the rect's diagonals: `|vy|/|vx| < h/w` means the
 * direction is closer to the horizontal axis (switch exactly on the
 * diagonal).
 */
export function nearestSide(r: Rect, toward: Point): Side {
  const vx = toward.x - (r.x + r.width / 2);
  const vy = toward.y - (r.y + r.height / 2);
  const ax = Math.abs(vx);
  const ay = Math.abs(vy);
  if (ax * r.height >= ay * r.width) {
    return vx >= 0 ? 'right' : 'left';
  }
  return vy >= 0 ? 'bottom' : 'top';
}

/**
 * Resolves a connector's two endpoints to world points from the current
 * object rectangles (connector.follow):
 * - `free` → its stored point;
 * - `attached` target present → the side anchor on the target's side nearest
 *   the OTHER end;
 * - `attached` target missing (deleted concurrently) → its `fallback`
 *   (orphaned render condition, no throw).
 */
export function resolveEndpoints(
  c: { from: Endpoint; to: Endpoint },
  rects: ReadonlyMap<string, Rect>,
): { from: Point; to: Point } {
  // First pass: the anchor each end points toward = the other end's target
  // centre (or its free/fallback point).
  const anchorOf = (ep: Endpoint): Point => {
    if (ep.kind === 'free') return { x: ep.x, y: ep.y };
    const r = rects.get(ep.objectId);
    if (!r) return ep.fallback;
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  };
  const pointFor = (ep: Endpoint, toward: Point): Point => {
    if (ep.kind === 'free') return { x: ep.x, y: ep.y };
    const r = rects.get(ep.objectId);
    if (!r) return ep.fallback;
    return sideAnchor(r, nearestSide(r, toward));
  };
  const from = pointFor(c.from, anchorOf(c.to));
  const to = pointFor(c.to, anchorOf(c.from));
  return { from, to };
}

/** Smallest enclosing rect of two points (a zero-width/height box for an
 * axis-aligned line — fine: connectors are not resizable). */
export function connectorBBox(from: Point, to: Point): Rect {
  const x = Math.min(from.x, to.x);
  const y = Math.min(from.y, to.y);
  return { x, y, width: Math.abs(to.x - from.x), height: Math.abs(to.y - from.y) };
}

/**
 * Runtime validation of a stored endpoint (allObjects must not crash on a
 * malformed value). Returns null for anything not shaped like an endpoint.
 */
export function parseEndpoint(value: unknown): Endpoint | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (v.kind === 'free') {
    if (typeof v.x === 'number' && Number.isFinite(v.x) && typeof v.y === 'number' && Number.isFinite(v.y)) {
      return { kind: 'free', x: v.x, y: v.y };
    }
    return null;
  }
  if (v.kind === 'attached') {
    if (
      typeof v.objectId === 'string' &&
      v.objectId !== '' &&
      typeof v.fallback === 'object' &&
      v.fallback !== null
    ) {
      const fb = v.fallback as Record<string, unknown>;
      if (typeof fb.x === 'number' && Number.isFinite(fb.x) && typeof fb.y === 'number' && Number.isFinite(fb.y)) {
        return { kind: 'attached', objectId: v.objectId, fallback: { x: fb.x, y: fb.y } };
      }
    }
    return null;
  }
  return null;
}
