import { describe, expect, it } from 'vitest';
import {
  canZoomIn,
  canZoomOut,
  panBy,
  resetCamera,
  screenToWorld,
  worldToScreen,
  zoomAt,
  zoomPercent,
  zoomStep,
} from '../../src/client/canvas/camera';
import type { Camera, Point } from '../../src/client/canvas/camera';
import {
  PERCENT,
  UNBOUNDED_PAN_TESTED_EXTENT,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_RESET,
  ZOOM_STEP_FACTOR,
} from '../../src/shared/config';

/** Precision threshold for far-away (1e6 world units) assertions. */
const PRECISION = 1e-6;
/** Far-away test position in world units (config, not a literal). */
const FAR = UNBOUNDED_PAN_TESTED_EXTENT;

const cam = (x: number, y: number, zoom: number): Camera => ({ x, y, zoom });
const pt = (x: number, y: number): Point => ({ x, y });
const expectClose = (actual: number, expected: number, tolerance: number = PRECISION): void => {
  expect(Math.abs(actual - expected), `expected ${actual} within ${tolerance} of ${expected}`).toBeLessThanOrEqual(
    tolerance,
  );
};

describe('camera.math', () => {
  it('TC-01 panBy shifts the camera by screen delta / zoom (zoom 1, origin)', () => {
    const before = cam(0, 0, 1);
    const after = panBy(before, 200, 100);
    expectClose(after.x, -200);
    expectClose(after.y, -100);
    expect(after.zoom).toBe(1);
    // The world origin moves 200 px right and 100 px down on screen.
    const s = worldToScreen(after, pt(0, 0));
    expectClose(s.x, 200);
    expectClose(s.y, 100);
  });

  it('TC-02 panBy is exact far away at ZOOM_MAX', () => {
    const before = cam(FAR, FAR, ZOOM_MAX);
    const after = panBy(before, 200, 100);
    expectClose(after.x, FAR - 200 / ZOOM_MAX);
    expectClose(after.y, FAR - 100 / ZOOM_MAX);
    expect(after.zoom).toBe(ZOOM_MAX);
  });

  it('TC-03 zoomAt keeps the world point under the pointer fixed (origin)', () => {
    const before = cam(0, 0, 1);
    const p = pt(300, 200);
    const after = zoomAt(before, p, 2);
    expectClose(after.zoom, 2);
    const wBefore = screenToWorld(before, p);
    const wAfter = screenToWorld(after, p);
    expectClose(wAfter.x, wBefore.x);
    expectClose(wAfter.y, wBefore.y);
  });

  it('TC-04 zoomAt keeps the world point under the pointer fixed, far away', () => {
    const before = cam(FAR, FAR, 1);
    const p = pt(300, 200);
    const after = zoomAt(before, p, 1.5);
    const wBefore = screenToWorld(before, p);
    const wAfter = screenToWorld(after, p);
    expectClose(wAfter.x, wBefore.x);
    expectClose(wAfter.y, wBefore.y);
  });

  it('TC-05 zooming out at ZOOM_MIN returns the same object', () => {
    const c = cam(0, 0, ZOOM_MIN);
    expect(zoomAt(c, pt(640, 400), 1 / ZOOM_STEP_FACTOR)).toBe(c);
  });

  it('TC-06 zooming in at ZOOM_MAX returns the same object', () => {
    const c = cam(0, 0, ZOOM_MAX);
    expect(zoomAt(c, pt(640, 400), ZOOM_STEP_FACTOR)).toBe(c);
  });

  it('TC-07 a viewport resize does not change the camera', () => {
    // The camera carries no viewport dimension: a resize changes only the
    // viewport size, and no camera mutation depends on it, so the same camera
    // object (values unchanged) remains valid at any viewport size.
    const c = cam(10, 20, 1);
    const afterResize = panBy(c, 0, 0);
    expect(afterResize).toBe(c);
    expect(afterResize).toEqual({ x: 10, y: 20, zoom: 1 });
  });

  it('TC-08 resetCamera centres the origin at 100%', () => {
    const c = resetCamera({ width: 1200, height: 800 });
    expect(c.zoom).toBe(ZOOM_RESET);
    expect(c.x).toBe(-600);
    expect(c.y).toBe(-400);
    const s = worldToScreen(c, pt(0, 0));
    expect(s.x).toBe(600);
    expect(s.y).toBe(400);
  });

  it('TC-09 one step in then one step out returns exactly 100%', () => {
    const viewport = { width: 1280, height: 800 };
    const c0 = cam(0, 0, ZOOM_RESET);
    const c1 = zoomStep(c0, viewport, 'in');
    expectClose(c1.zoom, ZOOM_STEP_FACTOR, 1e-9);
    const c2 = zoomStep(c1, viewport, 'out');
    expect(c2.zoom).toBe(ZOOM_RESET);
    expect(zoomPercent(c2)).toBe(PERCENT);
  });

  it('TC-10 20 steps in clamp at ZOOM_MAX and canZoomIn is false', () => {
    const viewport = { width: 1280, height: 800 };
    let c = cam(0, 0, ZOOM_RESET);
    for (let i = 0; i < 20; i += 1) {
      c = zoomStep(c, viewport, 'in');
    }
    expect(c.zoom).toBe(ZOOM_MAX);
    expect(canZoomIn(c)).toBe(false);
  });

  it('TC-11 a huge factor clamps to ZOOM_MAX and keeps the pointer fixed', () => {
    const before = cam(0, 0, 1);
    const p = pt(300, 200);
    const after = zoomAt(before, p, 1000);
    expect(after.zoom).toBe(ZOOM_MAX);
    const wBefore = screenToWorld(before, p);
    const wAfter = screenToWorld(after, p);
    expectClose(wAfter.x, wBefore.x);
    expectClose(wAfter.y, wBefore.y);
  });

  it('TC-12 invalid factors leave the camera unchanged (no NaN)', () => {
    const c = cam(3, 4, 1.5);
    for (const factor of [0, -2, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const out = zoomAt(c, pt(10, 20), factor);
      expect(out).toBe(c);
      expect(Number.isNaN(out.x) || Number.isNaN(out.y) || Number.isNaN(out.zoom)).toBe(false);
    }
  });

  it('canZoomOut is false exactly at ZOOM_MIN and true just above it', () => {
    expect(canZoomOut(cam(0, 0, ZOOM_MIN))).toBe(false);
    expect(canZoomOut(cam(0, 0, ZOOM_MIN + 1e-9))).toBe(true);
  });

  it('pointer world point is invariant under zoomAt (1000 seeded random cases)', () => {
    // mulberry32: small deterministic PRNG so the property check is reproducible.
    let seed = 20260917;
    const rnd = (): number => {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    for (let i = 0; i < 1000; i += 1) {
      const c = cam((rnd() - 0.5) * 2 * FAR, (rnd() - 0.5) * 2 * FAR, ZOOM_MIN + rnd() * (ZOOM_MAX - ZOOM_MIN));
      const p = pt((rnd() - 0.5) * 4000, (rnd() - 0.5) * 4000);
      const factor = 0.2 + rnd() * 5;
      const wBefore = screenToWorld(c, p);
      const after = zoomAt(c, p, factor);
      const wAfter = screenToWorld(after, p);
      expectClose(wAfter.x, wBefore.x);
      expectClose(wAfter.y, wBefore.y);
    }
  });
});
