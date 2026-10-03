/**
 * Story 11 fixtures: hand-authored freehand paths, in screen coordinates, for the browser suite.
 *
 * They are deliberately *not* exact. A circle with a little jitter in the radius is what a person's
 * wobbly hand produces, and it is what the simplifier is asked to smooth without erasing: a real
 * curve, still inside a pixel of the original. The spiral is long on purpose — past the maximum
 * points a single stroke may hold — so the browser can be shown splitting one pen stroke into two.
 */
import type { ScreenPoint } from '../e2e/helpers/board';

/** Roughly 400 jittery points tracing a closed loop (a hand-drawn circle). */
export function loopPath(
  centre: ScreenPoint,
  radius: number,
  options: { points?: number; wobble?: number; seed?: number } = {},
): ScreenPoint[] {
  const count = options.points ?? 400;
  const wobble = options.wobble ?? 6;
  let s = options.seed ?? 12345;
  const rand = () => {
    // A tiny deterministic generator, so a run is reproducible without being exact-looking.
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff - 0.5;
  };
  const out: ScreenPoint[] = [];
  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * Math.PI * 2;
    const r = radius + rand() * wobble;
    out.push({
      x: centre.x + Math.cos(angle) * r,
      y: centre.y + Math.sin(angle) * r,
    });
  }
  return out;
}

/** Roughly 120 slightly wavy points tracing a horizontal underline. */
export function underlinePath(
  from: ScreenPoint,
  length: number,
  options: { points?: number; wave?: number; seed?: number } = {},
): ScreenPoint[] {
  const count = options.points ?? 120;
  const wave = options.wave ?? 3;
  let s = options.seed ?? 54321;
  const rand = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff - 0.5;
  };
  const out: ScreenPoint[] = [];
  for (let i = 0; i < count; i += 1) {
    const t = i / (count - 1);
    out.push({
      x: from.x + t * length,
      y: from.y + Math.sin(t * Math.PI * 3) * wave + rand() * wave * 0.5,
    });
  }
  return out;
}

/** More than STROKE_MAX_POINTS points tracing a spiral, to force a split. */
export function spiralPath(
  centre: ScreenPoint,
  maxRadius: number,
  options: { points?: number; turns?: number } = {},
): ScreenPoint[] {
  const count = options.points ?? 5010;
  const turns = options.turns ?? 26;
  const out: ScreenPoint[] = [];
  for (let i = 0; i < count; i += 1) {
    const t = i / (count - 1);
    const angle = t * turns * Math.PI * 2;
    const r = t * maxRadius;
    out.push({ x: centre.x + Math.cos(angle) * r, y: centre.y + Math.sin(angle) * r });
  }
  return out;
}
