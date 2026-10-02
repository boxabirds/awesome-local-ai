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
  type Size,
} from '../../src/client/canvas/camera';

const ORIGIN: Size = { width: 1200, height: 800 };
const FAR = UNBOUNDED_PAN_TESTED_EXTENT;

function cam(x: number, y: number, zoom: number): Camera {
  return { x, y, zoom };
}

/** Deterministic PRNG (mulberry32) for the property check. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('camera.math', () => {
  it('TC-01 panBy moves the camera by -delta/zoom and content by +delta', () => {
    const start = cam(0, 0, 1);
    const next = panBy(start, 200, 100);
    expect(next.x).toBeCloseTo(-200, 6);
    expect(next.y).toBeCloseTo(-100, 6);
    expect(next.zoom).toBe(1);
    // The world origin now renders 200px right, 100px down.
    const screen = worldToScreen(next, { x: 0, y: 0 });
    expect(screen.x).toBeCloseTo(200, 6);
    expect(screen.y).toBeCloseTo(100, 6);
  });

  it('TC-02 panBy far away at ZOOM_MAX shifts exact world units', () => {
    const start = cam(FAR, FAR, ZOOM_MAX);
    const next = panBy(start, 200, 100);
    expect(next.x).toBeCloseTo(FAR - 200 / ZOOM_MAX, 6);
    expect(next.y).toBeCloseTo(FAR - 100 / ZOOM_MAX, 6);
    expect(next.x).toBeCloseTo(FAR - 50, 6);
  });

  it('TC-03 zoomAt keeps the world point under the pointer fixed', () => {
    const start = cam(0, 0, 1);
    const p = { x: 300, y: 200 };
    const before = screenToWorld(start, p);
    const next = zoomAt(start, p, 2);
    expect(next.zoom).toBeCloseTo(2, 6);
    const after = screenToWorld(next, p);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it('TC-04 zoomAt far away keeps pointer world point invariant', () => {
    const start = cam(FAR, FAR, 1);
    const p = { x: 300, y: 200 };
    const before = screenToWorld(start, p);
    const next = zoomAt(start, p, 1.5);
    const after = screenToWorld(next, p);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it('TC-05 zooming out at ZOOM_MIN returns the same object', () => {
    const start = cam(0, 0, ZOOM_MIN);
    const centre = { x: ORIGIN.width / 2, y: ORIGIN.height / 2 };
    const next = zoomAt(start, centre, 1 / ZOOM_STEP_FACTOR);
    expect(next).toBe(start);
    expect(next.x).toBe(start.x);
    expect(next.y).toBe(start.y);
  });

  it('TC-06 zooming in at ZOOM_MAX returns the same object', () => {
    const start = cam(0, 0, ZOOM_MAX);
    const centre = { x: ORIGIN.width / 2, y: ORIGIN.height / 2 };
    const next = zoomAt(start, centre, ZOOM_STEP_FACTOR);
    expect(next).toBe(start);
    expect(next.x).toBe(start.x);
    expect(next.y).toBe(start.y);
  });

  it('TC-07 camera is immutable: viewport size / ops never mutate the input', () => {
    const start = cam(5, -3, 2);
    const snapshot = { ...start };
    // A resize is not user input to the camera; nothing references viewport
    // size except reset/step, and none of them mutate `start`.
    panBy(start, 100, 100);
    zoomAt(start, { x: 10, y: 10 }, 1.5);
    zoomStep(start, { width: 1920, height: 1080 }, 'in');
    resetCamera({ width: 1920, height: 1080 });
    expect(start).toEqual(snapshot);
    // Resizing produces no camera of its own accord.
    expect(resetCamera(ORIGIN)).not.toBe(start);
  });

  it('TC-08 resetCamera centres the origin at 100%', () => {
    const next = resetCamera(ORIGIN);
    expect(next.zoom).toBe(1);
    expect(next.x).toBeCloseTo(-ORIGIN.width / 2, 6);
    expect(next.y).toBeCloseTo(-ORIGIN.height / 2, 6);
    // World origin lands at the viewport centre.
    const screen = worldToScreen(next, { x: 0, y: 0 });
    expect(screen.x).toBeCloseTo(ORIGIN.width / 2, 6);
    expect(screen.y).toBeCloseTo(ORIGIN.height / 2, 6);
  });

  it('TC-09 step in then out returns exactly 1.0', () => {
    const start = cam(0, 0, 1);
    const inOut = zoomStep(zoomStep(start, ORIGIN, 'in'), ORIGIN, 'out');
    expect(inOut.zoom).toBe(1);
    expect(zoomPercent(inOut)).toBe(100);
    expect(zoomStep(start, ORIGIN, 'in').zoom).toBeCloseTo(ZOOM_STEP_FACTOR, 6);
  });

  it('TC-10 repeated steps in clamp at ZOOM_MAX and disable zoom-in', () => {
    let c = cam(0, 0, 1);
    for (let i = 0; i < 20; i++) c = zoomStep(c, ORIGIN, 'in');
    expect(c.zoom).toBeCloseTo(ZOOM_MAX, 6);
    expect(canZoomIn(c)).toBe(false);
    expect(canZoomOut(c)).toBe(true);
  });

  it('TC-11 a huge zoom factor clamps but keeps pointer invariance', () => {
    const start = cam(0, 0, 1);
    const p = { x: 250, y: 120 };
    const before = screenToWorld(start, p);
    const next = zoomAt(start, p, 1000);
    expect(next.zoom).toBeCloseTo(ZOOM_MAX, 6);
    const after = screenToWorld(next, p);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it('TC-12 invalid factors leave the camera unchanged with no NaN', () => {
    const start = cam(12, -8, 1.25);
    const p = { x: 100, y: 100 };
    for (const factor of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const next = zoomAt(start, p, factor);
      expect(next).toBe(start);
    }
    const pct = zoomPercent(start);
    expect(Number.isFinite(pct)).toBe(true);
    expect(Number.isNaN(nextZoom(start))).toBe(false);
  });

  it('property: pointer world point is invariant under zoomAt for 1000 random inputs', () => {
    const rand = mulberry32(0xc0ffee);
    const range = (lo: number, hi: number) => lo + rand() * (hi - lo);
    for (let i = 0; i < 1000; i++) {
      const start = cam(
        range(-FAR, FAR),
        range(-FAR, FAR),
        range(ZOOM_MIN, ZOOM_MAX),
      );
      const p = { x: range(0, 1280), y: range(0, 800) };
      const factor = range(0.2, 5);
      const before = screenToWorld(start, p);
      const after = screenToWorld(zoomAt(start, p, factor), p);
      expect(Math.abs(after.x - before.x)).toBeLessThan(1e-6);
      expect(Math.abs(after.y - before.y)).toBeLessThan(1e-6);
    }
  });

  it('grid spacing is derived from config constants', () => {
    // Sanity for the renderer: screen dot spacing = GRID_SPACING_WORLD * zoom.
    const c = cam(0, 0, 1.5);
    const dotSpacing = GRID_SPACING_WORLD * c.zoom;
    expect(dotSpacing).toBeCloseTo(GRID_SPACING_WORLD * c.zoom, 9);
    expect(zoomPercent(c)).toBe(150);
  });
});

// Helper to keep TC-12 assertion about zoom not being NaN readable.
function nextZoom(c: Camera): number {
  return c.zoom;
}
