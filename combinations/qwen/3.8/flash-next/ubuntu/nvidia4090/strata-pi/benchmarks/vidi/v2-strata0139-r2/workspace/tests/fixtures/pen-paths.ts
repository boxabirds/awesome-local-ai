import type { Point } from "../../src/shared/geometry";

/**
 * Recorded pointer paths for the pen tests (story 11).
 *
 * Everything here is deterministic — a seeded generator, never `Math.random()` —
 * because the smoothing tests assert that a *specific* raw path ends up within a
 * specific distance of the result, and a random fixture would make a failure
 * impossible to reproduce.
 *
 * The shapes are what a hand actually draws: a loop round a cluster of notes with
 * the wobble a real mouse drag has, a slightly sagging underline, and a long
 * spiral that exists only to cross `STROKE_MAX_POINTS`.
 */

/** Small deterministic PRNG (mulberry32), so every run gets the same "hand". */
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

/**
 * A closed loop, drawn round a cluster of sticky notes: ~400 points with a hand's
 * wobble (±2 board units of jitter, plus a slow drift), starting and ending near
 * the top-right of the cluster.
 */
export function handwrittenLoop(count = 400): Point[] {
  const random = seeded(0x5eed11);
  const centreX = 300;
  const centreY = 240;
  const radiusX = 220;
  const radiusY = 150;
  const points: Point[] = [];
  for (let index = 0; index < count; index += 1) {
    const angle = (index / (count - 1)) * Math.PI * 2;
    // A hand never keeps the radius: it tightens and loosens as it goes.
    const wobble = 1 + 0.05 * Math.sin(angle * 3.5) + 0.03 * Math.cos(angle * 7);
    const jitter = (random() - 0.5) * 4;
    points.push({
      x: centreX + Math.cos(angle) * radiusX * wobble + jitter,
      y: centreY + Math.sin(angle) * radiusY * wobble + (random() - 0.5) * 4,
    });
  }
  return points;
}

/**
 * An underline under a sticky note: ~120 points along a line that sags a little in
 * the middle and overshoots at the end.
 */
export function underlinePath(count = 120): Point[] {
  const random = seeded(0xda7a);
  const startX = 40;
  const endX = 360;
  const y = 120;
  const points: Point[] = [];
  for (let index = 0; index < count; index += 1) {
    const t = index / (count - 1);
    const x = startX + (endX - startX) * t;
    const sag = 3 * Math.sin(t * Math.PI);
    points.push({
      x: x + (random() - 0.5) * 1.5,
      y: y + sag + (random() - 0.5) * 2,
    });
  }
  return points;
}

/** A long expanding spiral: the fixture that crosses the point limit. */
export function spiralPath(count = 5_010): Point[] {
  const points: Point[] = [];
  for (let index = 0; index < count; index += 1) {
    const angle = index / 6;
    const radius = 4 + index / 40;
    points.push({ x: 500 + Math.cos(angle) * radius, y: 500 + Math.sin(angle) * radius });
  }
  return points;
}

/** A straight drag: the path a hit-test or scaling test wants to reason about. */
export function straightPath(from: Point = { x: 100, y: 100 }, to: Point = { x: 400, y: 100 }, count = 31): Point[] {
  const points: Point[] = [];
  for (let index = 0; index < count; index += 1) {
    const t = index / (count - 1);
    points.push({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t });
  }
  return points;
}
