/**
 * Story 11: deterministic "recorded pen" fixture paths for the unit,
 * component and e2e tests (they replace hand-written mouse paths).
 *
 * All coordinates are world units. The shapes are generated with a seeded
 * PRNG so every run (and every test file) sees exactly the same points.
 */
import { STROKE_MAX_POINTS } from '../../src/shared/config';
import type { Point } from '../../src/shared/geometry';

/** A small, deterministic PRNG (mulberry32). */
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
 * A hand-drawn loop: ~400 jittered points circling (300, 250) and crossing
 * over themselves, like a real pen gesture replayed at pointer-event
 * frequency.
 */
export const handwrittenLoop: readonly Point[] = (() => {
  const rand = mulberry32(0x5eed1);
  const n = 400;
  const pts: Point[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * Math.PI * 2 * 1.25; // 1¼ turns, so it self-crosses
    const r = 90 + 10 * Math.sin(3 * t) + (rand() - 0.5) * 8;
    pts.push({
      x: 300 + r * Math.cos(t) + (rand() - 0.5) * 2,
      y: 250 + r * Math.sin(t) * 0.85 + (rand() - 0.5) * 2,
    });
  }
  return pts;
})();

/** A short, mostly-straight underline: ~120 points along y ≈ 470. */
export const underline: readonly Point[] = (() => {
  const rand = mulberry32(0x5eed2);
  const n = 120;
  const pts: Point[] = [];
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1);
    pts.push({
      x: 400 + u * 160 + (rand() - 0.5) * 1.5,
      y: 470 + 2 * Math.sin(u * Math.PI * 2) + (rand() - 0.5) * 1.5,
    });
  }
  return pts;
})();

/**
 * A synthetic spiral with exactly `STROKE_MAX_POINTS + 10` points — the
 * boundary fixture for the split-at-max-points behaviour.
 */
export const longSpiral: readonly Point[] = (() => {
  const n = STROKE_MAX_POINTS + 10;
  const pts: Point[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2 * 6;
    const r = 5 + (i / n) * 90;
    pts.push({ x: 640 + r * Math.cos(t), y: 400 + r * Math.sin(t) });
  }
  return pts;
})();
