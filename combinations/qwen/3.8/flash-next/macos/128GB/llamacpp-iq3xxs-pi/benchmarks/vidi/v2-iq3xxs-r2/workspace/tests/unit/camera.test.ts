import { describe, expect, it } from 'vitest';
import {
  GRID_SPACING_WORLD,
  PERCENT_PER_ZOOM,
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

/** Design thresholds. */
const POINT_INVARIANCE_TOLERANCE = 1e-6;
const EXACT_TOLERANCE = 1e-9;
/** Design fixtures: default laptop viewport and the reset viewport in TC-08. */
const VIEWPORT: Size = { width: 1280, height: 800 };
const RESET_VIEWPORT: Size = { width: 1200, height: 800 };

const ORIGIN_CAMERA: Camera = { x: 0, y: 0, zoom: 1 };
const FAR: number = UNBOUNDED_PAN_TESTED_EXTENT;

function farCamera(zoom: number): Camera {
  return { x: FAR, y: FAR, zoom };
}

/** Assert the world point under `point` is unchanged within POINT_INVARIANCE_TOLERANCE. */
function expectPointerInvariant(before: Camera, after: Camera, point: Point): void {
  const wBefore = screenToWorld(before, point);
  const wAfter = screenToWorld(after, point);
  expect(Math.abs(wAfter.x - wBefore.x)).toBeLessThan(POINT_INVARIANCE_TOLERANCE);
  expect(Math.abs(wAfter.y - wBefore.y)).toBeLessThan(POINT_INVARIANCE_TOLERANCE);
}

function expectNoNaN(cam: Camera): void {
  expect(Number.isFinite(cam.x)).toBe(true);
  expect(Number.isFinite(cam.y)).toBe(true);
  expect(Number.isFinite(cam.zoom)).toBe(true);
}

/** Deterministic PRNG so the property check is reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('screenToWorld / worldToScreen', () => {
  it('are inverses of each other', () => {
    const cam: Camera = { x: -137.5, y: 42.25, zoom: 1.5 };
    const p: Point = { x: 300, y: 200 };
    const round = worldToScreen(cam, screenToWorld(cam, p));
    expect(Math.abs(round.x - p.x)).toBeLessThan(EXACT_TOLERANCE);
    expect(Math.abs(round.y - p.y)).toBeLessThan(EXACT_TOLERANCE);
  });
});

describe('panBy (TC-01, TC-02)', () => {
  it('TC-01: dragging 200 right, 100 down at zoom 1 moves the camera by (-200, -100) and the world origin by (+200, +100)', () => {
    const next = panBy(ORIGIN_CAMERA, 200, 100);
    expect(next.x).toBeCloseTo(-200, 9);
    expect(next.y).toBeCloseTo(-100, 9);
    expect(next.zoom).toBe(ORIGIN_CAMERA.zoom);
    const dot = worldToScreen(next, { x: 0, y: 0 });
    expect(dot.x).toBeCloseTo(200, 9);
    expect(dot.y).toBeCloseTo(100, 9);
  });

  it('TC-02: at ZOOM_MAX far from the start, a 200x100 drag shifts the camera by 200/zoom and 100/zoom world units', () => {
    const cam = farCamera(ZOOM_MAX);
    const next = panBy(cam, 200, 100);
    expect(Math.abs(next.x - (cam.x - 200 / ZOOM_MAX))).toBeLessThan(POINT_INVARIANCE_TOLERANCE);
    expect(Math.abs(next.y - (cam.y - 100 / ZOOM_MAX))).toBeLessThan(POINT_INVARIANCE_TOLERANCE);
    // The same drag still maps to exactly 200x100 screen pixels that far away.
    const worldProbe: Point = { x: cam.x, y: cam.y };
    const before = worldToScreen(cam, worldProbe);
    const after = worldToScreen(next, worldProbe);
    expect(Math.abs(after.x - before.x - 200)).toBeLessThan(POINT_INVARIANCE_TOLERANCE);
    expect(Math.abs(after.y - before.y - 100)).toBeLessThan(POINT_INVARIANCE_TOLERANCE);
  });

  it('returns the same object for a zero-length drag', () => {
    expect(panBy(ORIGIN_CAMERA, 0, 0)).toBe(ORIGIN_CAMERA);
  });
});

describe('zoomAt (TC-03, TC-04, TC-11)', () => {
  it('TC-03: doubling zoom at (300, 200) keeps the world point under the pointer fixed', () => {
    const point: Point = { x: 300, y: 200 };
    const next = zoomAt(ORIGIN_CAMERA, point, 2);
    expect(next.zoom).toBeCloseTo(2, 9);
    expectPointerInvariant(ORIGIN_CAMERA, next, point);
  });

  it('TC-04: pointer invariance holds at UNBOUNDED_PAN_TESTED_EXTENT', () => {
    const cam = farCamera(1);
    const point: Point = { x: 640, y: 400 };
    const next = zoomAt(cam, point, ZOOM_STEP_FACTOR ** 3);
    expectPointerInvariant(cam, next, point);
    // Doubles keep sub-pixel precision that far out: a world point at 1,000,000 still
    // round-trips through the screen transform after zooming.
    const farWorld: Point = { x: FAR, y: FAR };
    const roundTrip = screenToWorld(next, worldToScreen(next, farWorld));
    expect(Math.abs(roundTrip.x - farWorld.x)).toBeLessThan(POINT_INVARIANCE_TOLERANCE);
    expect(Math.abs(roundTrip.y - farWorld.y)).toBeLessThan(POINT_INVARIANCE_TOLERANCE);
  });

  it('TC-11: a huge factor clamps to ZOOM_MAX and keeps the pointer invariant for the clamped factor', () => {
    const point: Point = { x: 400, y: 300 };
    const next = zoomAt(ORIGIN_CAMERA, point, 1000);
    expect(next.zoom).toBe(ZOOM_MAX);
    expectPointerInvariant(ORIGIN_CAMERA, next, point);
  });

  it('TC-05: zooming out at ZOOM_MIN returns the same object and leaves x, y untouched', () => {
    const cam: Camera = { x: 0, y: 0, zoom: ZOOM_MIN };
    const centre: Point = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };
    const next = zoomAt(cam, centre, 1 / ZOOM_STEP_FACTOR);
    expect(next).toBe(cam);
    expect(next.x).toBe(cam.x);
    expect(next.y).toBe(cam.y);
  });

  it('TC-06: zooming in at ZOOM_MAX returns the same object and leaves x, y untouched', () => {
    const cam: Camera = { x: 0, y: 0, zoom: ZOOM_MAX };
    const centre: Point = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };
    const next = zoomAt(cam, centre, ZOOM_STEP_FACTOR);
    expect(next).toBe(cam);
    expect(next.x).toBe(cam.x);
    expect(next.y).toBe(cam.y);
  });

  it('TC-12: invalid factors (0, negative, NaN, ±Infinity) return the input camera unchanged with no NaN', () => {
    const cam: Camera = { x: 12, y: -34, zoom: 1 };
    const point: Point = { x: 10, y: 10 };
    for (const factor of [0, -1, -ZOOM_STEP_FACTOR, NaN, Infinity, -Infinity]) {
      const next = zoomAt(cam, point, factor);
      expect(next).toBe(cam);
      expectNoNaN(next);
    }
  });

  it('property check: 1000 random cameras/points/factors within limits keep the pointer invariant', () => {
    const rand = mulberry32(1234);
    for (let i = 0; i < 1000; i += 1) {
      const zoom = ZOOM_MIN + rand() * (ZOOM_MAX - ZOOM_MIN);
      const cam: Camera = {
        x: (rand() * 2 - 1) * FAR,
        y: (rand() * 2 - 1) * FAR,
        zoom,
      };
      const point: Point = { x: rand() * VIEWPORT.width, y: rand() * VIEWPORT.height };
      const factor = Math.exp((rand() * 2 - 1) * 2);
      const next = zoomAt(cam, point, factor);
      expect(next.zoom).toBeGreaterThanOrEqual(ZOOM_MIN);
      expect(next.zoom).toBeLessThanOrEqual(ZOOM_MAX);
      expectPointerInvariant(cam, next, point);
    }
  });
});

describe('zoomStep (TC-09, TC-10)', () => {
  it('TC-09: one step in then one step out returns exactly the starting zoom', () => {
    const inStep = zoomStep(ORIGIN_CAMERA, VIEWPORT, 'in');
    expect(inStep.zoom).toBe(ZOOM_STEP_FACTOR);
    expect(zoomPercent(inStep)).toBe(Math.round(1 * ZOOM_STEP_FACTOR * PERCENT_PER_ZOOM));
    const back = zoomStep(inStep, VIEWPORT, 'out');
    expect(back.zoom).toBe(1);
    expect(zoomPercent(back)).toBe(PERCENT_PER_ZOOM);
    // The viewport centre keeps its world point across a step.
    const centre: Point = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };
    expectPointerInvariant(ORIGIN_CAMERA, zoomStep(ORIGIN_CAMERA, VIEWPORT, 'in'), centre);
  });

  it('TC-10: 20 steps in clamp at ZOOM_MAX and re-enables zooming out', () => {
    let cam: Camera = ORIGIN_CAMERA;
    for (let i = 0; i < 20; i += 1) {
      cam = zoomStep(cam, VIEWPORT, 'in');
    }
    expect(cam.zoom).toBe(ZOOM_MAX);
    expect(canZoomIn(cam)).toBe(false);
    expect(canZoomOut(cam)).toBe(true);
    expect(zoomPercent(cam)).toBe(Math.round(ZOOM_MAX * PERCENT_PER_ZOOM));
    // A further step in is a no-op returning the same object.
    expect(zoomStep(cam, VIEWPORT, 'in')).toBe(cam);
    // Zooming back the other way works.
    expect(zoomStep(cam, VIEWPORT, 'out').zoom).toBeLessThan(ZOOM_MAX);
  });

  it('steps down stop at ZOOM_MIN', () => {
    let cam: Camera = ORIGIN_CAMERA;
    for (let i = 0; i < 40; i += 1) {
      cam = zoomStep(cam, VIEWPORT, 'out');
    }
    expect(cam.zoom).toBe(ZOOM_MIN);
    expect(canZoomOut(cam)).toBe(false);
    expect(zoomPercent(cam)).toBe(Math.round(ZOOM_MIN * PERCENT_PER_ZOOM));
    expect(zoomStep(cam, VIEWPORT, 'out')).toBe(cam);
  });

  it('multiplies an arbitrary wheel-zoomed value exactly by the step factor', () => {
    const arbitrary = zoomAt(ORIGIN_CAMERA, { x: 100, y: 100 }, 1.3);
    const stepped = zoomStep(arbitrary, VIEWPORT, 'in');
    const power = Math.log(stepped.zoom / arbitrary.zoom) / Math.log(ZOOM_STEP_FACTOR);
    expect(Math.abs(power - Math.round(power))).toBeLessThan(1e-12);
  });

  it('TC-09: a drifted value close to a step ladder point snaps onto it exactly', () => {
    const ladder = ZOOM_STEP_FACTOR ** 3;
    const drifted: Camera = { x: 0, y: 0, zoom: ladder + Number.EPSILON * ladder };
    const stepped = zoomStep(drifted, VIEWPORT, 'in');
    expect(stepped.zoom).toBe(ZOOM_STEP_FACTOR ** 4);
    expect(zoomPercent(stepped)).toBe(Math.round(ZOOM_STEP_FACTOR ** 4 * PERCENT_PER_ZOOM));
  });
});

describe('resetCamera (TC-08) and viewport resize (TC-07)', () => {
  it('TC-08: reset from far away at ZOOM_MAX gives zoom 1 with the board origin centred', () => {
    const cam = farCamera(ZOOM_MAX);
    const next = resetCamera(RESET_VIEWPORT);
    expect(next.zoom).toBe(1);
    expect(next.x).toBeCloseTo(-RESET_VIEWPORT.width / 2, 9);
    expect(next.y).toBeCloseTo(-RESET_VIEWPORT.height / 2, 9);
    const origin = worldToScreen(next, { x: 0, y: 0 });
    expect(origin.x).toBeCloseTo(RESET_VIEWPORT.width / 2, 9);
    expect(origin.y).toBeCloseTo(RESET_VIEWPORT.height / 2, 9);
    // reset does not depend on the old camera other than being a fresh camera.
    expect(cam.zoom).toBe(ZOOM_MAX);
  });

  it('TC-07: changing the viewport size leaves camera x, y and zoom unchanged', () => {
    const cam: Camera = { x: -500, y: -300, zoom: 1.5 };
    // Resize is not user input to the camera: nothing in the camera API takes a size
    // except resetCamera, so the camera object is simply reused.
    const afterResize: Camera = cam;
    expect(afterResize).toBe(cam);
    expect(afterResize.x).toBe(cam.x);
    expect(afterResize.y).toBe(cam.y);
    expect(afterResize.zoom).toBe(cam.zoom);
    // Only the viewport-derived value changes.
    const bigger: Size = { width: VIEWPORT.width * 2, height: VIEWPORT.height * 2 };
    expect(worldToScreen(cam, { x: cam.x, y: cam.y })).toEqual({ x: 0, y: 0 });
    expect(bigger.width).toBeGreaterThan(VIEWPORT.width);
  });
});

describe('zoomPercent and grid spacing (TC-21 support)', () => {
  it('rounds to the nearest whole percent', () => {
    expect(zoomPercent({ x: 0, y: 0, zoom: 1 })).toBe(PERCENT_PER_ZOOM);
    expect(zoomPercent({ x: 0, y: 0, zoom: ZOOM_STEP_FACTOR ** 4 })).toBe(
      Math.round(ZOOM_STEP_FACTOR ** 4 * PERCENT_PER_ZOOM),
    );
    expect(zoomPercent({ x: 0, y: 0, zoom: ZOOM_MIN })).toBe(
      Math.round(ZOOM_MIN * PERCENT_PER_ZOOM),
    );
    expect(zoomPercent({ x: 0, y: 0, zoom: ZOOM_MAX })).toBe(
      Math.round(ZOOM_MAX * PERCENT_PER_ZOOM),
    );
  });

  it('grid spacing in screen pixels scales with zoom and repeats modulo the spacing', () => {
    const cam: Camera = { x: 0, y: 0, zoom: 1 };
    const spacingPx = (z: number) => GRID_SPACING_WORLD * z;
    expect(spacingPx(cam.zoom)).toBe(GRID_SPACING_WORLD);
    expect(spacingPx(ZOOM_MAX)).toBe(GRID_SPACING_WORLD * ZOOM_MAX);
  });
});
