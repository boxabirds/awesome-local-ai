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
} from '../../src/client/canvas/camera';
import {
  PERCENT,
  UNBOUNDED_PAN_TESTED_EXTENT,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP_FACTOR,
} from '../../src/shared/config';

const VIEWPORT: Size = { width: 1280, height: 800 };
const CENTRE: Point = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };
/** Tolerance for pointer invariance (spec: within 1e-6 world units). */
const POINTER_INVARIANCE_EPSILON = 1e-6;
/** Tolerance for far-extent exactness (spec: within 1e-6). */
const FART_EXACTNESS_EPSILON = 1e-6;

const cam = (x: number, y: number, zoom: number): Camera => ({ x, y, zoom });
const HOME = (): Camera => resetCamera(VIEWPORT);

/** Deterministic PRNG so the property check is reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('camera.math', () => {
  it('screenToWorld / worldToScreen are exact inverses', () => {
    const c = HOME();
    const p: Point = { x: 42, y: -17 };
    const w = screenToWorld(c, p);
    expect(worldToScreen(c, w)).toEqual(p);
  });

  // TC-01: panBy at zoom 1 from the origin.
  it('TC-01 panBy moves the camera so the world follows the pointer', () => {
    const c = HOME();
    const before = worldToScreen(c, { x: 0, y: 0 });
    const next = panBy(c, 200, 100);
    expect(next.x).toBeCloseTo(c.x - 200 / c.zoom, 9);
    expect(next.y).toBeCloseTo(c.y - 100 / c.zoom, 9);
    const after = worldToScreen(next, { x: 0, y: 0 });
    expect(after.x - before.x).toBeCloseTo(200, 9);
    expect(after.y - before.y).toBeCloseTo(100, 9);
  });

  // TC-02: panBy at ZOOM_MAX far away is exact.
  it('TC-02 panBy at max zoom far away shifts the camera exactly', () => {
    const far: Camera = cam(UNBOUNDED_PAN_TESTED_EXTENT, UNBOUNDED_PAN_TESTED_EXTENT, ZOOM_MAX);
    const next = panBy(far, 200, 100);
    expect(next.x - far.x).toBeCloseTo(-200 / ZOOM_MAX, 12);
    expect(next.y - far.y).toBeCloseTo(-100 / ZOOM_MAX, 12);
    expect(Math.abs(next.x - far.x + 200 / ZOOM_MAX)).toBeLessThanOrEqual(FART_EXACTNESS_EPSILON);
    expect(Math.abs(next.y - far.y + 100 / ZOOM_MAX)).toBeLessThanOrEqual(FART_EXACTNESS_EPSILON);
    expect(next.zoom).toBe(ZOOM_MAX);
  });

  // TC-03: zoomAt keeps the world point under the pointer invariant (origin).
  it('TC-03 zoomAt keeps the pointer world point fixed at the origin', () => {
    const c = HOME();
    const p: Point = { x: 300, y: 200 };
    const before = screenToWorld(c, p);
    const next = zoomAt(c, p, 2);
    expect(next.zoom).toBe(2);
    const after = screenToWorld(next, p);
    expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(POINTER_INVARIANCE_EPSILON);
    expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(POINTER_INVARIANCE_EPSILON);
  });

  // TC-04: zoomAt far away keeps the pointer point invariant.
  it('TC-04 zoomAt far away keeps the pointer world point fixed', () => {
    const far: Camera = cam(UNBOUNDED_PAN_TESTED_EXTENT, UNBOUNDED_PAN_TESTED_EXTENT, 1);
    const p: Point = { x: 640, y: 400 };
    const before = screenToWorld(far, p);
    const next = zoomAt(far, p, 1.5);
    const after = screenToWorld(next, p);
    expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(POINTER_INVARIANCE_EPSILON);
    expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(POINTER_INVARIANCE_EPSILON);
  });

  // TC-05: zooming out at ZOOM_MIN returns the same object.
  it('TC-05 zoomAt at the minimum returns the identical camera object', () => {
    const atMin = cam(0, 0, ZOOM_MIN);
    const next = zoomAt(atMin, CENTRE, 1 / ZOOM_STEP_FACTOR);
    expect(next).toBe(atMin);
  });

  // TC-06: zooming in at ZOOM_MAX returns the same object.
  it('TC-06 zoomAt at the maximum returns the identical camera object', () => {
    const atMax = cam(0, 0, ZOOM_MAX);
    const next = zoomAt(atMax, CENTRE, ZOOM_STEP_FACTOR);
    expect(next).toBe(atMax);
  });

  // TC-07: a viewport resize leaves the camera unchanged.
  it('TC-07 resizing the viewport does not change the camera', () => {
    const c = HOME();
    const bigger: Size = { width: 1920, height: 1080 };
    expect(bigger).not.toEqual(VIEWPORT);
    // The camera is independent of the viewport size: no function mutates it.
    expect(c).toEqual({ x: -VIEWPORT.width / 2, y: -VIEWPORT.height / 2, zoom: 1 });
  });

  // TC-08: resetCamera centres the origin at the given size.
  it('TC-08 resetCamera returns 100% centred on the origin', () => {
    const c = resetCamera({ width: 1200, height: 800 });
    expect(c.zoom).toBe(1);
    expect(c.x).toBe(-600);
    expect(c.y).toBe(-400);
    expect(worldToScreen(c, { x: 0, y: 0 })).toEqual({ x: 600, y: 400 });
  });

  // TC-09: one step in then one step out returns exactly 1.0.
  it('TC-09 a zoom step in then out returns exactly the starting zoom', () => {
    const c = HOME();
    const inCam = zoomStep(c, VIEWPORT, 'in');
    expect(inCam.zoom).toBeCloseTo(ZOOM_STEP_FACTOR, 12);
    const outCam = zoomStep(inCam, VIEWPORT, 'out');
    expect(outCam.zoom).toBe(1);
    expect(zoomPercent(outCam)).toBe(PERCENT);
  });

  // TC-10: 20 steps in clamps at ZOOM_MAX; canZoomIn false.
  it('TC-10 repeated zoom-in steps clamp at the maximum', () => {
    let c = HOME();
    for (let i = 0; i < 20; i++) {
      c = zoomStep(c, VIEWPORT, 'in');
    }
    expect(c.zoom).toBe(ZOOM_MAX);
    expect(canZoomIn(c)).toBe(false);
    expect(zoomPercent(c)).toBe(Math.round(ZOOM_MAX * PERCENT));
  });

  // TC-11: a huge factor clamps and pointer invariance still holds.
  it('TC-11 a huge zoom factor clamps at the maximum with pointer fixed', () => {
    const c = HOME();
    const p: Point = { x: 640, y: 400 };
    const before = screenToWorld(c, p);
    const next = zoomAt(c, p, 1000);
    expect(next.zoom).toBe(ZOOM_MAX);
    const after = screenToWorld(next, p);
    expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(POINTER_INVARIANCE_EPSILON);
    expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(POINTER_INVARIANCE_EPSILON);
  });

  // TC-12: invalid factors return the input camera unchanged, no NaN.
  it('TC-12 invalid zoom factors leave the camera unchanged', () => {
    const c = HOME();
    for (const factor of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const next = zoomAt(c, CENTRE, factor);
      expect(next).toBe(c);
      expect(Number.isNaN(next.x)).toBe(false);
      expect(Number.isNaN(next.y)).toBe(false);
      expect(Number.isNaN(next.zoom)).toBe(false);
    }
  });

  it('canZoomIn / canZoomOut reflect the limits', () => {
    expect(canZoomIn(cam(0, 0, ZOOM_MIN))).toBe(true);
    expect(canZoomOut(cam(0, 0, ZOOM_MIN))).toBe(false);
    expect(canZoomIn(cam(0, 0, ZOOM_MAX))).toBe(false);
    expect(canZoomOut(cam(0, 0, ZOOM_MAX))).toBe(true);
    expect(canZoomIn(cam(0, 0, 1))).toBe(true);
    expect(canZoomOut(cam(0, 0, 1))).toBe(true);
  });

  it('zoomPercent rounds to a whole number', () => {
    expect(zoomPercent(cam(0, 0, 1.5625))).toBe(156);
    expect(zoomPercent(cam(0, 0, 1))).toBe(PERCENT);
  });

  it('pointer world point is invariant under zoomAt (1000 seeded random cases)', () => {
    const rand = mulberry32(20260917);
    for (let i = 0; i < 1000; i++) {
      const zoom = ZOOM_MIN + rand() * (ZOOM_MAX - ZOOM_MIN);
      const c: Camera = cam((rand() - 0.5) * 2 * UNBOUNDED_PAN_TESTED_EXTENT, (rand() - 0.5) * 2 * UNBOUNDED_PAN_TESTED_EXTENT, zoom);
      const p: Point = { x: rand() * 4000, y: rand() * 3000 };
      const factor = 0.1 + rand() * 10;
      const before = screenToWorld(c, p);
      const after = screenToWorld(zoomAt(c, p, factor), p);
      expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(POINTER_INVARIANCE_EPSILON);
      expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(POINTER_INVARIANCE_EPSILON);
    }
  });
});
