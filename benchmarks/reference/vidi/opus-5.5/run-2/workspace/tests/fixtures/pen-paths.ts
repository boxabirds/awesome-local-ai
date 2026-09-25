/**
 * Story 11 pen paths, in world units at 100% zoom: realistic pointer input with jitter.
 * Generated deterministically (seeded) so tests are repeatable; the shapes mirror recorded
 * mouse input: a hand-drawn loop around a cluster, an underline and a very long spiral.
 */
import type { Point } from '../../src/shared/geometry';

/** Small deterministic PRNG (mulberry32). */
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

const r = (n: number) => Math.round(n * 100) / 100;

/** ~400 points: a slightly uneven loop (radius ~150) that overshoots its start, with ±0.8 jitter. */
export const HANDWRITTEN_LOOP: readonly Point[] = (() => {
  const rand = rng(11);
  const pts: Point[] = [];
  const n = 400;
  for (let i = 0; i < n; i += 1) {
    const t = (i / n) * Math.PI * 2.15;
    const radius = 150 + 12 * Math.sin(t * 3) + 6 * Math.cos(t * 5);
    pts.push({
      x: r(300 + radius * Math.cos(t) * 1.3 + (rand() - 0.5) * 1.6),
      y: r(250 + radius * Math.sin(t) + (rand() - 0.5) * 1.6),
    });
  }
  return pts;
})();

/** ~120 points: a left-to-right underline that drifts and wobbles slightly. */
export const UNDERLINE: readonly Point[] = (() => {
  const rand = rng(7);
  const pts: Point[] = [];
  for (let i = 0; i < 120; i += 1) {
    pts.push({ x: r(100 + i * 2.5 + (rand() - 0.5)), y: r(400 + i * 0.05 + Math.sin(i / 9) * 1.5 + (rand() - 0.5)) });
  }
  return pts;
})();

/** 5,010 points: a synthetic outward spiral (long stroke split boundary). */
export const LONG_SPIRAL: readonly Point[] = Array.from({ length: 5010 }, (_, i) => {
  const t = i / 40;
  const radius = 10 + i * 0.05;
  return { x: r(500 + radius * Math.cos(t)), y: r(500 + radius * Math.sin(t)) };
});
