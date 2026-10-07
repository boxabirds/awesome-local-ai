/**
 * Turning a drag into a line (`src/shared/geometry/simplify.ts`, story 11).
 *
 * A pointer does not draw a line, it leaves a trail: a slow centimetre of a mouse
 * drag is a hundred points, each one a pair of numbers that goes into the document,
 * onto the wire to every other screen, and into the `d` attribute of an SVG path on
 * each of them. Three small functions stand between the trail and the drawing:
 *
 * - {@link simplify} throws away the points that say nothing new, and is the reason
 *   a stroke survives being stored at all (`pen.smooth` - "the stored stroke stays
 *   within one screen pixel of the drawn path");
 * - {@link splitPoints} cuts a trail into pieces that each fit in one object, which
 *   is what a five-thousand-point drag does to keep `pen.long_stroke` true;
 * - {@link smoothPath} says what a trail *looks* like, as path data - a round dot for
 *   one point, a straight line for two, a curve through the middle of everywhere
 *   else for the rest.
 *
 * No Yjs, no React, no DOM, and no throws: a point that is not a pair of finite
 * numbers is dropped rather than answered with `NaN`, which would travel all the way
 * into a `d` attribute and come back as a stroke that draws nothing on somebody's
 * screen. The one recursion there is in is over the *result*, whose depth is the
 * number of points the tolerance decided to keep, not the number it was given - which
 * is the difference between an algorithm that handles a five-thousand-point stroke and
 * one that overflows the stack on the way to handling it.
 */

import type { Point } from '../geometry.js';
import { STROKE_MAX_POINTS, STROKE_SIMPLIFY_TOLERANCE_PX } from '../config.js';

/**
 * The tolerance a drag should be simplified at, at a given zoom.
 *
 * The configured tolerance is a distance on the *screen* - the deviation a person cannot
 * see at the size they happen to be looking at the board - and one screen pixel is
 * `1 / zoom` board units. Dividing by the zoom is what makes `pen.smooth` hold at every
 * zoom: the same drag at 400 % keeps four times the points, and the line it becomes looks
 * the same at 100 % and at 400 %. A zoom that is not a positive number is answered with
 * the 100 % tolerance, because a board that does not know how big it is draws at 100 %.
 */
export const simplifyToleranceAt = (zoom: number): number =>
  STROKE_SIMPLIFY_TOLERANCE_PX / (Number.isFinite(zoom) && zoom > 0 ? zoom : 1);

/** A point a drawing function may be given: two finite numbers. */
const isPoint = (value: unknown): value is Point => {
  if (value === null || typeof value !== 'object') return false;
  const point = value as { x?: unknown; y?: unknown };
  return typeof point.x === 'number' && Number.isFinite(point.x)
    && typeof point.y === 'number' && Number.isFinite(point.y);
};

/** The points of a trail, with anything that is not a point left out. */
const usable = (points: readonly Point[]): Point[] => {
  if (!Array.isArray(points)) return [];
  const kept: Point[] = [];
  for (const point of points) if (isPoint(point)) kept.push({ x: point.x, y: point.y });
  return kept;
};

/**
 * How far `point` sits from the *line through* `from` and `to`, rather than from the
 * segment between them: a trail that doubles back has points whose nearest point of
 * the segment is an end, and it is the straightness of the line they were drawn
 * along, not their distance from a particular stretch of it, that RDP asks about.
 *
 * The area of the triangle the three points make, divided by its base - which is the
 * same number as the height, and avoids the square root the projection needs.
 */
function perpendicularDistance(point: Point, from: Point, to: Point): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const base = Math.hypot(dx, dy);
  // A span whose ends are the same point has no line to be measured against, so the
  // only thing left to ask is how far the point is from that place.
  if (base === 0) return Math.hypot(point.x - from.x, point.y - from.y);
  return Math.abs((point.x - from.x) * dy - (point.y - from.y) * dx) / base;
}

/**
 * The points between which a curve can be told to bend: the first, the last, and
 * every point further from the line joining its neighbours than `tolerance`.
 *
 * Ramer-Douglas-Peucker, with the recursion held in a stack instead of in the call
 * stack. The two ends of the span are kept, the point furthest from the chord is
 * found, and it is kept too only if it is far enough away to be a turn rather than
 * a wobble; then each half is asked the same question. The result is the smallest
 * set of the original points - it never invents one, which is what "faithful" comes
 * down to - for which every point that was dropped lies within `tolerance` of a
 * segment of what was kept.
 *
 * A `tolerance` of 0 or less keeps every point: a caller who says "deviate by no
 * amount at all" is a caller who wants the trail as it was, and not a caller it
 * should argue with.
 */
export function simplify(points: readonly Point[], tolerance: number): Point[] {
  const pts = usable(points);
  const limit = typeof tolerance === 'number' && Number.isFinite(tolerance) ? tolerance : 0;
  // Two points are a line segment, and a line segment has nothing in it to drop.
  if (limit <= 0 || pts.length < 3) return pts;

  const last = pts.length - 1;
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[last] = 1;

  // The spans still to be asked about, as pairs of indices into `pts`.
  const spans: [number, number][] = [[0, last]];
  while (spans.length > 0) {
    const [from, to] = spans.pop() as [number, number];
    if (to - from < 2) continue;
    let furthest = -1;
    let distance = -1;
    for (let index = from + 1; index < to; index += 1) {
      const deviation = perpendicularDistance(pts[index], pts[from], pts[to]);
      if (deviation > distance) {
        distance = deviation;
        furthest = index;
      }
    }
    // A span whose worst point is close enough is a straight stretch of line: the
    // ends say it all, and everything between them is noise.
    if (distance > limit && furthest > from && furthest < to) {
      keep[furthest] = 1;
      spans.push([from, furthest], [furthest, to]);
    }
  }

  const kept: Point[] = [];
  for (let index = 0; index < pts.length; index += 1) if (keep[index] === 1) kept.push(pts[index]);
  return kept;
}

/**
 * A trail cut into pieces of at most `max` points, each starting where the one
 * before it ended.
 *
 * The shared point is the whole design. Two objects whose ends are the same point
 * draw as one unbroken line, because the round cap of one lies exactly under the
 * round cap of the other; pieces that simply stopped and started would leave a gap
 * the width of the pen at every join, and a long stroke would come back from the
 * document with a dotted line in it.
 *
 * `max` is a number of points, not of segments, so a piece of `max` points is
 * `max - 1` segments long - and the count the limit is written against, which is why
 * a trail of exactly `max` points comes out as one piece and one more point makes two.
 */
export function splitPoints(points: readonly Point[], max: number = STROKE_MAX_POINTS): Point[][] {
  const pts = usable(points);
  if (pts.length === 0) return [];
  // A limit that is not a whole number at least 2 cannot describe a piece of a line.
  const limit = Number.isFinite(max) && Math.floor(max) >= 2 ? Math.floor(max) : STROKE_MAX_POINTS;
  if (pts.length <= limit) return [pts];

  const parts: Point[][] = [];
  let start = 0;
  for (;;) {
    // The last index this piece takes: one point short of the limit, so a piece is
    // never `limit` points *plus* the join.
    const end = Math.min(start + limit - 1, pts.length - 1);
    parts.push(pts.slice(start, end + 1));
    if (end >= pts.length - 1) break;
    start = end;
  }
  return parts;
}

/** A coordinate as path data: three decimals, which is far below a screen pixel. */
const n = (value: number): string => String(Math.round(value * 1000) / 1000);

/** One `x y` pair. */
const xy = (point: Point): string => `${n(point.x)} ${n(point.y)}`;

/** The point halfway between two others. */
const mid = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/**
 * The path data that draws a trail: `M`, then a quadratic curve through the middle of
 * every pair of points, then `L` to the last one.
 *
 * The rule - a curve to the midpoint of each pair of consecutive points, using the
 * point itself as the control point - is what makes a hand-drawn line look drawn
 * rather than looked-at. Straight segments between raw points would show every one of
 * the jittery 8-millisecond samples a mouse produces; a curve that only ever *aims*
 * at them rounds the wobble without moving the line anywhere it was not.
 *
 * One point is a dot: `M x y L x y`, a path of no length, which an SVG draws as a
 * single round cap - so a click with the pen is a dot the same size as the pen, with
 * no special case in the renderer. No points at all is the empty string, which is what
 * a `d` of nothing looks like, and never throws.
 */
export function smoothPath(points: readonly Point[]): string {
  const pts = usable(points);
  if (pts.length === 0) return '';
  if (pts.length === 1) return `M ${xy(pts[0])} L ${xy(pts[0])}`;
  if (pts.length === 2) return `M ${xy(pts[0])} L ${xy(pts[1])}`;

  let d = `M ${xy(pts[0])}`;
  for (let index = 1; index < pts.length - 1; index += 1) {
    d += ` Q ${xy(pts[index])} ${xy(mid(pts[index], pts[index + 1]))}`;
  }
  return `${d} L ${xy(pts[pts.length - 1])}`;
}

export default simplify;
