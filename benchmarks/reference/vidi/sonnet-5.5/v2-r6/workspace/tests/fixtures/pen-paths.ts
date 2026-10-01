import type { Point } from '../../src/shared/geometry';

/** Small deterministic pseudo-random generator so the "recorded" paths are identical on every run. */
function rng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

/** A handwritten loop around (300, 300): about 400 points with hand jitter. */
export function handwrittenLoop(): Point[] {
  const r = rng(11);
  const out: Point[] = [];
  const n = 400;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2.1;
    const wobble = 1 + 0.08 * Math.sin(a * 3);
    out.push({
      x: 300 + 140 * wobble * Math.cos(a) + (r() - 0.5) * 1.6,
      y: 300 + 100 * wobble * Math.sin(a) + (r() - 0.5) * 1.6,
    });
  }
  return out;
}

/** A slightly sloping underline of about 120 points. */
export function underline(): Point[] {
  const r = rng(7);
  const out: Point[] = [];
  for (let i = 0; i < 120; i++) {
    out.push({ x: 100 + i * 3, y: 500 + i * 0.05 + Math.sin(i / 9) * 2 + (r() - 0.5) * 1.2 });
  }
  return out;
}

/** A synthetic spiral of 5,010 points. */
export function spiral(): Point[] {
  const out: Point[] = [];
  const n = 5010;
  for (let i = 0; i < n; i++) {
    const a = i * 0.05;
    const rad = 20 + i * 0.03;
    out.push({ x: 400 + rad * Math.cos(a), y: 400 + rad * Math.sin(a) });
  }
  return out;
}
