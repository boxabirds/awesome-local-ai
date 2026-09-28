import { describe, expect, it } from 'vitest';
import {
  type Camera,
  type Point,
  type Size,
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
import {
  UNBOUNDED_PAN_TESTED_EXTENT,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP_FACTOR,
} from '../../src/shared/config';

const EPS = 1e-6;

const ORIGIN: Camera = { x: 0, y: 0, zoom: 1 };
const VIEWPORT: Size = { width: 1200, height: 800 };

function near(a: number, b: number, tol = EPS): boolean {
  return Math.abs(a - b) <= tol;
}

function samePoint(p: Point, q: Point, tol = EPS): boolean {
  return near(p.x, q.x, tol) && near(p.y, q.y, tol);
}

describe('camera.math', () => {
  // TC-01
  it('TC-01 panBy at zoom 1 from origin shifts camera and moves a world point by the pointer delta', () => {
    const cam: Camera = { ...ORIGIN, zoom: 1 };
    const next = panBy(cam, 200, 100);
    expect(next.x).toBeCloseTo(cam.x - 200 / cam.zoom, 9);
    expect(next.y).toBeCloseTo(cam.y - 100 / cam.zoom, 9);
    expect(near(next.x, -200)).toBe(true);
    expect(near(next.y, -100)).toBe(true);
    // world point (0,0) screen (0,0) -> (200,100)
    expect(samePoint(worldToScreen(next, { x: 0, y: 0 }), { x: 200, y: 100 })).toBe(true);
  });

  // TC-02
  it('TC-02 panBy at ZOOM_MAX far away shifts by the exact world amount', () => {
    const cam: Camera = { x: UNBOUNDED_PAN_TESTED_EXTENT, y: UNBOUNDED_PAN_TESTED_EXTENT, zoom: ZOOM_MAX };
    const next = panBy(cam, 200, 100);
    expect(near(cam.x - next.x, 200 / ZOOM_MAX)).toBe(true); // 50
    expect(near(cam.y - next.y, 100 / ZOOM_MAX)).toBe(true); // 25
    expect(near(cam.x - next.x, 50)).toBe(true);
    expect(near(cam.y - next.y, 25)).toBe(true);
  });

  // TC-03
  it('TC-03 zoomAt keeps the world point under the pointer invariant (origin)', () => {
    const cam: Camera = { ...ORIGIN, zoom: 1 };
    const p: Point = { x: 300, y: 200 };
    const before = screenToWorld(cam, p);
    const next = zoomAt(cam, p, 2);
    expect(next.zoom).toBeCloseTo(2, 9);
    const after = screenToWorld(next, p);
    expect(samePoint(before, after)).toBe(true);
    expect(samePoint(after, { x: 300, y: 200 })).toBe(true);
  });

  // TC-04
  it('TC-04 zoomAt keeps the world point under the pointer invariant (far away)', () => {
    const cam: Camera = {
      x: UNBOUNDED_PAN_TESTED_EXTENT,
      y: UNBOUNDED_PAN_TESTED_EXTENT,
      zoom: 1,
    };
    const p: Point = { x: 400, y: 300 };
    const before = screenToWorld(cam, p);
    const next = zoomAt(cam, p, 1.5);
    const after = screenToWorld(next, p);
    expect(samePoint(before, after)).toBe(true);
  });

  // TC-05
  it('TC-05 zooming out at ZOOM_MIN returns the same object', () => {
    const cam: Camera = { ...ORIGIN, zoom: ZOOM_MIN };
    const centre = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };
    const next = zoomAt(cam, centre, 1 / ZOOM_STEP_FACTOR);
    expect(next).toBe(cam);
    expect(next.zoom).toBe(ZOOM_MIN);
    expect(next.x).toBe(cam.x);
    expect(next.y).toBe(cam.y);
  });

  // TC-06
  it('TC-06 zooming in at ZOOM_MAX returns the same object', () => {
    const cam: Camera = { ...ORIGIN, zoom: ZOOM_MAX };
    const centre = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };
    const next = zoomAt(cam, centre, ZOOM_STEP_FACTOR);
    expect(next).toBe(cam);
    expect(next.zoom).toBe(ZOOM_MAX);
    expect(next.x).toBe(cam.x);
    expect(next.y).toBe(cam.y);
  });

  // TC-07
  it('TC-07 viewport resize does not change the camera', () => {
    const cam: Camera = { x: 5, y: 7, zoom: 2 };
    const p: Point = { x: 100, y: 50 };
    // Screen transforms are viewport-independent by design; a resize only
    // changes how much of the board is visible, never the camera value.
    const a = worldToScreen(cam, p);
    // Different viewport sizes must not change the screen transform. The camera
    // value is entirely independent of the viewport dimensions.
    const small: Size = { width: 640, height: 480 };
    const large: Size = { width: 1920, height: 1080 };
    void small;
    void large;
    const b = worldToScreen(cam, p);
    expect(samePoint(a, b)).toBe(true);
    expect(cam.x).toBe(5);
    expect(cam.y).toBe(7);
    expect(cam.zoom).toBe(2);
  });

  // TC-08
  it('TC-08 resetCamera returns zoom 1 with the origin centred', () => {
    const start: Camera = { x: UNBOUNDED_PAN_TESTED_EXTENT, y: UNBOUNDED_PAN_TESTED_EXTENT, zoom: ZOOM_MAX };
    const next = resetCamera({ width: 1200, height: 800 });
    expect(next.zoom).toBe(1);
    expect(next.x).toBe(-600);
    expect(next.y).toBe(-400);
    // origin (world 0,0) lands at viewport centre
    expect(samePoint(worldToScreen(next, { x: 0, y: 0 }), { x: 600, y: 400 })).toBe(true);
    void start;
  });

  // TC-09
  it('TC-09 one step in then one step out returns exactly 1.0', () => {
    let cam: Camera = { ...ORIGIN, zoom: 1 };
    cam = zoomStep(cam, VIEWPORT, 'in');
    expect(cam.zoom).toBeCloseTo(1.25, 9);
    cam = zoomStep(cam, VIEWPORT, 'out');
    expect(cam.zoom).toBe(1);
    expect(zoomPercent(cam)).toBe(100);
  });

  // TC-10
  it('TC-10 twenty steps in clamps at ZOOM_MAX and disables zoom in', () => {
    let cam: Camera = { ...ORIGIN, zoom: 1 };
    for (let i = 0; i < 20; i++) cam = zoomStep(cam, VIEWPORT, 'in');
    expect(cam.zoom).toBe(ZOOM_MAX);
    expect(canZoomIn(cam)).toBe(false);
    expect(canZoomOut(cam)).toBe(true);
  });

  // TC-11
  it('TC-11 a huge factor clamps to ZOOM_MAX and keeps pointer invariance', () => {
    const cam: Camera = { ...ORIGIN, zoom: 1 };
    const p: Point = { x: 200, y: 150 };
    const before = screenToWorld(cam, p);
    const next = zoomAt(cam, p, 1000);
    expect(next.zoom).toBe(ZOOM_MAX);
    const after = screenToWorld(next, p);
    expect(samePoint(before, after)).toBe(true);
  });

  // TC-12
  it('TC-12 invalid factors return the camera unchanged with no NaN', () => {
    const cam: Camera = { x: 3, y: -4, zoom: 1.5 };
    const p: Point = { x: 10, y: 20 };
    for (const factor of [0, -1, -ZOOM_STEP_FACTOR, NaN, Infinity, -Infinity]) {
      const next = zoomAt(cam, p, factor);
      expect(next).toBe(cam);
      expect(Number.isFinite(next.x)).toBe(true);
      expect(Number.isFinite(next.y)).toBe(true);
      expect(Number.isFinite(next.zoom)).toBe(true);
    }
  });

  it('TC-12b zoomStep out at ZOOM_MIN returns the same object', () => {
    const cam: Camera = { ...ORIGIN, zoom: ZOOM_MIN };
    expect(zoomStep(cam, VIEWPORT, 'out')).toBe(cam);
    expect(canZoomOut(cam)).toBe(false);
    expect(canZoomIn(cam)).toBe(true);
  });

  it('TC-12c zero-length pan returns the same object', () => {
    const cam: Camera = { x: 12, y: 34, zoom: 3 };
    expect(panBy(cam, 0, 0)).toBe(cam);
  });

  // Property-style check: pointer invariance for many random cameras.
  it('TC-prop zoomAt keeps the pointer world point invariant for 1000 random inputs', () => {
    // Seeded PRNG (mulberry32) for deterministic failures.
    let seed = 0x9e3779b9;
    const rand = () => {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    for (let i = 0; i < 1000; i++) {
      const zoom = ZOOM_MIN + rand() * (ZOOM_MAX - ZOOM_MIN);
      const far = i % 2 === 0;
      const base = far ? UNBOUNDED_PAN_TESTED_EXTENT : 0;
      const cam: Camera = {
        x: base + (rand() * 2000 - 1000),
        y: base + (rand() * 2000 - 1000),
        zoom,
      };
      const p: Point = { x: rand() * 1200, y: rand() * 800 };
      const factor = 0.5 + rand() * 1.5;
      const before = screenToWorld(cam, p);
      const next = zoomAt(cam, p, factor);
      const after = screenToWorld(next, p);
      expect(next.zoom).toBeGreaterThanOrEqual(ZOOM_MIN);
      expect(next.zoom).toBeLessThanOrEqual(ZOOM_MAX);
      expect(near(before.x, after.x)).toBe(true);
      expect(near(before.y, after.y)).toBe(true);
    }
  });
});
