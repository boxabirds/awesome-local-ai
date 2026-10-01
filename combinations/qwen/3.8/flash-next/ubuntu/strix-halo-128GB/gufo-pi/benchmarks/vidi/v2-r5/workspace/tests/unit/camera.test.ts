import { describe, expect, it } from 'vitest';
import {
  GRID_SPACING_WORLD,
  PERCENT,
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

/** Precision used for "exact" assertions in the design's test cases. */
const WORLD_TOLERANCE = 1e-6;
/** Screen precision used by the design's pixel-level expectations. */
const SCREEN_TOLERANCE = 1e-6;

const ORIGIN: Point = { x: 0, y: 0 };
const VIEWPORT: Size = { width: 1200, height: 800 };

const atOrigin = (zoom = 1): Camera => ({ x: 0, y: 0, zoom });
const farAway = (zoom = 1): Camera => ({
  x: UNBOUNDED_PAN_TESTED_EXTENT,
  y: UNBOUNDED_PAN_TESTED_EXTENT,
  zoom,
});

const closeTo = (value: number, expected: number, tolerance = WORLD_TOLERANCE) =>
  expect(Math.abs(value - expected)).toBeLessThanOrEqual(tolerance);

describe('camera.math: screen/world transforms', () => {
  it('round-trips through screenToWorld and worldToScreen', () => {
    const cam: Camera = { x: -1234.5, y: 678.25, zoom: 1.75 };
    const p: Point = { x: 432.1, y: 87.9 };
    const roundTripped = screenToWorld(cam, worldToScreen(cam, p));
    closeTo(roundTripped.x, p.x);
    closeTo(roundTripped.y, p.y);
  });

  it('places the camera x,y at the viewport top-left', () => {
    const cam: Camera = { x: 12.5, y: -8.25, zoom: ZOOM_STEP_FACTOR };
    expect(screenToWorld(cam, { x: 0, y: 0 })).toEqual({ x: cam.x, y: cam.y });
  });
});

describe('camera.math: panBy', () => {
  it('TC-01 moves the camera by the screen delta divided by zoom', () => {
    const cam = atOrigin(1);
    const next = panBy(cam, 200, 100);

    expect(next).not.toBe(cam);
    closeTo(next.x, -200);
    closeTo(next.y, -100);
    // The world origin now appears 200 px right and 100 px down from where it started.
    const screen = worldToScreen(next, ORIGIN);
    closeTo(screen.x, 200, SCREEN_TOLERANCE);
    closeTo(screen.y, 100, SCREEN_TOLERANCE);
  });

  it('TC-02 pans exactly at ZOOM_MAX a million world units from the start', () => {
    const cam = farAway(ZOOM_MAX);
    const next = panBy(cam, 200, 100);

    closeTo(next.x, UNBOUNDED_PAN_TESTED_EXTENT - 200 / ZOOM_MAX);
    closeTo(next.y, UNBOUNDED_PAN_TESTED_EXTENT - 100 / ZOOM_MAX);
  });

  it('TC-01b keeps the world point under the pointer glued while panning', () => {
    const cam = atOrigin(1);
    const next = panBy(cam, 200, 100);
    const before = worldToScreen(cam, ORIGIN);
    const after = worldToScreen(next, ORIGIN);
    closeTo(after.x - before.x, 200, SCREEN_TOLERANCE);
    closeTo(after.y - before.y, 100, SCREEN_TOLERANCE);
  });

  it('returns the same object for a zero-length drag', () => {
    const cam = atOrigin();
    expect(panBy(cam, 0, 0)).toBe(cam);
  });
});

describe('camera.math: zoomAt', () => {
  it('TC-03 keeps the world point under the pointer fixed', () => {
    const cam = atOrigin(1);
    const p: Point = { x: 300, y: 200 };
    const next = zoomAt(cam, p, 2);

    expect(next.zoom).toBeCloseTo(2, 10);
    const before = screenToWorld(cam, p);
    const after = screenToWorld(next, p);
    closeTo(before.x, after.x);
    closeTo(before.y, after.y);
  });

  it('TC-04 keeps the pointer invariant a million world units from the start', () => {
    const cam = farAway(1);
    const p: Point = { x: 640, y: 400 };
    const next = zoomAt(cam, p, 1.5);

    const before = screenToWorld(cam, p);
    const after = screenToWorld(next, p);
    closeTo(before.x, after.x);
    closeTo(before.y, after.y);
  });

  it('TC-05 at ZOOM_MIN, zooming out further returns the same object', () => {
    const cam = atOrigin(ZOOM_MIN);
    const next = zoomAt(cam, { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 }, 1 / ZOOM_STEP_FACTOR);

    expect(next).toBe(cam);
    closeTo(next.zoom, ZOOM_MIN);
  });

  it('TC-06 at ZOOM_MAX, zooming in further returns the same object', () => {
    const cam = atOrigin(ZOOM_MAX);
    const next = zoomAt(cam, { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 }, ZOOM_STEP_FACTOR);

    expect(next).toBe(cam);
    closeTo(next.zoom, ZOOM_MAX);
  });

  it('TC-11 clamps a huge factor and still holds the pointer invariant', () => {
    const cam = atOrigin(1);
    const p: Point = { x: 250, y: 150 };
    const next = zoomAt(cam, p, 1000);

    closeTo(next.zoom, ZOOM_MAX);
    const before = screenToWorld(cam, p);
    const after = screenToWorld(next, p);
    closeTo(before.x, after.x);
    closeTo(before.y, after.y);
  });

  it('TC-11b clamps a tiny factor to ZOOM_MIN with the pointer invariant', () => {
    const cam = atOrigin(1);
    const p: Point = { x: 250, y: 150 };
    const next = zoomAt(cam, p, 1e-6);

    closeTo(next.zoom, ZOOM_MIN);
    const before = screenToWorld(cam, p);
    const after = screenToWorld(next, p);
    closeTo(before.x, after.x);
    closeTo(before.y, after.y);
  });

  it('TC-12 returns the input camera unchanged for invalid factors', () => {
    const cam = atOrigin(1);
    const p: Point = { x: 300, y: 200 };

    for (const factor of [0, -1, -ZOOM_STEP_FACTOR, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const next = zoomAt(cam, p, factor);
      expect(next).toBe(cam);
      expect(Number.isFinite(next.x)).toBe(true);
      expect(Number.isFinite(next.y)).toBe(true);
      expect(Number.isFinite(next.zoom)).toBe(true);
    }
  });

  it('TC-12b ignores a non-finite screen point', () => {
    const cam = atOrigin(1);
    expect(zoomAt(cam, { x: Number.NaN, y: 10 }, 2)).toBe(cam);
    expect(zoomAt(cam, { x: 10, y: Number.POSITIVE_INFINITY }, 2)).toBe(cam);
  });
});

describe('camera.math: zoomStep', () => {
  it('TC-09 one step in then one step out returns exactly 1.0', () => {
    const cam = atOrigin(1);
    const inStep = zoomStep(cam, VIEWPORT, 'in');

    expect(inStep.zoom).toBe(ZOOM_STEP_FACTOR);
    expect(zoomPercent(inStep)).toBe(Math.round(ZOOM_STEP_FACTOR * PERCENT));

    const back = zoomStep(inStep, VIEWPORT, 'out');
    expect(back.zoom).toBe(1);
    expect(zoomPercent(back)).toBe(PERCENT);
    closeTo(back.x, cam.x);
    closeTo(back.y, cam.y);
  });

  it('zooms one step around the centre of the viewport', () => {
    const cam: Camera = { x: -600, y: -400, zoom: 1 };
    const centre: Point = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };
    const next = zoomStep(cam, VIEWPORT, 'in');

    const before = screenToWorld(cam, centre);
    const after = screenToWorld(next, centre);
    closeTo(before.x, after.x);
    closeTo(before.y, after.y);
  });

  it('TC-10 clamps after repeated steps in and disables zooming in', () => {
    let cam: Camera = atOrigin(1);
    for (let i = 0; i < 20; i += 1) {
      cam = zoomStep(cam, VIEWPORT, 'in');
      expect(cam.zoom).toBeLessThanOrEqual(ZOOM_MAX);
    }
    expect(cam.zoom).toBe(ZOOM_MAX);
    expect(canZoomIn(cam)).toBe(false);
    expect(canZoomOut(cam)).toBe(true);
    expect(zoomPercent(cam)).toBe(Math.round(ZOOM_MAX * PERCENT));
  });

  it('TC-10b clamps after repeated steps out and disables zooming out', () => {
    let cam: Camera = atOrigin(1);
    for (let i = 0; i < 30; i += 1) {
      cam = zoomStep(cam, VIEWPORT, 'out');
      expect(cam.zoom).toBeGreaterThanOrEqual(ZOOM_MIN);
    }
    expect(cam.zoom).toBe(ZOOM_MIN);
    expect(canZoomOut(cam)).toBe(false);
    expect(canZoomIn(cam)).toBe(true);
    expect(zoomPercent(cam)).toBe(Math.round(ZOOM_MIN * PERCENT));
  });

  it('returns the same object when already at a limit', () => {
    const atMax = atOrigin(ZOOM_MAX);
    expect(zoomStep(atMax, VIEWPORT, 'in')).toBe(atMax);
    const atMin = atOrigin(ZOOM_MIN);
    expect(zoomStep(atMin, VIEWPORT, 'out')).toBe(atMin);
  });
});

describe('camera.math: resetCamera', () => {
  it('TC-08 resets zoom to 1 and centres the world origin in the viewport', () => {
    const cam = farAway(ZOOM_MAX);
    const next = resetCamera({ width: 1200, height: 800 });

    expect(next).not.toBe(cam);
    expect(next.zoom).toBe(1);
    closeTo(next.x, -600);
    closeTo(next.y, -400);

    const origin = worldToScreen(next, ORIGIN);
    closeTo(origin.x, 600, SCREEN_TOLERANCE);
    closeTo(origin.y, 400, SCREEN_TOLERANCE);
  });
});

describe('camera.math: viewport resize', () => {
  it('TC-07 a viewport resize leaves the camera unchanged', () => {
    const cam: Camera = Object.freeze({ x: 123.5, y: -45.25, zoom: 1 });
    const before = { x: cam.x, y: cam.y, zoom: cam.zoom };

    // Nothing in camera.math mutates a camera, and the camera is anchored to the
    // viewport's top-left, so a resize cannot move content relative to that corner.
    const small = zoomStep(cam, { width: 1280, height: 800 }, 'in');
    const large = zoomStep(cam, { width: 1920, height: 1080 }, 'in');

    expect({ x: cam.x, y: cam.y, zoom: cam.zoom }).toEqual(before);
    expect(small.zoom).toBe(large.zoom);
    expect(screenToWorld(cam, { x: 0, y: 0 })).toEqual({ x: cam.x, y: cam.y });
    expect(screenToWorld(cam, { x: 0, y: 0 })).toEqual({ x: cam.x, y: cam.y });
  });
});

describe('camera.math: zoomPercent', () => {
  it('reports a whole-number percentage', () => {
    expect(zoomPercent(atOrigin(1))).toBe(PERCENT);
    expect(zoomPercent(atOrigin(1.5625))).toBe(156);
    expect(zoomPercent(atOrigin(ZOOM_MIN))).toBe(10);
    expect(zoomPercent(atOrigin(ZOOM_MAX))).toBe(400);
  });
});

describe('camera.math: grid and unbounded extent', () => {
  it('keeps grid spacing in screen pixels as a plain zoom multiple far away', () => {
    const cam: Camera = { x: UNBOUNDED_PAN_TESTED_EXTENT, y: -UNBOUNDED_PAN_TESTED_EXTENT, zoom: 0.5 };
    const spacingPx = GRID_SPACING_WORLD * cam.zoom;

    const a = worldToScreen(cam, { x: UNBOUNDED_PAN_TESTED_EXTENT, y: 0 });
    const b = worldToScreen(cam, { x: UNBOUNDED_PAN_TESTED_EXTENT + GRID_SPACING_WORLD, y: 0 });
    closeTo(b.x - a.x, spacingPx, WORLD_TOLERANCE);
  });
});

describe('camera.math: property check', () => {
  it('keeps the pointer invariant for 1,000 random cameras, points and factors', () => {
    // Deterministic PRNG (mulberry32) so a failure is reproducible.
    let state = 0x9e3779b9;
    const random = () => {
      state |= 0;
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };

    for (let i = 0; i < 1000; i += 1) {
      const cam: Camera = {
        x: (random() * 2 - 1) * UNBOUNDED_PAN_TESTED_EXTENT,
        y: (random() * 2 - 1) * UNBOUNDED_PAN_TESTED_EXTENT,
        zoom: ZOOM_MIN + random() * (ZOOM_MAX - ZOOM_MIN),
      };
      const p: Point = { x: random() * 1280, y: random() * 800 };
      const factor = 0.2 + random() * 4.8;

      const next = zoomAt(cam, p, factor);

      expect(next.zoom).toBeGreaterThanOrEqual(ZOOM_MIN);
      expect(next.zoom).toBeLessThanOrEqual(ZOOM_MAX);

      const before = screenToWorld(cam, p);
      const after = screenToWorld(next, p);
      expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(WORLD_TOLERANCE);
      expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(WORLD_TOLERANCE);

      // Unclamped steps are reversible: zooming back by the inverse factor restores the zoom.
      const unclamped = cam.zoom * factor >= ZOOM_MIN && cam.zoom * factor <= ZOOM_MAX;
      if (unclamped) {
        const back = zoomAt(next, p, 1 / factor);
        expect(Math.abs(back.zoom - cam.zoom)).toBeLessThanOrEqual(WORLD_TOLERANCE);
        expect(Math.abs(screenToWorld(back, p).x - before.x)).toBeLessThanOrEqual(WORLD_TOLERANCE);
        expect(Math.abs(screenToWorld(back, p).y - before.y)).toBeLessThanOrEqual(WORLD_TOLERANCE);
      }
    }
  });
});
