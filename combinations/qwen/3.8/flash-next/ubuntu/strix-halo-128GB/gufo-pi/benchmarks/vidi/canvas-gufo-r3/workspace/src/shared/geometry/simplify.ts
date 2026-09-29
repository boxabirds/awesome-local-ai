import type { Point } from '@client/canvas/camera';
import { STROKE_MAX_POINTS } from '@shared/config';

/**
 * Perpendicular distance from point `p` to the line segment `a`→`b`.
 */
function perpDist(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * Find the index of the point with maximum perpendicular distance from line a→b,
 * searching indices [lo, hi] inclusive. Returns { index, dist }.
 */
function furthestFromLine(points: readonly Point[], lo: number, hi: number): { index: number; dist: number } {
  const a = points[lo];
  const b = points[hi];
  let maxDist = -1;
  let maxIdx = lo;
  for (let i = lo + 1; i < hi; i++) {
    const d = perpDist(points[i], a, b);
    if (d > maxDist) {
      maxDist = d;
      maxIdx = i;
    }
  }
  return { index: maxIdx, dist: maxDist };
}

/**
 * Ramer-Douglas-Peucker polyline simplification (iterative, stack-based to avoid
 * recursion depth issues on 5000+ point strokes).
 * Keeps first and last points; every removed point lies within `tolerance` of
 * the result polyline.
 */
export function simplify(points: readonly Point[], tolerance: number): Point[] {
  if (points.length <= 2) return [...points];

  // Boolean mask of which points to keep
  const keep: boolean[] = new Array(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;

  // Stack of (lo, hi) ranges to process
  const stack: Array<[number, number]> = [[0, points.length - 1]];

  while (stack.length > 0) {
    const [lo, hi] = stack.pop()!;
    if (hi - lo < 2) continue; // No interior points to consider
    const { index, dist } = furthestFromLine(points, lo, hi);
    if (dist > tolerance) {
      keep[index] = true;
      stack.push([lo, index]);
      stack.push([index, hi]);
    }
  }

  const result: Point[] = [];
  for (let i = 0; i < points.length; i++) {
    if (keep[i]) result.push(points[i]);
  }
  return result;
}

/**
 * Split a point array into chunks of at most `max` points.
 * Consecutive parts share the join point (part i+1 starts with part i's last point).
 */
export function splitPoints(points: readonly Point[], max: number = STROKE_MAX_POINTS): Point[][] {
  if (points.length <= max) return [[...points]];
  const parts: Point[][] = [];
  let offset = 0;
  while (offset < points.length) {
    const end = Math.min(offset + max, points.length);
    parts.push(points.slice(offset, end));
    if (end >= points.length) break;
    // Next part starts at the last point of this part (shared join point)
    offset = end - 1;
  }
  return parts;
}

/**
 * Produce an SVG path string using quadratic Bezier midpoint smoothing.
 * For a single point: zero-length path (renders as a round dot with linecap round).
 * For two points: M start L end (straight line, no Q needed).
 * For three+ points: M then Q segments through midpoints, ending at last point.
 */
export function smoothPath(points: readonly Point[]): string {
  if (points.length === 0) return 'M 0 0';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y} L ${points[0].x} ${points[0].y}`;
  if (points.length === 2) return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;

  // Start at first point
  let d = `M ${points[0].x} ${points[0].y}`;

  // Draw quadratic curves through midpoints
  // The first segment goes from p0 through control p1 to mid(p1,p2)
  for (let i = 1; i < points.length - 1; i++) {
    const mid = {
      x: (points[i].x + points[i + 1].x) / 2,
      y: (points[i].y + points[i + 1].y) / 2,
    };
    d += ` Q ${points[i].x} ${points[i].y} ${mid.x} ${mid.y}`;
  }

  // End at the last point
  const last = points[points.length - 1];
  d += ` L ${last.x} ${last.y}`;

  return d;
}
