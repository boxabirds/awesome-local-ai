/**
 * Ramer–Douglas–Peucker simplification (story 11, `pen.smooth`).
 *
 * A freehand capture is one point per pointer event — a flick across the board
 * is three hundred of them — and a path that keeps every point is slower to
 * draw, slower to send and slower to hit-test than one that keeps the shape.
 * A stroke carries a lot of points and little information; this drops the ones
 * that carry nothing.
 *
 * The rule is distance, not count: a point is dropped when the whole stroke
 * stays within `epsilon` of the line that connects its ends, and the recursion
 * keeps whatever is needed to hold that line. `epsilon` is one screen pixel at
 * the zoom the stroke was drawn at, converted to world units by the caller, so
 * the tolerance does not drift with zoom.
 *
 * Two details worth knowing before changing this:
 *   - the loop below is deliberately not an explicit stack. A 5000-point flick
 *     is ~15 recursions deep, which is nothing, but the same function has to
 *     survive a pathological zig-zag without a stack overflow;
 *   - when every point is within epsilon the result is `[first, last]` — a
 *     two-point stroke is legal and is kept, because its bounding box still
 *     has to be right even when its shape does not.
 */
import type { Point } from '../geometry';
import { distanceToSegment } from './polyline';

/** How far `p` sits off the line `a`→`b`, in world units. */
export function perpendicularDistance(a: Point, b: Point, p: Point): number {
  return distanceToSegment(a, b, p);
}

/**
 * Reduce `points` to the fewest points that stay within `epsilon` of them.
 *
 * The first and last point are always kept. Points closer together than
 * `epsilon` collapse into their neighbours, so a tail of identical points (a
 * pen held still at the end of a stroke) disappears here too; a two-point
 * input comes back unchanged, and an input of one point comes back as itself.
 */
export function simplify(
  points: readonly Point[],
  epsilon = 1,
): Point[] {
  if (points.length <= 2) return [...points];

  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;

  // One queue of spans to inspect, never recursion: a zig-zag input makes the
  // span count quadratic in the worst case but the depth flat, and this is a
  // hot path on a pointer-up.
  const spans: Array<[number, number]> = [[0, points.length - 1]];
  while (spans.length > 0) {
    const span = spans.pop()!;
    const start = span[0];
    const end = span[1];
    if (end <= start + 1) continue;

    const a = points[start]!;
    const b = points[end]!;
    let worst = -1;
    let worstDistance = epsilon;
    for (let i = start + 1; i < end; i++) {
      const p = points[i]!;
      const distance = perpendicularDistance(a, b, p);
      if (distance > worstDistance) {
        worstDistance = distance;
        worst = i;
      }
    }
    if (worst < 0) continue; // Every point is within epsilon: drop them all.

    keep[worst] = 1;
    spans.push([start, worst], [worst, end]);
  }

  const result: Point[] = [];
  for (let i = 0; i < points.length; i++) {
    if (keep[i] === 1) result.push(points[i]!);
  }
  return result;
}

/**
 * Drop points closer together than `distance`, keeping the first and the last.
 *
 * The capture already does this as it goes; this is the same rule applied to a
 * list that arrived from somewhere else (a reconstruction, a paste).
 */
export function dedupe(
  points: readonly Point[],
  distance = 0.5,
): Point[] {
  if (points.length <= 1) return [...points];
  const result: Point[] = [points[0]!];
  for (let i = 1; i < points.length - 1; i++) {
    const previous = result[result.length - 1]!;
    const p = points[i]!;
    if (Math.hypot(p.x - previous.x, p.y - previous.y) >= distance) result.push(p);
  }
  const last = points[points.length - 1]!;
  const previous = result[result.length - 1]!;
  if (last.x !== previous.x || last.y !== previous.y) result.push(last);
  return result;
}
