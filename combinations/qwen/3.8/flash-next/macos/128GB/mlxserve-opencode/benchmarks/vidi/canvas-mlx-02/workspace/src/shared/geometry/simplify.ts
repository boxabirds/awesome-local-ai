// The freehand geometry (story 11, design `stroke.model`): the line simplifier
// that makes a stroke small, the point splitter that keeps one stroke from
// growing past its limit, and the path builder that draws a stroke smooth.
//
// The promise every function here keeps is the one the requirement is written as:
// a stroke may get smaller, never less faithful than the setting allows. `simplify`
// is Ramer-Douglas-Peucker - it drops a point only when the straight line it is
// replaced by is no farther from it than the tolerance - and it is implemented with
// an explicit stack rather than recursion because a stroke is allowed to hold five
// thousand points and a hand-drawn spiral is five thousand nested calls deep.
//
// All coordinates are world units and the tolerance is in world units too; it is
// the Pen tool's job to hand it the screen tolerance DIVIDED by the zoom it drew
// at, so the drawing is as faithful at 400% as it is at 100%.
import type { Point } from '../geometry.ts';
import { STROKE_MAX_POINTS } from '../config.ts';

const isCoord = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** The points this can actually work with: finite coordinates, nothing else. */
function usable(points: readonly Point[]): Point[] {
  const out: Point[] = [];
  if (!Array.isArray(points)) return out;
  for (const p of points) {
    if (p && isCoord(p.x) && isCoord(p.y)) out.push({ x: p.x, y: p.y });
  }
  return out;
}

/** Squared distance from `p` to the segment `a`-`b` (degenerate segments included). */
function distanceToSegmentSquared(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  if (length === 0) return (p.x - a.x) ** 2 + (p.y - a.y) ** 2;
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / length;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = a.x + t * dx;
  const cy = a.y + t * dy;
  return (p.x - cx) ** 2 + (p.y - cy) ** 2;
}

/**
 * Ramer-Douglas-Peucker: the same path, with every point that is no more than
 * `tolerance` away from the line that replaces it removed.
 *
 * The two ends are always kept - they are where the pen landed and lifted - and
 * a point exactly at the tolerance is kept, so the result is never WORSE than
 * asked. A tolerance that cannot be honoured by dropping anything (0, negative,
 * not a number) returns the path unchanged, and so does a path of two points:
 * there is nothing between them to drop.
 */
export function simplify(points: readonly Point[], tolerance: number): Point[] {
  const pts = usable(points);
  const n = pts.length;
  if (n < 3) return pts;
  if (typeof tolerance !== 'number' || !Number.isFinite(tolerance) || tolerance <= 0) return pts;

  const tol2 = tolerance * tolerance;
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;

  // Each entry is a span whose two ends are already kept; the farthest point in a
  // span that is out of tolerance becomes a third kept point and the span splits.
  const spans: number[][] = [[0, n - 1]];
  while (spans.length > 0) {
    const span = spans.pop()!;
    const from = span[0];
    const to = span[1];
    let worst = -1;
    let worstDistance = 0;
    for (let i = from + 1; i < to; i++) {
      const d = distanceToSegmentSquared(pts[i], pts[from], pts[to]);
      if (d > worstDistance) {
        worstDistance = d;
        worst = i;
      }
    }
    if (worst < 0 || worstDistance <= tol2) continue;
    keep[worst] = 1;
    if (worst - from > 1) spans.push([from, worst]);
    if (to - worst > 1) spans.push([worst, to]);
  }

  const out: Point[] = [];
  for (let i = 0; i < n; i++) if (keep[i] === 1) out.push(pts[i]);
  return out;
}

/**
 * Cut a long recording into consecutive parts of at most `max` points, where each
 * part after the first STARTS ON the point the part before it ended on.
 *
 * That shared point is the whole trick: the drawing is one line drawn in two
 * strokes, and because both parts contain the join it has no gap in it. `max`
 * defaults to `STROKE_MAX_POINTS`; a limit below 2 (or not a number) cannot split
 * anything, so it is ignored rather than turned into an endless loop.
 */
export function splitPoints(points: readonly Point[], max: number = STROKE_MAX_POINTS): Point[][] {
  const pts = usable(points);
  if (pts.length === 0) return [];
  const limit = typeof max === 'number' && Number.isFinite(max) && max >= 2 ? Math.floor(max) : STROKE_MAX_POINTS;
  if (pts.length <= limit) return [pts];

  const parts: Point[][] = [];
  let start = 0;
  for (;;) {
    const end = Math.min(start + limit - 1, pts.length - 1);
    parts.push(pts.slice(start, end + 1));
    if (end >= pts.length - 1) return parts;
    start = end; // the next part repeats this point
  }
}

const n = (v: number): string => String(Math.round(v * 100) / 100);
const at = (p: Point): string => `${n(p.x)} ${n(p.y)}`;

/**
 * The path a stroke is drawn with: a move to the first point, then one quadratic
 * segment per interior point, each through that point and the midpoint of it and
 * the next, and a line onto the last point.
 *
 * A quadratic through a midpoint always STARTS where the previous one ended, so
 * the segments join without a corner and the path is one continuous line - and it
 * passes exactly through the first and last recorded points, which are where the
 * pen landed and lifted. One point draws a zero-length path, which with round line
 * caps is the dot the requirement asks a click to be.
 *
 * Deterministic and total: the same points always produce the same string, a point
 * that is not a number is left out rather than drawn as `NaN`, and no path is
 * never an empty string.
 */
export function smoothPath(points: readonly Point[]): string {
  const pts = usable(points);
  const nPoints = pts.length;
  if (nPoints === 0) return '';
  if (nPoints === 1) return `M ${at(pts[0])} L ${at(pts[0])}`;

  let d = `M ${at(pts[0])}`;
  for (let i = 1; i < nPoints - 1; i++) {
    const middle = { x: (pts[i].x + pts[i + 1].x) / 2, y: (pts[i].y + pts[i + 1].y) / 2 };
    d += ` Q ${at(pts[i])} ${at(middle)}`;
  }
  return `${d} L ${at(pts[nPoints - 1])}`;
}
