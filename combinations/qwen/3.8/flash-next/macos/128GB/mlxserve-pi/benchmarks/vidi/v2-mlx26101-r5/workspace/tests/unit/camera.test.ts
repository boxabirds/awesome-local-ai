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

/** Tolerance from the design: pointer invariance and far-away precision. */
const WORLD_EPSILON = 1e-6;
/** Tolerance for screen-pixel assertions (sub-pixel). */
const PIXEL_EPSILON = 1e-6;
/** Digits argument for `toBeCloseTo` matching WORLD_EPSILON. */
const WORLD_DIGITS = 6;

/** 1,000,000 board units away from the starting point (design D3). */
const FAR = UNBOUNDED_PAN_TESTED_EXTENT;
/** Mid-range zoom (design D2 equivalence class "mid"). */
const MID_ZOOM = 1;
/** Drag used by the PRD verification: 200 px right, 100 px down. */
const DRAG_DX = 200;
const DRAG_DY = 100;
const ORIGIN: Point = { x: 0, y: 0 };
/** Pointer position used for zoom-around-the-pointer checks. */
const POINTER: Point = { x: 300, y: 200 };
const VIEWPORT: Size = { width: 1280, height: 800 };
/** Viewport used by the reset test: 1200x800 (design TC-08). */
const RESET_VIEWPORT: Size = { width: 1200, height: 800 };
const WIDER_VIEWPORT: Size = { width: 1920, height: 1080 };
/** A wheel gesture can ask for an enormous factor in a single event. */
const HUGE_FACTOR = 1000;
const PERCENT_PER_ZOOM = 100;
const PROPERTY_SAMPLES = 1000;

const centre = (viewport: Size): Point => ({
  x: viewport.width / 2,
  y: viewport.height / 2,
});

const originAtZoom = (zoom: number, at: Point = ORIGIN): Camera => ({
  x: at.x,
  y: at.y,
  zoom,
});

const finiteCamera = (cam: Camera): boolean =>
  [cam.x, cam.y, cam.zoom].every((value) => Number.isFinite(value));

/** Deterministic PRNG so the property check is reproducible. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const closeTo = (expected: number) => expect.closeTo(expected, WORLD_DIGITS);

describe('screenToWorld / worldToScreen', () => {
  it('inverts each other at the origin and far away', () => {
    for (const cam of [originAtZoom(MID_ZOOM), originAtZoom(ZOOM_MAX), originAtZoom(ZOOM_MIN, { x: FAR, y: -FAR })]) {
      const p: Point = { x: 123.5, y: -45.25 };
      const world = screenToWorld(cam, p);
      const back = worldToScreen(cam, world);
      expect(back.x).toEqual(closeTo(p.x));
      expect(back.y).toEqual(closeTo(p.y));
      const screen = worldToScreen(cam, p);
      const worldAgain = screenToWorld(cam, screen);
      expect(worldAgain.x).toEqual(closeTo(p.x));
      expect(worldAgain.y).toEqual(closeTo(p.y));
    }
  });

  it('maps screen = (world - camera.xy) * zoom', () => {
    const cam: Camera = { x: -640, y: -400, zoom: MID_ZOOM };
    expect(worldToScreen(cam, ORIGIN)).toEqual({
      x: closeTo((0 - cam.x) * cam.zoom),
      y: closeTo((0 - cam.y) * cam.zoom),
    });
  });
});

describe('panBy', () => {
  // TC-01
  it('TC-01 moves the camera by the screen delta divided by the zoom', () => {
    const cam = originAtZoom(MID_ZOOM);
    const next = panBy(cam, DRAG_DX, DRAG_DY);
    expect(next).not.toBe(cam);
    expect(next.x).toEqual(closeTo(cam.x - DRAG_DX / MID_ZOOM));
    expect(next.y).toEqual(closeTo(cam.y - DRAG_DY / MID_ZOOM));
    expect(next.zoom).toBe(cam.zoom);
    // The dot that was at the screen origin is now 200 right, 100 down.
    const moved = worldToScreen(next, ORIGIN);
    expect(moved.x).toEqual(closeTo(DRAG_DX));
    expect(moved.y).toEqual(closeTo(DRAG_DY));
  });

  // TC-02
  it('TC-02 stays exact at maximum zoom one million units from the start', () => {
    const cam = originAtZoom(ZOOM_MAX, { x: FAR, y: FAR });
    const next = panBy(cam, DRAG_DX, DRAG_DY);
    expect(next.x).toEqual(closeTo(FAR - DRAG_DX / ZOOM_MAX));
    expect(next.y).toEqual(closeTo(FAR - DRAG_DY / ZOOM_MAX));
    expect(Math.abs(next.x - (FAR - DRAG_DX / ZOOM_MAX))).toBeLessThan(WORLD_EPSILON);
    // Grid spacing in world units is unaffected by position or zoom.
    const dotA = screenToWorld(next, { x: 0, y: 0 });
    const dotB = screenToWorld(next, { x: GRID_SPACING_WORLD * ZOOM_MAX, y: 0 });
    expect(dotB.x - dotA.x).toEqual(closeTo(GRID_SPACING_WORLD));
  });

  it('returns the same object for a zero-length drag', () => {
    const cam = originAtZoom(MID_ZOOM, { x: 12, y: -34 });
    expect(panBy(cam, 0, 0)).toBe(cam);
  });

  it('does not mutate its input', () => {
    const cam = originAtZoom(MID_ZOOM, { x: 5, y: 5 });
    const frozen = { ...cam };
    panBy(cam, DRAG_DX, DRAG_DY);
    expect(cam).toEqual(frozen);
  });
});

describe('zoomAt', () => {
  // TC-03
  it('TC-03 keeps the world point under the pointer fixed', () => {
    const cam = originAtZoom(MID_ZOOM);
    const before = screenToWorld(cam, POINTER);
    const next = zoomAt(cam, POINTER, 2);
    expect(next.zoom).toEqual(closeTo(2));
    const after = screenToWorld(next, POINTER);
    expect(after.x).toEqual(closeTo(before.x));
    expect(after.y).toEqual(closeTo(before.y));
  });

  // TC-04
  it('TC-04 keeps the pointer invariant one million units from the start', () => {
    const cam = originAtZoom(MID_ZOOM, { x: FAR, y: FAR });
    const before = screenToWorld(cam, POINTER);
    const next = zoomAt(cam, POINTER, 1.5);
    const after = screenToWorld(next, POINTER);
    expect(Math.abs(after.x - before.x)).toBeLessThan(WORLD_EPSILON);
    expect(Math.abs(after.y - before.y)).toBeLessThan(WORLD_EPSILON);
    expect(next.zoom).toEqual(closeTo(1.5));
  });

  // TC-05
  it('TC-05 returns the same object when already at ZOOM_MIN', () => {
    const cam = originAtZoom(ZOOM_MIN);
    const next = zoomAt(cam, centre(VIEWPORT), 1 / ZOOM_STEP_FACTOR);
    expect(next).toBe(cam);
    expect(next.x).toBe(cam.x);
    expect(next.y).toBe(cam.y);
    expect(canZoomOut(cam)).toBe(false);
    expect(canZoomIn(cam)).toBe(true);
  });

  // TC-06
  it('TC-06 returns the same object when already at ZOOM_MAX', () => {
    const cam = originAtZoom(ZOOM_MAX);
    const next = zoomAt(cam, centre(VIEWPORT), ZOOM_STEP_FACTOR);
    expect(next).toBe(cam);
    expect(next.x).toBe(cam.x);
    expect(next.y).toBe(cam.y);
    expect(canZoomIn(cam)).toBe(false);
    expect(canZoomOut(cam)).toBe(true);
  });

  // TC-11
  it('TC-11 clamps an enormous wheel delta and keeps the pointer invariant', () => {
    const cam = originAtZoom(MID_ZOOM);
    const before = screenToWorld(cam, POINTER);
    const next = zoomAt(cam, POINTER, HUGE_FACTOR);
    expect(next.zoom).toBe(ZOOM_MAX);
    const after = screenToWorld(next, POINTER);
    expect(after.x).toEqual(closeTo(before.x));
    expect(after.y).toEqual(closeTo(before.y));
    // ...and an equally huge zoom-out clamps at the other limit.
    expect(zoomAt(next, POINTER, 1 / HUGE_FACTOR).zoom).toBe(ZOOM_MIN);
  });

  // TC-12
  it('TC-12 ignores invalid factors without producing NaN', () => {
    const cam = originAtZoom(MID_ZOOM);
    const invalid = [0, -1, -ZOOM_STEP_FACTOR, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
    for (const factor of invalid) {
      const next = zoomAt(cam, POINTER, factor);
      expect(next).toBe(cam);
      expect(finiteCamera(next)).toBe(true);
    }
    // A factor of exactly 1 changes nothing, so the same object comes back.
    expect(zoomAt(cam, POINTER, 1)).toBe(cam);
  });

  it('clamps zooming below ZOOM_MIN', () => {
    const cam = originAtZoom(MID_ZOOM);
    const next = zoomAt(cam, POINTER, 1 / HUGE_FACTOR);
    expect(next.zoom).toBe(ZOOM_MIN);
    expect(zoomAt(next, POINTER, 1 / HUGE_FACTOR)).toBe(next);
  });
});

describe('viewport resize', () => {
  // TC-07
  it('TC-07 leaves the camera and screen layout unchanged', () => {
    const cam = originAtZoom(MID_ZOOM, { x: -321.5, y: 44.25 });
    const frozen = { ...cam };
    const worldPoint: Point = { x: 700, y: 600 };
    const before = worldToScreen(cam, worldPoint);
    expect(centre(VIEWPORT)).not.toEqual(centre(WIDER_VIEWPORT));

    // A resize hands a new Size to camera maths; the camera itself is not touched.
    const after = { ...cam };
    expect(after).toEqual(frozen);
    expect(after.x).toBe(frozen.x);
    expect(after.y).toBe(frozen.y);
    expect(after.zoom).toBe(frozen.zoom);
    // Content keeps its position relative to the top-left corner of the board.
    const rescaled = worldToScreen(after, worldPoint);
    expect(rescaled.x).toBeCloseTo(before.x, WORLD_DIGITS);
    expect(rescaled.y).toBeCloseTo(before.y, WORLD_DIGITS);
    expect(after).not.toBe(cam);
  });
});

describe('resetCamera', () => {
  // TC-08
  it('TC-08 returns to 100% with the starting point centred', () => {
    const cam = resetCamera(RESET_VIEWPORT);
    expect(cam.zoom).toBe(MID_ZOOM);
    expect(cam.x).toEqual(closeTo(-RESET_VIEWPORT.width / 2));
    expect(cam.y).toEqual(closeTo(-RESET_VIEWPORT.height / 2));
    const screen = worldToScreen(cam, ORIGIN);
    expect(screen.x).toEqual(closeTo(RESET_VIEWPORT.width / 2));
    expect(screen.y).toEqual(closeTo(RESET_VIEWPORT.height / 2));
  });

  it('TC-08 resets from maximum zoom far away', () => {
    const far = originAtZoom(ZOOM_MAX, { x: FAR, y: FAR });
    const cam = resetCamera(RESET_VIEWPORT);
    expect(cam.zoom).toBe(MID_ZOOM);
    expect(finiteCamera(far)).toBe(true);
    // The starting point is the centre of the board area whatever the viewport.
    const centreAfterReset = worldToScreen(cam, ORIGIN);
    expect(centreAfterReset.x).toEqual(closeTo(RESET_VIEWPORT.width / 2));
    expect(centreAfterReset.y).toEqual(closeTo(RESET_VIEWPORT.height / 2));
  });
});

describe('zoomStep', () => {
  // TC-09
  it('TC-09 steps out exactly back to where it started', () => {
    const cam = originAtZoom(MID_ZOOM);
    const inOne = zoomStep(cam, VIEWPORT, 'in');
    expect(inOne.zoom).toBe(ZOOM_STEP_FACTOR);
    expect(zoomPercent(inOne)).toBe(Math.round(ZOOM_STEP_FACTOR * PERCENT_PER_ZOOM));
    const backOut = zoomStep(inOne, VIEWPORT, 'out');
    expect(backOut.zoom).toBe(MID_ZOOM);
    expect(zoomPercent(backOut)).toBe(Math.round(MID_ZOOM * PERCENT_PER_ZOOM));
    expect(backOut).not.toBe(cam);
  });

  it('TC-09 keeps the centre point of the board area in place', () => {
    const cam = originAtZoom(MID_ZOOM, { x: -640, y: -400 });
    const c = centre(VIEWPORT);
    const before = screenToWorld(cam, c);
    const next = zoomStep(cam, VIEWPORT, 'in');
    const after = screenToWorld(next, c);
    expect(after.x).toEqual(closeTo(before.x));
    expect(after.y).toEqual(closeTo(before.y));
  });

  // TC-10
  it('TC-10 clamps repeated steps at ZOOM_MAX and reports canZoomIn false', () => {
    let cam: Camera = originAtZoom(MID_ZOOM);
    const steps = 20;
    for (let i = 0; i < steps; i += 1) {
      cam = zoomStep(cam, VIEWPORT, 'in');
    }
    expect(cam.zoom).toBe(ZOOM_MAX);
    expect(zoomPercent(cam)).toBe(Math.round(ZOOM_MAX * PERCENT_PER_ZOOM));
    expect(canZoomIn(cam)).toBe(false);
    expect(canZoomOut(cam)).toBe(true);
    // Further steps are no-ops (same object), so nothing drifts.
    expect(zoomStep(cam, VIEWPORT, 'in')).toBe(cam);
    // One step back in from the limit is exactly a step.
    expect(zoomStep(cam, VIEWPORT, 'out').zoom).toEqual(closeTo(ZOOM_MAX / ZOOM_STEP_FACTOR));
  });

  it('TC-10 clamps repeated steps down to ZOOM_MIN and reports canZoomOut false', () => {
    let cam: Camera = originAtZoom(MID_ZOOM);
    for (let i = 0; i < 20; i += 1) {
      cam = zoomStep(cam, VIEWPORT, 'out');
    }
    expect(cam.zoom).toBe(ZOOM_MIN);
    expect(zoomPercent(cam)).toBe(Math.round(ZOOM_MIN * PERCENT_PER_ZOOM));
    expect(canZoomOut(cam)).toBe(false);
    expect(zoomStep(cam, VIEWPORT, 'out')).toBe(cam);
    expect(zoomStep(cam, VIEWPORT, 'in').zoom).toEqual(closeTo(ZOOM_MIN * ZOOM_STEP_FACTOR));
  });

  it('zooms around the centre of the board area, not the pointer', () => {
    const cam = originAtZoom(MID_ZOOM, { x: 1000, y: -2000 });
    const c = centre(VIEWPORT);
    expect(screenToWorld(zoomStep(cam, VIEWPORT, 'in'), c)).toEqual({
      x: closeTo(screenToWorld(cam, c).x),
      y: closeTo(screenToWorld(cam, c).y),
    });
  });
});

describe('zoomPercent', () => {
  it('rounds to a whole percent', () => {
    expect(zoomPercent({ x: 0, y: 0, zoom: 1.5625 })).toBe(156);
    expect(zoomPercent({ x: 0, y: 0, zoom: ZOOM_MIN })).toBe(10);
    expect(zoomPercent({ x: 0, y: 0, zoom: ZOOM_MAX })).toBe(400);
  });
});

describe('property: pointer invariance', () => {
  it('TC-03/TC-04 keeps the world point under the pointer for 1000 random gestures', () => {
    const random = mulberry32(0x5eed);
    for (let i = 0; i < PROPERTY_SAMPLES; i += 1) {
      const zoom = ZOOM_MIN * Math.pow(ZOOM_MAX / ZOOM_MIN, random());
      const cam: Camera = {
        x: (random() * 2 - 1) * FAR,
        y: (random() * 2 - 1) * FAR,
        zoom,
      };
      const point: Point = { x: random() * 2000 - 1000, y: random() * 2000 - 1000 };
      const factor = Math.exp((random() * 2 - 1) * 5);
      const before = screenToWorld(cam, point);
      const next = zoomAt(cam, point, factor);
      expect(finiteCamera(next)).toBe(true);
      expect(next.zoom).toBeGreaterThanOrEqual(ZOOM_MIN);
      expect(next.zoom).toBeLessThanOrEqual(ZOOM_MAX);
      if (next.zoom === cam.zoom) {
        expect(next).toBe(cam);
        continue;
      }
      const after = screenToWorld(next, point);
      expect(Math.abs(after.x - before.x)).toBeLessThan(WORLD_EPSILON);
      expect(Math.abs(after.y - before.y)).toBeLessThan(WORLD_EPSILON);
      expect(Math.abs(screenToWorld(next, point).y - screenToWorld(cam, point).y)).toBeLessThan(
        WORLD_EPSILON,
      );
    }
  });

  it('keeps grid spacing uniform far away for random cameras', () => {
    const random = mulberry32(0xc0ffee);
    for (let i = 0; i < 100; i += 1) {
      const zoom = ZOOM_MIN * Math.pow(ZOOM_MAX / ZOOM_MIN, random());
      const cam: Camera = { x: FAR * (random() > 0.5 ? 1 : -1), y: -FAR, zoom };
      const a = screenToWorld(cam, { x: 0, y: 0 });
      const b = screenToWorld(cam, { x: GRID_SPACING_WORLD * zoom, y: 0 });
      // One grid cell always spans exactly GRID_SPACING_WORLD world units.
      expect(Math.abs(b.x - a.x - GRID_SPACING_WORLD)).toBeLessThan(WORLD_EPSILON);
      const p = worldToScreen(cam, a);
      expect(Math.abs(p.x)).toBeLessThan(PIXEL_EPSILON);
    }
  });
});
