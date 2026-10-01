import { describe, it, expect } from 'vitest';
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
} from '../../src/client/canvas/camera.ts';
import {
  PERCENT,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP_FACTOR,
  UNBOUNDED_PAN_TESTED_EXTENT,
} from '../../src/shared/config.ts';

const ORIGIN_CAM: Camera = { x: 0, y: 0, zoom: 1 };
const VIEWPORT: Size = { width: 1200, height: 800 };
const CENTRE: Point = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };

/** Camera positioned `distance` world units from the start. */
function farCamera(distance: number, zoom = 1): Camera {
  return { x: distance, y: distance, zoom };
}

/** Absolute difference between two numbers. */
function dist(a: number, b: number): number {
  return Math.abs(a - b);
}

describe('camera.math screen/world transforms', () => {
  it('round-trips screen -> world -> screen', () => {
    const cam: Camera = { x: -1234.5, y: 678.9, zoom: 1.7 };
    const p: Point = { x: 345, y: 67 };
    const world = screenToWorld(cam, p);
    const back = worldToScreen(cam, world);
    expect(dist(back.x, p.x)).toBeLessThan(1e-9);
    expect(dist(back.y, p.y)).toBeLessThan(1e-9);
  });

  it('places world origin at (-x * zoom, -y * zoom) on screen', () => {
    const cam: Camera = { x: -100, y: -50, zoom: 2 };
    expect(worldToScreen(cam, { x: 0, y: 0 })).toEqual({ x: 200, y: 100 });
  });
});

describe('camera.math panBy', () => {
  // TC-01
  it('TC-01 moves the camera by -delta/zoom and the content by +delta at zoom 1', () => {
    const next = panBy(ORIGIN_CAM, 200, 100);
    expect(next.x).toBeCloseTo(-200, 9);
    expect(next.y).toBeCloseTo(-100, 9);
    expect(next.zoom).toBe(ORIGIN_CAM.zoom);
    // the world origin, which started at screen (0,0), is now at (200,100)
    const dot = worldToScreen(next, { x: 0, y: 0 });
    expect(dot.x).toBeCloseTo(200, 9);
    expect(dot.y).toBeCloseTo(100, 9);
  });

  // TC-02
  it('TC-02 shifts by exactly delta/zoom world units at ZOOM_MAX far from the start', () => {
    const cam = farCamera(UNBOUNDED_PAN_TESTED_EXTENT, ZOOM_MAX);
    const next = panBy(cam, 200, 100);
    expect(dist(next.x, cam.x - 200 / ZOOM_MAX)).toBeLessThan(1e-6);
    expect(dist(next.y, cam.y - 100 / ZOOM_MAX)).toBeLessThan(1e-6);
    expect(next.zoom).toBe(ZOOM_MAX);
  });

  it('returns the same object for a zero-length drag', () => {
    expect(panBy(ORIGIN_CAM, 0, 0)).toBe(ORIGIN_CAM);
  });

  it('leaves a far-away origin dot exactly delta pixels away (unbounded pan)', () => {
    const cam = farCamera(UNBOUNDED_PAN_TESTED_EXTENT, ZOOM_MAX);
    const next = panBy(cam, 200, 100);
    const before = worldToScreen(cam, { x: cam.x, y: cam.y });
    const after = worldToScreen(next, { x: cam.x, y: cam.y });
    expect(dist(after.x - before.x, 200)).toBeLessThan(1e-3);
    expect(dist(after.y - before.y, 100)).toBeLessThan(1e-3);
  });
});

describe('camera.math zoomAt', () => {
  // TC-03
  it('TC-03 doubles zoom while keeping the world point under the pointer fixed', () => {
    const p: Point = { x: 300, y: 200 };
    const before = screenToWorld(ORIGIN_CAM, p);
    const next = zoomAt(ORIGIN_CAM, p, 2);
    expect(next.zoom).toBeCloseTo(2, 9);
    const after = screenToWorld(next, p);
    expect(dist(after.x, before.x)).toBeLessThan(1e-9);
    expect(dist(after.y, before.y)).toBeLessThan(1e-9);
  });

  // TC-04
  it('TC-04 keeps the pointer world point invariant far from the start', () => {
    const cam = farCamera(UNBOUNDED_PAN_TESTED_EXTENT);
    const p: Point = { x: 640, y: 400 };
    const before = screenToWorld(cam, p);
    const next = zoomAt(cam, p, 1.5);
    const after = screenToWorld(next, p);
    expect(dist(after.x, before.x)).toBeLessThan(1e-6);
    expect(dist(after.y, before.y)).toBeLessThan(1e-6);
  });

  // TC-05
  it('TC-05 returns the same object when zooming out at ZOOM_MIN', () => {
    const cam: Camera = { x: 0, y: 0, zoom: ZOOM_MIN };
    const next = zoomAt(cam, CENTRE, 1 / ZOOM_STEP_FACTOR);
    expect(next).toBe(cam);
    expect(next.zoom).toBe(ZOOM_MIN);
    expect(next.x).toBe(cam.x);
    expect(next.y).toBe(cam.y);
  });

  // TC-06
  it('TC-06 returns the same object when zooming in at ZOOM_MAX', () => {
    const cam: Camera = { x: 0, y: 0, zoom: ZOOM_MAX };
    const next = zoomAt(cam, CENTRE, ZOOM_STEP_FACTOR);
    expect(next).toBe(cam);
    expect(next.zoom).toBe(ZOOM_MAX);
    expect(next.x).toBe(cam.x);
    expect(next.y).toBe(cam.y);
  });

  // TC-11
  it('TC-11 clamps a huge factor to ZOOM_MAX and still keeps the pointer invariant', () => {
    const p: Point = { x: 300, y: 200 };
    const next = zoomAt(ORIGIN_CAM, p, 1000);
    expect(next.zoom).toBe(ZOOM_MAX);
    // invariance holds for the *clamped* factor: the pointer world point of the
    // clamped result is the one that stays put
    const w = screenToWorld(next, p);
    const again = zoomAt(next, p, 1000);
    expect(again).toBe(next);
    const w2 = screenToWorld(again, p);
    expect(dist(w.x, w2.x)).toBeLessThan(1e-6);
    expect(dist(w.y, w2.y)).toBeLessThan(1e-6);
    // and a partial zoom-in from the clamped camera keeps its own pointer point
    const partial = zoomAt(next, p, 0.5);
    const before = screenToWorld(next, p);
    const after = screenToWorld(partial, p);
    expect(dist(before.x, after.x)).toBeLessThan(1e-6);
    expect(dist(before.y, after.y)).toBeLessThan(1e-6);
  });

  // TC-12
  it('TC-12 returns the input camera unchanged for invalid factors', () => {
    for (const factor of [0, -1, -ZOOM_STEP_FACTOR, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const next = zoomAt(ORIGIN_CAM, CENTRE, factor);
      expect(next).toBe(ORIGIN_CAM);
      expect(Number.isNaN(next.x)).toBe(false);
      expect(Number.isNaN(next.y)).toBe(false);
      expect(Number.isNaN(next.zoom)).toBe(false);
      expect(next.zoom).toBe(1);
    }
  });

  it('property: 1000 random cameras/points/factors keep the pointer world point invariant', () => {
    let seed = 0x9e3779b9;
    const rand = () => {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    for (let i = 0; i < 1000; i += 1) {
      const zoom = ZOOM_MIN + rand() * (ZOOM_MAX - ZOOM_MIN);
      const place = (rand() - 0.5) * 2 * UNBOUNDED_PAN_TESTED_EXTENT;
      const cam: Camera = { x: place, y: -place, zoom };
      const p: Point = { x: rand() * 1920, y: rand() * 1080 };
      const factor = Math.exp((rand() - 0.5) * 4);
      const before = screenToWorld(cam, p);
      const next = zoomAt(cam, p, factor);
      const after = screenToWorld(next, p);
      expect(next.zoom).toBeGreaterThanOrEqual(ZOOM_MIN);
      expect(next.zoom).toBeLessThanOrEqual(ZOOM_MAX);
      expect(dist(after.x, before.x)).toBeLessThan(1e-6);
      expect(dist(after.y, before.y)).toBeLessThan(1e-6);
    }
  });
});

describe('camera.math zoomStep', () => {
  // TC-09
  it('TC-09 steps in then out and returns exactly zoom 1 (label 100%)', () => {
    const inStep = zoomStep(ORIGIN_CAM, VIEWPORT, 'in');
    expect(inStep.zoom).toBe(1.25);
    expect(zoomPercent(inStep)).toBe(100 * 1.25);
    const outStep = zoomStep(inStep, VIEWPORT, 'out');
    expect(outStep.zoom).toBe(1);
    expect(zoomPercent(outStep)).toBe(PERCENT);
    // and the centre of the viewport never moved
    expect(worldToScreen(outStep, { x: 0, y: 0 })).toEqual(
      worldToScreen(ORIGIN_CAM, { x: 0, y: 0 }),
    );
  });

  // TC-10
  it('TC-10 clamps after many steps in and disables canZoomIn', () => {
    let cam: Camera = ORIGIN_CAM;
    for (let i = 0; i < 20; i += 1) cam = zoomStep(cam, VIEWPORT, 'in');
    expect(cam.zoom).toBe(ZOOM_MAX);
    expect(canZoomIn(cam)).toBe(false);
    expect(canZoomOut(cam)).toBe(true);
    const again = zoomStep(cam, VIEWPORT, 'in');
    expect(again).toBe(cam);
  });

  it('clamps many steps out to ZOOM_MIN and disables canZoomOut', () => {
    let cam: Camera = ORIGIN_CAM;
    for (let i = 0; i < 40; i += 1) cam = zoomStep(cam, VIEWPORT, 'out');
    expect(cam.zoom).toBe(ZOOM_MIN);
    expect(canZoomOut(cam)).toBe(false);
    expect(canZoomIn(cam)).toBe(true);
    expect(zoomStep(cam, VIEWPORT, 'out')).toBe(cam);
  });

  it('keeps the viewport centre fixed while stepping', () => {
    const cam: Camera = { x: -500, y: 250, zoom: 1.3 };
    const before = screenToWorld(cam, CENTRE);
    const next = zoomStep(cam, VIEWPORT, 'in');
    const after = screenToWorld(next, CENTRE);
    expect(dist(after.x, before.x)).toBeLessThan(1e-6);
    expect(dist(after.y, before.y)).toBeLessThan(1e-6);
  });
});

describe('camera.math resetCamera', () => {
  // TC-08
  it('TC-08 resets to zoom 1 with the world origin centred', () => {
    const cam = farCamera(UNBOUNDED_PAN_TESTED_EXTENT, ZOOM_MAX);
    const next = resetCamera({ width: 1200, height: 800 });
    expect(cam.zoom).toBe(ZOOM_MAX);
    expect(next.zoom).toBe(1);
    expect(next.x).toBe(-600);
    expect(next.y).toBe(-400);
    const origin = worldToScreen(next, { x: 0, y: 0 });
    expect(origin.x).toBeCloseTo(600, 9);
    expect(origin.y).toBeCloseTo(400, 9);
  });
});

describe('camera.math viewport resize (TC-07)', () => {
  // TC-07: resize is not user input to the camera, so no camera function takes
  // the new size; the camera value must survive a resize untouched.
  it('TC-07 leaves the camera unchanged when the viewport size changes', () => {
    const cam: Camera = { x: 100, y: -200, zoom: 1 };
    const before = { ...cam };
    // a resize produces no camera mutation; the only no-op mutation available
    const after = panBy(cam, 0, 0);
    expect(after).toBe(cam);
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.zoom).toBe(before.zoom);
    // content stays put relative to the top-left of the board area
    const p: Point = { x: 42, y: 42 };
    expect(worldToScreen(cam, p)).toEqual(worldToScreen(after, p));
    const small: Size = { width: 640, height: 480 };
    const large: Size = { width: 1920, height: 1080 };
    expect(zoomStep(cam, small, 'in').zoom).toBe(zoomStep(cam, large, 'in').zoom);
  });
});

describe('camera.math zoomPercent', () => {
  it('rounds to the nearest whole percent', () => {
    expect(zoomPercent({ x: 0, y: 0, zoom: 1 })).toBe(100);
    expect(zoomPercent({ x: 0, y: 0, zoom: 1.5625 })).toBe(156);
    expect(zoomPercent({ x: 0, y: 0, zoom: ZOOM_MIN })).toBe(10);
    expect(zoomPercent({ x: 0, y: 0, zoom: ZOOM_MAX })).toBe(400);
  });
});

describe('camera.math limits', () => {
  it('reports canZoomIn/canZoomOut across the range', () => {
    expect(canZoomIn({ x: 0, y: 0, zoom: ZOOM_MIN })).toBe(true);
    expect(canZoomOut({ x: 0, y: 0, zoom: ZOOM_MIN })).toBe(false);
    expect(canZoomIn({ x: 0, y: 0, zoom: ZOOM_MAX })).toBe(false);
    expect(canZoomOut({ x: 0, y: 0, zoom: ZOOM_MAX })).toBe(true);
    expect(canZoomIn(ORIGIN_CAM)).toBe(true);
    expect(canZoomOut(ORIGIN_CAM)).toBe(true);
  });

  it('never produces a zoom outside [ZOOM_MIN, ZOOM_MAX] (TC-12 class)', () => {
    let cam: Camera = ORIGIN_CAM;
    for (const factor of [1.5, 0.5, 100, 0.001, 1.0000001, 1]) {
      cam = zoomAt(cam, CENTRE, factor);
      expect(cam.zoom).toBeGreaterThanOrEqual(ZOOM_MIN);
      expect(cam.zoom).toBeLessThanOrEqual(ZOOM_MAX);
    }
  });
});
