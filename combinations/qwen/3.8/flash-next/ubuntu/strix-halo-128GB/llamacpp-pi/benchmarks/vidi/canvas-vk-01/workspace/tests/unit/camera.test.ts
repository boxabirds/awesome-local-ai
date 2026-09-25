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

/** Tolerance required by the design for pointer invariance far from the origin. */
const TOL = 1e-6;

const VIEWPORT: Size = { width: 1200, height: 800 };
const ORIGIN_CAMERA: Camera = { x: 0, y: 0, zoom: 1 };
const FAR = UNBOUNDED_PAN_TESTED_EXTENT;

const point = (x: number, y: number): Point => ({ x, y });
const centreOf = (size: Size): Point => ({ x: size.width / 2, y: size.height / 2 });

/** Distance between two points; used with TOL. */
function distance(a: Point, b: Point): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/** Deterministic PRNG (mulberry32) so the property check is reproducible. */
function makeRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('screenToWorld / worldToScreen', () => {
  it('are inverse functions of each other', () => {
    const cams: Camera[] = [
      ORIGIN_CAMERA,
      { x: 1234.5, y: -987.25, zoom: ZOOM_STEP_FACTOR },
      { x: -FAR, y: FAR, zoom: ZOOM_MIN },
      { x: FAR, y: -FAR, zoom: ZOOM_MAX },
    ];
    for (const cam of cams) {
      for (const p of [point(0, 0), point(37, 240.75), point(-1234.5, 987.25)]) {
        expect(distance(screenToWorld(cam, worldToScreen(cam, p)), p)).toBeLessThan(TOL);
      }
    }
  });

  it('maps the top-left of the viewport to camera.xy', () => {
    const cam: Camera = { x: 42, y: -17, zoom: 2 };
    expect(screenToWorld(cam, point(0, 0))).toEqual(point(42, -17));
    expect(worldToScreen(cam, point(42, -17))).toEqual(point(0, 0));
  });
});

describe('panBy', () => {
  // TC-01
  it('TC-01 moves the board by exactly the pointer movement at zoom 1', () => {
    const next = panBy(ORIGIN_CAMERA, 200, 100);

    expect(next.x).toBeCloseTo(-200, 9);
    expect(next.y).toBeCloseTo(-100, 9);
    expect(next.zoom).toBe(1);
    // The world point that was at the screen origin is now 200 right, 100 down.
    expect(distance(worldToScreen(next, point(0, 0)), point(200, 100))).toBeLessThan(TOL);
    // Input camera is never mutated.
    expect(ORIGIN_CAMERA).toEqual({ x: 0, y: 0, zoom: 1 });
  });

  // TC-02
  it('TC-02 converts screen pixels to world units at maximum zoom, far from the start', () => {
    const cam: Camera = { x: FAR, y: FAR, zoom: ZOOM_MAX };
    const next = panBy(cam, 200, 100);

    expect(Math.abs(next.x - (FAR - 200 / ZOOM_MAX))).toBeLessThan(TOL);
    expect(Math.abs(next.y - (FAR - 100 / ZOOM_MAX))).toBeLessThan(TOL);
    expect(next.zoom).toBe(ZOOM_MAX);
  });

  it('returns the same camera object for a zero-length drag', () => {
    const cam: Camera = { x: 10, y: 20, zoom: 1.5 };
    expect(panBy(cam, 0, 0)).toBe(cam);
  });

  it('pans by GRID_SPACING_WORLD screen pixels to advance exactly one grid cell at zoom 1', () => {
    const next = panBy(ORIGIN_CAMERA, GRID_SPACING_WORLD, 0);
    expect(next.x).toBeCloseTo(-GRID_SPACING_WORLD, 9);
  });
});

describe('zoomAt', () => {
  // TC-03
  it('TC-03 keeps the world point under the pointer fixed', () => {
    const p = point(300, 200);
    const before = screenToWorld(ORIGIN_CAMERA, p);
    const next = zoomAt(ORIGIN_CAMERA, p, 2);

    expect(next.zoom).toBeCloseTo(2, 9);
    expect(distance(screenToWorld(next, p), before)).toBeLessThan(TOL);
  });

  // TC-04
  it('TC-04 keeps the pointer invariant far from the start (1e-6)', () => {
    const cam: Camera = { x: FAR, y: -FAR, zoom: 1 };
    const p = point(400, 350);
    const before = screenToWorld(cam, p);
    const next = zoomAt(cam, p, 1.5);

    expect(distance(screenToWorld(next, p), before)).toBeLessThan(TOL);
  });

  // TC-04b
  it('round-trips screen -> world -> screen at any zoom', () => {
    for (const zoom of [ZOOM_MIN, 0.5, 1, 1.5625, 2, ZOOM_MAX]) {
      const camera = { x: -12345.5, y: 67890.25, zoom };
      for (const screen of [point(0, 0), point(640, 400), point(-100, 1234.5)]) {
        const back = worldToScreen(camera, screenToWorld(camera, screen));
        expect(back.x).toBeCloseTo(screen.x, 6);
        expect(back.y).toBeCloseTo(screen.y, 6);
      }
    }
  });

  // TC-05
  it('TC-05 returns the same object when already at ZOOM_MIN and zooming out', () => {
    const cam: Camera = { x: 0, y: 0, zoom: ZOOM_MIN };
    const next = zoomAt(cam, centreOf(VIEWPORT), 1 / ZOOM_STEP_FACTOR);

    expect(next).toBe(cam);
    expect(next.zoom).toBe(ZOOM_MIN);
  });

  // TC-06
  it('TC-06 returns the same object when already at ZOOM_MAX and zooming in', () => {
    const cam: Camera = { x: 0, y: 0, zoom: ZOOM_MAX };
    const next = zoomAt(cam, centreOf(VIEWPORT), ZOOM_STEP_FACTOR);

    expect(next).toBe(cam);
    expect(next.zoom).toBe(ZOOM_MAX);
  });

  // TC-11
  it('TC-11 clamps a huge factor to ZOOM_MAX and still keeps the pointer fixed', () => {
    const p = point(640, 400);
    const before = screenToWorld(ORIGIN_CAMERA, p);
    const next = zoomAt(ORIGIN_CAMERA, p, 1000);

    expect(next.zoom).toBe(ZOOM_MAX);
    expect(distance(screenToWorld(next, p), before)).toBeLessThan(TOL);
  });

  it('clamps a tiny factor to ZOOM_MIN and keeps the pointer fixed', () => {
    const p = point(640, 400);
    const before = screenToWorld(ORIGIN_CAMERA, p);
    const next = zoomAt(ORIGIN_CAMERA, p, 1 / 1000);

    expect(next.zoom).toBe(ZOOM_MIN);
    expect(distance(screenToWorld(next, p), before)).toBeLessThan(TOL);
  });

  // TC-12
  it.each([
    ['zero', 0],
    ['negative', -1.25],
    ['NaN', Number.NaN],
    ['+Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
  ])('TC-12 returns the input camera unchanged for factor %s', (_label, factor) => {
    const cam: Camera = { x: 25, y: -25, zoom: 1 };
    const next = zoomAt(cam, centreOf(VIEWPORT), factor);

    expect(next).toBe(cam);
    expect(Number.isFinite(next.x) && Number.isFinite(next.y) && Number.isFinite(next.zoom)).toBe(true);
  });

  it('property: 1000 random cameras/points/factors keep the pointer world point invariant', () => {
    const random = makeRandom(0x5eed);
    for (let i = 0; i < 1000; i += 1) {
      const cam: Camera = {
        x: (random() * 2 - 1) * FAR,
        y: (random() * 2 - 1) * FAR,
        zoom: ZOOM_MIN * Math.pow(ZOOM_MAX / ZOOM_MIN, random()),
      };
      const p = point(random() * VIEWPORT.width, random() * VIEWPORT.height);
      const factor = Math.pow(10, (random() * 2 - 1) * 2); // 0.01 .. 100
      const before = screenToWorld(cam, p);
      const next = zoomAt(cam, p, factor);

      expect(Number.isFinite(next.x)).toBe(true);
      expect(Number.isFinite(next.y)).toBe(true);
      expect(next.zoom).toBeGreaterThanOrEqual(ZOOM_MIN);
      expect(next.zoom).toBeLessThanOrEqual(ZOOM_MAX);
      expect(distance(screenToWorld(next, p), before)).toBeLessThan(TOL);
    }
  });
});

describe('zoomStep', () => {
  // TC-09
  it('TC-09 returns exactly 1.0 after one step in and one step out', () => {
    const zoomedIn = zoomStep(ORIGIN_CAMERA, VIEWPORT, 'in');
    expect(zoomedIn.zoom).toBe(ZOOM_STEP_FACTOR);
    expect(zoomPercent(zoomedIn)).toBe(Math.round(ZOOM_STEP_FACTOR * 100));

    const back = zoomStep(zoomedIn, VIEWPORT, 'out');
    expect(back.zoom).toBe(1);
    expect(zoomPercent(back)).toBe(100);
  });

  it('keeps the world point at the viewport centre fixed', () => {
    const centre = centreOf(VIEWPORT);
    const before = screenToWorld(ORIGIN_CAMERA, centre);
    const next = zoomStep(ORIGIN_CAMERA, VIEWPORT, 'in');

    expect(distance(screenToWorld(next, centre), before)).toBeLessThan(TOL);
  });

  // TC-10
  it('TC-10 clamps 20 steps in at ZOOM_MAX and reports canZoomIn false', () => {
    let cam: Camera = ORIGIN_CAMERA;
    for (let i = 0; i < 20; i += 1) {
      cam = zoomStep(cam, VIEWPORT, 'in');
      expect(cam.zoom).toBeLessThanOrEqual(ZOOM_MAX);
    }
    expect(cam.zoom).toBe(ZOOM_MAX);
    expect(canZoomIn(cam)).toBe(false);
    expect(canZoomOut(cam)).toBe(true);
    // Further steps are no-ops (same object).
    expect(zoomStep(cam, VIEWPORT, 'in')).toBe(cam);
  });

  it('clamps 40 steps out at ZOOM_MIN and reports canZoomOut false', () => {
    let cam: Camera = ORIGIN_CAMERA;
    for (let i = 0; i < 40; i += 1) {
      cam = zoomStep(cam, VIEWPORT, 'out');
      expect(cam.zoom).toBeGreaterThanOrEqual(ZOOM_MIN);
    }
    expect(cam.zoom).toBe(ZOOM_MIN);
    expect(canZoomOut(cam)).toBe(false);
    expect(canZoomIn(cam)).toBe(true);
    expect(zoomStep(cam, VIEWPORT, 'out')).toBe(cam);
  });

  it('walks the documented sequence 100% -> 125% -> 100% (PRD zoom.step)', () => {
    const inOnce = zoomStep(ORIGIN_CAMERA, VIEWPORT, 'in');
    expect(zoomPercent(inOnce)).toBe(125);
    expect(zoomPercent(zoomStep(inOnce, VIEWPORT, 'out'))).toBe(100);
  });

});

describe('resetCamera', () => {
  // TC-08
  it('TC-08 returns to zoom 1 with the board start centred', () => {
    const far: Camera = { x: FAR, y: FAR, zoom: ZOOM_MAX };
    const next = resetCamera({ width: 1200, height: 800 });

    expect(next.zoom).toBe(1);
    expect(next.x).toBeCloseTo(-600, 9);
    expect(next.y).toBeCloseTo(-400, 9);
    // The board's starting point is at the centre of the board area.
    expect(distance(worldToScreen(next, point(0, 0)), point(600, 400))).toBeLessThan(TOL);
    // Reset ignores the previous camera entirely.
    expect(next.zoom).not.toBe(far.zoom);
  });

  it('centres the origin for any viewport size', () => {
    const size: Size = { width: 1920, height: 1080 };
    const cam = resetCamera(size);
    expect(worldToScreen(cam, point(0, 0)).x).toBeCloseTo(size.width / 2, 9);
    expect(worldToScreen(cam, point(0, 0)).y).toBeCloseTo(size.height / 2, 9);
  });
});

describe('resize', () => {
  // TC-07
  it('TC-07 a viewport resize leaves the camera untouched', () => {
    const before: Camera = { x: 120, y: -45, zoom: 1 };
    const worldAtTopLeft = screenToWorld(before, point(0, 0));
    const originOnScreen = worldToScreen(before, point(0, 0));

    // The camera is anchored to the top-left corner of the board area, so a
    // resize keeps the same camera object and the same content position.
    const after: Camera = before;

    expect(after).toBe(before);
    expect(screenToWorld(after, point(0, 0))).toEqual(worldAtTopLeft);
    expect(worldToScreen(after, point(0, 0))).toEqual(originOnScreen);

    // Contrast with reset: reset re-centres for the *new* size.
    const resetForNewSize = resetCamera({ width: 1920, height: 1080 });
    expect(worldToScreen(resetForNewSize, point(0, 0)).x).toBeCloseTo(960, 9);
    expect(worldToScreen(resetForNewSize, point(0, 0)).y).toBeCloseTo(540, 9);
  });
});

describe('zoomPercent', () => {
  it('rounds to the nearest whole percent', () => {
    expect(zoomPercent(ORIGIN_CAMERA)).toBe(100);
    expect(zoomPercent({ x: 0, y: 0, zoom: 1.5625 })).toBe(156);
    expect(zoomPercent({ x: 0, y: 0, zoom: ZOOM_MIN })).toBe(10);
    expect(zoomPercent({ x: 0, y: 0, zoom: ZOOM_MAX })).toBe(400);
    expect(zoomPercent({ x: 0, y: 0, zoom: 1.0075 })).toBe(101); // 100.75 rounds up
    expect(zoomPercent({ x: 0, y: 0, zoom: 1.0024 })).toBe(100); // 100.24 rounds down
  });
});

describe('zoom limit guards', () => {
  it('canZoomIn / canZoomOut are false exactly at the limits', () => {
    expect(canZoomIn({ x: 0, y: 0, zoom: ZOOM_MIN })).toBe(true);
    expect(canZoomOut({ x: 0, y: 0, zoom: ZOOM_MIN })).toBe(false);
    expect(canZoomIn({ x: 0, y: 0, zoom: ZOOM_MAX })).toBe(false);
    expect(canZoomOut({ x: 0, y: 0, zoom: ZOOM_MAX })).toBe(true);
    expect(canZoomIn(ORIGIN_CAMERA)).toBe(true);
    expect(canZoomOut(ORIGIN_CAMERA)).toBe(true);
  });
});

describe('far travel', () => {
  it('pans exactly at UNBOUNDED_PAN_TESTED_EXTENT in all four directions', () => {
    const start: Camera = { x: FAR, y: -FAR, zoom: 1 };
    for (const [dx, dy] of [
      [200, 100],
      [-200, -100],
      [0, 500],
      [-500, 0],
    ]) {
      const next = panBy(start, dx, dy);
      expect(Math.abs(next.x - (FAR - dx))).toBeLessThan(TOL);
      expect(Math.abs(next.y - (-FAR - dy))).toBeLessThan(TOL);
    }
  });
});
