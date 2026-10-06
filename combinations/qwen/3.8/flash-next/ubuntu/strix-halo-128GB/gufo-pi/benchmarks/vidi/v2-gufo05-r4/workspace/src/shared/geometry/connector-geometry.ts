/**
 * Where an arrow joins a shape, and the path that draws it.
 *
 * An arrow does not point at the centre of a shape and stop there — it leaves the shape it is
 * tied to through the side facing whatever it points at, so that moving an object turns the
 * arrow without detaching it, and a long arrow looks attached rather than stabbed through
 * (`connector.follow`). Everything here is decided from the two rects alone, which is what
 * makes it reproducible: the same board state always gives the same two points, on every
 * client, without anybody having to write them down.
 *
 * Pure, shared and DOM-free: the Worker that validates a board can ask the same question as
 * the screen that draws the line.
 */

import type { Point, Rect } from '../geometry';
import type { ConnectorEndpoint } from '../objects/connector';

/** The four sides of a rect, named for the shape they belong to. */
export type Side = 'left' | 'right' | 'top' | 'bottom';

/** The ends of an arrow, without the rest of it: all the geometry needs. */
export interface ConnectorEnds {
  from: ConnectorEndpoint;
  to: ConnectorEndpoint;
}

/** Where an arrow's ends turned out to be: two points on the board. */
export interface ConnectorPoints {
  from: Point;
  to: Point;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function usableRect(rect: Rect | undefined): rect is Rect {
  return !!rect && finite(rect.x) && finite(rect.y) && finite(rect.width) && finite(rect.height);
}

function centre(rect: Rect): Point {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/** The middle of one side — the point an arrow leaves a shape from. */
export function sideAnchor(rect: Rect, side: Side): Point {
  switch (side) {
    case 'left':
      return { x: rect.x, y: rect.y + rect.height / 2 };
    case 'right':
      return { x: rect.x + rect.width, y: rect.y + rect.height / 2 };
    case 'top':
      return { x: rect.x + rect.width / 2, y: rect.y };
    case 'bottom':
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height };
  }
}

/**
 * Which side of `rect` faces `toward`.
 *
 * "Nearest" means the shortest way out of *this* shape, which is decided against the rect's
 * own diagonals rather than against 45 degrees: a rect twice as wide as it is tall keeps
 * saying `right` to a target well above its middle, because going sideways out of the wide
 * side really is the shorter walk. Exactly on a diagonal is a tie, and the horizontal side
 * wins it — one rule, applied the same way on every client.
 */
export function nearestSide(rect: Rect, toward: Point): Side {
  if (!usableRect(rect) || !toward || !finite(toward.x) || !finite(toward.y)) return 'right';
  const middle = centre(rect);
  const dx = toward.x - middle.x;
  const dy = toward.y - middle.y;
  // Cross-multiplied so a rect of any proportion is measured against its own shape.
  const horizontal = Math.abs(dy) * rect.width <= Math.abs(dx) * rect.height;
  if (horizontal) return dx >= 0 ? 'right' : 'left';
  return dy >= 0 ? 'bottom' : 'top';
}

/** The point an endpoint stands for when it has no object to be tied to any more. */
function storedPoint(end: ConnectorEndpoint): Point {
  if (end.kind === 'free') {
    return { x: finite(end.x) ? end.x : 0, y: finite(end.y) ? end.y : 0 };
  }
  const fallback = end.fallback;
  return fallback && finite(fallback.x) && finite(fallback.y) ? { x: fallback.x, y: fallback.y } : { x: 0, y: 0 };
}

/** The object an endpoint is tied to, when it still is one and it is still on the board. */
function boundRect(end: ConnectorEndpoint, rects: ReadonlyMap<string, Rect> | undefined): Rect | undefined {
  if (end.kind !== 'attached' || !rects) return undefined;
  const rect = rects.get(end.objectId);
  return usableRect(rect) ? rect : undefined;
}

/**
 * The two points an arrow is drawn between.
 *
 * An end tied to an object that is on the board leaves it through the side facing the other
 * end — its centre when that end is tied to an object too, so the pair is decided by the two
 * rects and never chases its own tail. An end that is free is used exactly as stored, and an
 * end whose object has gone falls back to the anchor it was holding, which is what keeps a
 * board with a broken reference drawing an arrow rather than a hole.
 */
export function resolveEndpoints(
  ends: ConnectorEnds,
  rects: ReadonlyMap<string, Rect> | undefined
): ConnectorPoints {
  if (!ends) return { from: { x: 0, y: 0 }, to: { x: 0, y: 0 } };
  const fromRect = boundRect(ends.from, rects);
  const toRect = boundRect(ends.to, rects);
  // Where each end looks: at the middle of the object on the other side, or at the other
  // end's own point when that one is free or already detached.
  const fromToward = toRect ? centre(toRect) : storedPoint(ends.to);
  const toToward = fromRect ? centre(fromRect) : storedPoint(ends.from);
  return {
    from: fromRect ? sideAnchor(fromRect, nearestSide(fromRect, fromToward)) : storedPoint(ends.from),
    to: toRect ? sideAnchor(toRect, nearestSide(toRect, toToward)) : storedPoint(ends.to)
  };
}

/**
 * The box an arrow between two points occupies — what selects it in a marquee, frames it when
 * it is selected, and tells a toolbar where to sit. An arrow in a straight line has a box of
 * no height, which is honest: the arrow is a line.
 */
export function connectorBBox(a: Point, b: Point): Rect {
  const from = storedPointish(a);
  const to = storedPointish(b);
  return {
    x: Math.min(from.x, to.x),
    y: Math.min(from.y, to.y),
    width: Math.abs(to.x - from.x),
    height: Math.abs(to.y - from.y)
  };
}

function storedPointish(point: Point | undefined): Point {
  return point && finite(point.x) && finite(point.y) ? { x: point.x, y: point.y } : { x: 0, y: 0 };
}

/** Round to a thousandth, so a path string does not carry the noise of a division. */
function tidy(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** The `d` attribute of the line itself, through every point of the polyline. */
export function polylinePath(points: readonly Point[]): string {
  if (!Array.isArray(points) || points.length === 0) return '';
  return points
    .filter((point) => point && finite(point.x) && finite(point.y))
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${tidy(point.x)} ${tidy(point.y)}`)
    .join(' ');
}

/**
 * The `d` attribute of a filled arrowhead whose tip is at `to`, pointing the way the line
 * goes: `size` long, and half as wide.
 *
 * A line with no direction has no arrowhead — an empty path, drawn as nothing — because
 * choosing one would be a guess about what the person meant.
 */
export function arrowheadPath(from: Point, to: Point, size: number): string {
  if (!from || !to || !finite(size) || size <= 0) return '';
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (!(length > 0)) return '';
  const ux = dx / length;
  const uy = dy / length;
  // The base, pulled back from the tip along the line; the wings, half a head either side of
  // it along the perpendicular.
  const base = { x: to.x - ux * size, y: to.y - uy * size };
  const wing = { x: -uy * (size / 2), y: ux * (size / 2) };
  return (
    `M ${tidy(to.x)} ${tidy(to.y)} ` +
    `L ${tidy(base.x + wing.x)} ${tidy(base.y + wing.y)} ` +
    `L ${tidy(base.x - wing.x)} ${tidy(base.y - wing.y)} Z`
  );
}
