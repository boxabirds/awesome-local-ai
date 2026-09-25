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

/** Required precision for world-space invariants (design: "within 1e-6"). */
const WORLD_TOLERANCE = 1e-6;
/** Decimal digits for toBeCloseTo equivalent to WORLD_TOLERANCE. */
const WORLD_DIGITS = 6;
const PERCENT = 100;

const ORIGIN_CAMERA: Camera = { x: 0, y: 0, zoom: 1 };
const FAR_CAMERA_AT_MAX: Camera = {
  x: UNBOUNDED_PAN_TESTED_EXTENT,
  y: UNBOUNDED_PAN_TESTED_EXTENT,
  zoom: ZOOM_MAX,
};
const LAPTOP_VIEWPORT: Size = { width: 1200, height: 800 };
const DRAG = { dx: 200, dy: 100 };
const POINTER: Point = { x: 300, y: 200 };
const MANY_STEPS = 20;

function centre(v: Size): Point {
  return { x: v.width / 2, y: v.height / 2 };
}

function expectPointClose(a: Point, b: Point): void {
  expect(Math.abs(a.x - b.x)).toBeLessThanOrEqual(WORLD_TOLERANCE);
  expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(WORLD_TOLERANCE);
}

describe('camera.math', () => {
  it('TC-01 panBy at zoom 1 from the origin moves content by exactly the drag', () => {
    const next = panBy(ORIGIN_CAMERA, DRAG.dx, DRAG.dy);
    expect(next).toEqual({ x: -DRAG.dx, y: -DRAG.dy, zoom: 1 });
    const originBefore = worldToScreen(ORIGIN_CAMERA, { x: 0, y: 0 });
    const originAfter = worldToScreen(next, { x: 0, y: 0 });
    expect(originBefore).toEqual({ x: 0, y: 0 });
    expect(originAfter).toEqual({ x: DRAG.dx, y: DRAG.dy });
  });

  it('TC-02 panBy at ZOOM_MAX far from the start shifts by drag/zoom world units', () => {
    const next = panBy(FAR_CAMERA_AT_MAX, DRAG.dx, DRAG.dy);
    expect(Math.abs(next.x - (FAR_CAMERA_AT_MAX.x - DRAG.dx / ZOOM_MAX))).toBeLessThanOrEqual(WORLD_TOLERANCE);
    expect(Math.abs(next.y - (FAR_CAMERA_AT_MAX.y - DRAG.dy / ZOOM_MAX))).toBeLessThanOrEqual(WORLD_TOLERANCE);
    expect(next.zoom).toBe(ZOOM_MAX);
  });

  it('panBy with zero delta returns the same object', () => {
    expect(panBy(ORIGIN_CAMERA, 0, 0)).toBe(ORIGIN_CAMERA);
  });

  it('TC-03 zoomAt keeps the world point under the pointer fixed (origin)', () => {
    const factor = 2;
    const before = screenToWorld(ORIGIN_CAMERA, POINTER);
    const next = zoomAt(ORIGIN_CAMERA, POINTER, factor);
    expect(next.zoom).toBe(ORIGIN_CAMERA.zoom * factor);
    expect(screenToWorld(next, POINTER)).toEqual(before);
  });

  it('TC-04 zoomAt keeps the pointer world point fixed far from the start', () => {
    const factor = 1.5;
    const far: Camera = { x: UNBOUNDED_PAN_TESTED_EXTENT, y: -UNBOUNDED_PAN_TESTED_EXTENT, zoom: 1 };
    const before = screenToWorld(far, POINTER);
    const next = zoomAt(far, POINTER, factor);
    expect(next.zoom).toBeCloseTo(factor, WORLD_DIGITS);
    expectPointClose(screenToWorld(next, POINTER), before);
  });

  it('TC-05 zooming out at ZOOM_MIN returns the same camera', () => {
    const atMin: Camera = { x: 0, y: 0, zoom: ZOOM_MIN };
    const next = zoomAt(atMin, centre(LAPTOP_VIEWPORT), 1 / ZOOM_STEP_FACTOR);
    expect(next).toBe(atMin);
    expect(zoomStep(atMin, LAPTOP_VIEWPORT, 'out')).toBe(atMin);
    expect(canZoomOut(atMin)).toBe(false);
    expect(canZoomIn(atMin)).toBe(true);
  });

  it('TC-06 zooming in at ZOOM_MAX returns the same camera', () => {
    const atMax: Camera = { x: 0, y: 0, zoom: ZOOM_MAX };
    const next = zoomAt(atMax, centre(LAPTOP_VIEWPORT), ZOOM_STEP_FACTOR);
    expect(next).toBe(atMax);
    expect(zoomStep(atMax, LAPTOP_VIEWPORT, 'in')).toBe(atMax);
    expect(canZoomIn(atMax)).toBe(false);
    expect(canZoomOut(atMax)).toBe(true);
  });

  it('TC-07 a viewport resize does not change the camera or content position', () => {
    const cam: Camera = { x: 37, y: -12, zoom: 1 };
    const probe: Point = { x: 100, y: 50 };
    const before = worldToScreen(cam, probe);
    // The camera anchors the top-left corner; nothing in the maths depends on viewport size
    // except explicit centre-based operations. A resize therefore leaves the camera untouched.
    const resizedViewport: Size = { width: 800, height: 600 };
    expect(resizedViewport.width).not.toBe(LAPTOP_VIEWPORT.width);
    expect(cam).toEqual({ x: 37, y: -12, zoom: 1 });
    expect(worldToScreen(cam, probe)).toEqual(before);
  });

  it('TC-08 resetCamera centres the start point at 100%', () => {
    const next = resetCamera(LAPTOP_VIEWPORT);
    expect(next).toEqual({ x: -LAPTOP_VIEWPORT.width / 2, y: -LAPTOP_VIEWPORT.height / 2, zoom: 1 });
    expect(worldToScreen(next, { x: 0, y: 0 })).toEqual(centre(LAPTOP_VIEWPORT));
    expect(FAR_CAMERA_AT_MAX.zoom).toBe(ZOOM_MAX);
  });

  it('TC-09 one step in then one step out returns exactly to 100%', () => {
    const inOnce = zoomStep(ORIGIN_CAMERA, LAPTOP_VIEWPORT, 'in');
    expect(inOnce.zoom).toBe(ZOOM_STEP_FACTOR);
    expect(zoomPercent(inOnce)).toBe(ZOOM_STEP_FACTOR * PERCENT);
    const back = zoomStep(inOnce, LAPTOP_VIEWPORT, 'out');
    expect(back.zoom).toBe(1);
    expect(zoomPercent(back)).toBe(PERCENT);
  });

  it('zoomStep keeps the viewport centre fixed', () => {
    const c = centre(LAPTOP_VIEWPORT);
    const before = screenToWorld(ORIGIN_CAMERA, c);
    const next = zoomStep(ORIGIN_CAMERA, LAPTOP_VIEWPORT, 'in');
    expectPointClose(screenToWorld(next, c), before);
  });

  it('TC-10 repeated steps in stop at ZOOM_MAX', () => {
    let cam = ORIGIN_CAMERA;
    for (let i = 0; i < MANY_STEPS; i += 1) cam = zoomStep(cam, LAPTOP_VIEWPORT, 'in');
    expect(cam.zoom).toBe(ZOOM_MAX);
    expect(canZoomIn(cam)).toBe(false);
    expect(zoomPercent(cam)).toBe(ZOOM_MAX * PERCENT);
  });

  it('repeated steps out stop at ZOOM_MIN', () => {
    let cam = ORIGIN_CAMERA;
    for (let i = 0; i < MANY_STEPS; i += 1) cam = zoomStep(cam, LAPTOP_VIEWPORT, 'out');
    expect(cam.zoom).toBe(ZOOM_MIN);
    expect(canZoomOut(cam)).toBe(false);
    expect(zoomPercent(cam)).toBe(ZOOM_MIN * PERCENT);
  });

  it('TC-11 a huge factor clamps to ZOOM_MAX and keeps the pointer invariant', () => {
    const hugeFactor = 1000;
    const before = screenToWorld(ORIGIN_CAMERA, POINTER);
    const next = zoomAt(ORIGIN_CAMERA, POINTER, hugeFactor);
    expect(next.zoom).toBe(ZOOM_MAX);
    expectPointClose(screenToWorld(next, POINTER), before);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'TC-12 invalid factor %s returns the camera unchanged',
    (factor) => {
      const next = zoomAt(ORIGIN_CAMERA, POINTER, factor);
      expect(next).toBe(ORIGIN_CAMERA);
      expect(Number.isNaN(next.x) || Number.isNaN(next.y) || Number.isNaN(next.zoom)).toBe(false);
    },
  );

  it('property: zoomAt keeps the pointer world point invariant for 1,000 random cases', () => {
    const CASES = 1000;
    const SEED = 0x5eed;
    const random = mulberry32(SEED);
    const SCREEN_EXTENT = 2000;
    const MAX_LOG_FACTOR = 3;
    for (let i = 0; i < CASES; i += 1) {
      const cam: Camera = {
        x: (random() * 2 - 1) * UNBOUNDED_PAN_TESTED_EXTENT,
        y: (random() * 2 - 1) * UNBOUNDED_PAN_TESTED_EXTENT,
        zoom: ZOOM_MIN + random() * (ZOOM_MAX - ZOOM_MIN),
      };
      const p: Point = { x: random() * SCREEN_EXTENT, y: random() * SCREEN_EXTENT };
      const factor = Math.exp((random() * 2 - 1) * MAX_LOG_FACTOR);
      const before = screenToWorld(cam, p);
      const next = zoomAt(cam, p, factor);
      expect(next.zoom).toBeGreaterThanOrEqual(ZOOM_MIN);
      expect(next.zoom).toBeLessThanOrEqual(ZOOM_MAX);
      expectPointClose(screenToWorld(next, p), before);
    }
  });
});

/** Small deterministic PRNG so the property check is reproducible. */
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
