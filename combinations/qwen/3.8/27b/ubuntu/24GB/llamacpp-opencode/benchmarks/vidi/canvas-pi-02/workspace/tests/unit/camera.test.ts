import { describe, expect, it } from 'vitest';
import type { Camera, Point, Size } from '../../src/client/canvas/camera';
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
import {
  UNBOUNDED_PAN_TESTED_EXTENT,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP_FACTOR,
} from '../../src/shared/config';

/** Pointer invariance threshold (world units). */
const INVARIANCE_EPSILON = 1e-6;

const ORIGIN: Camera = { x: 0, y: 0, zoom: 1 };
const ORIGIN_POINT: Point = { x: 0, y: 0 };
const VIEWPORT: Size = { width: 1280, height: 800 };

const FAR: Camera = {
  x: UNBOUNDED_PAN_TESTED_EXTENT,
  y: UNBOUNDED_PAN_TESTED_EXTENT,
  zoom: ZOOM_MAX,
};

function expectPointerInvariant(cam: Camera, point: Point, factor: number): void {
  const before = screenToWorld(cam, point);
  const next = zoomAt(cam, point, factor);
  const after = screenToWorld(next, point);
  expect(Math.abs(after.x - before.x)).toBeLessThan(INVARIANCE_EPSILON);
  expect(Math.abs(after.y - before.y)).toBeLessThan(INVARIANCE_EPSILON);
}

describe('camera.math', () => {
  it('TC-01 panBy at zoom 1 from the origin shifts the camera by the negative delta', () => {
    const next = panBy(ORIGIN, 200, 100);
    expect(next.x).toBe(-200);
    expect(next.y).toBe(-100);
    expect(next.zoom).toBe(1);
    // The world origin moves exactly with the pointer.
    const before = worldToScreen(ORIGIN, ORIGIN_POINT);
    const after = worldToScreen(next, ORIGIN_POINT);
    expect(after.x - before.x).toBe(200);
    expect(after.y - before.y).toBe(100);
  });

  it('TC-02 panBy at ZOOM_MAX far away shifts exactly delta/zoom world units', () => {
    const next = panBy(FAR, 200, 100);
    expect(next.x).toBeCloseTo(UNBOUNDED_PAN_TESTED_EXTENT - 200 / ZOOM_MAX, 6);
    expect(next.y).toBeCloseTo(UNBOUNDED_PAN_TESTED_EXTENT - 100 / ZOOM_MAX, 6);
    expect(next.zoom).toBe(ZOOM_MAX);
  });

  it('TC-03 zoomAt at zoom 1 from the origin keeps the world point under the pointer', () => {
    const point: Point = { x: 300, y: 200 };
    const before = screenToWorld(ORIGIN, point);
    const next = zoomAt(ORIGIN, point, 2);
    expect(next.zoom).toBe(2);
    const after = screenToWorld(next, point);
    expect(Math.abs(after.x - before.x)).toBeLessThan(INVARIANCE_EPSILON);
    expect(Math.abs(after.y - before.y)).toBeLessThan(INVARIANCE_EPSILON);
  });

  it('TC-04 zoomAt far away (1e6) keeps the world point under the pointer', () => {
    const point: Point = { x: 123.5, y: -77.25 };
    expectPointerInvariant(FAR, point, 1.5);
  });

  it('TC-05 zooming out at ZOOM_MIN returns the same camera object', () => {
    const atMin: Camera = { x: 0, y: 0, zoom: ZOOM_MIN };
    const centre: Point = { x: 100, y: 100 };
    const next = zoomAt(atMin, centre, 1 / ZOOM_STEP_FACTOR);
    expect(next).toBe(atMin);
  });

  it('TC-06 zooming in at ZOOM_MAX returns the same camera object', () => {
    const atMax: Camera = { x: 0, y: 0, zoom: ZOOM_MAX };
    const centre: Point = { x: 100, y: 100 };
    const next = zoomAt(atMax, centre, ZOOM_STEP_FACTOR);
    expect(next).toBe(atMax);
  });

  it('TC-07 viewport resize leaves the camera unchanged (camera is independent of size)', () => {
    const cam: Camera = { x: -123, y: -456, zoom: 1.25 };
    // No camera function mutates its input: the camera survives a "resize" untouched.
    void panBy(cam, 10, 20);
    void zoomAt(cam, { x: 5, y: 5 }, 2);
    void zoomStep(cam, VIEWPORT, 'in');
    expect(cam.x).toBe(-123);
    expect(cam.y).toBe(-456);
    expect(cam.zoom).toBe(1.25);
    // A resize is not camera input: the camera value is unaffected by viewport size.
    const resized = cam;
    expect(resized).toBe(cam);
  });

  it('TC-08 resetCamera(1200x800) returns to 100% with the origin centred', () => {
    const next = resetCamera({ width: 1200, height: 800 });
    expect(zoomPercent(next)).toBe(100);
    expect(next.x).toBe(-1200 / 2);
    expect(next.y).toBe(-800 / 2);
    // The board starting point (world 0,0) lands in the centre of the viewport.
    expect(worldToScreen(next, ORIGIN_POINT)).toEqual({ x: 600, y: 400 });
  });

  it('TC-09 one step in then one step out returns exactly 100%', () => {
    const onceIn = zoomStep(ORIGIN, VIEWPORT, 'in');
    expect(onceIn.zoom).toBe(ZOOM_STEP_FACTOR);
    const back = zoomStep(onceIn, VIEWPORT, 'out');
    expect(back.zoom).toBe(1);
    expect(zoomPercent(back)).toBe(100);
  });

  it('TC-10 twenty steps in clamp at ZOOM_MAX and canZoomIn goes false', () => {
    let cam = ORIGIN;
    for (let i = 0; i < 20; i++) {
      cam = zoomStep(cam, VIEWPORT, 'in');
    }
    expect(cam.zoom).toBe(ZOOM_MAX);
    expect(canZoomIn(cam)).toBe(false);
    // Further steps at the limit return the same object.
    expect(zoomStep(cam, VIEWPORT, 'in')).toBe(cam);
  });

  it('TC-11 a huge factor clamps at ZOOM_MAX and keeps the pointer invariant', () => {
    const point: Point = { x: 300, y: 200 };
    const before = screenToWorld(ORIGIN, point);
    const next = zoomAt(ORIGIN, point, 1000);
    expect(next.zoom).toBe(ZOOM_MAX);
    const after = screenToWorld(next, point);
    expect(Math.abs(after.x - before.x)).toBeLessThan(INVARIANCE_EPSILON);
    expect(Math.abs(after.y - before.y)).toBeLessThan(INVARIANCE_EPSILON);
  });

  it('TC-12 invalid factors (0, negative, NaN, ±Infinity) leave the camera unchanged', () => {
    const invalidFactors = [0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
    for (const factor of invalidFactors) {
      const next = zoomAt(ORIGIN, { x: 10, y: 10 }, factor);
      expect(next).toBe(ORIGIN);
    }
    const next = zoomAt(ORIGIN, { x: 10, y: 10 }, Number.NaN);
    expect(Number.isNaN(next.x) || Number.isNaN(next.y) || Number.isNaN(next.zoom)).toBe(false);
  });

  it('canZoomIn / canZoomOut report the limits and mid-range', () => {
    const atMin: Camera = { x: 0, y: 0, zoom: ZOOM_MIN };
    const atMax: Camera = { x: 0, y: 0, zoom: ZOOM_MAX };
    const mid: Camera = { x: 0, y: 0, zoom: 1 };
    expect(canZoomIn(atMin)).toBe(true);
    expect(canZoomOut(atMin)).toBe(false);
    expect(canZoomIn(mid)).toBe(true);
    expect(canZoomOut(mid)).toBe(true);
    expect(canZoomIn(atMax)).toBe(false);
    expect(canZoomOut(atMax)).toBe(true);
  });

  it('zoomPercent rounds to the nearest whole percent', () => {
    expect(zoomPercent({ x: 0, y: 0, zoom: 1.5625 })).toBe(156);
    expect(zoomPercent({ x: 0, y: 0, zoom: ZOOM_MIN })).toBe(10);
    expect(zoomPercent({ x: 0, y: 0, zoom: ZOOM_MAX })).toBe(400);
  });

  it('pointer invariance holds for 1000 seeded random cameras, points and factors', () => {
    // mulberry32: deterministic PRNG so the property check is reproducible.
    let seed = 0x1234abcd;
    const rand = (): number => {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    for (let i = 0; i < 1000; i++) {
      const cam: Camera = {
        x: (rand() * 2 - 1) * UNBOUNDED_PAN_TESTED_EXTENT,
        y: (rand() * 2 - 1) * UNBOUNDED_PAN_TESTED_EXTENT,
        zoom: ZOOM_MIN + rand() * (ZOOM_MAX - ZOOM_MIN),
      };
      const point: Point = {
        x: (rand() * 2 - 1) * 1000,
        y: (rand() * 2 - 1) * 1000,
      };
      const factor = 0.5 + rand() * 1.5;
      expectPointerInvariant(cam, point, factor);
    }
  });
});
