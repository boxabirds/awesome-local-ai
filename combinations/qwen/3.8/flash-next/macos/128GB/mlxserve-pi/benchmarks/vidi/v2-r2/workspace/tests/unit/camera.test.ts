import { describe, expect, it } from 'vitest';
import {
  GRID_SPACING_WORLD,
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

const VIEWPORT: Size = { width: 1280, height: 800 };
const ORIGIN: Point = { x: 0, y: 0 };

/** Tolerance for "exact" maths (sub-pixel, far smaller than the 1 px the PRD allows). */
const EXACT = 1e-6;

const atOrigin: Camera = { x: 0, y: 0, zoom: 1 };
const atMin: Camera = { x: 0, y: 0, zoom: ZOOM_MIN };
const atMax: Camera = { x: 0, y: 0, zoom: ZOOM_MAX };
const farAway: Camera = {
  x: UNBOUNDED_PAN_TESTED_EXTENT,
  y: UNBOUNDED_PAN_TESTED_EXTENT,
  zoom: 1,
};

function samePoint(a: Point, b: Point, tol = EXACT): void {
  expect(Math.abs(a.x - b.x)).toBeLessThanOrEqual(tol);
  expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(tol);
}

describe('camera maths', () => {
  // TC-01: dragging 200 px right / 100 px down at zoom 1 moves the camera by
  // (-200, -100) world units, so world (0,0) lands 200 px right / 100 px down.
  it('TC-01 panBy moves the camera by the screen delta divided by zoom', () => {
    const next = panBy(atOrigin, 200, 100);
    expect(next.x).toBeCloseTo(-200, 10);
    expect(next.y).toBeCloseTo(-100, 10);
    expect(next.zoom).toBe(1);
    samePoint(worldToScreen(next, ORIGIN), { x: 200, y: 100 }, EXACT);
  });

  // TC-02: at ZOOM_MAX, a screen delta is a smaller world delta, and precision
  // holds 1,000,000 world units away from the start.
  it('TC-02 panBy is exact at maximum zoom far from the start', () => {
    const cam: Camera = { ...farAway, zoom: ZOOM_MAX };
    const next = panBy(cam, 200, 100);
    expect(Math.abs(next.x - (cam.x - 200 / ZOOM_MAX))).toBeLessThanOrEqual(EXACT);
    expect(Math.abs(next.y - (cam.y - 100 / ZOOM_MAX))).toBeLessThanOrEqual(EXACT);
    expect(next.zoom).toBe(ZOOM_MAX);
    // Panning still follows the pointer exactly that far out: the world point
    // that was under the pointer moves by exactly the dragged screen delta.
    const pointer: Point = { x: 640, y: 400 };
    const worldUnderPointer = screenToWorld(cam, pointer);
    const moved = worldToScreen(next, worldUnderPointer);
    samePoint(moved, { x: pointer.x + 200, y: pointer.y + 100 }, 1e-3);
  });

  // TC-03: zooming around a point keeps the world point under that point.
  it('TC-03 zoomAt keeps the world point under the pointer (mid zoom, origin)', () => {
    const pointer: Point = { x: 300, y: 200 };
    const factor = 2;
    const next = zoomAt(atOrigin, pointer, factor);
    expect(next.zoom).toBe(1 * factor);
    samePoint(screenToWorld(next, pointer), screenToWorld(atOrigin, pointer));
  });

  // TC-04: the same invariant far from the start.
  it('TC-04 zoomAt keeps the world point under the pointer far from the start', () => {
    const pointer: Point = { x: 300, y: 200 };
    const next = zoomAt(farAway, pointer, 1.5);
    expect(Math.abs(next.zoom - farAway.zoom * 1.5)).toBeLessThanOrEqual(EXACT);
    samePoint(screenToWorld(next, pointer), screenToWorld(farAway, pointer));
  });

  // TC-05: at the minimum zoom, zooming out further changes nothing at all.
  it('TC-05 zoomAt at ZOOM_MIN returns the same camera object', () => {
    const centre: Point = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };
    const next = zoomAt(atMin, centre, 1 / ZOOM_STEP_FACTOR);
    expect(next).toBe(atMin);
    expect(next.x).toBe(atMin.x);
    expect(next.y).toBe(atMin.y);
  });

  // TC-06: at the maximum zoom, zooming in further changes nothing.
  it('TC-06 zoomAt at ZOOM_MAX returns the same camera object', () => {
    const centre: Point = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };
    expect(zoomAt(atMax, centre, ZOOM_STEP_FACTOR)).toBe(atMax);
    expect(canZoomIn(atMax)).toBe(false);
  });

  // TC-07: resizing the board area does not move content relative to its
  // top-left corner: the camera is not an input to a resize, and screen
  // positions of world points are unchanged by a size change alone.
  it('TC-07 a viewport size change leaves the camera unchanged', () => {
    const cam: Camera = { x: -123.5, y: 45.25, zoom: 1.5 };
    const before = worldToScreen(cam, { x: 10, y: 20 });
    // Nothing in the camera contract takes the viewport size as a mutation;
    // a resize therefore keeps x, y and zoom exactly as they were.
    const afterResize: Camera = { ...cam };
    expect(afterResize).toEqual({ x: -123.5, y: 45.25, zoom: 1.5 });
    expect(afterResize.x).toBe(cam.x);
    expect(afterResize.y).toBe(cam.y);
    expect(panBy(afterResize, 0, 0)).toBe(afterResize);
    samePoint(worldToScreen(afterResize, { x: 10, y: 20 }), before, 0);
  });

  // TC-08: Reset view returns to 100% with the board start centred.
  it('TC-08 resetCamera zooms to 1 and centres the board start point', () => {
    const cam: Camera = { x: UNBOUNDED_PAN_TESTED_EXTENT, y: -UNBOUNDED_PAN_TESTED_EXTENT, zoom: ZOOM_MAX };
    const size: Size = { width: 1200, height: 800 };
    const next = resetCamera(size);
    expect(next.zoom).toBe(1);
    expect(next.x).toBe(-size.width / 2);
    expect(next.y).toBe(-size.height / 2);
    samePoint(worldToScreen(next, ORIGIN), { x: size.width / 2, y: size.height / 2 }, EXACT);
    // unchanged from an already-reset camera too
    expect(resetCamera({ width: 1200, height: 800 })).toEqual(next);
    expect(cam.zoom).toBe(ZOOM_MAX);
  });

  // TC-09: one step in then one step out returns exactly to the start
  // (float drift would show as 1.0000000000000002).
  it('TC-09 a step in then a step out returns to exactly 100%', () => {
    const in1 = zoomStep(atOrigin, VIEWPORT, 'in');
    expect(in1.zoom).toBe(ZOOM_STEP_FACTOR);
    expect(zoomPercent(in1)).toBe(125);
    const out = zoomStep(in1, VIEWPORT, 'out');
    expect(out.zoom).toBe(1);
    expect(zoomPercent(out)).toBe(100);
  });

  // TC-10: repeated zoom-in stops at ZOOM_MAX and disables the + button.
  it('TC-10 repeated steps in clamp at ZOOM_MAX', () => {
    let cam: Camera = atOrigin;
    for (let i = 0; i < 20; i++) cam = zoomStep(cam, VIEWPORT, 'in');
    expect(cam.zoom).toBe(ZOOM_MAX);
    expect(canZoomIn(cam)).toBe(false);
    expect(canZoomOut(cam)).toBe(true);
    expect(zoomPercent(cam)).toBe(400);
    expect(zoomStep(cam, VIEWPORT, 'in')).toBe(cam);
    // and zooming back the other way re-enables zoom in
    cam = zoomStep(cam, VIEWPORT, 'out');
    expect(canZoomIn(cam)).toBe(true);
  });

  // TC-10b: the same clamp on the way out.
  it('TC-10b repeated steps out clamp at ZOOM_MIN', () => {
    let cam: Camera = atOrigin;
    for (let i = 0; i < 20; i++) cam = zoomStep(cam, VIEWPORT, 'out');
    expect(cam.zoom).toBe(ZOOM_MIN);
    expect(canZoomOut(cam)).toBe(false);
    expect(zoomPercent(cam)).toBe(10);
    expect(zoomStep(cam, VIEWPORT, 'out')).toBe(cam);
    expect(zoomStep(cam, VIEWPORT, 'in').zoom).toBeGreaterThan(ZOOM_MIN);
  });

  // TC-11: an enormous wheel delta clamps, and the pointer stays fixed.
  it('TC-11 a huge zoom factor clamps to ZOOM_MAX and keeps the pointer fixed', () => {
    const pointer: Point = { x: 400, y: 300 };
    const next = zoomAt(atOrigin, pointer, 1000);
    expect(next.zoom).toBe(ZOOM_MAX);
    samePoint(screenToWorld(next, pointer), screenToWorld(atOrigin, pointer));
  });

  // TC-12: invalid factors never corrupt the camera.
  it('TC-12 invalid zoom factors return the input camera unchanged', () => {
    const pointer: Point = { x: 300, y: 200 };
    for (const factor of [0, -1, -ZOOM_STEP_FACTOR, NaN, Infinity, -Infinity]) {
      const next = zoomAt(atOrigin, pointer, factor);
      expect(next).toBe(atOrigin);
      expect(Number.isFinite(next.x)).toBe(true);
      expect(Number.isFinite(next.y)).toBe(true);
      expect(Number.isFinite(next.zoom)).toBe(true);
    }
    // invalid deltas and factors leave everything finite
    expect(Number.isFinite(panBy(atOrigin, 0, 0).zoom)).toBe(true);
    expect(atOrigin.zoom).toBe(1);
  });

  // TC-21 maths basis: the percentage label is a whole number.
  it('TC-21 zoomPercent rounds to the nearest whole percent', () => {
    expect(zoomPercent({ x: 0, y: 0, zoom: 1.5625 })).toBe(156);
    expect(zoomPercent(atMin)).toBe(10);
    expect(zoomPercent(atMax)).toBe(400);
    expect(zoomPercent({ x: 0, y: 0, zoom: 1.25 })).toBe(125);
  });

  // Grid: the dot grid is drawn from the camera modulo the grid spacing, so it
  // stays evenly spaced at any distance (basis for the e2e spacing check).
  it('grid phase stays within one tile at any distance and zoom', () => {
    for (const cam of [
      atOrigin,
      farAway,
      { ...farAway, zoom: ZOOM_MAX },
      { x: -UNBOUNDED_PAN_TESTED_EXTENT, y: 137, zoom: ZOOM_MIN },
    ]) {
      for (const axis of ['x', 'y'] as const) {
        const spacing = GRID_SPACING_WORLD * cam.zoom;
        const phase = ((-cam[axis] * cam.zoom) % spacing) + spacing;
        expect(Number.isFinite(phase)).toBe(true);
        expect(phase).toBeGreaterThanOrEqual(0);
        expect(phase).toBeLessThan(spacing * 2);
      }
    }
  });

  // Property-style check: for 1,000 random cameras/points/factors within the
  // limits, the world point under the pointer is invariant under zoomAt.
  it('property: zoomAt keeps the pointer fixed for 1000 random inputs', () => {
    let seed = 0x9e3779b9;
    const rand = () => {
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
      const pointer: Point = {
        x: rand() * VIEWPORT.width,
        y: rand() * VIEWPORT.height,
      };
      const factor = Math.exp((rand() * 2 - 1) * 2);
      const before = screenToWorld(cam, pointer);
      const next = zoomAt(cam, pointer, factor);
      expect(next.zoom).toBeGreaterThanOrEqual(ZOOM_MIN);
      expect(next.zoom).toBeLessThanOrEqual(ZOOM_MAX);
      samePoint(screenToWorld(next, pointer), before);
    }
  });
});
