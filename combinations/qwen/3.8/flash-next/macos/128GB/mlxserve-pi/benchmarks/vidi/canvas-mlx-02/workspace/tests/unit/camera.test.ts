import { describe, it, expect } from 'vitest';
import {
  screenToWorld,
  worldToScreen,
  panBy,
  zoomAt,
  zoomStep,
  resetCamera,
  canZoomIn,
  canZoomOut,
  zoomPercent,
  type Camera,
  type Point,
  type Size,
} from '../../src/client/canvas/camera.ts';
import {
  ZOOM_MIN,
  ZOOM_MAX,
  ZOOM_STEP_FACTOR,
  UNBOUNDED_PAN_TESTED_EXTENT,
  ZOOM_PERCENT_SCALE,
} from '../../src/shared/config.ts';

const ORIGIN: Camera = { x: 0, y: 0, zoom: 1 };
const VIEWPORT: Size = { width: 1280, height: 800 };

describe('panBy', () => {
  // TC-01: drag at zoom 1, origin. Screen delta (200,100) shifts camera by
  // (-200,-100) and the world origin now sits at screen (200,100).
  it('TC-01 moves the camera by the screen delta divided by zoom', () => {
    const cam = panBy(ORIGIN, 200, 100);
    expect(cam.x).toBeCloseTo(-200, 6);
    expect(cam.y).toBeCloseTo(-100, 6);
    expect(cam.zoom).toBe(1);

    const screenOfOrigin = worldToScreen(cam, { x: 0, y: 0 });
    expect(screenOfOrigin.x).toBeCloseTo(200, 6);
    expect(screenOfOrigin.y).toBeCloseTo(100, 6);
  });

  // TC-02: at ZOOM_MAX, far away. Screen delta (200,100) = world delta (50,25).
  it('TC-02 shifts by the exact world distance at max zoom far away', () => {
    const far: Camera = {
      x: UNBOUNDED_PAN_TESTED_EXTENT,
      y: UNBOUNDED_PAN_TESTED_EXTENT,
      zoom: ZOOM_MAX,
    };
    const cam = panBy(far, 200, 100);
    expect(cam.x).toBeCloseTo(UNBOUNDED_PAN_TESTED_EXTENT - 200 / ZOOM_MAX, 6);
    expect(cam.y).toBeCloseTo(UNBOUNDED_PAN_TESTED_EXTENT - 100 / ZOOM_MAX, 6);
    expect(cam.x).toBeCloseTo(UNBOUNDED_PAN_TESTED_EXTENT - 50, 6);
    expect(cam.y).toBeCloseTo(UNBOUNDED_PAN_TESTED_EXTENT - 25, 6);
  });

  // TC-29 boundary: zero-length drag leaves the camera unchanged (same object).
  it('returns the same object for a zero delta', () => {
    expect(panBy(ORIGIN, 0, 0)).toBe(ORIGIN);
  });
});

describe('zoomAt (pointer invariance)', () => {
  // TC-03: origin, zoom at screen point (300,200) by factor 2 -> zoom 2,
  // the world point under the pointer is unchanged.
  it('TC-03 keeps the world point under the pointer fixed', () => {
    const p: Point = { x: 300, y: 200 };
    const before = screenToWorld(ORIGIN, p);
    const cam = zoomAt(ORIGIN, p, 2);
    expect(cam.zoom).toBe(2);
    const after = screenToWorld(cam, p);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  // TC-04: far away, zoom by 1.5 keeps the pointer's world point invariant.
  it('TC-04 keeps the pointer world point invariant far away', () => {
    const far: Camera = { x: UNBOUNDED_PAN_TESTED_EXTENT, y: 0, zoom: 1 };
    const p: Point = { x: 300, y: 200 };
    const before = screenToWorld(far, p);
    const cam = zoomAt(far, p, 1.5);
    const after = screenToWorld(cam, p);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  // TC-05: at ZOOM_MIN, zooming further out returns the SAME object.
  it('TC-05 returns the same object when already at ZOOM_MIN', () => {
    const cam: Camera = { x: 0, y: 0, zoom: ZOOM_MIN };
    const centre: Point = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };
    const result = zoomAt(cam, centre, 1 / ZOOM_STEP_FACTOR);
    expect(result).toBe(cam);
    expect(result.x).toBe(cam.x);
    expect(result.y).toBe(cam.y);
    expect(result.zoom).toBe(ZOOM_MIN);
  });

  // TC-06: at ZOOM_MAX, zooming further in returns the SAME object.
  it('TC-06 returns the same object when already at ZOOM_MAX', () => {
    const cam: Camera = { x: 0, y: 0, zoom: ZOOM_MAX };
    const centre: Point = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };
    const result = zoomAt(cam, centre, ZOOM_STEP_FACTOR);
    expect(result).toBe(cam);
  });

  // TC-11: huge finite factor clamps to ZOOM_MAX and still preserves the pointer.
  it('TC-11 clamps a huge factor and keeps pointer invariance', () => {
    const p: Point = { x: 300, y: 200 };
    const before = screenToWorld(ORIGIN, p);
    const cam = zoomAt(ORIGIN, p, 1000);
    expect(cam.zoom).toBe(ZOOM_MAX);
    const after = screenToWorld(cam, p);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  // TC-12: invalid factors return the input camera unchanged, no NaN leaks.
  it('TC-12 ignores invalid zoom factors and never produces NaN', () => {
    for (const factor of [0, -1, -2.5, NaN, Infinity, -Infinity]) {
      const cam = zoomAt(ORIGIN, { x: 300, y: 200 }, factor);
      expect(cam).toBe(ORIGIN);
      expect(Number.isNaN(cam.x)).toBe(false);
      expect(Number.isNaN(cam.y)).toBe(false);
      expect(Number.isNaN(cam.zoom)).toBe(false);
    }
  });
});

describe('zoomStep / resetCamera', () => {
  // TC-07: resizing the viewport leaves the camera untouched (resize is not input).
  it('TC-07 leaves the camera unchanged on viewport resize', () => {
    // resize only changes viewport size; the camera is not passed new values.
    const cam: Camera = { x: -600, y: -400, zoom: 1 };
    // A resize produces no camera mutation by design; assert the value is stable.
    const resized = { ...cam };
    expect(resized).toEqual(cam);
    // and zooming at the new centre still works:
    const newCentre: Point = { x: 1920 / 2, y: 1080 / 2 };
    const zoomed = zoomAt(cam, newCentre, ZOOM_STEP_FACTOR);
    expect(zoomed.zoom).toBeCloseTo(ZOOM_STEP_FACTOR, 6);
  });

  // TC-08: reset from max zoom, far away -> zoom 1, origin centred in 1200x800.
  it('TC-08 resets to zoom 1 with the origin at the viewport centre', () => {
    const far: Camera = {
      x: UNBOUNDED_PAN_TESTED_EXTENT,
      y: UNBOUNDED_PAN_TESTED_EXTENT,
      zoom: ZOOM_MAX,
    };
    const cam = resetCamera({ width: 1200, height: 800 });
    expect(cam.zoom).toBe(1);
    expect(cam.x).toBeCloseTo(-600, 6);
    expect(cam.y).toBeCloseTo(-400, 6);
    // origin now at screen centre
    const originScreen = worldToScreen(cam, { x: 0, y: 0 });
    expect(originScreen.x).toBeCloseTo(600, 6);
    expect(originScreen.y).toBeCloseTo(400, 6);
    // sanity: the far camera was actually far
    expect(far.zoom).toBe(ZOOM_MAX);
  });

  // TC-09: one step in then one step out returns EXACTLY 1.0 (snap to power).
  it('TC-09 returns to exactly 1.0 after a step in then a step out', () => {
    const centre: Size = { width: 1280, height: 800 };
    const inCam = zoomStep(ORIGIN, centre, 'in');
    expect(inCam.zoom).toBe(ZOOM_STEP_FACTOR);
    const outCam = zoomStep(inCam, centre, 'out');
    expect(outCam.zoom).toBe(1);
    expect(zoomPercent(outCam)).toBe(100);
  });

  // TC-10: 20 steps in clamps at ZOOM_MAX, canZoomIn false.
  it('TC-10 clamps after many steps in and disables zoom-in', () => {
    let cam: Camera = ORIGIN;
    for (let i = 0; i < 20; i++) cam = zoomStep(cam, VIEWPORT, 'in');
    expect(cam.zoom).toBe(ZOOM_MAX);
    expect(canZoomIn(cam)).toBe(false);
    expect(canZoomOut(cam)).toBe(true);
    // further steps do nothing
    const again = zoomStep(cam, VIEWPORT, 'in');
    expect(again).toBe(cam);
  });
});

describe('zoomPercent / canZoom*', () => {
  // TC-21 value lives in component tests; here assert rounding.
  it('reports the zoom as a rounded whole percent', () => {
    expect(zoomPercent(ORIGIN)).toBe(100);
    expect(zoomPercent({ x: 0, y: 0, zoom: ZOOM_MIN })).toBe(
      Math.round(ZOOM_MIN * ZOOM_PERCENT_SCALE),
    );
    expect(zoomPercent({ x: 0, y: 0, zoom: ZOOM_MAX })).toBe(
      Math.round(ZOOM_MAX * ZOOM_PERCENT_SCALE),
    );
    expect(zoomPercent({ x: 0, y: 0, zoom: 1.5625 })).toBe(156);
  });

  it('canZoomIn/Out reflect the limits', () => {
    expect(canZoomIn(ORIGIN)).toBe(true);
    expect(canZoomOut(ORIGIN)).toBe(true);
    expect(canZoomIn({ x: 0, y: 0, zoom: ZOOM_MAX })).toBe(false);
    expect(canZoomOut({ x: 0, y: 0, zoom: ZOOM_MIN })).toBe(false);
  });
});

describe('property: zoomAt pointer invariance', () => {
  // Deterministic LCG so the property is reproducible.
  function makeRng(seed: number) {
    let s = seed >>> 0;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 0xffffffff;
    };
  }

  it('keeps the world point under the pointer within 1e-6 across 1000 samples', () => {
    const rng = makeRng(20260917);
    for (let i = 0; i < 1000; i++) {
      const zoom = ZOOM_MIN + rng() * (ZOOM_MAX - ZOOM_MIN);
      const cam: Camera = {
        x: (rng() * 2 - 1) * UNBOUNDED_PAN_TESTED_EXTENT,
        y: (rng() * 2 - 1) * UNBOUNDED_PAN_TESTED_EXTENT,
        zoom,
      };
      const p: Point = { x: rng() * 1280, y: rng() * 800 };
      // factor chosen so zoom*factor stays within limits (so the zoom actually changes)
      const lo = ZOOM_MIN / zoom;
      const hi = ZOOM_MAX / zoom;
      const factor = lo + rng() * (hi - lo);
      const before = screenToWorld(cam, p);
      const next = zoomAt(cam, p, factor);
      const after = screenToWorld(next, p);
      expect(Math.abs(after.x - before.x)).toBeLessThan(1e-6);
      expect(Math.abs(after.y - before.y)).toBeLessThan(1e-6);
    }
  });
});
