/**
 * Turning a captured pointer path into something worth storing (story 11, `stroke.simplify`).
 *
 * A pen drag is thousands of raw samples; almost all of them are redundant. These three pure
 * functions turn a raw path into a faithful, storable, drawable one:
 *
 * - `simplify` runs Ramer-Douglas-Peucker: it drops points until the output polyline is within
 *   `tolerance` of every raw point. That guarantee is the whole point of `stroke.simplify` — a
 *   simplified line that visibly misses the gesture is worse than no simplification.
 * - `splitPoints` cuts a path that runs past `STROKE_MAX_POINTS` into several strokes that share
 *   their boundary point, so the path stays unbroken while no single stroke gets too big to hold.
 * - `smoothPath` writes the polyline as an SVG path of cubic curves, so a sketch reads as a
 *   stroke and not as a chain of straight segments.
 *
 * Everything here is pure and unit-free where it can be: `simplify` works in whatever units the
 * points and the tolerance share (the tool passes world units and `tolerance_px / zoom`).
 */
import { distanceToSegment } from './polyline';
import type { Point } from '../geometry';

/**
 * Ramer-Douglas-Peucker, iteratively.
 *
 * Returns a subsequence of `points` (in order, always keeping the first and last) such that every
 * raw point lies within `tolerance` of the returned polyline. The recursion is written as an
 * explicit stack so a 20 000-point straight line — a pathological input that recurses to the
 * length of the path — cannot blow the call stack.
 */
export function simplify(points: readonly Point[], tolerance: number): Point[] {
  if (points.length <= 2) return points.map((p) => ({ ...p }));

  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;

  // A stack of [first, last] index pairs whose interior still needs checking.
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const range = stack.pop();
    if (!range) break;
    const [first, last] = range;
    if (last - first < 2) continue;
    const anchorA = points[first];
    const anchorB = points[last];
    if (!anchorA || !anchorB) continue;
    let maxDist = -1;
    let index = -1;
    for (let i = first + 1; i < last; i += 1) {
      const p = points[i];
      if (!p) continue;
      const d = distanceToSegment(anchorA, anchorB, p);
      if (d > maxDist) {
        maxDist = d;
        index = i;
      }
    }
    // Only a point further than the tolerance from the chord forces the chord to bend.
    if (index !== -1 && maxDist > tolerance) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }

  const out: Point[] = [];
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i];
    if (p && keep[i]) out.push({ ...p });
  }
  return out;
}

/**
 * Cut `points` into strokes of at most `maxPoints`, consecutive strokes sharing their boundary
 * point so the drawn path is unbroken where one stroke hands off to the next (`stroke.split`).
 *
 * The shared point is why a 5010-point path becomes a 5000-point stroke and a stroke of the last
 * 11 (the 5000th point counted once in each), rather than a 5000 + 10 split that would leave a
 * hairline gap at the join.
 */
export function splitPoints(points: readonly Point[], maxPoints: number): Point[][] {
  if (maxPoints < 2) throw new Error('a stroke must hold at least two points');
  if (points.length <= maxPoints) return [points.map((p) => ({ ...p }))];

  const parts: Point[][] = [];
  let start = 0;
  while (start < points.length) {
    // The last index of this part, leaving room for a shared boundary with the next.
    const end = Math.min(start + maxPoints - 1, points.length - 1);
    parts.push(points.slice(start, end + 1).map((p) => ({ ...p })));
    if (end === points.length - 1) break;
    start = end; // the next part begins at this same point
  }
  return parts;
}

/**
 * A smooth SVG path through `points` (world units, any origin), as quadratic Bézier segments drawn
 * through the midpoints of consecutive samples (`stroke.smooth`).
 *
 * Each curve is anchored at a midpoint and steered by the shared vertex, so it lies inside the
 * triangle those three points form — never further from the drawn polyline than the polyline is
 * from the eye. The path opens on the first point and closes on the last, so the painted box meets
 * the stroke's bounding box. A single point is a bare move (`M`); two points are a single `Q`,
 * steered by the far point so it reads straight but stays a `Q` segment like every other.
 */
export function smoothPath(points: readonly Point[]): string {
  const n = points.length;
  if (n === 0) return '';
  const p0 = points[0];
  if (!p0) return '';
  if (n === 1) return `M${r(p0.x)},${r(p0.y)}`;

  let d = `M${r(p0.x)},${r(p0.y)}`;
  if (n === 2) {
    const p1 = points[1]!;
    // Steered by the endpoint so a two-point stroke is a straight run, still expressed as a `Q`.
    return `${d}Q${r(p1.x)},${r(p1.y)} ${r(p1.x)},${r(p1.y)}`;
  }

  // One curve per interior vertex, ending on the midpoint of the following segment.
  for (let i = 1; i <= n - 2; i += 1) {
    const vertex = points[i]!;
    const next = points[i + 1]!;
    const midX = (vertex.x + next.x) / 2;
    const midY = (vertex.y + next.y) / 2;
    d += `Q${r(vertex.x)},${r(vertex.y)} ${r(midX)},${r(midY)}`;
  }
  // Close on the last point, steered by it so the path ends exactly there.
  const last = points[n - 1]!;
  d += `Q${r(last.x)},${r(last.y)} ${r(last.x)},${r(last.y)}`;
  return d;
}

/** Round to two decimals: enough precision for a stroke, small enough to keep snapshots tidy. */
function r(value: number): number {
  return Math.round(value * 100) / 100;
}
