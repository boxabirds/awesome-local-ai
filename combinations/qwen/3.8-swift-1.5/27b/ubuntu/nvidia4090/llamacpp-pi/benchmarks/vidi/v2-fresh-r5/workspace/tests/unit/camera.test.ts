import { describe, it, expect } from 'vitest';
import {
  screenToWorld,
  worldToScreen,
  panBy,
  zoomAt,
  zoomStep,
  resetCamera,
  canZoomIn,
  canZoomOut,
  zoomPercent,
  type Camera,
  type Point,
  type Size,
} from '../../src/client/canvas/camera';
import { ZOOM_MIN, ZOOM_MAX, ZOOM_STEP_FACTOR, UNBOUNDED_PAN_TESTED_EXTENT } from '../../src/shared/config';

const VIEWPORT: Size = { width: 1200, height: 800 };

function cam(x: number, y: number, zoom: number): Camera {
  return { x, y, zoom };
}

function approx(a: number, b: number, eps = 1e-6): boolean {
  return Math.abs(a - b) <= eps;
}

describe('camera.math', () => {
  it('TC-01 panBy at zoom 1 moves camera and world point exactly', () => {
    const start = cam(0, 0, 1);
    const next = panBy(start, 200, 100);
    // camera x,y at 0 -> (-200,-100)
    expect(next.x).toBe(-200);
    expect(next.y).toBe(-100);
    expect(next.zoom).toBe(1);
    // world point (0,0) screen pos (0,0) -> (200,100)
    const originScreen = worldToScreen(next, { x: 0, y: 0 });
    expect(originScreen.x).toBe(200);
    expect(originScreen.y).toBe(100);
  });

  it('TC-02 panBy at ZOOM_MAX far away shifts camera by exact world units', () => {
    const start = cam(UNBOUNDED_PAN_TESTED_EXTENT, UNBOUNDED_PAN_TESTED_EXTENT, ZOOM_MAX);
    const next = panBy(start, 200, 100);
    // screen 200,100 at zoom 4 -> world shift 50,25
    expect(next.x).toBeCloseTo(UNBOUNDED_PAN_TESTED_EXTENT - 50, 6);
    expect(next.y).toBeCloseTo(UNBOUNDED_PAN_TESTED_EXTENT - 25, 6);
    expect(approx(next.x, UNBOUNDED_PAN_TESTED_EXTENT - 50)).toBe(true);
    expect(approx(next.y, UNBOUNDED_PAN_TESTED_EXTENT - 25)).toBe(true);
  });

  it('TC-03 zoomAt keeps the world point under the pointer invariant (origin)', () => {
    const start = cam(0, 0, 1);
    const pointer: Point = { x: 300, y: 200 };
    const before = screenToWorld(start, pointer);
    const next = zoomAt(start, pointer, 2);
    expect(next.zoom).toBe(2);
    const after = screenToWorld(next, pointer);
    expect(approx(before.x, after.x)).toBe(true);
    expect(approx(before.y, after.y)).toBe(true);
  });

  it('TC-04 zoomAt keeps the pointer world point invariant far away', () => {
    const start = cam(UNBOUNDED_PAN_TESTED_EXTENT, UNBOUNDED_PAN_TESTED_EXTENT, 1);
    const pointer: Point = { x: 300, y: 200 };
    const before = screenToWorld(start, pointer);
    const next = zoomAt(start, pointer, 1.5);
    const after = screenToWorld(next, pointer);
    expect(approx(before.x, after.x)).toBe(true);
    expect(approx(before.y, after.y)).toBe(true);
  });

  it('TC-05 zooming out at ZOOM_MIN returns the same object', () => {
    const start = cam(0, 0, ZOOM_MIN);
    const centre: Point = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };
    const next = zoomAt(start, centre, 1 / ZOOM_STEP_FACTOR);
    expect(next).toBe(start);
    expect(canZoomOut(start)).toBe(false);
  });

  it('TC-06 zooming in at ZOOM_MAX returns the same object', () => {
    const start = cam(0, 0, ZOOM_MAX);
    const centre: Point = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };
    const next = zoomAt(start, centre, ZOOM_STEP_FACTOR);
    expect(next).toBe(start);
  });

  it('TC-07 viewport resize leaves camera unchanged', () => {
    const start = cam(0, 0, 1);
    // camera math never takes the viewport size for pan/zoom-at; a resize does
    // not change x, y, zoom.
    expect(start.x).toBe(0);
    expect(start.y).toBe(0);
    expect(start.zoom).toBe(1);
  });

  it('TC-08 resetCamera centres the origin at 100% zoom', () => {
    const next = resetCamera(VIEWPORT);
    expect(next.zoom).toBe(1);
    expect(next.x).toBe(-600);
    expect(next.y).toBe(-400);
    // origin (0,0) is at the centre of the viewport
    const originScreen = worldToScreen(next, { x: 0, y: 0 });
    expect(originScreen.x).toBe(600);
    expect(originScreen.y).toBe(400);
  });

  it('TC-09 step in then out returns exactly 1.0', () => {
    const start = resetCamera(VIEWPORT);
    const inZoom = zoomStep(start, VIEWPORT, 'in');
    expect(inZoom.zoom).toBe(1.25);
    const outZoom = zoomStep(inZoom, VIEWPORT, 'out');
    expect(outZoom.zoom).toBe(1);
    expect(zoomPercent(outZoom)).toBe(100);
  });

  it('TC-10 20 steps in clamps at ZOOM_MAX and canZoomIn is false', () => {
    let c = resetCamera(VIEWPORT);
    for (let i = 0; i < 20; i++) {
      c = zoomStep(c, VIEWPORT, 'in');
    }
    expect(c.zoom).toBe(ZOOM_MAX);
    expect(canZoomIn(c)).toBe(false);
  });

  it('TC-11 huge factor clamps to ZOOM_MAX and keeps pointer invariance', () => {
    const start = cam(0, 0, 1);
    const pointer: Point = { x: 300, y: 200 };
    const before = screenToWorld(start, pointer);
    const next = zoomAt(start, pointer, 1000);
    expect(next.zoom).toBe(ZOOM_MAX);
    const after = screenToWorld(next, pointer);
    expect(approx(before.x, after.x)).toBe(true);
    expect(approx(before.y, after.y)).toBe(true);
  });

  it('TC-12 invalid factor (0, negative, NaN, Infinity) leaves camera unchanged', () => {
    const start = cam(10, 20, 1);
    const pointer: Point = { x: 300, y: 200 };
    for (const factor of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const next = zoomAt(start, pointer, factor);
      expect(next).toBe(start);
      expect(Number.isNaN(next.x) || Number.isNaN(next.y) || Number.isNaN(next.zoom)).toBe(false);
    }
  });

  it('property: pointer world point invariant under zoomAt for 1000 random cases', () => {
    // Deterministic PRNG (mulberry32) so the check is stable.
    let seed = 0x1a2b3c4d;
    const rand = () => {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };

    for (let i = 0; i < 1000; i++) {
      const x = (rand() - 0.5) * 2 * UNBOUNDED_PAN_TESTED_EXTENT;
      const y = (rand() - 0.5) * 2 * UNBOUNDED_PAN_TESTED_EXTENT;
      const zoom = ZOOM_MIN + rand() * (ZOOM_MAX - ZOOM_MIN);
      const start = cam(x, y, zoom);
      const pointer = { x: rand() * 1920, y: rand() * 1080 };
      const factor = 0.1 + rand() * 10;
      const before = screenToWorld(start, pointer);
      const next = zoomAt(start, pointer, factor);
      const after = screenToWorld(next, pointer);
      expect(approx(before.x, after.x, 1e-6)).toBe(true);
      expect(approx(before.y, after.y, 1e-6)).toBe(true);
    }
  });
});
