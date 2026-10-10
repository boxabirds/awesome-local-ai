import { describe, expect, it } from 'vitest';
import {
  GRID_SPACING_WORLD,
  UNBOUNDED_PAN_TESTED_EXTENT,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP_FACTOR
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
  type Size
} from '../../src/client/canvas/camera';

const VIEWPORT: Size = { width: 1200, height: 800 };
const CENTRE = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };
const POINTER = { x: 300, y: 200 };
const ORIGIN: Camera = { x: 0, y: 0, zoom: 1 };
const FAR = UNBOUNDED_PAN_TESTED_EXTENT;

function expectClose(actual: number, expected: number, tolerance: number): void {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance);
}

describe('camera.math', () => {
  it('TC-01 panBy at zoom 1 moves camera by -delta and drags world points with the pointer', () => {
    const next = panBy(ORIGIN, 200, 100);
    expect(next.x).toBe(-200);
    expect(next.y).toBe(-100);
    expect(next.zoom).toBe(1);
    expect(worldToScreen(ORIGIN, { x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
    expect(worldToScreen(next, { x: 0, y: 0 })).toEqual({ x: 200, y: 100 });
  });

  it('TC-02 panBy at ZOOM_MAX far from the start shifts by delta/zoom exactly', () => {
    const cam: Camera = { x: FAR, y: FAR, zoom: ZOOM_MAX };
    const next = panBy(cam, 200, 100);
    const tolerance = 1e-6;
    expectClose(next.x, FAR - 200 / ZOOM_MAX, tolerance);
    expectClose(next.y, FAR - 100 / ZOOM_MAX, tolerance);
    expect(next.zoom).toBe(ZOOM_MAX);
  });

  it('TC-03 zoomAt keeps the world point under the pointer invariant', () => {
    const before = screenToWorld(ORIGIN, POINTER);
    const next = zoomAt(ORIGIN, POINTER, 2);
    expect(next.zoom).toBe(2);
    const after = screenToWorld(next, POINTER);
    expectClose(after.x, before.x, 1e-9);
    expectClose(after.y, before.y, 1e-9);
  });

  it('TC-04 zoomAt pointer invariance holds far from the start', () => {
    const cam: Camera = { x: FAR, y: FAR, zoom: 1 };
    const before = screenToWorld(cam, POINTER);
    const next = zoomAt(cam, POINTER, 1.5);
    const after = screenToWorld(next, POINTER);
    const tolerance = 1e-6;
    expectClose(after.x, before.x, tolerance);
    expectClose(after.y, before.y, tolerance);
  });

  it('TC-05 zooming out at ZOOM_MIN returns the same object', () => {
    const cam: Camera = { x: 0, y: 0, zoom: ZOOM_MIN };
    const next = zoomAt(cam, CENTRE, 1 / ZOOM_STEP_FACTOR);
    expect(next).toBe(cam);
  });

  it('TC-06 zooming in at ZOOM_MAX returns the same object', () => {
    const cam: Camera = { x: 0, y: 0, zoom: ZOOM_MAX };
    const next = zoomAt(cam, CENTRE, ZOOM_STEP_FACTOR);
    expect(next).toBe(cam);
  });

  it('TC-07 viewport resize leaves the camera unchanged', () => {
    const cam = resetCamera(VIEWPORT);
    // A resize only changes the viewport Size; the camera is never rewritten
    // from it, so it must stay byte-identical.
    const resized: Camera = { ...cam };
    expect(resized.x).toBe(cam.x);
    expect(resized.y).toBe(cam.y);
    expect(resized.zoom).toBe(cam.zoom);
    expect(worldToScreen(cam, { x: 0, y: 0 })).toEqual({
      x: VIEWPORT.width / 2,
      y: VIEWPORT.height / 2
    });
  });

  it('TC-08 resetCamera centres the origin at zoom 1', () => {
    const far: Camera = { x: FAR, y: FAR, zoom: ZOOM_MAX };
    expect(far.zoom).toBe(ZOOM_MAX);
    const cam = resetCamera({ width: 1200, height: 800 });
    expect(cam.zoom).toBe(1);
    expect(cam.x).toBe(-600);
    expect(cam.y).toBe(-400);
    expect(worldToScreen(cam, { x: 0, y: 0 })).toEqual({ x: 600, y: 400 });
  });

  it('TC-09 one step in then one step out returns exactly 1.0', () => {
    const inOne = zoomStep(ORIGIN, VIEWPORT, 'in');
    expect(inOne.zoom).toBe(ZOOM_STEP_FACTOR);
    expect(zoomPercent(inOne)).toBe(125);
    const out = zoomStep(inOne, VIEWPORT, 'out');
    expect(out.zoom).toBe(1);
    expect(zoomPercent(out)).toBe(100);
  });

  it('TC-10 twenty steps in clamps at ZOOM_MAX and disables zoom-in', () => {
    let cam: Camera = ORIGIN;
    for (let i = 0; i < 20; i += 1) {
      cam = zoomStep(cam, VIEWPORT, 'in');
    }
    expect(cam.zoom).toBe(ZOOM_MAX);
    expect(canZoomIn(cam)).toBe(false);
    expect(canZoomOut(cam)).toBe(true);
  });

  it('TC-11 a huge zoom factor clamps to ZOOM_MAX and keeps the pointer invariant', () => {
    const before = screenToWorld(ORIGIN, POINTER);
    const next = zoomAt(ORIGIN, POINTER, 1000);
    expect(next.zoom).toBe(ZOOM_MAX);
    const after = screenToWorld(next, POINTER);
    expectClose(after.x, before.x, 1e-9);
    expectClose(after.y, before.y, 1e-9);
  });

  it('TC-12 invalid factors return the camera unchanged with no NaN output', () => {
    const invalidFactors = [0, -1, -ZOOM_STEP_FACTOR, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
    for (const factor of invalidFactors) {
      expect(zoomAt(ORIGIN, POINTER, factor)).toBe(ORIGIN);
    }
  });
});

describe('camera.math property checks', () => {
  // Deterministic PRNG (mulberry32) for the seeded property check.
  function mulberry32(seed: number): () => number {
    let a = seed;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  it('pointer world point is invariant under zoomAt for 1,000 random cameras', () => {
    const rand = mulberry32(0x5eed1);
    const tolerance = 1e-6;
    for (let i = 0; i < 1000; i += 1) {
      const cam: Camera = {
        x: (rand() * 2 - 1) * UNBOUNDED_PAN_TESTED_EXTENT,
        y: (rand() * 2 - 1) * UNBOUNDED_PAN_TESTED_EXTENT,
        zoom: Math.exp(Math.log(ZOOM_MIN) + rand() * (Math.log(ZOOM_MAX) - Math.log(ZOOM_MIN)))
      };
      const point = { x: rand() * VIEWPORT.width, y: rand() * VIEWPORT.height };
      const factor = Math.exp(Math.log(0.1) + rand() * (Math.log(10) - Math.log(0.1)));
      const before = screenToWorld(cam, point);
      const next = zoomAt(cam, point, factor);
      const after = screenToWorld(next, point);
      expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(tolerance);
      expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(tolerance);
      expect(Number.isFinite(next.x)).toBe(true);
      expect(Number.isFinite(next.y)).toBe(true);
      expect(next.zoom).toBeGreaterThanOrEqual(ZOOM_MIN);
      expect(next.zoom).toBeLessThanOrEqual(ZOOM_MAX);
    }
  });

  it('zoom never escapes [ZOOM_MIN, ZOOM_MAX] and the grid constant is positive', () => {
    expect(GRID_SPACING_WORLD).toBeGreaterThan(0);
    let cam = resetCamera(VIEWPORT);
    for (let i = 0; i < 50; i += 1) {
      cam = zoomStep(cam, VIEWPORT, 'in');
    }
    for (let i = 0; i < 100; i += 1) {
      cam = zoomStep(cam, VIEWPORT, 'out');
    }
    expect(cam.zoom).toBe(ZOOM_MIN);
    expect(canZoomOut(cam)).toBe(false);
  });
});
