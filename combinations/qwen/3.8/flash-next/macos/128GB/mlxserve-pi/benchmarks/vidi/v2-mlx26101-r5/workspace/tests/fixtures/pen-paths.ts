/**
 * Recorded pointer paths for the pen tests (story 11).
 *
 * These are the strokes the pen is tested against, and they are here rather than inline for two reasons.
 * First, a smoothing test is a statement about a *particular* path: "every point of this loop is within one
 * unit of the simplified loop" is only checkable against a loop that does not change when the test is rerun,
 * so the jitter is generated from a seed rather than from `Math.random()`. Second, the interesting paths are
 * long — four hundred points is what a two-second circle looks like at a trackpad's 200 events a second, and
 * five thousand ten is what the point limit is asked about — and pasting them into a test file would be
 * pasting numbers instead of writing assertions.
 *
 * All three are in world units, in no particular place, and none of them knows about the camera: a test that
 * wants a screen point converts one, the same way the tool does.
 */

import type { Point } from '../../src/shared/geometry';

/**
 * A random source that gives the same numbers every time.
 *
 * `mulberry32`, which is thirty years of floating-point arithmetic and no dependencies: the paths below
 * have to be the same path on every machine and every run, because a test that asserts a maximum deviation
 * is asserting a fact about one shape, not about a shape sampled afresh each time.
 */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Jitter of at most ±`amplitude` world units, from `random`. */
const jitter = (random: () => number, amplitude: number): number => (random() * 2 - 1) * amplitude;

/**
 * A hand-drawn loop round a cluster of notes: 400 points, wobbly, closed.
 *
 * The wobble is three things at once — a radius that breathes, a centre that drifts, and per-point jitter —
 * because the point of the smoothing tests is that the raw path is *not* a circle: a path that was already
 * a circle would let a simplifier that sampled every tenth point look correct. The loop does not close
 * exactly, either; a hand misses its own starting point by a few units, and so does this.
 */
export const handwrittenLoop: readonly Point[] = (() => {
  const random = seeded(0x5eed11);
  const centre = { x: 300, y: 220 };
  const radius = { x: 260, y: 170 };
  const count = 400;
  const points: Point[] = [];
  for (let index = 0; index < count; index += 1) {
    const angle = (index / count) * Math.PI * 2 - Math.PI / 2;
    // The radius breathes over the lap: a hand does not hold its distance from the centre.
    const breathe = 1 + 0.04 * Math.sin(angle * 3) + 0.02 * Math.cos(angle * 7);
    const x = centre.x + Math.cos(angle) * radius.x * breathe + jitter(random, 3);
    const y = centre.y + Math.sin(angle) * radius.y * breathe + jitter(random, 3);
    points.push({ x, y });
  }
  return points;
})();

/**
 * An underline: 120 points, left to right, a line that is nearly straight and not quite.
 *
 * "Nearly straight" is the interesting case for a simplifier: the honest answer is two points, and the
 * honest answer is also wrong by the height of the wobble, so this is the path the tolerance is measured
 * against. It curves down a little on the way, the way a wrist does.
 */
export const underline: readonly Point[] = (() => {
  const random = seeded(0x5eed12);
  const start = { x: 40, y: 500 };
  const length = 360;
  const count = 120;
  const points: Point[] = [];
  for (let index = 0; index < count; index += 1) {
    const step = index / (count - 1);
    const x = start.x + step * length;
    const y = start.y + 6 * Math.sin(step * Math.PI) + jitter(random, 1.5);
    points.push({ x, y });
  }
  return points;
})();

/**
 * A spiral of 5,010 points: the path the point limit is asked about.
 *
 * Longer than `STROKE_MAX_POINTS` by ten, which is the boundary the design names — one commit and a
 * remainder, with the remainder starting where the first stroke ended. It grows outward from the centre so
 * that no two consecutive points are ever in the same place: a path that revisited itself would let a split
 * look seamless for the wrong reason.
 */
export const longSpiral: readonly Point[] = (() => {
  const random = seeded(0x5eed13);
  const centre = { x: 600, y: 400 };
  const count = 5010;
  const points: Point[] = [];
  for (let index = 0; index < count; index += 1) {
    const step = index / count;
    const angle = step * Math.PI * 2 * 12; // twelve laps
    const radius = 20 + step * 300;
    const x = centre.x + Math.cos(angle) * radius + jitter(random, 0.5);
    const y = centre.y + Math.sin(angle) * radius + jitter(random, 0.5);
    points.push({ x, y });
  }
  return points;
})();

/** Every point's distance from the polyline `path`, the largest of them. */
export function maxDeviation(points: readonly Point[], path: readonly Point[]): number {
  let worst = 0;
  for (const point of points) {
    const distance = distanceToSegmentList(path, point);
    if (distance > worst) worst = distance;
  }
  return worst;
}

/** How far `point` is from the nearest of the segments of `path`. */
function distanceToSegmentList(path: readonly Point[], point: Point): number {
  let best = Number.POSITIVE_INFINITY;
  for (let index = 0; index < path.length - 1; index += 1) {
    const a = path[index];
    const b = path[index + 1];
    if (a === undefined || b === undefined) continue;
    best = Math.min(best, distanceToSegment(a, b, point));
  }
  if (path.length === 1) {
    const only = path[0];
    if (only !== undefined) best = Math.min(best, Math.hypot(only.x - point.x, only.y - point.y));
  }
  return best;
}

/** Distance from `point` to the segment `a`–`b`, with the projection clamped to the segment. */
function distanceToSegment(a: Point, b: Point, point: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const squared = dx * dx + dy * dy;
  if (squared === 0) return Math.hypot(a.x - point.x, a.y - point.y);
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / squared));
  return Math.hypot(a.x + t * dx - point.x, a.y + t * dy - point.y);
}
