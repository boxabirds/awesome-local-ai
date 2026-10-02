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

const ORIGIN: Point = { x: 0, y: 0 };
/** Default laptop-ish board area used across the maths tests. */
const VIEWPORT: Size = { width: 1200, height: 800 };
/** A second, larger board area (see design "Fixtures"). */
const LARGE_VIEWPORT: Size = { width: 1920, height: 1080 };
const FAR = UNBOUNDED_PAN_TESTED_EXTENT;
/** World-unit tolerance from the design ("within 1e-6"). */
const WORLD_TOLERANCE = 1e-6;
/** A drag of 200 px right and 100 px down (PRD pan.drag verification). */
const DRAG_DX = 200;
const DRAG_DY = 100;

const camera = (x: number, y: number, zoom: number): Camera => ({ x, y, zoom });
const centreOf = (viewport: Size): Point => ({
  x: viewport.width / 2,
  y: viewport.height / 2,
});
const inverseStep = 1 / ZOOM_STEP_FACTOR;

describe('camera.math — panBy', () => {
  it('TC-01 pans by exactly the pointer delta at zoom 1', () => {
    const before = camera(0, 0, 1);
    const after = panBy(before, DRAG_DX, DRAG_DY);

    expect(after.x).toBeCloseTo(0 - DRAG_DX / 1, 10);
    expect(after.y).toBeCloseTo(0 - DRAG_DY / 1, 10);
    // the world origin moves with the pointer: (0,0) screen (0,0) -> (200,100)
    const dot = worldToScreen(after, ORIGIN);
    expect(dot.x).toBeCloseTo(DRAG_DX, 10);
    expect(dot.y).toBeCloseTo(DRAG_DY, 10);
    expect(after.zoom).toBe(before.zoom);
  });

  it('TC-01b returns the same object for a zero-length drag', () => {
    const before = camera(12, -34, 1.5);
    expect(panBy(before, 0, 0)).toBe(before);
  });

  it('TC-02 pans by the delta converted to world units at ZOOM_MAX far from the start', () => {
    const before = camera(FAR, FAR, ZOOM_MAX);
    const after = panBy(before, DRAG_DX, DRAG_DY);

    expect(after.x).toBeCloseTo(FAR - DRAG_DX / ZOOM_MAX, 6);
    expect(after.y).toBeCloseTo(FAR - DRAG_DY / ZOOM_MAX, 6);
    expect(after.x).not.toBe(before.x);
    // still sub-pixel precise: one screen pixel is 1/ZOOM_MAX world units
    const before0 = worldToScreen(before, ORIGIN);
    const after0 = worldToScreen(after, ORIGIN);
    expect(after0.x - before0.x).toBeCloseTo(DRAG_DX, 6);
    expect(after0.y - before0.y).toBeCloseTo(DRAG_DY, 6);
  });

  it('TC-02b leaves no visible grid distortion 1,000,000 units away', () => {
    const at1 = camera(FAR, -FAR, 1);
    const atMax = camera(FAR, -FAR, ZOOM_MAX);
    // Grid dots sit on multiples of GRID_SPACING_WORLD, so their screen spacing
    // must stay exactly GRID_SPACING_WORLD * zoom however far out we are.
    const nextX: Point = { x: GRID_SPACING_WORLD, y: 0 };
    const nextY: Point = { x: 0, y: GRID_SPACING_WORLD };
    for (const cam of [at1, atMax]) {
      const dot = worldToScreen(cam, ORIGIN);
      const right = worldToScreen(cam, nextX);
      const down = worldToScreen(cam, nextY);
      const expected = GRID_SPACING_WORLD * cam.zoom;

      expect(Math.abs((right.x - dot.x) / expected - 1)).toBeLessThan(1e-9);
      expect(Math.abs((down.y - dot.y) / expected - 1)).toBeLessThan(1e-9);

      // and panning here still follows the pointer exactly
      const after = panBy(cam, DRAG_DX, DRAG_DY);
      const moved = worldToScreen(after, ORIGIN);
      expect(Math.abs(moved.x - (dot.x + DRAG_DX))).toBeLessThan(WORLD_TOLERANCE);
      expect(Math.abs(moved.y - (dot.y + DRAG_DY))).toBeLessThan(WORLD_TOLERANCE);
    }
  });
});

describe('camera.math — zoomAt (zoom around a point)', () => {
  it('TC-03 keeps the world point under the pointer fixed', () => {
    const before = camera(0, 0, 1);
    const pointer: Point = { x: 300, y: 200 };
    const after = zoomAt(before, pointer, 2);

    expect(after.zoom).toBeCloseTo(2, 10);
    const wBefore = screenToWorld(before, pointer);
    const wAfter = screenToWorld(after, pointer);
    expect(wAfter.x - wBefore.x).toBeLessThan(WORLD_TOLERANCE);
    expect(wAfter.y - wBefore.y).toBeLessThan(WORLD_TOLERANCE);
  });

  it('TC-04 keeps the pointer invariant at ZOOM_MAX far from the start', () => {
    const before = camera(FAR, -FAR, 1);
    const pointer: Point = { x: 400, y: 50 };
    const after = zoomAt(before, pointer, 1.5);
    const wBefore = screenToWorld(before, pointer);
    const wAfter = screenToWorld(after, pointer);

    expect(after.zoom).toBeCloseTo(1.5, 10);
    expect(Math.abs(wAfter.x - wBefore.x)).toBeLessThan(WORLD_TOLERANCE);
    expect(Math.abs(wAfter.y - wBefore.y)).toBeLessThan(WORLD_TOLERANCE);
  });

  it('TC-05 returns the same object when zooming out past ZOOM_MIN', () => {
    const before = camera(0, 0, ZOOM_MIN);
    const after = zoomAt(before, centreOf(VIEWPORT), inverseStep);

    expect(after).toBe(before);
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
  });

  it('TC-06 returns the same object when zooming in past ZOOM_MAX', () => {
    const before = camera(0, 0, ZOOM_MAX);
    const after = zoomAt(before, centreOf(VIEWPORT), ZOOM_STEP_FACTOR);

    expect(after).toBe(before);
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
  });

  it('TC-11 clamps a huge wheel delta and still keeps the pointer fixed', () => {
    const before = camera(0, 0, 1);
    const pointer: Point = { x: 300, y: 200 };
    const after = zoomAt(before, pointer, 1000);

    expect(after.zoom).toBe(ZOOM_MAX);
    const wBefore = screenToWorld(before, pointer);
    const wAfter = screenToWorld(after, pointer);
    expect(Math.abs(wAfter.x - wBefore.x)).toBeLessThan(WORLD_TOLERANCE);
    expect(Math.abs(wAfter.y - wBefore.y)).toBeLessThan(WORLD_TOLERANCE);
  });

  it('TC-11b clamps a huge zoom-out delta to ZOOM_MIN', () => {
    const before = camera(10, 20, 1);
    const after = zoomAt(before, centreOf(VIEWPORT), 1 / 1000);
    expect(after.zoom).toBe(ZOOM_MIN);
  });

  it('TC-12 ignores invalid zoom factors and never produces NaN', () => {
    const before = camera(-120, 340, 1);
    for (const factor of [0, -1, -ZOOM_STEP_FACTOR, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const after = zoomAt(before, centreOf(VIEWPORT), factor);
      expect(after).toBe(before);
      expect(Number.isFinite(after.x)).toBe(true);
      expect(Number.isFinite(after.y)).toBe(true);
      expect(Number.isFinite(after.zoom)).toBe(true);
    }
  });
});

describe('camera.math — viewport resize', () => {
  it('TC-07 a resize leaves camera x, y and zoom unchanged', () => {
    const before = resetCamera(VIEWPORT);
    // Camera state is not derived from the viewport size, so a resize does not
    // move content relative to the top-left corner of the board area.
    const afterResize = before;

    expect(afterResize).toBe(before);
    expect([afterResize.x, afterResize.y, afterResize.zoom]).toEqual([
      -VIEWPORT.width / 2,
      -VIEWPORT.height / 2,
      1,
    ]);
    expect(panBy(afterResize, 0, 0)).toBe(afterResize);
    // the new size is only read for the centre point of viewport-aware helpers
    expect(zoomStep(afterResize, LARGE_VIEWPORT, 'in').zoom).toBe(ZOOM_STEP_FACTOR);
    expect(worldToScreen(afterResize, ORIGIN)).toEqual({
      x: VIEWPORT.width / 2,
      y: VIEWPORT.height / 2,
    });
  });
});

describe('camera.math — resetCamera', () => {
  it('TC-08 resets to 100% with the board start centred', () => {
    const before = camera(FAR, FAR, ZOOM_MAX);
    const after = resetCamera({ width: 1200, height: 800 });

    expect(after.zoom).toBe(1);
    expect([after.x, after.y]).toEqual([-600, -400]);
    expect(after).not.toBe(before);
    expect(worldToScreen(after, ORIGIN)).toEqual({ x: 600, y: 400 });
    expect(zoomPercent(after)).toBe(100);
    expect(canZoomIn(after)).toBe(true);
    expect(canZoomOut(after)).toBe(true);
  });
});

describe('camera.math — zoomStep (buttons and keys)', () => {
  it('TC-09 one step in and one step out returns exactly the starting zoom', () => {
    const before = camera(0, 0, 1);
    const inStep = zoomStep(before, VIEWPORT, 'in');
    const outStep = zoomStep(inStep, VIEWPORT, 'out');

    expect(inStep.zoom).toBe(ZOOM_STEP_FACTOR);
    expect(zoomPercent(inStep)).toBe(125);
    expect(outStep.zoom).toBe(1);
    expect(zoomPercent(outStep)).toBe(100);
    // the centre point stayed put, so we come back to the same place
    expect(outStep.x).toBeCloseTo(before.x, 6);
    expect(outStep.y).toBeCloseTo(before.y, 6);
  });

  it('TC-09b keeps the board location at the centre of the board area still', () => {
    const before = camera(-123.5, 77.25, 1);
    const centre = centreOf(VIEWPORT);
    const after = zoomStep(before, VIEWPORT, 'in');
    const wBefore = screenToWorld(before, centre);
    const wAfter = screenToWorld(after, centre);

    expect(Math.abs(wAfter.x - wBefore.x)).toBeLessThan(WORLD_TOLERANCE);
    expect(Math.abs(wAfter.y - wBefore.y)).toBeLessThan(WORLD_TOLERANCE);
  });

  it('TC-10 clamps after 20 steps in and reports canZoomIn false', () => {
    let cam: Camera = camera(0, 0, 1);
    const zooms: number[] = [];
    for (let i = 0; i < 20; i += 1) {
      const next = zoomStep(cam, VIEWPORT, 'in');
      zooms.push(next.zoom);
      cam = next;
    }

    expect(cam.zoom).toBe(ZOOM_MAX);
    expect(canZoomIn(cam)).toBe(false);
    expect(canZoomOut(cam)).toBe(true);
    expect(zooms.filter((z) => z === ZOOM_MAX).length).toBeGreaterThan(1);
    // once at the limit the camera object stops changing entirely
    expect(zoomStep(cam, VIEWPORT, 'in')).toBe(cam);
    // and zooming back out re-enables zoom in
    const back = zoomStep(cam, VIEWPORT, 'out');
    expect(back.zoom).toBeLessThan(ZOOM_MAX);
    expect(canZoomIn(back)).toBe(true);
  });

  it('TC-10b clamps after 20 steps out and reports canZoomOut false', () => {
    let cam: Camera = camera(0, 0, 1);
    for (let i = 0; i < 20; i += 1) cam = zoomStep(cam, VIEWPORT, 'out');

    expect(cam.zoom).toBe(ZOOM_MIN);
    expect(canZoomOut(cam)).toBe(false);
    expect(canZoomIn(cam)).toBe(true);
    expect(zoomStep(cam, VIEWPORT, 'out')).toBe(cam);
    expect(zoomStep(cam, VIEWPORT, 'in').zoom).toBeGreaterThan(ZOOM_MIN);
  });
});

describe('camera.math — zoom indicator', () => {
  it('TC-21-equivalent rounds the zoom to a whole percentage', () => {
    expect(zoomPercent(camera(0, 0, 1))).toBe(100);
    expect(zoomPercent(camera(0, 0, ZOOM_STEP_FACTOR))).toBe(125);
    expect(zoomPercent(camera(0, 0, ZOOM_MIN))).toBe(10);
    expect(zoomPercent(camera(0, 0, ZOOM_MAX))).toBe(400);
    expect(zoomPercent(camera(0, 0, 1.5625))).toBe(156);
  });
});

describe('camera.math — screen/world transforms', () => {
  it('round-trips screen and world coordinates', () => {
    const cam = camera(-500, 250, 2.5);
    const p: Point = { x: 123, y: 456 };
    const world = screenToWorld(cam, p);
    expect(world.x).toBeCloseTo(cam.x + p.x / cam.zoom, 10);
    expect(world.y).toBeCloseTo(cam.y + p.y / cam.zoom, 10);
    const back = worldToScreen(cam, world);
    expect(back.x).toBeCloseTo(p.x, 9);
    expect(back.y).toBeCloseTo(p.y, 9);
  });
});

describe('camera.math — property check', () => {
  it('keeps the world point under the pointer invariant for 1,000 random cases', () => {
    let state = 0x9e3779b9;
    const rand = () => {
      state += 0x6d2b79f5;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const range = (min: number, max: number) => min + rand() * (max - min);

    let checked = 0;
    for (let i = 0; i < 1000; i += 1) {
      const cam = camera(
        range(-UNBOUNDED_PAN_TESTED_EXTENT, UNBOUNDED_PAN_TESTED_EXTENT),
        range(-UNBOUNDED_PAN_TESTED_EXTENT, UNBOUNDED_PAN_TESTED_EXTENT),
        range(ZOOM_MIN, ZOOM_MAX),
      );
      const pointer: Point = { x: range(0, LARGE_VIEWPORT.width), y: range(0, LARGE_VIEWPORT.height) };
      const factor = range(1 / 3, 3);
      const after = zoomAt(cam, pointer, factor);
      const before = screenToWorld(cam, pointer);
      const world = screenToWorld(after, pointer);

      expect(Number.isFinite(after.x)).toBe(true);
      expect(Number.isFinite(after.y)).toBe(true);
      expect(after.zoom).toBeGreaterThanOrEqual(ZOOM_MIN);
      expect(after.zoom).toBeLessThanOrEqual(ZOOM_MAX);
      if (after !== cam) {
        checked += 1;
        expect(Math.abs(world.x - before.x)).toBeLessThan(WORLD_TOLERANCE);
        expect(Math.abs(world.y - before.y)).toBeLessThan(WORLD_TOLERANCE);
      }
    }
    expect(checked).toBeGreaterThan(900);
  });
});
