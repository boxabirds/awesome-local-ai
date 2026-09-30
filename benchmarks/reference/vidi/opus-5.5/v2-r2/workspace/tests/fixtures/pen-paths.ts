// Realistic pen input paths (story 11), in world units at 100% zoom. Generated
// deterministically (seeded jitter) to stand in for recorded pointer input:
// a hand-drawn loop around a cluster, an underline, and a long spiral.
import type { Point } from '../../src/shared/geometry';

/** Small deterministic PRNG (mulberry32) so fixtures never change between runs. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A slightly wobbly, overlapping loop (~400 points) centred on (cx, cy), with pointer jitter. */
export function handwrittenLoop(cx = 400, cy = 300, rx = 180, ry = 120, count = 400): Point[] {
  const rand = rng(11);
  const pts: Point[] = [];
  for (let i = 0; i < count; i++) {
    const t = (i / (count - 1)) * Math.PI * 2.15;
    const wobble = 1 + 0.06 * Math.sin(t * 3);
    pts.push({
      x: cx + Math.cos(t) * rx * wobble + (rand() - 0.5) * 1.6,
      y: cy + Math.sin(t) * ry * wobble + (rand() - 0.5) * 1.6,
    });
  }
  return pts;
}

/** A mostly horizontal underline (~120 points) starting at (x, y). */
export function underline(x = 200, y = 400, length = 300, count = 120): Point[] {
  const rand = rng(7);
  const pts: Point[] = [];
  for (let i = 0; i < count; i++) {
    const f = i / (count - 1);
    pts.push({ x: x + f * length, y: y + Math.sin(f * Math.PI) * 4 + (rand() - 0.5) * 1.2 });
  }
  return pts;
}

/** A synthetic spiral of `count` points (default 5,010, just over STROKE_MAX_POINTS). */
export function spiral(cx = 0, cy = 0, count = 5010): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i < count; i++) {
    const t = i * 0.02;
    const r = 10 + i * 0.05;
    pts.push({ x: cx + Math.cos(t) * r, y: cy + Math.sin(t) * r });
  }
  return pts;
}
