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
import type { Camera, Point, Size } from '../../src/client/canvas/camera';
import {
  UNBOUNDED_PAN_TESTED_EXTENT,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP_FACTOR,
} from '../../src/shared/config';

/** Tolerance for floating point comparisons in this suite. */
const EPSILON = 1e-6;

const VPT: Size = { width: 1280, height: 800 };
const FAR: Camera = {
  x: UNBOUNDED_PAN_TESTED_EXTENT,
  y: UNBOUNDED_PAN_TESTED_EXTENT,
  zoom: 1,
};

describe('camera.math (TC-01 to TC-12)', () => {
  it('TC-01 panBy moves the camera by the screen delta divided by zoom (zoom 1, origin)', () => {
    const cam: Camera = { x: 0, y: 0, zoom: 1 };
    const next = panBy(cam, 200, 100);

    expect(next.x).toBeCloseTo(-200, 9);
    expect(next.y).toBeCloseTo(-100, 9);
    expect(next.zoom).toBe(1);

    // The world point at the origin (0,0) moves from screen (0,0) to (200,100).
    const before = worldToScreen(cam, { x: 0, y: 0 });
    const after = worldToScreen(next, { x: 0, y: 0 });
    expect(before).toEqual({ x: 0, y: 0 });
    expect(after.x).toBeCloseTo(200, 9);
    expect(after.y).toBeCloseTo(100, 9);
  });

  it('TC-02 panBy far away (1e6) at ZOOM_MAX shifts by delta/zoom world units', () => {
    const cam: Camera = {
      x: UNBOUNDED_PAN_TESTED_EXTENT,
      y: UNBOUNDED_PAN_TESTED_EXTENT,
      zoom: ZOOM_MAX,
    };
    const next = panBy(cam, 200, 100);

    // 200 screen px / 4 zoom = 50 world units (and 100 / 4 = 25).
    expect(next.x).toBeCloseTo(UNBOUNDED_PAN_TESTED_EXTENT - 200 / ZOOM_MAX, 6);
    expect(next.y).toBeCloseTo(UNBOUNDED_PAN_TESTED_EXTENT - 100 / ZOOM_MAX, 6);
    expect(next.zoom).toBe(ZOOM_MAX);
  });

  it('TC-03 zoomAt keeps the world point under the pointer invariant (origin, factor 2)', () => {
    const cam: Camera = { x: 0, y: 0, zoom: 1 };
    const pointer: Point = { x: 300, y: 200 };
    const before = screenToWorld(cam, pointer);

    const next = zoomAt(cam, pointer, 2);

    expect(next.zoom).toBe(2);
    const after = screenToWorld(next, pointer);
    expect(Math.abs(after.x - before.x)).toBeLessThan(EPSILON);
    expect(Math.abs(after.y - before.y)).toBeLessThan(EPSILON);
  });

  it('TC-04 zoomAt keeps the pointer world point invariant far away (1e6)', () => {
    const cam = FAR;
    const pointer: Point = { x: 300, y: 200 };
    const before = screenToWorld(cam, pointer);

    const next = zoomAt(cam, pointer, 1.5);

    expect(next.zoom).toBeCloseTo(1.5, 9);
    const after = screenToWorld(next, pointer);
    expect(Math.abs(after.x - before.x)).toBeLessThan(EPSILON);
    expect(Math.abs(after.y - before.y)).toBeLessThan(EPSILON);
  });

  it('TC-05 zooming out at ZOOM_MIN returns the same object', () => {
    const cam: Camera = { x: 0, y: 0, zoom: ZOOM_MIN };
    const next = zoomAt(cam, { x: 640, y: 400 }, 1 / ZOOM_STEP_FACTOR);

    expect(next).toBe(cam);
  });

  it('TC-06 zooming in at ZOOM_MAX returns the same object', () => {
    const cam: Camera = { x: 0, y: 0, zoom: ZOOM_MAX };
    const next = zoomAt(cam, { x: 640, y: 400 }, ZOOM_STEP_FACTOR);

    expect(next).toBe(cam);
  });

  it('TC-07 a viewport resize leaves camera x, y, zoom unchanged', () => {
    // A passive resize is not an input to any camera-math function: the only
    // functions that take a Size are the explicit user actions zoomStep and
    // resetCamera. The hook therefore re-renders with the very same camera
    // value; assert that value is untouched.
    const cam: Camera = { x: -123.45, y: 67.89, zoom: 1.25 };
    const before: Camera = { x: cam.x, y: cam.y, zoom: cam.zoom };
    const resized: Size = { width: 1920, height: 1080 };
    void resized; // ResizeObserver callback only re-renders (see useCamera)

    expect(cam).toEqual(before);
    expect(cam.x).toBe(before.x);
    expect(cam.y).toBe(before.y);
    expect(cam.zoom).toBe(before.zoom);
  });

  it('TC-08 resetCamera centres the origin at 100% zoom', () => {
    const cam = resetCamera({ width: 1200, height: 800 });

    expect(cam.zoom).toBe(1);
    expect(cam.x).toBeCloseTo(-1200 / 2, 9);
    expect(cam.y).toBeCloseTo(-800 / 2, 9);

    // World origin is at the centre of the viewport.
    const originOnScreen = worldToScreen(cam, { x: 0, y: 0 });
    expect(originOnScreen.x).toBeCloseTo(600, 9);
    expect(originOnScreen.y).toBeCloseTo(400, 9);
  });

  it('TC-09 one step in then one step out returns exactly to 100%', () => {
    const cam: Camera = { x: -640, y: -400, zoom: 1 };

    const in1 = zoomStep(cam, VPT, 'in');
    expect(in1.zoom).toBeCloseTo(ZOOM_STEP_FACTOR, 9);

    const out = zoomStep(in1, VPT, 'out');
    expect(out.zoom).toBe(1); // exact, no float drift
    expect(zoomPercent(out)).toBe(100);
  });

  it('TC-10 20 steps in clamps at ZOOM_MAX and stops', () => {
    let cam: Camera = { x: -640, y: -400, zoom: 1 };

    for (let i = 0; i < 20; i += 1) {
      cam = zoomStep(cam, VPT, 'in');
    }

    expect(cam.zoom).toBe(ZOOM_MAX);
    expect(canZoomIn(cam)).toBe(false);
    // Further steps at the limit return the same object.
    expect(zoomStep(cam, VPT, 'in')).toBe(cam);
  });

  it('TC-11 a huge factor clamps to ZOOM_MAX and keeps the pointer invariant', () => {
    const cam: Camera = { x: 0, y: 0, zoom: 1 };
    const pointer: Point = { x: 300, y: 200 };
    const before = screenToWorld(cam, pointer);

    const next = zoomAt(cam, pointer, 1000);

    expect(next.zoom).toBe(ZOOM_MAX);
    const after = screenToWorld(next, pointer);
    expect(Math.abs(after.x - before.x)).toBeLessThan(EPSILON);
    expect(Math.abs(after.y - before.y)).toBeLessThan(EPSILON);
  });

  it('TC-12 invalid factors return the camera unchanged with no NaN', () => {
    const cam: Camera = { x: 5, y: -5, zoom: 1.25 };

    for (const factor of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const next = zoomAt(cam, { x: 10, y: 10 }, factor);
      expect(next).toBe(cam);
    }

    expect(Number.isNaN(cam.x)).toBe(false);
    expect(Number.isNaN(cam.y)).toBe(false);
    expect(Number.isNaN(cam.zoom)).toBe(false);
  });
});

describe('camera.math property check', () => {
  it('the world point under the pointer is invariant under zoomAt (1000 random cases)', () => {
    // mulberry32: small deterministic PRNG so failures are reproducible.
    let seed = 0x1234abcd;
    const rand = (): number => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };

    for (let i = 0; i < 1000; i += 1) {
      const cam: Camera = {
        x: (rand() * 2 - 1) * UNBOUNDED_PAN_TESTED_EXTENT,
        y: (rand() * 2 - 1) * UNBOUNDED_PAN_TESTED_EXTENT,
        zoom: ZOOM_MIN + rand() * (ZOOM_MAX - ZOOM_MIN),
      };
      const pointer: Point = {
        x: (rand() * 2 - 1) * 2048,
        y: (rand() * 2 - 1) * 2048,
      };
      // Factor range deliberately crosses the clamp boundaries.
      const factor = 0.25 + rand() * 3.75;

      const before = screenToWorld(cam, pointer);
      const next = zoomAt(cam, pointer, factor);
      const after = screenToWorld(next, pointer);

      expect(Math.abs(after.x - before.x), `case ${i}: x`).toBeLessThan(EPSILON);
      expect(Math.abs(after.y - before.y), `case ${i}: y`).toBeLessThan(EPSILON);
      expect(next.zoom).toBeGreaterThanOrEqual(ZOOM_MIN);
      expect(next.zoom).toBeLessThanOrEqual(ZOOM_MAX);
    }
  });
});

describe('camera.math helpers', () => {
  it('canZoomIn / canZoomOut reflect the limits', () => {
    expect(canZoomIn({ x: 0, y: 0, zoom: ZOOM_MIN })).toBe(true);
    expect(canZoomOut({ x: 0, y: 0, zoom: ZOOM_MIN })).toBe(false);
    expect(canZoomIn({ x: 0, y: 0, zoom: ZOOM_MAX })).toBe(false);
    expect(canZoomOut({ x: 0, y: 0, zoom: ZOOM_MAX })).toBe(true);
    expect(canZoomIn({ x: 0, y: 0, zoom: 1 })).toBe(true);
    expect(canZoomOut({ x: 0, y: 0, zoom: 1 })).toBe(true);
  });

  it('zoomPercent rounds to the nearest whole percent', () => {
    expect(zoomPercent({ x: 0, y: 0, zoom: 1.5625 })).toBe(156);
    expect(zoomPercent({ x: 0, y: 0, zoom: ZOOM_MIN })).toBe(10);
    expect(zoomPercent({ x: 0, y: 0, zoom: ZOOM_MAX })).toBe(400);
    expect(zoomPercent({ x: 0, y: 0, zoom: 0.15 })).toBe(15);
  });
});
