import { describe, expect, it } from 'vitest';
import {
  GRID_SPACING_WORLD,
  UNBOUNDED_PAN_TESTED_EXTENT,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP_FACTOR,
} from '../../src/shared/config';
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
  type Camera,
  type Point,
  type Size,
} from '../../src/client/canvas/camera';

const ORIGIN: Camera = { x: 0, y: 0, zoom: 1 };
const VIEWPORT: Size = { width: 1200, height: 800 };
const CENTER: Point = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };
const FAR = UNBOUNDED_PAN_TESTED_EXTENT;

/** Tolerance for "exact within 1e-6" cases. */
const EPS = 1e-6;

describe('screenToWorld / worldToScreen', () => {
  it('are exact inverses of each other', () => {
    const cam: Camera = { x: -123.5, y: 45.25, zoom: 1.75 };
    const p: Point = { x: 300, y: 200 };
    expect(screenToWorld(cam, worldToScreen(cam, p))).toEqual(p);
  });
});

describe('panBy', () => {
  // TC-01: drag 200 px right, 100 px down at zoom 1 from origin.
  it('TC-01 moves the camera by -delta/zoom and the content by +delta at zoom 1', () => {
    const next = panBy(ORIGIN, 200, 100);
    expect(next.x).toBeCloseTo(0 - 200 / ORIGIN.zoom, 10);
    expect(next.y).toBeCloseTo(0 - 100 / ORIGIN.zoom, 10);
    expect(next.zoom).toBe(ORIGIN.zoom);
    // The world origin appears 200 px right and 100 px down on screen.
    const s = worldToScreen(next, { x: 0, y: 0 });
    expect(s.x).toBeCloseTo(200, 10);
    expect(s.y).toBeCloseTo(100, 10);
  });

  // TC-02: same drag at ZOOM_MAX, far away from the start.
  it('TC-02 pans by delta/zoom world units at ZOOM_MAX far from the origin', () => {
    const far: Camera = { x: FAR, y: FAR, zoom: ZOOM_MAX };
    const next = panBy(far, 200, 100);
    expect(next.x).toBeCloseTo(FAR - 200 / ZOOM_MAX, 10); // -50 world units
    expect(next.y).toBeCloseTo(FAR - 100 / ZOOM_MAX, 10); // -25 world units
    expect(Math.abs(next.x - (FAR - 200 / ZOOM_MAX))).toBeLessThan(EPS);
    expect(Math.abs(next.y - (FAR - 100 / ZOOM_MAX))).toBeLessThan(EPS);
  });

  it('returns the same object for a zero-length drag', () => {
    expect(panBy(ORIGIN, 0, 0)).toBe(ORIGIN);
  });
});

describe('zoomAt', () => {
  // TC-03: pointer invariance at the origin.
  it('TC-03 keeps the world point under the pointer fixed when zooming at a point', () => {
    const p: Point = { x: 300, y: 200 };
    const next = zoomAt(ORIGIN, p, 2);
    expect(next.zoom).toBeCloseTo(2, 10);
    const before = screenToWorld(ORIGIN, p);
    const after = screenToWorld(next, p);
    expect(Math.abs(after.x - before.x)).toBeLessThan(EPS);
    expect(Math.abs(after.y - before.y)).toBeLessThan(EPS);
  });

  // TC-04: pointer invariance at UNBOUNDED_PAN_TESTED_EXTENT.
  it('TC-04 keeps the pointer invariant far away from the origin', () => {
    const cam: Camera = { x: FAR, y: FAR, zoom: 1 };
    const p: Point = { x: 500, y: 250 };
    const next = zoomAt(cam, p, 1.5);
    const before = screenToWorld(cam, p);
    const after = screenToWorld(next, p);
    expect(Math.abs(after.x - before.x)).toBeLessThan(EPS);
    expect(Math.abs(after.y - before.y)).toBeLessThan(EPS);
  });

  // TC-05: at ZOOM_MIN zooming out further returns the SAME object.
  it('TC-05 returns the same camera object at ZOOM_MIN when zooming out', () => {
    const cam: Camera = { x: 0, y: 0, zoom: ZOOM_MIN };
    const next = zoomAt(cam, CENTER, 1 / ZOOM_STEP_FACTOR);
    expect(next).toBe(cam);
  });

  // TC-06: at ZOOM_MAX zooming in further returns the SAME object.
  it('TC-06 returns the same camera object at ZOOM_MAX when zooming in', () => {
    const cam: Camera = { x: 0, y: 0, zoom: ZOOM_MAX };
    const next = zoomAt(cam, CENTER, ZOOM_STEP_FACTOR);
    expect(next).toBe(cam);
  });

  // TC-11: huge finite factor clamps to ZOOM_MAX, invariance still holds.
  it('TC-11 clamps a huge factor and keeps the pointer invariant', () => {
    const p: Point = { x: 300, y: 200 };
    const before = screenToWorld(ORIGIN, p);
    const next = zoomAt(ORIGIN, p, 1000);
    expect(next.zoom).toBe(ZOOM_MAX);
    const after = screenToWorld(next, p);
    expect(Math.abs(after.x - before.x)).toBeLessThan(EPS);
    expect(Math.abs(after.y - before.y)).toBeLessThan(EPS);
  });

  // TC-12: invalid factors return the input camera unchanged, never NaN.
  it('TC-12 ignores invalid zoom factors (0, negative, NaN, ±Infinity)', () => {
    for (const factor of [0, -1, -ZOOM_STEP_FACTOR, NaN, Infinity, -Infinity]) {
      const next = zoomAt(ORIGIN, CENTER, factor);
      expect(next).toBe(ORIGIN);
      expect(Number.isFinite(next.x)).toBe(true);
      expect(Number.isFinite(next.y)).toBe(true);
      expect(Number.isFinite(next.zoom)).toBe(true);
    }
  });
});

describe('viewport resize', () => {
  // TC-07: resize is not user input to camera.math; operations that take a
  // viewport size must not mutate the camera and the camera carries no
  // viewport-derived state.
  it('TC-07 leaves the camera x, y, zoom unchanged when the viewport size changes', () => {
    const cam: Camera = { x: 100, y: 200, zoom: 1 };
    const snapshot = { ...cam };
    // zoomStep and resetCamera are the only functions that take a Size.
    zoomStep(cam, { width: 1920, height: 1080 }, 'in');
    resetCamera({ width: 800, height: 600 });
    expect(cam).toEqual(snapshot);
  });
});

describe('resetCamera', () => {
  // TC-08: reset at maximum zoom, far away.
  it('TC-08 returns zoom 1 with the world origin centred in the viewport', () => {
    const far: Camera = { x: FAR, y: FAR, zoom: ZOOM_MAX };
    void far; // reset does not depend on the current camera
    const next = resetCamera({ width: 1200, height: 800 });
    expect(next.zoom).toBe(1);
    expect(next.x).toBe(-1200 / 2);
    expect(next.y).toBe(-800 / 2);
    // The board's starting point (0,0) is at the centre of the area.
    const s = worldToScreen(next, { x: 0, y: 0 });
    expect(s.x).toBeCloseTo(1200 / 2, 10);
    expect(s.y).toBeCloseTo(800 / 2, 10);
  });
});

describe('zoomStep', () => {
  // TC-09: step in then out returns EXACTLY 1.0 (snap to ZOOM_STEP_FACTOR^n).
  it('TC-09 returns to exactly 1.0 after one step in and one step out', () => {
    const one = zoomStep(ORIGIN, VIEWPORT, 'in');
    expect(one.zoom).toBe(1 * ZOOM_STEP_FACTOR);
    expect(zoomPercent(one)).toBe(Math.round(ORIGIN.zoom * 100 * ZOOM_STEP_FACTOR));
    const back = zoomStep(one, VIEWPORT, 'out');
    expect(back.zoom).toBe(1);
    expect(zoomPercent(back)).toBe(100);
  });

  // TC-10: 20 steps in clamps at ZOOM_MAX and canZoomIn becomes false.
  it('TC-10 clamps after repeated steps in and disables zoom-in', () => {
    let cam: Camera = ORIGIN;
    for (let i = 0; i < 20; i++) cam = zoomStep(cam, VIEWPORT, 'in');
    expect(cam.zoom).toBe(ZOOM_MAX);
    expect(canZoomIn(cam)).toBe(false);
    // Further steps leave the camera identical (same object).
    expect(zoomStep(cam, VIEWPORT, 'in')).toBe(cam);
    // Zooming out re-enables zoom-in.
    const out = zoomStep(cam, VIEWPORT, 'out');
    expect(out.zoom).not.toBe(ZOOM_MAX);
    expect(canZoomIn(out)).toBe(true);
  });

  it('keeps the viewport centre invariant across a step', () => {
    const next = zoomStep(ORIGIN, VIEWPORT, 'in');
    const before = screenToWorld(ORIGIN, CENTER);
    const after = screenToWorld(next, CENTER);
    expect(Math.abs(after.x - before.x)).toBeLessThan(EPS);
    expect(Math.abs(after.y - before.y)).toBeLessThan(EPS);
  });
});

describe('canZoom / zoomPercent', () => {
  it('reports limits and the rounded percent', () => {
    expect(canZoomOut({ x: 0, y: 0, zoom: ZOOM_MIN })).toBe(false);
    expect(canZoomOut({ x: 0, y: 0, zoom: ZOOM_MIN * ZOOM_STEP_FACTOR })).toBe(true);
    expect(canZoomIn({ x: 0, y: 0, zoom: ZOOM_MAX })).toBe(false);
    expect(canZoomIn({ x: 0, y: 0, zoom: ZOOM_MAX / ZOOM_STEP_FACTOR })).toBe(true);
    expect(zoomPercent({ x: 0, y: 0, zoom: 1.5625 })).toBe(156);
    expect(zoomPercent({ x: 0, y: 0, zoom: ZOOM_MIN })).toBe(10);
    expect(zoomPercent({ x: 0, y: 0, zoom: ZOOM_MAX })).toBe(400);
  });
});

describe('grid stability far away', () => {
  it('grid lines stay evenly spaced at UNBOUNDED_PAN_TESTED_EXTENT', () => {
    const cam: Camera = { x: FAR, y: FAR, zoom: ZOOM_MAX };
    const screenSpacing = GRID_SPACING_WORLD * cam.zoom;
    // Screen positions of successive grid lines are integer multiples of the
    // spacing even this far from the origin.
    for (let k = 0; k < 3; k++) {
      const s = worldToScreen(cam, { x: FAR + k * GRID_SPACING_WORLD, y: FAR });
      expect(Math.abs(s.x - k * screenSpacing)).toBeLessThan(EPS);
    }
  });
});

describe('property: pointer invariance', () => {
  // Deterministic seeded PRNG (mulberry32) so the property check is stable.
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

  it('zoomAt keeps the world point under the pointer within 1e-6 for 1000 random inputs', () => {
    const rand = mulberry32(0x5eed);
    const range = (min: number, max: number) => min + rand() * (max - min);
    for (let i = 0; i < 1000; i++) {
      const cam: Camera = {
        x: range(-UNBOUNDED_PAN_TESTED_EXTENT, UNBOUNDED_PAN_TESTED_EXTENT),
        y: range(-UNBOUNDED_PAN_TESTED_EXTENT, UNBOUNDED_PAN_TESTED_EXTENT),
        zoom: range(ZOOM_MIN, ZOOM_MAX),
      };
      const p: Point = {
        x: range(0, 1920),
        y: range(0, 1080),
      };
      const factor = range(1 / ZOOM_STEP_FACTOR ** 3, ZOOM_STEP_FACTOR ** 3);
      const before = screenToWorld(cam, p);
      const next = zoomAt(cam, p, factor);
      expect(next.zoom).toBeGreaterThanOrEqual(ZOOM_MIN);
      expect(next.zoom).toBeLessThanOrEqual(ZOOM_MAX);
      const after = screenToWorld(next, p);
      expect(Math.abs(after.x - before.x)).toBeLessThan(EPS);
      expect(Math.abs(after.y - before.y)).toBeLessThan(EPS);
    }
  });
});
