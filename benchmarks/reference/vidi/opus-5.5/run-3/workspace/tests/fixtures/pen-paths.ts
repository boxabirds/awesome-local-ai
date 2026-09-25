// Story 11: realistic pointer paths for the Pen tool, in screen px relative to a start point. Generated with a
// fixed-seed jitter so every run replays exactly the same "recorded" input.
import type { Point } from '../../src/shared/geometry';

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** A hand-drawn loop around a cluster (~400 points): an ellipse that overshoots its start, with hand jitter. */
export const HANDWRITTEN_LOOP: readonly Point[] = (() => {
  const rnd = seeded(11);
  const out: Point[] = [];
  const n = 400;
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2.15;
    const r = 1 + 0.06 * Math.sin(3 * t);
    out.push({
      x: Math.round((140 * r * Math.cos(t) + (rnd() - 0.5) * 1.6) * 100) / 100,
      y: Math.round((90 * r * Math.sin(t) + (rnd() - 0.5) * 1.6) * 100) / 100,
    });
  }
  return out;
})();

/** A quick underline (~120 points): mostly horizontal with a slight wobble and drift. */
export const UNDERLINE: readonly Point[] = (() => {
  const rnd = seeded(7);
  const out: Point[] = [];
  for (let i = 0; i < 120; i++) {
    out.push({ x: i * 2.5, y: Math.round((Math.sin(i / 9) * 1.5 + i * 0.04 + (rnd() - 0.5)) * 100) / 100 });
  }
  return out;
})();

/** A synthetic spiral of 5,010 points (just over STROKE_MAX_POINTS). */
export const LONG_SPIRAL: readonly Point[] = (() => {
  const out: Point[] = [];
  for (let i = 0; i < 5010; i++) {
    const t = i / 40;
    const r = 10 + i * 0.05;
    out.push({ x: Math.round(r * Math.cos(t) * 100) / 100, y: Math.round(r * Math.sin(t) * 100) / 100 });
  }
  return out;
})();

/** `path` moved so it starts at `at`. */
export function translatePath(path: readonly Point[], at: Point): Point[] {
  return path.map((p) => ({ x: p.x + at.x, y: p.y + at.y }));
}
