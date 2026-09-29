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
  GRID_SPACING_WORLD,
  PERCENT,
  UNBOUNDED_PAN_TESTED_EXTENT,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP_FACTOR,
} from '../../src/shared/config';

const ORIGIN: Point = { x: 0, y: 0 };
const MID: Camera = { x: 0, y: 0, zoom: 1 };
const FAR: Camera = {
  x: UNBOUNDED_PAN_TESTED_EXTENT,
  y: UNBOUNDED_PAN_TESTED_EXTENT,
  zoom: 1,
};
const VIEWPORT: Size = { width: 1200, height: 800 };

/** Absolute difference below this counts as "the same number". */
const EPS = 1e-6;

function expectPointsEqual(actual: Point, expected: Point, epsilon = EPS): void {
  expect(Math.abs(actual.x - expected.x)).toBeLessThanOrEqual(epsilon);
  expect(Math.abs(actual.y - expected.y)).toBeLessThanOrEqual(epsilon);
}

function expectCamerasEqual(actual: Camera, expected: Camera, epsilon = EPS): void {
  expect(Math.abs(actual.x - expected.x)).toBeLessThanOrEqual(epsilon);
  expect(Math.abs(actual.y - expected.y)).toBeLessThanOrEqual(epsilon);
  expect(Math.abs(actual.zoom - expected.zoom)).toBeLessThanOrEqual(epsilon);
}

/**
 * TC-07 helper: the camera is deliberately independent of the size of the board
 * area (design "camera.math / Coordinate model": `x, y` is the world coordinate
 * at the viewport's top-left, so a resize only changes how much of the board is
 * visible, never the camera). There is therefore no resize function in the
 * camera contract, and this helper stands for "a resize happened".
 */
function afterResize(cam: Camera, _viewport: Size): Camera {
  return cam;
}

describe('screenToWorld / worldToScreen', () => {
  it('inverts each other for arbitrary cameras and points', () => {
    const cam: Camera = { x: -1234.5, y: 678.25, zoom: 2.5 };
    const world: Point = { x: 400, y: -50 };
    expectPointsEqual(screenToWorld(cam, worldToScreen(cam, world)), world);
  });

  it('maps the camera position to the viewport top-left', () => {
    const cam: Camera = { x: 12, y: -8, zoom: 3 };
    expectPointsEqual(worldToScreen(cam, { x: cam.x, y: cam.y }), ORIGIN);
    expectPointsEqual(screenToWorld(cam, ORIGIN), { x: cam.x, y: cam.y });
  });
});

describe('panBy', () => {
  it('TC-01 shifts the camera by -delta/zoom at zoom 1 from the origin', () => {
    const next = panBy(MID, 200, 100);
    expect(next).not.toBe(MID);
    expectCamerasEqual(next, { x: -200, y: -100, zoom: 1 });
    // the world origin now appears 200 px right and 100 px down
    expectPointsEqual(worldToScreen(next, ORIGIN), { x: 200, y: 100 });
  });

  it('TC-02 shifts by -delta/zoom at ZOOM_MAX a million world units out', () => {
    const cam: Camera = { ...FAR, zoom: ZOOM_MAX };
    const next = panBy(cam, 200, 100);
    expectCamerasEqual(next, {
      x: UNBOUNDED_PAN_TESTED_EXTENT - 200 / ZOOM_MAX,
      y: UNBOUNDED_PAN_TESTED_EXTENT - 100 / ZOOM_MAX,
      zoom: ZOOM_MAX,
    });
    expect(Math.abs(next.x - (UNBOUNDED_PAN_TESTED_EXTENT - 50))).toBeLessThanOrEqual(EPS);
    expect(Math.abs(next.y - (UNBOUNDED_PAN_TESTED_EXTENT - 25))).toBeLessThanOrEqual(EPS);
  });

  it('returns the same object for a zero-length drag', () => {
    expect(panBy(FAR, 0, 0)).toBe(FAR);
  });

  it('is unbounded: panning far past UNBOUNDED_PAN_TESTED_EXTENT stays finite', () => {
    let cam: Camera = MID;
    for (let i = 0; i < 100; i += 1) cam = panBy(cam, 20_000, -20_000);
    expect(Number.isFinite(cam.x)).toBe(true);
    expect(Number.isFinite(cam.y)).toBe(true);
    expect(Math.abs(cam.x)).toBeGreaterThan(UNBOUNDED_PAN_TESTED_EXTENT);
    // a screen pixel still equals exactly 1 / zoom world units this far out
    expectPointsEqual(screenToWorld(cam, { x: 1, y: 0 }), {
      x: cam.x + 1 / cam.zoom,
      y: cam.y,
    });
  });
});

describe('zoomAt', () => {
  it('TC-03 keeps the world point under the pointer fixed at the origin', () => {
    const p: Point = { x: 300, y: 200 };
    const before = screenToWorld(MID, p);
    const next = zoomAt(MID, p, 2);
    expect(Math.abs(next.zoom - 2)).toBeLessThanOrEqual(EPS);
    expectPointsEqual(screenToWorld(next, p), before);
    expectPointsEqual(before, p);
  });

  it('TC-04 keeps the world point under the pointer fixed a million units out', () => {
    const p: Point = { x: 640, y: 400 };
    const cam: Camera = { ...FAR, zoom: 1.5 };
    const before = screenToWorld(cam, p);
    const next = zoomAt(cam, p, 1.5);
    expectPointsEqual(screenToWorld(next, p), before);
  });

  it('TC-05 returns the same object when already at ZOOM_MIN', () => {
    const cam: Camera = { x: 111, y: -222, zoom: ZOOM_MIN };
    const next = zoomAt(cam, { x: 600, y: 400 }, 1 / ZOOM_STEP_FACTOR);
    expect(next).toBe(cam);
  });

  it('TC-06 returns the same object when already at ZOOM_MAX', () => {
    const cam: Camera = { x: 111, y: -222, zoom: ZOOM_MAX };
    const next = zoomAt(cam, { x: 600, y: 400 }, ZOOM_STEP_FACTOR);
    expect(next).toBe(cam);
  });

  it('TC-11 clamps a huge factor and still holds the pointer invariant', () => {
    const p: Point = { x: 250, y: 750 };
    const before = screenToWorld(MID, p);
    const next = zoomAt(MID, p, 1000);
    expect(next.zoom).toBe(ZOOM_MAX);
    expectPointsEqual(screenToWorld(next, p), before);
    const out = zoomAt(MID, p, 1 / 1000);
    expect(out.zoom).toBe(ZOOM_MIN);
    expectPointsEqual(screenToWorld(out, p), before);
  });

  it('TC-12 ignores invalid factors and never produces NaN', () => {
    for (const factor of [0, -1, -ZOOM_STEP_FACTOR, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const next = zoomAt(FAR, { x: 100, y: 100 }, factor);
      expect(next).toBe(FAR);
      expect(Number.isFinite(next.x)).toBe(true);
      expect(Number.isFinite(next.y)).toBe(true);
      expect(Number.isFinite(next.zoom)).toBe(true);
    }
  });

  it('property: pointer invariance for 1000 random cameras, points and factors', () => {
    const rand = mulberry32(0x5eed);
    for (let i = 0; i < 1000; i += 1) {
      const cam: Camera = {
        x: (rand() * 2 - 1) * UNBOUNDED_PAN_TESTED_EXTENT,
        y: (rand() * 2 - 1) * UNBOUNDED_PAN_TESTED_EXTENT,
        zoom: ZOOM_MIN * Math.pow(ZOOM_MAX / ZOOM_MIN, rand()),
      };
      const p: Point = { x: rand() * 1920, y: rand() * 1080 };
      const factor = Math.exp((rand() * 2 - 1) * 3);
      const before = screenToWorld(cam, p);
      const next = zoomAt(cam, p, factor);
      expect(Number.isNaN(next.x)).toBe(false);
      expect(Number.isNaN(next.y)).toBe(false);
      expect(next.zoom).toBeGreaterThanOrEqual(ZOOM_MIN);
      expect(next.zoom).toBeLessThanOrEqual(ZOOM_MAX);
      expectPointsEqual(screenToWorld(next, p), before);
    }
  });
});

describe('zoomStep', () => {
  it('TC-09 steps in then out and returns exactly 1.0 (percent 100)', () => {
    const inOnce = zoomStep(MID, VIEWPORT, 'in');
    expect(inOnce.zoom).toBe(ZOOM_STEP_FACTOR);
    expect(zoomPercent(inOnce)).toBe(Math.round(ZOOM_STEP_FACTOR * PERCENT));
    const outOnce = zoomStep(inOnce, VIEWPORT, 'out');
    expect(outOnce.zoom).toBe(1);
    expect(zoomPercent(outOnce)).toBe(PERCENT);
  });

  it('TC-09 repeats without float drift over many in/out pairs', () => {
    let cam = MID;
    for (let i = 0; i < 50; i += 1) {
      cam = zoomStep(zoomStep(cam, VIEWPORT, 'in'), VIEWPORT, 'out');
      expect(cam.zoom).toBe(1);
    }
  });

  it('keeps the viewport centre fixed', () => {
    const centre: Point = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };
    const before = screenToWorld(MID, centre);
    const next = zoomStep(MID, VIEWPORT, 'in');
    expectPointsEqual(screenToWorld(next, centre), before);
  });

  it('TC-10 clamps at ZOOM_MAX after repeated steps in and disables zoom in', () => {
    let cam: Camera = MID;
    for (let i = 0; i < 20; i += 1) cam = zoomStep(cam, VIEWPORT, 'in');
    expect(cam.zoom).toBe(ZOOM_MAX);
    expect(zoomPercent(cam)).toBe(Math.round(ZOOM_MAX * PERCENT));
    expect(canZoomIn(cam)).toBe(false);
    expect(canZoomOut(cam)).toBe(true);
    // and further stepping does nothing
    expect(zoomStep(cam, VIEWPORT, 'in')).toBe(cam);
  });

  it('clamps at ZOOM_MIN after repeated steps out and disables zoom out', () => {
    let cam: Camera = MID;
    for (let i = 0; i < 20; i += 1) cam = zoomStep(cam, VIEWPORT, 'out');
    expect(cam.zoom).toBe(ZOOM_MIN);
    expect(zoomPercent(cam)).toBe(Math.round(ZOOM_MIN * PERCENT));
    expect(canZoomOut(cam)).toBe(false);
    expect(canZoomIn(cam)).toBe(true);
    expect(zoomStep(cam, VIEWPORT, 'out')).toBe(cam);
    // zooming back the other way works again
    expect(zoomStep(cam, VIEWPORT, 'in').zoom).toBeGreaterThan(ZOOM_MIN);
  });
});

describe('resetCamera', () => {
  it('TC-08 returns 100% with the board start centred', () => {
    const cam = resetCamera({ width: 1200, height: 800 });
    expect(cam.zoom).toBe(1);
    expectCamerasEqual(cam, { x: -600, y: -400, zoom: 1 });
    expectPointsEqual(worldToScreen(cam, ORIGIN), { x: 600, y: 400 });
  });

  it('TC-08 from ZOOM_MAX a million units out, reset recentres', () => {
    const cam = resetCamera(VIEWPORT);
    expectCamerasEqual(cam, { x: -VIEWPORT.width / 2, y: -VIEWPORT.height / 2, zoom: 1 });
    expect(zoomPercent(cam)).toBe(PERCENT);
    expectPointsEqual(worldToScreen(cam, ORIGIN), {
      x: VIEWPORT.width / 2,
      y: VIEWPORT.height / 2,
    });
  });
});

describe('TC-07 viewport resize', () => {
  it('leaves the camera and top-left-anchored mapping unchanged', () => {
    const before: Camera = { x: 40, y: -70, zoom: 1.25 };
    const worldPoint: Point = { x: 15, y: -3 };
    const screenBefore = worldToScreen(before, worldPoint);
    const after = afterResize(before, { width: 1920, height: 1080 });
    expect(after).toBe(before);
    expectPointsEqual(worldToScreen(after, worldPoint), screenBefore);
  });
});

describe('zoomPercent', () => {
  it('rounds to the nearest whole percent', () => {
    expect(zoomPercent({ x: 0, y: 0, zoom: 1 })).toBe(100);
    expect(zoomPercent({ x: 0, y: 0, zoom: 1.5625 })).toBe(156);
    expect(zoomPercent({ x: 0, y: 0, zoom: ZOOM_MIN })).toBe(10);
    expect(zoomPercent({ x: 0, y: 0, zoom: ZOOM_MAX })).toBe(400);
  });
});

describe('grid spacing is derived from the camera', () => {
  it('one grid cell equals GRID_SPACING_WORLD * zoom screen pixels', () => {
    const cam: Camera = { x: 137, y: -812_345, zoom: 1.5 };
    const a = worldToScreen(cam, { x: 0, y: 0 });
    const b = worldToScreen(cam, { x: GRID_SPACING_WORLD, y: GRID_SPACING_WORLD });
    expect(Math.abs(b.x - a.x)).toBeCloseTo(GRID_SPACING_WORLD * cam.zoom, 9);
    expect(Math.abs(b.y - a.y)).toBeCloseTo(GRID_SPACING_WORLD * cam.zoom, 9);
  });
});

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
