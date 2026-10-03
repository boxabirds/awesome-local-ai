import { describe, expect, it } from 'vitest';

import {
  GRID_SPACING_WORLD,
  UNBOUNDED_PAN_TESTED_EXTENT,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP_FACTOR,
} from '../../src/shared/config.js';
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
} from '../../src/client/canvas/camera.js';

/** Numeric tolerance for "exact within 1e-6" assertions (TC-02, TC-04, TC-11). */
const EPSILON = 1e-6;
/** Screen-space drag used by the pan tests: 200 px right, 100 px down (TC-01). */
const DRAG_X = 200;
const DRAG_Y = 100;
/** One step in, expressed through the config step factor. */
const STEP_IN = ZOOM_STEP_FACTOR;
/** One step out, expressed through the config step factor. */
const STEP_OUT = 1 / ZOOM_STEP_FACTOR;
/** More steps than it takes to walk from ZOOM_MIN to ZOOM_MAX (TC-10). */
const MANY_STEPS = 20;

const VIEWPORT: Size = { width: 1200, height: 800 };
const CENTRE: Point = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };
const WORLD_ORIGIN: Point = { x: 0, y: 0 };
/** A point far from the start, in the middle of the tested extent (TC-02, TC-04). */
const FAR: Point = { x: UNBOUNDED_PAN_TESTED_EXTENT, y: UNBOUNDED_PAN_TESTED_EXTENT };
/** A pointer position away from the viewport centre, used for zoom-at-pointer. */
const POINTER: Point = { x: 300, y: 200 };

const camera = (x: number, y: number, zoom: number): Camera => ({ x, y, zoom });

const expectPointsClose = (a: Point, b: Point, epsilon = EPSILON) => {
  expect(a.x).toBeCloseTo(b.x, -Math.log10(epsilon));
  expect(a.y).toBeCloseTo(b.y, -Math.log10(epsilon));
};

describe('screenToWorld / worldToScreen', () => {
  it('are inverses of each other', () => {
    const cam = camera(-640, -400, 1.5);
    const p: Point = { x: 123.5, y: -87.25 };
    expectPointsClose(screenToWorld(cam, worldToScreen(cam, p)), p);
  });

  it('maps the camera position to the viewport top-left', () => {
    const cam = camera(12, 34, 2);
    expectPointsClose(screenToWorld(cam, { x: 0, y: 0 }), { x: cam.x, y: cam.y });
    expectPointsClose(worldToScreen(cam, { x: cam.x, y: cam.y }), { x: 0, y: 0 });
  });
});

describe('panBy', () => {
  it('TC-01 moves the camera by -delta/zoom and the content by exactly the drag', () => {
    const cam = camera(0, 0, 1);
    const next = panBy(cam, DRAG_X, DRAG_Y);
    expect(next.x).toBeCloseTo(-DRAG_X / cam.zoom, 9);
    expect(next.y).toBeCloseTo(-DRAG_Y / cam.zoom, 9);
    // The world origin, which was at the viewport top-left, is now under the pointer.
    expectPointsClose(worldToScreen(next, WORLD_ORIGIN), { x: DRAG_X, y: DRAG_Y });
  });

  it('TC-02 is exact at ZOOM_MAX a million world units from the start', () => {
    const cam = camera(FAR.x, FAR.y, ZOOM_MAX);
    const next = panBy(cam, DRAG_X, DRAG_Y);
    expect(next.x).toBeCloseTo(FAR.x - DRAG_X / ZOOM_MAX, 6);
    expect(next.y).toBeCloseTo(FAR.y - DRAG_Y / ZOOM_MAX, 6);
    // The screen position of that far world point moved by exactly the drag.
    expect(worldToScreen(next, FAR).x - worldToScreen(cam, FAR).x).toBeCloseTo(DRAG_X, 6);
    expect(worldToScreen(next, FAR).y - worldToScreen(cam, FAR).y).toBeCloseTo(DRAG_Y, 6);
    expect(next.zoom).toBe(ZOOM_MAX);
  });

  it('returns the same camera for a zero-length drag', () => {
    const cam = camera(-10, 20, 1.25);
    expect(panBy(cam, 0, 0)).toBe(cam);
  });

  it('ignores non-finite deltas', () => {
    const cam = camera(-10, 20, 1.25);
    expect(panBy(cam, Number.NaN, 5)).toBe(cam);
    expect(panBy(cam, 5, Number.POSITIVE_INFINITY)).toBe(cam);
  });

  it('keeps sub-pixel precision after many drags at maximum zoom far away', () => {
    let cam = camera(FAR.x, FAR.y, ZOOM_MAX);
    const before = worldToScreen(cam, FAR);
    for (let i = 0; i < 1000; i += 1) cam = panBy(cam, 1 / ZOOM_MAX, 0);
    expect(worldToScreen(cam, FAR).x - before.x).toBeCloseTo(1000 / ZOOM_MAX, 6);
  });
});

describe('zoomAt', () => {
  it('TC-03 keeps the world point under the pointer fixed at the origin', () => {
    const cam = camera(0, 0, 1);
    const before = screenToWorld(cam, POINTER);
    const next = zoomAt(cam, POINTER, 2);
    expect(next.zoom).toBeCloseTo(2, 9);
    expectPointsClose(screenToWorld(next, POINTER), before);
  });

  it('TC-04 keeps the world point under the pointer fixed a million units away', () => {
    const cam = camera(FAR.x, FAR.y, 1);
    const before = screenToWorld(cam, POINTER);
    const next = zoomAt(cam, POINTER, 1.5);
    expect(next.zoom).toBeCloseTo(1.5, 9);
    expectPointsClose(screenToWorld(next, POINTER), before);
  });

  it('TC-05 returns the same camera when zooming out below ZOOM_MIN', () => {
    const cam = camera(0, 0, ZOOM_MIN);
    expect(zoomAt(cam, CENTRE, STEP_OUT)).toBe(cam);
    expect(zoomStep(cam, VIEWPORT, 'out')).toBe(cam);
    expect(canZoomOut(cam)).toBe(false);
    expect(canZoomIn(cam)).toBe(true);
  });

  it('TC-06 returns the same camera when zooming in past ZOOM_MAX', () => {
    const cam = camera(0, 0, ZOOM_MAX);
    expect(zoomAt(cam, CENTRE, STEP_IN)).toBe(cam);
    expect(zoomStep(cam, VIEWPORT, 'in')).toBe(cam);
    expect(canZoomIn(cam)).toBe(false);
    expect(canZoomOut(cam)).toBe(true);
  });

  it('TC-11 clamps a huge factor and still keeps the pointer invariant', () => {
    const cam = camera(0, 0, 1);
    const next = zoomAt(cam, POINTER, 1000);
    expect(next.zoom).toBe(ZOOM_MAX);
    expectPointsClose(screenToWorld(next, POINTER), screenToWorld(cam, POINTER));
  });

  it('TC-12 returns the input camera for invalid factors and never yields NaN', () => {
    const cam = camera(-640, -400, 1);
    for (const factor of [0, -1, -STEP_IN, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const next = zoomAt(cam, POINTER, factor);
      expect(next).toBe(cam);
      expect(Number.isFinite(next.x)).toBe(true);
      expect(Number.isFinite(next.y)).toBe(true);
      expect(Number.isFinite(next.zoom)).toBe(true);
    }
  });

  it('scales the dot-grid spacing by the zoom', () => {
    const cam = camera(0, 0, 1);
    const next = zoomAt(cam, CENTRE, STEP_IN);
    const dot = (i: number): Point => ({ x: i * GRID_SPACING_WORLD, y: 0 });
    const spacingBefore = worldToScreen(cam, dot(2)).x - worldToScreen(cam, dot(1)).x;
    const spacingAfter = worldToScreen(next, dot(2)).x - worldToScreen(next, dot(1)).x;
    expect(spacingBefore).toBeCloseTo(GRID_SPACING_WORLD * cam.zoom, 9);
    expect(spacingAfter).toBeCloseTo(GRID_SPACING_WORLD * next.zoom, 9);
  });
});

describe('resetCamera', () => {
  it('TC-07 leaves the camera independent of the viewport size (resize moves nothing)', () => {
    const cam = resetCamera(VIEWPORT);
    // The camera is not a function of the viewport size: a resize keeps the same
    // x, y and zoom, so content does not move relative to the top-left corner.
    const larger: Size = { width: 1920, height: 1080 };
    const afterResize = camera(cam.x, cam.y, cam.zoom);
    expect(afterResize).toEqual(cam);
    expect(afterResize.x).toBe(-VIEWPORT.width / 2);
    expect(afterResize.y).toBe(-VIEWPORT.height / 2);
    // The world point at the viewport top-left is unchanged by the resize.
    expectPointsClose(screenToWorld(afterResize, { x: 0, y: 0 }), screenToWorld(cam, { x: 0, y: 0 }));
    // ...while a *bigger* viewport simply shows more board, not shifted board.
    expect(worldToScreen(cam, { x: 0, y: 0 }).x).toBeCloseTo(VIEWPORT.width / 2, 9);
    expect(resetCamera(larger).x).toBe(-larger.width / 2);
  });

  it('TC-08 returns to zoom 1 with the board start centred', () => {
    // Panned far away and zoomed to the maximum first.
    const cam = camera(FAR.x - VIEWPORT.width / 2, FAR.y - VIEWPORT.height / 2, ZOOM_MAX);
    expect(cam.zoom).toBe(ZOOM_MAX);
    const next = resetCamera(VIEWPORT);
    expect(next.zoom).toBe(1);
    expect(next.x).toBeCloseTo(-VIEWPORT.width / 2, 9);
    expect(next.y).toBeCloseTo(-VIEWPORT.height / 2, 9);
    // The board's starting point is at the centre of the board area.
    expectPointsClose(worldToScreen(next, WORLD_ORIGIN), CENTRE);
  });
});

describe('zoomStep', () => {
  it('TC-09 steps in then out returning exactly to 1.0', () => {
    const cam = camera(0, 0, 1);
    const zoomedIn = zoomStep(cam, VIEWPORT, 'in');
    expect(zoomedIn.zoom).toBe(1 * ZOOM_STEP_FACTOR);
    expect(zoomPercent(zoomedIn)).toBe(125);
    const back = zoomStep(zoomedIn, VIEWPORT, 'out');
    expect(back.zoom).toBe(1);
    expect(zoomPercent(back)).toBe(100);
  });

  it('TC-10 clamps at ZOOM_MAX after repeated steps in and disables zoom in', () => {
    let cam: Camera = camera(0, 0, 1);
    for (let i = 0; i < MANY_STEPS; i += 1) cam = zoomStep(cam, VIEWPORT, 'in');
    expect(cam.zoom).toBe(ZOOM_MAX);
    expect(canZoomIn(cam)).toBe(false);
    expect(canZoomOut(cam)).toBe(true);
    expect(zoomPercent(cam)).toBe(400);
    // One step out of the limit works again.
    expect(zoomStep(cam, VIEWPORT, 'out').zoom).toBeCloseTo(ZOOM_MAX / ZOOM_STEP_FACTOR, 9);
  });

  it('clamps at ZOOM_MIN after repeated steps out and disables zoom out', () => {
    let cam: Camera = camera(0, 0, 1);
    for (let i = 0; i < MANY_STEPS; i += 1) cam = zoomStep(cam, VIEWPORT, 'out');
    expect(cam.zoom).toBe(ZOOM_MIN);
    expect(canZoomOut(cam)).toBe(false);
    expect(zoomPercent(cam)).toBe(10);
  });

  it('keeps the viewport centre fixed while stepping', () => {
    const cam = camera(123, -456, 1);
    const centreWorldBefore = screenToWorld(cam, CENTRE);
    const next = zoomStep(cam, VIEWPORT, 'in');
    expectPointsClose(screenToWorld(next, CENTRE), centreWorldBefore, 9);
  });

  it('walks the whole ladder in and back out without drift', () => {
    let cam: Camera = camera(0, 0, 1);
    for (let i = 0; i < 6; i += 1) cam = zoomStep(cam, VIEWPORT, 'in');
    expect(zoomPercent(cam)).toBe(Math.round(ZOOM_STEP_FACTOR ** 6 * 100));
    for (let i = 0; i < 6; i += 1) cam = zoomStep(cam, VIEWPORT, 'out');
    expect(cam.zoom).toBe(1);
  });
});

describe('zoomPercent', () => {
  it('rounds to a whole percent', () => {
    expect(zoomPercent(camera(0, 0, 1))).toBe(100);
    expect(zoomPercent(camera(0, 0, 1.5625))).toBe(156);
    expect(zoomPercent(camera(0, 0, ZOOM_MIN))).toBe(10);
    expect(zoomPercent(camera(0, 0, ZOOM_MAX))).toBe(400);
  });
});

describe('property: zoomAt keeps the world point under the pointer invariant', () => {
  /** Deterministic PRNG so the property check is reproducible. */
  const makeRandom = (seed: number) => {
    let state = seed >>> 0;
    return () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 0x1_0000_0000;
    };
  };

  it('holds for 1000 seeded cameras, points and factors', () => {
    const random = makeRandom(20260917);
    const viewport: Size = { width: 1280, height: 800 };
    let checked = 0;

    for (let i = 0; i < 1000; i += 1) {
      const zoom = ZOOM_MIN + random() * (ZOOM_MAX - ZOOM_MIN);
      const cam = camera(
        (random() * 2 - 1) * UNBOUNDED_PAN_TESTED_EXTENT,
        (random() * 2 - 1) * UNBOUNDED_PAN_TESTED_EXTENT,
        zoom,
      );
      const p: Point = { x: random() * viewport.width, y: random() * viewport.height };
      const factor = Math.exp((random() * 2 - 1) * 2);
      const before = screenToWorld(cam, p);
      const next = zoomAt(cam, p, factor);
      if (next === cam) continue; // clamped at a limit: nothing moved
      checked += 1;
      const after = screenToWorld(next, p);
      expect(Math.abs(after.x - before.x)).toBeLessThan(EPSILON);
      expect(Math.abs(after.y - before.y)).toBeLessThan(EPSILON);
      expect(next.zoom).toBeGreaterThanOrEqual(ZOOM_MIN);
      expect(next.zoom).toBeLessThanOrEqual(ZOOM_MAX);
    }

    expect(checked).toBeGreaterThan(900);
  });

  it('keeps the grid evenly spaced at any camera position', () => {
    const random = makeRandom(7);
    const cam = camera(
      UNBOUNDED_PAN_TESTED_EXTENT,
      -UNBOUNDED_PAN_TESTED_EXTENT,
      ZOOM_MIN + random() * (ZOOM_MAX - ZOOM_MIN),
    );
    const spacingScreen = GRID_SPACING_WORLD * cam.zoom;
    for (let i = 1; i <= 50; i += 1) {
      const a = worldToScreen(cam, { x: i * GRID_SPACING_WORLD, y: 0 });
      const b = worldToScreen(cam, { x: (i + 1) * GRID_SPACING_WORLD, y: 0 });
      expect(Math.abs(b.x - a.x)).toBeCloseTo(spacingScreen, 6);
    }
  });
});
