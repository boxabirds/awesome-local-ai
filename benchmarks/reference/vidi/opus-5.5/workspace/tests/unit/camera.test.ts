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
  type Camera,
  type Point,
  type Size,
} from '../../src/client/canvas/camera';
import {
  UNBOUNDED_PAN_TESTED_EXTENT,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP_FACTOR,
} from '../../src/shared/config';

/** Tolerance for world-coordinate invariance (design: 1e-6). */
const WORLD_EPSILON = 1e-6;
const PERCENT = 100;
const DRAG = { dx: 200, dy: 100 } as const;
const VIEWPORT: Size = { width: 1200, height: 800 };
const POINTER: Point = { x: 300, y: 200 };
const ORIGIN_CAMERA: Camera = { x: 0, y: 0, zoom: 1 };
const FAR = UNBOUNDED_PAN_TESTED_EXTENT;
const STEPS_BEYOND_MAX = 20;
const PROPERTY_SAMPLES = 1000;
const HUGE_FACTOR = 1000;
const MID_FACTOR = 1.5;
const DOUBLE = 2;

function centre(v: Size): Point {
  return { x: v.width / 2, y: v.height / 2 };
}

function expectPointClose(a: Point, b: Point, eps = WORLD_EPSILON): void {
  expect(Math.abs(a.x - b.x)).toBeLessThanOrEqual(eps);
  expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(eps);
}

/** Small deterministic PRNG (mulberry32) so the property check is reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('camera.math', () => {
  it('TC-01 panBy at zoom 1 from origin shifts camera by the screen delta', () => {
    const cam = panBy(ORIGIN_CAMERA, DRAG.dx, DRAG.dy);
    expect(cam.x).toBe(-DRAG.dx);
    expect(cam.y).toBe(-DRAG.dy);
    expect(cam.zoom).toBe(1);
    expect(worldToScreen(ORIGIN_CAMERA, { x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
    expectPointClose(worldToScreen(cam, { x: 0, y: 0 }), { x: DRAG.dx, y: DRAG.dy });
  });

  it('TC-02 panBy at ZOOM_MAX far away shifts by delta/zoom world units', () => {
    const start: Camera = { x: FAR, y: FAR, zoom: ZOOM_MAX };
    const cam = panBy(start, DRAG.dx, DRAG.dy);
    expect(Math.abs(cam.x - (FAR - DRAG.dx / ZOOM_MAX))).toBeLessThanOrEqual(WORLD_EPSILON);
    expect(Math.abs(cam.y - (FAR - DRAG.dy / ZOOM_MAX))).toBeLessThanOrEqual(WORLD_EPSILON);
    expect(cam.zoom).toBe(ZOOM_MAX);
  });

  it('panBy with zero delta returns the same object', () => {
    expect(panBy(ORIGIN_CAMERA, 0, 0)).toBe(ORIGIN_CAMERA);
  });

  it('TC-03 zoomAt keeps the world point under the pointer (origin)', () => {
    const before = screenToWorld(ORIGIN_CAMERA, POINTER);
    const cam = zoomAt(ORIGIN_CAMERA, POINTER, DOUBLE);
    expect(cam.zoom).toBe(DOUBLE);
    expectPointClose(screenToWorld(cam, POINTER), before);
  });

  it('TC-04 zoomAt keeps the world point under the pointer (far away)', () => {
    const start: Camera = { x: FAR, y: -FAR, zoom: 1 };
    const before = screenToWorld(start, POINTER);
    const cam = zoomAt(start, POINTER, MID_FACTOR);
    expect(cam.zoom).toBeCloseTo(MID_FACTOR);
    expectPointClose(screenToWorld(cam, POINTER), before);
  });

  it('TC-05 zooming out at ZOOM_MIN returns the same camera', () => {
    const start: Camera = { x: 0, y: 0, zoom: ZOOM_MIN };
    expect(zoomAt(start, centre(VIEWPORT), 1 / ZOOM_STEP_FACTOR)).toBe(start);
    expect(zoomStep(start, VIEWPORT, 'out')).toBe(start);
    expect(canZoomOut(start)).toBe(false);
    expect(canZoomIn(start)).toBe(true);
  });

  it('TC-06 zooming in at ZOOM_MAX returns the same camera', () => {
    const start: Camera = { x: 0, y: 0, zoom: ZOOM_MAX };
    expect(zoomAt(start, centre(VIEWPORT), ZOOM_STEP_FACTOR)).toBe(start);
    expect(zoomStep(start, VIEWPORT, 'in')).toBe(start);
    expect(canZoomIn(start)).toBe(false);
    expect(canZoomOut(start)).toBe(true);
  });

  it('TC-07 a viewport size change does not alter the camera', () => {
    // The camera stores the top-left world coordinate, so it is independent of
    // viewport size: world->screen mapping for any point is unchanged.
    const cam = resetCamera(VIEWPORT);
    const worldPoint = { x: 10, y: 20 };
    const before = worldToScreen(cam, worldPoint);
    const resized: Size = { width: VIEWPORT.width / 2, height: VIEWPORT.height * 2 };
    // Only the viewport changes; the same camera must yield the same mapping.
    expect(resized).not.toEqual(VIEWPORT);
    expect(worldToScreen(cam, worldPoint)).toEqual(before);
    expect(cam).toEqual({ x: -VIEWPORT.width / 2, y: -VIEWPORT.height / 2, zoom: 1 });
  });

  it('TC-08 resetCamera centres the origin at zoom 1', () => {
    const cam = resetCamera(VIEWPORT);
    expect(cam).toEqual({ x: -VIEWPORT.width / 2, y: -VIEWPORT.height / 2, zoom: 1 });
    expect(worldToScreen(cam, { x: 0, y: 0 })).toEqual(centre(VIEWPORT));
  });

  it('TC-09 one step in then one step out returns exactly to 1.0', () => {
    const inCam = zoomStep(ORIGIN_CAMERA, VIEWPORT, 'in');
    expect(inCam.zoom).toBe(ZOOM_STEP_FACTOR);
    const outCam = zoomStep(inCam, VIEWPORT, 'out');
    expect(outCam.zoom).toBe(1);
    expect(zoomPercent(outCam)).toBe(PERCENT);
    expect(zoomPercent(inCam)).toBe(Math.round(ZOOM_STEP_FACTOR * PERCENT));
  });

  it('TC-10 repeated steps in stop at ZOOM_MAX', () => {
    let cam = ORIGIN_CAMERA;
    for (let i = 0; i < STEPS_BEYOND_MAX; i++) cam = zoomStep(cam, VIEWPORT, 'in');
    expect(cam.zoom).toBe(ZOOM_MAX);
    expect(canZoomIn(cam)).toBe(false);
    expect(zoomPercent(cam)).toBe(ZOOM_MAX * PERCENT);
  });

  it('repeated steps out stop at ZOOM_MIN', () => {
    let cam = ORIGIN_CAMERA;
    for (let i = 0; i < STEPS_BEYOND_MAX; i++) cam = zoomStep(cam, VIEWPORT, 'out');
    expect(cam.zoom).toBe(ZOOM_MIN);
    expect(canZoomOut(cam)).toBe(false);
    expect(zoomPercent(cam)).toBe(ZOOM_MIN * PERCENT);
  });

  it('step zoom keeps the viewport centre fixed', () => {
    const start: Camera = { x: 123, y: -456, zoom: 1 };
    const before = screenToWorld(start, centre(VIEWPORT));
    const cam = zoomStep(start, VIEWPORT, 'in');
    expectPointClose(screenToWorld(cam, centre(VIEWPORT)), before);
  });

  it('TC-11 a huge factor clamps to ZOOM_MAX and keeps pointer invariance', () => {
    const before = screenToWorld(ORIGIN_CAMERA, POINTER);
    const cam = zoomAt(ORIGIN_CAMERA, POINTER, HUGE_FACTOR);
    expect(cam.zoom).toBe(ZOOM_MAX);
    expectPointClose(screenToWorld(cam, POINTER), before);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'TC-12 invalid factor %s returns the camera unchanged',
    (factor) => {
      const cam = zoomAt(ORIGIN_CAMERA, POINTER, factor);
      expect(cam).toBe(ORIGIN_CAMERA);
      expect(Number.isNaN(cam.x) || Number.isNaN(cam.y) || Number.isNaN(cam.zoom)).toBe(false);
    },
  );

  it('property: zoomAt keeps the pointer world point invariant (1,000 seeded samples)', () => {
    const rand = mulberry32(0xc0ffee);
    const range = (min: number, max: number) => min + rand() * (max - min);
    for (let i = 0; i < PROPERTY_SAMPLES; i++) {
      const cam: Camera = {
        x: range(-FAR, FAR),
        y: range(-FAR, FAR),
        zoom: range(ZOOM_MIN, ZOOM_MAX),
      };
      const p: Point = { x: range(0, VIEWPORT.width), y: range(0, VIEWPORT.height) };
      const factor = range(ZOOM_MIN / ZOOM_MAX, ZOOM_MAX / ZOOM_MIN);
      const before = screenToWorld(cam, p);
      const after = zoomAt(cam, p, factor);
      expect(after.zoom).toBeGreaterThanOrEqual(ZOOM_MIN);
      expect(after.zoom).toBeLessThanOrEqual(ZOOM_MAX);
      expectPointClose(screenToWorld(after, p), before);
    }
  });
});
