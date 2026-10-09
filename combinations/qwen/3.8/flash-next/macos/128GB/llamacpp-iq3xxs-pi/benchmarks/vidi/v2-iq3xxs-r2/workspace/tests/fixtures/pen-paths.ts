import type { Point } from '../../src/shared/geometry';
import { STROKE_MAX_POINTS } from '../../src/shared/config';

/**
 * Recorded pointer paths for story 11 (`tests/fixtures/pen-paths.ts`).
 *
 * These are the shapes a hand makes: a loop drawn round a cluster of notes, an underline, and
 * a spiral long enough to run past `STROKE_MAX_POINTS`. They are generated rather than captured
 * so the same pixels are drawn on every machine that runs the tests — the jitter is a seeded
 * sequence, not `Math.random` — while still being jittery enough to be worth simplifying.
 */

/** A small deterministic PRNG (mulberry32), so a fixture is the same path on every run. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A loop: an ellipse walked once, its radius wobbling a little at every step and each point
 * jittered by a fraction of a board unit, the way a hand holding a mouse wobbles.
 *
 * `steps` points around it, which is how the fixture keeps the size its name promises.
 */
function loopPath(count: number, radiusX: number, radiusY: number, jitter: number): Point[] {
  const random = seeded(1109);
  const points: Point[] = [];
  for (let index = 0; index < count; index += 1) {
    const angle = (index / count) * Math.PI * 2;
    // A slow wobble in the radius plus a fast one on the point itself.
    const wobble = 1 + 0.05 * Math.sin(angle * 3.5) + 0.02 * Math.cos(angle * 7);
    points.push({
      x: Math.cos(angle) * radiusX * wobble + (random() - 0.5) * jitter,
      y: Math.sin(angle) * radiusY * wobble + (random() - 0.5) * jitter,
    });
  }
  return points;
}

/** An underline: a nearly straight run, dropping and rising by a few units, with jitter. */
function underlinePath(count: number, width: number): Point[] {
  const random = seeded(4211);
  const points: Point[] = [];
  for (let index = 0; index < count; index += 1) {
    const along = index / (count - 1);
    points.push({
      x: along * width + (random() - 0.5) * 0.6,
      y: 3 * Math.sin(along * Math.PI * 1.5) + (random() - 0.5) * 1.2,
    });
  }
  return points;
}

/** A spiral: ever-widening turns, used to run a single gesture past the point limit. */
function spiralPath(count: number): Point[] {
  const points: Point[] = [];
  const turns = 26;
  for (let index = 0; index < count; index += 1) {
    const along = index / (count - 1);
    const angle = along * turns * Math.PI * 2;
    const radius = 8 + along * 220;
    points.push({
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
    });
  }
  return points;
}

/** A handwritten loop of 400 points, about 240 × 180 board units. */
export const HANDWRITTEN_LOOP: readonly Point[] = loopPath(400, 120, 90, 3);

/** A handwritten underline of 120 points, 300 board units long. */
export const UNDERLINE: readonly Point[] = underlinePath(120, 300);

/** A 5,010-point spiral: `STROKE_MAX_POINTS` plus the 10 that go past it. */
export const LONG_SPIRAL: readonly Point[] = spiralPath(STROKE_MAX_POINTS + 10);

/** The loop, moved so its top-left corner sits at `at` — a place on the board to draw it. */
export function loopAt(at: Point): Point[] {
  return moved(HANDWRITTEN_LOOP, at);
}

/** The same path somewhere else on the board. */
export function moved(points: readonly Point[], at: Point): Point[] {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
  }
  return points.map((point) => ({ x: at.x + point.x - minX, y: at.y + point.y - minY }));
}
