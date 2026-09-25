/**
 * Story 11 fixture: realistic pointer paths in world units at 100% zoom.
 *
 * Real hardware recordings are not available in this environment, so the paths are generated
 * deterministically (seeded PRNG) to look like recorded mouse/trackpad input: uneven spacing
 * between samples, sub-pixel and 1-2 px jitter, a slight wobble in radius, and an overlapping
 * end (a hand-drawn loop never closes exactly).
 */
export interface PenPoint {
  readonly x: number;
  readonly y: number;
}

/** Mulberry32: small, deterministic PRNG so every run sees the same "recording". */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LOOP_POINTS = 400;
const LOOP_CENTRE = { x: 300, y: 250 } as const;
const LOOP_RADIUS = { x: 180, y: 120 } as const;
/** A little more than a full turn: the end overlaps the start. */
const LOOP_TURNS = 1.08;
const LOOP_JITTER = 1.6;
const LOOP_WOBBLE = 0.06;
const LOOP_SEED = 11;

/** A handwritten loop (~400 jittery points) around a cluster, clockwise from the left. */
export const HANDWRITTEN_LOOP: readonly PenPoint[] = (() => {
  const rand = prng(LOOP_SEED);
  const out: PenPoint[] = [];
  let t = 0;
  for (let i = 0; i < LOOP_POINTS; i += 1) {
    // Uneven sampling: the hand speeds up and slows down.
    t += (0.5 + rand()) / LOOP_POINTS;
    const angle = Math.PI + t * LOOP_TURNS * 2 * Math.PI;
    const wobble = 1 + LOOP_WOBBLE * Math.sin(angle * 3 + 0.7);
    out.push({
      x: LOOP_CENTRE.x + LOOP_RADIUS.x * wobble * Math.cos(angle) + (rand() - 0.5) * LOOP_JITTER,
      y: LOOP_CENTRE.y + LOOP_RADIUS.y * wobble * Math.sin(angle) + (rand() - 0.5) * LOOP_JITTER,
    });
  }
  return out;
})();

const UNDERLINE_POINTS = 120;
const UNDERLINE_START = { x: 100, y: 400 } as const;
const UNDERLINE_LENGTH = 260;
const UNDERLINE_SAG = 6;
const UNDERLINE_JITTER = 1.2;
const UNDERLINE_SEED = 7;

/** An underline (~120 points): left to right with a slight sag and jitter. */
export const UNDERLINE: readonly PenPoint[] = (() => {
  const rand = prng(UNDERLINE_SEED);
  const out: PenPoint[] = [];
  for (let i = 0; i < UNDERLINE_POINTS; i += 1) {
    const f = i / (UNDERLINE_POINTS - 1);
    out.push({
      x: UNDERLINE_START.x + f * UNDERLINE_LENGTH + (rand() - 0.5) * UNDERLINE_JITTER,
      y: UNDERLINE_START.y + Math.sin(f * Math.PI) * UNDERLINE_SAG + (rand() - 0.5) * UNDERLINE_JITTER,
    });
  }
  return out;
})();

export const SPIRAL_POINTS = 5010;
const SPIRAL_TURNS = 12;
const SPIRAL_MAX_RADIUS = 400;

/** A synthetic 5,010-point spiral (longer than STROKE_MAX_POINTS). */
export const SPIRAL: readonly PenPoint[] = (() => {
  const out: PenPoint[] = [];
  for (let i = 0; i < SPIRAL_POINTS; i += 1) {
    const f = i / (SPIRAL_POINTS - 1);
    const angle = f * SPIRAL_TURNS * 2 * Math.PI;
    out.push({ x: Math.cos(angle) * f * SPIRAL_MAX_RADIUS, y: Math.sin(angle) * f * SPIRAL_MAX_RADIUS });
  }
  return out;
})();
