// Connector geometry (story 10, design section 3): pure world-unit functions,
// no Yjs, no DOM, no client state — so every case is unit-testable.
//
// The rule they carry: an attached end does NOT remember where it was placed.
// It remembers WHICH object it is attached to, and the point is recomputed from
// the object's CURRENT rectangle on every call, which is what makes an arrow
// follow a shape it is attached to when that shape moves.
import type { Point, Rect } from '../geometry.ts';

/** The side of a rectangle an arrow may leave from. */
export type Side = 'top' | 'right' | 'bottom' | 'left';

export const SIDES: readonly Side[] = ['top', 'right', 'bottom', 'left'];

/**
 * One end of a connector, as it is STORED in the doc: either attached to an
 * object (with the position the arrow falls back to when that object is gone),
 * or free at a world point.
 */
export type Endpoint =
  | { readonly kind: 'attached'; readonly objectId: string; readonly fallback: Point }
  | { readonly kind: 'free'; readonly x: number; readonly y: number };

/** Anything that carries the two ends — `ConnectorSnapshot` satisfies it. */
export interface ConnectorEnds {
  readonly from: Endpoint;
  readonly to: Endpoint;
}

/** A resolved pair of end points. */
export interface ConnectorPoints {
  readonly from: Point;
  readonly to: Point;
}

/**
 * Is `v` a storable endpoint? An attached end needs a non-empty object id and a
 * finite fallback point; a free end needs finite coordinates. Anything else -
 * an unknown kind, a NaN, a string - is refused, so a malformed connector is
 * invisible rather than a NaN on the board.
 */
export function isEndpoint(v: unknown): v is Endpoint {
  if (!v || typeof v !== 'object') return false;
  const e = v as { kind?: unknown; objectId?: unknown; fallback?: unknown; x?: unknown; y?: unknown };
  if (e.kind === 'attached') {
    return typeof e.objectId === 'string' && e.objectId !== '' && isPoint(e.fallback);
  }
  if (e.kind === 'free') {
    return Number.isFinite(e.x) && Number.isFinite(e.y);
  }
  return false;
}

/** The rect an attached end points at; undefined for a free end or a miss. */
export function rectOfEnd(e: Endpoint, rects: ReadonlyMap<string, Rect>): Rect | undefined {
  return e.kind === 'attached' ? rects.get(e.objectId) : undefined;
}

/**
 * The point an end is aimed at: the CENTRE of the object it is attached to when
 * that object is present (so both sides of a pair of anchors are decided by live
 * geometry), otherwise its own point or its fallback.
 */
export function referencePoint(e: Endpoint, rects: ReadonlyMap<string, Rect>): Point {
  const rect = rectOfEnd(e, rects);
  if (!rect || !isRect(rect)) return e.kind === 'free' ? { x: e.x, y: e.y } : e.fallback;
  return rectCentre(rect);
}

/** The point where the centre line touches `s`. */
export function sideAnchor(rect: Rect, s: Side): Point {
  switch (s) {
    case 'top':
      return { x: rect.x + rect.width / 2, y: rect.y };
    case 'right':
      return { x: rect.x + rect.width, y: rect.y + rect.height / 2 };
    case 'bottom':
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height };
    case 'left':
      return { x: rect.x, y: rect.y + rect.height / 2 };
    default:
      return { x: Number.NaN, y: Number.NaN };
  }
}

/** The centre of a rectangle. */
export function rectCentre(rect: Rect): Point {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/**
 * The side of `rect` nearest `toward`: the direction from the rect's centre to
 * the point is compared against the rect's own diagonals, so a square splits at
 * 45 degrees and a wide rectangle splits shallower. Ties (an exact diagonal, or
 * the point sitting on the centre) resolve to the horizontal side, so the
 * result is always defined and always one of the four sides.
 */
export function nearestSide(rect: Rect, toward: Point): Side {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const dx = toward.x - cx;
  const dy = toward.y - cy;
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return 'right';
  if (dx === 0 && dy === 0) return 'right';
  // Vertical when the direction is steeper than the rect's diagonal.
  const vertical = Math.abs(dy) * Math.max(0, rect.width) > Math.abs(dx) * Math.max(0, rect.height);
  if (vertical) return dy < 0 ? 'top' : 'bottom';
  return dx < 0 ? 'left' : 'right';
}

/** Where an end sits: the anchor on its object's side, or its own point. */
function anchorFor(end: Endpoint, rects: ReadonlyMap<string, Rect>, toward: Point): Point {
  if (end.kind === 'free') return { x: end.x, y: end.y };
  const rect = rects.get(end.objectId);
  if (!rect || !isRect(rect)) return end.fallback ?? { x: 0, y: 0 }; // detached / unknown
  return sideAnchor(rect, nearestSide(rect, toward));
}

/** The other end's reference point: a live object's CENTRE, else its point. */
function referenceFor(end: Endpoint, rects: ReadonlyMap<string, Rect>): Point {
  if (end.kind === 'free') return { x: end.x, y: end.y };
  const rect = rects.get(end.objectId);
  if (!rect || !isRect(rect)) return end.fallback ?? { x: 0, y: 0 };
  return rectCentre(rect);
}

/**
 * Resolve both ends against live rectangles. Each side is decided by the
 * OTHER end's live centre, so the two sides are symmetric and both flip the
 * moment an object is dragged past the other's diagonal. An end whose object is
 * absent from `rects` resolves to its fallback point — a detached arrow keeps
 * its end exactly where the object was, and the caller cannot tell a fallback
 * from an anchor because the two are the same point while the object is there.
 */
export function resolveEndpoints(c: ConnectorEnds, rects: ReadonlyMap<string, Rect>): ConnectorPoints {
  const fromRef = referenceFor(c.from, rects);
  const toRef = referenceFor(c.to, rects);
  return { from: anchorFor(c.from, rects, toRef), to: anchorFor(c.to, rects, fromRef) };
}

/**
 * The axis-aligned box spanned by the resolved points. A perfectly horizontal
 * or vertical arrow has zero height (or width); a box of exactly 0 would not
 * pass `isSize()` and would fall back to a sticky-note-sized box in
 * `objectBounds`, so the empty axis is floored at a sub-epsilon instead.
 */
export const CONNECTOR_EMPTY_AXIS_FLOOR = 1e-6;

export function connectorBBox(from: Point, to: Point): Rect {
  const x = Math.min(from.x, to.x);
  const y = Math.min(from.y, to.y);
  return {
    x,
    y,
    width: Math.max(CONNECTOR_EMPTY_AXIS_FLOOR, Math.abs(to.x - from.x)),
    height: Math.max(CONNECTOR_EMPTY_AXIS_FLOOR, Math.abs(to.y - from.y)),
  };
}

function isRect(r: Rect): boolean {
  return (
    Number.isFinite(r.x) && Number.isFinite(r.y) && Number.isFinite(r.width) && Number.isFinite(r.height)
  );
}

function isPoint(v: unknown): v is Point {
  const p = v as Point | undefined;
  return !!p && typeof p === 'object' && Number.isFinite(p.x) && Number.isFinite(p.y);
}
