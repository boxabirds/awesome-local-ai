// Story 11: recorded realistic pointer paths, generated deterministically so
// unit/component/e2e tests see identical point sequences.

import type { Point } from '../../src/shared/geometry';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Handwritten cursive loop ("e" flourish), 400 points with pointer jitter.
export function handwrittenLoop(): Point[] {
  const rand = mulberry32(11);
  const pts: Point[] = [];
  const n = 400;
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * Math.PI * 4;
    const x = 100 + 30 * t + 24 * Math.cos(t) + (rand() - 0.5) * 1.6;
    const y = 200 + 28 * Math.sin(t * 1.5) + (rand() - 0.5) * 1.6;
    pts.push({ x, y });
  }
  return pts;
}

// A quick underline stroke, 120 points with slight wobble.
export function underlineStroke(): Point[] {
  const rand = mulberry32(22);
  const pts: Point[] = [];
  const n = 120;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const x = 500 + 260 * t + (rand() - 0.5) * 0.8;
    const y = 300 + 3 * Math.sin(t * Math.PI * 6) + (rand() - 0.5) * 1.2;
    pts.push({ x, y });
  }
  return pts;
}

// Synthetic 5,010-point spiral, one point past STROKE_MAX_POINTS + 9 moves
// (pointerdown contributes the first point in TC-12).
export function longSpiral(count = 5010): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i < count; i++) {
    const t = i * 0.05;
    pts.push({ x: 600 + t * Math.cos(t), y: 600 + t * Math.sin(t) });
  }
  return pts;
}
