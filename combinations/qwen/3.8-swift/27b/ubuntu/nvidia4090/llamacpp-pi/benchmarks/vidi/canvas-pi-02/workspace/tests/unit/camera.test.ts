// Unit tests for the pure camera maths (TC-01 to TC-12 plus the property
// check). All thresholds reference the named config constants.

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
  UNBOUNDED_PAN_TESTED_EXTENT,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP_FACTOR,
} from '../../src/shared/config';

const ORIGIN: Point = { x: 0, y: 0 };
const VIEWPORT: Size = { width: 1280, height: 800 };
const CENTER: Point = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };

/** Deterministic PRNG for the property check. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('camera.math', () => {
  it('TC-01: panBy at zoom 1 shifts the camera and world points exactly', () => {
    const cam: Camera = { x: 0, y: 0, zoom: 1 };
    const moved = panBy(cam, 200, 100);
    expect(moved.x).toBeCloseTo(-200, 12);
    expect(moved.y).toBeCloseTo(-100, 12);
    expect(moved.zoom).toBe(1);
    const before = worldToScreen(cam, ORIGIN);
    const after = worldToScreen(moved, ORIGIN);
    expect(before).toEqual({ x: 0, y: 0 });
    expect(after.x).toBeCloseTo(200, 12);
    expect(after.y).toBeCloseTo(100, 12);
  });

  it('TC-02: panBy at ZOOM_MAX far away shifts the camera by the exact world delta', () => {
    const cam: Camera = {
      x: UNBOUNDED_PAN_TESTED_EXTENT,
      y: -UNBOUNDED_PAN_TESTED_EXTENT,
      zoom: ZOOM_MAX,
    };
    const moved = panBy(cam, 200, 100);
    expect(moved.x - cam.x).toBeCloseTo(-200 / ZOOM_MAX, 12);
    expect(moved.y - cam.y).toBeCloseTo(-100 / ZOOM_MAX, 12);
    expect(moved.zoom).toBe(ZOOM_MAX);
  });

  it('TC-03: zoomAt keeps the world point under the pointer invariant (origin)', () => {
    const cam: Camera = { x: 0, y: 0, zoom: 1 };
    const point: Point = { x: 300, y: 200 };
    const before = screenToWorld(cam, point);
    const zoomed = zoomAt(cam, point, 2);
    expect(zoomed.zoom).toBeCloseTo(2, 12);
    const after = screenToWorld(zoomed, point);
    expect(Math.abs(after.x - before.x)).toBeLessThan(1e-6);
    expect(Math.abs(after.y - before.y)).toBeLessThan(1e-6);
  });

  it('TC-04: zoomAt keeps the world point under the pointer invariant (far away)', () => {
    const cam: Camera = {
      x: UNBOUNDED_PAN_TESTED_EXTENT,
      y: UNBOUNDED_PAN_TESTED_EXTENT,
      zoom: 1,
    };
    const point: Point = { x: 733, y: 412 };
    const before = screenToWorld(cam, point);
    const zoomed = zoomAt(cam, point, 1.5);
    const after = screenToWorld(zoomed, point);
    expect(Math.abs(after.x - before.x)).toBeLessThan(1e-6);
    expect(Math.abs(after.y - before.y)).toBeLessThan(1e-6);
  });

  it('TC-05: zooming out at ZOOM_MIN returns the same camera object', () => {
    const cam: Camera = { x: 0, y: 0, zoom: ZOOM_MIN };
    expect(zoomAt(cam, CENTER, 1 / ZOOM_STEP_FACTOR)).toBe(cam);
    expect(zoomStep(cam, VIEWPORT, 'out')).toBe(cam);
  });

  it('TC-06: zooming in at ZOOM_MAX returns the same camera object', () => {
    const cam: Camera = { x: 0, y: 0, zoom: ZOOM_MAX };
    expect(zoomAt(cam, CENTER, ZOOM_STEP_FACTOR)).toBe(cam);
    expect(zoomStep(cam, VIEWPORT, 'in')).toBe(cam);
  });

  it('TC-07: a viewport resize leaves the camera unchanged', () => {
    const cam: Camera = { x: 123.5, y: -67.25, zoom: 1.5 };
    // Continuous navigation operations take no viewport size; a zero-length
    // pan is a no-op and must return the very same camera object.
    expect(panBy(cam, 0, 0)).toBe(cam);
    expect(zoomAt(cam, CENTER, 1)).toBe(cam);
  });

  it('TC-08: resetCamera(1200x800) gives 100% with the origin at the centre', () => {
    const reset = resetCamera({ width: 1200, height: 800 });
    expect(reset.zoom).toBe(1);
    expect(reset.x).toBe(-600);
    expect(reset.y).toBe(-400);
    expect(worldToScreen(reset, ORIGIN)).toEqual({ x: 600, y: 400 });
  });

  it('TC-09: one step in then one step out returns exactly 1.0', () => {
    let cam: Camera = { x: 0, y: 0, zoom: 1 };
    cam = zoomStep(cam, VIEWPORT, 'in');
    expect(cam.zoom).toBeCloseTo(ZOOM_STEP_FACTOR, 12);
    cam = zoomStep(cam, VIEWPORT, 'out');
    expect(cam.zoom).toBe(1);
    expect(zoomPercent(cam)).toBe(100);
  });

  it('TC-10: 20 steps in clamps at ZOOM_MAX and canZoomIn is false', () => {
    let cam: Camera = { x: 0, y: 0, zoom: 1 };
    for (let i = 0; i < 20; i += 1) {
      cam = zoomStep(cam, VIEWPORT, 'in');
    }
    expect(cam.zoom).toBe(ZOOM_MAX);
    expect(canZoomIn(cam)).toBe(false);
    expect(canZoomOut(cam)).toBe(true);
  });

  it('TC-11: a huge factor clamps to ZOOM_MAX and keeps the pointer invariant', () => {
    const cam: Camera = { x: 0, y: 0, zoom: 1 };
    const point: Point = { x: 300, y: 200 };
    const before = screenToWorld(cam, point);
    const zoomed = zoomAt(cam, point, 1000);
    expect(zoomed.zoom).toBe(ZOOM_MAX);
    const after = screenToWorld(zoomed, point);
    expect(Math.abs(after.x - before.x)).toBeLessThan(1e-6);
    expect(Math.abs(after.y - before.y)).toBeLessThan(1e-6);
  });

  it('TC-12: invalid factors return the camera unchanged with no NaN', () => {
    const cam: Camera = { x: 10, y: -20, zoom: 1.5 };
    const factors = [0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
    for (const factor of factors) {
      const result = zoomAt(cam, { x: 5, y: 5 }, factor);
      expect(result).toBe(cam);
      expect(Number.isFinite(result.x)).toBe(true);
      expect(Number.isFinite(result.y)).toBe(true);
      expect(Number.isFinite(result.zoom)).toBe(true);
    }
  });

  it('property: 1,000 random zoomAt calls keep the pointer world point invariant', () => {
    const rand = mulberry32(42);
    const range = (min: number, max: number) => min + rand() * (max - min);
    for (let i = 0; i < 1000; i += 1) {
      const cam: Camera = {
        x: range(-UNBOUNDED_PAN_TESTED_EXTENT, UNBOUNDED_PAN_TESTED_EXTENT),
        y: range(-UNBOUNDED_PAN_TESTED_EXTENT, UNBOUNDED_PAN_TESTED_EXTENT),
        zoom: range(ZOOM_MIN, ZOOM_MAX),
      };
      const point: Point = { x: range(-5000, 5000), y: range(-5000, 5000) };
      const factor = range(0.2, 5);
      const before = screenToWorld(cam, point);
      const zoomed = zoomAt(cam, point, factor);
      const after = screenToWorld(zoomed, point);
      expect(Math.abs(after.x - before.x)).toBeLessThan(1e-6);
      expect(Math.abs(after.y - before.y)).toBeLessThan(1e-6);
    }
  });
});
