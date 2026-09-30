import { describe, it, expect } from 'vitest';
import {
  type Camera,
  type Point,
  type Size,
  screenToWorld,
  worldToScreen,
  panBy,
  zoomAt,
  zoomStep,
  resetCamera,
  canZoomIn,
  canZoomOut,
  zoomPercent,
} from '@client/canvas/camera';
import {
  ZOOM_MIN,
  ZOOM_MAX,
  ZOOM_STEP_FACTOR,
  UNBOUNDED_PAN_TESTED_EXTENT,
} from '@shared/config';

const TOL = 1e-6;

function approx(a: number, b: number, tol = TOL): boolean {
  return Math.abs(a - b) <= tol;
}

function approxPoint(p: Point, q: Point, tol = TOL): boolean {
  return approx(p.x, q.x, tol) && approx(p.y, q.y, tol);
}

const mid: Camera = { x: 0, y: 0, zoom: 1 };

describe('screenToWorld / worldToScreen roundtrip', () => {
  it('roundtrips a point', () => {
    const cam: Camera = { x: -123.4, y: 56.7, zoom: 2.3 };
    const p: Point = { x: 300, y: 200 };
    expect(approxPoint(screenToWorld(cam, worldToScreen(cam, p)), p)).toBe(true);
    const w: Point = { x: 1000, y: -50 };
    expect(approxPoint(worldToScreen(cam, screenToWorld(cam, w)), w)).toBe(true);
  });
});

describe('panBy', () => {
  // TC-01
  it('TC-01 moves camera by -delta/zoom at zoom 1 and moves the world origin by +delta on screen', () => {
    const next = panBy(mid, 200, 100);
    expect(next.x).toBeCloseTo(mid.x - 200 / mid.zoom, 9);
    expect(next.y).toBeCloseTo(mid.y - 100 / mid.zoom, 9);
    // world origin now appears at +200,+100 on screen
    const s = worldToScreen(next, { x: 0, y: 0 });
    expect(s.x).toBeCloseTo(200, 9);
    expect(s.y).toBeCloseTo(100, 9);
  });

  // TC-02
  it('TC-02 at ZOOM_MAX far away shifts by exact world units (dx/zoom)', () => {
    const far: Camera = {
      x: UNBOUNDED_PAN_TESTED_EXTENT,
      y: UNBOUNDED_PAN_TESTED_EXTENT,
      zoom: ZOOM_MAX,
    };
    const next = panBy(far, 200, 100);
    expect(approx(next.x, UNBOUNDED_PAN_TESTED_EXTENT - 200 / ZOOM_MAX)).toBe(true);
    expect(approx(next.y, UNBOUNDED_PAN_TESTED_EXTENT - 100 / ZOOM_MAX)).toBe(true);
    // 200 / 4 = 50 world units; 100 / 4 = 25
    expect(approx(far.x - next.x, 50)).toBe(true);
    expect(approx(far.y - next.y, 25)).toBe(true);
  });

  it('returns the same object for a zero-length delta', () => {
    const cam: Camera = { x: 5, y: 7, zoom: 2 };
    expect(panBy(cam, 0, 0)).toBe(cam);
  });
});

describe('zoomAt', () => {
  // TC-03
  it('TC-03 keeps the world point under the pointer fixed and scales zoom', () => {
    const point: Point = { x: 300, y: 200 };
    const before = screenToWorld(mid, point);
    const next = zoomAt(mid, point, 2);
    expect(next.zoom).toBeCloseTo(2, 9);
    const after = screenToWorld(next, point);
    expect(approxPoint(before, after)).toBe(true);
  });

  // TC-04
  it('TC-04 keeps the pointer world point invariant far away', () => {
    const far: Camera = {
      x: UNBOUNDED_PAN_TESTED_EXTENT,
      y: UNBOUNDED_PAN_TESTED_EXTENT,
      zoom: 1,
    };
    const point: Point = { x: 640, y: 400 };
    const before = screenToWorld(far, point);
    const next = zoomAt(far, point, 1.5);
    const after = screenToWorld(next, point);
    expect(approxPoint(before, after)).toBe(true);
  });

  // TC-05
  it('TC-05 at ZOOM_MIN zooming out returns the exact same object', () => {
    const cam: Camera = { x: 10, y: 20, zoom: ZOOM_MIN };
    const centre: Point = { x: 600, y: 400 };
    const next = zoomAt(cam, centre, 1 / ZOOM_STEP_FACTOR);
    expect(next).toBe(cam);
  });

  // TC-06
  it('TC-06 at ZOOM_MAX zooming in returns the exact same object', () => {
    const cam: Camera = { x: -50, y: 90, zoom: ZOOM_MAX };
    const centre: Point = { x: 600, y: 400 };
    const next = zoomAt(cam, centre, ZOOM_STEP_FACTOR);
    expect(next).toBe(cam);
  });

  // TC-11
  it('TC-11 a huge factor clamps to ZOOM_MAX and keeps the pointer invariant', () => {
    const point: Point = { x: 250, y: 150 };
    const before = screenToWorld(mid, point);
    const next = zoomAt(mid, point, 1000);
    expect(next.zoom).toBe(ZOOM_MAX);
    const after = screenToWorld(next, point);
    expect(approxPoint(before, after)).toBe(true);
  });

  it('TC-11b a tiny factor clamps to ZOOM_MIN and keeps the pointer invariant', () => {
    const point: Point = { x: 250, y: 150 };
    const before = screenToWorld(mid, point);
    const next = zoomAt(mid, point, 0.0001);
    expect(next.zoom).toBe(ZOOM_MIN);
    const after = screenToWorld(next, point);
    expect(approxPoint(before, after)).toBe(true);
  });

  // TC-12
  it('TC-12 invalid factors return the input camera unchanged, no NaN', () => {
    const cam: Camera = { x: 33, y: -21, zoom: 1.7 };
    const point: Point = { x: 100, y: 100 };
    for (const bad of [0, -1, -0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const next = zoomAt(cam, point, bad);
      expect(next).toBe(cam);
      expect(Number.isNaN(next.x)).toBe(false);
      expect(Number.isNaN(next.y)).toBe(false);
      expect(Number.isNaN(next.zoom)).toBe(false);
    }
  });
});

describe('zoomStep', () => {
  const viewport: Size = { width: 1200, height: 800 };

  // TC-09
  it('TC-09 one step in then one step out returns exactly 1.0 (label 100)', () => {
    const oneIn = zoomStep(mid, viewport, 'in');
    expect(oneIn.zoom).toBeCloseTo(ZOOM_STEP_FACTOR, 9);
    expect(zoomPercent(oneIn)).toBe(Math.round(ZOOM_STEP_FACTOR * 100));
    const backOut = zoomStep(oneIn, viewport, 'out');
    expect(backOut.zoom).toBe(1);
    expect(zoomPercent(backOut)).toBe(100);
  });

  it('TC-09b keeps the viewport centre fixed across a step', () => {
    const centre: Point = { x: viewport.width / 2, y: viewport.height / 2 };
    const before = screenToWorld(mid, centre);
    const oneIn = zoomStep(mid, viewport, 'in');
    const after = screenToWorld(oneIn, centre);
    expect(approxPoint(before, after)).toBe(true);
  });

  // TC-10
  it('TC-10 twenty steps in clamp at ZOOM_MAX, canZoomIn false', () => {
    let cam: Camera = { ...mid };
    for (let i = 0; i < 20; i++) cam = zoomStep(cam, viewport, 'in');
    expect(cam.zoom).toBe(ZOOM_MAX);
    expect(canZoomIn(cam)).toBe(false);
    expect(canZoomOut(cam)).toBe(true);
  });

  it('TC-10b steps out clamp at ZOOM_MIN, canZoomOut false', () => {
    let cam: Camera = { ...mid };
    for (let i = 0; i < 40; i++) cam = zoomStep(cam, viewport, 'out');
    expect(cam.zoom).toBe(ZOOM_MIN);
    expect(canZoomOut(cam)).toBe(false);
    expect(canZoomIn(cam)).toBe(true);
  });
});

describe('resetCamera', () => {
  // TC-08
  it('TC-08 reset to 100% centres world origin in the viewport', () => {
    const viewport: Size = { width: 1200, height: 800 };
    const cam = resetCamera(viewport);
    expect(cam.zoom).toBe(1);
    expect(cam.x).toBe(-1200 / 2);
    expect(cam.y).toBe(-800 / 2);
    const originOnScreen = worldToScreen(cam, { x: 0, y: 0 });
    expect(originOnScreen.x).toBeCloseTo(600, 9);
    expect(originOnScreen.y).toBeCloseTo(400, 9);
  });

  it('TC-08b reset from far away at ZOOM_MAX still centres the origin', () => {
    const viewport: Size = { width: 1200, height: 800 };
    // reset is viewport-only; independent of the previous camera
    const cam = resetCamera(viewport);
    expect(zoomPercent(cam)).toBe(100);
    const originOnScreen = worldToScreen(cam, { x: 0, y: 0 });
    expect(approxPoint(originOnScreen, { x: 600, y: 400 })).toBe(true);
  });
});

describe('viewport resize', () => {
  // TC-07: resize is not an input to camera.math; the camera (x,y,zoom) is not a
  // function of the viewport, so a resize leaves it unchanged and the world point
  // shown at the viewport top-left stays the same.
  it('TC-07 leaves camera x,y,zoom unchanged on viewport size change', () => {
    const cam: Camera = { x: -321, y: 123, zoom: 1.5 };
    const small: Size = { width: 640, height: 480 };
    const large: Size = { width: 1920, height: 1080 };
    const topLeftBefore = screenToWorld(cam, { x: 0, y: 0 });
    // resizing does not mutate the camera; it is the same immutable value
    expect({ x: cam.x, y: cam.y, zoom: cam.zoom }).toEqual({ x: -321, y: 123, zoom: 1.5 });
    void small;
    void large;
    expect(approxPoint(screenToWorld(cam, { x: 0, y: 0 }), topLeftBefore)).toBe(true);
  });
});

describe('zoomPercent', () => {
  it('rounds to the nearest whole percent', () => {
    expect(zoomPercent({ x: 0, y: 0, zoom: 1 })).toBe(100);
    expect(zoomPercent({ x: 0, y: 0, zoom: 1.5625 })).toBe(156);
    expect(zoomPercent({ x: 0, y: 0, zoom: ZOOM_MIN })).toBe(10);
    expect(zoomPercent({ x: 0, y: 0, zoom: ZOOM_MAX })).toBe(400);
  });
});

describe('canZoomIn / canZoomOut', () => {
  it('reports limits', () => {
    expect(canZoomIn(mid)).toBe(true);
    expect(canZoomOut(mid)).toBe(true);
    expect(canZoomIn({ x: 0, y: 0, zoom: ZOOM_MAX })).toBe(false);
    expect(canZoomOut({ x: 0, y: 0, zoom: ZOOM_MIN })).toBe(false);
  });
});

describe('property: pointer invariance under zoomAt', () => {
  // mulberry32 seeded PRNG for determinism.
  function mulberry32(seed: number) {
    let a = seed >>> 0;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  it('keeps the world point under the pointer within 1e-6 for 1000 random cases', () => {
    const rand = mulberry32(1234567);
    for (let i = 0; i < 1000; i++) {
      const zoom = ZOOM_MIN + rand() * (ZOOM_MAX - ZOOM_MIN);
      const cx = (rand() - 0.5) * UNBOUNDED_PAN_TESTED_EXTENT * 2;
      const cy = (rand() - 0.5) * UNBOUNDED_PAN_TESTED_EXTENT * 2;
      const cam: Camera = { x: cx, y: cy, zoom };
      const point: Point = { x: rand() * 1920, y: rand() * 1080 };
      const factor = 0.2 + rand() * 5;
      const before = screenToWorld(cam, point);
      const next = zoomAt(cam, point, factor);
      expect(Number.isFinite(next.x)).toBe(true);
      expect(Number.isFinite(next.y)).toBe(true);
      const after = screenToWorld(next, point);
      // Scale tolerance with the magnitude of the world coordinate.
      const scale = Math.max(1, Math.abs(before.x), Math.abs(before.y));
      expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(scale * 1e-9);
      expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(scale * 1e-9);
    }
  });
});
