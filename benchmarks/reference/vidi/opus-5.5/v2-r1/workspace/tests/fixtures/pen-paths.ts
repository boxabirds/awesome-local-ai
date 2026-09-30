// Realistic pointer paths for pen tests (story 11), in screen px relative to a start point.
// Generated deterministically (seeded jitter) so every run replays the same "recording".
import type { Point } from '../../src/shared/geometry';

function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** A hand-drawn loop around a cluster (~400 points), with hand jitter and uneven speed. */
export const HANDWRITTEN_LOOP: readonly Point[] = (() => {
  const rnd = seeded(11);
  const pts: Point[] = [];
  const n = 400;
  for (let i = 0; i < n; i++) {
    // Slightly more than a full turn, slowing down near the end, like a real circling gesture.
    const t = (i / (n - 1)) ** 0.9 * Math.PI * 2.15;
    const rx = 180 + 12 * Math.sin(t * 3);
    const ry = 120 + 8 * Math.cos(t * 2);
    pts.push({
      x: Math.round((rx * Math.cos(t) + (rnd() - 0.5) * 1.6) * 10) / 10,
      y: Math.round((ry * Math.sin(t) + (rnd() - 0.5) * 1.6) * 10) / 10,
    });
  }
  return pts;
})();

/** A quick underline (~120 points), mostly horizontal with a small drift. */
export const UNDERLINE: readonly Point[] = (() => {
  const rnd = seeded(7);
  const pts: Point[] = [];
  for (let i = 0; i < 120; i++) {
    pts.push({ x: i * 2.5, y: Math.round((Math.sin(i / 20) * 3 + (rnd() - 0.5)) * 10) / 10 });
  }
  return pts;
})();

/** A synthetic 5,010-point spiral (beyond STROKE_MAX_POINTS), every point distinct. */
export const LONG_SPIRAL: readonly Point[] = (() => {
  const pts: Point[] = [];
  for (let i = 0; i < 5010; i++) {
    const t = i / 40;
    const r = 20 + i * 0.05;
    pts.push({ x: r * Math.cos(t), y: r * Math.sin(t) });
  }
  return pts;
})();
