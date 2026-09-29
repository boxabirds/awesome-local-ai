/**
 * Story 11: recorded pointer paths for the pen story.
 *
 * Deterministic "recorded" paths: each is generated once from a seeded PRNG
 * with the jitter profile of a hand-drawn gesture, so every run replays the
 * exact same points (handwritten loop ≈ 400 points, underline ≈ 120 points,
 * synthetic 5,010-point spiral for the STROKE_MAX_POINTS boundary).
 */
import type { Point } from 'src/shared/geometry';

/** Small deterministic PRNG (mulberry32) so the paths are stable across runs. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A handwritten loop: one roughly closed turn around (0,0) with a wobbly
 * radius and per-point jitter, as a mouse-drawn circle feels (~400 points).
 */
export const handwrittenLoop: Point[] = (() => {
  const rand = mulberry32(11);
  const n = 400;
  const pts: Point[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * Math.PI * 2;
    const r = 60 + Math.sin(t * 3) * 8 + (rand() - 0.5) * 6;
    pts.push({
      x: Math.cos(t) * r + (rand() - 0.5) * 3,
      y: Math.sin(t) * r * 0.8 + (rand() - 0.5) * 3,
    });
  }
  return pts;
})();

/**
 * A quick underline: ~120 points, mostly horizontal with a slight bow and
 * per-point jitter.
 */
export const underline: Point[] = (() => {
  const rand = mulberry32(23);
  const n = 120;
  const pts: Point[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    pts.push({
      x: t * 200 + (rand() - 0.5) * 2,
      y: Math.sin(t * Math.PI) * 6 + (rand() - 0.5) * 3,
    });
  }
  return pts;
})();

/**
 * A synthetic spiral of exactly 5,010 points (STROKE_MAX_POINTS + 10) for the
 * long-stroke split boundary: it crosses the 5,000-point limit mid-drag, so
 * a tool replaying it must commit two seamless parts.
 */
export const longSpiral: Point[] = (() => {
  const rand = mulberry32(42);
  const n = 5010;
  const pts: Point[] = [];
  for (let i = 0; i < n; i++) {
    const t = i * 0.05;
    const r = 4 + i * 0.05;
    pts.push({
      x: Math.cos(t) * r + (rand() - 0.5) * 0.5,
      y: Math.sin(t) * r + (rand() - 0.5) * 0.5,
    });
  }
  return pts;
})();
