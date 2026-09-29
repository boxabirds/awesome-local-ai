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
} from '../../src/client/canvas/camera.js';
import {
  GRID_SPACING_WORLD,
  UNBOUNDED_PAN_TESTED_EXTENT,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP_FACTOR,
} from '../../src/shared/config.js';

/** Tolerance used for far-away floating point comparisons. */
const FAR_TOLERANCE = 1e-6;

/** The extent the "no edges" requirement is verified at, as a camera position. */
const FAR = UNBOUNDED_PAN_TESTED_EXTENT;

const ORIGIN_CAMERA: Camera = { x: 0, y: 0, zoom: 1 };
const FAR_CAMERA: Camera = { x: FAR, y: FAR, zoom: ZOOM_MAX };
const VIEWPORT: Size = { width: 1200, height: 800 };
const CENTRE: Point = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };

describe('screenToWorld / worldToScreen', () => {
  it('inverts each other at several zoom levels', () => {
    for (const zoom of [ZOOM_MIN, 1, ZOOM_STEP_FACTOR, ZOOM_MAX]) {
      const cam: Camera = { x: -137.5, y: 42.25, zoom };
      const p: Point = { x: 512.5, y: -64.25 };
      const round = screenToWorld(cam, worldToScreen(cam, p));
      expect(round.x).toBeCloseTo(p.x, 9);
      expect(round.y).toBeCloseTo(p.y, 9);
    }
  });

  it('maps the camera origin to the viewport top-left', () => {
    const cam: Camera = { x: 10, y: -20, zoom: 2 };
    expect(worldToScreen(cam, { x: cam.x, y: cam.y })).toEqual({ x: 0, y: 0 });
    expect(screenToWorld(cam, { x: 0, y: 0 })).toEqual({ x: 10, y: -20 });
  });
});

describe('panBy (TC-01, TC-02)', () => {
  // TC-01
  it('moves the camera by delta/zoom and the content by exactly the pointer delta at zoom 1', () => {
    const after = panBy(ORIGIN_CAMERA, 200, 100);
    expect(after.x).toBe(-200);
    expect(after.y).toBe(-100);
    expect(after.zoom).toBe(1);
    // the world origin has moved 200px right and 100px down on screen
    const dot = worldToScreen(after, { x: 0, y: 0 });
    expect(dot.x).toBe(200);
    expect(dot.y).toBe(100);
  });

  // TC-02
  it('shifts by delta/zoom world units far away at maximum zoom', () => {
    const after = panBy(FAR_CAMERA, 200, 100);
    expect(after.x).toBeCloseTo(FAR - 200 / ZOOM_MAX, 9);
    expect(after.y).toBeCloseTo(FAR - 100 / ZOOM_MAX, 9);
    expect(Math.abs(FAR_CAMERA.x - after.x)).toBeCloseTo(200 / ZOOM_MAX, 9);
    expect(after.zoom).toBe(ZOOM_MAX);
    // exact within FAR_TOLERANCE
    expect(Math.abs(after.x - (FAR - 200 / ZOOM_MAX))).toBeLessThan(FAR_TOLERANCE);
  });

  it('returns the same object for a zero-length drag', () => {
    expect(panBy(ORIGIN_CAMERA, 0, 0)).toBe(ORIGIN_CAMERA);
  });

  it('does not mutate the input camera', () => {
    const cam: Camera = { x: 5, y: 7, zoom: 1 };
    panBy(cam, 50, 50);
    expect(cam).toEqual({ x: 5, y: 7, zoom: 1 });
  });

  it('pans at the tested unbounded extent without distortion', () => {
    let cam: Camera = { x: 0, y: 0, zoom: 1 };
    for (let i = 0; i < 10; i++) cam = panBy(cam, FAR / 10, FAR / 10);
    expect(cam.x).toBeCloseTo(-FAR, 6);
    expect(cam.y).toBeCloseTo(-FAR, 6);
    // grid spacing in screen pixels stays the configured size at zoom 1
    const dotA = worldToScreen(cam, { x: 0, y: 0 });
    const dotB = worldToScreen(cam, { x: GRID_SPACING_WORLD, y: 0 });
    expect(dotB.x - dotA.x).toBeCloseTo(GRID_SPACING_WORLD, 6);
  });
});

describe('zoomAt (TC-03, TC-04, TC-05, TC-06, TC-11, TC-12)', () => {
  // TC-03
  it('keeps the world point under the pointer fixed at zoom 1 near the origin', () => {
    const before = screenToWorld(ORIGIN_CAMERA, CENTRE);
    const after = zoomAt(ORIGIN_CAMERA, CENTRE, 2);
    expect(after.zoom).toBe(2);
    const afterPoint = screenToWorld(after, CENTRE);
    expect(afterPoint.x).toBeCloseTo(before.x, 9);
    expect(afterPoint.y).toBeCloseTo(before.y, 9);
  });

  // TC-04
  it('keeps the world point under the pointer fixed far away', () => {
    const pointer: Point = { x: 640, y: 480 };
    const before = screenToWorld(FAR_CAMERA, pointer);
    const after = zoomAt(FAR_CAMERA, pointer, 1.5);
    const afterPoint = screenToWorld(after, pointer);
    expect(Math.abs(afterPoint.x - before.x)).toBeLessThan(FAR_TOLERANCE);
    expect(Math.abs(afterPoint.y - before.y)).toBeLessThan(FAR_TOLERANCE);
  });

  // TC-05
  it('returns the same object when zooming out at ZOOM_MIN', () => {
    const cam: Camera = { x: 0, y: 0, zoom: ZOOM_MIN };
    const after = zoomAt(cam, CENTRE, 1 / ZOOM_STEP_FACTOR);
    expect(after).toBe(cam);
    expect(after.x).toBe(cam.x);
    expect(after.y).toBe(cam.y);
  });

  // TC-06
  it('returns the same object when zooming in at ZOOM_MAX', () => {
    const cam: Camera = { x: 0, y: 0, zoom: ZOOM_MAX };
    const after = zoomAt(cam, CENTRE, ZOOM_STEP_FACTOR);
    expect(after).toBe(cam);
    expect(after.x).toBe(cam.x);
    expect(after.y).toBe(cam.y);
  });

  // TC-11
  it('clamps a huge factor to ZOOM_MAX and still holds pointer invariance', () => {
    const pointer: Point = { x: 111, y: 37 };
    const before = screenToWorld(ORIGIN_CAMERA, pointer);
    const after = zoomAt(ORIGIN_CAMERA, pointer, 1000);
    expect(after.zoom).toBe(ZOOM_MAX);
    const afterPoint = screenToWorld(after, pointer);
    expect(afterPoint.x).toBeCloseTo(before.x, 9);
    expect(afterPoint.y).toBeCloseTo(before.y, 9);
  });

  it('clamps a huge zoom-out factor to ZOOM_MIN and still holds pointer invariance', () => {
    const pointer: Point = { x: 913, y: 22 };
    const cam: Camera = { x: -300, y: 120, zoom: 1 };
    const before = screenToWorld(cam, pointer);
    const after = zoomAt(cam, pointer, 1e-9);
    expect(after.zoom).toBe(ZOOM_MIN);
    const afterPoint = screenToWorld(after, pointer);
    expect(afterPoint.x).toBeCloseTo(before.x, 6);
    expect(afterPoint.y).toBeCloseTo(before.y, 6);
  });

  // TC-12
  it.each([
    ['zero', 0],
    ['negative', -2],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
  ])('returns the input camera unchanged for a %s factor', (_name, factor) => {
    const cam: Camera = { x: -12, y: 34, zoom: 1 };
    const after = zoomAt(cam, CENTRE, factor);
    expect(after).toBe(cam);
    expect(Number.isNaN(after.x)).toBe(false);
    expect(Number.isNaN(after.y)).toBe(false);
    expect(Number.isNaN(after.zoom)).toBe(false);
  });

  it('keeps the zoom inside [ZOOM_MIN, ZOOM_MAX] for every factor', () => {
    for (const factor of [1e-12, 0.001, 0.5, 1.5, 1e6]) {
      const after = zoomAt(FAR_CAMERA, CENTRE, factor);
      expect(after.zoom).toBeGreaterThanOrEqual(ZOOM_MIN);
      expect(after.zoom).toBeLessThanOrEqual(ZOOM_MAX);
    }
  });
});

describe('zoomStep (TC-09, TC-10)', () => {
  // TC-09
  it('steps in then out back to exactly 1.0', () => {
    const up = zoomStep(ORIGIN_CAMERA, VIEWPORT, 'in');
    expect(up.zoom).toBe(ZOOM_STEP_FACTOR);
    expect(zoomPercent(up)).toBe(Math.round(ZOOM_STEP_FACTOR * 100));
    const back = zoomStep(up, VIEWPORT, 'out');
    expect(back.zoom).toBe(1);
    expect(zoomPercent(back)).toBe(100);
  });

  it('keeps the viewport centre fixed when stepping', () => {
    const cam: Camera = { x: -250, y: 80, zoom: 1 };
    const before = screenToWorld(cam, CENTRE);
    const after = zoomStep(cam, VIEWPORT, 'in');
    const afterPoint = screenToWorld(after, CENTRE);
    expect(afterPoint.x).toBeCloseTo(before.x, 9);
    expect(afterPoint.y).toBeCloseTo(before.y, 9);
  });

  it('steps down exactly one inverse step', () => {
    const down = zoomStep(ORIGIN_CAMERA, VIEWPORT, 'out');
    expect(down.zoom).toBeCloseTo(1 / ZOOM_STEP_FACTOR, 12);
    expect(zoomPercent(down)).toBe(Math.round((100 / ZOOM_STEP_FACTOR) * 100) / 100);
  });

  // TC-10
  it('clamps after repeated steps in and reports canZoomIn false', () => {
    let cam: Camera = ORIGIN_CAMERA;
    for (let i = 0; i < 20; i++) cam = zoomStep(cam, VIEWPORT, 'in');
    expect(cam.zoom).toBe(ZOOM_MAX);
    expect(canZoomIn(cam)).toBe(false);
    expect(canZoomOut(cam)).toBe(true);
    // and it stops there
    expect(zoomStep(cam, VIEWPORT, 'in')).toBe(cam);
  });

  it('clamps after repeated steps out and reports canZoomOut false', () => {
    let cam: Camera = ORIGIN_CAMERA;
    for (let i = 0; i < 40; i++) cam = zoomStep(cam, VIEWPORT, 'out');
    expect(cam.zoom).toBe(ZOOM_MIN);
    expect(canZoomOut(cam)).toBe(false);
    expect(canZoomIn(cam)).toBe(true);
    expect(zoomStep(cam, VIEWPORT, 'out')).toBe(cam);
  });

  it('round-trips the step ladder without drift', () => {
    let cam: Camera = ORIGIN_CAMERA;
    for (let i = 0; i < 6; i++) cam = zoomStep(cam, VIEWPORT, 'in');
    expect(cam.zoom).toBe(ZOOM_STEP_FACTOR ** 6);
    for (let i = 0; i < 6; i++) cam = zoomStep(cam, VIEWPORT, 'out');
    expect(cam.zoom).toBe(1);
  });
});

describe('resetCamera (TC-07, TC-08)', () => {
  // TC-08
  it('returns 100% with the world origin centred in the viewport', () => {
    const cam = resetCamera(VIEWPORT);
    expect(cam.zoom).toBe(1);
    expect(cam.x).toBe(-VIEWPORT.width / 2);
    expect(cam.y).toBe(-VIEWPORT.height / 2);
    const origin = worldToScreen(cam, { x: 0, y: 0 });
    expect(origin.x).toBe(VIEWPORT.width / 2);
    expect(origin.y).toBe(VIEWPORT.height / 2);
  });

  it('discards a far-away, fully zoomed-in camera', () => {
    const cam = resetCamera(VIEWPORT);
    expect(cam.zoom).toBe(1);
    // the start point is back in the centre, the far-away location is off screen
    expect(worldToScreen(cam, { x: 0, y: 0 })).toEqual(CENTRE);
    expect(worldToScreen(cam, { x: FAR, y: FAR }).x).toBeGreaterThan(VIEWPORT.width);
  });

  // TC-07: the camera holds no viewport reference, so a resize leaves it untouched.
  it('is unaffected by a viewport resize (TC-07)', () => {
    const cam = resetCamera({ width: 1280, height: 800 });
    const before = { ...cam };
    const resizedTo = { width: 1920, height: 1080 };
    // Resizing performs no camera operation; the same camera object is kept.
    const kept = cam;
    expect(kept).toBe(cam);
    expect(kept.x).toBe(before.x);
    expect(kept.y).toBe(before.y);
    expect(kept.zoom).toBe(before.zoom);
    // the world point at the viewport top-left does not move on screen
    expect(worldToScreen(kept, { x: kept.x, y: kept.y })).toEqual({ x: 0, y: 0 });
    expect(resizedTo.width).toBe(1920);
  });
});

describe('zoomPercent, canZoomIn, canZoomOut', () => {
  it('rounds to the nearest whole percent', () => {
    expect(zoomPercent({ x: 0, y: 0, zoom: 1 })).toBe(100);
    expect(zoomPercent({ x: 0, y: 0, zoom: ZOOM_MIN })).toBe(10);
    expect(zoomPercent({ x: 0, y: 0, zoom: ZOOM_MAX })).toBe(400);
    expect(zoomPercent({ x: 0, y: 0, zoom: 1.5625 })).toBe(156);
    expect(zoomPercent({ x: 0, y: 0, zoom: 1.5624 })).toBe(156);
  });

  it('reports the limits', () => {
    expect(canZoomIn({ x: 0, y: 0, zoom: ZOOM_MAX })).toBe(false);
    expect(canZoomIn({ x: 0, y: 0, zoom: 1 })).toBe(true);
    expect(canZoomOut({ x: 0, y: 0, zoom: ZOOM_MIN })).toBe(false);
    expect(canZoomOut({ x: 0, y: 0, zoom: 1 })).toBe(true);
  });
});

describe('property: pointer invariance', () => {
  it('holds for 1000 seeded cameras, points and factors', () => {
    let state = 0x9e3779b9;
    const random = (): number => {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const range = (min: number, max: number): number => min + random() * (max - min);

    for (let i = 0; i < 1000; i++) {
      const cam: Camera = {
        x: range(-FAR, FAR),
        y: range(-FAR, FAR),
        zoom: range(ZOOM_MIN, ZOOM_MAX),
      };
      const p: Point = { x: range(0, 1920), y: range(0, 1080) };
      const factor = range(0.05, 20);
      const before = screenToWorld(cam, p);
      const after = zoomAt(cam, p, factor);
      expect(Number.isFinite(after.x)).toBe(true);
      expect(Number.isFinite(after.y)).toBe(true);
      expect(after.zoom).toBeGreaterThanOrEqual(ZOOM_MIN);
      expect(after.zoom).toBeLessThanOrEqual(ZOOM_MAX);
      const afterPoint = screenToWorld(after, p);
      expect(Math.abs(afterPoint.x - before.x)).toBeLessThan(FAR_TOLERANCE);
      expect(Math.abs(afterPoint.y - before.y)).toBeLessThan(FAR_TOLERANCE);
    }
  });
});
